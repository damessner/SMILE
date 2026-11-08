import { eq } from 'drizzle-orm';
import { config, webuntisServiceAccountConfigured } from '../../config.js';
import { db } from '../../db/index.js';
import { userWebuntisAccounts } from '../../db/schema.js';
import { decryptSecret } from './crypto.js';
import { WebUntisError, asWebUntisError } from './errors.js';
import type {
  WebUntisEnv,
  WebUntisSession,
  WebUntisAbsence,
  WebUntisLesson,
  WebUntisClassregEvent,
  CreateEventParams,
  SaveLessonTopicParams,
} from './types.js';

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parse a `YYYY-MM-DD` string into a Date at **local noon**.
 *
 * `new Date('2026-11-05')` is parsed as UTC midnight, which is 01:00 in
 * Europe/Vienna. Any formatter that reads local hours then stamps 01:00 onto a
 * date-only value. Noon is unambiguous in every timezone the school could use
 * and survives DST transitions.
 */
export function parseDateOnly(value: string): Date | null {
  const match = DATE_ONLY.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }
  return parsed;
}

function dateIntFromDate(date: Date): number {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return Number(`${y}${m}${day}`);
}

/**
 * Convert to the WebUntis YYYYMMDD integer. Throws `RangeError` for anything
 * unparseable: silently sending `NaN` to WebUntis is how an invalid date becomes
 * an empty timetable.
 */
export function toUntisDateInt(date: Date | string | number): number {
  if (typeof date === 'number') {
    if (Number.isSafeInteger(date) && date >= 19000101 && date <= 29991231) return date;
    throw new RangeError('Ungültiges WebUntis-Datum.');
  }
  if (typeof date === 'string') {
    const dateOnly = parseDateOnly(date);
    if (dateOnly) return dateIntFromDate(dateOnly);
    const cleaned = date.trim().replace(/-/g, '').slice(0, 8);
    if (/^\d{8}$/.test(cleaned)) {
      const numeric = Number(cleaned);
      if (numeric >= 19000101 && numeric <= 29991231) return numeric;
    }
  }
  const parsed = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    throw new RangeError('Ungültiges WebUntis-Datum.');
  }
  return dateIntFromDate(parsed);
}

export function toUntisDateStr(date: Date | string | number): string {
  const intValue = toUntisDateInt(date);
  const s = String(intValue);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

function formatDateInt(date: Date | string | number): number {
  return toUntisDateInt(date);
}

function formatTimeInt(date: Date): number {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return Number(`${h}${m}`);
}

// ---------------------------------------------------------------------------
// Host allowlist
// ---------------------------------------------------------------------------

/**
 * Normalise and validate a WebUntis host.
 *
 * The connect endpoint accepted any host and the server dutifully opened an
 * HTTPS request to it, which made SMILE an SSRF probe and a credential-
 * submission relay. Only configured WebUntis hosts are accepted.
 */
export function normalizeWebUntisHost(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');

  if (!cleaned || !/^[a-z0-9.-]+$/.test(cleaned)) {
    throw new WebUntisError(
      'WEBUNTIS_HOST_NOT_ALLOWED',
      'Ungültiger WebUntis-Server. Bitte den Hostnamen ohne Protokoll, Port oder Pfad angeben.',
    );
  }

  const allowed = config.webuntis.allowedHosts.some(
    (entry) => cleaned === entry || cleaned.endsWith(`.${entry}`),
  );
  if (!allowed) {
    throw new WebUntisError(
      'WEBUNTIS_HOST_NOT_ALLOWED',
      `Der Server "${cleaned}" ist nicht als WebUntis-Host freigegeben.`,
    );
  }
  return cleaned;
}

// ---------------------------------------------------------------------------
// Middle management / Administrative slots (MM = Mittleres Management)
// These are non-teaching administrative blocks and should not be shown in the
// SMILE teaching timetable.
// ---------------------------------------------------------------------------

export function isMiddleManagement(
  lesson: {
    activityType?: string;
    sg?: string;
    su?: Array<{ id: number; name?: string }>;
    subjects?: Array<{ id: number; name?: string }>;
  },
  masterSubjects?: Map<number, string>,
): boolean {
  if (lesson.activityType && /^(MM|MITTLERES\s*MANAGEMENT)$/i.test(lesson.activityType.trim())) {
    return true;
  }
  if (lesson.sg && /^(MM|MITTLERES\s*MANAGEMENT)$/i.test(lesson.sg.trim())) {
    return true;
  }
  const subs = lesson.subjects || lesson.su || [];
  for (const s of subs) {
    const name = s.name || (masterSubjects && masterSubjects.get(s.id)) || '';
    if (/^(MM|MITTLERES\s*MANAGEMENT)$/i.test(name.trim())) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Duty / Supervision slots (SPR = Sprechstunde, BS = Pausenaufsicht)
// Teachers do not conduct instruction or take class attendance during duty slots.
// ---------------------------------------------------------------------------

const DUTY_LUNCH_REGEX = /^(MITTAGSBETREUUNG)$/i;
const DUTY_OFFICE_REGEX = /\b(SPR|SPRECHSTUNDE|OFFICE\s*HOURS?)\b/i;
const DUTY_SUPERVISION_REGEX = /\b(AUFSICHT|PAUSENAUFSICHT|BEREITSCHAFT)\b/i;

export function classifyDutySlot(input: {
  lstype?: string;
  activityType?: string;
  sg?: string;
  subjects?: Array<{ id: number; name?: string }>;
}): { isDuty: boolean; dutyType?: 'lunch' | 'office_hour' | 'supervision' | 'duty' } {
  if (input.lstype === 'bs') {
    return { isDuty: true, dutyType: 'supervision' };
  }
  if (input.lstype === 'oh') {
    return { isDuty: true, dutyType: 'office_hour' };
  }

  const candidates: string[] = [];
  if (input.activityType) candidates.push(input.activityType);
  if (input.sg) candidates.push(input.sg);
  if (input.subjects) {
    for (const s of input.subjects) {
      if (s.name) candidates.push(s.name);
    }
  }

  for (const text of candidates) {
    const trimmed = text.trim();
    if (DUTY_LUNCH_REGEX.test(trimmed)) {
      return { isDuty: true, dutyType: 'lunch' };
    }
    if (DUTY_OFFICE_REGEX.test(trimmed)) {
      return { isDuty: true, dutyType: 'office_hour' };
    }
    if (DUTY_SUPERVISION_REGEX.test(trimmed)) {
      return { isDuty: true, dutyType: 'supervision' };
    }
  }

  return { isDuty: false };
}

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(config.webuntis.timeoutMs),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new WebUntisError(
        'WEBUNTIS_UNAVAILABLE',
        `WebUntis hat nicht innerhalb von ${config.webuntis.timeoutMs} ms geantwortet.`,
        { cause: err },
      );
    }
    throw new WebUntisError('WEBUNTIS_UNAVAILABLE', 'WebUntis ist nicht erreichbar.', { cause: err });
  }
}

