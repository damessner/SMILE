import { describe, expect, it } from 'vitest';
import { scopeAllowsClass, scopeClassIds, type WebUntisScope } from './scope.js';

function scope(classIds: number[] | null): WebUntisScope {
  return { unrestricted: classIds === null, classIds, teacherId: 10 };
}

describe('WebUntis scope', () => {
  it('lets school-wide users query without a class filter', () => {
    const unrestricted = scope(null);
    expect(scopeAllowsClass(unrestricted, 430)).toBe(true);
    expect(scopeClassIds(unrestricted)).toBeNull();
    expect(scopeClassIds(unrestricted, 430)).toEqual([430]);
  });

  it('limits teachers to their own classes', () => {
    const teacher = scope([430, 431]);
    expect(scopeClassIds(teacher)).toEqual([430, 431]);
    expect(scopeClassIds(teacher, 430)).toEqual([430]);
  });

  it('returns no classes when a teacher asks for a foreign class', () => {
    const teacher = scope([430]);
    expect(scopeAllowsClass(teacher, 999)).toBe(false);
    expect(scopeClassIds(teacher, 999)).toEqual([]);
  });

  it('gives pupils and unlinked accounts an empty scope', () => {
    const empty = scope([]);
    expect(scopeClassIds(empty)).toEqual([]);
    expect(scopeClassIds(empty, 430)).toEqual([]);
  });
});
