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
}

export interface SchoolClass {
  id: number;
  name: string;
  grade: number;
  headTeacher1?: string | null;
  headTeacher2?: string | null;
  canAccessRaster?: boolean;
  mySubjects?: Array<{ code: string; name: string; isCoreSmile: boolean; hours?: number }>;
  isKv?: boolean;
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
  cardType: 'green' | 'yellow';
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
    card_type: 'green' | 'yellow' | 'red';
    note?: string | null;
    created_at: string;
    teacher_short?: string;
    teacher_name?: string;
  }>;
  timeouts: Array<{
    id: string;
    sent_at: string;
    task_assignment: string;
    status: string;
    resolved_at?: string | null;
    resolution_note?: string | null;
    sent_by_short?: string;
  }>;
  actions: PupilBehaviorAction[];
}

