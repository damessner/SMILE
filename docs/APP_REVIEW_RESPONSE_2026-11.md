# App Review — Final Response for Resubmission (2026-11-24)

App: **SMILE Assessment Platform** (Apple ID 6833989418) — resubmitting **Version 2.1.2, Build 8**
(compiled with **Xcode 27.2 / iOS 27.2 SDK** — this also resolves the earlier ITMS-90725 notice).

This file contains **one consolidated response** to the "Guideline 2.1 — Information Needed"
notice. Copy the block in §1 into **App Review Information → Notes**, attach the screen recording
in **App Review Information → Demo video**, and fill the demo credentials in **Sign-in required** (§2).

---

## 1. Final Notes text (App Review Information → Notes) — copy verbatim

```text
Thank you for the detailed feedback. All requested information is provided below; a screen
recording is attached in the "Demo video" field of this App Review Information section.

1. SCREEN RECORDING
The attached recording (screenrecording.mp4, H.264, captured on a physical iPad running the
latest iPadOS) begins with launching the app and shows the typical user flow end to end:
app launch -> login with the demo account below -> "Schulalltag" class view with pupils ->
issue a green card -> open a pupil's history -> "Lernwerkstatt" (resolve a time-out) ->
"Schulstatistik" (KPIs, distribution charts, pupil table).
Flows that do not exist in this app: there is NO in-app account registration and NO in-app
account deletion — teacher accounts are provisioned and deprovisioned centrally by the
school's administrator on the school's own server, so there is no sign-up or account-deletion
flow to demonstrate. There is NO user-generated content visible across users: all entries
(cards, notes, evaluations) are visible only to authenticated staff of the school on the
school's server, so content reporting/blocking mechanisms do not apply. There is NO paid
content or feature.

2. PURPOSE AND TARGET AUDIENCE
SMILE is the internal companion app for the teaching staff of Mittelschule Telfs Dr. Aloys
Weissenbach, a public middle school in Telfs, Tyrol, Austria. It replaces paper-based,
non-auditable classroom assessment and behaviour tracking: teachers record competence ranks,
behaviour cards (green/yellow/red), time-outs and cool-downs in real time during lessons, and
the same data feeds conference preparation and school statistics. The value is an always
current, auditable class overview on the iPad while teaching. Target audience: exclusively
the school's own teaching staff; the app requires a staff account provisioned by the school.

3. SETUP INSTRUCTIONS AND DEMO CREDENTIALS
Demo account (built-in offline demo mode of the app — no school server is contacted and no
real pupil data is involved):
  Username: apple-review
  Password: SmileReview2026!
Steps: open the app -> the "Server / Domain" field can be left empty (the demo login works
without any server; alternatively enter any https address) -> enter the demo username and
password -> tap "Anmelden". Main features to try: Schulalltag (class 3a appears, issue a
card with the colored buttons, tap a pupil for the history), Lernwerkstatt (active
time-outs, "Abschließen"), Schulstatistik (totals, charts, searchable pupil table).
Face ID / Touch ID sign-in is additionally available on the device after the first login.
Real staff accounts exist but contain real pupil data and are intentionally not shared.

4. EXTERNAL SERVICES / TOOLS / PLATFORMS USED FOR CORE FUNCTIONALITY
- The school's own SMILE REST API (Fastify + PostgreSQL on a school-owned Linux container in
  Austria) — the only backend the app talks to, over HTTPS. The server address is entered
  manually in the login form.
- TLS is validated against the school's internal Caddy root CA bundled in the app (trusted
  only for the configured server host, in addition to the system trust store).
- Authentication: school staff accounts via an httpOnly session cookie; on-device credential
  storage in the iOS Keychain protected by Face ID / Touch ID.
- NO third-party SDKs, NO analytics or tracking, NO advertising, NO payment processors, NO AI
  services, NO external data providers. Apple services (App Store Connect / TestFlight) are
  used only to distribute the build, not for app functionality.

5. REGIONAL DIFFERENCES
None. The app is German-language (de-AT) and used exclusively by one school in Austria. All
data stays on the school's own server in Austria; the app behaves identically in every region.

6. HIGHLY REGULATED INDUSTRY / AUTHORIZATION
The app processes education records of minors, which is why it is a closed, staff-only
system: the app and all data belong to the school itself. Mittelschule Telfs Dr. Aloys
Weissenbach (Telfs, Austria) is the data controller under the EU GDPR; the school's Apple
Developer account (Team ID ZC5QZ8N67B) publishes the app for its own staff. No app data is
processed on Apple's infrastructure. The privacy policy is linked in the App Privacy section
of this app record. Contact: smile@ms-telfs.at.

ADDITIONAL POINTS
- In-App Purchase: none (Guideline 3.1.1 not applicable).
- Screenshots show the app actually in use (class view, statistics), not a login or splash
  screen (Guideline 2.3.3).
- Build 8 was QA-tested on physical iPads via TestFlight before this resubmission
  (Guideline 2.1 bugs/crashes) and is compiled with the iOS 27 SDK / Xcode 27 (ITMS-90725).
- Guideline 3.2: SMILE is intended solely for the employees of one specific organization
  (the school). If you prefer, we can switch this app's availability to "Custom Apps"
  (Apple Business Manager), which offers it only to our organization and never lists it
  publicly; alternatively we distribute it as an MDM/Intune line-of-business app. If a
  public listing is acceptable, the demo account above provides full access to review.
```

## 2. Where each piece goes in App Store Connect

| Field | Content |
|---|---|
| App Review Information → **Demo video** | attach `screenrecording.mp4` (H.264, ~7 MB, physical iPad, starts at app launch) |
| App Review Information → **Notes** | the verbatim block from §1 |
| App Review Information → **Sign-in required** | Username `apple-review`, Password `SmileReview2026!` (works offline in the app's built-in demo mode; server field can stay empty) |
| App Review Information → Contact | school contact, e.g. `smile@ms-telfs.at`, +43 phone |
| Screenshots (per device size) | must show the app in use — run Actions → `SMILE iOS App Store Screenshots` and upload the `SMILE-appstore-screenshots` artifact, or capture on the TestFlight build (build 8) directly |
| App Privacy | as prepared in `docs/APP_STORE_METADATA.md` §3 (User ID + user content for app functionality, no tracking; privacy policy URL) |

Then press **Submit for Review**.

## 3. Short reply in the Resolution Center (optional)

```text
All requested information has been added to the App Review Information notes of build 8
(2.1.2): a screen recording on a physical iPad is attached as the demo video, the demo
account apple-review / SmileReview2026! is provided in Sign-in required, and the notes
describe purpose, setup, external services (school's own API only), regional behavior and
our authorization as the school operating its own system. The build is compiled with the
iOS 27 SDK (Xcode 27), resolving ITMS-90725. Resubmitting for review.
```

## 4. Reminder: what the recording must show

- Starts with **launching the app** (tap the icon), not mid-flow.
- Shows **login** — use the demo account `apple-review` / `SmileReview2026!` (fabricated data
  only). Do NOT record a real class: real pupil names must not be uploaded to Apple (GDPR).
- Shows the typical flow: Schulalltag → issue a card → pupil history → Lernwerkstatt →
  Schulstatistik.
- Build 8 (with the new logo and the 3-tab bar) is the build on TestFlight / in this submission.
