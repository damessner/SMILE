import Foundation
import Security

enum APIError: LocalizedError {
    case invalidURL
    case unauthorized(String)
    case passwordChangeRequired
    case serverError(status: Int, message: String, code: String?)
    case networkError(Error)
    case decodingError(String)

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Ungültige Server-Adresse."
        case .unauthorized(let msg):
            return msg
        case .passwordChangeRequired:
            return "Bitte ändern Sie zuerst Ihr Start-Passwort."
        case .serverError(_, let msg, _):
            return msg
        case .networkError(let err):
            if let urlErr = err as? URLError {
                switch urlErr.code {
                case .cannotConnectToHost, .timedOut, .cannotFindHost, .networkConnectionLost, .notConnectedToInternet:
                    return "SMILE-Server nicht erreichbar. Bitte Schul-WLAN und unter Einstellungen → SMILE „Lokales Netzwerk“ prüfen."
                case .serverCertificateUntrusted, .serverCertificateHasUnknownRoot, .secureConnectionFailed, .clientCertificateRejected:
                    return "TLS-Zertifikat des SMILE-Servers nicht vertrauenswürdig. Bitte Server-Adresse prüfen oder Admin kontaktieren."
                default:
                    break
                }
            }
            return "Netzwerkfehler: \(err.localizedDescription)"
        case .decodingError(let detail):
            return "Antwort des Servers konnte nicht verarbeitet werden (\(detail))."
        }
    }
}

/// Validates TLS connections against the bundled SMILE Internal Caddy Root CA (`smile-internal-ca.cer`)
/// in addition to the system trust store.
final class InternalCATrustDelegate: NSObject, URLSessionDelegate, Sendable {
    private let pinnedRootCert: SecCertificate? = {
        guard let url = Bundle.main.url(forResource: "smile-internal-ca", withExtension: "cer"),
              let data = try? Data(contentsOf: url) as CFData,
              let cert = SecCertificateCreateWithData(nil, data) else {
            return nil
        }
        return cert
    }()

    func urlSession(
        _ session: URLSession,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              let serverTrust = challenge.protectionSpace.serverTrust else {
            completionHandler(.performDefaultHandling, nil)
            return
        }

        if let rootCert = pinnedRootCert {
            SecTrustSetAnchorCertificates(serverTrust, [rootCert] as CFArray)
            SecTrustSetAnchorCertificatesOnly(serverTrust, false)
        }

        var error: CFError?
        if SecTrustEvaluateWithError(serverTrust, &error) {
            completionHandler(.useCredential, URLCredential(trust: serverTrust))
        } else {
            completionHandler(.cancelAuthenticationChallenge, nil)
        }
    }
}

@MainActor
final class APIClient: ObservableObject {
    static let shared = APIClient()

    private static let serverURLKey = "smile_server_base_url"
    static let defaultServerURL = "https://172.16.1.11"

    @Published var baseURL: String {
        didSet {
            UserDefaults.standard.set(baseURL, forKey: Self.serverURLKey)
        }
    }

    @Published var currentUser: User?
    @Published var isAuthenticated = false
    @Published private(set) var isDemoMode = false

    private let demoService = DemoReviewService()
    private let session: URLSession
    private let trustDelegate = InternalCATrustDelegate()

