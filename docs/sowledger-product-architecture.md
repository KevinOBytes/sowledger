# SOWLedger Product Architecture

Date: 2026-05-30
Status: implementation-ready architecture plan

## Scope

SOWLedger.com is a high-assurance ClientOps workspace for consulting and advisory firms. Its source-of-truth boundary is the full engagement lifecycle:

1. Intake and scoping.
2. SOW approval.
3. Execution and time capture.
4. Change control.
5. Milestone and proof-pack sign-off.
6. Invoice settlement.
7. Accounting and artifact export.

The core product must not depend on third-party tools for the native system of record. External systems are pipes around the native primitives, not the authoritative database.

Explicit non-goal: MSP, legal-practice, and traditional PSA integrations stay deferred until customer evidence proves demand.

## Execution Plan

### Phase 1: Foundation and Tenant Boundary

- Build workspaces, users, memberships, roles, clients, contacts, projects, SOWs, SOW versions, milestones, tasks, rates, retainers, time entries, and artifacts.
- Enforce `workspace_id` on every tenant-owned table.
- Add row-level authorization in the service layer and database policy layer where supported.
- Add immutable audit logging with hash chaining.
- Add client portal identity records separate from internal users.

### Phase 2: Native Sign-Off Engine

- Implement one approval engine for SOW, change order, milestone, and proof pack approvals.
- Store approval requests and approval events append-only.
- Capture approver identity, timestamp, IP, user agent, request snapshot hash, signed payload hash, and final approval certificate hash.
- Prevent mutation of approved SOW versions, approved change requests, approved milestones, and final proof packs. Corrections create superseding versions or reversal events.

### Phase 3: Financial Core

- Implement invoice drafts generated from milestones, retainers, approved change requests, and billable time.
- Add Stripe invoice/payment sync.
- Add settled-invoice export to QuickBooks Online and Xero.
- Keep SOWLedger invoice state authoritative for workflow, while Stripe is authoritative for card/payment settlement and accounting systems are authoritative for ledger posting.

### Phase 4: Integration Pipes

- Add integration connection records, encrypted tokens, sync cursors, webhook subscriptions, sync run logs, and external object links.
- Start with HubSpot, Stripe, QuickBooks Online, Google Calendar, Google Drive, Slack, Zapier/Make, and outbound webhooks.
- Add Salesforce, DocuSign, Dropbox Sign, Asana, Jira, ClickUp, Linear, Microsoft Outlook, Teams, OneDrive, SharePoint, and Xero behind the same connector framework.

### Phase 5: OpenRouter AI Workflows

- Add an AI gateway service that calls OpenRouter through a fixed schema and model fallback policy.
- Store AI jobs, model/provider metadata, prompt fingerprints, token usage, source document references, validation failures, and human acceptance/rejection.
- Never write AI output directly into approved primitives. AI produces drafts that require human review before they affect SOW, milestone, task, change request, or proof-pack state.

## System Architecture and Integration Topology

### Core Services

- Web application: authenticated workspace UI, client portal, approval surfaces, billing and integration settings.
- Public API v1: scoped API keys, webhook management, read/write operational objects, no billing/admin/destructive workspace controls.
- Workflow service: approval state machine, invoice generation, task/milestone state transitions, change request impact workflow.
- Integration service: OAuth2, webhook verification, polling workers, provider rate-limit handling, idempotent upserts.
- AI gateway: OpenRouter orchestration, JSON Schema enforcement, fallback routing, token budgets, output validation.
- Artifact service: stores uploaded documents, generated proof packs, approval certificates, finalized SOW PDFs, and external storage export references.
- Audit service: append-only audit event writer with hash chaining.
- Delivery service: outbound webhooks, Zapier/Make deliveries, Slack/Teams approval routing, email notifications.
- Worker queue: durable jobs for provider sync, AI extraction, PDF parsing, proof-pack generation, export rendering, webhook retries, and ledger sync.

### Trust and Tenancy

