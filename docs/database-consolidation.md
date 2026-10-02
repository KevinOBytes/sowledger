# SOWLedger database consolidation

SOWLedger is consolidated into the existing Neon resource used by the
other TKOResearch applications:

- Neon project: `plain-bonus-89174625`
- Database: `neondb`
- Shared resource: `neon-violet-school`
- SOWLedger schema: `sowledger`
- SOWLedger runtime role: `sowledger_app`
- SOWLedger migration journal: `sowledger_migrations.schema_migrations`

The schemas are an isolation boundary. The existing `public` schema belongs to
the existing application that owns it and must not be renamed, reset, or used
as a catch-all for SOWLedger. The `kevinbytes` and `vaultz` schemas remain
separate. A SOWLedger table must be created as `sowledger.<table>` and the
Drizzle schema in `lib/db/schema.ts` intentionally qualifies every table that
way.

## Runtime and maintenance roles

Production uses the pooled `DATABASE_URL` (or the equivalent
`NEON_DATABASE_URL`) with a restricted SOWLedger runtime role. That role
receives data access only on the `sowledger` schema and must not have
schema-creation or table-definition privileges. Authentication, page loads,
and API requests therefore never run DDL.

Migrations use `DATABASE_MIGRATION_URL` only from a maintenance shell. It must
be a direct, unpooled Neon connection for the owner/migration role, must never
be deployed to Vercel, and is guarded by a schema backup plus the
`sowledger_migrations` checksum journal. The migration runner deliberately does
not inspect or grant privileges on another application's schema.

## One-time transfer procedure

The live transfer is a maintenance operation and is not performed by a web
request. Before switching SOWLedger to the shared database:

1. Freeze SOWLedger writes and capture a schema-and-data backup of its current
   database. Keep the source available for rollback.
2. Rehearse the transfer in an isolated target using a source-to-
   `sowledger` schema mapping (including a `public` source, if that is where
   the current SOWLedger database stores its tables). Verify row counts,
   foreign keys, indexes, migration checksums, and representative
   login/workspace queries.
3. On the maintenance connection, create the `sowledger` and
   `sowledger_migrations` schemas, restore the rehearsed data, and grant the
   runtime role only the required `USAGE`/DML privileges on `sowledger`.
4. Run `npm run db:migrate:runtime` and then
   `npm run db:migrate:product` with `DATABASE_MIGRATION_URL` set. The runner
   writes a recoverable schema backup before each migration.
5. Point the deployment's runtime database variable at the restricted role on
   `neon-violet-school`, then smoke-test magic-link login, workspace reads and
   writes, timers, exports, and integrations.
6. Retain the old source until the smoke test and a rollback window have
   passed. Do not drop or truncate it as part of the application deploy.

No live source or migration credentials are stored in this repository, so the
one-time transfer was performed as an operator-run maintenance operation with
the target connection kept in a protected environment.

## Migration record — 2026-10-02

The one-time transfer was completed against the primary branch after a full
dry run on an isolated Neon branch:

- Source: archived Neon project `damp-art-13935129` (`timely`), database
  `neondb`, source `public` schema.
- Target: `plain-bonus-89174625` (`neon-violet-school`), primary branch,
  database `neondb`, schema `sowledger`.
- The dry-run restore matched all 42 source tables and exact row counts. The
  existing `public`, `kevinbytes`, and `vaultz` schema row-count fingerprints
  were unchanged. The temporary branch was deleted after the live checks.
- The live schema contains 42 tables, 466 columns, 102 indexes, and 67
  constraints. Both reviewed migrations are recorded in
  `sowledger_migrations.schema_migrations` with SHA-256 checksums.
- The restricted `sowledger_app` role has SOWLedger DML access, no `CREATE`
  privilege on `sowledger`, and was denied reads from the existing `public`
  schema.
- Vercel `DATABASE_URL` is configured as a sensitive pooled runtime variable
  for Production and Development. Preview intentionally remains unset until
  an isolated preview database is provisioned.
- Private pre-migration backups and post-migration evidence are retained at
  `/Users/kevo/Backups/sowledger-db-consolidation/2026-10-02/`. The archived
  source project remains untouched for the rollback window and is not deleted
  by this migration.

The application code still needs to be delivered in the normal release
workflow before claiming that the public deployment is using the new schema;
the database cutover itself and its permission checks are complete.
