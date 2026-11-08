import type {
  PupilBehaviorProfile,
  PupilBehaviorAction,
  NotificationPreferences,
  NotificationClassSubscription,
} from '../types';

const API_BASE = '/api';
export const SESSION_EXPIRED_EVENT = 'smile-session-expired';


/**
 * The session token lives in an httpOnly, SameSite=Strict cookie set by the server.
 *
 * The previous implementation stored the JWT in `localStorage`, which meant any XSS
 * bug in the bundle could read and exfiltrate a valid session. `credentials:
 * 'include'` is required so the browser attaches the cookie.
 *
 * A Bearer header is still accepted by the server for non-browser clients (curl, the
 * backup tooling). There is deliberately no `?token=` query parameter: URLs leak into
 * access logs and browser history.
 */
const API_TIMEOUT_MS = 30_000;

async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      credentials: 'include',
      signal: options.signal ?? controller.signal,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers ?? {}),
      },
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new ApiError('Zeitüberschreitung bei der Anfrage. Bitte erneut versuchen.', 0, 'TIMEOUT');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  if (
    typeof window !== 'undefined' &&
    ((response.status === 401 && path !== '/auth/login') || response.status === 403)
  ) {
    const errorBody = await response.clone().json().catch(() => null) as { code?: unknown } | null;
    const invalidPassword = response.status === 401 && errorBody?.code === 'INVALID_CURRENT_PASSWORD';
    const resetRequired = response.status === 403 && errorBody?.code === 'PASSWORD_CHANGE_REQUIRED';
    if (!invalidPassword && (response.status === 401 || resetRequired)) {
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    }
  }
  return response;
}

/** Thrown for any non-2xx response so callers get the server's German error message. */
export class ApiError extends Error {
  status: number;
  code?: string;
  details: Record<string, unknown>;