- `workspace_id` is mandatory for every tenant-owned object.
- Internal team roles can manage operational state according to RBAC.
- Subcontractors can only see assigned projects, tasks, time entries, artifacts, and sign-off context needed for their assignments.
- External clients only see read-only portal objects and active sign-off requests for their client account.
- Provider tokens are encrypted at rest and never returned after creation.
- All webhooks use signature verification on ingress and HMAC signatures on egress.

### Native Primitives to External Systems

#### CRM Intake

HubSpot is Tier 1. Salesforce is Tier 2.

- Strategy: OAuth2 app installation per workspace.
- Ingress:
  - HubSpot webhooks for company, contact, deal, and ticket changes.
  - Salesforce Change Data Capture where available, otherwise scheduled polling by `SystemModstamp`.
- Native mapping:
  - CRM company -> `clients`.
  - CRM contact -> `client_contacts`.
  - CRM deal/opportunity -> `projects` and optional draft `sows`.
  - CRM line items -> draft `rates`, `retainers`, or `milestones` only after human review.
- Conflict policy: CRM data can update intake metadata, but cannot mutate approved SOW terms. Approved contract terms require a SOWLedger change request.

#### Formal E-Sign Legal

DocuSign and Dropbox Sign supplement native approval when legal threshold requires formal signatures.

- Strategy: OAuth2 where supported plus provider webhooks.
- Native mapping:
  - SOWLedger SOW version -> e-sign envelope/template.
  - Provider envelope signed event -> `approval_events` with `external_esign` metadata and certificate artifact.
  - Provider declined/voided events -> rejection/revocation approval events.
- Boundary: the native approval engine remains the workflow state machine. E-sign providers supply legal artifact evidence.

#### Project Imports

Asana, Jira, ClickUp, and Linear populate SOWLedger tasks.

- Strategy: OAuth2 connection plus webhook subscriptions where available; scheduled polling fallback with sync cursors.
- Native mapping:
  - Provider project/board/space -> optional `external_object_links` on `projects`.
  - Provider issue/task -> `tasks`.
  - Provider status -> `tasks.status` through workspace-configured mapping.
  - Provider assignee -> matched internal/subcontractor user where possible.
- Conflict policy:
  - One-way import is the default.
  - Bidirectional sync requires per-field ownership rules.
  - Approved milestone scope is not changed by imported tasks; unmatched task drift becomes a change request suggestion.

#### Calendar and Chat Ops

Google Calendar and Microsoft Outlook handle scheduling/time blocking. Slack and Teams handle notifications and approval routing.

- Calendar strategy:
  - OAuth2 connection.
  - Calendar watch subscriptions/webhooks where available.
  - Scheduled polling fallback by updated timestamp and sync token.
- Native mapping:
  - Calendar event -> planned work block or draft billable time.
  - SOWLedger milestone deadline -> optional calendar event.
  - Time block converted to billable time only after user confirmation or trusted automation rule.
- Chat strategy:
  - Slack app and Teams app with OAuth2/bot installation.
  - Notifications for approval requested, approved, rejected, overdue, change request drafted, invoice ready, payment received.
  - Approval links route to SOWLedger secure portal; no high-risk approval should happen only by chat reaction.

#### Payments and Settlement

Stripe handles payment processing and real-time payment state.

- Strategy:
  - Stripe Connect or workspace-level Stripe customer/account model depending on go-to-market.
  - Stripe webhooks verified by signing secret.
- Native pipeline:
  - Approved proof pack or milestone -> SOWLedger invoice draft.
  - Internal approval -> SOWLedger invoice issued.
  - SOWLedger invoice -> Stripe invoice/payment link.
  - Stripe `invoice.paid` or payment succeeded -> `payments` record and SOWLedger invoice `paid`.
  - Stripe payment failed/disputed/refunded -> payment event and invoice risk state.
- Boundary: SOWLedger is authoritative for invoice workflow and proof. Stripe is authoritative for payment settlement.

#### Accounting Ledger Sync

QuickBooks Online and Xero receive settled invoices.

- Strategy: OAuth2 connection plus idempotent push jobs and polling for external reconciliation status.
- Native mapping:
  - Paid SOWLedger invoice -> QuickBooks/Xero invoice or sales receipt.
  - SOWLedger client -> customer/contact.
  - SOWLedger invoice lines -> product/service line items mapped by workspace settings.
  - Stripe payment reference -> payment/transaction memo.
