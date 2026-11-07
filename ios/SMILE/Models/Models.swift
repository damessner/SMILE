import Foundation
import SwiftUI

// MARK: - Auth & User

struct User: Codable, Identifiable, Equatable {
    let id: String
    let username: String
    let role: String
    let teacherId: Int?
    let teacher: TeacherInfo?
    var mustChangePassword: Bool?
    var viewAs: Bool?
    var actUsername: String?

    var displayName: String {
        teacher?.fullName ?? username
    }

    var shortBadge: String {
        teacher?.shortName ?? username.uppercased()
    }
}

struct TeacherInfo: Codable, Equatable {
    let id: Int
    let shortName: String
    let fullName: String
}

struct LoginResponse: Codable {
    let user: User
    let expiresAt: Int?
}

struct MeResponse: Codable {
    let user: User
}

struct PasswordChangeResponse: Codable {
    let success: Bool
    let user: User?
}

struct APIErrorPayload: Codable {
    let error: String?
    let code: String?
}

// MARK: - Classes & Timetable

struct SubjectAssignment: Codable, Hashable {
    let code: String
    let name: String
    let isCoreSmile: Bool?
    let hours: Int?
}

struct SchoolClass: Codable, Identifiable, Hashable {
    let id: Int
    let name: String
    let grade: Int?
    let headTeacher1: String?
    let headTeacher2: String?
    let canAccessRaster: Bool?
    let canRate: Bool?
    let isKv: Bool?
    let mySubjects: [SubjectAssignment]?
}

struct PeriodInfo: Codable, Equatable {
    let period: Int
    let start: String
    let end: String
    let label: String?
}

struct TimetableLesson: Codable, Identifiable, Equatable {
    let id: Int
    let classId: Int
    let className: String
    let teacherId: Int
    let teacherShort: String
    let subjectCode: String
    let subjectName: String
    let room: String?
    let dayOfWeek: Int
    let period: Int
}

struct TimetableResponse: Codable {
    let isTeacher: Bool
    let dayOfWeek: Int
    let period: Int
    let periodInfo: PeriodInfo?
    let isSchoolHours: Bool
    let currentLesson: TimetableLesson?
    let nextLesson: TimetableLesson?
    let todayLessons: [TimetableLesson]
    let weekLessonsCount: Int
}

// MARK: - Pupils, Evaluations & Cards

enum AssessmentRank: String, Codable, CaseIterable {
    case meister = "Meister"
    case geselle = "Geselle"
    case lehrling = "Lehrling"
    case ausstehend = "Ausstehend"

    var color: Color {
        switch self {
        case .meister: return Color(red: 0.96, green: 0.62, blue: 0.04) // Amber
        case .geselle: return Color(red: 0.23, green: 0.51, blue: 0.96) // Blue
        case .lehrling: return Color(red: 0.96, green: 0.25, blue: 0.37) // Rose
        case .ausstehend: return Color(red: 0.45, green: 0.50, blue: 0.58) // Slate
        }
    }

    func demoted(by steps: Int) -> AssessmentRank {
        guard steps > 0 else { return self }
        switch self {
        case .meister:
            return steps == 1 ? .geselle : .lehrling
        case .geselle:
            return .lehrling
        case .lehrling, .ausstehend:
            return self
        }
    }
}

struct EvaluationItem: Codable, Identifiable, Equatable {
    let id: String
    let evaluationId: String
    let criterionId: String
    let itemKey: String
    let rating: String
    let version: Int
}

struct Evaluation: Codable, Identifiable, Equatable {
    let id: String
    let roundId: String
    let pupilId: Int
    let classId: Int
    let subjectCode: String
    let teacherId: Int
    let proposedStatus: String?
    let nextStep: String?
    let comment: String?
    let isSubmitted: Bool?
    let items: [EvaluationItem]?
}

struct BehaviorCard: Codable, Identifiable, Equatable {
    let id: String
    let pupilId: Int
    let classId: Int
    let teacherId: Int
    let cardType: String
    let note: String?
    let createdAt: String
    let revokedAt: String?
}

struct PupilWithData: Codable, Identifiable, Equatable {
    let id: Int
    let classId: Int
    let fullName: String
    let isArchived: Bool?
    let evaluations: [Evaluation]?
    let cards: [BehaviorCard]?
    let greenCardCount: Int?
    let yellowCardCount: Int?
    let redCardCount: Int?
    let rankDemotionSteps: Int?
    let finalRank: String?

