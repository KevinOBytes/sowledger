async function run() {
  try {
    const { config } = await import("dotenv");
    config({ path: ".env.local" });

    const { drizzle } = await import("drizzle-orm/neon-http");
    const { neon } = await import("@neondatabase/serverless");
    const { projects, projectTasks } = await import("./lib/db/schema");

    const sql = neon(process.env.DATABASE_URL);
    const db = drizzle(sql);

    console.log("querying projects...");
    const projectRows = await db.select().from(projects).limit(5);
    console.log("projects:", projectRows.length);

    console.log("querying tasks...");
    const taskRows = await db.select().from(projectTasks).limit(5);
    console.log("tasks:", taskRows.length);
  } catch (error) {
    console.error("ERROR:");
    console.error(error);
  }
}

void run();
