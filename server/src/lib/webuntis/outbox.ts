import { and, asc, eq, lt, lte } from 'drizzle-orm';
import { config } from '../../config.js';
import { db } from '../../db/index.js';
import { webuntisSyncOutbox } from '../../db/schema.js';
import { getWebUntisClientForUser } from './client.js';
import { WebUntisError, isWebUntisError } from './errors.js';

export type ClassregOutboxKind = 'classreg_upsert' | 'classreg_correction';
export type ClassregEventKind = 'yellow' | 'red' | 'timeout';

/**
 * Everything needed to render the entry later.
 *
 * `date`/`time` are rendered when the entry is queued, not when the worker
 * retries. Re-rendering at retry time would move a Monday incident to
 * Wednesday if the queue were stuck for two days.
 */
export interface ClassregOutboxPayload {
  pupilId: number;
  classId: number;
  eventKind: ClassregEventKind;
  text: string;
  categoryId: number;
  /** YYYY-MM-DD (local). */
  date: string;
  /** HH:mm (local). */
  time: string;
  note?: string | null;
  sourceId?: string;
}

export interface EnqueueOutboxInput {
  userId?: string | null;
  kind: ClassregOutboxKind;
  payload: ClassregOutboxPayload;
  /** Optional natural key; a duplicate enqueue is ignored. */
  idempotencyKey?: string | null;
}

export async function enqueueWebUntisOutbox(input: EnqueueOutboxInput): Promise<void> {
  await db
    .insert(webuntisSyncOutbox)
    .values({
      userId: input.userId ?? null,
      kind: input.kind,
      idempotencyKey: input.idempotencyKey ?? null,
      payload: input.payload,
      status: 'pending',
      maxAttempts: config.webuntis.sync.maxAttempts,
      nextAttemptAt: new Date(),
    })
    .onConflictDoNothing();
}

export interface OutboxProcessResult {
  processed: number;
  succeeded: number;
  retried: number;
  failed: number;
}

function backoffMs(attempts: number): number {
  const base = 15_000;
  return Math.min(base * 2 ** Math.max(attempts - 1, 0), 60 * 60 * 1000);
}

/**
 * How long a `processing` claim is trusted.
 *
 * A crash between the claim and the final status update leaves a row in
 * `processing` forever. The next pass reclaims rows whose claim is older than
 * this. A claim is normally held for a few seconds (the outbound timeout), so
 * five minutes is far beyond any legitimate hold.
 */
const PROCESSING_LEASE_MS = 5 * 60 * 1000;

function asDateString(payload: ClassregOutboxPayload): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(payload.date) ? payload.date : null;
}

async function processItem(row: typeof webuntisSyncOutbox.$inferSelect): Promise<void> {
  const payload = row.payload as ClassregOutboxPayload | null;
  if (!payload || typeof payload.pupilId !== 'number' || typeof payload.classId !== 'number') {
    throw new WebUntisError('WEBUNTIS_INVALID_REQUEST', 'Ungültiger Outbox-Eintrag (Payload).');
  }
  const date = asDateString(payload);
  if (!date || !/^\d{2}:\d{2}$/.test(payload.time)) {
    throw new WebUntisError('WEBUNTIS_INVALID_REQUEST', 'Ungültiges Datum oder Ungültige Uhrzeit im Outbox-Eintrag.');
  }

  // The service account is deliberately absent here: mirrors are official
  // records and must be written by the teacher who caused them, not by a shared
  // monitor identity.
  const resolved = await getWebUntisClientForUser(row.userId);
  if (!resolved) {
    throw new WebUntisError(
      'WEBUNTIS_NOT_CONNECTED',
      'Die Lehrkraft hat kein persönliches WebUntis-Konto (mehr) verknüpft.',
    );
  }

  const result = await resolved.client.createKlassenbuchEntry({
    studentId: payload.pupilId,
    classId: payload.classId,
    date,
    time: payload.time,
    categoryId: payload.categoryId,
    text: payload.text,
  });

  // The client reports a rejected form/login page as `{ success: false }`
  // rather than throwing. Treating that as done would drop an official entry
  // while the outbox claims it was mirrored.
  if (!result.success) {
    throw new WebUntisError(
      'WEBUNTIS_UNAVAILABLE',
      'WebUntis hat den Klassenbucheintrag nicht übernommen.',
      { retryable: true },
    );
  }
}