- Pipeline:
  - SOWLedger invoice approved -> optional draft accounting invoice.
  - Stripe paid -> push settled invoice/payment to ledger.
  - Accounting success -> `external_object_links` and `invoice.accounting_sync_status = synced`.
  - Accounting failure -> retryable integration sync run and operator-visible error.

#### Storage Exports

Google Drive, OneDrive, and SharePoint hold finalized artifacts.

- Strategy: OAuth2 connection, folder mapping, resumable uploads for large artifacts.
- Native mapping:
  - Final SOW PDF -> storage object.
  - Approval certificate -> storage object.
  - Proof pack -> storage folder/package.
  - Delivered artifact -> storage object with hash reference.
- Boundary: SOWLedger stores canonical metadata, hashes, approval snapshots, and external storage object references. External storage is a distribution/export channel.

#### Automation and Public Webhooks

Zapier, Make, and custom webhooks consume signed events.

- Strategy:
  - Outbound webhook endpoints configured per workspace.
  - HMAC SHA-256 signatures over `timestamp + "." + raw_body`.
  - Retry with exponential backoff and idempotency keys.
- Native event examples:
  - `sow.approved`
  - `change_request.approved`
  - `milestone.approved`
  - `proof_pack.approved`
  - `invoice.issued`
  - `invoice.paid`
  - `integration.sync_failed`

## Native Sign-Off State Machine

All approval types use the same state machine:

```text
draft -> requested -> viewed -> approved
                         |-> rejected
                         |-> expired
requested -> revoked
viewed -> revoked
approved -> superseded
```

Rules:

- `approved`, `rejected`, `expired`, `revoked`, and `superseded` are terminal for that approval request.
- A correction creates a new approval request linked by `supersedes_approval_request_id`.
- Approved objects cannot be edited in place.
- Every transition writes an `approval_events` row and an `audit_events` row.
- The approval certificate is a deterministic JSON document hashed and rendered to PDF after approval.

## Logical ERD

```text
workspaces
  -> users through memberships
  -> clients -> client_contacts
  -> projects -> sows -> sow_versions
  -> projects -> milestones -> tasks
  -> projects -> billable_time_entries
  -> sows -> change_requests
  -> milestones -> proof_packs -> artifacts
  -> approval_requests -> approval_events
  -> invoices -> invoice_lines -> payments
  -> integration_connections -> integration_sync_runs
  -> webhook_endpoints -> webhook_deliveries
  -> ai_jobs
  -> audit_events
```

## SQL DDL Schema

The schema below is PostgreSQL-oriented. It uses UUID primary keys, explicit workspace scoping, and append-only event tables.

