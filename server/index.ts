import { Hono } from 'hono';
import { ensureReady } from './db';
import type { Env } from './env';
import { allowedOrigins, respond } from './http';
import { buildAdminRoutes } from './routes/admin';
import { buildAuthRoutes } from './routes/auth';
import { buildPosRoutes } from './routes/pos';
import { buildStateRoutes } from './routes/state';

/**
 * Stockora backend: a Cloudflare Worker (Hono + D1) serving the API and the
 * built SPA. All authorization happens here, on the server — the browser is
 * never trusted for roles, features or organisation scope.
 */

const app = new Hono<{ Bindings: Env }>();

// Idempotent schema + first-run bootstrap (platform admin, demo client).
app.use('*', async (c, next) => {
  await ensureReady(c.env);
  await next();
});

// CSRF protection for state-changing requests: browsers always send Origin
// on cross-site and same-origin mutations; anything else is rejected. Session
// cookies are additionally SameSite=Lax + HttpOnly.
const MUTATING = ['POST', 'PUT', 'PATCH', 'DELETE'];
app.use('*', async (c, next) => {
  if (MUTATING.includes(c.req.method)) {
    const origin = c.req.header('Origin')?.replace(/\/$/, '');
    // A same-origin request is always legitimate: browsers cannot forge the
    // Origin header, and the Worker is served on the deployment's own host, so
    // a fresh deployment works without extra configuration. APP_ORIGINS still
    // allows explicitly configured additional origins (for example a custom
    // domain in front of the Worker).
    const requestOrigin = new URL(c.req.url).origin;
    if (origin && origin !== requestOrigin && !allowedOrigins(c.env).includes(origin)) {
      return respond(
        { code: 'origin_denied', message: 'Request origin not allowed.' },
        { status: 403 },
      );
    }
  }
  await next();
});

app.route('/api/auth', buildAuthRoutes());
app.route('/api/admin', buildAdminRoutes());
app.route('/api/pos', buildPosRoutes());
app.route('/api/state', buildStateRoutes());

app.notFound(async (c) => {
  if (c.req.path.startsWith('/api/')) {
    return respond({ code: 'not_found', message: 'Unknown API route.' }, { status: 404 });
  }
  if (c.env.ASSETS) return c.env.ASSETS.fetch(c.req.raw);
  return new Response('Run "npm run build" to produce the SPA bundle in dist/.', { status: 404 });
});

app.onError((error, c) => {
  console.error('unhandled error', c.req.method, c.req.path, error);
  return respond(
    { code: 'server_error', message: 'Something went wrong on the server. Try again.' },
    { status: 500 },
  );
});

export default app;
