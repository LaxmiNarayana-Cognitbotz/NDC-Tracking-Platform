-- Update F&F revision dates and set is_fnf_revision = FALSE (34 records)

-- 1. Preview records
SELECT 
    nr.person_number, nr.employee_name, nr.fnf_revision_start_date, nr.fnf_revision_completed_date,
    v.new_start_date, v.new_completed_date, (v.new_completed_date - v.new_start_date) AS tat_days, v.stage
FROM ndc_records nr
JOIN (
    VALUES
        (30144704, '2026-05-18'::date, '2026-05-28'::date, 'Date-2 -> Date-3', 'Jaswant Rajpurohit'),
        (30054376, '2026-05-28'::date, '2026-05-29'::date, 'Date-2 -> Date-3', 'Dhaval Patel'),
        (30138821, '2026-05-28'::date, '2026-05-29'::date, 'Date-2 -> Date-3', 'Rahul Kumar'),
        (30081658, '2026-05-28'::date, '2026-05-29'::date, 'Date-2 -> Date-3', 'Kiran Kumar Pilli'),
        (30135759, '2026-06-16'::date, '2026-06-20'::date, 'Date-2 -> Date-3', 'Pankaj Kumar'),
        (30182163, '2026-06-08'::date, '2026-06-16'::date, 'Date-2 -> Date-3', 'Yogesh Tripathi'),
        (30140549, '2026-05-18'::date, '2026-05-28'::date, 'Date-2 -> Date-3', 'Anand Jagdale'),
        (30124627, '2026-05-19'::date, '2026-06-07'::date, 'Date-2 -> Date-3', 'Nasib Singh Kadian'),
        (30045476, '2026-05-28'::date, '2026-05-29'::date, 'Date-2 -> Date-3', 'Mohammad Shamsuddin Ansari'),
        (30143990, '2026-05-28'::date, '2026-06-07'::date, 'Date-2 -> Date-3', 'Nitish Kumar'),
        (30073541, '2026-05-28'::date, '2026-06-07'::date, 'Date-2 -> Date-3', 'Karan Hingrajia'),
        (30143608, '2026-05-28'::date, '2026-06-07'::date, 'Date-2 -> Date-3', 'Romank Joshi'),
        (30020705, '2026-05-28'::date, '2026-06-07'::date, 'Date-2 -> Date-3', 'Deepsingh Rajput'),
        (30143609, '2026-05-28'::date, '2026-06-07'::date, 'Date-2 -> Date-3', 'G Pullapuraju'),
        (30151967, '2026-04-09'::date, '2026-05-08'::date, 'Date-2 -> Date-3', 'Rishabh Saxena'),
        (30133632, '2026-07-09'::date, '2026-07-18'::date, 'Date-1 -> Date-2 (D3 blank)', 'Munandra Singh'),
        (30125554, '2026-06-16'::date, '2026-06-20'::date, 'Date-1 -> Date-2 (D3 blank)', 'Hardik Vadiya'),
        (30067117, '2026-06-16'::date, '2026-06-20'::date, 'Date-1 -> Date-2 (D3 blank)', 'Aditya Gupta'),
        (30156114, '2026-06-16'::date, '2026-06-20'::date, 'Date-1 -> Date-2 (D3 blank)', 'Manas Vashistha'),
        (30115934, '2026-04-30'::date, '2026-05-29'::date, 'Date-1 -> Date-2 (D3 blank)', 'Fulchand Ukey'),
        (30017177, '2026-04-21'::date, '2026-06-07'::date, 'Date-1 -> Date-2 (D3 blank)', 'Ankit Velani'),
        (30142467, '2026-04-30'::date, '2026-05-28'::date, 'Date-1 -> Date-2 (D3 blank)', 'Abhishek Pradhan'),
        (30008672, '2026-04-23'::date, '2026-04-30'::date, 'Date-1 -> Date-2 (D3 blank)', 'Alap Patel'),
        (30115935, '2026-05-18'::date, '2026-06-07'::date, 'Date-1 -> Date-2 (D3 blank)', 'Kumararaja Sankaran'),
        (30144882, '2026-06-16'::date, '2026-06-20'::date, 'Date-1 -> Date-2 (D3 blank)', 'Sravan Kumar Vadlakonda'),
        (30148752, '2026-04-30'::date, '2026-05-29'::date, 'Date-1 -> Date-2 (D3 blank)', 'Debashis Mallick'),
        (30055113, '2026-03-23'::date, '2026-04-09'::date, 'Date-1 -> Date-2 (D3 blank)', 'Prakhar Bhardwaj'),
        (30166392, '2026-03-24'::date, '2026-04-09'::date, 'Date-1 -> Date-2 (D3 blank)', 'Ananth Raju'),
        (30141689, '2026-04-30'::date, '2026-05-28'::date, 'Date-1 -> Date-2 (D3 blank)', 'Anil Kumar'),
        (30018452, '2026-05-08'::date, '2026-05-28'::date, 'Date-1 -> Date-2 (D3 blank)', 'Maunank Darji'),
        (30140601, '2026-03-24'::date, '2026-04-02'::date, 'Date-1 -> Date-2 (D3 blank)', 'Mukul Dabhi'),
        (30128262, '2026-03-24'::date, '2026-04-09'::date, 'Date-1 -> Date-2 (D3 blank)', 'Pradyuman Singh'),
        (30132980, '2026-03-24'::date, '2026-04-09'::date, 'Date-1 -> Date-2 (D3 blank)', 'LokeshKumar Sharma'),
        (30119040, '2026-03-24'::date, '2026-04-02'::date, 'Date-1 -> Date-2 (D3 blank)', 'Kishan Meghnathi')
) AS v(person_number, new_start_date, new_completed_date, stage, expected_name)
    ON nr.person_number = v.person_number
