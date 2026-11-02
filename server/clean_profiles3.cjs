const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  try {
    await p.query('DELETE FROM roles WHERE profile_id IS NOT NULL');
    const linked = await p.query('SELECT DISTINCT profile_id FROM users WHERE profile_id IS NOT NULL');
    console.log('linked profiles:', linked.rowCount);
    const res = await p.query('DELETE FROM profiles WHERE id NOT IN (SELECT DISTINCT profile_id FROM users WHERE profile_id IS NOT NULL) RETURNING name');
    console.log('deleted:', res.rowCount);
    await p.end();
  } catch (e) {
    console.error('ERR:', e.message);
    await p.end();
    process.exit(1);
  }
})();