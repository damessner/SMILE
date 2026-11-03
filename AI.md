# AI.md

The durable project rules live in `AGENTS.md` and `IF_YOU_ARE_AN_AI.md`. The
security history lives in `docs/SECURITY.md`; the failure-mode history lives in
`docs/history/invariants-history.md`.

When reviewing a change, prefer tests that exercise the handler or database over
tests that grep source text. A source-regex test can stay green while the runtime
behaviour is broken.
