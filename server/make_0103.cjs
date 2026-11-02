const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  try {
    await p.query('CREATE DATABASE "trilho_proj_0103"');
    console.log('ok');
    await p.end();
  } catch (e) {
    console.log('skip:', e.message);
    await p.end();
  }
})();