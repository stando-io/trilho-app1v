const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  try {
    const r = await p.query('SELECT name FROM roles ORDER BY name');
    console.log(r.rows.map(x=>x.name).join(', '));
    await p.end();
  } catch (e) {
    console.error('ERR:', e.message);
    await p.end();
  }
})();