```sql
create extension if not exists pgcrypto;

create type workspace_role as enum ('owner', 'admin', 'member', 'subcontractor', 'client');
create type project_status as enum ('draft', 'active', 'paused', 'completed', 'archived');
create type sow_status as enum ('draft', 'pending_approval', 'approved', 'superseded', 'voided');
create type billing_model as enum ('hourly', 'flat_fee', 'retainer', 'hybrid');
create type milestone_status as enum ('planned', 'in_progress', 'ready_for_approval', 'approved', 'rejected', 'invoiced');
create type task_status as enum ('backlog', 'ready', 'in_progress', 'blocked', 'done', 'canceled');
create type change_request_status as enum ('draft', 'pending_approval', 'approved', 'rejected', 'superseded', 'voided');
create type approval_subject_type as enum ('sow', 'change_request', 'milestone', 'proof_pack');
create type approval_status as enum ('draft', 'requested', 'viewed', 'approved', 'rejected', 'expired', 'revoked', 'superseded');
create type invoice_status as enum ('draft', 'issued', 'partially_paid', 'paid', 'voided', 'uncollectible', 'refunded');
create type payment_status as enum ('pending', 'succeeded', 'failed', 'refunded', 'disputed');
create type provider_type as enum (
  'hubspot', 'salesforce',
  'docusign', 'dropbox_sign',
  'asana', 'jira', 'clickup', 'linear',
  'google_calendar', 'microsoft_outlook',
  'slack', 'microsoft_teams',
  'stripe', 'quickbooks_online', 'xero',
  'google_drive', 'onedrive', 'sharepoint',
  'zapier', 'make', 'custom_webhook',
  'openrouter'
);

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  billing_email text,
  default_currency char(3) not null default 'USD',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table users (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table memberships (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role workspace_role not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create table clients (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  legal_name text,
  billing_email text,
  external_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name)
);

create table client_contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  email citext not null,
  name text,
  title text,
  portal_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  unique (workspace_id, client_id, email)
);

create table projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  client_id uuid not null references clients(id) on delete restrict,
  name text not null,
  status project_status not null default 'draft',
  starts_on date,
  ends_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, client_id, name)
);

create table sows (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  current_version_id uuid,
  status sow_status not null default 'draft',
  created_by_user_id uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table sow_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  sow_id uuid not null references sows(id) on delete cascade,
  version_number integer not null,
  title text not null,
  scope_summary text not null,
  full_text text,
  document_artifact_id uuid,
  billing_model billing_model not null,
  currency char(3) not null default 'USD',
  total_contract_value_cents bigint not null default 0,
  effective_on date,
  expires_on date,
  content_sha256 text not null,
  approved_at timestamptz,
  created_by_user_id uuid references users(id),
  created_at timestamptz not null default now(),
  unique (workspace_id, sow_id, version_number)
);

alter table sows
  add constraint sows_current_version_fk
  foreign key (current_version_id) references sow_versions(id);

create table rates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  sow_version_id uuid references sow_versions(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,
  name text not null,
  billing_model billing_model not null,
  amount_cents bigint not null,
  currency char(3) not null default 'USD',
  unit text not null default 'hour',
  starts_on date,
  ends_on date,
  check (amount_cents >= 0)
);

create table retainers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  sow_version_id uuid not null references sow_versions(id) on delete cascade,
  name text not null,
  amount_cents bigint not null,
  currency char(3) not null default 'USD',
  period text not null,
  included_hours numeric(10,2),
  starts_on date not null,
  ends_on date,
  check (amount_cents >= 0)
);

create table milestones (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  sow_version_id uuid references sow_versions(id) on delete restrict,
  name text not null,
  description text,
  status milestone_status not null default 'planned',
  due_on date,
  fee_amount_cents bigint,
  currency char(3) not null default 'USD',
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  milestone_id uuid references milestones(id) on delete set null,
  parent_task_id uuid references tasks(id) on delete cascade,
  title text not null,
  description text,
  status task_status not null default 'backlog',
  assigned_user_id uuid references users(id),
  billable boolean not null default true,
  estimated_hours numeric(10,2),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table billable_time_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  milestone_id uuid references milestones(id) on delete set null,
  task_id uuid references tasks(id) on delete set null,
  user_id uuid references users(id),
  rate_id uuid references rates(id),
  description text not null,
  started_at timestamptz,
  ended_at timestamptz,
  duration_minutes integer not null,
  billable boolean not null default true,
  approved_for_invoice boolean not null default false,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  check (duration_minutes > 0)
);

create table change_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  sow_id uuid not null references sows(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  title text not null,
  description text not null,
  status change_request_status not null default 'draft',
  impact_summary text,
  timeline_delta_days integer,
  budget_delta_cents bigint not null default 0,
  currency char(3) not null default 'USD',
  supersedes_change_request_id uuid references change_requests(id),
  created_by_user_id uuid references users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create table artifacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,
  client_id uuid references clients(id) on delete cascade,
  name text not null,
  content_type text not null,
  storage_key text not null,
  byte_size bigint not null,
  sha256 text not null,
  uploaded_by_user_id uuid references users(id),
  immutable boolean not null default false,
  created_at timestamptz not null default now(),
  unique (workspace_id, storage_key)
);

alter table sow_versions
  add constraint sow_versions_document_artifact_fk
  foreign key (document_artifact_id) references artifacts(id);

create table proof_packs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  milestone_id uuid references milestones(id) on delete set null,
  title text not null,
  summary text not null,
  status approval_status not null default 'draft',
  content_sha256 text,
  generated_by_ai_job_id uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create table proof_pack_artifacts (
  proof_pack_id uuid not null references proof_packs(id) on delete cascade,
  artifact_id uuid not null references artifacts(id) on delete restrict,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  primary key (proof_pack_id, artifact_id)
);

create table approval_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  subject_type approval_subject_type not null,
  subject_id uuid not null,
  status approval_status not null default 'draft',
  requested_by_user_id uuid references users(id),
  client_contact_id uuid references client_contacts(id),
  request_snapshot_sha256 text not null,
  certificate_artifact_id uuid references artifacts(id),
  supersedes_approval_request_id uuid references approval_requests(id),
  requested_at timestamptz,
  expires_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table approval_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  approval_request_id uuid not null references approval_requests(id) on delete cascade,
  from_status approval_status,
  to_status approval_status not null,
  actor_user_id uuid references users(id),
  client_contact_id uuid references client_contacts(id),
  ip_address inet,
  user_agent text,
  event_payload jsonb not null,
  event_sha256 text not null,
  created_at timestamptz not null default now()
);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  client_id uuid not null references clients(id) on delete restrict,
  project_id uuid references projects(id) on delete set null,
  invoice_number text not null,
  status invoice_status not null default 'draft',
  currency char(3) not null default 'USD',
  subtotal_cents bigint not null default 0,
  tax_cents bigint not null default 0,
  total_cents bigint not null default 0,
  stripe_invoice_id text,
  accounting_sync_status text not null default 'not_synced',
  issued_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, invoice_number)
);

create table invoice_lines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  invoice_id uuid not null references invoices(id) on delete cascade,
  milestone_id uuid references milestones(id),
  time_entry_id uuid references billable_time_entries(id),
  change_request_id uuid references change_requests(id),
  description text not null,
  quantity numeric(12,2) not null default 1,
  unit_amount_cents bigint not null,
  total_cents bigint not null,
  check (quantity > 0)
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  invoice_id uuid not null references invoices(id) on delete cascade,
  provider provider_type not null default 'stripe',
  provider_payment_id text,
  status payment_status not null,
  amount_cents bigint not null,
  currency char(3) not null default 'USD',
  received_at timestamptz,
  raw_event_sha256 text,
  created_at timestamptz not null default now()
);

create table integration_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  provider provider_type not null,
  display_name text not null,
  encrypted_credentials bytea,
  scopes text[] not null default '{}',
  status text not null default 'connected',
  sync_cursor jsonb not null default '{}'::jsonb,
  connected_by_user_id uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, provider, display_name)
);

create table external_object_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  connection_id uuid references integration_connections(id) on delete cascade,
  provider provider_type not null,
  native_table text not null,
  native_id uuid not null,
  external_object_type text not null,
  external_object_id text not null,
  external_url text,
  last_seen_at timestamptz,
  unique (workspace_id, provider, external_object_type, external_object_id)
);

create table integration_sync_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  connection_id uuid not null references integration_connections(id) on delete cascade,
  direction text not null,
  status text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  records_read integer not null default 0,
  records_written integer not null default 0,
  error_summary text
);

create table webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  url text not null,
  event_types text[] not null,
  secret_hash text not null,
  active boolean not null default true,
  created_by_user_id uuid references users(id),
  created_at timestamptz not null default now()
);

create table webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  endpoint_id uuid not null references webhook_endpoints(id) on delete cascade,
  event_type text not null,
  event_id uuid not null,
  idempotency_key text not null,
  payload_sha256 text not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  last_status_code integer,
  next_attempt_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  unique (endpoint_id, idempotency_key)
);

create table ai_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  job_type text not null,
  subject_table text,
  subject_id uuid,
  status text not null default 'queued',
  model_requested text,
  model_used text,
  provider_metadata jsonb not null default '{}'::jsonb,
  prompt_sha256 text not null,
  response_sha256 text,
  input_artifact_id uuid references artifacts(id),
  output_json jsonb,
  validation_errors jsonb not null default '[]'::jsonb,
  prompt_tokens integer,
  completion_tokens integer,
  created_by_user_id uuid references users(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table proof_packs
  add constraint proof_packs_generated_by_ai_fk
  foreign key (generated_by_ai_job_id) references ai_jobs(id);

create table audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  actor_user_id uuid references users(id),
  client_contact_id uuid references client_contacts(id),
  action text not null,
  entity_table text not null,
  entity_id uuid not null,
  before_json jsonb,
  after_json jsonb,
  metadata jsonb not null default '{}'::jsonb,
  prev_event_sha256 text,
  event_sha256 text not null,
  created_at timestamptz not null default now()
);

create index memberships_workspace_role_idx on memberships(workspace_id, role);
create index clients_workspace_idx on clients(workspace_id);
create index projects_workspace_client_idx on projects(workspace_id, client_id);
create index sows_workspace_project_idx on sows(workspace_id, project_id);
create index sow_versions_sow_idx on sow_versions(workspace_id, sow_id, version_number desc);
create index milestones_project_idx on milestones(workspace_id, project_id);
create index tasks_project_milestone_idx on tasks(workspace_id, project_id, milestone_id);
create index time_entries_project_idx on billable_time_entries(workspace_id, project_id, created_at desc);
create index approval_requests_subject_idx on approval_requests(workspace_id, subject_type, subject_id);
create index approval_events_request_idx on approval_events(approval_request_id, created_at);
create index invoices_workspace_client_idx on invoices(workspace_id, client_id, status);
create index external_links_native_idx on external_object_links(workspace_id, native_table, native_id);
create index audit_events_entity_idx on audit_events(workspace_id, entity_table, entity_id, created_at desc);
create index audit_events_hash_idx on audit_events(workspace_id, event_sha256);
```

