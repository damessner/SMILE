import Foundation

/// Interactive in-memory backend used exclusively when an Apple App Review
/// reviewer signs in with the dedicated demo credentials (`demoUsername`).
/// Normal teacher accounts always authenticate against the school server.
@MainActor
final class DemoReviewService {
    static let demoUsername = "apple-review"
    static let demoPassword = "SmileReview2026!"

    static func matchesCredentials(username: String, password: String) -> Bool {
        username.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == demoUsername
            && password == demoPassword
    }

    let demoUser = User(
        id: "demo-review-user",
        username: demoUsername,
        role: "teacher",
        teacherId: 1,
        teacher: TeacherInfo(id: 1, shortName: "MES", fullName: "Demo Lehrperson"),
        mustChangePassword: false,
        viewAs: false,
        actUsername: nil,
        schoolWideBehaviour: true
    )

    private struct DemoPupilSeed {
        let id: Int
        let classId: Int
        let fullName: String
        let baseRank: String
    }

    private let classes: [SchoolClass] = [
        SchoolClass(
            id: 1,
            name: "3a",
            grade: 7,
            headTeacher1: "MES",
            headTeacher2: "HUB",
            canAccessRaster: true,
            canRate: true,
            isKv: true,
            mySubjects: [
                SubjectAssignment(code: "D", name: "Deutsch", isCoreSmile: true, hours: 4),
                SubjectAssignment(code: "M", name: "Mathematik", isCoreSmile: true, hours: 4)
            ]
        ),
        SchoolClass(
            id: 2,
            name: "3b",
            grade: 7,
            headTeacher1: "SCH",
            headTeacher2: "MAY",
            canAccessRaster: true,
            canRate: true,
            isKv: false,
            mySubjects: [
                SubjectAssignment(code: "D", name: "Deutsch", isCoreSmile: true, hours: 4)
            ]
        )
    ]

    private let pupilSeeds: [DemoPupilSeed] = [
        DemoPupilSeed(id: 101, classId: 1, fullName: "Muster Anna", baseRank: "Meister"),
        DemoPupilSeed(id: 102, classId: 1, fullName: "Beispiel Lukas", baseRank: "Geselle"),
        DemoPupilSeed(id: 103, classId: 1, fullName: "Demo Sophie", baseRank: "Meister"),
        DemoPupilSeed(id: 104, classId: 1, fullName: "Probe Noah", baseRank: "Lehrling"),
        DemoPupilSeed(id: 201, classId: 2, fullName: "Vorlage Mia", baseRank: "Meister"),
        DemoPupilSeed(id: 202, classId: 2, fullName: "Test Jonas", baseRank: "Geselle")
    ]

    private var cards: [ClassCardItem] = []
    private var timeouts: [TimeoutIncident] = []
    private var evaluations: [Evaluation] = []
    private var nextIdCounter = 100

    init() {
        reset()
    }

