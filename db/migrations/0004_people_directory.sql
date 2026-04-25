CREATE TABLE IF NOT EXISTS organizations (
  id varchar(255) PRIMARY KEY,
  workspace_id varchar(255) NOT NULL,
  client_id varchar(255),
  name varchar(255) NOT NULL,
  type varchar(20) NOT NULL DEFAULT 'other',
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_people (
  id varchar(255) PRIMARY KEY,
  workspace_id varchar(255) NOT NULL,
  organization_id varchar(255) NOT NULL,
  linked_user_id varchar(255),
  display_name varchar(255),
  email varchar(255),
  title varchar(255),
  person_type varchar(20) NOT NULL DEFAULT 'contact',
  invitation_status varchar(20) NOT NULL DEFAULT 'none',
  invite_role varchar(20),
  status varchar(20) NOT NULL DEFAULT 'active',
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_organizations_workspace_id ON organizations (workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_people_workspace_id ON workspace_people (workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_people_org_id ON workspace_people (organization_id);
