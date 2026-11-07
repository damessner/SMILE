import SwiftUI

@main
struct SMILEApp: App {
    @StateObject private var api = APIClient.shared

    var body: some Scene {
        WindowGroup {
            Group {
                if api.isAuthenticated, let user = api.currentUser {
                    if user.mustChangePassword == true {
                        ForcePasswordChangeView(user: user)
                            .environmentObject(api)
                    } else {
                        MainTabView(user: user)
                            .environmentObject(api)
                    }
                } else {
                    LoginView()
                        .environmentObject(api)
                }
            }
            .preferredColorScheme(.dark)
            .task {
                await api.checkSession()
            }
        }
    }
}
