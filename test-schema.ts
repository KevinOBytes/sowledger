import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });
import { neon } from "@neondatabase/serverless";

async function main() {
  try {
    const sql = neon(process.env.DATABASE_URL!);
    console.log("Fetching users column schema...");
    const res = await sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'users';`;
    console.log("Columns:", res);

    console.log("Trying raw user select...");
    const rawUser = await sql`SELECT * FROM users WHERE email='kevin@kevinbytes.com';`;
    console.log("Raw user:", rawUser);
  } catch (error) {
    console.error("FULL ERROR:");
    console.error(error);
  }
}

main();