## Webhook and AI Payload Specs

### OpenRouter Project Blueprint Request

OpenRouter exposes a Chat Completions endpoint at `POST https://openrouter.ai/api/v1/chat/completions`, uses bearer-token auth, supports `models` fallback arrays, and supports strict `response_format` JSON Schema on compatible models. The production implementation should use configurable model slugs because model names and availability change.

```json
{
  "endpoint": "POST https://openrouter.ai/api/v1/chat/completions",
  "headers": {
    "Authorization": "Bearer ${OPENROUTER_API_KEY}",
    "Content-Type": "application/json",
    "X-Title": "SOWLedger"
  },
  "body": {
    "models": [
      "~anthropic/claude-sonnet-latest",
      "~openai/gpt-latest"
    ],
    "provider": {
      "allow_fallbacks": true,
      "require_parameters": true,
      "data_collection": "deny"
    },
    "max_completion_tokens": 2800,
    "temperature": 0.2,
    "session_id": "sowledger_blueprint_ws_01_sowv_02",
    "metadata": {
      "workspace_id": "ws_01HZY...",
      "ai_job_id": "job_01J...",
      "workflow": "project_blueprint_generation"
    },
    "messages": [
      {
        "role": "system",
        "content": "You generate implementation blueprints for consulting SOWs. Return only JSON matching the provided schema. Do not invent client facts. Flag ambiguity in assumptions."
      },
      {
        "role": "user",
        "content": {
          "workspace_id": "ws_01HZY...",
          "project_id": "prj_01J...",
          "sow_version_id": "sowv_01J...",
          "client": {
            "name": "Acme Robotics",
            "industry": "IoT manufacturing"
          },
          "sow": {
            "title": "Firmware security assessment",
            "scope_summary": "Review firmware image, identify vulnerable components, produce remediation plan.",
            "milestones": [
              {
                "id": "ms_01",
                "name": "Firmware intake and inventory",
                "due_on": "2026-06-14",
                "acceptance_criteria": [
                  "Firmware image received",
                  "SBOM generated",
                  "Initial component risk list prepared"
                ]
              },
              {
                "id": "ms_02",
                "name": "Findings and proof pack",
                "due_on": "2026-06-28",
                "acceptance_criteria": [
                  "CVE findings reviewed",
                  "False positives removed",
                  "Client proof pack prepared"
                ]
              }
            ],
            "rates": [
              {
                "role": "Principal consultant",
                "amount_cents": 22500,
                "unit": "hour"
              }
            ],
            "constraints": [
              "No source code access",
              "Client requires approval before invoice"
            ]
          }
        }
      }
    ],
    "response_format": {
      "type": "json_schema",
      "json_schema": {
        "name": "sowledger_project_blueprint",
        "strict": true,
        "schema": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "project_id",
            "sow_version_id",
            "milestone_blueprints",
            "cross_milestone_risks",
            "assumptions",
            "requires_human_review"
          ],
          "properties": {
            "project_id": { "type": "string" },
            "sow_version_id": { "type": "string" },
            "requires_human_review": { "type": "boolean" },
            "assumptions": {
              "type": "array",
              "items": { "type": "string" }
            },
            "cross_milestone_risks": {
              "type": "array",
              "items": {
                "type": "object",
                "additionalProperties": false,
                "required": ["risk", "impact", "mitigation"],
                "properties": {
                  "risk": { "type": "string" },
                  "impact": { "type": "string" },
                  "mitigation": { "type": "string" }
                }
              }
            },
            "milestone_blueprints": {
              "type": "array",
              "items": {
                "type": "object",
                "additionalProperties": false,
                "required": [
                  "milestone_id",
                  "summary",
                  "tasks",
                  "acceptance_checklist"
                ],
                "properties": {
                  "milestone_id": { "type": "string" },
                  "summary": { "type": "string" },
                  "acceptance_checklist": {
                    "type": "array",
                    "items": { "type": "string" }
                  },
                  "tasks": {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "additionalProperties": false,
                      "required": [
                        "title",
                        "description",
                        "estimated_hours",
                        "billable",
                        "dependencies",
                        "subtasks"
                      ],
                      "properties": {
                        "title": { "type": "string" },
                        "description": { "type": "string" },
                        "estimated_hours": { "type": "number" },
                        "billable": { "type": "boolean" },
                        "dependencies": {
                          "type": "array",
                          "items": { "type": "string" }
                        },
                        "subtasks": {
                          "type": "array",
                          "items": {
                            "type": "object",
                            "additionalProperties": false,
                            "required": ["title", "description"],
                            "properties": {
                              "title": { "type": "string" },
                              "description": { "type": "string" }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
```

