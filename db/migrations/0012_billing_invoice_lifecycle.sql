-- Additive only. Do not infer billing history or safe invoice provenance from
-- legacy rows. Run via the reviewed maintenance runner, never request paths.
CREATE TABLE sowledger.workspace_billing_state (
  workspace_id varchar(255) PRIMARY KEY REFERENCES sowledger.workspaces(id) ON DELETE CASCADE,
  subscription_id varchar(255) NOT NULL,
  customer_id varchar(255) NOT NULL,
  plan varchar NOT NULL,
  status varchar(64) NOT NULL,
  ever_active_at timestamptz,
  latest_invoice_id varchar(255),
  grace_invoice_id varchar(255),
  grace_started_at timestamptz,
  grace_ends_at timestamptz,
  last_verified_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sowledger.billing_payment_failures (
  workspace_id varchar(255) NOT NULL REFERENCES sowledger.workspaces(id) ON DELETE CASCADE,
  invoice_id varchar(255) NOT NULL,
  subscription_id varchar(255) NOT NULL,
  first_failed_at timestamptz NOT NULL,
  resolved_at timestamptz,
  PRIMARY KEY (workspace_id, invoice_id)
);
-- The workspace PK and workspace-first composite PK above also serve lookups.

CREATE TABLE sowledger.stripe_webhook_events (
  event_id varchar(255) PRIMARY KEY,
  workspace_id varchar(255) NOT NULL REFERENCES sowledger.workspaces(id) ON DELETE CASCADE,
  subscription_id varchar(255) NOT NULL,
  event_type varchar(255) NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stripe_webhook_events_workspace_idx ON sowledger.stripe_webhook_events(workspace_id);

CREATE UNIQUE INDEX invoices_id_workspace_unique ON sowledger.invoices(id, workspace_id);
CREATE TABLE sowledger.invoice_lifecycle (
  invoice_id varchar(255) PRIMARY KEY,
  workspace_id varchar(255) NOT NULL REFERENCES sowledger.workspaces(id) ON DELETE CASCADE,
  original_time_entry_ids jsonb NOT NULL,
  invoice_fingerprint varchar(64) NOT NULL,
  created_by varchar(255) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  exposed_at timestamptz,
  exposure_reason text,
  voided_at timestamptz,
  voided_by varchar(255),
  void_reason text,
  release_audit_id varchar(255),
  CONSTRAINT invoice_lifecycle_invoice_workspace_fk FOREIGN KEY (invoice_id, workspace_id)
    REFERENCES sowledger.invoices(id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT invoice_lifecycle_release_complete
    CHECK (num_nonnulls(voided_at, voided_by, void_reason, release_audit_id) IN (0, 4))
);
CREATE INDEX invoice_lifecycle_workspace_idx ON sowledger.invoice_lifecycle(workspace_id);

-- Existing invoice status is varchar, not a PostgreSQL enum. The ORM union
-- admits 'void'; no old invoice or plan row is rewritten by this migration.
-- Existing schema USAGE remains unchanged. Never grant runtime schema CREATE
-- or privileges on the separate maintenance journal or foreign schemas.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  sowledger.workspace_billing_state,
  sowledger.billing_payment_failures,
  sowledger.stripe_webhook_events,
  sowledger.invoice_lifecycle
TO sowledger_app;
