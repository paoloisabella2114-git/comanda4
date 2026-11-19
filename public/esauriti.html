// Piatti esauriti della giornata.
// Lo stato sta in un database Neon SEPARATO (variabile ESAURITI_DATABASE_URL),
// mai nel DB delle serate (DATABASE_URL), che qui non viene usato.
//
// GET  /api/esauriti          -> { esauriti: [id, id, ...] }   (pubblico, usato da pagina2.html)
// POST /api/esauriti          -> richiede header x-admin-pin = ADMIN_PIN
//        { action: 'verify' }            controlla solo il PIN
//        { id: 12, esaurito: true }     segna/riattiva un piatto
//        { action: 'reset' }            riattiva tutti
//
// Variabili d'ambiente su Vercel:
//   ADMIN_PIN                 PIN della pagina esauriti.html
//   ESAURITI_DATABASE_URL     indirizzo postgresql://... del database Neon separato
//
// La tabella "esauriti" viene creata da sola la prima volta.

const crypto = require('crypto');
const { Pool } = require('pg');

const DB_URL = process.env.ESAURITI_DATABASE_URL;
let pool = null;
let tabellaPronta = null;

// La "giornata di servizio" cambia alle 05:00 (Europe/Rome), non a mezzanotte:
// se la serata finisce dopo le 24 i piatti esauriti non si riattivano da soli.
function giornoServizio(giorniIndietro = 0) {
  const d = new Date(Date.now() - (5 + 24 * giorniIndietro) * 3600 * 1000);
  return d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' }); // AAAA-MM-GG
}

function db() {
  if (!DB_URL) throw new Error('ESAURITI_DATABASE_URL non impostata');
  if (!pool) {
    pool = new Pool({
      connectionString: DB_URL,
      ssl: { rejectUnauthorized: false },
      max: 1,
      connectionTimeoutMillis: 4000,   // se Neon è lento il cliente non resta in attesa
      query_timeout: 4000,
      idleTimeoutMillis: 10000
    });
    pool.on('error', e => console.error('pool esauriti:', e.message));
  }
  if (!tabellaPronta) {
    tabellaPronta = pool.query(
      'CREATE TABLE IF NOT EXISTS esauriti (' +
      'giorno date NOT NULL, id_articolo integer NOT NULL, PRIMARY KEY (giorno, id_articolo))'
    ).catch(e => { tabellaPronta = null; throw e; });
  }
  return tabellaPronta.then(() => pool);
}

async function elenco(p, giorno) {
  const r = await p.query('SELECT id_articolo FROM esauriti WHERE giorno = $1::date', [giorno]);
  return r.rows.map(x => Number(x.id_articolo));
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
  const giorno = giornoServizio();

  if (req.method === 'GET') {
    // Lato cliente: se il database non risponde il menu deve funzionare comunque.
    try {
      const p = await db();
      return res.json({ esauriti: await elenco(p, giorno) });
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

    const p = await db();
    if (b.action === 'reset') {
      await p.query('DELETE FROM esauriti WHERE giorno = $1::date', [giorno]);
    } else {
      const id = parseInt(b.id, 10);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'id non valido' });
      if (b.esaurito) {
        await p.query(
          'INSERT INTO esauriti (giorno, id_articolo) VALUES ($1::date, $2) ON CONFLICT DO NOTHING',
          [giorno, id]
        );
        // pulizia dei giorni vecchi (più di una settimana fa)
        await p.query('DELETE FROM esauriti WHERE giorno < $1::date', [giornoServizio(7)]);
      } else {
        await p.query('DELETE FROM esauriti WHERE giorno = $1::date AND id_articolo = $2', [giorno, id]);
      }
    }
    return res.json({ esauriti: await elenco(p, giorno) });
  } catch (err) {
    console.error('esauriti POST:', err.message);
    return res.status(500).json({ error: 'Errore salvataggio (database esauriti)' });
  }
};
