# Critical Review — DeepSeek Harness approval & sandbox policy machinery

**Trigger:** the session approval policy was switched from `ask the user for approval` to
`never ask the user for approval` (the `danger-full-access` permission preset bundles
`sandbox: danger-full-access` with `approval: never`).

**Scope reviewed:** the running DeepSeek Harness implementation, version `0.2.2-rc.5`,
checkout at [DSH checkout](<C:\Users\dames\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh>)
(the `app.asar` archive; the readable source ships as `src/*.ts` next to compiled `lib/` inside
each `@deepseek-ai/*` package). All package paths below are relative to that checkout's
`dsh/node_modules/@deepseek-ai/` unless stated otherwise. Review date: 2026-11-23.

**Method:** extracted the `dsh` subtree of `app.asar` to a temp dir (18,824 files) so the tree
is greppable, then traced every consumer of the approval seam and every sandbox-enforcement
path, with emphasis on behavior under the `never` policy.

---

## 1. How the two knobs work (architecture map)

There are two independent, session-scoped knobs, both stored as append-only session events and
folded by projections:

| Knob | Event | Projection | Effective read | Write path |
|---|---|---|---|---|
| Approval policy | `approval/policy` | `approvalState` in [dsh-user-approval/src/index.ts](<C:\Users\dames\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-user-approval\src\index.ts>) (:89–109) | `override ?? config.policy ?? 'ask'` (:270–272) | `setApprovalPolicy()` / `ApprovalService.setPolicy()` |
| Sandbox mode | `sandbox/mode` | `sandboxMode` in [dsh-sandbox-policy/src/index.ts](<C:\Users\dames\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-sandbox-policy\src\index.ts>) (:174–180) | `override ?? defaultMode` (:215) | `setSandboxMode()` |

`@deepseek-ai/dsh-permission-presets` ([src/index.ts](<C:\Users\dames\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-permission-presets\src\index.ts>))
bundles them: default presets are `workspace-write` = {sandbox `workspace-write`, approval
`ask`} and `danger-full-access` = {sandbox `danger-full-access`, approval `never`} (:182–191).
The `/permission` command (:263–273) and the GUI preset picker write both knobs through their
canonical setters; the GUI shows a risk-confirmation dialog for `danger-full-access`
([dsh-client-ui-permission-presets/src/client/PermissionRow.tsx](<C:\Users\dames\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-client-ui-permission-presets\src\client\PermissionRow.tsx>):81).

Enforcement points under `never`:

