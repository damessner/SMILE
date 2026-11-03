# IF_YOU_ARE_AN_AI — SMILE invariants

These are the rules that have already caused production bugs when broken. They
are stated as positive requirements; do not invert them.

1. **Canonical subject codes.** Every write path must resolve a subject through
   `normalizeKnownSubject()`. `normalizeSubject()` is a read-time coercer and may
   mint a code for unknown input; never persist its output on a write.
2. **Natural keys and OCC.** `evaluations` is unique on
   `(round_id, pupil_id, class_id, subject_code)`; `evaluation_items` is unique on
   `(evaluation_id, item_key)`. Version increments belong in SQL
   (`version = version + 1`), not in application memory.
3. **Live-sync symmetry.** Every `type` broadcast by the server must have a
   matching client handler. The contract test compares the two sets.
4. **Subject isolation.** A submission or conflict for one subject must never
   mark another subject submitted. Use `isSubjectMatch`/`isSubmittedForSubject`.
5. **Class and pupil scoping.** A route that accepts `classId` and `pupilId` must
   verify the pupil belongs to that class and that the caller may act in that
   class. A report of "foreign comments" is controlled by
   `STATISTICS_SHOW_FOREIGN_COMMENTS`.
6. **Secrets and pupil data.** `.env`, live dumps, CSV exports and generated
   reports stay outside the repository. `JWT_SECRET` and `DATABASE_URL` are
   validated at boot and the leaked historical values are refused.

> Historical note: a previous document told an agent to rename
> `TIMEOUT_ISSUED` to `TIMEOUT_CREATED` and `FINAL_RANK_CONFIRMED` to
> `FINAL_RANK_LOCKED`. Do **not** perform those renames; the server and client
> already agree on the current names.