ORDER BY nr.person_number;

-- 2. Apply update
BEGIN;

UPDATE ndc_records AS nr
SET 
    fnf_revision_start_date = v.new_start_date::date,
    fnf_revision_completed_date = v.new_completed_date::date,
    is_fnf_revision = FALSE
FROM (
    VALUES
        (30144704, '2026-05-18'::date, '2026-05-28'::date, 'Date-2 -> Date-3', 'Jaswant Rajpurohit'),
        (30054376, '2026-05-28'::date, '2026-05-29'::date, 'Date-2 -> Date-3', 'Dhaval Patel'),
        (30138821, '2026-05-28'::date, '2026-05-29'::date, 'Date-2 -> Date-3', 'Rahul Kumar'),
        (30081658, '2026-05-28'::date, '2026-05-29'::date, 'Date-2 -> Date-3', 'Kiran Kumar Pilli'),
        (30135759, '2026-06-16'::date, '2026-06-20'::date, 'Date-2 -> Date-3', 'Pankaj Kumar'),
        (30182163, '2026-06-08'::date, '2026-06-16'::date, 'Date-2 -> Date-3', 'Yogesh Tripathi'),
        (30140549, '2026-05-18'::date, '2026-05-28'::date, 'Date-2 -> Date-3', 'Anand Jagdale'),
        (30124627, '2026-05-19'::date, '2026-06-07'::date, 'Date-2 -> Date-3', 'Nasib Singh Kadian'),
        (30045476, '2026-05-28'::date, '2026-05-29'::date, 'Date-2 -> Date-3', 'Mohammad Shamsuddin Ansari'),
        (30143990, '2026-05-28'::date, '2026-06-07'::date, 'Date-2 -> Date-3', 'Nitish Kumar'),
        (30073541, '2026-05-28'::date, '2026-06-07'::date, 'Date-2 -> Date-3', 'Karan Hingrajia'),
        (30143608, '2026-05-28'::date, '2026-06-07'::date, 'Date-2 -> Date-3', 'Romank Joshi'),
        (30020705, '2026-05-28'::date, '2026-06-07'::date, 'Date-2 -> Date-3', 'Deepsingh Rajput'),
        (30143609, '2026-05-28'::date, '2026-06-07'::date, 'Date-2 -> Date-3', 'G Pullapuraju'),
        (30151967, '2026-04-09'::date, '2026-05-08'::date, 'Date-2 -> Date-3', 'Rishabh Saxena'),
        (30133632, '2026-07-09'::date, '2026-07-18'::date, 'Date-1 -> Date-2 (D3 blank)', 'Munandra Singh'),
        (30125554, '2026-06-16'::date, '2026-06-20'::date, 'Date-1 -> Date-2 (D3 blank)', 'Hardik Vadiya'),
        (30067117, '2026-06-16'::date, '2026-06-20'::date, 'Date-1 -> Date-2 (D3 blank)', 'Aditya Gupta'),
        (30156114, '2026-06-16'::date, '2026-06-20'::date, 'Date-1 -> Date-2 (D3 blank)', 'Manas Vashistha'),
        (30115934, '2026-04-30'::date, '2026-05-29'::date, 'Date-1 -> Date-2 (D3 blank)', 'Fulchand Ukey'),
        (30017177, '2026-04-21'::date, '2026-06-07'::date, 'Date-1 -> Date-2 (D3 blank)', 'Ankit Velani'),
        (30142467, '2026-04-30'::date, '2026-05-28'::date, 'Date-1 -> Date-2 (D3 blank)', 'Abhishek Pradhan'),
        (30008672, '2026-04-23'::date, '2026-04-30'::date, 'Date-1 -> Date-2 (D3 blank)', 'Alap Patel'),
        (30115935, '2026-05-18'::date, '2026-06-07'::date, 'Date-1 -> Date-2 (D3 blank)', 'Kumararaja Sankaran'),
        (30144882, '2026-06-16'::date, '2026-06-20'::date, 'Date-1 -> Date-2 (D3 blank)', 'Sravan Kumar Vadlakonda'),
        (30148752, '2026-04-30'::date, '2026-05-29'::date, 'Date-1 -> Date-2 (D3 blank)', 'Debashis Mallick'),
        (30055113, '2026-03-23'::date, '2026-04-09'::date, 'Date-1 -> Date-2 (D3 blank)', 'Prakhar Bhardwaj'),
        (30166392, '2026-03-24'::date, '2026-04-09'::date, 'Date-1 -> Date-2 (D3 blank)', 'Ananth Raju'),
        (30141689, '2026-04-30'::date, '2026-05-28'::date, 'Date-1 -> Date-2 (D3 blank)', 'Anil Kumar'),
        (30018452, '2026-05-08'::date, '2026-05-28'::date, 'Date-1 -> Date-2 (D3 blank)', 'Maunank Darji'),
        (30140601, '2026-03-24'::date, '2026-04-02'::date, 'Date-1 -> Date-2 (D3 blank)', 'Mukul Dabhi'),
        (30128262, '2026-03-24'::date, '2026-04-09'::date, 'Date-1 -> Date-2 (D3 blank)', 'Pradyuman Singh'),
        (30132980, '2026-03-24'::date, '2026-04-09'::date, 'Date-1 -> Date-2 (D3 blank)', 'LokeshKumar Sharma'),
        (30119040, '2026-03-24'::date, '2026-04-02'::date, 'Date-1 -> Date-2 (D3 blank)', 'Kishan Meghnathi')
) AS v(person_number, new_start_date, new_completed_date, stage, expected_name)
WHERE nr.person_number = v.person_number;

