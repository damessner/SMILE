import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { config } from '../config.js';

/**
 * Content-Security-Policy for the app shell.
 *
 * The client bundle is self-hosted and loads no third-party script, so the policy can
 * be strict. `'unsafe-inline'` for styles is required because Tailwind v4 and the
 * print stylesheet emit inline styles at runtime.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  // The PDF preview in KelPdfModal renders a blob: URL in an iframe.
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss:",
  "frame-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/** Methods that can change state and therefore need an Origin check. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isAllowedOrigin(
  origin: string | undefined,
  request: FastifyRequest,
  allowedOrigins: readonly string[] = config.corsAllowedOrigins,
): boolean {
  // Browsers attach Origin to state-changing requests and WebSocket handshakes. Keep
  // non-browser bearer clients that omit it usable; cookie sessions remain protected
  // by SameSite=Strict as well as this check when Origin is present.
  if (!origin) return true;

  const normalizedOrigin = origin.replace(/\/$/, '');
  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(normalizedOrigin);
  } catch {
    return false;
  }

  if (parsedOrigin.origin !== normalizedOrigin.toLowerCase()) return false;

  const forwardedHost = request.headers['x-forwarded-host'];
  const forwardedHostValue = typeof forwardedHost === 'string' ? forwardedHost : null;
  // Resolve host: only trust X-Forwarded-Host if TRUST_PROXY is explicitly enabled.
  const host =
    (config.trustProxy ? forwardedHostValue : null) ||
    request.headers.host;

  const requestProtocol = request.protocol.endsWith(':')
    ? request.protocol.toLowerCase()
    : `${request.protocol.toLowerCase()}:`;

  if (config.cookieSecure && parsedOrigin.protocol !== 'https:') return false;

  const isSameOrigin = Boolean(
    host &&
      parsedOrigin.host.toLowerCase() === host.toLowerCase() &&
      parsedOrigin.protocol === requestProtocol,
  );
  if (isSameOrigin) return true;

  // An explicit allowlist adds deliberate split-origin clients; it never replaces
  // the server's own origin check.
  return allowedOrigins.some((allowed) => allowed.toLowerCase() === parsedOrigin.origin);
}

/**
 * Wrapped in `fastify-plugin` deliberately.
 *
 * A plugin registered with `fastify.register` is encapsulated: its hooks only apply to
 * routes declared inside it. These headers and the CSRF Origin check must apply to
 * every route in the app, so the encapsulation boundary has to be broken.
 */
export const securityPlugin = fp(async (fastify) => {
  if (config.trustProxy) {
    fastify.log.warn(
      'TRUST_PROXY is enabled: only do this when a reverse proxy you control sets X-Forwarded-*.',
    );
  }

  fastify.addHook('onSend', async (request: FastifyRequest, reply: FastifyReply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
    // This app holds pupil data; keep it out of intermediary caches entirely.
    reply.header('Cache-Control', 'no-store');
    reply.header('Content-Security-Policy', CSP);
    if (config.cookieSecure) {
      reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    return payload;
  });

  /**
   * CSRF defence for the cookie-based session.
   *
   * The session now lives in an httpOnly SameSite=Strict cookie, so a cross-site form
   * post cannot carry it. This hook adds the second layer: reject any state-changing
   * request whose Origin is not allowed, and reject cross-origin WebSocket upgrades.
   */
  fastify.addHook('onRequest', async (request, reply) => {
    const isWsUpgrade =
      request.url.startsWith('/ws') &&
      (request.headers.upgrade?.toLowerCase() === 'websocket' ||
        request.headers.connection?.toLowerCase().includes('upgrade'));

    if (SAFE_METHODS.has(request.method) && !isWsUpgrade) return;

    if (!isAllowedOrigin(request.headers.origin, request)) {
      const safePath = request.routeOptions.url ?? request.url.split('?', 1)[0];
      request.log.warn(
        { url: safePath, method: request.method },
        'Blocked cross-origin request',
      );
      return reply.status(403).send({ error: 'Cross-Origin-Anfrage abgelehnt.' });
    }
  });

  fastify.log.info(
    config.corsAllowedOrigins.length === 0
      ? 'CORS: same-origin only'
      : `CORS allowlist: ${config.corsAllowedOrigins.join(', ')}`,
  );
});
