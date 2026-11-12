import Fastify, { type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import path from 'path';
import fs from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';

import { assertServerConfig, config, ConfigError, insecureConfigWarnings, jwtSecret, productionCookieError, webuntisConfigWarnings } from './config.js';
import { buildAuthenticate, buildRequireAccountAdministrator, buildRequireRole, buildSessionGuard, getTeacher } from './lib/guards.js';
import type { PersistedUserSessionState } from './lib/session.js';
import { rateLimitKey } from './lib/rate-limit.js';
import { safeErrorLogFields } from './lib/log-safety.js';
import { securityPlugin } from './plugins/security.js';
import { runMigrations, closePool } from './db/index.js';

import { authRoutes } from './routes/auth.js';
import { classRoutes } from './routes/classes.js';
import { behaviorRoutes } from './routes/behavior.js';
import { pupilRoutes } from './routes/pupils.js';
import { cardRoutes } from './routes/cards.js';
import { evaluationRoutes } from './routes/evaluations.js';
import { conferenceRoutes } from './routes/conferences.js';
import { backupRoutes } from './routes/backup.js';
import { webuntisRoutes } from './routes/webuntis.js';
import { statisticsRoutes } from './routes/statistics.js';
import { timetableRoutes } from './routes/timetable.js';
import { timeoutRoutes } from './routes/timeouts.js';
import { notificationRoutes } from './routes/notifications.js';
import { registerTimeoutSweeper } from './lib/timeout-sweeper.js';
import { registerWebUntisOutboxWorker } from './lib/webuntis/outbox.js';
import { startWeeklyDigestScheduler } from './lib/notification-digest.js';
import { bellScheduleTimezoneWarning } from './lib/period-times.js';
import {
  closeAllWebSockets,
  handleWebSocketConnection,
  startWebSocketHeartbeat,
  stopWebSocketHeartbeat,
} from './ws/live-sync.js';
import { isRestoreInProgress } from './lib/restore-lock.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export { safeErrorLogFields } from './lib/log-safety.js';

export async function buildServer(
  sessionStateReader?: (userId: string) => Promise<PersistedUserSessionState | null>,
) {
  // Fail fast on a misconfigured or compromised environment rather than silently
  // falling back to the hardcoded secrets that used to live in this file.
  assertServerConfig();

  const fastify = Fastify({
    logger: {
      // 'silent' under test keeps vitest output readable; pino levels above still apply.
      level: config.env === 'test' ? 'silent' : config.env === 'production' ? 'info' : 'debug',
      // Credentials must never reach the log stream.
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'res.headers["set-cookie"]',
          'req.body.password',
          'req.body.currentPassword',
          'req.body.newPassword',
        ],
        remove: true,
      },
    },
    bodyLimit: config.bodyLimitBytes,
    trustProxy: config.trustProxy,
    // Request schemas are a security boundary: don't silently coerce values or
    // strip unknown fields and then execute a write with a different payload.
    ajv: {
      customOptions: {
        coerceTypes: false,
        removeAdditional: false,
        useDefaults: false,
      },
    },
  });

  // --- Security headers, CSP and CSRF Origin check -------------------------
  await fastify.register(securityPlugin);

  await fastify.register(cors, {
    // Explicit allowlist. The previous `origin: true` reflected any Origin back
    // together with credentials, which let any website script the API.
    origin: config.corsAllowedOrigins.length === 0 ? false : config.corsAllowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
  });

  await fastify.register(fastifyCookie, { secret: jwtSecret() });

  await fastify.register(fastifyJwt, {
    secret: jwtSecret(),
    cookie: {
      cookieName: 'smile_session',
      signed: false,
    },
    // Restrict to a single algorithm. fast-jwt <6 accepted alg confusion.
    sign: { algorithm: 'HS256' },
    verify: { allowedIss: undefined, algorithms: ['HS256'] },
  });

  // Coarse ceiling for all endpoints; /login adds its own stricter limit.
  await fastify.register(rateLimit, {
    global: true,
    max: config.globalRateLimit.max,
    timeWindow: `${config.globalRateLimit.windowSeconds}s`,
    hook: 'preHandler',
    // Authenticated users are limited per account rather than per IP, otherwise a
    // whole school behind one NAT address shares a single bucket.
    keyGenerator: (request) => rateLimitKey(request.authUser, request.ip),
    allowList: (request) => request.url === '/health',
  });

  // JWT verification establishes identity in preValidation. Validate the durable
  // account/session version in preHandler, after schema validation but before any
  // protected handler or database write.
  fastify.addHook('preHandler', buildSessionGuard(sessionStateReader));

  // While a restore replaces the database, refuse writes and new live-sync sockets.
  // The restore route is exempt so a concurrent restore still gets its own 409.
  fastify.addHook('onRequest', async (request, reply) => {
    if (!isRestoreInProgress()) return;
    const isWrite = request.method !== 'GET' && request.method !== 'HEAD';
    const isRestoreRoute = request.method === 'POST' && request.url.split('?', 1)[0] === '/api/backup/restore';
    if (isRestoreRoute || (!isWrite && !request.url.startsWith('/ws'))) return;
    return reply.status(503).send({
      error: 'Wiederherstellung läuft. Bitte später erneut versuchen.',
      code: 'RESTORE_IN_PROGRESS',
    });
  });

  fastify.setErrorHandler((error: FastifyError, request, reply) => {
    const correlationId = request.id || 'req-unknown';
    // Log the registered route pattern where possible; never copy query strings
    // (which can contain bearer tokens or reset codes) into server logs.
    const safePath = request.routeOptions.url ?? request.url.split('?', 1)[0];

    request.log.error(
      {
        ...safeErrorLogFields(error),
        correlationId,
        url: safePath,
        method: request.method,
      },
      'Request error occurred',
    );

    if (error.validation) {
      return reply.status(400).send({
        error: 'Ungültige Eingabedaten.',
        code: 'VALIDATION_ERROR',
        correlationId,
      });
    }

    const statusCode = error.statusCode && error.statusCode >= 400 && error.statusCode < 500
      ? error.statusCode
      : 500;

    if (statusCode < 500) {
      return reply.status(statusCode).send({
        error: 'Anfrage konnte nicht verarbeitet werden.',
        code: statusCode === 429
          ? 'RATE_LIMITED'
          : statusCode === 413
            ? 'PAYLOAD_TOO_LARGE'
            : statusCode === 404
              ? 'NOT_FOUND'
              : statusCode === 401
                ? 'UNAUTHORIZED'
                : statusCode === 403
                  ? 'FORBIDDEN'
                  : 'BAD_REQUEST',
        correlationId,
      });
    }

    return reply.status(500).send({
      error: 'Ein interner Serverfehler ist aufgetreten. Bitte versuchen Sie es später erneut.',
      code: 'INTERNAL_SERVER_ERROR',
      correlationId,
    });
  });

  // Expose the login limits to the route module without a second config read.
  fastify.decorate('rateLimitLoginMax', config.loginRateLimit.max);
  fastify.decorate('rateLimitLoginWindowSeconds', config.loginRateLimit.windowSeconds);

  const authenticate = buildAuthenticate((request) => request.jwtVerify());
  fastify.decorate('authenticate', authenticate);
  fastify.decorate('requireRole', buildRequireRole((request) => request.jwtVerify()));
  fastify.decorate('requireAccountAdministrator', buildRequireAccountAdministrator((request) => request.jwtVerify()));

  await fastify.register(websocket, {
    options: { maxPayload: 64 * 1024 },
  });

  /**
   * GET /health — liveness probe for systemd / monitoring. Unauthenticated but
   * deliberately reveals nothing beyond "the process is up".
   */
  fastify.get('/health', async () => ({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) }));

  /**
   * GET /ws — live sync.
   *
   * Authenticated in a preHandler so an unauthenticated handshake is rejected as a
   * plain 401 before the connection is upgraded. The previous implementation
   * upgraded unconditionally and trusted the identity supplied in the first message.
   */
  fastify.get('/ws', { websocket: true, preValidation: [fastify.authenticate] }, async (socket, request) => {
    const authUser = request.authUser;
    if (!authUser) {
      socket.close(1008, 'unauthenticated');
      return;
    }
    if (authUser.mustChangePassword) {
      socket.close(1008, 'password change required');
      return;
    }
    if (authUser.viewAs) {
      // Read-only "Ansehen als": no live-sync connection, so no presence or soft-lock traces.
      socket.close(1008, 'Ansicht ist schreibgeschützt (keine Live-Verbindung).');
      return;
    }

    // Display name for presence messages. Derived from the database, never echoed
    // back from whatever the client claimed.
    let teacherName = authUser.username;
    if (authUser.teacherId) {
      const teacher = await getTeacher(authUser.teacherId);
      if (teacher) teacherName = teacher.fullName;
    }

    handleWebSocketConnection(socket as never, authUser, teacherName);
  });

  // --- API routes ---------------------------------------------------------
  await fastify.register(authRoutes, { prefix: '/api/auth' });
  await fastify.register(classRoutes, { prefix: '/api/classes' });
  await fastify.register(behaviorRoutes, { prefix: '/api/behavior' });
  await fastify.register(pupilRoutes, { prefix: '/api/pupils' });
  await fastify.register(cardRoutes, { prefix: '/api/cards' });
  await fastify.register(evaluationRoutes, { prefix: '/api/evaluations' });
  await fastify.register(conferenceRoutes, { prefix: '/api/conferences' });
  await fastify.register(statisticsRoutes, { prefix: '/api/statistics' });
  await fastify.register(timetableRoutes, { prefix: '/api/timetable' });
  await fastify.register(timeoutRoutes, { prefix: '/api/timeouts' });
  await fastify.register(notificationRoutes, { prefix: '/api/notifications' });
  await fastify.register(backupRoutes, { prefix: '/api/backup' });
  await fastify.register(webuntisRoutes, { prefix: '/api/webuntis' });

  // --- Static client ------------------------------------------------------
  const clientDistPath = path.resolve(__dirname, '../../client/dist');
  if (!fs.existsSync(path.join(clientDistPath, 'index.html'))) {
    fastify.log.error(
      `Client bundle not found at ${clientDistPath}. Run "npm run build" in client/ before starting the server.`,
    );
  } else {
    await fastify.register(fastifyStatic, {
      root: clientDistPath,
      prefix: '/',
      index: ['index.html'],
      // @fastify/static <=10.1.1 had path-traversal / route-guard bypass issues.
      serve: true,
      cacheControl: false,
    });

    fastify.setNotFoundHandler((request, reply) => {
      const url = request.raw.url ?? '';
      if (!url.startsWith('/api') && !url.startsWith('/ws')) {
        reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');
        return reply.sendFile('index.html');
      }
      return reply.status(404).send({ error: 'Endpoint not found' });
    });
  }

  // Release expired timeouts at the bell.
  if (config.env !== 'test') {
    registerTimeoutSweeper(fastify);
  }

  return fastify;
}

