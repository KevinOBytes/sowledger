import { pgSchema } from "drizzle-orm/pg-core";

// SOWLedger shares the existing neon-violet-school database with other
// applications. Never place its tables in the shared public schema.
export const DATABASE_SCHEMA = "sowledger";
export const sowledgerSchema = pgSchema(DATABASE_SCHEMA);
export const appTable = sowledgerSchema.table;
