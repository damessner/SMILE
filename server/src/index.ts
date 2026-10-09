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

import { assertServerConfig, config, ConfigError, jwtSecret } from './config.js';
import { buildAuthenticate, buildRequireRole, buildSessionGuard, getTeacher } from './lib/guards.js';
import { rateLimitKey } from './lib/rate-limit.js';
import { safeErrorLogFields } from './lib/log-safety.js';
import { securityPlugin } from './plugins/security.js';
import { runMigrations, closePool } from './db/index.js';

import { authRoutes } from './routes/auth.js';
import { classRoutes } from './routes/classes.js';
import { pupilRoutes } from './routes/pupils.js';
import { cardRoutes } from './routes/cards.js';
import { evaluationRoutes } from './routes/evaluations.js';
import { conferenceRoutes } from './routes/conferences.js';
import { backupRoutes } from './routes/backup.js';
import { statisticsRoutes } from './routes/statistics.js';
import { timetableRoutes } from './routes/timetable.js';
import { timeoutRoutes } from './routes/timeouts.js';
import { registerTimeoutSweeper } from './lib/timeout-sweeper.js';
import {
  closeAllWebSockets,
  handleWebSocketConnection,
  startWebSocketHeartbeat,
  stopWebSocketHeartbeat,
} from './ws/live-sync.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export { safeErrorLogFields } from './lib/log-safety.js';

export async function buildServer(
  sessionStateReader?: (userId: string) => Promise<{ sessionVersion: number; mustChangePassword: boolean } | null>,
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
  await fastify.register(pupilRoutes, { prefix: '/api/pupils' });
  await fastify.register(cardRoutes, { prefix: '/api/cards' });
  await fastify.register(evaluationRoutes, { prefix: '/api/evaluations' });
  await fastify.register(conferenceRoutes, { prefix: '/api/conferences' });
  await fastify.register(statisticsRoutes, { prefix: '/api/statistics' });
  await fastify.register(timetableRoutes, { prefix: '/api/timetable' });
  await fastify.register(timeoutRoutes, { prefix: '/api/timeouts' });
  await fastify.register(backupRoutes, { prefix: '/api/backup' });

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

  // Apply pending schema migrations before accepting traffic, so the app never
  // serves requests against a schema it does not expect.
  if (process.env.RUN_MIGRATIONS !== 'false') {
    try {
      await runMigrations();
      fastify.log.info('Database migrations up to date');
    } catch (err) {
      fastify.log.error(safeErrorLogFields(err), 'Database migration failed');
      process.exit(1);
    }
  }

  const heartbeat = startWebSocketHeartbeat();

  const shutdown = async (signal: string) => {
    fastify.log.info(`${signal} received, shutting down`);
    stopWebSocketHeartbeat(heartbeat);
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
