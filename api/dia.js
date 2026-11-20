// Diagnosi del collegamento al DB (solo per i test).
// Uso: apri  /api/diagnosi?pin=IL_TUO_ADMIN_PIN
// Controlla: indirizzo, connessione, tabelle e colonne che usa il menu, e prova la query vera del menu.
// Non mostra mai password né l'indirizzo completo.

const crypto = require('crypto');
const { Pool } = require('pg');

// Tabelle e colonne che usano api/menu.js e api/ingredienti/[id].js
const ATTESE = {
  articoli: ['id', 'descrizione', 'prezzo', 'id_tipologia'],
  tipologie: ['id', 'descrizione', 'visibile', 'posizione'],
  articoli_ingredienti: ['id', 'id_articolo', 'id_ingrediente', 'visibile', 'obbligatorio', 'quantita_massima', 'posizione'],
  ingredienti: ['id', 'descrizione', 'descrizionebreve', 'prezzo']
};

const QUERY_MENU = `
  SELECT a.id, a.descrizione AS nome, a.prezzo,
         t.descrizione AS nome_tipologia,
         COUNT(ai.id) FILTER (WHERE ai.obbligatorio IS NOT TRUE) AS num_ingredienti
  FROM articoli a
  JOIN tipologie t ON t.id = a.id_tipologia
  LEFT JOIN articoli_ingredienti ai ON ai.id_articolo = a.id AND ai.visibile IS NOT FALSE
  WHERE t.visibile = true
  GROUP BY a.id, a.descrizione, a.prezzo, t.descrizione, t.posizione
  ORDER BY t.posizione, a.descrizione`;

function uguali(a, b) {
  const h = s => crypto.createHash('sha256').update(String(s)).digest();
  return crypto.timingSafeEqual(h(a), h(b));
}

function suggerimentoConnessione(err) {
  const m = String(err.message || '');
  if (err.code === '28P01' || /password authentication/i.test(m)) return 'Utente o password dell\'indirizzo non corretti: ricopia l\'indirizzo da Neon (Connect).';
  if (err.code === 'ENOTFOUND' || /getaddrinfo/i.test(m)) return 'Il nome del server nell\'indirizzo non esiste: controlla di aver copiato tutto l\'indirizzo.';
  if (err.code === '3D000') return 'Il database indicato alla fine dell\'indirizzo non esiste su questo server.';
  if (/timeout/i.test(m)) return 'Il server non risponde in tempo (se è Neon, riprova: potrebbe essere in pausa).';
  if (/ssl/i.test(m)) return 'Problema di connessione sicura (SSL): controlla che l\'indirizzo sia quello di Neon.';
  return 'Connessione non riuscita: controlla l\'indirizzo in DATABASE_URL.';
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const fine = (code, obj) => res.status(code).end(JSON.stringify(obj, null, 2));

  if (!process.env.ADMIN_PIN) return fine(500, { errore: 'ADMIN_PIN non impostato su Vercel' });
  const pin = req.query && req.query.pin;
  if (!pin || !uguali(pin, process.env.ADMIN_PIN)) return fine(401, { errore: 'Aggiungi ?pin=IL_TUO_ADMIN_PIN all\'indirizzo' });

  const out = { diagnosi: [] };
  const d = out.diagnosi;
  const url = (process.env.DATABASE_URL || '').trim();

  if (!url) {
    d.push('DATABASE_URL non è impostata in questo progetto Vercel.');
    return fine(200, out);
  }
  try {
    const u = new URL(url);
    out.indirizzo = { server: u.hostname, database: u.pathname.replace('/', ''), utente: u.username };
  } catch (e) {
    d.push('DATABASE_URL non è un indirizzo valido: deve iniziare con postgresql:// e non avere davanti psql né apici.');
    out.inizio_valore = url.slice(0, 8);
    return fine(200, out);
  }

  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 1, connectionTimeoutMillis: 8000, query_timeout: 8000 });
  pool.on('error', () => {});
  try {
    const r0 = await pool.query('SELECT current_database() AS db, current_user AS utente');
    out.connessione = 'riuscita';
    out.database_collegato = r0.rows[0].db;
  } catch (err) {
    out.connessione = 'FALLITA';
    out.errore = { codice: err.code || null, messaggio: err.message };
    d.push(suggerimentoConnessione(err));
    await pool.end().catch(() => {});
    return fine(200, out);
  }

  try {
    const c = await pool.query(
      `SELECT table_schema, table_name, column_name FROM information_schema.columns
       WHERE table_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY table_schema, table_name, ordinal_position`);
    const tabelle = {};
    c.rows.forEach(r => {
      const k = r.table_schema + '.' + r.table_name;
      (tabelle[k] = tabelle[k] || []).push(r.column_name);
    });
    out.tabelle_presenti = Object.keys(tabelle).slice(0, 120);
    if (!out.tabelle_presenti.length) d.push('Il database è collegato ma non contiene nessuna tabella (è vuoto): le tabelle del gestionale non ci sono.');

    out.controllo_tabelle = {};
    Object.keys(ATTESE).forEach(nome => {
      const trovate = Object.keys(tabelle).filter(k => k.split('.')[1] === nome);
      if (!trovate.length) {
        const simili = Object.keys(tabelle).filter(k => k.toLowerCase().includes(nome.slice(0, 5).toLowerCase())).slice(0, 8);
        out.controllo_tabelle[nome] = { presente: false, tabelle_simili: simili };
        d.push(`Manca la tabella "${nome}"` + (simili.length ? ` (forse ora si chiama una di queste: ${simili.join(', ')})` : '') + '.');
        return;
      }
      const k = trovate[0];
      const cols = tabelle[k];
      const mancanti = ATTESE[nome].filter(x => !cols.includes(x));
      out.controllo_tabelle[nome] = { presente: true, schema: k.split('.')[0], colonne_mancanti: mancanti, colonne_presenti: cols.slice(0, 40) };
      if (k.split('.')[0] !== 'public') d.push(`La tabella "${nome}" sta nello schema "${k.split('.')[0]}" e non in "public": la query del menu non la trova senza prefisso.`);
      if (mancanti.length) d.push(`Nella tabella "${nome}" mancano le colonne: ${mancanti.join(', ')}.`);
    });

    try {
      const m = await pool.query(QUERY_MENU);
      out.query_menu = { ok: true, piatti: m.rows.length };
      if (m.rows.length === 0) d.push('La query del menu funziona ma restituisce 0 piatti: controlla che ci siano articoli e che la tipologia abbia visibile = true.');
    } catch (err) {
      out.query_menu = { ok: false, codice: err.code || null, errore: err.message };
      d.push('La query vera del menu fallisce: vedi query_menu.errore.');
    }
  } catch (err) {
    out.errore = { codice: err.code || null, messaggio: err.message };
    d.push('Errore durante il controllo delle tabelle.');
  }
  if (out.query_menu && out.query_menu.ok && out.query_menu.piatti > 0) d.push('Tutto a posto: il menu dovrebbe funzionare.');
  await pool.end().catch(() => {});
  return fine(200, out);
};