export async function start() {
  let fastify;
  try {
    fastify = await buildServer();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`\n[config] ${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }

  const tzWarning = bellScheduleTimezoneWarning();
  if (tzWarning) fastify.log.warn(tzWarning);

  // Known-accepted deployment states (for example plain-HTTP LAN serving) are
  // surfaced here rather than silently absorbed.
  for (const warning of insecureConfigWarnings()) fastify.log.warn(warning);
  for (const warning of webuntisConfigWarnings()) fastify.log.warn(warning);
  const cookieError = productionCookieError();
  if (cookieError) fastify.log.error(cookieError);

  // Apply pending schema migrations before accepting traffic, so the app never
  // serves requests against a schema it does not expect.
  if (config.runMigrations) {
    try {
      await runMigrations();
      fastify.log.info('Database migrations up to date');

      // Auto-populate pupil subject teachers if table is empty and mapping file exists
      const mappingFile = path.resolve(__dirname, '../../pupil_group_mappings.json');
      if (fs.existsSync(mappingFile)) {
        try {
          const { getPool } = await import('./db/index.js');
          const countRes = await getPool().query<{ count: number }>(
            'SELECT count(*)::int as count FROM pupil_subject_teachers',
          );
          if (countRes.rows[0]?.count === 0) {
            fastify.log.info('Seeding initial pupil_subject_teachers from pupil_group_mappings.json...');
            const { importPupilGroups } = await import('./db/import-pupil-groups.js');
            await importPupilGroups(mappingFile);
            fastify.log.info('Pupil subject teachers successfully seeded');
          }
        } catch (err) {
          fastify.log.warn(safeErrorLogFields(err), 'Auto-seeding pupil_subject_teachers failed');
        }
      }
    } catch (err) {
      fastify.log.error(safeErrorLogFields(err), 'Database migration failed');
      process.exit(1);
    }
  }

  const heartbeat = startWebSocketHeartbeat();
  const digestTimer = startWeeklyDigestScheduler(fastify.log);

  // Upgrade credentials encrypted with the legacy JWT-derived key. This runs
  // after migrations and before the first request, so a JWT_SECRET rotation
  // cannot strand stored WebUntis passwords.
  if (config.webuntis.credentialKey) {
    try {
      const { reencryptLegacySecrets } = await import('./lib/webuntis/vault.js');
      const result = await reencryptLegacySecrets((message) => fastify.log.warn(message));
      if (result.reencrypted > 0) {
        fastify.log.info(
          `Re-encrypted ${result.reencrypted} legacy WebUntis credential(s) with WEBUNTIS_CREDENTIAL_KEY`,
        );
      }
      if (result.failed > 0) {
        fastify.log.warn(`${result.failed} WebUntis credential(s) could not be re-encrypted`);
      }
    } catch (err) {
      fastify.log.warn(safeErrorLogFields(err), 'WebUntis credential re-encryption failed');
    }
  }

  const stopWebUntisOutbox = registerWebUntisOutboxWorker({
    onError: (err) => fastify.log.warn(safeErrorLogFields(err), 'WebUntis outbox pass failed'),
  });

  const shutdown = async (signal: string) => {
    fastify.log.info(`${signal} received, shutting down`);
    stopWebUntisOutbox();
    stopWebSocketHeartbeat(heartbeat);
    clearInterval(digestTimer);
    closeAllWebSockets();
    try {
      await fastify.close();
      await closePool();
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  try {
    await fastify.listen({ port: config.port, host: config.host });
    fastify.log.info(`SMILE server listening on http://${config.host}:${config.port}`);
    fastify.log.info(`WebSocket live sync at ws://${config.host}:${config.port}/ws`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

// Only boot when executed directly. Guarded so tests can import buildServer without
// starting a listener.
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  void start();
}