    func reset() {
        let now = isoString(Date())
        let earlier = isoString(Date().addingTimeInterval(-3600))
        let yesterday = isoString(Date().addingTimeInterval(-86400))

        cards = [
            ClassCardItem(
                id: "demo-c-1",
                pupil_id: 101,
                class_id: 1,
                teacher_id: 1,
                teacher_short: "MES",
                teacher_name: "Demo Lehrperson",
                card_type: "green",
                note: "Sehr hilfsbereit in der Gruppenarbeit",
                created_at: yesterday
            ),
            ClassCardItem(
                id: "demo-c-2",
                pupil_id: 101,
                class_id: 1,
                teacher_id: 1,
                teacher_short: "MES",
                teacher_name: "Demo Lehrperson",
                card_type: "green",
                note: "Vorbildliche Mitarbeit im Unterricht",
                created_at: earlier
            ),
            ClassCardItem(
                id: "demo-c-3",
                pupil_id: 102,
                class_id: 1,
                teacher_id: 1,
                teacher_short: "MES",
                teacher_name: "Demo Lehrperson",
                card_type: "yellow",
                note: "Arbeitsmaterial vergessen",
                created_at: yesterday
            ),
            ClassCardItem(
                id: "demo-c-4",
                pupil_id: 201,
                class_id: 2,
                teacher_id: 1,
                teacher_short: "MES",
                teacher_name: "Demo Lehrperson",
                card_type: "green",
                note: "Referat sauber vorbereitet",
                created_at: now
            )
        ]

        timeouts = [
            TimeoutIncident(
                id: "demo-to-1",
                pupil_id: 104,
                class_id: 1,
                sent_by_teacher_id: 1,
                sent_at: earlier,
                recorded_at: nil,
                retroactive: false,
                task_assignment: "Arbeitsauftrag S. 42 Nr. 1–4 selbstständig fertigstellen",
                kind: "timeout",
                status: "active",
                pupil_name: "Probe Noah",
                class_name: "3a",
                sent_by_short: "MES",
                sent_by_name: "Demo Lehrperson",
                resolved_at: nil,
                resolution_note: nil
            ),
            TimeoutIncident(
                id: "demo-to-2",
                pupil_id: 202,
                class_id: 2,
                sent_by_teacher_id: 1,
                sent_at: yesterday,
                recorded_at: nil,
                retroactive: false,
                task_assignment: "Reflexionsbogen ausgefüllt",
                kind: "timeout",
                status: "resolved",
                pupil_name: "Test Jonas",
                class_name: "3b",
                sent_by_short: "MES",
                sent_by_name: "Demo Lehrperson",
                resolved_at: earlier,
                resolution_note: "Aufgabe vollständig erledigt"
            )
        ]

        evaluations = [
            Evaluation(id: "demo-e-101-d", roundId: "demo-r1", pupilId: 101, classId: 1, subjectCode: "D", teacherId: 1, proposedStatus: "Meister", nextStep: nil, comment: nil, isSubmitted: true, items: []),
            Evaluation(id: "demo-e-101-m", roundId: "demo-r1", pupilId: 101, classId: 1, subjectCode: "M", teacherId: 1, proposedStatus: "Meister", nextStep: nil, comment: nil, isSubmitted: true, items: []),
            Evaluation(id: "demo-e-102-d", roundId: "demo-r1", pupilId: 102, classId: 1, subjectCode: "D", teacherId: 1, proposedStatus: "Geselle", nextStep: nil, comment: nil, isSubmitted: false, items: []),
            Evaluation(id: "demo-e-103-d", roundId: "demo-r1", pupilId: 103, classId: 1, subjectCode: "D", teacherId: 1, proposedStatus: "Meister", nextStep: nil, comment: nil, isSubmitted: false, items: []),
            Evaluation(id: "demo-e-201-d", roundId: "demo-r1", pupilId: 201, classId: 2, subjectCode: "D", teacherId: 1, proposedStatus: "Meister", nextStep: nil, comment: nil, isSubmitted: true, items: [])
        ]

        nextIdCounter = 100
    }

    // MARK: - Queries

    func getCurrentTimetable() -> TimetableResponse {
        let current = TimetableLesson(
            id: 1,
            classId: 1,
            className: "3a",
            teacherId: 1,
            teacherShort: "MES",
            subjectCode: "D",
            subjectName: "Deutsch",
            room: "R204",
            dayOfWeek: 2,
            period: 3
        )
        return TimetableResponse(
            isTeacher: true,
            dayOfWeek: 2,
            period: 3,
            periodInfo: PeriodInfo(period: 3, start: "09:50", end: "10:40", label: "3. Stunde"),
            isSchoolHours: true,
            currentLesson: current,
            nextLesson: nil,
            todayLessons: [current],
            weekLessonsCount: 22
        )
    }

    func getClasses() -> [SchoolClass] {
        classes
    }

