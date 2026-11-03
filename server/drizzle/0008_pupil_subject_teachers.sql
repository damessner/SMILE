-- Pupil-subject-teacher assignments for group/split subjects
-- (e.g. TUD, EH, DigGB, RKATH, RISLA, electives like ITAL).
-- Allows teachers to see only the pupils they teach in split subjects.

CREATE TABLE IF NOT EXISTS pupil_subject_teachers (
  id SERIAL PRIMARY KEY,
  pupil_id INTEGER NOT NULL REFERENCES pupils(id) ON DELETE CASCADE,
  class_id INTEGER NOT NULL REFERENCES school_classes(id) ON DELETE CASCADE,
  subject_code TEXT NOT NULL,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  group_name TEXT,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT pupil_subject_teachers_pupil_subject_teacher_uidx UNIQUE (pupil_id, subject_code, teacher_id)
);

CREATE INDEX IF NOT EXISTS pupil_subject_teachers_class_subject_idx
  ON pupil_subject_teachers (class_id, subject_code);

CREATE INDEX IF NOT EXISTS pupil_subject_teachers_teacher_class_idx
  ON pupil_subject_teachers (teacher_id, class_id);