Implementation requirements:

- Persist this request as an `ai_jobs` row before calling OpenRouter.
- Validate the response against the same JSON Schema server-side.
- Store the raw response hash and validated JSON.
- Require human acceptance before creating `tasks`.
- On provider/model failure, let the OpenRouter `models` fallback run first, then retry the whole job only for retryable HTTP classes.
- Never include secrets, raw payment data, or unrelated client data in prompts.

### Milestone Approved Outbound Webhook

Delivery headers:

```http
X-SOWLedger-Event-Id: evt_01J9...
X-SOWLedger-Event-Type: milestone.approved
X-SOWLedger-Delivery-Id: whd_01J9...
X-SOWLedger-Timestamp: 2026-05-30T11:30:00Z
X-SOWLedger-Signature: v1=<hex-hmac-sha256>
Idempotency-Key: evt_01J9_milestone_approved_ms_01J9
Content-Type: application/json
```

Signature base string:

```text
${X-SOWLedger-Timestamp}.${raw_request_body}
```

Payload:

```json
{
  "event_id": "evt_01J9Z5G8Q2E9T8KJ9A4M4S6N1B",
  "event_type": "milestone.approved",
  "event_version": "2026-05-30",
  "occurred_at": "2026-05-30T11:30:00Z",
  "workspace": {
    "id": "ws_01HZY...",
    "slug": "acme-consulting"
  },
  "client": {
    "id": "cli_01J...",
    "name": "Acme Robotics"
  },
  "project": {
    "id": "prj_01J...",
    "name": "Firmware security assessment"
  },
  "sow": {
    "id": "sow_01J...",
    "version_id": "sowv_01J...",
    "version_number": 2,
    "content_sha256": "9f0f2d..."
  },
  "milestone": {
    "id": "ms_01J...",
    "name": "Findings and proof pack",
    "status": "approved",
    "due_on": "2026-06-28",
    "approved_at": "2026-05-30T11:29:44Z",
    "fee_amount_cents": 650000,
    "currency": "USD"
  },
  "approval": {
    "approval_request_id": "apr_01J...",
    "approval_event_id": "ape_01J...",
    "approval_type": "milestone",
    "approved_by": {
      "client_contact_id": "cc_01J...",
      "name": "Jordan Lee",
      "email": "jordan.lee@example.com"
    },
    "request_snapshot_sha256": "4c9d54...",
    "event_sha256": "0af991...",
    "certificate_artifact_id": "art_01J..."
  },
  "links": {
    "portal_url": "https://sowledger.com/client/approvals/apr_01J...",
    "api_url": "https://api.sowledger.com/v1/milestones/ms_01J...",
    "proof_pack_url": "https://sowledger.com/client/proof-packs/pp_01J..."
  },
  "webhook": {
    "endpoint_id": "wh_01J...",
    "delivery_id": "whd_01J...",
    "attempt": 1
  }
}
```