    func getClassPupils(classId: Int) -> ClassPupilsResponse {
        let schoolClass = classes.first(where: { $0.id == classId }) ?? classes[0]
        let list = pupilSeeds
            .filter { $0.classId == classId }
            .map { buildPupilWithData($0) }

        return ClassPupilsResponse(
            pupils: list,
            canAccessRaster: schoolClass.canAccessRaster,
            canRate: schoolClass.canRate,
            isKv: schoolClass.isKv,
            mySubjects: schoolClass.mySubjects,
            submissionDeadline: "2026-12-18T12:00:00.000Z",
            isLockedByConference: false
        )
    }

    func getClassCards(classId: Int) -> [ClassCardItem] {
        cards.filter { $0.class_id == classId }
    }

    func getClassTimeouts(classId: Int) -> [TimeoutIncident] {
        timeouts.filter { $0.class_id == classId }
    }

    func getActiveTimeouts() -> [TimeoutIncident] {
        timeouts.filter { $0.status == "active" }
    }

    func getTimeoutHistory() -> [TimeoutIncident] {
        timeouts.filter { $0.status == "resolved" }
    }

    func getStatistics(classId: String) -> StatisticsResponse {
        let filterClassId = Int(classId)
        let scopedCards = filterClassId == nil ? cards : cards.filter { $0.class_id == filterClassId }
        let scopedTimeouts = filterClassId == nil ? timeouts : timeouts.filter { $0.class_id == filterClassId }

        let green = scopedCards.filter { $0.card_type == "green" }.count
        let yellow = scopedCards.filter { $0.card_type == "yellow" }.count
        let red = scopedCards.filter { $0.card_type == "red" }.count
        let cooldown = scopedCards.filter { $0.card_type == "cooldown" }.count + scopedTimeouts.filter { $0.kind == "cooldown" }.count
        let timeout = scopedTimeouts.filter { $0.kind != "cooldown" }.count

        let summary = CardsSummary(
            totals: CardsSummaryTotals(
                green: green,
                yellow: yellow,
                red: red,
                cooldown: cooldown,
                timeout: timeout,
                total: green + yellow + red + cooldown + timeout
            ),
            incidentsByDayOfWeek: [
                IncidentByDayOfWeek(day: 1, dayName: "Mo", count: max(1, yellow)),
                IncidentByDayOfWeek(day: 2, dayName: "Di", count: max(1, timeout)),
                IncidentByDayOfWeek(day: 3, dayName: "Mi", count: max(1, green / 2)),
                IncidentByDayOfWeek(day: 4, dayName: "Do", count: 1),
                IncidentByDayOfWeek(day: 5, dayName: "Fr", count: 1)
            ],
            incidentsByPeriod: [
                IncidentByPeriod(period: 1, label: "1. Std", time: "07:50", count: 1),
                IncidentByPeriod(period: 2, label: "2. Std", time: "08:45", count: 2),
                IncidentByPeriod(period: 3, label: "3. Std", time: "09:50", count: max(1, timeout))
            ]
        )

        let breakdown: [ClassBreakdownItem] = classes.map { cls in
            let cCards = cards.filter { $0.class_id == cls.id }
            let cTos = timeouts.filter { $0.class_id == cls.id }
            let g = cCards.filter { $0.card_type == "green" }.count
            let y = cCards.filter { $0.card_type == "yellow" }.count
            let r = cCards.filter { $0.card_type == "red" }.count
            let cd = cCards.filter { $0.card_type == "cooldown" }.count + cTos.filter { $0.kind == "cooldown" }.count
            let to = cTos.filter { $0.kind != "cooldown" }.count
            return ClassBreakdownItem(
                classId: cls.id,
                className: cls.name,
                grade: cls.grade ?? 7,
                pupilCount: pupilSeeds.filter { $0.classId == cls.id }.count,
                green: g,
                yellow: y,
                red: r,
                cooldown: cd,
                timeout: to,
                totalCards: g + y + r,
                totalIncidents: to + cd
            )
        }

        let pupilStats: [PupilCardStat] = pupilSeeds
            .filter { filterClassId == nil || $0.classId == filterClassId }
            .map { seed in
                let pCards = cards.filter { $0.pupil_id == seed.id }
                let pTos = timeouts.filter { $0.pupil_id == seed.id }
                let cls = classes.first(where: { $0.id == seed.classId })
                let g = pCards.filter { $0.card_type == "green" }.count
                let y = pCards.filter { $0.card_type == "yellow" }.count
                let r = pCards.filter { $0.card_type == "red" }.count
                let cd = pCards.filter { $0.card_type == "cooldown" }.count + pTos.filter { $0.kind == "cooldown" }.count
                let to = pTos.filter { $0.kind != "cooldown" }.count
                return PupilCardStat(
                    id: seed.id,
                    fullName: seed.fullName,
                    classId: seed.classId,
                    className: cls?.name ?? "3a",
                    grade: cls?.grade ?? 7,
                    green: g,
                    yellow: y,
                    red: r,
                    timeout: to,
                    cooldown: cd,
                    total: g + y + r + to + cd
                )
            }

        return StatisticsResponse(
            classes: classes.map { StatClassOption(id: $0.id, name: $0.name, grade: $0.grade ?? 7) },
            cardsSummary: summary,
            classBreakdown: breakdown,
            pupilCardStats: pupilStats
        )
    }

