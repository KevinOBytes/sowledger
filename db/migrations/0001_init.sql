CREATE TYPE entry_status AS ENUM ('draft', 'submitted', 'approved', 'invoiced');
CREATE TYPE project_billing_model AS ENUM ('hourly', 'fixed_fee', 'hybrid');

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  base_currency TEXT NOT NULL DEFAULT 'USD',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  name TEXT NOT NULL,
  billing_model project_billing_model NOT NULL DEFAULT 'hourly',
  fixed_fee_amount NUMERIC(12, 2),
  percent_complete INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD'
);

CREATE TABLE lock_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  locked_by_user_id UUID NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE time_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  user_id UUID NOT NULL,
  task_id TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  stopped_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  description TEXT,
  status entry_status NOT NULL DEFAULT 'draft',
  source TEXT NOT NULL DEFAULT 'web',
  geo_lat NUMERIC(9, 6),
  geo_lng NUMERIC(9, 6),
  collaborators JSONB NOT NULL DEFAULT '[]'::jsonb,
  expenses JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
) PARTITION BY HASH (workspace_id);

CREATE TABLE time_entries_p0 PARTITION OF time_entries FOR VALUES WITH (modulus 8, remainder 0);
CREATE TABLE time_entries_p1 PARTITION OF time_entries FOR VALUES WITH (modulus 8, remainder 1);
CREATE TABLE time_entries_p2 PARTITION OF time_entries FOR VALUES WITH (modulus 8, remainder 2);
CREATE TABLE time_entries_p3 PARTITION OF time_entries FOR VALUES WITH (modulus 8, remainder 3);
CREATE TABLE time_entries_p4 PARTITION OF time_entries FOR VALUES WITH (modulus 8, remainder 4);
CREATE TABLE time_entries_p5 PARTITION OF time_entries FOR VALUES WITH (modulus 8, remainder 5);
CREATE TABLE time_entries_p6 PARTITION OF time_entries FOR VALUES WITH (modulus 8, remainder 6);
CREATE TABLE time_entries_p7 PARTITION OF time_entries FOR VALUES WITH (modulus 8, remainder 7);

CREATE TABLE audit_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  time_entry_id UUID NOT NULL,
  actor_user_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  diff JSONB NOT NULL,
  signature TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE compliance_daily_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  user_id UUID NOT NULL,
  business_date TIMESTAMPTZ NOT NULL,
  submitted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT,
  due_date TIMESTAMPTZ,
  created_by_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  user_id UUID NOT NULL,
  role TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);

CREATE TABLE invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  email TEXT NOT NULL,
  inviter_user_id UUID NOT NULL,
  token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (token)
);

CREATE TABLE magic_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  token TEXT NOT NULL,
  purpose TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (token)
);

CREATE INDEX idx_time_entries_workspace_started_at ON time_entries (workspace_id, started_at DESC);
CREATE INDEX idx_audit_history_entry_id ON audit_history (time_entry_id, created_at DESC);
