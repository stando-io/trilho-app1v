const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
p.query('SELECT count(*) FROM roles').then(r => { console.log(r.rows[0].count); return p.end(); }).catch(()=>p.end());