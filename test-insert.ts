import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });
// import { neon } from "@neondatabase/serverless";
import { db } from "./lib/db/index";
import { users } from "./lib/db/schema";
import { eq } from "drizzle-orm";

async function main() {
  try {
    console.log("Checking if user exists...");
    let user = await db.select().from(users).where(eq(users.email, "kevin@kevinbytes.com"));
    
    if (user.length === 0) {
      console.log("Inserting user...");
      await db.insert(users).values({
        id: "test-uuid-1234",
        email: "kevin@kevinbytes.com",
        timezone: "UTC",
        preferredTags: [],
      });
      console.log("Inserted.");
    }
    
    console.log("Fetching user again via Drizzle...");
    user = await db.select().from(users).where(eq(users.email, "kevin@kevinbytes.com"));
    console.log("Fetched user:", user);
  } catch (error) {
    console.error("FULL ERROR:");
    console.error(error);
  }
}

main();
