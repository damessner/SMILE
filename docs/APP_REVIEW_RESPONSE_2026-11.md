# App Review Response — "Guideline 2.1: Information Needed" (2026-11-24)

App: **SMILE Assessment Platform** (Apple ID 6833989418), Version 2.1.2, Build 7.

Status of the previously reported issue: **ITMS-90725 is resolved** — build 7 was
compiled on the `xcode-27` runner with **Xcode 27.2 / iOS 27.2 SDK** (GitHub Actions
run 45434268789, green, IPA uploaded to TestFlight).

This document contains a copy-paste draft for the **App Review Information → Notes** field
in App Store Connect (English, as Apple's request is in English), plus the checklist of
what still has to be done manually.

---

## Draft for the "Notes" field (App Review Information)

```text
1. SCREEN RECORDING
A screen recording captured on a physical iPad (latest iPadOS) is attached to this
submission. It starts with the app launch and shows the typical user flow:
launch -> login (demo account below) -> "Schulalltag" class view with pupils ->
issue a green card -> open pupil history -> "Lernwerkstatt" (resolve a time-out) ->
"Bewertung" (set and submit a rank) -> "Schulstatistik".
Note on flows that do not exist in the app: SMILE has NO in-app account registration
and NO in-app account deletion — teacher accounts are provisioned and deprovisioned
centrally by the school's administrator on the school server. There is therefore no
sign-up or account-deletion flow to show. The app contains NO user-generated content
that is visible across users: all entries (cards, notes, evaluations) are visible only
to authenticated staff of the school on the school's own server, so no content
reporting/blocking mechanism applies. There is NO paid content or feature.

2. PURPOSE AND TARGET AUDIENCE
SMILE is the internal companion app for the teaching staff of Mittelschule Telfs
Dr. Aloys Weissenbach (a public middle school in Telfs, Tyrol, Austria). It solves the
problem of paper-based, non-auditable classroom assessment and behaviour tracking:
teachers record competence ranks, behaviour cards (green/yellow/red), time-outs and
cool-downs during lessons in real time; the data feeds conference preparation and
school statistics. The value is an always-current, auditable class overview on the
iPad during teaching. Target audience: ONLY the school's own teaching staff — the app
requires a staff account provisioned by the school and is not intended for the general
public (see also point 6 / Guideline 3.2 below).

3. SETUP INSTRUCTIONS AND DEMO CREDENTIALS
Demo account (works fully offline — the app has a built-in demo mode for exactly this
case; no school server is contacted and no real pupil data is involved):
  Username: apple-review
  Password: SmileReview2026!
Steps: open the app -> leave the "Server / Domain" field at its default (the demo login
works without any server) -> enter the demo username and password -> tap "Anmelden".
Main features to try: Schulalltag (class 3a, issue a card via the colored buttons,
open a pupil's history), Lernwerkstatt (active time-outs, "Abschließen"), Bewertung
(class/subject chips, rank buttons, "Abgeben"), Schulstatistik (KPIs, charts, pupil
table), Alle Klassen (school-wide behaviour board). Face ID / Touch ID login is also
available after the first sign-in on the device.
Real staff accounts exist but contain real pupil data and are intentionally NOT shared.

4. EXTERNAL SERVICES / TOOLS / PLATFORMS USED FOR CORE FUNCTIONALITY
- The school's own SMILE REST API (Fastify + PostgreSQL on a school-owned Linux
  container in Austria) — the ONLY backend the app talks to, over HTTPS.
- TLS is validated against the school's internal Caddy root CA certificate bundled
  in the app (trusted only for the configured server host, in addition to the system
  trust store). Server address is user-configurable in the login form.
- Authentication: school staff accounts via httpOnly session cookie; on-device
  credential storage in the iOS Keychain protected by Face ID / Touch ID.
- NO third-party SDKs, NO analytics/tracking, NO advertising, NO payment processors,
  NO AI services, NO external data providers. Apple services (App Store Connect /
  TestFlight) are used only for distribution, not for app functionality.

5. REGIONAL DIFFERENCES
None. The app is German-language (de-AT) and is used exclusively by one school in
Austria. All data stays on the school's own server in Austria; the app behaves
identically in every region.

6. HIGHLY REGULATED INDUSTRY / AUTHORIZATION
The app processes education records of minors, which is why it is a closed,
staff-only system: the app and the data belong to the school itself. Mittelschule
Telfs Dr. Aloys Weissenbach (Telfs, Austria) is the data controller under the EU GDPR;
the school's developer account (Team ID ZC5QZ8N67B) publishes the app for its own
staff. Apple's infrastructure processes no app data. Privacy policy: see the Privacy
Policy URL in App Privacy (docs/privacy.html in the project). Contact: smile@ms-telfs.at.

ADDITIONAL NOTES (Guideline 2.1 / 3.2):
- The app contains no In-App Purchase (Guideline 3.1.1 not applicable).
- Screenshots show the app actually in use (class view, statistics), not a login or
  splash screen (Guideline 2.3.3).
- This build was QA-tested on physical iPads via TestFlight before submission
  (Guideline 2.1 bugs/crashes), and is built with the iOS 27 SDK (Xcode 27), resolving
  ITMS-90725.
- Guideline 3.2: SMILE is intended solely for employees of one specific organization
  (the school). If you prefer, we can switch the app's availability to "Custom Apps"
  (Apple Business Manager) so it is offered only to our organization and never listed
  publicly; alternatively it is distributed as an MDM/Intune line-of-business app.
  Please advise if you require the public listing, in which case the demo account
  above gives full access.
```

---

## Checklist — what still has to be done manually in App Store Connect

| # | Action | Status |
|---|--------|--------|
| 1 | Record the screen video on a **physical iPad** (latest iPadOS): launch → demo login (`apple-review` / `SmileReview2026!`) → Schulalltag → issue card → pupil history → Lernwerkstatt → Bewertung → Statistik; attach as the App Review demo video | **to do** |
| 2 | Paste the Notes draft above into **App Review Information → Notes** | **to do** |
| 3 | Fill **Sign-in required** with the demo account: `apple-review` / `SmileReview2026!` (works offline; leave server at default) | **to do** |
| 4 | Screenshots must show the app **in use** (not login/splash): either run Actions → `SMILE iOS App Store Screenshots` and upload the `SMILE-appstore-screenshots` artifact, or capture on the TestFlight build directly on an iPad | workflow ready, upload **to do** |
| 5 | QA pass on 1–2 physical iPads via **TestFlight** (build 7, Xcode 27.2) before resubmitting | **to do** |
| 6 | Decide distribution: keep public listing (answer 3.2 in the notes as drafted) **or** switch availability to **Custom Apps** in Apple Business Manager / distribute via Intune as LOB app (see `docs/IOS_APP.md`) | **decision needed** |
| 7 | App Privacy details + privacy policy URL | already prepared in `docs/APP_STORE_METADATA.md` §3 |
| 8 | ITMS-90725 (SDK version) | **resolved** — build 7 compiled with Xcode 27.2 / iOS 27.2 SDK (Actions run 45434268789, green, uploaded) |

## Recommendation on Guideline 3.2

Apple's notice explicitly says: *"If your app is intended to be used by specific
businesses, organizations or employees then use one of the other distribution options
available to you through the Apple Developer Program Account."* SMILE is exactly that
case: a single school's internal tool processing minors' data. The cleanest path is
**Custom Apps via Apple Business Manager** (available only to MS Telfs' organization,
never publicly listed) or the already-documented **Intune line-of-business**
distribution — both avoid public App Store review entirely. If the school still wants
a public listing, submit the notes above; expect Apple to push toward Custom Apps.
