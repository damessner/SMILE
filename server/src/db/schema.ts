import { pgTable, text, integer, boolean, timestamp, uuid, jsonb, numeric, serial, bigserial, index, uniqueIndex, primaryKey, pgSequence } from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

/**
 * Source of IDs for pupils created inside SMILE.
 *
 * Pupil IDs imported from WebUntis are the primary key, so the previous
 * `MAX(id) + 1` approach for new pupils was both racy under concurrent adds and
 * capable of colliding with a future WebUntis import. This sequence starts far above
 * any WebUntis person ID and hands out values atomically.
 */
export const pupilIdSequence = pgSequence('pupil_id_seq', { startWith: 9000000 });

// 1. Teachers
export const teachers = pgTable('teachers', {
  id: integer('id').primaryKey(), // WebUntis personId (e.g. 43, 293)
  shortName: text('short_name').notNull(), // e.g. "ZIA", "OFJ"
  fullName: text('full_name').notNull(), // e.g. "Alfred Zimmermann (ZIA)"
  active: boolean('active').default(true).notNull(),
});

// 2. School Classes
export const schoolClasses = pgTable('school_classes', {
  id: integer('id').primaryKey(), // WebUntis classId (e.g. 445 for 2F)
  name: text('name').notNull().unique(), // e.g. "2F"
  grade: integer('grade').notNull(), // 1, 2, 3, 4
  headTeacher1: text('head_teacher_1'),
  headTeacher2: text('head_teacher_2'),
});

// 3. Pupils
export const pupils = pgTable('pupils', {
  id: integer('id').primaryKey(), // WebUntis pupilId (e.g. 5997)
  classId: integer('class_id').references(() => schoolClasses.id).notNull(),
  fullName: text('full_name').notNull(), // e.g. "Alhardawi Hisham"
  isArchived: boolean('is_archived').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 4. Teaching Assignments (Class + Subject + Teacher)
export const teachingAssignments = pgTable('teaching_assignments', {
  id: serial('id').primaryKey(),
  teacherId: integer('teacher_id').references(() => teachers.id).notNull(),
  classId: integer('class_id').references(() => schoolClasses.id).notNull(),
  // Write canonical WebUntis codes — "D", "E", "M", "BO", "PH", "MUS", "TUD", ...
  // Legacy aliases ("SD", "SE", "SM", "DigGB", "R KATH") occur in the imported data and
  // stay readable because every lookup runs them through normalizeSubject(); do not
  // write one. They are here because the seed (db/seed.ts:170) stores the WebUntis
  // subject string verbatim as trimmed.toUpperCase() — that is deliberate, since
  // normalizeSubject() resolves those forms, so do not "fix" the seed to pre-normalize.
  // Invariant 1 in IF_YOU_ARE_AN_AI.md. No CHECK constraint enforces any of this, so
  // the callers are the only guard.
  subjectCode: text('subject_code').notNull(),
  subjectName: text('subject_name').notNull(),
}, (t) => ({
  // Every guard resolves class access through this lookup.
  teacherClassIdx: index('teaching_assignments_teacher_class_idx').on(t.teacherId, t.classId),
  classIdx: index('teaching_assignments_class_idx').on(t.classId),
}));

// 5. Users & Authentication (Unified RBAC)
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['admin', 'head_teacher', 'teacher', 'pupil'] }).default('teacher').notNull(),
  teacherId: integer('teacher_id').references(() => teachers.id),
  pupilId: integer('pupil_id').references(() => pupils.id),
  /**
   * Set on every freshly seeded account. Until the user picks their own password the
   * account may log in and read, but every mutating endpoint is rejected — this is what
   * stops the old shared default ("smile2026") from being a permanent school-wide secret.
  */
  mustChangePassword: boolean('must_change_password').default(true).notNull(),
  /**
   * When the current password was issued (seed, administrator-issued credential, or the
   * user's own change). A start password still awaiting its change expires 14 days after
   * this instant; see POST /api/auth/login.
   */
  passwordIssuedAt: timestamp('password_issued_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  /** Incremented on reset/change so all previously issued JWTs become stale. */
  sessionVersion: integer('session_version').default(0).notNull(),
});

/**
 * Password-reset requests. A user locks themselves out, the administrator records a
 * pending reset, and the account is only reactivated once a new password is set.
 */
