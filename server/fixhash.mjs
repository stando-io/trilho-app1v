import {Pool} from 'pg';
import {hash} from '@node-rs/argon2';
const p=new Pool({connectionString:process.env.DATABASE_URL, ssl:{rejectUnauthorized:false}});
async function run(){
  try {
    const h = await hash('admin-local-123');
    const r = await p.query("UPDATE users SET password_hash=\ WHERE lower(email)=lower('admin@trilho.local') RETURNING id, email", [h]);
    console.log('updated:', r.rowCount);
    if(r.rows[0]) console.log(r.rows[0].email);
    await p.end();
  } catch(e){ console.error('ERR:', e.message); await p.end(); process.exit(1); }
}
run();