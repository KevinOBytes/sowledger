require("dotenv").config({ path: ".env.local" });
const { drizzle } = require("drizzle-orm/neon-http");
const { neon } = require("@neondatabase/serverless");
const { projects, projectTasks } = require("./lib/db/schema");

async function run() {
  try {
    const sql = neon(process.env.DATABASE_URL);
    const db = drizzle(sql);
    
    console.log("querying projects...");
    const p = await db.select().from(projects).limit(5);
    console.log("projects:", p.length);
    
    console.log("querying tasks...");
    const t = await db.select().from(projectTasks).limit(5);
    console.log("tasks:", t.length);

  } catch (e) {
    console.error("ERROR:");
    console.error(e);
  }
}
run();
