import SwiftUI

struct SchoolStatisticsView: View {
    @EnvironmentObject var api: APIClient
    let user: User

    // Default when clicking on "Schulstatistik" is ALWAYS "all" (Alle Klassen) for everyone
    @State private var selectedClassId: String = "all"
    @State private var stats: StatisticsResponse?
    @State private var isLoading = false
    @State private var errorMessage: String?

    @State private var searchQuery = ""
    @State private var pupilFilter: PupilFilter = .all

    enum PupilFilter: String, CaseIterable {
        case all = "Alle"
        case hasCards = "Mit Einträgen"
        case green = "Grün"
        case yellow = "Gelb"
        case red = "Rot"
        case timeout = "Time-Out"
    }

    private var filteredPupils: [PupilCardStat] {
        let list = stats?.pupilCardStats ?? []
        return list.filter { p in
            let matchesSearch = searchQuery.isEmpty
                || p.fullName.localizedCaseInsensitiveContains(searchQuery)
                || p.className.localizedCaseInsensitiveContains(searchQuery)
            guard matchesSearch else { return false }

            switch pupilFilter {
            case .all: return true
            case .hasCards: return p.total > 0
            case .green: return p.green > 0
            case .yellow: return p.yellow > 0
            case .red: return p.red > 0
            case .timeout: return p.timeout > 0
            }
        }
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                // Class Filter Bar (Default: Alle Klassen)
                filterBar

                if let error = errorMessage {
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(.red)
                        .padding()
                }

                if isLoading && stats == nil {
                    ProgressView("Statistik wird geladen…")
                        .padding(.top, 40)
                } else if let totals = stats?.cardsSummary?.totals {
                    // 1. Factual KPI Grid
                    kpiGrid(totals: totals)

                    // 2. Colorful Distribution Bar with Details
                    distributionCard(totals: totals)

                    // 3. Temporal Distribution (Wochentage & Stunden)
                    if let summary = stats?.cardsSummary {
                        temporalDistributionSection(summary: summary)
                    }

                    // 4. Class Overview with Color Strips
                    if let classes = stats?.classBreakdown, !classes.isEmpty {
                        classBreakdownSection(classes: classes)
                    }

                    // 5. Pupil Table with Individual Color Strips
                    pupilStatsSection
                }
            }
            .padding()
        }
        .background(Color(red: 0.03, green: 0.04, blue: 0.07))
        .navigationTitle("Schulstatistik")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $searchQuery, prompt: "Schüler*in oder Klasse suchen…")
        .refreshable {
            await loadStatistics()
        }
        .task(id: selectedClassId) {
            await loadStatistics()
        }
    }

    // MARK: - Subviews

    private var filterBar: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("Karten- & Vorfallsstatistik")
                    .font(.headline.weight(.bold))
                Text("Rein faktenbasierte Übersicht nach Farben, Zeiten und Klassen")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            Menu {
                Button {
                    selectedClassId = "all"
                } label: {
                    HStack {
                        Text("Alle Klassen (Schulweit)")
                        if selectedClassId == "all" { Image(systemName: "checkmark") }
                    }
                }

                Divider()

                ForEach(stats?.classes ?? []) { cls in
                    Button {
                        selectedClassId = String(cls.id)
                    } label: {
                        HStack {
                            Text("Klasse \(cls.name)")
                            if selectedClassId == String(cls.id) { Image(systemName: "checkmark") }
                        }
                    }
                }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "line.3.horizontal.decrease.circle.fill")
                    Text(selectedClassLabel)
                        .fontWeight(.bold)
                    Image(systemName: "chevron.down")
                        .font(.caption2)
                }
                .font(.caption)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(Color.blue.opacity(0.22), in: Capsule())
                .foregroundStyle(.white)
            }
        }
    }

    private var selectedClassLabel: String {
        if selectedClassId == "all" {
            return "Alle Klassen (Schulweit)"
        }
        if let found = stats?.classes.first(where: { String($0.id) == selectedClassId }) {
            return "Klasse \(found.name)"
        }
        return "Alle Klassen"
    }

    private func kpiGrid(totals: CardsSummaryTotals) -> some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 135), spacing: 10)], spacing: 10) {
            kpiCard(title: "Gesamt", count: totals.total, color: .white, icon: "number.circle.fill")
            kpiCard(title: "Grün", count: totals.green, color: .green, icon: "circle.fill")
            kpiCard(title: "Gelb", count: totals.yellow, color: .yellow, icon: "circle.fill")
            kpiCard(title: "Rot", count: totals.red, color: .red, icon: "circle.fill")
            kpiCard(title: "Time-Out", count: totals.timeout, color: .orange, icon: "clock.fill")
            kpiCard(title: "Cool-Down", count: totals.cooldown, color: .cyan, icon: "snowflake")
        }
    }

    private func kpiCard(title: String, count: Int, color: Color, icon: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.caption)
                    .foregroundStyle(color)
                Text(title)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
            Text("\(count)")
                .font(.title2.weight(.heavy))
                .foregroundStyle(color)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Color(red: 0.06, green: 0.08, blue: 0.13), in: RoundedRectangle(cornerRadius: 16))
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(color.opacity(0.2), lineWidth: 1)
        )
    }

    private func distributionCard(totals: CardsSummaryTotals) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Farbverteilung der Einträge")
                    .font(.subheadline.weight(.bold))
                Spacer()
                Text("\(totals.total) Einträge")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            ColorDistributionBar(
                green: totals.green,
                yellow: totals.yellow,
                red: totals.red,
                timeout: totals.timeout,
                cooldown: totals.cooldown,
                height: 22
            )

            // Percentage Breakdown Legend
            let sum = max(1, totals.total)
            HStack(spacing: 12) {
                legendDot(label: "Grün", count: totals.green, pct: Int(round(Double(totals.green) / Double(sum) * 100)), color: .green)
                legendDot(label: "Gelb", count: totals.yellow, pct: Int(round(Double(totals.yellow) / Double(sum) * 100)), color: .yellow)
                legendDot(label: "Rot", count: totals.red, pct: Int(round(Double(totals.red) / Double(sum) * 100)), color: .red)
                legendDot(label: "Time-Out", count: totals.timeout, pct: Int(round(Double(totals.timeout) / Double(sum) * 100)), color: .orange)
                legendDot(label: "Cool-Down", count: totals.cooldown, pct: Int(round(Double(totals.cooldown) / Double(sum) * 100)), color: .cyan)
            }
            .font(.caption2)
        }
        .padding(16)
        .background(Color(red: 0.06, green: 0.08, blue: 0.13), in: RoundedRectangle(cornerRadius: 18))
    }

    private func legendDot(label: String, count: Int, pct: Int, color: Color) -> some View {
        HStack(spacing: 4) {
            Circle().fill(color).frame(width: 7, height: 7)
            Text("\(label): \(count) (\(pct)%)")
                .foregroundStyle(.secondary)
        }
    }

    private func temporalDistributionSection(summary: CardsSummary) -> some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: 14) {
                dayDistributionCard(days: summary.incidentsByDayOfWeek)
                periodDistributionCard(periods: summary.incidentsByPeriod)
            }
            VStack(spacing: 14) {
                dayDistributionCard(days: summary.incidentsByDayOfWeek)
                periodDistributionCard(periods: summary.incidentsByPeriod)
            }
        }
    }

    private func dayDistributionCard(days: [IncidentByDayOfWeek]) -> some View {
        let maxCount = max(1, days.map(\.count).max() ?? 1)
        return VStack(alignment: .leading, spacing: 10) {
            Text("Vorfälle nach Wochentag")
                .font(.subheadline.weight(.bold))

            ForEach(days) { item in
                HStack(spacing: 10) {
                    Text(item.dayName)
                        .font(.caption.weight(.medium))
                        .frame(width: 80, alignment: .leading)

                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Capsule()
                                .fill(Color.white.opacity(0.06))
                            Capsule()
                                .fill(Color.orange)
                                .frame(width: geo.size.width * CGFloat(item.count) / CGFloat(maxCount))
                        }
                    }
                    .frame(height: 10)

                    Text("\(item.count)")
                        .font(.caption.weight(.bold))
                        .frame(width: 28, alignment: .trailing)
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(red: 0.06, green: 0.08, blue: 0.13), in: RoundedRectangle(cornerRadius: 18))
    }

    private func periodDistributionCard(periods: [IncidentByPeriod]) -> some View {
        let maxCount = max(1, periods.map(\.count).max() ?? 1)
        return VStack(alignment: .leading, spacing: 10) {
            Text("Vorfälle nach Unterrichtsstunde")
                .font(.subheadline.weight(.bold))

            ForEach(periods) { item in
                HStack(spacing: 10) {
                    VStack(alignment: .leading, spacing: 0) {
                        Text(item.label)
                            .font(.caption.weight(.medium))
                        Text(item.time)
                            .font(.system(size: 9))
                            .foregroundStyle(.secondary)
                    }
                    .frame(width: 85, alignment: .leading)

                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Capsule()
                                .fill(Color.white.opacity(0.06))
                            Capsule()
                                .fill(Color.red.opacity(0.85))
                                .frame(width: geo.size.width * CGFloat(item.count) / CGFloat(maxCount))
                        }
                    }
                    .frame(height: 10)

                    Text("\(item.count)")
                        .font(.caption.weight(.bold))
                        .frame(width: 28, alignment: .trailing)
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(red: 0.06, green: 0.08, blue: 0.13), in: RoundedRectangle(cornerRadius: 18))
    }

    private func classBreakdownSection(classes: [ClassBreakdownItem]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Klassenübersicht")
                .font(.subheadline.weight(.bold))

            ForEach(classes) { cls in
                VStack(spacing: 8) {
                    HStack {
                        Text("Klasse \(cls.className)")
                            .font(.subheadline.weight(.bold))
                        Text("(\(cls.pupilCount) Schüler*innen)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Spacer()
                        HStack(spacing: 8) {
                            statBadge(count: cls.green, color: .green)
                            statBadge(count: cls.yellow, color: .yellow)
                            statBadge(count: cls.red, color: .red)
                            statBadge(count: cls.timeout, color: .orange)
                            statBadge(count: cls.cooldown, color: .cyan)
                        }
                    }

                    ColorDistributionBar(
                        green: cls.green,
                        yellow: cls.yellow,
                        red: cls.red,
                        timeout: cls.timeout,
                        cooldown: cls.cooldown,
                        height: 8
                    )
                }
                .padding(12)
                .background(Color.white.opacity(0.03), in: RoundedRectangle(cornerRadius: 12))
            }
        }
        .padding(16)
        .background(Color(red: 0.06, green: 0.08, blue: 0.13), in: RoundedRectangle(cornerRadius: 18))
    }

    private var pupilStatsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Schülerübersicht (\(filteredPupils.count))")
                    .font(.subheadline.weight(.bold))
                Spacer()
            }

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(PupilFilter.allCases, id: \.self) { filter in
                        Button {
                            pupilFilter = filter
                        } label: {
                            Text(filter.rawValue)
                                .font(.caption.weight(.semibold))
                                .padding(.horizontal, 10)
                                .padding(.vertical, 5)
                                .background(
                                    pupilFilter == filter ? Color.blue : Color.white.opacity(0.06),
                                    in: Capsule()
                                )
                                .foregroundStyle(.white)
                        }
                    }
                }
            }

            ForEach(filteredPupils.prefix(100)) { pupil in
                HStack(spacing: 10) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(pupil.fullName)
                            .font(.subheadline.weight(.semibold))
                        Text("Klasse \(pupil.className)")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }

                    Spacer()

                    ColorDistributionBar(
                        green: pupil.green,
                        yellow: pupil.yellow,
                        red: pupil.red,
                        timeout: pupil.timeout,
                        cooldown: pupil.cooldown,
                        height: 8
                    )
                    .frame(width: 90)

                    HStack(spacing: 6) {
                        statBadge(count: pupil.green, color: .green)
                        statBadge(count: pupil.yellow, color: .yellow)
                        statBadge(count: pupil.red, color: .red)
                        statBadge(count: pupil.timeout, color: .orange)
                        statBadge(count: pupil.cooldown, color: .cyan)
                    }
                }
                .padding(.vertical, 6)
                Divider()
            }
        }
        .padding(16)
        .background(Color(red: 0.06, green: 0.08, blue: 0.13), in: RoundedRectangle(cornerRadius: 18))
    }

    private func statBadge(count: Int, color: Color) -> some View {
        Text("\(count)")
            .font(.caption2.weight(.bold))
            .frame(minWidth: 22)
            .padding(.vertical, 2)
            .background(count > 0 ? color.opacity(0.2) : Color.white.opacity(0.03), in: RoundedRectangle(cornerRadius: 5))
            .foregroundStyle(count > 0 ? color : .secondary.opacity(0.4))
    }

    private func loadStatistics() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            stats = try await api.getStatistics(classId: selectedClassId)
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