COMMIT;

-- 3. Verify TAT distribution
SELECT 
    COUNT(*) AS total_updated,
    COUNT(*) FILTER (WHERE (fnf_revision_completed_date - fnf_revision_start_date) <= 0) AS "On or due date",
    COUNT(*) FILTER (WHERE (fnf_revision_completed_date - fnf_revision_start_date) BETWEEN 1 AND 2) AS "Within 2 days",
    COUNT(*) FILTER (WHERE (fnf_revision_completed_date - fnf_revision_start_date) BETWEEN 3 AND 7) AS "3-7 days",
    COUNT(*) FILTER (WHERE (fnf_revision_completed_date - fnf_revision_start_date) BETWEEN 8 AND 30) AS "7-30 days",
    COUNT(*) FILTER (WHERE (fnf_revision_completed_date - fnf_revision_start_date) > 30) AS "More than 30 day"
FROM ndc_records
WHERE person_number IN (
    30144704, 30054376, 30138821, 30081658, 30135759, 30182163, 30140549, 30124627, 30045476, 30143990, 30073541, 30143608, 30020705, 30143609, 30151967, 30133632, 30125554, 30067117, 30156114, 30115934, 30017177, 30142467, 30008672, 30115935, 30144882, 30148752, 30055113, 30166392, 30141689, 30018452, 30140601, 30128262, 30132980, 30119040
);
