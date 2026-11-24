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
/// in addition to the system trust store — but **only for the host of the currently configured
/// server**. For every other host the system trust store alone decides, so the school-internal
/// CA can never vouch for an unrelated server (the previous version added it as an anchor for
/// every host the app happened to contact).
final class InternalCATrustDelegate: NSObject, URLSessionDelegate, Sendable {
    private let pinnedRootCert: SecCertificate? = {
        guard let url = Bundle.main.url(forResource: "smile-internal-ca", withExtension: "cer"),
              let data = try? Data(contentsOf: url) as CFData,
              let cert = SecCertificateCreateWithData(nil, data) else {
            return nil
        }
        return cert
    }()

    /// Returns the host of the server the user configured (persisted base URL, or the default).
    private let trustedHostProvider: @Sendable () -> String?

    init(trustedHostProvider: @escaping @Sendable () -> String?) {
        self.trustedHostProvider = trustedHostProvider
    }

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

        let challengeHost = challenge.protectionSpace.host?.lowercased()
        let trustedHost = trustedHostProvider()?.lowercased()
        let isConfiguredServer = challengeHost != nil && challengeHost == trustedHost

        if let rootCert = pinnedRootCert, isConfiguredServer {
            // Add the internal root as an *additional* anchor (system anchors stay active)
            // so publicly trusted certificates keep working for the configured server too.
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

    // `nonisolated`: the URLSession delegate runs on a background queue and must be able
    // to read the configured host without hopping to the main actor.
    private nonisolated static let serverURLKey = "smile_server_base_url"
    private nonisolated static let lastUsernameKey = "smile_last_username"
    nonisolated static let defaultServerURL = "https://172.16.1.11"

    @Published var baseURL: String {
        didSet {
            UserDefaults.standard.set(baseURL, forKey: Self.serverURLKey)
        }
    }

    /// Last successfully used login name, prefilled on the login form. Not secret.
    var lastUsername: String? {
        get { UserDefaults.standard.string(forKey: Self.lastUsernameKey) }
        set { UserDefaults.standard.setValue(newValue, forKey: Self.lastUsernameKey) }
    }

    @Published var currentUser: User?
    @Published var isAuthenticated = false
    @Published private(set) var isDemoMode = false

    private let demoService = DemoReviewService()
    private let session: URLSession
    private let trustDelegate: InternalCATrustDelegate

    /// Normalizes a user-entered server address to `scheme://host[:port]`.
    ///
    /// Accepts a bare domain or IP (`smile.schule.intern`, `172.16.1.11`, `172.16.1.11:3000`)
    /// by assuming `https://`. Plain `http` is only allowed for loopback hosts — the login
    /// password must never travel in cleartext to a non-loopback server. Any path, query
    /// or userinfo in the input is dropped: the field is a server *address*, not a URL path.
    nonisolated static func normalizeServerURL(_ raw: String) -> String? {
        var trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        if !trimmed.contains("://") {
            trimmed = "https://" + trimmed
        }
        guard let url = URL(string: trimmed),
              let scheme = url.scheme?.lowercased(),
              let host = url.host, !host.isEmpty,
              url.user == nil, url.password == nil else {
            return nil
        }
        let isLoopback = host == "localhost" || host == "127.0.0.1" || host == "::1"
        guard scheme == "https" || (scheme == "http" && isLoopback) else {
            return nil
        }
        var normalized = "\(scheme)://"
        let lowerHost = host.lowercased()
        normalized += lowerHost.contains(":") ? "[\(lowerHost)]" : lowerHost
        if let port = url.port {
            normalized += ":\(port)"
        }
        return normalized
    }

    nonisolated static func isAllowedServerURL(_ raw: String) -> Bool {
        normalizeServerURL(raw) != nil
    }

    /// The persisted server address, or the default when nothing valid is stored.
    private nonisolated static func persistedBaseURL() -> String {
        if let saved = UserDefaults.standard.string(forKey: serverURLKey),
           let normalized = normalizeServerURL(saved) {
            return normalized
        }
        return defaultServerURL
    }

    private nonisolated static func persistedBaseURLHost() -> String? {
        URL(string: persistedBaseURL())?.host?.lowercased()
    }

    private init() {
        self.baseURL = Self.persistedBaseURL()

        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 120
        config.httpCookieAcceptPolicy = .always
        config.httpShouldSetCookies = true
        config.httpCookieStorage = HTTPCookieStorage.shared
        self.trustDelegate = InternalCATrustDelegate(trustedHostProvider: { Self.persistedBaseURLHost() })
        self.session = URLSession(configuration: config, delegate: trustDelegate, delegateQueue: nil)
    }

    /// Sets and persists a new server address. Changing the server invalidates the current
    /// session: the cookies belong to the old host and any cached user no longer applies.
    func setBaseURL(_ raw: String) throws {
        guard let normalized = Self.normalizeServerURL(raw) else {
            throw APIError.invalidURL
        }
        let changed = normalized != baseURL
        baseURL = normalized // didSet persists to UserDefaults
        if changed {
            currentUser = nil
            isAuthenticated = false
            isDemoMode = false
            clearCookies()
        }
    }

    private func clearCookies() {
        if let cookies = HTTPCookieStorage.shared.cookies {
            for cookie in cookies {
                HTTPCookieStorage.shared.deleteCookie(cookie)
            }
        }
    }

    private func makeURL(_ path: String) throws -> URL {
        guard let base = Self.normalizeServerURL(baseURL),
              let url = URL(string: "\(base)/api\(path)") else {
            throw APIError.invalidURL
        }
        return url
    }

    /// Unauthenticated liveness probe at the server root (`GET /health`, outside `/api`).
    /// Used by the login form's "Server testen" so a teacher can verify the entered
    /// domain before submitting credentials.
    func checkServer() async throws {
        guard let base = Self.normalizeServerURL(baseURL),
              let url = URL(string: "\(base)/health") else {
            throw APIError.invalidURL
        }
        var req = URLRequest(url: url)
        req.httpMethod = "GET"
        req.cachePolicy = .reloadIgnoringLocalCacheData
        req.timeoutInterval = 10
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: req)
        } catch {
            throw APIError.networkError(error)
        }
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            throw APIError.serverError(status: status, message: "Server antwortet nicht mit 2xx (\(status)).", code: nil)
        }
        struct HealthResponse: Decodable { let status: String }
        do {
            _ = try JSONDecoder().decode(HealthResponse.self, from: data)
        } catch {
            throw APIError.decodingError(error.localizedDescription)
        }
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
        // The 30-second polling in the views must always see fresh server state;
        // URLSession would otherwise answer GETs from its heuristic cache.
        req.cachePolicy = .reloadIgnoringLocalCacheData
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
        } catch let error as APIError {
            // Only an explicit 401 ends the session. A network or decoding failure
            // (server unreachable, captive portal, …) must NOT sign the teacher out:
            // the session cookie may still be perfectly valid.
            if case .unauthorized = error {
                self.currentUser = nil
                self.isAuthenticated = false
            }
        } catch {
            // Unknown error: keep the current state for the same reason.
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
        clearCookies()
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