  constructor(message: string, status: number, code?: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * `T` defaults to `any` so the loosely-typed domain payloads that already flow through
 * the components keep compiling. Call sites with a known shape can pass a type.
 */
async function unwrap<T = any>(res: Response): Promise<T> {
  if (res.ok) {
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  const err = await res.json().catch(() => ({}));
  const { error, code, ...details } = err as { error?: string; code?: string; [key: string]: unknown };
  const message = error || `Anfrage fehlgeschlagen (${res.status})`;
  throw new ApiError(message, res.status, code, details);
}



// --- Authentication ---------------------------------------------------------

export async function login(username: string, password: string) {
  const res = await apiFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  return unwrap(res);
}

export async function logout() {
  const res = await apiFetch('/auth/logout', { method: 'POST' });
  await res.text().catch(() => '');
}

export async function getMe() {
  const res = await apiFetch('/auth/me');
  return unwrap(res);
}

export async function changePassword(currentPassword: string, newPassword: string) {
  const res = await apiFetch('/auth/password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  return unwrap(res);
}

export async function requestPasswordReset(username: string, note?: string) {
  const res = await apiFetch('/auth/request-reset', {
    method: 'POST',
    body: JSON.stringify({ username, note }),
  });
  return unwrap(res);
}

export interface AdminUserAccount {
  id: string;
  username: string;
  role: 'admin' | 'head_teacher' | 'teacher' | 'pupil';
  teacherId: number | null;
  teacherShort: string | null;
  teacherName: string | null;
  mustChangePassword: boolean;
}

/** Account list for the administrator's credential handover. Never carries a hash. */
export async function getAdminUsers(): Promise<{ users: AdminUserAccount[] }> {
  const res = await apiFetch('/auth/users');
  return unwrap(res);
}

/**
 * Read-only "Ansehen als": swaps the session cookie for a 45-minute token that carries the
 * selected account's identity. The session guard blocks every write while it is active.
 */
export async function startViewAs(username: string) {
  const res = await apiFetch('/auth/view-as', {
    method: 'POST',
    body: JSON.stringify({ username }),
  });
  return unwrap(res);
}

/** Ends "Ansehen als" and restores the viewer's parked session. */
export async function stopViewAs() {
  const res = await apiFetch('/auth/view-as/stop', { method: 'POST' });
  return unwrap(res);
}

export interface ResetStartPassword {
  success: boolean;
  username: string;
  /** Shown exactly once by the server; the value is never stored or retrievable again. */
  temporaryPassword: string;
  mustChangePassword: boolean;
  notice: string;
}

export async function resetStartPassword(
  username: string,
  note?: string
): Promise<ResetStartPassword> {
  const res = await apiFetch('/auth/admin/temporary-password', {
    method: 'POST',
    body: JSON.stringify({ username, note }),
  });
  return unwrap(res);
}

// --- Classes ----------------------------------------------------------------

export async function getClasses() {
  const res = await apiFetch('/classes');
  return unwrap(res);
}

export async function getAllClasses() {
  const res = await apiFetch('/classes/all');
  return unwrap(res);
}

export async function getClassPupils(classId: number) {
  const res = await apiFetch(`/classes/${classId}/pupils`);
  return unwrap(res);
}

export async function getClassRubric(classId: number) {
  const res = await apiFetch(`/classes/${classId}/rubric`);
  return unwrap(res);
}

// --- Pupils -----------------------------------------------------------------

export async function addPupil(classId: number, fullName: string) {
  const res = await apiFetch('/pupils', {
    method: 'POST',
    body: JSON.stringify({ classId, fullName }),
  });
  return unwrap(res);
}

export async function updatePupil(id: number, fullName?: string, classId?: number) {
  const res = await apiFetch(`/pupils/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ fullName, classId }),
  });
  return unwrap(res);
}

export async function archivePupil(id: number) {
  const res = await apiFetch(`/pupils/${id}`, { method: 'DELETE' });
  return unwrap(res);
}

// --- Behaviour cards --------------------------------------------------------

export async function issueCard(
  pupilId: number,
  classId: number,
  cardType: 'green' | 'yellow' | 'red',
  note?: string
) {
  const res = await apiFetch('/cards', {
    method: 'POST',
    body: JSON.stringify({ pupilId, classId, cardType, note }),
  });
  return unwrap(res);
}

export async function revokeCard(cardId: string) {
  const res = await apiFetch(`/cards/${cardId}/revoke`, { method: 'POST' });
  return unwrap(res);
}

export async function getYellowCardAlerts() {
  const res = await apiFetch('/cards/alerts');
  return unwrap<any[]>(res);
}

export async function getClassCards(classId: number) {
  const res = await apiFetch(`/cards/class/${classId}`);
  return unwrap(res);
}

export async function getPupilCardHistory(pupilId: number) {
  const res = await apiFetch(`/cards/pupil/${pupilId}`);
  return unwrap(res);
}

// --- Conferences ------------------------------------------------------------

export async function lockVoting(classId: number, isLocked: boolean) {
  const res = await apiFetch(`/conferences/${classId}/lock`, {
    method: 'POST',
    body: JSON.stringify({ isLocked }),
  });
  return unwrap(res);
}

export async function getConferenceSummary(classId: number) {
  const res = await apiFetch(`/conferences/${classId}/summary`);
  return unwrap(res);
}

/**
 * Records a conference decision for one pupil.
 *
 * There is deliberately no `votesNo` parameter. It used to be a number the administrator
 * typed into a stepper, and the server turned it into "yes = everyone else in the class",
 * which counted teachers who never voted as agreeing. The tally is now derived from the
 * evaluations that were actually submitted; a confirmation records only the rank, who
 * confirmed it, and when.
 */
export async function voteConference(
  classId: number,
  pupilId: number,
  rank: string | undefined,
  overrideReason?: string,
  action: 'confirm' | 'unconfirm' = 'confirm'
) {
  const res = await apiFetch(`/conferences/${classId}/vote`, {
    method: 'POST',
    body: JSON.stringify({ pupilId, rank, overrideReason, action }),
  });
  return unwrap(res);
}

export async function voteAllConference(
  classId: number,
  items: Array<{ pupilId: number; rank: string }>
) {
  const res = await apiFetch(`/conferences/${classId}/vote-all`, {
    method: 'POST',
    body: JSON.stringify({ items }),
  });
  return unwrap(res);
}

// --- Evaluations ------------------------------------------------------------

export async function saveStatus(
  pupilId: number,
  classId: number,
  subjectCode: string,
  proposedStatus?: string,
  nextStep?: string,
  comment?: string
) {
  const res = await apiFetch('/evaluations/status', {
    method: 'POST',
    body: JSON.stringify({ pupilId, classId, subjectCode, proposedStatus, nextStep, comment }),
  });
  return unwrap(res);
}

/**
 * Autosave for the conference comment alone - no rank, no next step.
 *
 * `/evaluations/status` is the one write route that does not enforce
 * `config.submissionDeadline`, and that asymmetry is deliberate: a teacher may
 * still annotate a justification for the Notenkonferenz after the ratings are
 * closed. Every field beyond `comment` must gain a deadline check (roadmap
 * Phase D) - do not widen this payload.
 *
 * `keepalive` because this write can be the last thing a closing tab does: the
 * grid flushes the pending comment on unmount, and without it the browser may
 * abort the in-flight request together with the document. The body is a few
 * hundred bytes, well under keepalive's 64 KiB cap. Residual: a comment typed
 * inside the debounce window is still best-effort if the tab is closed outright,
 * because closing the page never runs a React cleanup.
 */
export async function saveEvaluationComment(
  pupilId: number, classId: number, subjectCode: string, comment: string,
): Promise<void> {
  const res = await apiFetch('/evaluations/status', {
    method: 'POST',
    body: JSON.stringify({ pupilId, classId, subjectCode, comment }),
    keepalive: true,
  });
  // unwrap, not a bare throw: the server's structured rejection (German
  // message + `code`, e.g. CLASS_CONFERENCE_LOCKED) must reach callers so the
  // teacher is told the class is locked instead of being asked to retry.
  return unwrap<void>(res);
}

export async function submitEvaluation(
  pupilId: number,
  classId: number,
  subjectCode: string,
  proposedStatus?: string,
  nextStep?: string,
  comment?: string
) {
  const res = await apiFetch('/evaluations/submit', {
    method: 'POST',
    body: JSON.stringify({ pupilId, classId, subjectCode, proposedStatus, nextStep, comment }),
  });
  return unwrap(res);
}

export async function reopenEvaluation(pupilId: number, classId: number, subjectCode: string) {
  const res = await apiFetch('/evaluations/reopen', {
    method: 'POST',
    body: JSON.stringify({ pupilId, classId, subjectCode }),
  });
  return unwrap(res);
}

/**
 * `criterionId` is still sent so an older server understands the payload, but the
 * server ignores it and derives the criterion from `itemKey` — accepting the
 * client-supplied value is what made ranks forgeable.
 */
export async function batchUpdateItems(
  pupilId: number,
  classId: number,
  subjectCode: string,
  items: Array<{ criterionId: string; itemKey: string; rating: string; version: number }>
) {
  const res = await apiFetch('/evaluations/batch-items', {
    method: 'POST',
    body: JSON.stringify({ pupilId, classId, subjectCode, items }),
  });
  return unwrap(res);
}

/**
 * Record a formal conference override for one pupil.
 *
 * The previous version posted to `/api/conferences/:classId/override`, an endpoint that
 * never existed — the call always returned 404 and the UI surfaced it as "Konferenzbeschluss
 * konnte nicht gespeichert werden". The real endpoint is `/vote`, which takes the
 * override reason as a parameter.
 */
export async function conferenceOverride(
  classId: number,
  pupilId: number,
  rank: string,
  overrideReason: string
) {
  const res = await apiFetch(`/conferences/${classId}/vote`, {
    method: 'POST',
    body: JSON.stringify({ pupilId, rank, overrideReason, action: 'confirm' }),
  });
  return unwrap(res);
}

/** Applies a default rating to a whole class. Now a real write, not a no-op broadcast. */
export async function applyClassDefault(classId: number, subjectCode: string, defaultRating = '+') {
  const res = await apiFetch('/evaluations/batch-default', {
    method: 'POST',
    body: JSON.stringify({ classId, subjectCode, defaultRating, forceOverwrite: true }),
  });
  return unwrap(res);
}

// --- Statistics & timetable -------------------------------------------------

export async function getStatistics(classId?: string | number) {
  const query = classId !== undefined ? `?classId=${classId}` : '';
  const res = await apiFetch(`/statistics/overview${query}`);
  return unwrap(res);
}

export async function getCurrentTimetable(day?: number, period?: number) {
  const params = new URLSearchParams();
  if (day !== undefined) params.append('day', String(day));
  if (period !== undefined) params.append('period', String(period));
  const query = params.toString() ? `?${params.toString()}` : '';
  const res = await apiFetch(`/timetable/current${query}`);
  return unwrap(res);
}

// --- Time-outs --------------------------------------------------------------

export async function sendToTimeout(
  pupilId: number,
  classId: number,
  taskAssignment: string,
  retroactive?: { date: string; period: number },
) {
  const res = await apiFetch('/timeouts', {
    method: 'POST',
    body: JSON.stringify({
      pupilId,
      classId,
      kind: 'timeout',
      taskAssignment,
      ...(retroactive ? { retroactive: true, retroactiveDate: retroactive.date, retroactivePeriod: retroactive.period } : {}),
    }),
  });
  return unwrap(res);
}

/**
 * Consequence-free Lernwerkstatt referral. It records a note-only Cool-Down card
 * and an active LW incident, but no red card and no rank/behaviour consequence.
 */
export async function sendToCooldown(pupilId: number, classId: number, note?: string) {
  const res = await apiFetch('/timeouts', {
    method: 'POST',
    body: JSON.stringify({ pupilId, classId, kind: 'cooldown', taskAssignment: note }),
  });
  return unwrap(res);
}

export async function getActiveTimeouts() {
  const res = await apiFetch('/timeouts/active');
  return unwrap(res);
}

export async function resolveTimeout(id: string, resolutionNote?: string) {
  const res = await apiFetch(`/timeouts/${id}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ resolutionNote }),
  });
  return unwrap(res);
}

export async function getTimeoutHistory() {
  const res = await apiFetch('/timeouts/history');
  return unwrap(res);
}

export async function getClassTimeouts(classId: number): Promise<any[]> {
  const res = await apiFetch('/timeouts/class/' + classId);
  return unwrap(res);
}

export async function getTimeoutEscalations() {
  const res = await apiFetch('/timeouts/escalations');
  return unwrap(res);
}

export async function acknowledgeTimeoutEscalation(
  pupilId: number,
  milestoneCount: number,
  notes?: string
) {
  const res = await apiFetch('/timeouts/escalations/acknowledge', {
    method: 'POST',
    body: JSON.stringify({ pupilId, milestoneCount, notes }),
  });
  return unwrap(res);
}

// --- Backup -----------------------------------------------------------------

export interface BackupFileItem {
  id: string;
  filename: string;
  timestamp: string;
  sizeBytes: number;
  sizeFormatted: string;
  isSafetySnapshot?: boolean;
  isEncrypted?: boolean;
}

export async function listBackups(): Promise<{ backups: BackupFileItem[] }> {
  const res = await apiFetch('/backup/list');
  return unwrap(res);
}

export async function restoreBackup(backupId: string): Promise<{
  success: boolean;
  message: string;
  preRestoreBackup?: string;
  restoredAt?: string;
}> {
  const res = await apiFetch('/backup/restore', {
    method: 'POST',
    body: JSON.stringify({ backupId }),
  });
  return unwrap(res);
}

/** Administrator only. Returns the complete data bundle including the full audit log. */
export async function exportBackup() {
  const res = await apiFetch('/backup/export-json');
  return unwrap(res);
}

export async function verifyBackup() {
  const res = await apiFetch('/backup/verify');
  return unwrap(res);
}

export async function getAuditLog(limit = 100, offset = 0, action?: string) {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (action) params.append('action', action);
  const res = await apiFetch(`/backup/audit-log?${params.toString()}`);
  return unwrap(res);
}

// --- Behavior Profile & Stages ----------------------------------------------

export async function getPupilBehaviorProfile(pupilId: number): Promise<PupilBehaviorProfile> {
  const res = await apiFetch(`/pupils/${pupilId}/behavior-profile`);
  return unwrap(res);
}

export async function savePupilBehaviorAction(
  pupilId: number,
  data: { stageLevel: number; stageTitle: string; notes?: string; status?: string }
): Promise<PupilBehaviorAction> {
  const res = await apiFetch(`/pupils/${pupilId}/behavior-actions`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
  return unwrap(res);
}

export async function deletePupilBehaviorAction(
  pupilId: number,
  actionId: string
): Promise<{ success: boolean }> {
  const res = await apiFetch(`/pupils/${pupilId}/behavior-actions/${actionId}`, {
    method: 'DELETE',
  });
  return unwrap(res);
}

// --- E-mail notification subscriptions --------------------------------------

export async function getNotificationPreferences(): Promise<NotificationPreferences> {
  const res = await apiFetch('/notifications/preferences');
  return unwrap(res);
}

export async function saveNotificationPreferences(data: {
  email: string;
  subscriptions: Array<
    Pick<NotificationClassSubscription, 'classId'> &
      Partial<
        Pick<
          NotificationClassSubscription,
          'green' | 'yellow' | 'red' | 'timeout' | 'cooldown' | 'weeklyDigest'
        >
      >
  >;
}): Promise<{ success: boolean }> {
  const res = await apiFetch('/notifications/preferences', {
    method: 'PUT',
    body: JSON.stringify(data),
  });
  return unwrap(res);
}

// --- WebUntis Integration ---------------------------------------------------

export interface WebUntisStatus {
  connected: boolean;
  environment: 'production' | 'playground';
  server: string;
  school: string;
  user: string;
  personId?: number;
  error?: string;
}

export interface WebUntisLessonItem {
  id: number;
  date: number;
  startTime: number;
  endTime: number;
  classes: Array<{ id: number; name: string }>;
  teachers: Array<{ id: number; name: string }>;
  subjects: Array<{ id: number; name: string }>;
  rooms: Array<{ id: number; name: string }>;
  lessonText?: string;
  status?: string;
  hasTeachingContent?: boolean;
  missingTeachingContent?: boolean;
  missingAttendance?: boolean;
  attendanceChecked?: boolean;
  absenceCount?: number;
}

export interface WebUntisAbsenceItem {
  id: number;
  studentId: number;
  studentName?: string;
  classId?: number;
  className?: string;
  startTime: string;
  endTime: string;
  startDate: string;
  endDate: string;
  reason?: string;
  excused: boolean;
  text?: string;
}

export interface WebUntisEventItem {
  id: number;
  studentId: number;
  studentName?: string;
  classId?: number;
  className?: string;
  categoryId: number;
  categoryName?: string;
  teacherId?: number;
  teacherName?: string;
  date: number;
  time: number;
  text: string;
  syncedFromSmile?: boolean;
}

export async function getWebUntisStatus(): Promise<WebUntisStatus> {
  const res = await apiFetch('/webuntis/status');
  return unwrap(res);
}

export async function setWebUntisEnvironment(environment: 'production' | 'playground'): Promise<WebUntisStatus> {
  const res = await apiFetch('/webuntis/environment', {
    method: 'POST',
    body: JSON.stringify({ environment }),
  });
  return unwrap(res);
}

export async function getWebUntisTimetable(
  dateOrParams?: { date?: string; startDate?: string; endDate?: string; classId?: number } | string,
  classId?: number,
): Promise<{ lessons: WebUntisLessonItem[] }> {
  const params = new URLSearchParams();
  if (typeof dateOrParams === 'string') {
    params.append('date', dateOrParams);
    if (classId) params.append('classId', String(classId));
  } else if (dateOrParams) {
    if (dateOrParams.startDate) params.append('startDate', dateOrParams.startDate);
    if (dateOrParams.endDate) params.append('endDate', dateOrParams.endDate);
    if (dateOrParams.date && !dateOrParams.startDate) params.append('date', dateOrParams.date);
    if (dateOrParams.classId) params.append('classId', String(dateOrParams.classId));
  }
  const qs = params.toString() ? '?' + params.toString() : '';
  const res = await apiFetch('/webuntis/timetable' + qs);
  return unwrap(res);
}

export async function saveWebUntisTeachingContent(lessonId: number, text: string): Promise<{ success: boolean }> {
  const res = await apiFetch('/webuntis/teaching-content', {
    method: 'POST',
    body: JSON.stringify({ lessonId, text }),
  });
  return unwrap(res);
}

export async function getWebUntisAbsences(date?: string, classId?: number): Promise<{ absences: WebUntisAbsenceItem[] }> {
  const params = new URLSearchParams();
  if (date) params.append('date', date);
  if (classId) params.append('classId', String(classId));
  const qs = params.toString() ? '?' + params.toString() : '';
  const res = await apiFetch('/webuntis/absences' + qs);
  return unwrap(res);
}

export async function getWebUntisEvents(classId?: number, categoryId?: number): Promise<{ events: WebUntisEventItem[] }> {
  const params = new URLSearchParams();
  if (classId) params.append('classId', String(classId));
  if (categoryId) params.append('categoryId', String(categoryId));
  const qs = params.toString() ? '?' + params.toString() : '';
  const res = await apiFetch('/webuntis/events' + qs);
  return unwrap(res);
}

export async function createWebUntisEvent(params: {
  studentId: number;
  classId: number;
  text: string;
  categoryId?: number;
  date?: string;
  time?: string;
}): Promise<{ success: boolean; eventId?: number }> {
  const res = await apiFetch('/webuntis/events', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  return unwrap(res);
}

export interface WebUntisAccountStatus {
  connected: boolean;
  account?: {
    username: string;
    teacherShort: string;
    school: string;
    server: string;
    authMethod: string;
    lastVerifiedAt: string;
  };
}

export async function getWebUntisAccount(): Promise<WebUntisAccountStatus> {
  const res = await apiFetch('/webuntis/account');
  return unwrap(res);
}

export async function connectWebUntisAccount(params: {
  username: string;
  secret: string;
  server?: string;
  school?: string;
  authMethod?: 'password' | 'loginkey';
}): Promise<{ success: boolean; teacherShort: string; teacherName?: string; personId?: number }> {
  const res = await apiFetch('/webuntis/account/connect', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  return unwrap(res);
}

export async function disconnectWebUntisAccount(): Promise<{ success: boolean }> {
  const res = await apiFetch('/webuntis/account/disconnect', {
    method: 'POST',
  });
  return unwrap(res);
}
