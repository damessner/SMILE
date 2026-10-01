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
  mySubjects?: Array<{ code: string; name: string; isCoreSmile: boolean }>;
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
