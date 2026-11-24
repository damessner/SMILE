# App Review — Final Response for Resubmission (2026-11-24)

App: **SMILE Assessment Platform** (Apple ID 6833989418) — resubmitting **Version 2.1.2, Build 8**
(compiled with **Xcode 27.2 / iOS 27.2 SDK** — this also resolves the earlier ITMS-90725 notice).

This file contains **one consolidated response** to the "Guideline 2.1 — Information Needed"
notice. Copy the block in §1 into **App Review Information → Notes**, attach the screen recording
in **App Review Information → Demo video**, and fill the demo credentials in **Sign-in required** (§2).

---

## 1. Final Notes text (App Review Information → Notes) — copy verbatim

```text
Thank you — all requested information is below; a screen recording is attached as the demo video (physical iPad, latest iPadOS, starts at app launch, shows login and the typical flow: Schulalltag -> issue card -> pupil history -> Lernwerkstatt -> Schulstatistik).

1. RECORDING: see attached demo video. This app has NO in-app sign-up and NO account deletion — teacher accounts are provisioned/deprovisioned centrally by the school admin on the school's own server. There is NO user-generated content visible across users: entries (cards, notes, evaluations) are visible only to authenticated school staff on the school server, so reporting/blocking mechanisms do not apply. NO paid content or features.

2. PURPOSE / AUDIENCE: SMILE is the internal app for the teaching staff of Mittelschule Telfs Dr. Aloys Weissenbach (Telfs, Tyrol, Austria). It replaces paper-based, non-auditable classroom assessment and behaviour tracking: teachers record competence ranks, behaviour cards (green/yellow/red), time-outs and cool-downs in real time; the same data feeds conferences and school statistics. Value: a current, auditable class overview on the iPad while teaching. Audience: school staff only; a school-provisioned account is required.

3. SETUP / DEMO CREDENTIALS: Username: apple-review, Password: SmileReview2026! — a built-in offline demo mode with fabricated data; no server needed (the "Server / Domain" field can stay empty). After login try: Schulalltag (issue a card, open a pupil's history), Lernwerkstatt (resolve a time-out), Schulstatistik. Face ID / Touch ID is available after the first login. Real staff accounts contain real pupil data and are intentionally not shared.

4. EXTERNAL SERVICES: only the school's own SMILE REST API (Fastify + PostgreSQL on a school-owned server in Austria) over HTTPS; the server address is entered manually in the login form. TLS is validated against the school's internal Caddy root CA bundled in the app (trusted only for the configured host, plus the system trust store). Auth via httpOnly session cookie; credentials stored on-device in the iOS Keychain protected by Face ID / Touch ID. NO third-party SDKs, analytics, ads, payment processors, AI services or external data providers. Apple services (App Store Connect / TestFlight) are used for distribution only.

5. REGIONAL DIFFERENCES: none. The app is German-language (de-AT), used by one school in Austria; all data stays on the school's server in Austria; identical behavior in all regions.

6. REGULATED INDUSTRY / AUTHORIZATION: the app processes minors' education records, hence the closed staff-only design. The school is the GDPR data controller and publishes the app from its own developer account (Team ID ZC5QZ8N67B); no app data is processed on Apple infrastructure; the privacy policy is linked in App Privacy. Contact: smile@ms-telfs.at.

ALSO: no In-App Purchase (Guideline 3.1.1 n/a); screenshots show the app in use, not a login screen (2.3.3); build 8 was QA-tested on physical iPads via TestFlight and compiled with the iOS 27 SDK / Xcode 27 (ITMS-90725 resolved). Guideline 3.2: SMILE is intended solely for employees of one specific organization (the school) — if you prefer, we can switch availability to Custom Apps (Apple Business Manager) or distribute via Intune as an LOB app; if a public listing is acceptable, the demo account above gives full access for review.
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