Delivery rules:

- Send only after the database transaction commits.
- Include stable `event_id` and idempotency key across retries.
- Retry on network errors and HTTP 408, 409, 425, 429, and 5xx.
- Do not retry on HTTP 2xx, 400, 401, 403, 404, or 410 unless endpoint settings explicitly allow it.
- Redact PII beyond the client contact needed to identify the approval.

## Security Controls

- RBAC:
  - `owner`: workspace billing, integrations, users, all projects.
  - `admin`: integrations and all operational records, no owner transfer.
  - `member`: assigned or workspace-visible operational records.
  - `subcontractor`: assigned projects/tasks/time/artifacts only.
  - `client`: portal-only read access plus explicit approval actions.
- Immutable records:
  - `approval_events`, `audit_events`, provider webhook raw hashes, approval certificates, finalized artifacts.
- Financial mutation controls:
  - All invoice/payment/accounting changes write audit events.
  - Stripe webhook events are verified and idempotent.
  - Accounting pushes are idempotent by invoice ID and external link.
- AI controls:
  - Prompt minimization.
  - Output schema validation.
  - Human approval before native state changes.
  - AI job audit trail and model metadata capture.
- Webhook controls:
  - Ingress provider signature verification.
  - Egress HMAC signing.
  - Replay protection by timestamp tolerance and idempotency key.