/// Interactive proportional color bar showing Grün, Gelb, Rot, Time-Out, Cool-Down.
struct ColorDistributionBar: View {
    let green: Int
    let yellow: Int
    let red: Int
    let timeout: Int
    let cooldown: Int
    let height: CGFloat

    private var total: Int {
        green + yellow + red + timeout + cooldown
    }

    var body: some View {
        GeometryReader { geo in
            if total == 0 {
                Capsule()
                    .fill(Color.white.opacity(0.06))
            } else {
                HStack(spacing: 1) {
                    if green > 0 {
                        Rectangle()
                            .fill(Color.green)
                            .frame(width: max(4, geo.size.width * CGFloat(green) / CGFloat(total)))
                    }
                    if yellow > 0 {
                        Rectangle()
                            .fill(Color.yellow)
                            .frame(width: max(4, geo.size.width * CGFloat(yellow) / CGFloat(total)))
                    }
                    if red > 0 {
                        Rectangle()
                            .fill(Color.red)
                            .frame(width: max(4, geo.size.width * CGFloat(red) / CGFloat(total)))
                    }
                    if timeout > 0 {
                        Rectangle()
                            .fill(Color.orange)
                            .frame(width: max(4, geo.size.width * CGFloat(timeout) / CGFloat(total)))
                    }
                    if cooldown > 0 {
                        Rectangle()
                            .fill(Color.cyan)
                            .frame(width: max(4, geo.size.width * CGFloat(cooldown) / CGFloat(total)))
                    }
                }
                .clipShape(Capsule())
            }
        }
        .frame(height: height)
    }
}