    func getBehaviorOverview() -> BehaviorOverview {
        let overviewPupils: [BehaviorOverviewPupil] = pupilSeeds.map { seed in
            let cls = classes.first(where: { $0.id == seed.classId })
            let pCards = cards.filter { $0.pupil_id == seed.id }
            let pTos = timeouts.filter { $0.pupil_id == seed.id }
            let active = pTos.first(where: { $0.status == "active" })
            let g = pCards.filter { $0.card_type == "green" }.count
            let y = pCards.filter { $0.card_type == "yellow" }.count
            let r = pCards.filter { $0.card_type == "red" }.count
            let cd = pCards.filter { $0.card_type == "cooldown" }.count + pTos.filter { $0.kind == "cooldown" }.count
            let to = pTos.filter { $0.kind != "cooldown" }.count
            let stage = computeStage(green: g, yellow: y, red: r, timeout: to)

            return BehaviorOverviewPupil(
                id: seed.id,
                fullName: seed.fullName,
                classId: seed.classId,
                className: cls?.name ?? "3a",
                grade: cls?.grade ?? 7,
                rank: buildPupilWithData(seed).effectiveRank().rawValue,
                stage: BehaviorOverviewStage(
                    level: stage.currentStage,
                    title: stage.stageInfo.title,
                    type: stage.stageInfo.type,
                    behaviorGrade: stage.behaviorGrade
                ),
                counts: BehaviorOverviewCounts(
                    green: g,
                    yellow: y,
                    red: r,
                    timeout: to,
                    cooldown: cd
                ),
                activeIncident: active.map {
                    BehaviorOverviewIncident(
                        id: $0.id,
                        kind: $0.kind ?? "timeout",
                        sentAt: $0.sent_at,
                        taskAssignment: $0.task_assignment
                    )
                },
                canRecord: true
            )
        }

        return BehaviorOverview(
            schoolWide: true,
            classes: classes.map { StatClassOption(id: $0.id, name: $0.name, grade: $0.grade ?? 7) },
            pupils: overviewPupils
        )
    }

