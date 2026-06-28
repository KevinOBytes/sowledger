ALTER TABLE workspace_tags ALTER COLUMN is_billable_default SET DEFAULT false;

UPDATE workspace_tags
SET is_billable_default = false
WHERE is_billable_default = true;

DELETE FROM workspace_tags
WHERE lower(name) IN ('legacy e2e tag', 'scoped tag e2e');
