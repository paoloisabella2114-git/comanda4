// Piatti esauriti della giornata.
// Lo stato NON sta nel DB delle serate ma in Upstash Redis (REST), per non toccare il DB universale.
//
// GET  /api/esauriti          -> { esauriti: [id, id, ...] }   (pubblico, usato da pagina2.html)
// POST /api/esauriti          -> richiede header x-admin-pin = ADMIN_PIN
//        { action: 'verify' }            controlla solo il PIN
//        { id: 12, esaurito: true }     segna/riattiva un piatto
//        { action: 'reset' }            riattiva tutti
//
// Variabili d'ambiente su Vercel:
//   ADMIN_PIN                                    PIN della pagina esauriti.html
//   KV_REST_API_URL + KV_REST_API_TOKEN          (oppure UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN)

const crypto = require('crypto');

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const SCADENZA_SEC = 48 * 3600; // pulizia automatica della chiave

// La "giornata di servizio" cambia alle 05:00 (Europe/Rome), non a mezzanotte:
// se la serata finisce dopo le 24 i piatti esauriti non si riattivano da soli.
function chiaveOggi() {
  const d = new Date(Date.now() - 5 * 3600 * 1000);
  return 'esauriti:' + d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
}

async function redis(comandi) {
  if (!REDIS_URL || !REDIS_TOKEN) throw new Error('Redis non configurato');
  const r = await fetch(REDIS_URL + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + REDIS_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(comandi)
  });
  if (!r.ok) throw new Error('Redis HTTP ' + r.status);
  const risposte = await r.json();
  const errore = risposte.find(x => x && x.error);
  if (errore) throw new Error('Redis: ' + errore.error);
  return risposte;
}

function pinCorretto(ricevuto) {
  const atteso = process.env.ADMIN_PIN;
  const h = s => crypto.createHash('sha256').update(String(s)).digest();
  return crypto.timingSafeEqual(h(ricevuto || ''), h(atteso));
}

function leggiBody(req) {
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  return b || {};
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const key = chiaveOggi();

  if (req.method === 'GET') {
    // Lato cliente: se Redis non risponde il menu deve funzionare comunque.
    try {
      const [m] = await redis([['SMEMBERS', key]]);
      return res.json({ esauriti: (m.result || []).map(Number) });
    } catch (err) {
      console.error('esauriti GET:', err.message);
      return res.json({ esauriti: [] });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo non consentito' });

  if (!process.env.ADMIN_PIN) return res.status(500).json({ error: 'ADMIN_PIN non impostato su Vercel' });
  if (!pinCorretto(req.headers['x-admin-pin'])) return res.status(401).json({ error: 'PIN errato' });

  const b = leggiBody(req);
  try {
    if (b.action === 'verify') return res.json({ ok: true });

    let comandi;
    if (b.action === 'reset') {
      comandi = [['DEL', key]];
    } else {
      const id = parseInt(b.id, 10);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'id non valido' });
      comandi = b.esaurito
        ? [['SADD', key, String(id)], ['EXPIRE', key, SCADENZA_SEC]]
        : [['SREM', key, String(id)]];
    }
    comandi.push(['SMEMBERS', key]);
    const risposte = await redis(comandi);
    const ultimo = risposte[risposte.length - 1];
    return res.json({ esauriti: (ultimo.result || []).map(Number) });
  } catch (err) {
    console.error('esauriti POST:', err.message);
    return res.status(500).json({ error: 'Errore salvataggio (Redis)' });
  }
};