## Completion Checklist Against Prompt

- Native project and financial basics: covered by clients, projects, SOWs, milestones, tasks, rates, retainers, billable time, change requests, invoices, and payments.
- Native sign-off engine: covered by shared approval state machine, approval requests, approval events, certificate artifacts, and immutable audit events.
- CRM integrations: HubSpot Tier 1 and Salesforce Tier 2 strategies defined.
- E-sign integrations: DocuSign and Dropbox Sign strategies defined.
- Project imports: Asana, Jira, ClickUp, and Linear strategies defined.
- Calendar and chat: Google Calendar, Outlook, Slack, and Teams strategies defined.
- Payments: Stripe invoice/payment pipeline defined.
- Accounting: QuickBooks Online and Xero ledger sync defined.
- Storage exports: Google Drive, OneDrive, and SharePoint export strategy defined.
- Automation: Zapier, Make, and outbound public webhook delivery defined.
- Verticals deferred: MSP/legal/PSA non-goal explicitly stated.
- OpenRouter AI: ingestion, impact analysis, blueprinting, proof-pack generation, fallback routing, token limits, and JSON Schema enforcement covered.
- Granular RBAC: role boundaries defined.
- Immutable audit logging: audit event hash chain and append-only approval events defined.
- Required deliverables: topology, ERD SQL schema, OpenRouter payload, and milestone-approved webhook payload included.

## Source Notes

- OpenRouter Chat Completions endpoint and bearer-token auth: https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request
- OpenRouter model fallback via `models`: https://openrouter.ai/docs/guides/routing/model-fallbacks
- OpenRouter structured output with `response_format.type = json_schema`: https://openrouter.ai/docs/guides/features/structured-outputs
- OpenRouter provider routing fields including `require_parameters`, `allow_fallbacks`, and `data_collection`: https://openrouter.ai/docs/guides/routing/provider-selection
