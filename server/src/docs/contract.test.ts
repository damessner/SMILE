import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Documentation that contradicts the code is a defect, not a style preference.
 *
 * This repository routes its knowledge through four directive documents
 * (`IF_YOU_ARE_AN_AI.md`, `AGENTS.md`, `AI.md`, `docs/SECURITY.md`) that tell the next
 * agent what the invariants are and which known violations to leave alone. Those
 * documents drifted badly: one asserted as a *live* bug a WebSocket event mismatch that
 * had already been fixed, and its own review checklist told the agent to perform the
 * rename that would *reintroduce* the bug. `SECURITY.md` prescribed a three-step fix for a
 * gap that was already closed, and quoted a `guards.ts` branch that no longer read that
 * way. Four documents gave three different test counts.
 *
 * A doc that tells an agent to break working code is worse than no doc, so the specific
 * failure modes are pinned here rather than left to a future reader's diligence.
 *
 * These are assertions about documentation, deliberately. They do not verify the code is
 * correct — the server and client suites do that. They verify the docs do not instruct a
 * destructive edit and that the numbers quoted in them are the numbers the suites print.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, '../..');
const repoRoot = path.resolve(here, '../../..');

const read = (rel: string) => readFileSync(path.join(repoRoot, rel), 'utf-8');

const IF_YOU = read('IF_YOU_ARE_AN_AI.md');
const AGENTS = read('AGENTS.md');
const AI = read('AI.md');
const SECURITY = read('docs/SECURITY.md');

/** Every `type: '...'` the server actually broadcasts. */
function emittedEventNames(): Set<string> {
  const src = readFileSync(path.join(serverRoot, 'src', 'ws', 'live-sync.ts'), 'utf-8');
  const routes = readdirSync(path.join(serverRoot, 'src', 'routes'))
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => readFileSync(path.join(serverRoot, 'src', 'routes', f), 'utf-8'))
    .join('\n');
  const names = new Set<string>();
  for (const src2 of [src, routes]) {
    for (const m of src2.matchAll(/type:\s*'([A-Z][A-Z0-9_]+)'/g)) names.add(m[1]!);
  }
  return names;
}

/** Every `case '...'` the client actually handles. */
function handledEventNames(): Set<string> {
  const src = readFileSync(
    path.join(repoRoot, 'client', 'src', 'hooks', 'useLiveSync.ts'),
    'utf-8',
  );
  return new Set([...src.matchAll(/case\s+'([A-Z][A-Z0-9_]+)'/g)].map((m) => m[1]!));
}

describe('LiveSync event contract (Invariant 3)', () => {
  const emitted = emittedEventNames();
  const handled = handledEventNames();

  it('found events on both sides (guard against a silent regex no-op)', () => {
    expect(emitted.size).toBeGreaterThan(10);
    expect(handled.size).toBeGreaterThan(10);
  });

  it.each([...emitted].sort())('the client handles %s', (name) => {
    expect(handled.has(name)).toBe(true);
  });

  it.each([...handled].sort())('the client case %s corresponds to a real server event', (name) => {
    expect(emitted.has(name)).toBe(true);
  });
});

describe('directive documents do not instruct a destructive edit', () => {
  it('IF_YOU_ARE_AN_AI.md does not tell an agent to reintroduce the fixed event rename', () => {
    // The dangerous form is an *instruction* to rename. The historical, safe form is a
    // description of what went wrong. So a bare mention is fine; an imperative is not.
    expect(IF_YOU).not.toMatch(/rename\s+`?TIMEOUT_ISSUED`?\s*(?:→|to)\s*`?TIMEOUT_CREATED`?/i);
    expect(IF_YOU).not.toMatch(/rename\s+`?FINAL_RANK_CONFIRMED`?\s*(?:→|to)\s*`?FINAL_RANK_LOCKED`?/i);
  });

  it('IF_YOU_ARE_AN_AI.md does not claim the WS mismatch is still live', () => {
    expect(IF_YOU).not.toMatch(/KNOWN VIOLATION\s*—\s*two broadcasts are silently dropped/i);
  });

  it('SECURITY.md does not prescribe a fix for a gap that is already closed', () => {
    expect(SECURITY).not.toMatch(/Known gap: `GET \/api\/timeouts\/active` is not scoped/i);
  });

  it('SECURITY.md does not quote the obsolete getGlobalAccess branch', () => {
    // The current code returns an empty allowlist for a missing teacherId; the quoted
    // `classIds: null` branch is what made the old argument (and the old guidance) wrong.
    expect(SECURITY).not.toMatch(/if \(isAdmin \|\| isHeadmaster \|\| !user\.teacherId\)/);
  });
});

describe('directive documents: test-run hygiene', () => {
  const docs: Array<[string, string]> = [
    ['AGENTS.md', AGENTS],
    ['AI.md', AI],
    ['IF_YOU_ARE_AN_AI.md', IF_YOU],
    ['docs/SECURITY.md', SECURITY],
  ];

  it('no document still quotes a superseded count', () => {
    // Backstop for the specific historical totals, so a doc cannot quietly revert.
    for (const [name, doc] of docs) {
      expect(`${name}: ${doc}`).not.toMatch(/\b(144|159|178|324)\s+(server\s+)?tests?\b/i);
      expect(`${name}: ${doc}`).not.toMatch(/\b(68|78|79|81|132)\s+client tests\b/i);
    }
  });

  it('warns against running vitest from the repo root', () => {
    // There is no root vitest config, so a bare `npx vitest` at the root collects both
    // workspaces under the server's environment and fails spuriously.
    expect(AGENTS).toMatch(/npm test/);
    expect(AGENTS).toMatch(/no root vitest config|do not run `npx vitest`/i);
  });
});

describe('iOS auth response contract', () => {
  const iosModels = read('ios/SMILE/Models/Models.swift');
  const iosApiClient = read('ios/SMILE/Services/APIClient.swift');

  it('decodes LoginResponse.expiresAt as String? matching sessionExpiresAt() ISO string', () => {
    expect(iosModels).toMatch(/struct\s+LoginResponse[\s\S]*?let\s+expiresAt:\s*String\?/);
    expect(iosModels).not.toMatch(/struct\s+LoginResponse[\s\S]*?let\s+expiresAt:\s*Int\?/);
  });

  it('decodes flat User payloads from GET /api/auth/me', () => {
    expect(iosModels).toMatch(/struct\s+MeResponse[\s\S]*?try\s+User\(from:\s*decoder\)/);
  });

  it('sets URLRequest.mainDocumentURL so iOS attaches SameSite=Strict session cookies', () => {
    expect(iosApiClient).toMatch(/req\.mainDocumentURL\s*=\s*url/);
  });
});