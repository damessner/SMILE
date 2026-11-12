import type { FastifyPluginAsync } from 'fastify';
import { and, eq, gt, inArray, isNull, ne } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  behaviorCards,
  finalRanks,
  pupils,
  schoolClasses,
  timeoutIncidents,
} from '../db/schema.js';
import { config } from '../config.js';
import {
  forbid,
  getClassAccess,
  getGlobalAccess,
  requireAuth,
  type ClassAccess,
} from '../lib/guards.js';
import { computePupilBehaviorStage } from '../lib/behavior-stages.js';
import { getLatestRound } from '../lib/rounds.js';

/**
 * The "Alle Klassen" classroom-behaviour overview.
 *
 * This is the read model behind the school-wide behaviour view: one row per active
 * pupil with the status a teacher needs before deciding on a card, Time-Out or
 * Cool-Down (confirmed rank, behaviour stage, active cards/time-outs) plus whether
 * the caller may act in that pupil's class.
 *
 * It is deliberately not a general pupil directory: no comments, no evaluations,
 * no ratings and no per-teacher notes. Those stay behind the class-scoped routes.
 */

interface StatusPupil {
  id: number;
  fullName: string;
  classId: number;
  className: string;
  grade: number;
  rank: 'Lehrling' | 'Geselle' | 'Meister' | null;
  stage: {
    level: number;
    title: string;
    type: 'green' | 'neutral' | 'red';
    behaviorGrade: string;
  } | null;
  counts: {
    green: number;
    yellow: number;
    red: number;
    timeout: number;
    cooldown: number;
  };
  /** The running Time-Out / Cool-Down for this pupil, if there is one. */
  activeIncident: {
    id: string;
    kind: 'timeout' | 'cooldown';
    sentAt: Date;
    taskAssignment: string;
  } | null;
  /** True when the caller may record behaviour for this pupil (own class or school-wide). */
  canRecord: boolean;
}