    /// Computes the pupil's effective competence rank (finalRank or majority vote, with card demotions applied).
    func effectiveRank(forSubject subjectCode: String? = nil) -> AssessmentRank {
        let demotions = rankDemotionSteps ?? 0

        if let subject = subjectCode?.uppercased(), !subject.isEmpty,
           let eval = evaluations?.first(where: { $0.subjectCode.uppercased() == subject }),
           let status = eval.proposedStatus,
           let rank = AssessmentRank(rawValue: status) {
            return rank.demoted(by: demotions)
        }

        if let finalRank = finalRank, let rank = AssessmentRank(rawValue: finalRank) {
            return rank.demoted(by: demotions)
        }

        let votes = (evaluations ?? []).compactMap { $0.proposedStatus }
        guard !votes.isEmpty else { return .ausstehend }

        var counts: [String: Int] = [:]
        for v in votes { counts[v, default: 0] += 1 }
        if let best = counts.max(by: { $0.value < $1.value })?.key,
           let rank = AssessmentRank(rawValue: best) {
            return rank.demoted(by: demotions)
        }
        return .ausstehend
    }
}

struct ClassPupilsResponse: Codable {
    let pupils: [PupilWithData]
    let canAccessRaster: Bool?
    let canRate: Bool?
    let isKv: Bool?
    let mySubjects: [SubjectAssignment]?
}

// MARK: - Class Cards & Timeouts (Schulalltag & Lernwerkstatt)

struct ClassCardItem: Codable, Identifiable, Equatable {
    let id: String
    let pupil_id: Int
    let class_id: Int
    let teacher_id: Int?
    let teacher_short: String?
    let teacher_name: String?
    let card_type: String // "green" | "yellow" | "red" | "cooldown"
    let note: String?
    let created_at: String
}

struct TimeoutIncident: Codable, Identifiable, Equatable {
    let id: String
    let pupil_id: Int
    let class_id: Int
    let sent_by_teacher_id: Int?
    let sent_at: String
    let recorded_at: String?
    let retroactive: Bool?
    let task_assignment: String
    let kind: String? // "timeout" | "cooldown"
    let status: String // "active" | "resolved"
    let pupil_name: String?
    let class_name: String?
    let sent_by_short: String?
    let sent_by_name: String?
    let resolved_at: String?
    let resolution_note: String?

    var isCooldown: Bool {
        kind == "cooldown"
    }
}

// MARK: - Schulstatistik (Minimalistic Factual Dashboard)

struct CardsSummaryTotals: Codable, Equatable {
    let green: Int
    let yellow: Int
    let red: Int
    let cooldown: Int
    let timeout: Int
    let total: Int
}

struct IncidentByDayOfWeek: Codable, Identifiable, Equatable {
    var id: Int { day }
    let day: Int
    let dayName: String
    let count: Int
}

struct IncidentByPeriod: Codable, Identifiable, Equatable {
    var id: Int { period }
    let period: Int
    let label: String
    let time: String
    let count: Int
}

struct CardsSummary: Codable, Equatable {
    let totals: CardsSummaryTotals
    let incidentsByDayOfWeek: [IncidentByDayOfWeek]
    let incidentsByPeriod: [IncidentByPeriod]
}

struct ClassBreakdownItem: Codable, Identifiable, Equatable {
    var id: Int { classId }
    let classId: Int
    let className: String
    let grade: Int
    let pupilCount: Int
    let green: Int
    let yellow: Int
    let red: Int
    let cooldown: Int
    let timeout: Int
    let totalCards: Int
    let totalIncidents: Int
}

struct PupilCardStat: Codable, Identifiable, Equatable {
    let id: Int
    let fullName: String
    let classId: Int
    let className: String
    let grade: Int
    let green: Int
    let yellow: Int
    let red: Int
    let timeout: Int
    let cooldown: Int
    let total: Int
}

struct StatClassOption: Codable, Identifiable, Equatable {
    let id: Int
    let name: String
    let grade: Int
}

struct StatisticsResponse: Codable {
    let classes: [StatClassOption]
    let cardsSummary: CardsSummary?
    let classBreakdown: [ClassBreakdownItem]?
    let pupilCardStats: [PupilCardStat]?
}
