import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { db } from "./lib/db/index";
import { users } from "./lib/db/schema";
import { eq } from "drizzle-orm";

async function main() {
  try {
    console.log("Testing query on users table...");
    const res = await db.select().from(users).where(eq(users.email, "kevin@kevinbytes.com"));
    console.log("Result:", res);
  } catch (error) {
    console.error("FULL ERROR:");
    console.error(error);
    if (error instanceof Error) {
        console.error("Message:", error.message);
        console.error("Stack:", error.stack);
    }
  }
}

main();