/** Extract Set-Cookie values. `getSetCookie()` handles Expires commas correctly. */
function readSetCookies(response: Response): string[] {
  const withGetSetCookie = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof withGetSetCookie.getSetCookie === 'function') {
    return withGetSetCookie.getSetCookie().map((cookie) => cookie.split(';')[0]!.trim()).filter(Boolean);
  }
  const raw = response.headers.get('set-cookie') ?? '';
  if (!raw) return [];
  // Legacy fallback: split only when the part after the comma looks like a new
  // cookie, not when it is the `Expires=Wed, 21 Oct ...` date.
  return raw
    .split(/,(?=\s*[A-Za-z0-9_.-]+=)/g)
    .map((cookie) => cookie.split(';')[0]!.trim())
    .filter(Boolean);
}

/**
 * A WebUntis form endpoint answers `200 OK` for a validation failure or an
 * expired session and renders the login/error page. Treating any 2xx as success
 * is how a rejected Klassenbucheintrag was recorded as written.
 */
function looksLikeWriteError(body: string): boolean {
  return (
    /name=["'](username|password)["']/i.test(body) ||
    /class=["'][^"']*(error|alert-danger)/i.test(body) ||
    /errorMessage|"errors"\s*:/i.test(body) ||
    // Deliberately no bare "ungültig": a successful response may echo the
    // teacher's own text, which could contain that word.
    /nicht berechtigt|keine Berechtigung/i.test(body)
  );
}

function describeRpcError(code: number | undefined, message: string): WebUntisError {
  if (code === -8520 || /not authenticated/i.test(message)) {
    return new WebUntisError('WEBUNTIS_AUTH_FAILED', 'WebUntis-Sitzung ist abgelaufen.', { retryable: true });
  }
  if (code === -8509 || code === -8507 || /no right|not allowed|permission/i.test(message)) {
    return new WebUntisError(
      'WEBUNTIS_PERMISSION_DENIED',
      'Das WebUntis-Konto hat keine Berechtigung für diese Abfrage.',
    );
  }
  return new WebUntisError('WEBUNTIS_UNAVAILABLE', `WebUntis-Fehler: ${message}`, { retryable: true });
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export interface WebUntisClientOptions {
  server?: string;
  school?: string;
  user?: string;
  password?: string;
  personId?: number;
  teacherShort?: string;
  environment?: WebUntisEnv;
  /** Marks a shared service account rather than a personal one. */
  serviceAccount?: boolean;
}

export interface WebUntisStatus {
  connected: boolean;
  environment: WebUntisEnv;
  server: string;
  school: string;
  account: 'personal' | 'service' | 'none';
  teacherShort?: string;
  error?: string;
}

export class WebUntisClient {
  private currentEnv: WebUntisEnv;
  private session: WebUntisSession | null = null;
  private csrfToken: string | null = null;
  private authPromise: Promise<WebUntisSession> | null = null;
  private customOptions?: WebUntisClientOptions;
  private masterDataPromise: Promise<{
    classes: Map<number, string>;
    subjects: Map<number, string>;
    rooms: Map<number, string>;
  }> | null = null;

  constructor(options?: WebUntisClientOptions) {
    this.customOptions = options;
    this.currentEnv = options?.environment || config.webuntis.environment || 'production';
  }

  public getEnvironment(): WebUntisEnv {
    return this.currentEnv;
  }

  public setEnvironment(env: WebUntisEnv): void {
    if (this.currentEnv !== env) {
      this.currentEnv = env;
      this.resetSession();
    }
  }

  private resetSession(): void {
    this.session = null;
    this.csrfToken = null;
    this.authPromise = null;
  }

  public getConfig(): {
    server: string;
    school: string;
    user: string;
    password: string;
    personId?: number;
    env: WebUntisEnv;
    serviceAccount: boolean;
  } {
    if (this.customOptions) {
      const isService = this.customOptions.serviceAccount === true;
      const isPlayground = this.currentEnv === 'playground';
      // The service account is the only client allowed to read its credentials
      // from deployment config. A personal client never falls back to them:
      // mixing identities silently was how a decrypt failure wrote entries as
      // `untis_monitor`.
      return {
        server:
          this.customOptions.server ||
          (isService && isPlayground
            ? config.webuntis.playgroundServer
            : config.webuntis.server),
        school:
          this.customOptions.school ||
          (isService && isPlayground
            ? config.webuntis.playgroundSchool
            : config.webuntis.school),
        user: this.customOptions.user || (isService ? config.webuntis.user : ''),
        password:
          this.customOptions.password ?? (isService ? config.webuntis.password : ''),
        personId: this.customOptions.personId,
        env: this.currentEnv,
        serviceAccount: isService,
      };
    }
    const isPlayground = this.currentEnv === 'playground';
    return {
      server: isPlayground ? config.webuntis.playgroundServer : config.webuntis.server,
      school: isPlayground ? config.webuntis.playgroundSchool : config.webuntis.school,
      user: config.webuntis.user,
      password: config.webuntis.password,
      env: this.currentEnv,
      serviceAccount: true,
    };
  }

  private getBaseUrl(): string {
    const cfg = this.getConfig();
    return `https://${cfg.server}/WebUntis`;
  }

  private getCookieHeader(): string {
    if (!this.session || !this.session.cookies.length) return '';
    return this.session.cookies.map((cookie) => cookie.split(';')[0]).join('; ');
  }

  private updateCookies(response: Response): void {
    if (!this.session) return;
    for (const nameVal of readSetCookies(response)) {
      const name = nameVal.split('=')[0];
      if (!name) continue;
      this.session.cookies = this.session.cookies.filter((cookie) => !cookie.startsWith(`${name}=`));
      this.session.cookies.push(nameVal);
    }
  }

  /**
   * Authenticate with WebUntis using JSON-RPC authenticate.
   * Concurrent callers share one in-flight login, so a burst of requests cannot
   * overwrite the cookie jar with a half-finished session.
   */
  public async authenticate(force = false): Promise<WebUntisSession> {
    if (!force && this.session && this.session.expiresAt.getTime() > Date.now() + 60_000) {
      return this.session;
    }
    if (this.authPromise) return this.authPromise;

    this.authPromise = this.performAuthentication().finally(() => {
      this.authPromise = null;
    });
    return this.authPromise;
  }

  private async performAuthentication(): Promise<WebUntisSession> {
    const cfg = this.getConfig();
    if (!cfg.user || !cfg.password) {
      throw new WebUntisError(
        'WEBUNTIS_NOT_CONNECTED',
        'Für dieses Konto ist kein WebUntis-Zugang hinterlegt.',
      );
    }

    this.csrfToken = null;
    const rpcUrl = `${this.getBaseUrl()}/jsonrpc.do?school=${encodeURIComponent(cfg.school)}`;

    const res = await fetchWithTimeout(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: `auth_${Date.now()}`,
        method: 'authenticate',
        params: {
          user: cfg.user,
          password: cfg.password,
          client: 'SMILE_Teacher_Platform',
        },
        jsonrpc: '2.0',
      }),
    });

    if (!res.ok) {
      throw new WebUntisError('WEBUNTIS_AUTH_FAILED', `WebUntis-Anmeldung fehlgeschlagen (HTTP ${res.status}).`, {
        retryable: res.status >= 500,
      });
    }

    const data = (await res.json().catch(() => null)) as {
      result?: { sessionId: string; personType: number; personId: number };
      error?: { code: number; message: string };
    } | null;

    if (!data || data.error || !data.result) {
      throw new WebUntisError(
        'WEBUNTIS_AUTH_FAILED',
        `WebUntis-Anmeldung abgelehnt: ${data?.error?.message || 'Unbekannter Fehler'}`,
      );
    }

    const cookies = readSetCookies(res);
    if (!cookies.some((cookie) => cookie.startsWith('schoolname='))) {
      cookies.push(`schoolname="${cfg.school}"`);
    }

    const session: WebUntisSession = {
      sessionId: data.result.sessionId,
      cookies,
      personId: data.result.personId,
      personType: data.result.personType,
      lastLogin: new Date(),
      // WebUntis expires idle sessions server-side; this is only a local hint and
      // the -8520 retry below remains authoritative.
      expiresAt: new Date(Date.now() + 25 * 60 * 1000),
    };
    this.session = session;

    // Optional Playwright-style bearer token used by some REST endpoints.
    try {
      const tokenRes = await fetchWithTimeout(`${this.getBaseUrl()}/api/token/new`, {
        headers: { Cookie: this.getCookieHeader() },
      });
      if (tokenRes.ok) {
        const text = (await tokenRes.text()).trim();
        if (text && !text.startsWith('<')) this.session.token = text;
      }
      this.updateCookies(tokenRes);
    } catch {
      // Optional; cookies remain authoritative.
    }

    return session;
  }

  public async rpc<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    await this.authenticate();
    const cfg = this.getConfig();
    const rpcUrl = `${this.getBaseUrl()}/jsonrpc.do?school=${encodeURIComponent(cfg.school)}`;
    const body = JSON.stringify({
      id: `req_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      method,
      params,
      jsonrpc: '2.0',
    });

    const call = async (): Promise<{ result?: T; error?: { code: number; message: string } }> => {
      const res = await fetchWithTimeout(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: this.getCookieHeader() },
        body,
      });
      if (!res.ok) {
        throw new WebUntisError('WEBUNTIS_UNAVAILABLE', `WebUntis antwortete mit HTTP ${res.status}.`, {
          retryable: res.status >= 500 || res.status === 429,
        });
      }
      return (await res.json().catch(() => ({}))) as {
        result?: T;
        error?: { code: number; message: string };
      };
    };

    let data = await call();

    if (data.error && (data.error.code === -8520 || /not authenticated/i.test(data.error.message))) {
      await this.authenticate(true);
      data = await call();
    }

    if (data.error) {
      throw describeRpcError(data.error.code, data.error.message);
    }

    return data.result as T;
  }

  private async getCsrfToken(): Promise<string> {
    if (this.csrfToken) return this.csrfToken;
    await this.authenticate();
    try {
      const cfgRes = await fetchWithTimeout(`${this.getBaseUrl()}/api/app/config`, {
        headers: { Cookie: this.getCookieHeader(), 'X-Requested-With': 'XMLHttpRequest' },
      });
      if (cfgRes.ok) {
        const json = (await cfgRes.json()) as { data?: { csrfToken?: string } };
        if (json?.data?.csrfToken) {
          this.csrfToken = json.data.csrfToken;
          return this.csrfToken;
        }
      }
    } catch {
      // Fall through to the dialog scan.
    }

    try {
      const dlgRes = await fetchWithTimeout(`${this.getBaseUrl()}/classregeventdlg.do`, {
        headers: { Cookie: this.getCookieHeader() },
      });
      if (dlgRes.ok) {
        const html = await dlgRes.text();
        const match = html.match(/name="_csrf"\s+value="([^"]+)"/i) || html.match(/"csrfToken":\s*"([^"]+)"/i);
        if (match?.[1]) {
          this.csrfToken = match[1];
          return this.csrfToken;
        }
      }
    } catch {
      // No token available; the write attempt below will report failure.
    }

    return '';
  }

  public async logout(): Promise<void> {
    if (!this.session) return;
    const cfg = this.getConfig();
    const rpcUrl = `${this.getBaseUrl()}/jsonrpc.do?school=${encodeURIComponent(cfg.school)}`;
    try {
      await fetchWithTimeout(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: this.getCookieHeader() },
        body: JSON.stringify({ id: `logout_${Date.now()}`, method: 'logout', params: {}, jsonrpc: '2.0' }),
      });
    } catch {
      // Best effort: the local session is discarded either way.
    } finally {
      this.resetSession();
    }
  }

  /**
   * Health/status. Deliberately does not disclose the configured username or
   * person id: `/status` is readable by every authenticated user.
   */
  public async getStatus(): Promise<WebUntisStatus> {
    const cfg = this.getConfig();
    const account: WebUntisStatus['account'] = this.customOptions
      ? cfg.serviceAccount
        ? 'service'
        : 'personal'
      : 'service';
    try {
      await this.authenticate();
      return {
        connected: true,
        environment: this.currentEnv,
        server: cfg.server,
        school: cfg.school,
        account,
        teacherShort: this.customOptions?.teacherShort,
      };
    } catch (err) {
      return {
        connected: false,
        environment: this.currentEnv,
        server: cfg.server,
        school: cfg.school,
        account,
        teacherShort: this.customOptions?.teacherShort,
        error: asWebUntisError(err).message,
      };
    }
  }

  private masterDataCache: {
    classes: Map<number, string>;
    subjects: Map<number, string>;
    rooms: Map<number, string>;
    timestamp: number;
  } | null = null;

  public async getMasterData(): Promise<{
    classes: Map<number, string>;
    subjects: Map<number, string>;
    rooms: Map<number, string>;
  }> {
    if (this.masterDataCache && Date.now() - this.masterDataCache.timestamp < 30 * 60 * 1000) {
      return this.masterDataCache;
    }
    if (this.masterDataPromise) return this.masterDataPromise;

    this.masterDataPromise = this.loadMasterData().finally(() => {
      this.masterDataPromise = null;
    });
    return this.masterDataPromise;
  }

  private async loadMasterData(): Promise<{
    classes: Map<number, string>;
    subjects: Map<number, string>;
    rooms: Map<number, string>;
  }> {
    const classesMap = new Map<number, string>();
    const subjectsMap = new Map<number, string>();
    const roomsMap = new Map<number, string>();

    const [kRes, sRes, rRes] = await Promise.allSettled([
      this.rpc<Array<{ id: number; name: string }>>('getKlassen'),
      this.rpc<Array<{ id: number; name: string }>>('getSubjects'),
      this.rpc<Array<{ id: number; name: string }>>('getRooms'),
    ]);

    let anySuccess = false;
    if (kRes.status === 'fulfilled' && Array.isArray(kRes.value)) {
      anySuccess = true;
      for (const k of kRes.value) classesMap.set(k.id, k.name);
    }
    if (sRes.status === 'fulfilled' && Array.isArray(sRes.value)) {
      anySuccess = true;
      for (const s of sRes.value) subjectsMap.set(s.id, s.name);
    }
    if (rRes.status === 'fulfilled' && Array.isArray(rRes.value)) {
      anySuccess = true;
      for (const r of rRes.value) roomsMap.set(r.id, r.name);
    }

    const result = { classes: classesMap, subjects: subjectsMap, rooms: roomsMap };
    // Never cache a total failure: the previous version cached three empty maps
    // for 30 minutes, so every name rendered blank after a single outage.
    if (anySuccess) {
      this.masterDataCache = { ...result, timestamp: Date.now() };
    }
    return result;
  }

  public async getClasses(): Promise<Array<{ id: number; name: string; longName: string }>> {
    const res = await this.rpc<Array<{ id: number; name: string; longName: string }>>('getKlassen');
    if (!Array.isArray(res)) {
      throw new WebUntisError('WEBUNTIS_UNAVAILABLE', 'WebUntis lieferte eine ungültige Klassenliste.');
    }
    return res;
  }

  /**
   * Fetch timetable lessons for a date range. Throws on failure; the caller
   * decides whether to show an error or an empty day.
   */
  public async getTimetableRange(
    startDate: Date | string | number = new Date(),
    endDate: Date | string | number = new Date(),
    classId?: number,
  ): Promise<WebUntisLesson[]> {
    const startDateInt = formatDateInt(startDate);
    const endDateInt = formatDateInt(endDate);

    const options: Record<string, unknown> = {
      startDate: startDateInt,
      endDate: endDateInt,
      showLsText: true,
      showStudentgroup: true,
    };

    let targetId: number | undefined;
    let targetType: number | undefined;

    if (classId) {
      targetId = classId;
      targetType = 1; // 1 = class
    } else {
      const session = await this.authenticate();
      const personId = this.customOptions?.personId || session.personId;
      if (personId) {
        targetId = personId;
        targetType = 2; // 2 = teacher
      }
    }

    if (!targetId || !targetType) {
      throw new WebUntisError(
        'WEBUNTIS_NOT_CONNECTED',
        'WebUntis hat keine Person-ID für dieses Konto geliefert.',
      );
    }

    // WebUntis requires options.element = { id, type }; -7002 otherwise.
    options.element = { id: targetId, type: targetType };

    const [raw, masterData] = await Promise.all([
      this.rpc<Array<{
        id: number;
        date: number;
        startTime: number;
        endTime: number;
        kl?: Array<{ id: number; name?: string }>;
        te?: Array<{ id: number; name?: string }>;
        su?: Array<{ id: number; name?: string }>;
        ro?: Array<{ id: number; name?: string }>;
        activityType?: string;
        lstype?: string;
        code?: string;
        sg?: string;
        lstext?: string;
        attendanceChecked?: boolean;
        isAttendanceChecked?: boolean;
      }>>('getTimetable', { options }),
      this.getMasterData(),
    ]);

    if (!Array.isArray(raw)) {
      throw new WebUntisError('WEBUNTIS_UNAVAILABLE', 'WebUntis lieferte einen ungültigen Stundenplan.');
    }

    const now = new Date();
    const currentDateInt = formatDateInt(now);
    const currentTimeInt = formatTimeInt(now);

    return raw
      .filter((lesson) => !isMiddleManagement(lesson, masterData.subjects))
      .map((lesson) => {
      let subjects = (lesson.su || []).map((s) => ({
        id: s.id,
        name: s.name || masterData.subjects.get(s.id) || '',
      }));

      if (subjects.length === 0 || subjects.every((s) => !s.name)) {
        if (lesson.lstype === 'bs') {
          subjects = [{ id: 0, name: 'Aufsicht' }];
        } else if (lesson.activityType) {
          subjects = [{ id: 0, name: lesson.activityType }];
        } else if (lesson.sg) {
          subjects = [{ id: 0, name: lesson.sg }];
        }
      }

      const duty = classifyDutySlot({
        lstype: lesson.lstype,
        activityType: lesson.activityType,
        sg: lesson.sg,
        subjects,
      });

      const hasContent = Boolean(lesson.lstext && lesson.lstext.trim().length > 0);
      // A lesson is only "missing" once it has ended. Comparing startTime
      // flagged the lesson currently in progress.
      const isFinished =
        lesson.date < currentDateInt ||
        (lesson.date === currentDateInt && lesson.endTime <= currentTimeInt);
      const isCancelled = lesson.code === 'cancelled';

      const rawAttendance = lesson.attendanceChecked ?? lesson.isAttendanceChecked;
      const attendanceKnown = rawAttendance !== undefined && rawAttendance !== null;
      const attendanceChecked = attendanceKnown ? Boolean(rawAttendance) : null;
      // Unknown is not a violation. The classic API often omits this field, and
      // treating that as `false` turned every past lesson into an alarm.
      // Furthermore, duty slots (MM, SPR, Aufsicht) do not expect attendance checks.
      const missingAttendance = !duty.isDuty && attendanceKnown && !isCancelled && isFinished && !attendanceChecked;
      const missingTeachingContent = !duty.isDuty && !isCancelled && isFinished && !hasContent;

      const classes = (lesson.kl || []).map((k) => ({
        id: k.id,
        name: k.name || masterData.classes.get(k.id) || '',
      }));

      return {
        id: lesson.id,
        date: lesson.date,
        startTime: lesson.startTime,
        endTime: lesson.endTime,
        classes,
        teachers: (lesson.te || []).map((t) => ({
          id: t.id,
          name: t.name || (this.customOptions?.teacherShort ?? ''),
        })),
        subjects,
        rooms: (lesson.ro || []).map((r) => ({
          id: r.id,
          name: r.name || masterData.rooms.get(r.id) || '',
        })),
        lessonText: lesson.lstext || '',
        status: isCancelled ? 'cancelled' : 'regular',
        hasTeachingContent: hasContent,
        missingTeachingContent,
        attendanceChecked,
        missingAttendance,
        isDuty: duty.isDuty,
        dutyType: duty.dutyType,
      };
    });
  }

  public async getDailyTimetable(
    targetDate: Date | string | number = new Date(),
    classId?: number,
  ): Promise<WebUntisLesson[]> {
    return this.getTimetableRange(targetDate, targetDate, classId);
  }

  /**
   * Find one period inside a class/day timetable. Used to prove that a lesson id
   * belongs to a class the caller is allowed to write before saving Lehrstoff.
   */
  public async findLesson(
    lessonId: number,
    classId: number,
    date: Date | string | number,
  ): Promise<WebUntisLesson | null> {
    const lessons = await this.getTimetableRange(date, date, classId);
    return lessons.find((lesson) => lesson.id === lessonId) ?? null;
  }

  public async getAbsences(
    targetDate: Date | string | number = new Date(),
    classId?: number,
  ): Promise<WebUntisAbsence[]> {
    await this.authenticate();
    const dateStr = toUntisDateStr(targetDate);
    const dateInt = toUntisDateInt(targetDate);

    const restResult = await this.getAbsencesFromRest(dateStr, classId);
    if (restResult) return restResult;

    try {
      const rpcData = await this.rpc<{
        periodsWithAbsences?: Array<{
          id: number;
          studentId: number;
          date: number;
          classId?: number;
          startTime: number;
          endTime: number;
          reason?: string;
          isExcused?: boolean;
        }>;
      }>('getTimetableWithAbsences', {
        options: { startDate: dateInt, endDate: dateInt },
      });

      if (rpcData?.periodsWithAbsences && Array.isArray(rpcData.periodsWithAbsences)) {
        return rpcData.periodsWithAbsences
          // The RPC payload may omit classId. Never widen a filtered request:
          // if the record cannot be attributed to the requested class, drop it
          // and let the caller fall back to its own pupil scope.
          .filter((absence) => !classId || absence.classId === classId)
          .map((absence) => ({
            id: absence.id,
            studentId: absence.studentId,
            classId: absence.classId,
            startTime: String(absence.startTime).padStart(4, '0'),
            endTime: String(absence.endTime).padStart(4, '0'),
            startDate: dateStr,
            endDate: dateStr,
            reason: absence.reason,
            excused: absence.isExcused ?? false,
          }));
      }
    } catch (err) {
      throw asWebUntisError(err);
    }

    throw new WebUntisError(
      'WEBUNTIS_UNAVAILABLE',
      'Abwesenheiten konnten nicht aus WebUntis geladen werden.',
    );
  }

  /**
   * Returns `null` when the REST view is unavailable so the caller can fall back
   * to JSON-RPC. An empty array is a real "no absences" answer.
   */
  private async getAbsencesFromRest(dateStr: string, classId?: number): Promise<WebUntisAbsence[] | null> {
    const headers: Record<string, string> = {
      Cookie: this.getCookieHeader(),
      'X-Requested-With': 'XMLHttpRequest',
    };
    if (this.session?.token) headers.Authorization = `Bearer ${this.session.token}`;

    try {
      const res = await fetchWithTimeout(
        `${this.getBaseUrl()}/api/rest/view/v1/fls/attendance/students/absences?date=${encodeURIComponent(dateStr)}`,
        { headers },
      );
      if (!res.ok) return null;
      const json = (await res.json()) as {
        data?: Array<{
          id: number;
          studentId: number;
          studentName?: string;
          className?: string;
          classId?: number;
          startTime: string;
          endTime: string;
          reason?: string;
          excused?: boolean;
          text?: string;
        }>;
      };
      if (!json?.data || !Array.isArray(json.data)) return null;

      return json.data
        .filter((absence) => !classId || absence.classId === classId)
        .map((absence) => ({
          id: absence.id,
          studentId: absence.studentId,
          studentName: absence.studentName,
          classId: absence.classId,
          className: absence.className,
          startTime: absence.startTime,
          endTime: absence.endTime,
          startDate: dateStr,
          endDate: dateStr,
          reason: absence.reason,
          excused: absence.excused ?? false,
          text: absence.text,
        }));
    } catch {
      // Any REST problem (network, timeout, HTML instead of JSON) is handled by
      // falling back to JSON-RPC. The RPC call is authoritative and reports the
      // real error if that also fails.
      return null;
    }
  }

  public async getRecentEvents(
    classId?: number,
    categoryId?: number,
    startDate?: Date | string | number,
    endDate?: Date | string | number,
  ): Promise<WebUntisClassregEvent[]> {
    const today = new Date();
    const defaultStart = new Date(today);
    defaultStart.setDate(defaultStart.getDate() - 14);

    const raw = await this.rpc<Array<{
      id: number;
      date: number;
      time: number;
      studentId: number;
      classId?: number;
      categoryId: number;
      category?: string;
      teacherId?: number;
      teacher?: string;
      text?: string;
    }>>('getClassregEvents', {
      options: {
        startDate: formatDateInt(startDate ?? defaultStart),
        endDate: formatDateInt(endDate ?? today),
      },
    });

    if (!Array.isArray(raw)) {
      throw new WebUntisError('WEBUNTIS_UNAVAILABLE', 'WebUntis lieferte ungültige Klassenbucheinträge.');
    }

    return raw
      .filter((event) => !classId || event.classId === classId)
      .filter((event) => !categoryId || event.categoryId === categoryId)
      .map((event) => {
        const text = typeof event.text === 'string' ? event.text : '';
        return {
          id: event.id,
          studentId: event.studentId,
          classId: event.classId,
          categoryId: event.categoryId,
          categoryName: event.category || (event.categoryId === 2 ? 'Verhalten' : 'Sonstiges'),
          teacherId: event.teacherId,
          teacherName: event.teacher,
          date: event.date,
          time: event.time,
          text,
          syncedFromSmile:
            text.includes('[Gelbe Karte]') ||
            text.includes('[Rote Karte') ||
            text.includes('[Time-Out]'),
        };
      });
  }

  /**
   * Create an official Klassenbucheintrag.
   *
   * Prefers the JSON REST endpoint, whose response can be checked. The HTML
   * dialog fallback only counts as success when the body is not an error or
   * login page: a Struts validation page answers 200 and used to be recorded as
   * a successful write.
   */
  public async createKlassenbuchEntry(params: CreateEventParams): Promise<{ success: boolean; eventId?: number }> {
    await this.authenticate();
    const csrf = await this.getCsrfToken();

    // A date-only string is midnight UTC in `new Date()`; parse it at local noon
    // instead so the calendar day cannot slip in a negative-offset timezone.
    const incidentDate =
      params.date instanceof Date
        ? params.date
        : typeof params.date === 'string'
          ? (parseDateOnly(params.date) ?? new Date(params.date))
          : new Date();
    if (Number.isNaN(incidentDate.getTime())) {
      throw new WebUntisError('WEBUNTIS_INVALID_REQUEST', 'Ungültiges Datum für den Klassenbucheintrag.');
    }

    const dateInt = dateIntFromDate(incidentDate);
    const timeInt = params.time
      ? Number(params.time.replace(':', ''))
      : formatTimeInt(new Date());
    if (!Number.isFinite(timeInt) || timeInt < 0 || timeInt > 2359) {
      throw new WebUntisError('WEBUNTIS_INVALID_REQUEST', 'Ungültige Uhrzeit für den Klassenbucheintrag.');
    }

    const categoryId = params.categoryId ?? 2;
    if (!config.webuntis.allowedCategoryIds.includes(categoryId)) {
      throw new WebUntisError('WEBUNTIS_INVALID_REQUEST', 'Nicht freigegebene WebUntis-Kategorie.');
    }

    const restHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      Cookie: this.getCookieHeader(),
      'X-Requested-With': 'XMLHttpRequest',
    };
    if (this.session?.token) restHeaders.Authorization = `Bearer ${this.session.token}`;
    if (csrf) restHeaders['X-CSRF-TOKEN'] = csrf;

    try {
      const restRes = await fetchWithTimeout(`${this.getBaseUrl()}/api/classreg/events`, {
        method: 'POST',
        headers: restHeaders,
        body: JSON.stringify({
          studentId: params.studentId,
          classId: params.classId,
          date: dateInt,
          time: timeInt,
          categoryId,
          text: params.text,
        }),
      });
      if (restRes.ok) {
        const body = (await restRes.text().catch(() => '')).slice(0, 20_000);
        if (looksLikeWriteError(body)) {
          return { success: false };
        }
        let eventId: number | undefined;
        try {
          const json = JSON.parse(body) as { id?: number } | null;
          eventId = json?.id;
        } catch {
          // 204 / empty body: success without an id.
        }
        return { success: true, eventId };
      }
      if (restRes.status >= 500 || restRes.status === 429) {
        throw new WebUntisError('WEBUNTIS_UNAVAILABLE', `WebUntis antwortete mit HTTP ${restRes.status}.`, {
          retryable: true,
        });
      }
    } catch (err) {
      if (err instanceof WebUntisError && err.retryable) throw err;
      // 4xx or non-JSON: try the dialog form below.
    }

    const formParams = new URLSearchParams();
    if (csrf) formParams.append('_csrf', csrf);
    formParams.append('studentIds', String(params.studentId));
    formParams.append('classIds', String(params.classId));
    formParams.append('date', String(dateInt));
    formParams.append('time', String(timeInt));
    formParams.append('eventReasonId', String(categoryId));
    formParams.append('eventReason', String(categoryId));
    formParams.append('text', params.text);

    const res = await fetchWithTimeout(`${this.getBaseUrl()}/classregeventdlg.do`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: this.getCookieHeader(),
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: formParams.toString(),
    });

    if (!res.ok) {
      return { success: false };
    }

    const body = (await res.text().catch(() => '')).slice(0, 20_000);
    return looksLikeWriteError(body) ? { success: false } : { success: true };
  }

  /**
   * Save / update lesson content (Lehrstoff).
   *
   * The former fallback called a `saveLessonTopic` JSON-RPC method that does not
   * exist in the WebUntis API, so every failure paid for a second round trip and
   * then returned `{ success: false }` anyway.
   */
  public async saveLessonTopic(params: SaveLessonTopicParams): Promise<{ success: boolean }> {
    await this.authenticate();
    const csrf = await this.getCsrfToken();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Cookie: this.getCookieHeader(),
      'X-Requested-With': 'XMLHttpRequest',
    };
    if (this.session?.token) headers.Authorization = `Bearer ${this.session.token}`;
    if (csrf) headers['X-CSRF-TOKEN'] = csrf;

    const res = await fetchWithTimeout(
      `${this.getBaseUrl()}/api/rest/view/v1/timetable/periods/${params.lessonId}/teaching-content`,
      { method: 'POST', headers, body: JSON.stringify({ text: params.text }) },
    );

    if (!res.ok) {
      throw new WebUntisError(
        'WEBUNTIS_UNAVAILABLE',
        `Lehrstoff konnte nicht gespeichert werden (HTTP ${res.status}).`,
        { retryable: res.status >= 500 || res.status === 429 },
      );
    }

    // A 2xx HTML login/validation page is not a saved Lehrstoff.
    const body = (await res.text().catch(() => '')).slice(0, 20_000);
    if (looksLikeWriteError(body)) {
      throw new WebUntisError(
        'WEBUNTIS_UNAVAILABLE',
        'WebUntis hat den Lehrstoff nicht übernommen.',
      );
    }
    return { success: true };
  }

  /**
   * Verify teacher credentials against WebUntis without persisting state.
   */
  public static async verifyCredentials(params: {
    server: string;
    school: string;
    username: string;
    secret: string;
  }): Promise<{
    valid: boolean;
    personId: number;
    personType: number;
    teacherShort?: string;
    teacherName?: string;
    error?: string;
  }> {
    const cleanServer = normalizeWebUntisHost(params.server);
    const cleanSchool = params.school.trim();
    const cleanUser = params.username.trim();
    // Do not trim the secret: leading/trailing spaces are legal in a password.
    const secret = params.secret;

    if (!cleanSchool || !cleanUser || !secret) {
      return { valid: false, personId: 0, personType: 0, error: 'Alle Felder müssen ausgefüllt sein.' };
    }

    const rpcUrl = `https://${cleanServer}/WebUntis/jsonrpc.do?school=${encodeURIComponent(cleanSchool)}`;

    try {
      const res = await fetchWithTimeout(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: `verify_${Date.now()}`,
          method: 'authenticate',
          params: { user: cleanUser, password: secret, client: 'SMILE_Teacher_Platform' },
          jsonrpc: '2.0',
        }),
      });

      if (!res.ok) {
        return { valid: false, personId: 0, personType: 0, error: `Verbindungsfehler: HTTP ${res.status}` };
      }

      const data = (await res.json()) as {
        result?: { sessionId: string; personType: number; personId: number };
        error?: { code: number; message: string };
      };

      if (data.error || !data.result) {
        return {
          valid: false,
          personId: 0,
          personType: 0,
          error: data.error?.message || 'Ungültige WebUntis-Anmeldedaten.',
        };
      }

      const { personId, personType } = data.result;
      const cookies = readSetCookies(res);
      if (!cookies.some((cookie) => cookie.startsWith('schoolname='))) {
        cookies.push(`schoolname="${cleanSchool}"`);
      }

      let teacherShort = cleanUser.toUpperCase();
      let teacherName: string | undefined;

      try {
        const teachersRes = await fetchWithTimeout(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: cookies.join('; ') },
          body: JSON.stringify({
            id: `teachers_${Date.now()}`,
            method: 'getTeachers',
            params: {},
            jsonrpc: '2.0',
          }),
        });

        if (teachersRes.ok) {
          const tData = (await teachersRes.json()) as {
            result?: Array<{ id: number; name: string; foreName?: string; longName?: string }>;
          };
          if (Array.isArray(tData.result)) {
            const found = tData.result.find((t) => t.id === personId);
            if (found) {
              teacherShort = found.name;
              teacherName = `${found.foreName || ''} ${found.longName || ''}`.trim();
            }
          }
        }
      } catch {
        // Teacher lookup is optional.
      }

      try {
        await fetchWithTimeout(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: cookies.join('; ') },
          body: JSON.stringify({
            id: `logout_${Date.now()}`,
            method: 'logout',
            params: {},
            jsonrpc: '2.0',
          }),
        });
      } catch {
        // Best effort.
      }

      return { valid: true, personId, personType, teacherShort, teacherName };
    } catch (err) {
      return {
        valid: false,
        personId: 0,
        personType: 0,
        error: asWebUntisError(err).message,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Per-user client cache
// ---------------------------------------------------------------------------

const USER_CLIENT_TTL_MS = 15 * 60 * 1000;
const USER_CLIENT_MAX_ENTRIES = 500;

interface CachedClient {
  client: WebUntisClient;
  cachedAt: number;
}

const userClientCache = new Map<string, CachedClient>();

function pruneUserClientCache(): void {
  const now = Date.now();
  for (const [userId, entry] of userClientCache) {
    if (now - entry.cachedAt > USER_CLIENT_TTL_MS) {
      userClientCache.delete(userId);
      void entry.client.logout();
    }
  }
  // Bound memory if a large staff connects over a long-running process.
  while (userClientCache.size > USER_CLIENT_MAX_ENTRIES) {
    const oldest = userClientCache.keys().next().value as string | undefined;
    if (!oldest) break;
    const entry = userClientCache.get(oldest);
    userClientCache.delete(oldest);
    void entry?.client.logout();
  }
}

export interface ResolvedWebUntisClient {
  client: WebUntisClient;
  account: 'personal' | 'service';
}

/**
 * Resolve the client a request may use.
 *
 * Returns `null` when the user has not linked an account. There is deliberately
 * no silent fallback to the shared service account: that fallback made every
 * teacher read the school's data and write entries as `untis_monitor` while the
 * audit log named the teacher.
 */
export async function getWebUntisClientForUser(
  userId?: string | null,
): Promise<ResolvedWebUntisClient | null> {
  if (!userId) return null;
  pruneUserClientCache();

  const cached = userClientCache.get(userId);
  if (cached) return { client: cached.client, account: 'personal' };

  const [account] = await db
    .select()
    .from(userWebuntisAccounts)
    .where(eq(userWebuntisAccounts.userId, userId))
    .limit(1);

  if (!account) return null;

  if (account.authMethod === 'loginkey') {
    // The connect wizard no longer offers Login-Key/2FA secrets. A row from the
    // old flow would otherwise be sent to WebUntis as a password and fail with a
    // misleading "wrong credentials" error.
    throw new WebUntisError(
      'WEBUNTIS_AUTH_FAILED',
      'Für dieses Konto ist noch ein Login-Key gespeichert. Bitte verknüpfen Sie Ihr ' +
        'WebUntis-Konto erneut mit Ihrem Passwort.',
    );
  }

  const password = decryptSecret(account.encryptedSecret, account.secretIv, account.secretAuthTag);
  const client = new WebUntisClient({
    server: account.server,
    school: account.school,
    user: account.untisUsername,
    password,
    personId: account.personId,
    teacherShort: account.teacherShort,
  });
  userClientCache.set(userId, { client, cachedAt: Date.now() });
  return { client, account: 'personal' };
}

/**
 * Shared, read-only client for school leadership. Returns `null` when no
 * service account is configured.
 */
export function getWebUntisServiceClient(): WebUntisClient | null {
  if (!webuntisServiceAccountConfigured()) return null;
  return serviceWebUntis;
}

export function invalidateWebUntisUserCache(userId: string): void {
  const entry = userClientCache.get(userId);
  userClientCache.delete(userId);
  if (entry) void entry.client.logout();
}

/** Service-account singleton. Never used as a fallback for a teacher. */
export const serviceWebUntis = new WebUntisClient({ serviceAccount: true });