/**
 * Claim and process a batch of due outbox rows.
 *
 * Claiming is optimistic (`status = 'pending'` in the UPDATE predicate), so two
 * workers cannot both write the same entry. A lost race simply skips the row.
 */
export async function processWebUntisOutbox(
  options: { limit?: number; now?: Date } = {},
): Promise<OutboxProcessResult> {
  const now = options.now ?? new Date();
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 100);
  const result: OutboxProcessResult = { processed: 0, succeeded: 0, retried: 0, failed: 0 };

  // Recover claims left behind by a crash or deploy between claim and status
  // update. Without this a row would stay in `processing` forever and the
  // official record would silently miss the entry.
  await db
    .update(webuntisSyncOutbox)
    .set({ status: 'pending', updatedAt: now })
    .where(
      and(
        eq(webuntisSyncOutbox.status, 'processing'),
        lt(webuntisSyncOutbox.updatedAt, new Date(now.getTime() - PROCESSING_LEASE_MS)),
      ),
    );

  const candidates = await db
    .select()
    .from(webuntisSyncOutbox)
    .where(
      and(
        eq(webuntisSyncOutbox.status, 'pending'),
        lte(webuntisSyncOutbox.nextAttemptAt, now),
      ),
    )
    .orderBy(asc(webuntisSyncOutbox.createdAt))
    .limit(limit);

  for (const candidate of candidates) {
    const [claimed] = await db
      .update(webuntisSyncOutbox)
      .set({
        status: 'processing',
        attempts: candidate.attempts + 1,
        updatedAt: now,
      })
      .where(
        and(
          eq(webuntisSyncOutbox.id, candidate.id),
          eq(webuntisSyncOutbox.status, 'pending'),
        ),
      )
      .returning();
    if (!claimed) continue;

    result.processed += 1;

    try {
      await processItem(claimed);
      await db
        .update(webuntisSyncOutbox)
        .set({ status: 'done', lastError: null, updatedAt: new Date() })
        .where(eq(webuntisSyncOutbox.id, claimed.id));
      result.succeeded += 1;
    } catch (err) {
      const retryable = isWebUntisError(err) ? err.retryable : false;
      const ageMs = now.getTime() - claimed.createdAt.getTime();
      const canRetry =
        retryable &&
        claimed.attempts < claimed.maxAttempts &&
        ageMs < config.webuntis.sync.maxAgeMs;

      const message = err instanceof Error ? err.message : String(err);
      await db
        .update(webuntisSyncOutbox)
        .set({
          status: canRetry ? 'pending' : 'failed',
          lastError: message.slice(0, 1000),
          nextAttemptAt: canRetry ? new Date(now.getTime() + backoffMs(claimed.attempts)) : now,
          updatedAt: new Date(),
        })
        .where(eq(webuntisSyncOutbox.id, claimed.id));

      if (canRetry) result.retried += 1;
      else result.failed += 1;
    }
  }

  return result;
}

/**
 * Start the background retry loop. Returns a stop function.
 *
 * `unref()` keeps the interval from holding the process open during shutdown.
 */
export function registerWebUntisOutboxWorker(options: {
  intervalMs?: number;
  onError?: (err: unknown) => void;
} = {}): () => void {
  const intervalMs = options.intervalMs ?? config.webuntis.sync.intervalMs;
  let stopped = false;
  let running = false;

  const run = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await processWebUntisOutbox();
    } catch (err) {
      options.onError?.(err);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void run();
  }, intervalMs);
  timer.unref?.();
  void run();

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