    static func isAllowedServerURL(_ raw: String) -> Bool {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "/+$", with: "", options: .regularExpression)
        guard let url = URL(string: trimmed),
              let scheme = url.scheme?.lowercased(),
              let host = url.host?.lowercased(),
              !host.isEmpty else {
            return false
        }
        if scheme == "https" {
            return true
        }
        return scheme == "http" && (host == "localhost" || host == "127.0.0.1")
    }

    private init() {
        let saved = UserDefaults.standard.string(forKey: Self.serverURLKey)
        if let saved, Self.isAllowedServerURL(saved) {
            self.baseURL = saved.trimmingCharacters(in: .whitespacesAndNewlines)
                .replacingOccurrences(of: "/+$", with: "", options: .regularExpression)
        } else {
            self.baseURL = Self.defaultServerURL
        }

        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.httpCookieAcceptPolicy = .always
        config.httpShouldSetCookies = true
        config.httpCookieStorage = HTTPCookieStorage.shared
        self.session = URLSession(configuration: config, delegate: trustDelegate, delegateQueue: nil)
    }

    private func makeURL(_ path: String) throws -> URL {
        let trimmedBase = baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "/+$", with: "", options: .regularExpression)
        guard Self.isAllowedServerURL(trimmedBase),
              let url = URL(string: "\(trimmedBase)/api\(path)") else {
            throw APIError.invalidURL
        }
        return url
    }

    private func perform(
        _ path: String,
        method: String = "GET",
        body: [String: Any]? = nil
    ) async throws -> Data {
        let url = try makeURL(path)
        var req = URLRequest(url: url)
        req.mainDocumentURL = url
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Accept")

        if let body = body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: req)
        } catch {
            throw APIError.networkError(error)
        }

        guard let http = response as? HTTPURLResponse else {
            throw APIError.serverError(status: 0, message: "Ungültige Serverantwort.", code: nil)
        }

        if (200...299).contains(http.statusCode) {
            return data
        }

        let errPayload = try? JSONDecoder().decode(APIErrorPayload.self, from: data)
        let message = errPayload?.error ?? "Anfrage fehlgeschlagen (\(http.statusCode))"
        let code = errPayload?.code

        if http.statusCode == 401 && path != "/auth/login" && code != "INVALID_CURRENT_PASSWORD" {
            self.currentUser = nil
            self.isAuthenticated = false
            throw APIError.unauthorized(message)
        }

        if http.statusCode == 403 && code == "PASSWORD_CHANGE_REQUIRED" {
            throw APIError.passwordChangeRequired
        }

        throw APIError.serverError(status: http.statusCode, message: message, code: code)
    }

    private func request<T: Decodable>(
        _ path: String,
        method: String = "GET",
        body: [String: Any]? = nil
    ) async throws -> T {
        let data = try await perform(path, method: method, body: body)
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw APIError.decodingError(error.localizedDescription)
        }
    }

    /// For write endpoints whose response body the app does not need.
    private func requestWithoutResponse(
        _ path: String,
        method: String = "POST",
        body: [String: Any]? = nil
    ) async throws {
        _ = try await perform(path, method: method, body: body)
    }

    // MARK: - Auth

    func login(username: String, password: String) async throws -> User {
        if DemoReviewService.matchesCredentials(username: username, password: password) {
            demoService.reset()
            self.isDemoMode = true
            self.currentUser = demoService.demoUser
            self.isAuthenticated = true
            return demoService.demoUser
        }
        self.isDemoMode = false
        let res: LoginResponse = try await request(
            "/auth/login",
            method: "POST",
            body: ["username": username, "password": password]
        )
        self.currentUser = res.user
        self.isAuthenticated = true
        return res.user
    }

    func checkSession() async {
        if isDemoMode {
            self.currentUser = demoService.demoUser
            self.isAuthenticated = true
            return
        }
        do {
            let res: MeResponse = try await request("/auth/me")
            self.currentUser = res.user
            self.isAuthenticated = true
        } catch {
            self.currentUser = nil
            self.isAuthenticated = false
        }
    }

    func logout() async {
        if isDemoMode {
            self.isDemoMode = false
            self.currentUser = nil
            self.isAuthenticated = false
            return
        }
        struct EmptyResponse: Decodable {}
        _ = try? await request("/auth/logout", method: "POST") as EmptyResponse
        if let cookies = HTTPCookieStorage.shared.cookies {
            for cookie in cookies {
                HTTPCookieStorage.shared.deleteCookie(cookie)
            }
        }
        self.currentUser = nil
        self.isAuthenticated = false
    }

    func changePassword(currentPassword: String, newPassword: String) async throws -> User {
        let res: PasswordChangeResponse = try await request(
            "/auth/password",
            method: "POST",
            body: [
                "currentPassword": currentPassword,
                "newPassword": newPassword
            ]
        )
        if let updated = res.user {
            self.currentUser = updated
            return updated
        }
        self.currentUser?.mustChangePassword = false
        return self.currentUser!
    }

    // MARK: - Timetable & Classes

    func getCurrentTimetable(day: Int? = nil, period: Int? = nil) async throws -> TimetableResponse {
        if isDemoMode { return demoService.getCurrentTimetable() }
        var queryItems: [String] = []
        if let day = day { queryItems.append("day=\(day)") }
        if let period = period { queryItems.append("period=\(period)") }
        let query = queryItems.isEmpty ? "" : "?\(queryItems.joined(separator: "&"))"
        return try await request("/timetable/current\(query)")
    }

    func getClasses() async throws -> [SchoolClass] {
        if isDemoMode { return demoService.getClasses() }
        return try await request("/classes")
    }

    func getClassPupils(classId: Int) async throws -> ClassPupilsResponse {
        if isDemoMode { return demoService.getClassPupils(classId: classId) }
        return try await request("/classes/\(classId)/pupils")
    }

    // MARK: - Cards (Grün, Gelb, Rot)

    func getClassCards(classId: Int) async throws -> [ClassCardItem] {
        if isDemoMode { return demoService.getClassCards(classId: classId) }
        return try await request("/cards/class/\(classId)")
    }

    func issueCard(pupilId: Int, classId: Int, cardType: String, note: String?) async throws {
        if isDemoMode {
            demoService.issueCard(
                pupilId: pupilId,
                classId: classId,
                cardType: cardType,
                note: note?.trimmingCharacters(in: .whitespacesAndNewlines)
            )
            return
        }
        struct CardResponse: Decodable {}
        var body: [String: Any] = [
            "pupilId": pupilId,
            "classId": classId,
            "cardType": cardType
        ]
        if let note = note, !note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            body["note"] = note.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        _ = try await request("/cards", method: "POST", body: body) as CardResponse
    }

    func revokeCard(cardId: String) async throws {
        if isDemoMode {
            demoService.revokeCard(cardId: cardId)
            return
        }
        struct RevokeResponse: Decodable {}
        _ = try await request("/cards/\(cardId)/revoke", method: "POST") as RevokeResponse
    }

    // MARK: - Time-Out & Cool-Down (Lernwerkstatt)

    func getClassTimeouts(classId: Int) async throws -> [TimeoutIncident] {
        if isDemoMode { return demoService.getClassTimeouts(classId: classId) }
        return try await request("/timeouts/class/\(classId)")
    }

    func getActiveTimeouts() async throws -> [TimeoutIncident] {
        if isDemoMode { return demoService.getActiveTimeouts() }
        return try await request("/timeouts/active")
    }

    func getTimeoutHistory() async throws -> [TimeoutIncident] {
        if isDemoMode { return demoService.getTimeoutHistory() }
        return try await request("/timeouts/history")
    }

    func sendToTimeout(
        pupilId: Int,
        classId: Int,
        taskAssignment: String,
        retroactiveDate: String? = nil,
        retroactivePeriod: Int? = nil
    ) async throws {
        if isDemoMode {
            demoService.sendToTimeout(pupilId: pupilId, classId: classId, kind: "timeout", taskAssignment: taskAssignment)
            return
        }
        struct TimeoutCreated: Decodable {}
        var body: [String: Any] = [
            "pupilId": pupilId,
            "classId": classId,
            "kind": "timeout",
            "taskAssignment": taskAssignment
        ]
        if let date = retroactiveDate, let period = retroactivePeriod {
            body["retroactive"] = true
            body["retroactiveDate"] = date
            body["retroactivePeriod"] = period
        }
        _ = try await request("/timeouts", method: "POST", body: body) as TimeoutCreated
    }

    func sendToCooldown(pupilId: Int, classId: Int, note: String?) async throws {
        if isDemoMode {
            demoService.sendToTimeout(
                pupilId: pupilId,
                classId: classId,
                kind: "cooldown",
                taskAssignment: note?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "Cool-Down"
            )
            return
        }
        struct CooldownCreated: Decodable {}
        var body: [String: Any] = [
            "pupilId": pupilId,
            "classId": classId,
            "kind": "cooldown"
        ]
        if let note = note, !note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            body["taskAssignment"] = note.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        _ = try await request("/timeouts", method: "POST", body: body) as CooldownCreated
    }

    func resolveTimeout(id: String, resolutionNote: String?) async throws {
        if isDemoMode {
            demoService.resolveTimeout(
                id: id,
                resolutionNote: resolutionNote?.trimmingCharacters(in: .whitespacesAndNewlines)
            )
            return
        }
        struct ResolveResponse: Decodable {}
        var body: [String: Any] = [:]
        if let note = resolutionNote, !note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            body["resolutionNote"] = note.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        _ = try await request("/timeouts/\(id)/resolve", method: "POST", body: body) as ResolveResponse
    }

    // MARK: - Schulstatistik

    func getStatistics(classId: String = "all") async throws -> StatisticsResponse {
        if isDemoMode { return demoService.getStatistics(classId: classId) }
        return try await request("/statistics/overview?classId=\(classId)")
    }

    // MARK: - School-wide Behaviour ("Alle Klassen")

    func getBehaviorOverview() async throws -> BehaviorOverview {
        if isDemoMode { return demoService.getBehaviorOverview() }
        return try await request("/behavior/overview")
    }

    func getPupilBehaviorProfile(pupilId: Int) async throws -> PupilBehaviorProfile {
        if isDemoMode { return demoService.getPupilBehaviorProfile(pupilId: pupilId) }
        return try await request("/pupils/\(pupilId)/behavior-profile")
    }

    // MARK: - Bewertung / Einstufung

    /// Saves the teacher's proposed rank for one pupil and subject (no submission).
    func saveProposedRank(
        pupilId: Int,
        classId: Int,
        subjectCode: String,
        rank: String
    ) async throws {
        if isDemoMode {
            demoService.saveEvaluation(pupilId: pupilId, classId: classId, subjectCode: subjectCode, rank: rank, submit: false)
            return
        }
        try await requestWithoutResponse(
            "/evaluations/status",
            body: [
                "pupilId": pupilId,
                "classId": classId,
                "subjectCode": subjectCode,
                "proposedStatus": rank
            ]
        )
    }

    /// Submits the ballot for one pupil and subject; the server treats it as final.
    func submitEvaluation(
        pupilId: Int,
        classId: Int,
        subjectCode: String,
        rank: String
    ) async throws {
        if isDemoMode {
            demoService.saveEvaluation(pupilId: pupilId, classId: classId, subjectCode: subjectCode, rank: rank, submit: true)
            return
        }
        try await requestWithoutResponse(
            "/evaluations/submit",
            body: [
                "pupilId": pupilId,
                "classId": classId,
                "subjectCode": subjectCode,
                "proposedStatus": rank
            ]
        )
    }

    /// Withdraws a submitted ballot before the deadline so it can be edited again.
    func reopenEvaluation(pupilId: Int, classId: Int, subjectCode: String) async throws {
        if isDemoMode {
            demoService.reopenEvaluation(pupilId: pupilId, subjectCode: subjectCode)
            return
        }
        try await requestWithoutResponse(
            "/evaluations/reopen",
            body: [
                "pupilId": pupilId,
                "classId": classId,
                "subjectCode": subjectCode
            ]
        )
    }
}
