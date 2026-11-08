import { config } from '../../config.js';
import type {
  WebUntisConfig,
  WebUntisEnv,
  WebUntisSession,
  WebUntisAbsence,
  WebUntisLesson,
  WebUntisClassregEvent,
  CreateEventParams,
  SaveLessonTopicParams,
} from './types.js';

function formatDateInt(date: Date): number {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return Number(`${y}${m}${d}`);
}

function formatTimeInt(date: Date): number {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return Number(`${h}${m}`);
}

export class WebUntisClient {
  private currentEnv: WebUntisEnv;
  private session: WebUntisSession | null = null;
  private csrfToken: string | null = null;

  constructor() {
    this.currentEnv = (config.webuntis.environment as WebUntisEnv) || 'production';
  }

  public getEnvironment(): WebUntisEnv {
    return this.currentEnv;
  }

  public setEnvironment(env: WebUntisEnv): void {
    if (this.currentEnv !== env) {
      this.currentEnv = env;
      this.session = null;
      this.csrfToken = null;
    }
  }

  public getConfig(): { server: string; school: string; user: string; env: WebUntisEnv } {
    const isPlayground = this.currentEnv === 'playground';
    return {
      server: isPlayground ? config.webuntis.playgroundServer : config.webuntis.server,
      school: isPlayground ? config.webuntis.playgroundSchool : config.webuntis.school,
      user: config.webuntis.user,
      env: this.currentEnv,
    };
  }

  private getBaseUrl(): string {
    const cfg = this.getConfig();
    return `https://${cfg.server}/WebUntis`;
  }

  /** Build Cookie header from session cookie jar. */
  private getCookieHeader(): string {
    if (!this.session || !this.session.cookies.length) return '';
    return this.session.cookies.map((c) => c.split(';')[0]).join('; ');
  }

  /** Merge new Set-Cookie headers into session. */
  private updateCookies(response: Response): void {
    const raw = response.headers.get('set-cookie');
    if (!raw || !this.session) return;
    const parts = raw.split(/,(?=[^;]+=[^;]+)/g);
    for (const part of parts) {
      const nameVal = part.trim().split(';')[0];
      const name = nameVal.split('=')[0];
      this.session.cookies = this.session.cookies.filter((c) => !c.startsWith(`${name}=`));
      this.session.cookies.push(nameVal);
    }
  }