1. **ApprovalService.decide()** — [dsh-user-approval/src/index.ts:301](<C:\Users\dames\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-user-approval\src\index.ts#L301>):
   `if (this.effectivePolicy(session) === 'never') return 'rejected'` — evaluated **inside the
   service, before the `approval/request` waterfall dispatch**, so even a listener registered
   later with `prepend: true` cannot bypass it (:296–301). Every ask still appends the
   `approval/asked` + `approval/decided` audit pair (:252, :259), and asks outside an open turn
   throw before appending (:244–250). Answerer absence/failure/rogue returns all normalize to
   `unavailable` (fail closed) (:306–318).
2. **Tool pipeline `serviceAsk`** — [dsh-tools/src/pipeline.ts:440–481](<C:\Users\dames\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-tools\src\pipeline.ts#L440-L481>):
   `tools/pre-execute` decisions of `kind: 'ask'` (in-tree producer: the experimental
   auto-review gate) are routed through `ctx.get('approval')`; `rejected` → `APPROVAL_REJECTED`
   denial. No approval service or no agent → `APPROVAL_UNAVAILABLE` (fail closed) (:444–456).
3. **Sandbox escalation** — [dsh-sandbox/src/escalation.ts:209–262](<C:\Users\dames\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-sandbox\src\escalation.ts#L209-L262>)
   `approveEscalation()`: repeating the effective mode returns it without approval (:211);
   a strictly wider mode (ladder `read-only → [workspace-write, danger-full-access]`,
   `workspace-write → [danger-full-access]`, :64–67) requires approval via the injected
   approver; missing approver/agent → `SANDBOX_ESCALATION_UNAVAILABLE`; `rejected` →
   `SANDBOX_ESCALATION_REJECTED`. Consumers: `write`/`edit` via
   [dsh-tool-fs/src/sandbox.ts:89–114](<C:\Users\dames\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-tool-fs\src\sandbox.ts#L89-L114>),
   `bash` ([dsh-tool-bash/src/index.ts:502–511](<C:\Users\dames\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-tool-bash\src\index.ts#L502-L511>)),
   `pwsh` ([dsh-tool-pwsh/src/index.ts:526–535](<C:\Users\dames\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-tool-pwsh\src\index.ts#L526-L535>)),
   PTC `run_code` ([dsh-tool-executor-ptc/src/ptc.ts:344–371](<C:\Users\dames\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-tool-executor-ptc\src\ptc.ts#L344-L371>)),
   and `plugin_manager` ([dsh-plugin-manager/src/tools.ts:105–112](<C:\Users\dames\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-plugin-manager\src\tools.ts#L105-L112>),
   `requestedMode: 'danger-full-access'`). Under `never` every widening ask resolves
   `rejected` before any execution.
4. **Confining backends** — fs fence ([dsh-fs-sandbox/src/index.ts:156–178](<C:\Users\dames\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-fs-sandbox\src\index.ts#L156-L178>)),
   bash/pwsh process confinement ([dsh-bash-sandbox](<C:\Users\dames\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-bash-sandbox\src\index.ts>),
   [dsh-pwsh-sandbox](<C:\Users\dames\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-pwsh-sandbox\src\index.ts>)):
   `danger-full-access` delegates unfenced; confined modes deny with `FS_SANDBOX_DENIED` /
   runner denial signatures, which the tool layer renders as `[sandbox: file access denied under <mode> mode]`.
   No usable backend for a confined mode fails closed (`SANDBOX_UNAVAILABLE`,
   [dsh-sandbox/src/index.ts:141–161](<C:\Users\dames\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-sandbox\src\index.ts#L141-L161>)).
5. **Delegation** — every in-process child is pinned `approval/policy: 'never'`
   (`source: 'delegation'`) at the delegation boundary regardless of the parent's policy
   ([dsh-subagent/src/child-agent.ts:249–280](<C:\Users\dames\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-subagent\src\child-agent.ts#L249-L280>)).

**Net effect in this session:** file/shell operations run under `danger-full-access` (no file
fence), and every approval-gated action (`plugin_manager` widening from a confined mode,
auto-review asks, any `kind: 'ask'` pre-execute) is deterministically rejected without a
prompt — matching the injected model-facing sentence (`NEVER_SENTENCE`, dsh-user-approval
src/index.ts:74).

---

## 2. What is solid (keep as-is)

- **`'never'` is enforced in the service's own request path, not in a listener** —
  `prepend`-registered answerers cannot override the deterministic rejection (index.ts:296–301).
- **Fail-closed everywhere:** no answerer / throwing answerer / non-vocabulary return →
  `unavailable`; no agent → deny; ask outside an open turn → throw before any audit append;
  escalation without approver/agent → `SANDBOX_ESCALATION_UNAVAILABLE`; `sandbox_permissions`
  with an unconfined executor → hard error; no sandbox backend for a confined mode → refuse
  to run unconfined.
- **One-shot grants only** — the outcome vocabulary has `allowed-once` and nothing persistent
  (types.ts:32); approval never mutates the session mode.
- **Strictly-wider ladder checked at execution, not baked into schemas** (escalation.ts:59–77);
  the schema enum is the closed target vocabulary so a confined session below a
  `danger-full-access` default still has a lever.
- **Audit pair is turn-enclosed** and always appended, even under `never`
  (`approval/asked`/`approval/decided`, types.ts:44–58, index.ts:252–259).
- **No check-here-write-there TOCTOU in the fs fence:** `checkedTarget` re-canonicalizes the
  fresh realpath (catching swapped symlink ancestors) and the mutation uses *that* target
  (fs-sandbox/src/index.ts:145–178).
- **Children are pinned to `never`** at delegation (child-agent.ts:254).
- **Remote answerers cannot grant under `never`:** the SDK JSON-RPC and ACP answerers are just
  `approval/request` listeners, which dispatch never happens under `never`
  ([dsh-sdk-jsonrpc-server/src/server.ts:123–137](<C:\Users\dames\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-sdk-jsonrpc-server\src\server.ts#L123-L137>),
  [dsh-acp/src/index.ts:158](<C:\Users\dames\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-acp\src\index.ts#L158>)).
- **Model-facing policy statement** is appended after retained history so switching policy
  doesn't rewrite the cached prompt prefix (index.ts:189–201), plus a sourced switch notice
  user message (index.ts:211–222).

---

## 3. Findings — concrete problems under (or around) the `never` policy

### F1 — Under `never`, denials still claim a human was asked (misleading model text + audit ambiguity). *Severity: medium*

- `escalationHintMarker()` always emits
  `…the approval prompt asks the user]` (escalation.ts:121–123), and
  `approveEscalation` maps the `never`-produced `rejected` outcome to
  `"the user rejected escalating this <subject> to "<mode>"…"` (escalation.ts:247–251).
  Under `never` no user was involved — the session policy auto-rejected. The model is told
  to "stop and explain instead of working around it", which is right, but the *reason* is
  wrong, and in a confined+`never` session it will first burn the advertised one-shot retry
  (see F2) against a guaranteed rejection.
- Same in the pipeline: `serviceAsk` renders `the user rejected tool "<name>"`
  (pipeline.ts:468) for what was a policy rejection.
- Audit: `approval/decided` records only `outcome: 'rejected'` (types.ts:55–58), so the durable
  log cannot distinguish "human said no" from "policy `never` auto-rejected".

**Fixes:**
1. Extend `approval/decided` with an optional `policy?: 'ask' | 'never'` (additive; old logs read
   as absent = dispatch happened) set when the policy short-circuit determined the outcome — or
   add outcome `'policy-rejected'` to `ApprovalOutcome` and normalize old `rejected` at read time.
2. Give `approveEscalation` an optional `policy` ingredient in `EscalationApproval` (the tool
   layers already hold `ctx.approval`): when `'never'`, short-circuit *before* calling the
   approver with a distinct code `SANDBOX_ESCALATION_POLICY_REJECTED` and the message
   `"escalating this <subject> to "<mode>" is rejected by the session's 'never' approval policy; do not retry with sandbox_permissions"`.
   Keep the service-level check (defense in depth) — this is for accurate messaging.
3. Make `escalationHintMarker(subject, policy?)` policy-aware; under `never` emit
   `[sandbox: escalation unavailable — the 'never' approval policy rejects it automatically]`
   instead of advertising the prompt. Call sites: dsh-tool-bash/src/render.ts:49,113,
   background.ts:37; dsh-tool-pwsh/src/render.ts:69,133, background.ts:39;
   dsh-tool-fs/src/sandbox.ts:143.

### F2 — Escalation fields and hint are advertised even when they can never succeed. *Severity: medium*

`FsSandboxController.escalationModes` = `ESCALATION_TARGETS` whenever a confining backend is
mounted (dsh-tool-fs/src/sandbox.ts:44–50), regardless of the session's approval policy; same
for bash/pwsh/ptc schemas. In a confined + `never` session (custom preset), the tool schemas
still advertise `sandbox_permissions` and every denial carries the "retry once" hint — a path
that `approveEscalation` will always reject. This wastes a model retry per denial and trains
the model to attempt an impossible escalation.

**Fix:** keep the static schema enum (it is registry-global and policy is per-session), but
make the *hint* and the *post-denial guidance* policy-aware per session (F1.3), and have
`resolvePolicy`/`approve*Escalation` fail fast with the policy-rejection message (F1.2)
instead of dispatching an ask that is known to reject. Optionally, the prompt contribution for
`sandbox_permissions` description (escalation.ts:132–134) can mention that under `never` the
retry is auto-rejected.

### F3 — Inconsistent handling of `sandbox_permissions === <effective mode>` across the four tools. *Severity: low*

Repeating the call's effective mode needs no approval by design ("repeating the mode needs no
approval"):
- `bash` early-returns before validation when `sandbox_permissions === effectiveMode`
  (dsh-tool-bash/src/index.ts:86) — bare repeated mode **allowed**.
- `write`/`edit` early-return likewise (dsh-tool-fs/src/sandbox.ts:91) — **allowed**.
- `pwsh` validates first with no effective-mode parameter
  (dsh-tool-pwsh/src/index.ts:110–121, execute at :527–531) — bare repeated mode throws
  `SANDBOX_ESCALATION_INVALID_ARGUMENT`.
- PTC `run_code` validates at ptc.ts:350 before any comparison — same rejection.
So the same arguments succeed on bash/fs and fail on pwsh/run_code. (When a justification *is*
supplied, all four paths converge on `approveEscalation`'s `mode === effectiveMode` return,
escalation.ts:211.)

**Fix:** move the repeated-mode early return into one shared helper in
[dsh-sandbox/src/escalation.ts](<C:\Users\dames\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-sandbox\src\escalation.ts>),
e.g. `normalizeEscalationArgs(args, effectiveMode): { mode?: string; justification?: string }`
that returns `{}` when `mode === effectiveMode` (before the pairing check), and call it from all
four tools. Add a contract test pinning identical behavior across bash/pwsh/fs/ptc.

### F4 — No public *effective* policy reader; auto-review only checks the session override. *Severity: low*

`ApprovalService.effectivePolicy()` is `private` (index.ts:270); only `overrideOf()` is public
(:279–281). The auto-review gate checks `ctx.approval.overrideOf(agent.session) === 'never'`
([dsh-experimental-auto-review/src/index.ts:770](<C:\Users\dames\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-experimental-auto-review\src\index.ts#L770>)),
so when `never` comes from the *composed config default* (no session override), a reviewer
denial is routed to `askUser` instead of the deterministic `denied()`, and the pipeline then
produces the misleading "the user rejected tool …" text (F1). It still fails closed (the
service rejects), but the audit pair is appended and the message is wrong.

**Fix:** expose `effectivePolicyOf(session: Session): ApprovalPolicy` on `ApprovalService` and
use it in auto-review (and anywhere else that needs the effective policy, e.g. F1/F2 hint
rendering). One-line delegation to the private method.

### F5 — Relaxing `never` → `ask` is not itself approval-gated. *Severity: medium (hardening)*

The `never` guarantee ("never prompt anyone") holds only while the `approval/policy` override
stays `never`. The write path — `/permission <preset>` → `permissionPresets.apply(...)` →
`ctx.approval.setPolicy(agent, policy)` ([dsh-permission-presets/src/index.ts:263–273](<C:\Users\dames\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-permission-presets\src\index.ts#L263-L273>),
:398–418) — appends `approval/policy: ask` with **no approval check**, and `commands.execute`
is a `@Remote` method ([dsh-commands/src/index.ts:360–378](<C:\Users\dames\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-commands\src\index.ts#L360-L378>))
that any connected client can invoke. Delegated children are pinned `never`, but the pin is just
an earlier log event — "later child switches still win over these events"
(child-agent.ts:263), so a child session that can append `approval/policy` can re-enable
prompting for itself. In this GUI a prompt would still be shown (and the user can decline); in
headless compositions there is no answerer, so it fails closed anyway. Still, the
deterministic-rejection promise is weaker than documented.

**Fix:** treat the relaxation `never` → `ask` as an approval-gated transition: when the current
effective policy is `never` and the requested one is `ask`, route the switch through the
approval seam (a `setPolicy` that asks under the *previous* policy before appending), or
require policy-switch events to carry a user-UI source and have the projection ignore
agent/remote-sourced relaxations in delegated sessions (`delegationDepth > 0`). At minimum,
keep the injected switch-notice user message (index.ts:215–221) — it already makes the change
visible to the model.

### F6 — Denial rendering differs between fs tools. *Severity: low*

`write`/`edit` map `FS_SANDBOX_DENIED` to marker **+ escalation hint**
(dsh-tool-fs/src/sandbox.ts:138–144), while the str-replace-editor maps to the marker only
([dsh-tool-str-replace-editor/src/index.ts:83–87](<C:\Users\dames\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-tool-str-replace-editor\src\index.ts#L83-L87>)).
Also, the tool descriptions say a denial is "a policy denial: do not retry another way"
(bash index.ts:101, pwsh index.ts:134) right next to the hint's "retry this exact command
once with sandbox_permissions" — consistent only if "another way" is read strictly. Under
`never` the hint half is wrong (F1/F2).

**Fix:** share one denial renderer (marker + optional policy-aware hint) in `@deepseek-ai/dsh-sandbox`
and use it from all four render sites; align the description wording ("do not retry except the
sanctioned one-shot `sandbox_permissions` retry — which the current approval policy may
auto-reject").

### F7 — GUI copy for the full-access confirm is inconsistent about scope. *Severity: low (UX)*

En locale: [dsh-client-ui-permission-presets/src/client/locales.ts:35](<C:\Users\dames\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-client-ui-permission-presets\src\client\locales.ts#L35>)
says "lets **new sessions** reduce confirmation steps", while :73 (another en block) says the
agent "reduces confirmation steps" — but `/permission` applies the preset to the **live**
session immediately (apply() writes `sandbox/mode` + `approval/policy` on `agent.session`).
Some locales (zh) only mention new sessions. The preset description in the service
("Full file access without approval prompts", permission-presets src/index.ts:189) is accurate
and should be quoted in the dialog.

**Fix:** unify the confirm copy to state both effects explicitly: "applies to this session now
and to new sessions: full file access, and approval prompts are disabled (policy `never`)".

### F8 — `never` does not cover `user-questions/request`. *Severity: info / design note*

`ask_user_question` rides a separate waterfall (`user-questions/request`,
[dsh-user-questions/src/index.ts:346–349](<C:\Users\dames\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-user-questions\src\index.ts#L346-L349>))
and is surfaced as pending input kind `question` vs `approval`
([dsh-api-session-controller/src/state/controller.ts:168](<C:\Users\dames\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-api-session-controller\src\state\controller.ts#L168>)).
So in a `never` session the agent can still interrupt the user with `ask_user_question`. If the
user's intent is "fully unattended", that channel still prompts.

**Fix:** document the boundary in the `never` sentence (index.ts:74) — e.g. append "(the
`ask_user_question` tool is a separate channel and still asks)" — or add a third policy value /
knob that also suppresses user questions in unattended runs.

### F9 — `plugin_manager` under `danger-full-access` runs with no approval and no approval audit. *Severity: info*

`approveEscalation` returns early when `requestedMode === effectiveMode` (escalation.ts:211),
so in this session `plugin_manager` mutations (install/enable/disable/exemption) execute with
no `approval/asked`/`decided` pair. That is intended ("requires danger-full-access permission
**or** approval"), and profile changes are persisted in the profile itself, but the session log
won't show the escalation decision.

**Fix (optional):** when the early return fires for a privileged tool, still append a
log-only session event (e.g. `permission/escalation-skipped { mode }`) so the durable record
shows the operation ran under standing full access.

---

## 4. Concrete improvement list (patch-shaped, prioritized)

1. **P0 — accurate `never` semantics in text & audit (F1):**
   - add `policy` to `approval/decided` (or new outcome `'policy-rejected'`, normalized on read);
   - add `SANDBOX_ESCALATION_POLICY_REJECTED` + optional `policy` ingredient in
     `EscalationApproval`, short-circuiting before dispatch;
   - policy-aware `escalationHintMarker(subject, policy?)` at all render sites.
2. **P1 — expose effective policy (F4):** public `ApprovalService.effectivePolicyOf(session)`;
   use it in auto-review (:770) and in hint rendering.
3. **P1 — gate policy relaxation (F5):** `never`→`ask` switches (via `/permission`,
   `permissionPresets.set`, or direct event append in delegated sessions) require an approval
   under the previous policy or a user-UI-sourced event.
4. **P2 — unify escalation arg normalization (F3):** shared `normalizeEscalationArgs` in
   `dsh-sandbox/escalation.ts`, adopted by bash, pwsh, fs, ptc + contract test.
5. **P2 — suppress impossible escalation advertising under `never` (F2):** per-session hint
   suppression / fail-fast in `resolvePolicy` and `approve*Escalation`.
6. **P3 — unify denial rendering (F6):** one renderer in `dsh-sandbox`; align "do not retry
   another way" wording with the sanctioned-retry hint.
7. **P3 — GUI copy (F7):** confirm dialog states the change applies to the current session
   immediately and disables approval prompts; quote the preset description.
8. **P3 — document the question channel boundary (F8)** in `NEVER_SENTENCE`, or add an
   unattended knob covering `user-questions/request`.
9. **P4 — optional audit breadcrumb (F9)** for standing-full-access privileged operations.

## 5. Suggested tests to add

- `never` + confined session: fs/bash/pwsh/run_code denial → hint text contains no "asks the
  user"; retry with `sandbox_permissions` + justification → `SANDBOX_ESCALATION_POLICY_REJECTED`
  (new code) and **no** `approval/request` dispatch reaches a recording listener; the
  `approval/asked`/`decided` pair (if dispatched) records `policy: 'never'`.
- `never` set via config default (no session override): auto-review denial takes the
  `denied()` path (after F4 fix), not `askUser`.
- Repeated effective mode with and without justification behaves identically across
  bash/pwsh/write/edit/run_code.
- Delegated child cannot append a relaxing `approval/policy` event (after F5 fix); parent
  `/permission workspace-write` under `never` asks first (or is rejected in headless).
- `approval/decided` replay: old logs without `policy` still read as dispatched outcomes.

---

## Appendix — primary files reviewed

- [dsh-user-approval/src/index.ts](<C:\Users\dames\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-user-approval\src\index.ts>) and [src/types.ts](<C:\Users\dames\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-user-approval\src\types.ts>) — policy seam, `decide()`, audit pair, switch notices
- [dsh-sandbox/src/escalation.ts](<C:\Users\dames\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-sandbox\src\escalation.ts>) and [src/index.ts](<C:\Users\dames\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-sandbox\src\index.ts>) — wider ladder, `approveEscalation`, markers, fail-closed errors
- [dsh-sandbox-policy/src/index.ts](<C:\Users\dames\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-sandbox-policy\src\index.ts>) + [session-mode.ts](<C:\Users\dames\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-sandbox-policy\src\session-mode.ts>) — `resolve()`, overrides, prompt context
- [dsh-permission-presets/src/index.ts](<C:\Users\dames\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-permission-presets\src\index.ts>) — preset table, `/permission`, `apply`, `pinInitialPermission`
- [dsh-tools/src/pipeline.ts](<C:\Users\dames\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-tools\src\pipeline.ts>) — `serviceAsk`, pre/post-execute
- [dsh-tool-fs/src/sandbox.ts](<C:\Users\dames\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-tool-fs\src\sandbox.ts>), [dsh-tool-bash/src/index.ts](<C:\Users\dames\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-tool-bash\src\index.ts>), [dsh-tool-pwsh/src/index.ts](<C:\Users\dames\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-tool-pwsh\src\index.ts>), [dsh-tool-executor-ptc/src/ptc.ts](<C:\Users\dames\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-tool-executor-ptc\src\ptc.ts>), [dsh-plugin-manager/src/tools.ts](<C:\Users\dames\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-plugin-manager\src\tools.ts>) — the four escalation consumers + plugin management
- [dsh-fs-sandbox/src/index.ts](<C:\Users\dames\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-fs-sandbox\src\index.ts>), [dsh-bash-sandbox](<C:\Users\dames\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-bash-sandbox\src\index.ts>), [dsh-pwsh-sandbox](<C:\Users\dames\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-pwsh-sandbox\src\index.ts>) — enforcement backends
- [dsh-subagent/src/child-agent.ts](<C:\Users\dames\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-subagent\src\child-agent.ts>) — delegation pinning
- [dsh-experimental-auto-review/src/index.ts](<C:\Users\dames\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-experimental-auto-review\src\index.ts>) — the in-tree `kind: 'ask'` producer
- [dsh-client-ui-approval](<C:\Users\dames\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-client-ui-approval\src\client\index.ts>), [dsh-client-ui-permission-presets](<C:\Users\dames\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-client-ui-permission-presets\src\client>) — GUI answerer + preset picker/confirm
- [dsh-commands/src/index.ts](<C:\Users\dames\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-commands\src\index.ts>), [dsh-api-session-controller/src/state/controller.ts](<C:\Users\dames\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-api-session-controller\src\state\controller.ts>), [dsh-sdk-jsonrpc-server/src/server.ts](<C:\Users\dames\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-sdk-jsonrpc-server\src\server.ts>), [dsh-acp/src/index.ts](<C:\Users\dames\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-acp\src\index.ts>) — answerer channels & pending-input surfaces
