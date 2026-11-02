const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
p.query('SELECT name FROM roles ORDER BY name').then(r => {
  r.rows.forEach(x => console.log(x.name));
  return p.end();
}).catch(e => { console.error('e'); p.end(); });