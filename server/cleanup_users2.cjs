const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  try {
    const r = await p.query("DELETE FROM users WHERE lower(email) NOT IN ('admin@trilho.local','brownie@trilho.com','thiago.pimentel@agapeconsultoria.com.br') RETURNING email");
    console.log('deleted:', r.rowCount);
    await p.end();
  } catch (e) {
    console.error('ERR:', e.message);
    await p.end();
    process.exit(1);
  }
})();