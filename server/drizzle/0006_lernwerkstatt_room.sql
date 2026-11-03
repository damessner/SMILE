-- Lernwerkstatt pseudo-class row (id 999, name 'LW').
--
-- The Time-Out routes broadcast to WebSocket room 999 and the duty lookup in
-- lib/lw-duty.ts resolves authority against it, but no seed, import or earlier
-- migration ever created the school_classes row: SUBSCRIBE_CLASS for room 999 then
-- answers 'Klasse nicht gefunden', so every teacher's client shows a connection
-- error and the duty board never receives live updates.
--
-- Idempotent by construction: the SELECT guard means this is a no-op on databases
-- where the row was created by hand (any id or any grade), and it can never fail
-- the boot migration with a unique violation.
INSERT INTO school_classes (id, name, grade)
SELECT 999, 'LW', 0
WHERE NOT EXISTS (
  SELECT 1 FROM school_classes WHERE id = 999 OR name = 'LW'
);
