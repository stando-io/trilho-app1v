const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  try {
    await p.query('TRUNCATE TABLE project_members, projects, users, roles, profiles, sessions, audit_logs RESTART IDENTITY CASCADE');
    console.log('ok');
    await p.end();
  } catch (e) {
    console.error('ERR:', e.message);
    await p.end();
    process.exit(1);
  }
})();