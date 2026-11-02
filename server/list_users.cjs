const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  try {
    const r = await p.query('SELECT id,email,name FROM users ORDER BY email');
    console.log(JSON.stringify(r.rows, null, 2));
    await p.end();
  } catch (e) {
    console.error('ERR:', e.message);
    await p.end();
  }
})();