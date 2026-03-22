require('dotenv').config({ path: '.env' });
const { neon } = require('@neondatabase/serverless');
const { drizzle } = require('drizzle-orm/neon-http');

async function test() {
  const sql = neon(process.env.DATABASE_URL);
  const db = drizzle(sql);
  try {
    await db.execute('select * from "does_not_exist"');
  } catch (e) {
    console.log("NAME:", e.name);
    console.log("MESSAGE:", e.message);
    console.log("CAUSE:", e.cause);
    console.log("DETAILS:", e.details);
  }
}
test();