export const passwordResets = pgTable('password_resets', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  requestedBy: integer('requested_by').references(() => teachers.id),
  requestedAt: timestamp('requested_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
  note: text('note'),
});

// 6. Assessment Rubrics & Criteria (Generic engine)
export const assessmentRubrics = pgTable('assessment_rubrics', {
  id: uuid('id').defaultRandom().primaryKey(),
  title: text('title').notNull(), // e.g. "SMILE Beobachtungsraster 2026/27"
  mode: text('mode', { enum: ['rubric_levels', 'percentage_grade'] }).default('rubric_levels').notNull(),
  gradeBoundaries: jsonb('grade_boundaries'), // e.g. {"meister": 80, "geselle": 50}
  isDefault: boolean('is_default').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const rubricCriteria = pgTable('rubric_criteria', {
  id: uuid('id').defaultRandom().primaryKey(),
  rubricId: uuid('rubric_id').references(() => assessmentRubrics.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(), // e.g. "Arbeitsorganisation"
  weightPercentage: numeric('weight_percentage', { precision: 5, scale: 2 }),
  position: integer('position').notNull(),
  items: jsonb('items').notNull(), // Array of 3 descriptors [{key: "org_1", desc: "..."}]
});

// 7. Observation Rounds (Zeiträume)
export const observationRounds = pgTable('observation_rounds', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(), // e.g. "Herbst / Semester 1 2026/27"
  isLocked: boolean('is_locked').default(false).notNull(),
  startsOn: timestamp('starts_on'),
  endsOn: timestamp('ends_on'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 8. Evaluations
export const evaluations = pgTable('evaluations', {
  id: uuid('id').defaultRandom().primaryKey(),
  roundId: uuid('round_id').references(() => observationRounds.id).notNull(),
  pupilId: integer('pupil_id').references(() => pupils.id).notNull(),
  classId: integer('class_id').references(() => schoolClasses.id).notNull(),
  // The column Invariant 1 in IF_YOU_ARE_AN_AI.md governs: canonical WebUntis codes
  // only ("D", "E", "M", "BO", "PH", ...), never a full German name or a legacy alias
  // ("SD", "SE", "SM"). There is no CHECK constraint, so every write path must validate
  // with normalizeKnownSubject() before inserting (all of them do — evaluations.ts
  // routes and the WS UPDATE_RATING path); normalizeSubject() stays a read-time
  // coercer for legacy rows and must never be persisted from a write.
  subjectCode: text('subject_code').notNull(),
  teacherId: integer('teacher_id').references(() => teachers.id).notNull(),
  proposedStatus: text('proposed_status'), // "Lehrling", "Geselle", "Meister"
  nextStep: text('next_step'), // "beibehalten", "Richtung Geselle", etc.
  comment: text('comment'),
  isSubmitted: boolean('is_submitted').default(false).notNull(),
  submittedAt: timestamp('submitted_at'),
  submittedByTeacherId: integer('submitted_by_teacher_id').references(() => teachers.id),
  isLocked: boolean('is_locked').default(false).notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  supersededBy: uuid('superseded_by'),
}, (t) => ({
  // One evaluation per (round, pupil, class, subject) — enforced so the
  // select-then-insert in the write paths cannot create duplicates.
  naturalKey: uniqueIndex('evaluations_round_pupil_class_subject_uidx')
    .on(t.roundId, t.pupilId, t.classId, t.subjectCode),
  classRoundIdx: index('evaluations_class_round_idx').on(t.classId, t.roundId),
}));

// 9. Evaluation Items (with OCC version and teacher attribution)
export const evaluationItems = pgTable('evaluation_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  evaluationId: uuid('evaluation_id').references(() => evaluations.id, { onDelete: 'cascade' }).notNull(),
  criterionId: uuid('criterion_id').references(() => rubricCriteria.id).notNull(),
  itemKey: text('item_key').notNull(), // e.g. "org_1", "org_2"
  rating: text('rating').notNull(), // "-", "o", "+", "++", "n.b."
  version: integer('version').default(1).notNull(), // OCC atomic check
  updatedByTeacherId: integer('updated_by_teacher_id').references(() => teachers.id),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  // Guarantees at most one rating per rubric item per evaluation. The WebSocket and
  // batch paths both do select-then-insert; without this a race creates duplicates
  // that silently skew the positive counts used for ranks.
  evalItemUidx: uniqueIndex('evaluation_items_evaluation_item_uidx').on(t.evaluationId, t.itemKey),
}));

// 10. Behavioral Cards
export const behaviorCards = pgTable('behavior_cards', {
  id: uuid('id').defaultRandom().primaryKey(),
  pupilId: integer('pupil_id').references(() => pupils.id).notNull(),
  classId: integer('class_id').references(() => schoolClasses.id).notNull(),
  teacherId: integer('teacher_id').references(() => teachers.id).notNull(),
  // 'cooldown' is a note-only Lernwerkstatt referral: it is recorded for the
  // pupil's history but carries no rank/card consequence and is excluded from
  // behaviour-stage and timeout-escalation counts.
  cardType: text('card_type', { enum: ['green', 'yellow', 'red', 'cooldown'] }).notNull(),
  note: text('note'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  revokedAt: timestamp('revoked_at'),
  revokedBy: integer('revoked_by').references(() => teachers.id),
}, (t) => ({
  // Drives the yellow-card escalation window and the pupil card history.
  pupilCreatedIdx: index('behavior_cards_pupil_created_idx').on(t.pupilId, t.createdAt),
  classActiveIdx: index('behavior_cards_class_active_idx').on(t.classId, t.revokedAt),
}));

// 11. Final Confirmed Ranks & Overrides
export const finalRanks = pgTable('final_ranks', {
  id: uuid('id').defaultRandom().primaryKey(),
  roundId: uuid('round_id').references(() => observationRounds.id).notNull(),
  pupilId: integer('pupil_id').references(() => pupils.id).notNull(),
  classId: integer('class_id').references(() => schoolClasses.id).notNull(),
  rank: text('rank').notNull(), // "Lehrling", "Geselle", "Meister"
  votesYes: integer('votes_yes'),
  votesNo: integer('votes_no').default(0),
  totalVoters: integer('total_voters'),
  algorithmTrace: jsonb('algorithm_trace'),
  confirmedAt: timestamp('confirmed_at'),
  confirmedBy: integer('confirmed_by').references(() => teachers.id),
  overriddenFrom: text('overridden_from'),
  overrideReason: text('override_reason'),
}, (t) => ({
  // One confirmed rank per (round, pupil) — the upsert in conferences.ts relies on it.
  roundPupilUidx: uniqueIndex('final_ranks_round_pupil_uidx').on(t.roundId, t.pupilId),
  classRoundIdx: index('final_ranks_class_round_idx').on(t.classId, t.roundId),
}));

// 12. Notification preferences and class subscriptions
export const notificationPreferences = pgTable('notification_preferences', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const notificationSubscriptions = pgTable('notification_subscriptions', {
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  classId: integer('class_id')
    .notNull()
    .references(() => schoolClasses.id, { onDelete: 'cascade' }),
  green: boolean('green').default(false).notNull(),
  yellow: boolean('yellow').default(false).notNull(),
  red: boolean('red').default(false).notNull(),
  timeout: boolean('timeout').default(false).notNull(),
  cooldown: boolean('cooldown').default(false).notNull(),
  weeklyDigest: boolean('weekly_digest').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.userId, t.classId] }),
  userIdx: index('notification_subscriptions_user_idx').on(t.userId),
  classIdx: index('notification_subscriptions_class_idx').on(t.classId),
}));

/** One row per sent weekly digest, so a restart cannot send the same week twice. */
export const notificationDigestLog = pgTable('notification_digest_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  classId: integer('class_id')
    .notNull()
    .references(() => schoolClasses.id, { onDelete: 'cascade' }),
  weekStart: text('week_start').notNull(), // ISO date, Monday
  sentAt: timestamp('sent_at').defaultNow().notNull(),
}, (t) => ({
  userClassWeekUidx: uniqueIndex('notification_digest_user_class_week_uidx').on(
    t.userId,
    t.classId,
    t.weekStart,
  ),
}));