    func getPupilBehaviorProfile(pupilId: Int) -> PupilBehaviorProfile {
        let seed = pupilSeeds.first(where: { $0.id == pupilId }) ?? pupilSeeds[0]
        let cls = classes.first(where: { $0.id == seed.classId })
        let pCards = cards.filter { $0.pupil_id == seed.id }
        let pTos = timeouts.filter { $0.pupil_id == seed.id }

        let g = pCards.filter { $0.card_type == "green" }.count
        let y = pCards.filter { $0.card_type == "yellow" }.count
        let r = pCards.filter { $0.card_type == "red" }.count
        let to = pTos.filter { $0.kind != "cooldown" }.count
        let calculation = computeStage(green: g, yellow: y, red: r, timeout: to)
        let effective = buildPupilWithData(seed).effectiveRank().rawValue

        return PupilBehaviorProfile(
            pupil: PupilBehaviorProfileSummary(
                id: seed.id,
                fullName: seed.fullName,
                classId: seed.classId,
                className: cls?.name ?? "3a",
                currentRank: effective
            ),
            calculation: calculation,
            actions: [
                PupilBehaviorActionItem(
                    id: "demo-act-\(seed.id)",
                    stage_level: calculation.currentStage,
                    stage_title: calculation.stageInfo.title,
                    status: "documented",
                    action_date: "2026-11-15",
                    notes: "Beispiel-Maßnahme im Demo-Modus",
                    teacher_short: "MES",
                    teacher_name: "Demo Lehrperson",
                    created_at: isoString(Date())
                )
            ]
        )
    }

    // MARK: - Mutations

    func issueCard(pupilId: Int, classId: Int, cardType: String, note: String?) {
        nextIdCounter += 1
        cards.insert(
            ClassCardItem(
                id: "demo-c-\(nextIdCounter)",
                pupil_id: pupilId,
                class_id: classId,
                teacher_id: 1,
                teacher_short: "MES",
                teacher_name: "Demo Lehrperson",
                card_type: cardType,
                note: note,
                created_at: isoString(Date())
            ),
            at: 0
        )
    }

    func revokeCard(cardId: String) {
        cards.removeAll { $0.id == cardId }
    }

    func sendToTimeout(pupilId: Int, classId: Int, kind: String, taskAssignment: String) {
        nextIdCounter += 1
        let seed = pupilSeeds.first(where: { $0.id == pupilId })
        let cls = classes.first(where: { $0.id == classId })
        timeouts.insert(
            TimeoutIncident(
                id: "demo-to-\(nextIdCounter)",
                pupil_id: pupilId,
                class_id: classId,
                sent_by_teacher_id: 1,
                sent_at: isoString(Date()),
                recorded_at: nil,
                retroactive: false,
                task_assignment: taskAssignment,
                kind: kind,
                status: "active",
                pupil_name: seed?.fullName ?? "Schüler*in",
                class_name: cls?.name ?? "3a",
                sent_by_short: "MES",
                sent_by_name: "Demo Lehrperson",
                resolved_at: nil,
                resolution_note: nil
            ),
            at: 0
        )
    }

    func resolveTimeout(id: String, resolutionNote: String?) {
        guard let idx = timeouts.firstIndex(where: { $0.id == id }) else { return }
        let old = timeouts[idx]
        timeouts[idx] = TimeoutIncident(
            id: old.id,
            pupil_id: old.pupil_id,
            class_id: old.class_id,
            sent_by_teacher_id: old.sent_by_teacher_id,
            sent_at: old.sent_at,
            recorded_at: old.recorded_at,
            retroactive: old.retroactive,
            task_assignment: old.task_assignment,
            kind: old.kind,
            status: "resolved",
            pupil_name: old.pupil_name,
            class_name: old.class_name,
            sent_by_short: old.sent_by_short,
            sent_by_name: old.sent_by_name,
            resolved_at: isoString(Date()),
            resolution_note: resolutionNote
        )
    }

