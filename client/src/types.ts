export interface User {
  id: string;
  username: string;
  role: 'admin' | 'head_teacher' | 'teacher' | 'pupil';
  teacherId?: number;
  teacher?: {
    id: number;
    shortName: string;
    fullName: string;
  } | null;
  /** True while the account still uses the bootstrap password. Writes are blocked. */
  mustChangePassword?: boolean;
  /** Read-only "Ansehen als" session: set while viewing the app as another account. */
  viewAs?: boolean;
  /** Username of the leadership account that opened the view (display only). */
  actUsername?: string;
}

export interface SchoolClass {
  id: number;
  name: string;
  grade: number;
  headTeacher1?: string | null;
  headTeacher2?: string | null;
  canAccessRaster?: boolean;
  canRate?: boolean;
  mySubjects?: Array<{ code: string; name: string; isCoreSmile: boolean; hours?: number }>;
  isKv?: boolean;
}

export interface NotificationClassSubscription {
  classId: number;
  className: string;
  green: boolean;
  yellow: boolean;
  red: boolean;
  timeout: boolean;
  cooldown: boolean;
  weeklyDigest: boolean;
}

export interface NotificationPreferences {
  email: string;
  classes: NotificationClassSubscription[];
}

export interface RubricItem {
  key: string;
  label?: string;
  desc?: string;
}

export interface RubricCriterion {
  id: string;
  name: string;
  position: number;
  items: RubricItem[];
}

export interface EvaluationItem {
  id: string;
  evaluationId: string;
  criterionId: string;
  itemKey: string;
  rating: string;
  version: number;
  updatedByTeacherId?: number | null;
  updatedAt: string;
}

export interface Evaluation {
  id: string;
  roundId: string;
  pupilId: number;
  classId: number;
  subjectCode: string;
  teacherId: number;
  proposedStatus?: 'Lehrling' | 'Geselle' | 'Meister' | null;
  nextStep?: string | null;
  comment?: string | null;
  isSubmitted?: boolean;
  submittedAt?: string | null;
  submittedByTeacherId?: number | null;
  items: EvaluationItem[];
}

export interface BehaviorCard {
  id: string;
  pupilId: number;
  classId: number;
  teacherId: number;
  cardType: 'green' | 'yellow' | 'red' | 'cooldown';
  note?: string | null;
  createdAt: string;
  revokedAt?: string | null;
}

export interface PupilWithData {
  id: number;
  classId: number;
  fullName: string;
  isArchived: boolean;
  evaluations: Evaluation[];
  cards: BehaviorCard[];
  greenCardCount: number;
  yellowCardCount: number;
  redCardCount?: number;
  /** Precomputed red/yellow demotion steps for the current observation round. */
  rankDemotionSteps?: number;
  /** Official conference rank for this round, when already confirmed. */
  finalRank?: 'Lehrling' | 'Geselle' | 'Meister' | null;
  assignedTeachers?: Record<string, number[]>;
  assignedGroups?: Record<string, string>;
}

export interface BehaviorStage {
  level: number; // -10 to +10
  title: string;
  type: 'green' | 'neutral' | 'red';
  description: string;
  thresholdLabel: string;
  defaultGrade: 'Sehr gut' | 'Gut' | 'Zufriedenstellend' | 'Wenig zufriedenstellend';
}

export interface PupilStageResult {
  currentStage: number;
  positiveStage: number;
  consequenceStage: number;
  stageInfo: BehaviorStage;
  behaviorGrade: 'Sehr gut' | 'Gut' | 'Zufriedenstellend' | 'Wenig zufriedenstellend';
  stats: {
    greenCount: number;
    yellowCount: number;
    redCount: number;
    timeoutCount: number;
  };
}

export interface PupilBehaviorAction {
  id: string;
  pupil_id: number;
  stage_level: number;
  stage_title: string;
  status: 'pending' | 'completed' | 'acknowledged';
  action_date: string;
  teacher_id: number;
  teacher_short?: string;
  teacher_name?: string;
  notes?: string | null;
  created_at: string;
}

export interface PupilBehaviorProfile {
  pupil: {
    id: number;
    fullName: string;
    classId: number;
    className: string;
    currentRank: string;
  };
  stages: BehaviorStage[];
  calculation: PupilStageResult;
  cards: Array<{
    id: string;
    card_type: 'green' | 'yellow' | 'red' | 'cooldown';
    note?: string | null;
    created_at: string;
    teacher_short?: string;
    teacher_name?: string;
  }>;
  timeouts: Array<{
    id: string;
    sent_at: string;
    recorded_at?: string | null;
    retroactive?: boolean;
    task_assignment: string;
    kind?: 'timeout' | 'cooldown';
    status: string;
    resolved_at?: string | null;
    resolution_note?: string | null;
    sent_by_short?: string;
  }>;
  actions: PupilBehaviorAction[];
}
