-- Read-only preflight for the administrator-actor change.
-- Run this against the live database BEFORE applying 0002_admin_actor_teacher.sql.
-- It changes nothing: every statement below is a SELECT.
--
-- What we need to know:
--   1. Does any evaluation carry the fabricated teacher_id = 0 sentinel?
--   2. Which teacher accounts have written ratings at all?
--   3. Is the reserved id range (9000000+) already occupied?

\echo '--- 1. Rows carrying the sentinel teacher_id = 0 (expect zero rows) ---'
SELECT 'evaluations' AS table_name, count(*) AS rows_with_sentinel
FROM evaluations WHERE teacher_id = 0
UNION ALL
SELECT 'evaluation_items.updated_by', count(*) FROM evaluation_items WHERE updated_by_teacher_id = 0
UNION ALL
SELECT 'final_ranks.confirmed_by', count(*) FROM final_ranks WHERE confirmed_by = 0
UNION ALL
SELECT 'behavior_cards.teacher_id', count(*) FROM behavior_cards WHERE teacher_id = 0
UNION ALL
SELECT 'pupil_behavior_actions', count(*) FROM pupil_behavior_actions WHERE teacher_id = 0;

\echo '--- 2. Orphaned foreign keys (should be empty) ---'
SELECT e.id, e.pupil_id, e.teacher_id
FROM evaluations e
LEFT JOIN teachers t ON t.id = e.teacher_id
WHERE t.id IS NULL;

\echo '--- 3. Which teacher ids have written ratings ---'
SELECT teacher_id, count(*) AS evaluations
FROM evaluations
GROUP BY teacher_id
ORDER BY evaluations DESC;

\echo '--- 4. Administrator accounts and their teacher link ---'
SELECT u.id, u.username, u.role, u.teacher_id, u.must_change_password
FROM users u
WHERE u.role = 'admin'
ORDER BY u.username;

\echo '--- 5. Highest real teacher id (must stay below 9000000) ---'
SELECT max(id) AS highest_teacher_id FROM teachers;

\echo '--- 6. Is the reserved range free? (expect zero rows) ---'
SELECT id, short_name, full_name, active FROM teachers WHERE id >= 9000000;

\echo '--- 7. Inactive teachers (placeholders look like this) ---'
SELECT id, short_name, full_name FROM teachers WHERE active = false ORDER BY id;