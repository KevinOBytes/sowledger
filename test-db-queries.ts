import { config } from "dotenv";
config({ path: ".env" });
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { projects, projectTasks, workspaceTags } from "./lib/db/schema";
import { desc } from "drizzle-orm";

async function run() {
  try {
    const sql = neon(process.env.DATABASE_URL!);
    const db = drizzle(sql);
    
    console.log("querying projects...");
    const p = await db.select().from(projects).limit(5);
    console.log("projects:", p.length);
    
    console.log("querying tasks...");
    const t = await db.select().from(projectTasks).limit(5);
    console.log("tasks:", t.length);

    console.log("querying tags...");
    const tags = await db.select().from(workspaceTags).orderBy(desc(workspaceTags.status), workspaceTags.name).limit(5);
    console.log("tags:", tags.length);

  } catch (e) {
    console.error("ERROR:");
    console.error(e);
  }
}
run();