// 13. Audit Logs
export const auditLogs = pgTable('audit_logs', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  actorId: integer('actor_id'),
  action: text('action').notNull(), // e.g. "UPDATE_RATING", "VOTING_LOCK", "CARD_REVOKE"
  entity: text('entity').notNull(),
  entityId: text('entity_id').notNull(),
  payload: jsonb('payload'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 13. Timetable Lessons
export const timetableLessons = pgTable('timetable_lessons', {
  id: serial('id').primaryKey(),
  lessonId: integer('lesson_id'),
  classId: integer('class_id').references(() => schoolClasses.id).notNull(),
  className: text('class_name').notNull(),
  teacherId: integer('teacher_id').references(() => teachers.id).notNull(),
  teacherShort: text('teacher_short').notNull(),
  subjectCode: text('subject_code').notNull(),
  subjectName: text('subject_name').notNull(),
  room: text('room'),
  dayOfWeek: integer('day_of_week').notNull(), // 1=Mo, 2=Di, 3=Mi, 4=Do, 5=Fr
  period: integer('period').notNull(), // 1..10
}, (t) => ({
  // The "which class am I teaching right now" lookup runs on every page load.
  teacherDayIdx: index('timetable_lessons_teacher_day_idx').on(t.teacherId, t.dayOfWeek),
}));

// 14. Timeout Incidents (Lernwerkstatt Time-Out)
export const timeoutIncidents = pgTable('timeout_incidents', {
  id: uuid('id').defaultRandom().primaryKey(),
  pupilId: integer('pupil_id').references(() => pupils.id).notNull(),
  classId: integer('class_id').references(() => schoolClasses.id).notNull(),
  sentByTeacherId: integer('sent_by_teacher_id').references(() => teachers.id).notNull(),
  sentAt: timestamp('sent_at').defaultNow().notNull(),
  /**
   * When the incident was entered. For a normal time-out this is the same moment
   * as `sentAt`; for a retroactive entry it is later than the lesson.
   */
  recordedAt: timestamp('recorded_at').defaultNow().notNull(),
  /** True when a teacher recorded a past lesson after the fact. */
  retroactive: boolean('retroactive').default(false).notNull(),
  taskAssignment: text('task_assignment').notNull(), // Arbeitsauftrag / Cool-Down-Notiz
  /** 'timeout' is the disciplinary red-card path; 'cooldown' has no consequence. */
  kind: text('kind', { enum: ['timeout', 'cooldown'] }).default('timeout').notNull(),
  status: text('status', { enum: ['active', 'resolved'] }).default('active').notNull(),
  resolvedAt: timestamp('resolved_at'),
  resolvedBy: integer('resolved_by').references(() => teachers.id),
  resolutionNote: text('resolution_note'),
  redCardId: uuid('red_card_id').references(() => behaviorCards.id),
  expiresAt: timestamp('expires_at'),
}, (t) => ({
  // Escalation counting and the LW live view.
  pupilIdx: index('timeout_incidents_pupil_idx').on(t.pupilId),
  statusSentIdx: index('timeout_incidents_status_sent_idx').on(t.status, t.sentAt),
  expiresAtActiveIdx: index('timeout_incidents_expires_at_active_idx')
    .on(t.expiresAt)
    .where(sql`status = 'active'`),
  retroactiveSlotUidx: uniqueIndex('timeout_incidents_retroactive_slot_uidx')
    .on(t.pupilId, t.classId, t.kind, t.sentAt)
    .where(sql`retroactive = true`),
}));

// 15. Timeout Escalations (Handled by SLC at 3, 6, 9... timeouts)
export const timeoutEscalations = pgTable('timeout_escalations', {
  id: uuid('id').defaultRandom().primaryKey(),
  pupilId: integer('pupil_id').references(() => pupils.id).notNull(),
  milestoneCount: integer('milestone_count').notNull(), // 3, 6, 9, 12...
  handledBy: integer('handled_by').references(() => teachers.id).notNull(),
  handledAt: timestamp('handled_at').defaultNow().notNull(),
  notes: text('notes'),
}, (t) => ({
  // Makes "has milestone N already been handled?" a single indexed lookup
  // instead of a full scan of the escalation table.
  pupilMilestoneUidx: uniqueIndex('timeout_escalations_pupil_milestone_uidx')
    .on(t.pupilId, t.milestoneCount),
}));

// 16. Pupil Behavior Stage Actions (Documented actions taken by teachers/staff)
export const pupilBehaviorActions = pgTable('pupil_behavior_actions', {
  id: uuid('id').defaultRandom().primaryKey(),
  pupilId: integer('pupil_id').references(() => pupils.id).notNull(),
  stageLevel: integer('stage_level').notNull(),
  stageTitle: text('stage_title').notNull(),
  status: text('status', { enum: ['pending', 'completed', 'acknowledged'] }).default('completed').notNull(),
  actionDate: timestamp('action_date').defaultNow().notNull(),
  teacherId: integer('teacher_id').references(() => teachers.id).notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  pupilStageIdx: index('pupil_behavior_actions_pupil_stage_idx').on(t.pupilId, t.stageLevel),
  actionDateIdx: index('pupil_behavior_actions_date_idx').on(t.actionDate),
}));

// 17. Class-Scoped Observation Round Locks
export const classRoundLocks = pgTable('class_round_locks', {
  id: uuid('id').defaultRandom().primaryKey(),
  roundId: uuid('round_id').references(() => observationRounds.id).notNull(),
  classId: integer('class_id').references(() => schoolClasses.id).notNull(),
  isLocked: boolean('is_locked').default(false).notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  naturalKey: uniqueIndex('class_round_locks_round_class_uidx').on(t.roundId, t.classId),
  classRoundIdx: index('class_round_locks_class_round_idx').on(t.classId, t.roundId),
}));

