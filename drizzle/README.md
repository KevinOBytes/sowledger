# Legacy Drizzle history

`0000_romantic_queen_noir.sql` is historical Drizzle output from the original
single-database layout. It creates unqualified objects in PostgreSQL's `public`
schema and must not be replayed against the shared Neon database.

SOWLedger now owns the dedicated `sowledger` schema in the shared
`neon-violet-school` database. Use the reviewed SQL files under
`db/migrations/` with a direct `DATABASE_MIGRATION_URL`; the application role
must never create or alter tables during a request.
