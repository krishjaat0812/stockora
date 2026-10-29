import type { Context } from 'hono';

/** JSON response with an unguarded Headers instance so Set-Cookie works. */
export function respond(
  data: unknown,
  options: { status?: number; headers?: Record<string, string> } = {},
): Response {
  const headers = new Headers(options.headers ?? {});
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(data), {
    status: options.status ?? 200,
    headers,
  });
}

export function clientIp(c: Context): string {
  return (
    c.req.header('CF-Connecting-IP') ??
    c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ??
    c.req.header('X-Real-IP') ??
    'unknown'
  );
}

/** Parses a JSON body, returning null (and a 400 response) when malformed. */
export async function readJson<T>(c: Context): Promise<{ body: T } | { error: Response }> {
  try {
    const body = (await c.req.json()) as T;
    if (body === null || typeof body !== 'object') {
      return { error: respond({ code: 'invalid_body', message: 'Request body must be a JSON object.' }, { status: 400 }) };
    }
    return { body };
  } catch {
    return { error: respond({ code: 'invalid_body', message: 'Request body must be valid JSON.' }, { status: 400 }) };
  }
}

export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

/** Allowed browser origin for CSRF checks, derived from configuration. */
export function allowedOrigins(env: { APP_ORIGINS?: string }): string[] {
  return (env.APP_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}
