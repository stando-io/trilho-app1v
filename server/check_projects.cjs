const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  try {
    const r = await p.query("SELECT id, name, slug, identifier, db_name, database_name, created_at FROM projects ORDER BY created_at");
    console.log(JSON.stringify(r.rows, null, 2));
    await p.end();
  } catch (e) {
    console.error('ERR:', e.message);
    await p.end();
    process.exit(1);
  }
})();