// 18. Pupil Subject Teacher Assignments (Individual student groups e.g. TUD, EH, DigGB, Rel, electives)
export const pupilSubjectTeachers = pgTable('pupil_subject_teachers', {
  id: serial('id').primaryKey(),
  pupilId: integer('pupil_id').references(() => pupils.id, { onDelete: 'cascade' }).notNull(),
  classId: integer('class_id').references(() => schoolClasses.id, { onDelete: 'cascade' }).notNull(),
  subjectCode: text('subject_code').notNull(),
  teacherId: integer('teacher_id').references(() => teachers.id, { onDelete: 'cascade' }).notNull(),
  groupName: text('group_name'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  pupilSubjectTeacherUidx: uniqueIndex('pupil_subject_teachers_pupil_subject_teacher_uidx')
    .on(t.pupilId, t.subjectCode, t.teacherId),
  classSubjectIdx: index('pupil_subject_teachers_class_subject_idx')
    .on(t.classId, t.subjectCode),
  teacherClassIdx: index('pupil_subject_teachers_teacher_class_idx')
    .on(t.teacherId, t.classId),
}));





// 19. User WebUntis Accounts (Personal Teacher Credentials for WebUntis)
export const userWebuntisAccounts = pgTable('user_webuntis_accounts', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  untisUsername: text('untis_username').notNull(),
  encryptedSecret: text('encrypted_secret').notNull(),
  secretIv: text('secret_iv').notNull(),
  secretAuthTag: text('secret_auth_tag').notNull(),
  school: text('school').notNull(),
  server: text('server').notNull(),
  personId: integer('person_id').notNull(),
  teacherShort: text('teacher_short').notNull(),
  authMethod: text('auth_method', { enum: ['password', 'loginkey'] }).default('password').notNull(),
  lastVerifiedAt: timestamp('last_verified_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  userIdx: index('user_webuntis_accounts_user_idx').on(t.userId),
}));

