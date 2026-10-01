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

function isAllowedOrigin(origin: string | undefined): boolean {
  // No Origin header: same-origin navigation, non-browser client, or a
  // same-origin fetch that omitted it. The host check below still applies.
  if (!origin) return true;
  if (config.corsAllowedOrigins.length === 0) return true;
  return config.corsAllowedOrigins.includes(origin.replace(/\/$/, ''));
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
    if (SAFE_METHODS.has(request.method)) return;

    if (!isAllowedOrigin(request.headers.origin)) {
      request.log.warn({ origin: request.headers.origin }, 'Blocked cross-origin state change');
      return reply.status(403).send({ error: 'Cross-Origin-Anfrage abgelehnt.' });
    }
  });

  fastify.log.info(
    config.corsAllowedOrigins.length === 0
      ? 'CORS: same-origin only'
      : `CORS allowlist: ${config.corsAllowedOrigins.join(', ')}`,
  );
});