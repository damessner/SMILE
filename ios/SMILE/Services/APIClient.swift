import Foundation
import Security

enum APIError: LocalizedError {
    case invalidURL
    case unauthorized(String)
    case passwordChangeRequired
    case serverError(status: Int, message: String, code: String?)
    case networkError(Error)

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
            return "Netzwerkfehler: \(err.localizedDescription)"
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
            completionHandler(.performDefaultHandling, nil)
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

    private let session: URLSession
    private let trustDelegate = InternalCATrustDelegate()

    private init() {
        let saved = UserDefaults.standard.string(forKey: Self.serverURLKey)
        self.baseURL = (saved?.isEmpty == false) ? saved! : Self.defaultServerURL

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
        guard let url = URL(string: "\(trimmedBase)/api\(path)") else {
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
        return try JSONDecoder().decode(T.self, from: data)
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
        var queryItems: [String] = []
        if let day = day { queryItems.append("day=\(day)") }
        if let period = period { queryItems.append("period=\(period)") }
        let query = queryItems.isEmpty ? "" : "?\(queryItems.joined(separator: "&"))"
        return try await request("/timetable/current\(query)")
    }

    func getClasses() async throws -> [SchoolClass] {
        return try await request("/classes")
    }

    func getClassPupils(classId: Int) async throws -> ClassPupilsResponse {
        return try await request("/classes/\(classId)/pupils")
    }

    // MARK: - Cards (Grün, Gelb, Rot)

    func getClassCards(classId: Int) async throws -> [ClassCardItem] {
        return try await request("/cards/class/\(classId)")
    }

    func issueCard(pupilId: Int, classId: Int, cardType: String, note: String?) async throws {
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
        struct RevokeResponse: Decodable {}
        _ = try await request("/cards/\(cardId)/revoke", method: "POST") as RevokeResponse
    }

    // MARK: - Time-Out & Cool-Down (Lernwerkstatt)

    func getClassTimeouts(classId: Int) async throws -> [TimeoutIncident] {
        return try await request("/timeouts/class/\(classId)")
    }

    func getActiveTimeouts() async throws -> [TimeoutIncident] {
        return try await request("/timeouts/active")
    }

    func getTimeoutHistory() async throws -> [TimeoutIncident] {
        return try await request("/timeouts/history")
    }

    func sendToTimeout(
        pupilId: Int,
        classId: Int,
        taskAssignment: String,
        retroactiveDate: String? = nil,
        retroactivePeriod: Int? = nil
    ) async throws {
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
        struct ResolveResponse: Decodable {}
        var body: [String: Any] = [:]
        if let note = resolutionNote, !note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            body["resolutionNote"] = note.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        _ = try await request("/timeouts/\(id)/resolve", method: "POST", body: body) as ResolveResponse
    }

    // MARK: - Schulstatistik

    func getStatistics(classId: String = "all") async throws -> StatisticsResponse {
        return try await request("/statistics/overview?classId=\(classId)")
    }

    // MARK: - School-wide Behaviour ("Alle Klassen")

    func getBehaviorOverview() async throws -> BehaviorOverview {
        return try await request("/behavior/overview")
    }

    // MARK: - Bewertung / Einstufung

    /// Saves the teacher's proposed rank for one pupil and subject (no submission).
    func saveProposedRank(
        pupilId: Int,
        classId: Int,
        subjectCode: String,
        rank: String
    ) async throws {
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