export const behaviorRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/behavior/overview — every class, every active pupil, behaviour status.
   *
   * Staff only. When BEHAVIOUR_SCHOOL_WIDE is disabled the list is scoped to the
   * caller's own classes (or all classes for school leadership, exactly like the
   * statistics scope), so a misconfigured deployment does not silently publish the
   * school roster.
   */
  fastify.get('/overview', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const user = requireAuth(request);

    if (user.role === 'pupil') {
      return forbid(reply, 'Die Klassenübersicht ist für Lehrkräfte freigegeben.');
    }

    const schoolWide = config.behaviourSchoolWide;
    // A read-only "Ansehen als" session may look, but not act.
    const canActSchoolWide = schoolWide && user.viewAs !== true;

    const allClasses = await db
      .select({ id: schoolClasses.id, name: schoolClasses.name, grade: schoolClasses.grade })
      .from(schoolClasses)
      .where(and(ne(schoolClasses.name, 'LW'), gt(schoolClasses.grade, 0)))
      .orderBy(schoolClasses.grade, schoolClasses.name);

    let visibleClasses = allClasses;
    /** Per-class access for the non-school-wide mode; resolved lazily per class. */
    let accessByClass: Map<number, ClassAccess> | null = null;

    if (!schoolWide) {
      const global = await getGlobalAccess(user);
      visibleClasses =
        global.classIds === null
          ? allClasses
          : allClasses.filter((cls) => global.classIds!.includes(cls.id));
      accessByClass = new Map(
        await Promise.all(
          visibleClasses.map(async (cls): Promise<[number, ClassAccess]> => [
            cls.id,
            await getClassAccess(user, cls.id),
          ]),
        ),
      );
    }

    if (visibleClasses.length === 0) {
      return reply.send({ schoolWide, classes: [], pupils: [] });
    }

    const classIds = visibleClasses.map((cls) => cls.id);

    const classPupils = await db
      .select({
        id: pupils.id,
        fullName: pupils.fullName,
        classId: pupils.classId,
        className: schoolClasses.name,
        grade: schoolClasses.grade,
      })
      .from(pupils)
      .innerJoin(schoolClasses, eq(schoolClasses.id, pupils.classId))
      .where(and(inArray(pupils.classId, classIds), eq(pupils.isArchived, false)))
      .orderBy(schoolClasses.grade, schoolClasses.name, pupils.fullName);

    const pupilIds = classPupils.map((p) => p.id);
    if (pupilIds.length === 0) {
      return reply.send({ schoolWide, classes: visibleClasses, pupils: [] });
    }

    const cards = await db
      .select({
        pupilId: behaviorCards.pupilId,
        cardType: behaviorCards.cardType,
      })
      .from(behaviorCards)
      .where(and(inArray(behaviorCards.pupilId, pupilIds), isNull(behaviorCards.revokedAt)));

    const incidents = await db
      .select({
        id: timeoutIncidents.id,
        pupilId: timeoutIncidents.pupilId,
        kind: timeoutIncidents.kind,
        status: timeoutIncidents.status,
        sentAt: timeoutIncidents.sentAt,
        taskAssignment: timeoutIncidents.taskAssignment,
      })
      .from(timeoutIncidents)
      .where(inArray(timeoutIncidents.pupilId, pupilIds));

    const round = await getLatestRound();
    const confirmedRanks =
      round === null
        ? []
        : await db
            .select({ pupilId: finalRanks.pupilId, rank: finalRanks.rank })
            .from(finalRanks)
            .where(and(inArray(finalRanks.pupilId, pupilIds), eq(finalRanks.roundId, round.id)));
    const rankByPupil = new Map(confirmedRanks.map((row) => [row.pupilId, row.rank]));

    const cardsByPupil = new Map<number, string[]>();
    for (const card of cards) {
      const list = cardsByPupil.get(card.pupilId) ?? [];
      list.push(card.cardType);
      cardsByPupil.set(card.pupilId, list);
    }

    const incidentsByPupil = new Map<number, typeof incidents>();
    for (const incident of incidents) {
      const list = incidentsByPupil.get(incident.pupilId) ?? [];
      list.push(incident);
      incidentsByPupil.set(incident.pupilId, list);
    }

    const rows: StatusPupil[] = classPupils.map((pupil) => {
      const pupilCards = cardsByPupil.get(pupil.id) ?? [];
      const pupilIncidents = incidentsByPupil.get(pupil.id) ?? [];

      let green = 0;
      let yellow = 0;
      let red = 0;
      let timeout = 0;
      let cooldown = 0;
      for (const type of pupilCards) {
        if (type === 'green') green += 1;
        else if (type === 'yellow') yellow += 1;
        else if (type === 'red') red += 1;
        else if (type === 'cooldown') cooldown += 1;
      }
      for (const incident of pupilIncidents) {
        if (incident.kind === 'timeout') timeout += 1;
        else cooldown += 1;
      }

      const activeIncident =
        pupilIncidents.find((incident) => incident.status === 'active') ?? null;

      const stageResult = computePupilBehaviorStage(green, yellow, red, timeout);
      const rank = rankByPupil.get(pupil.id);
      const canRecord = schoolWide
        ? canActSchoolWide
        : accessByClass?.get(pupil.classId)?.canRecord === true && user.viewAs !== true;

      return {
        id: pupil.id,
        fullName: pupil.fullName,
        classId: pupil.classId,
        className: pupil.className,
        grade: pupil.grade,
        rank: rank === 'Lehrling' || rank === 'Geselle' || rank === 'Meister' ? rank : null,
        stage: {
          level: stageResult.currentStage,
          title: stageResult.stageInfo.title,
          type: stageResult.stageInfo.type,
          behaviorGrade: stageResult.behaviorGrade,
        },
        counts: { green, yellow, red, timeout, cooldown },
        activeIncident: activeIncident
          ? {
              id: activeIncident.id,
              kind: activeIncident.kind === 'cooldown' ? 'cooldown' : 'timeout',
              sentAt: activeIncident.sentAt,
              taskAssignment: activeIncident.taskAssignment,
            }
          : null,
        canRecord,
      };
    });

    return reply.send({ schoolWide, classes: visibleClasses, pupils: rows });
  });
};
