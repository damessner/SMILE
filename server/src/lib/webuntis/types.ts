export type WebUntisEnv = 'production' | 'playground';

export interface WebUntisConfig {
  server: string;
  school: string;
  user: string;
  password: string;
  environment: WebUntisEnv;
  autoSyncDisciplinary: boolean;
}

export interface WebUntisSession {
  sessionId: string;
  cookies: string[];
  token?: string;
  personId?: number;
  personType?: number;
  userId?: number;
  lastLogin: Date;
  expiresAt: Date;
}

export interface WebUntisAbsence {
  id: number;
  studentId: number;
  studentName?: string;
  classId?: number;
  className?: string;
  startTime: string; // HH:mm or HHmm
  endTime: string;
  startDate: string; // YYYY-MM-DD or YYYYMMDD
  endDate: string;
  reason?: string;
  excused: boolean;
  text?: string;
}

export interface WebUntisLesson {
  id: number;
  date: number; // YYYYMMDD
  startTime: number; // e.g. 800
  endTime: number; // e.g. 850
  periodText?: string;
  classes: Array<{ id: number; name: string }>;
  teachers: Array<{ id: number; name: string }>;
  subjects: Array<{ id: number; name: string }>;
  rooms: Array<{ id: number; name: string }>;
  lessonText?: string; // Lehrstoff
  homework?: string;
  status?: string; // regular, cancelled, substitution
}

export interface WebUntisClassregEvent {
  id: number;
  studentId: number;
  studentName?: string;
  classId?: number;
  className?: string;
  teacherId?: number;
  teacherName?: string;
  categoryId: number; // 2 = Verhalten, 3 = Sonstiges
  categoryName?: string;
  date: number; // YYYYMMDD
  time: number; // HHmm
  text: string;
  syncedFromSmile?: boolean;
}

export interface CreateEventParams {
  studentId: number;
  classId: number;
  date?: string | Date; // YYYY-MM-DD or Date
  time?: string; // HH:mm
  text: string;
  categoryId?: number; // default 2 ("Verhalten")
  teacherName?: string;
}

export interface SaveLessonTopicParams {
  lessonId: number;
  text: string;
}
