-- Add user_actions table for users to configure their own actions and optional monetary rates
CREATE TABLE "user_actions" (
  "id" TEXT PRIMARY KEY,
  "workspace_id" TEXT NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "hourly_rate" NUMERIC(12, 2)
);

-- Add hourly_rate to time_entries to lock in the rate derived from the user action
-- at the time the entry was recorded.
ALTER TABLE "time_entries" ADD COLUMN "hourly_rate" NUMERIC(12, 2);
