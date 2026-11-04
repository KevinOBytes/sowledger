-- Preserve the identity of verified unpaid invoices when the first failure
-- time is unknown. NULL is explicit missing evidence, never a fresh deadline.
-- Apply after 0012 through the reviewed maintenance runner; no row is rewritten.
ALTER TABLE sowledger.billing_payment_failures
  ALTER COLUMN first_failed_at DROP NOT NULL;
