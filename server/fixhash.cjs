const { Pool } = require("pg");
const { hash } = require("@node-rs/argon2");
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  try {
    const h = await hash("admin-local-123");
    const res = await p.query("UPDATE users SET password_hash = $1 WHERE lower(email) = lower($2) RETURNING id, email", [h, "admin@trilho.local"]);
    console.log("rows:", res.rowCount);
    if (res.rows[0]) console.log(res.rows[0].email);
    await p.end();
  } catch (e) {
    console.error("ERR:", e.message);
    await p.end();
    process.exit(1);
  }
})();