  /**
   * Authenticate with WebUntis using JSON-RPC authenticate method.
   * Caches session and exchanges session for REST bearer token if possible.
   */
  public async authenticate(force = false): Promise<WebUntisSession> {
    if (
      !force &&
      this.session &&
      this.session.expiresAt.getTime() > Date.now() + 60_000
    ) {
      return this.session;
    }

    const cfg = this.getConfig();
    const rpcUrl = `${this.getBaseUrl()}/jsonrpc.do?school=${encodeURIComponent(cfg.school)}`;

    const rpcBody = {
      id: `auth_${Date.now()}`,
      method: 'authenticate',
      params: {
        user: cfg.user,
        password: config.webuntis.password,
        client: 'SMILE_Teacher_Platform',
      },
      jsonrpc: '2.0',
    };

    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rpcBody),
    });

    if (!res.ok) {
      throw new Error(`WebUntis auth HTTP error: ${res.status} ${res.statusText}`);
    }

    // Extract cookies
    const cookieHeader = res.headers.get('set-cookie') || '';
    const cookieParts = cookieHeader ? cookieHeader.split(/,(?=[^;]+=[^;]+)/g) : [];
    const cookies = cookieParts.map((p) => p.trim().split(';')[0]);

    // Ensure schoolname cookie is present
    if (!cookies.some((c) => c.startsWith('schoolname='))) {
      cookies.push(`schoolname="${cfg.school}"`);
    }

    const data = (await res.json()) as {
      result?: { sessionId: string; personType: number; personId: number };
      error?: { code: number; message: string };
    };

    if (data.error || !data.result) {
      throw new Error(`WebUntis login rejected: ${data.error?.message || 'Unknown error'} (Code ${data.error?.code})`);
    }

    const session: WebUntisSession = {
      sessionId: data.result.sessionId,
      cookies,
      personId: data.result.personId,
      personType: data.result.personType,
      lastLogin: new Date(),
      expiresAt: new Date(Date.now() + 25 * 60 * 1000), // 25 min default
    };

    this.session = session;

    // Attempt REST Bearer token exchange
    try {
      const tokenRes = await fetch(`${this.getBaseUrl()}/api/token/new`, {
        headers: {
          Cookie: this.getCookieHeader(),
        },
      });
      if (tokenRes.ok) {
        const text = (await tokenRes.text()).trim();
        if (text && !text.startsWith('<')) {
          this.session.token = text;
        }
      }
      this.updateCookies(tokenRes);
    } catch {
      // Bearer token exchange is optional; cookies remain authoritative
    }

    return this.session;
  }

  /**
   * Execute JSON-RPC request with automatic session recovery.
   */
  public async rpc<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const session = await this.authenticate();
    const cfg = this.getConfig();
    const rpcUrl = `${this.getBaseUrl()}/jsonrpc.do?school=${encodeURIComponent(cfg.school)}`;

    const rpcBody = {
      id: `req_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      method,
      params,
      jsonrpc: '2.0',
    };

    let res = await fetch(rpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: this.getCookieHeader(),
      },
      body: JSON.stringify(rpcBody),
    });

    let data = (await res.json()) as { result?: T; error?: { code: number; message: string } };

    // If session expired (-8520), re-auth and retry once
    if (data.error && (data.error.code === -8520 || data.error.message?.includes('not authenticated'))) {
      await this.authenticate(true);
      res = await fetch(rpcUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: this.getCookieHeader(),
        },
        body: JSON.stringify(rpcBody),
      });
      data = (await res.json()) as { result?: T; error?: { code: number; message: string } };
    }

    if (data.error) {
      throw new Error(`WebUntis RPC ${method} error (${data.error.code}): ${data.error.message}`);
    }

    return data.result as T;
  }

  /** Fetch CSRF token for Dojo forms / REST actions */
  private async getCsrfToken(): Promise<string> {
    if (this.csrfToken) return this.csrfToken;
    await this.authenticate();
    try {
      const cfgRes = await fetch(`${this.getBaseUrl()}/api/app/config`, {
        headers: {
          Cookie: this.getCookieHeader(),
          'X-Requested-With': 'XMLHttpRequest',
        },
      });
      if (cfgRes.ok) {
        const json = (await cfgRes.json()) as { data?: { csrfToken?: string } };
        if (json?.data?.csrfToken) {
          this.csrfToken = json.data.csrfToken;
          return this.csrfToken;
        }
      }
    } catch {
      // fallback to dialog scan
    }

    // Try dialog page regex
    const dlgRes = await fetch(`${this.getBaseUrl()}/classregeventdlg.do`, {
      headers: { Cookie: this.getCookieHeader() },
    });
    if (dlgRes.ok) {
      const html = await dlgRes.text();
      const m = html.match(/name="_csrf"\s+value="([^"]+)"/i) || html.match(/"csrfToken":\s*"([^"]+)"/i);
      if (m && m[1]) {
        this.csrfToken = m[1];
        return this.csrfToken;
      }
    }

    return '';
  }

  /**
   * Health and status check for WebUntis connection.
   */
  public async getStatus(): Promise<{
    connected: boolean;
    environment: WebUntisEnv;
    server: string;
    school: string;
    user: string;
    personId?: number;
    error?: string;
  }> {
    const cfg = this.getConfig();
    try {
      const session = await this.authenticate();
      return {
        connected: true,
        environment: this.currentEnv,
        server: cfg.server,
        school: cfg.school,
        user: cfg.user,
        personId: session.personId,
      };
    } catch (err) {
      return {
        connected: false,
        environment: this.currentEnv,
        server: cfg.server,
        school: cfg.school,
        user: cfg.user,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Fetch all classes from WebUntis.
   */
  public async getClasses(): Promise<Array<{ id: number; name: string; longName: string }>> {
    const res = await this.rpc<Array<{ id: number; name: string; longName: string }>>('getKlassen');
    return res || [];
  }

  /**
   * Fetch daily timetable for a class or teacher.
   */
  public async getDailyTimetable(targetDate = new Date(), classId?: number): Promise<WebUntisLesson[]> {
    const dateInt = formatDateInt(targetDate);
    const options: Record<string, unknown> = {
      startDate: dateInt,
      endDate: dateInt,
    };
    if (classId) {
      options.id = classId;
      options.type = 1; // 1 = Class
    } else {
      const session = await this.authenticate();
      if (session.personId) {
        options.id = session.personId;
        options.type = 2; // 2 = Teacher
      }
    }

    try {
      const raw = await this.rpc<Array<{
        id: number;
        date: number;
        startTime: number;
        endTime: number;
        kl?: Array<{ id: number; name: string }>;
        te?: Array<{ id: number; name: string }>;
        su?: Array<{ id: number; name: string }>;
        ro?: Array<{ id: number; name: string }>;
        activityType?: string;
        code?: string;
        lstext?: string;
      }>>('getTimetable', { options });

      if (!Array.isArray(raw)) return [];

      return raw.map((l) => ({
        id: l.id,
        date: l.date,
        startTime: l.startTime,
        endTime: l.endTime,
        classes: l.kl?.map((k) => ({ id: k.id, name: k.name })) || [],
        teachers: l.te?.map((t) => ({ id: t.id, name: t.name })) || [],
        subjects: l.su?.map((s) => ({ id: s.id, name: s.name })) || [],
        rooms: l.ro?.map((r) => ({ id: r.id, name: r.name })) || [],
        lessonText: l.lstext || '',
        status: l.code === 'cancelled' ? 'cancelled' : 'regular',
      }));
    } catch {
      return [];
    }
  }

  /**
   * Fetch absences for a given date and class.
   */
  public async getAbsences(targetDate = new Date(), classId?: number): Promise<WebUntisAbsence[]> {
    await this.authenticate();
    const dateStr = targetDate.toISOString().slice(0, 10);
    const dateInt = formatDateInt(targetDate);

    // Try modern REST absence endpoint first
    try {
      const headers: Record<string, string> = {
        Cookie: this.getCookieHeader(),
        'X-Requested-With': 'XMLHttpRequest',
      };
      if (this.session?.token) {
        headers['Authorization'] = `Bearer ${this.session.token}`;
      }

      const res = await fetch(
        `${this.getBaseUrl()}/api/rest/view/v1/fls/attendance/students/absences?date=${dateStr}`,
        { headers },
      );

      if (res.ok) {
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

        if (json?.data && Array.isArray(json.data)) {
          return json.data
            .filter((a) => !classId || a.classId === classId)
            .map((a) => ({
              id: a.id,
              studentId: a.studentId,
              studentName: a.studentName,
              classId: a.classId,
              className: a.className,
              startTime: a.startTime,
              endTime: a.endTime,
              startDate: dateStr,
              endDate: dateStr,
              reason: a.reason,
              excused: a.excused ?? false,
              text: a.text,
            }));
        }
      }
    } catch {
      // Fallback
    }

    // Try JSON-RPC getTimetableWithAbsences if accessible
    try {
      const rpcData = await this.rpc<{
        periodsWithAbsences?: Array<{
          id: number;
          studentId: number;
          date: number;
          startTime: number;
          endTime: number;
          reason?: string;
          isExcused?: boolean;
        }>;
      }>('getTimetableWithAbsences', {
        options: {
          startDate: dateInt,
          endDate: dateInt,
        },
      });

      if (rpcData?.periodsWithAbsences && Array.isArray(rpcData.periodsWithAbsences)) {
        return rpcData.periodsWithAbsences.map((a) => ({
          id: a.id,
          studentId: a.studentId,
          startTime: String(a.startTime).padStart(4, '0'),
          endTime: String(a.endTime).padStart(4, '0'),
          startDate: dateStr,
          endDate: dateStr,
          reason: a.reason,
          excused: a.isExcused ?? false,
        }));
      }
    } catch {
      // If administrative timetable export is not granted, return empty list
    }

    return [];
  }

  /**
   * Fetch recent Klassenbucheinträge (class register events).
   */
  public async getRecentEvents(classId?: number, categoryId?: number): Promise<WebUntisClassregEvent[]> {
    const today = new Date();
    const past = new Date(today);
    past.setDate(past.getDate() - 14); // Last 14 days

    try {
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
        text: string;
      }>>('getClassregEvents', {
        options: {
          startDate: formatDateInt(past),
          endDate: formatDateInt(today),
        },
      });

      if (!Array.isArray(raw)) return [];

      return raw
        .filter((e) => !classId || e.classId === classId)
        .filter((e) => !categoryId || e.categoryId === categoryId)
        .map((e) => ({
          id: e.id,
          studentId: e.studentId,
          classId: e.classId,
          categoryId: e.categoryId,
          categoryName: e.category || (e.categoryId === 2 ? 'Verhalten' : 'Sonstiges'),
          teacherId: e.teacherId,
          teacherName: e.teacher,
          date: e.date,
          time: e.time,
          text: e.text,
          syncedFromSmile: e.text.includes('[Gelbe Karte]') || e.text.includes('[Rote Karte') || e.text.includes('[Time-Out]'),
        }));
    } catch {
      return [];
    }
  }

  /**
   * Create an official Klassenbucheintrag (Class register incident) in WebUntis.
   * Dispatches via Dojo dialog POST or REST endpoint.
   */
  public async createKlassenbuchEntry(params: CreateEventParams): Promise<{ success: boolean; eventId?: number }> {
    await this.authenticate();
    const csrf = await this.getCsrfToken();

    const incidentDate = params.date instanceof Date ? params.date : params.date ? new Date(params.date) : new Date();
    const dateInt = formatDateInt(incidentDate);
    const timeInt = params.time ? Number(params.time.replace(':', '')) : formatTimeInt(incidentDate);
    const categoryId = params.categoryId ?? 2; // Category 2 = "Verhalten"

    // Method 1: Submit to /WebUntis/classregeventdlg.do (standard WebUntis Struts/Dojo form)
    try {
      const formParams = new URLSearchParams();
      if (csrf) formParams.append('_csrf', csrf);
      formParams.append('studentIds', String(params.studentId));
      formParams.append('classIds', String(params.classId));
      formParams.append('date', String(dateInt));
      formParams.append('time', String(timeInt));
      formParams.append('eventReasonId', String(categoryId));
      formParams.append('eventReason', String(categoryId));
      formParams.append('text', params.text);
      if (this.session?.userId) formParams.append('userId', String(this.session.userId));

      const res = await fetch(`${this.getBaseUrl()}/classregeventdlg.do`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: this.getCookieHeader(),
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: formParams.toString(),
      });

      if (res.ok) {
        return { success: true };
      }
    } catch {
      // Fall through to REST attempt
    }

    // Method 2: Modern REST Classreg API
    try {
      const restHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        Cookie: this.getCookieHeader(),
        'X-Requested-With': 'XMLHttpRequest',
      };
      if (this.session?.token) {
        restHeaders['Authorization'] = `Bearer ${this.session.token}`;
      }
      if (csrf) {
        restHeaders['X-CSRF-TOKEN'] = csrf;
      }

      const restRes = await fetch(`${this.getBaseUrl()}/api/classreg/events`, {
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
        const json = (await restRes.json().catch(() => ({}))) as { id?: number };
        return { success: true, eventId: json.id };
      }
    } catch {
      // Return fail if both network attempts fail
    }

    return { success: false };
  }

  /**
   * Save / update lesson content (Lehrstoff) for a lesson.
   */
  public async saveLessonTopic(params: SaveLessonTopicParams): Promise<{ success: boolean }> {
    await this.authenticate();
    const csrf = await this.getCsrfToken();

    // REST teaching content endpoint
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Cookie: this.getCookieHeader(),
        'X-Requested-With': 'XMLHttpRequest',
      };
      if (this.session?.token) {
        headers['Authorization'] = `Bearer ${this.session.token}`;
      }
      if (csrf) {
        headers['X-CSRF-TOKEN'] = csrf;
      }

      const res = await fetch(
        `${this.getBaseUrl()}/api/rest/view/v1/timetable/periods/${params.lessonId}/teaching-content`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            text: params.text,
          }),
        },
      );

      if (res.ok) return { success: true };
    } catch {
      // Try fallback JSON-RPC
    }

    try {
      await this.rpc('saveLessonTopic', {
        lessonId: params.lessonId,
        topic: params.text,
      });
      return { success: true };
    } catch {
      return { success: false };
    }
  }
}

/** Singleton instance for the server runtime */
export const webuntis = new WebUntisClient();
