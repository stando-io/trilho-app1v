const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  try {
    const r = await p.query("DELETE FROM roles WHERE lower(name) IN ('admin teste','administrador','gerente de projetos') RETURNING id,name");
    console.log('deleted:', r.rowCount);
    if(r.rows.length) r.rows.forEach(x=>console.log(x.name));
    await p.end();
  } catch (e) {
    console.error('ERR:', e.message);
    await p.end();
    process.exit(1);
  }
})();