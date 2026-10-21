-- Mark completed/closed records as email sent to avoid duplicate emails

-- 1. Preview records
SELECT 
    id, person_number, employee_name, is_fnf_completed, is_fnf_closed, fnf_completed_date
FROM ndc_records
WHERE (is_fnf_completed = TRUE OR is_fnf_closed = TRUE OR fnf_completed_date IS NOT NULL)
  AND is_fnf_email_sent = FALSE
ORDER BY id;

-- 2. Apply update
BEGIN;

UPDATE ndc_records
SET is_fnf_email_sent = TRUE
WHERE (is_fnf_completed = TRUE OR is_fnf_closed = TRUE OR fnf_completed_date IS NOT NULL)
  AND is_fnf_email_sent = FALSE;

-- Optional: also mark revision email sent
-- UPDATE ndc_records
-- SET is_fnf_revision_email_sent = TRUE
-- WHERE (is_fnf_revision = TRUE OR is_fnf_revision_email_sent = FALSE)
--   AND (is_fnf_completed = TRUE OR is_fnf_closed = TRUE OR fnf_completed_date IS NOT NULL);

COMMIT;

-- 3. Optional filters
-- By cutoff date:
-- UPDATE ndc_records SET is_fnf_email_sent = TRUE WHERE (is_fnf_completed = TRUE OR is_fnf_closed = TRUE OR fnf_completed_date IS NOT NULL) AND is_fnf_email_sent = FALSE AND (fnf_completed_date <= '2026-08-18'::date OR (fnf_completed_date IS NULL AND last_working_date <= '2026-08-18'::date));

-- By person numbers:
-- UPDATE ndc_records SET is_fnf_email_sent = TRUE WHERE person_number IN (30022156, 30130741) AND is_fnf_email_sent = FALSE;
