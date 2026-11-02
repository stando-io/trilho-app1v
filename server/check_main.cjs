const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  try {
    const r = await p.query('SELECT id,name,db_name FROM projects ORDER BY name');
    console.log(JSON.stringify(r.rows));
    await p.end();
  } catch (e) {
    console.error('ERR:', e.message);
    await p.end();
  }
})();
