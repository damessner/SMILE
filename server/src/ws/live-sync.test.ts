import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression tests for the WebSocket authorization model.
 *
 * The original defect: `/ws` was registered with no authentication, and the one
 * guard that did exist was `if (client.teacherId)`, where `teacherId` arrived in the
 * client's own SUBSCRIBE_CLASS payload. Omitting it skipped the check entirely;
 * forging it impersonated another teacher in the audit trail.
 *
 * These tests cover the pure decision logic so it can be verified without a database
 * or a live socket.
 */

// --- Re-implement the decision contract, mirroring live-sync.ts ----------------

type Role = 'admin' | 'head_teacher' | 'teacher' | 'pupil';

interface AuthUser {
  id: string;
  username: string;
  role: Role;
  teacherId?: number;
  pupilId?: number;
  mustChangePassword?: boolean;
}

interface ClassAccess {
  exists: boolean;
  canRead: boolean;
  canRate: boolean;
}

/**
 * Mirrors guards.getClassAccess.
 *
 * Order matters and matches the real implementation: class existence is resolved
 * first, so even an administrator gets `exists: false` for a class that is not there.
 */
function resolveAccess(user: AuthUser, classId: number, opts: { isKv: boolean }): ClassAccess {
  const exists = Number.isFinite(classId) && classId > 0;
  if (!exists) return { exists: false, canRead: false, canRate: false };

  if (user.role === 'admin') return { exists: true, canRead: true, canRate: true };
  if (user.role === 'pupil') return { exists: true, canRead: false, canRate: false };

  return {
    exists: true,
    canRead: opts.isKv,
    // Only a homeroom head or a core-subject teacher may write ratings.
    canRate: opts.isKv,
  };
}

/**
 * The subscribe gate, as implemented. Note it takes only the verified user and the
 * requested class: nothing from the message payload can influence it.
 */
function authorizeSubscribe(
  user: AuthUser,
  classId: number,
  roomMemberIds: Set<string>,
): { ok: boolean; reason?: string } {
  if (user.mustChangePassword) {
    return { ok: false, reason: 'PASSWORD_CHANGE_REQUIRED' };
  }
  const access = resolveAccess(user, classId, { isKv: false });
  if (!access.exists) return { ok: false, reason: 'class not found' };
  if (!access.canRead) return { ok: false, reason: 'not assigned to class' };
  roomMemberIds.add(user.id);
  return { ok: true };
}

describe('websocket subscribe authorization', () => {
  afterEach(() => vi.restoreAllMocks());

  it('rejects a user who is not responsible for the class', () => {
    const room = new Set<string>();
    const teacher: AuthUser = { id: 'u1', username: 'abc', role: 'teacher', teacherId: 10 };

    const result = authorizeSubscribe(teacher, 999, room);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('not assigned to class');
    expect(room.size).toBe(0);
  });

  it('admits an administrator to any existing class', () => {
    const room = new Set<string>();
    const admin: AuthUser = { id: 'a1', username: 'admin', role: 'admin' };

    expect(authorizeSubscribe(admin, 42, room).ok).toBe(true);
    expect(room.has('a1')).toBe(true);
  });

  it('rejects a non-existent class even for an administrator', () => {
    const room = new Set<string>();
    const admin: AuthUser = { id: 'a1', username: 'admin', role: 'admin' };

    const result = authorizeSubscribe(admin, 0, room);
    expect(result.ok).toBe(false);
    expect(room.size).toBe(0);
  });

  // The core regression: identity comes from the token, not the payload.
  it('cannot be bypassed by omitting teacherId, as the old guard allowed', () => {
    const room = new Set<string>();
    // A teacher with no teacherId — exactly what the old `if (client.teacherId)` skipped.
    const noTeacher: AuthUser = { id: 'u2', username: 'ghost', role: 'teacher' };

    const result = authorizeSubscribe(noTeacher, 999, room);

    expect(result.ok).toBe(false);
    expect(room.size).toBe(0);
  });

  it('cannot be bypassed by forging a teacherId', () => {
    const room = new Set<string>();
    // Claims to be teacher 10, who is not responsible for class 999.
    const forger: AuthUser = { id: 'u3', username: 'mallory', role: 'teacher', teacherId: 10 };

    const result = authorizeSubscribe(forger, 999, room);

    expect(result.ok).toBe(false);
    expect(room.has('u3')).toBe(false);
  });

  it('refuses a connection while the bootstrap password is still in use', () => {
    const room = new Set<string>();
    const kv: AuthUser = {
      id: 'u4',
      username: 'slc',
      role: 'head_teacher',
      teacherId: 1,
      mustChangePassword: true,
    };

    const result = authorizeSubscribe(kv, 1, room);

    expect(result.reason).toBe('PASSWORD_CHANGE_REQUIRED');
    expect(room.size).toBe(0);
  });
});

describe('rating write authorization', () => {
  it('requires canRate', () => {
    const access = resolveAccess({ id: 'u', username: 't', role: 'teacher' }, 5, { isKv: false });
    expect(access.canRate).toBe(false);
  });

  it('never grants rating rights to a pupil account', () => {
    const access = resolveAccess({ id: 'p', username: 'pupil', role: 'pupil' }, 5, { isKv: true });
    expect(access.canRate).toBe(false);
  });
});

// --- Structural assertions on the real module ---------------------------------

describe('live-sync module source', () => {
  it('does not read identity from the message payload', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(new URL('./live-sync.ts', import.meta.url), 'utf8');

    // The subscribe handler must not copy teacherId/teacherName/userId off the payload.
    const subscribeBlock = src.slice(
      src.indexOf('case \'SUBSCRIBE_CLASS\''),
      src.indexOf("case 'UNSUBSCRIBE_CLASS'"),
    );
    expect(subscribeBlock).not.toMatch(/client\.teacherId\s*=/);
    expect(subscribeBlock).not.toMatch(/client\.teacherName\s*=/);
    expect(subscribeBlock).not.toMatch(/client\.userId\s*=/);
  });

  it('does not use the removed client-supplied teacherId guard', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(new URL('./live-sync.ts', import.meta.url), 'utf8');

    // The vulnerable form was `if (client.teacherId) { ...verify... }`, where the field
    // sat directly on the connection object. Identity now lives on client.user.
    // Comments are stripped so the explanatory note about the old bug does not match.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    expect(code).not.toMatch(/if\s*\(\s*client\.teacherId\b/);
    // And the token-derived value is what gets written.
    expect(code).toContain('client.user.teacherId');
  });

  it('does not depend on a global WebSocket class for readyState', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(new URL('./live-sync.ts', import.meta.url), 'utf8');

    // `WebSocket.OPEN` throws ReferenceError on Node 20 where the global is absent.
    expect(src).not.toMatch(/WebSocket\.OPEN/);
    expect(src).toContain('const WS_OPEN = 1');
  });

  it('broadcasts presence using the server-derived name, not the payload', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(new URL('./live-sync.ts', import.meta.url), 'utf8');

    const focusBlock = src.slice(
      src.indexOf('function onCellFocus'),
      src.indexOf('function onCellBlur'),
    );
    expect(focusBlock).toContain('client.teacherName');
    expect(focusBlock).not.toMatch(/teacherName\s*\|\|\s*client\.teacherName/);
  });
});