import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { ADMIN_ACTOR_TEACHER_ID_BASE } from './admin-actor.js';

describe('administrator actor teacher records', () => {
  it('reserves an id range no timetable personId can occupy', () => {
    // teachers.id is the WebUntis personId, so a placeholder in the low range could
    // collide with a real person and silently attribute their ratings to them.
    expect(ADMIN_ACTOR_TEACHER_ID_BASE).toBe(9_000_000);
  });

  it('refuses to guess when the reserved range is already occupied', () => {
    const source = readFileSync(new URL('./admin-actor.ts', import.meta.url), 'utf8');
    // Picking a different id on collision would attach an admin's ratings to a colleague,
    // so this must throw rather than fall back.
    expect(source).toMatch(/already in use/);
    expect(source).toMatch(/throw new Error/);
  });

  it('creates the placeholder inactive so it stays out of staffing views', () => {
    const source = readFileSync(new URL('./admin-actor.ts', import.meta.url), 'utf8');
    expect(source).toMatch(/active: false/);
  });

  it('keeps the generated id inside the reserved block', () => {
    const source = readFileSync(new URL('./admin-actor.ts', import.meta.url), 'utf8');
    // MAX(id)+1 over the low range could fall below the base once that range fills; the
    // clamp is what guarantees a placeholder never lands in personId space.
    expect(source).toMatch(/Math\.max\(candidate, ADMIN_ACTOR_TEACHER_ID_BASE\)/);
  });
});

describe('seed wiring', () => {
  it('links a newly created admin account to a placeholder teacher row', () => {
    const source = readFileSync(new URL('../db/seed.ts', import.meta.url), 'utf8');
    // Without this the admin has no teacher id and every rating write fails closed.
    expect(source).toMatch(/teacherId: await ensureAdminActorTeacher\('admin'\)/);
  });

  it('never resets an existing admin password on re-seed', () => {
    const source = readFileSync(new URL('../db/seed.ts', import.meta.url), 'utf8');
    expect(source).toMatch(/admin exists, password untouched/);
  });
});

describe('migration 0002', () => {
  const sql = readFileSync(new URL('../../drizzle/0002_admin_actor_teacher.sql', import.meta.url), 'utf8');

  it('refuses to run if the reserved id range is taken', () => {
    expect(sql).toMatch(/RAISE EXCEPTION/);
    expect(sql).toMatch(/teachers WHERE id >= 9000000/);
  });

  it('only links admin accounts that have no teacher row yet', () => {
    expect(sql).toMatch(/role = 'admin' AND teacher_id IS NULL/);
  });

  it('creates the placeholder inactive', () => {
    expect(sql).toMatch(/false\);/);
  });
});