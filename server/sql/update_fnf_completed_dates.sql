-- Update fnf_completed_date and set is_fnf_completed = TRUE for 5 employees

-- 1. Preview current values
SELECT 
    person_number, employee_name, fnf_completed_date, is_fnf_completed
FROM ndc_records
WHERE person_number IN (30211073, 30215259, 30200484, 30170168, 30211499)
ORDER BY person_number;

-- 2. Apply update
BEGIN;

UPDATE ndc_records AS nr
SET 
    fnf_completed_date = v.new_completed_date::date,
    is_fnf_completed = TRUE
FROM (
    VALUES 
        (30211073, '2026-08-31'::date, 'Akash Raja'),
        (30215259, '2026-09-03'::date, 'Ravindra Singh'),
        (30200484, '2026-09-20'::date, 'Vijay Singh'),
        (30170168, '2026-08-14'::date, 'Shatrughan Kumar Singh'),
        (30211499, '2026-08-19'::date, 'Chandramani Pal')
) AS v(person_number, new_completed_date, employee_name)
WHERE nr.person_number = v.person_number;

COMMIT;

-- 3. Verify updated records
SELECT 
    person_number, employee_name, fnf_completed_date, is_fnf_completed
FROM ndc_records
WHERE person_number IN (30211073, 30215259, 30200484, 30170168, 30211499)
ORDER BY person_number;
