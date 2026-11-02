const { Pool } = require("pg");
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const dbs = ["trilho_proj_pm_teste", "trilho_proj_projeto_trilho", "trilho_proj_e2e_planilha", "trilho_proj_0101", "trilho_proj_0103"];
(async () => {
  try {
    for (const db of dbs) {
      try {
        await p.query("CREATE DATABASE \"" + db + "\"");
        console.log("created:", db);
      } catch (e) {
        console.log("skip:", db, e.message);
      }
    }
    await p.end();
  } catch (e) {
    console.error("ERR:", e.message);
    await p.end();
    process.exit(1);
  }
})();