/**
 * 20. WebUntis Sync Outbox
 *
 * Class-register mirrors used to be dispatched with `setImmediate`: a single
 * transient network error silently dropped the write, and a process restart lost
 * every pending entry. The outbox makes the mirror durable and retryable.
 *
 * `payload` is the already-rendered Klassenbucheintrag (text, category, date), so
 * a retry cannot drift if SMILE's wording changes between attempts.
 */
export const webuntisSyncOutbox = pgTable('webuntis_sync_outbox', {
  id: uuid('id').defaultRandom().primaryKey(),
  /** Teacher whose linked WebUntis account is used. Null when the account was deleted. */
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  kind: text('kind', { enum: ['classreg_upsert', 'classreg_correction'] }).notNull(),
  /**
   * Stable key so a repeated POST (or a retried HTTP request) cannot create a
   * second row. Null for entries that have no natural identity.
   */
  idempotencyKey: text('idempotency_key').unique(),
  payload: jsonb('payload').notNull(),
  status: text('status', { enum: ['pending', 'processing', 'done', 'failed'] })
    .default('pending')
    .notNull(),
  attempts: integer('attempts').default(0).notNull(),
  maxAttempts: integer('max_attempts').default(8).notNull(),
  lastError: text('last_error'),
  nextAttemptAt: timestamp('next_attempt_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  pendingIdx: index('webuntis_sync_outbox_pending_idx').on(t.status, t.nextAttemptAt),
  userIdx: index('webuntis_sync_outbox_user_idx').on(t.userId),
}));