    func saveEvaluation(pupilId: Int, classId: Int, subjectCode: String, rank: String, submit: Bool) {
        if let idx = evaluations.firstIndex(where: {
            $0.pupilId == pupilId && $0.subjectCode.caseInsensitiveCompare(subjectCode) == .orderedSame
        }) {
            let old = evaluations[idx]
            evaluations[idx] = Evaluation(
                id: old.id,
                roundId: old.roundId,
                pupilId: pupilId,
                classId: classId,
                subjectCode: old.subjectCode,
                teacherId: 1,
                proposedStatus: rank,
                nextStep: old.nextStep,
                comment: old.comment,
                isSubmitted: submit ? true : old.isSubmitted,
                items: old.items
            )
        } else {
            nextIdCounter += 1
            evaluations.append(
                Evaluation(
                    id: "demo-e-\(nextIdCounter)",
                    roundId: "demo-r1",
                    pupilId: pupilId,
                    classId: classId,
                    subjectCode: subjectCode,
                    teacherId: 1,
                    proposedStatus: rank,
                    nextStep: nil,
                    comment: nil,
                    isSubmitted: submit,
                    items: []
                )
            )
        }
    }

    func reopenEvaluation(pupilId: Int, subjectCode: String) {
        guard let idx = evaluations.firstIndex(where: {
            $0.pupilId == pupilId && $0.subjectCode.caseInsensitiveCompare(subjectCode) == .orderedSame
        }) else { return }
        let old = evaluations[idx]
        evaluations[idx] = Evaluation(
            id: old.id,
            roundId: old.roundId,
            pupilId: old.pupilId,
            classId: old.classId,
            subjectCode: old.subjectCode,
            teacherId: old.teacherId,
            proposedStatus: old.proposedStatus,
            nextStep: old.nextStep,
            comment: old.comment,
            isSubmitted: false,
            items: old.items
        )
    }

    // MARK: - Helpers

    private func buildPupilWithData(_ seed: DemoPupilSeed) -> PupilWithData {
        let pCards = cards.filter { $0.pupil_id == seed.id }
        let g = pCards.filter { $0.card_type == "green" }.count
        let y = pCards.filter { $0.card_type == "yellow" }.count
        let r = pCards.filter { $0.card_type == "red" }.count
        let demotions = r + (y / 3)
        let pEvals = evaluations.filter { $0.pupilId == seed.id }

        return PupilWithData(
            id: seed.id,
            classId: seed.classId,
            fullName: seed.fullName,
            isArchived: false,
            evaluations: pEvals,
            cards: nil,
            greenCardCount: g,
            yellowCardCount: y,
            redCardCount: r,
            rankDemotionSteps: demotions,
            finalRank: seed.baseRank
        )
    }

    private func computeStage(green: Int, yellow: Int, red: Int, timeout: Int) -> PupilStageCalculation {
        let consequence = min(4, red + timeout + (yellow >= 3 ? 1 : 0))
        let positive = green >= 3 ? 1 : 0
        let level = consequence > 0 ? consequence : positive
        let title = level > 0 && consequence > 0 ? "Stufe \(level) (Rückmeldung)" : (positive > 0 ? "Auszeichnung" : "Regelkonform")
        let grade = level >= 3 ? "Wenig zufriedenstellend" : (level >= 1 ? "Zufriedenstellend" : "Sehr zufriedenstellend")
        return PupilStageCalculation(
            currentStage: level,
            positiveStage: positive,
            consequenceStage: consequence,
            stageInfo: BehaviorStageInfo(
                level: level,
                title: title,
                type: consequence > 0 ? "consequence" : "positive",
                description: "Demo-Verhaltensstufe für die Überprüfung im Schulalltag.",
                thresholdLabel: "Demo",
                defaultGrade: grade
            ),
            behaviorGrade: grade,
            stats: BehaviorStageStats(
                greenCount: green,
                yellowCount: yellow,
                redCount: red,
                timeoutCount: timeout
            )
        )
    }

    private func isoString(_ date: Date) -> String {
        let fmt = ISO8601DateFormatter()
        fmt.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fmt.string(from: date)
    }
}
