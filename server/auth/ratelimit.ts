import { getSecurityPolicy } from '../db';
import type { Env } from '../env';

/**
 * Login rate limiting backed by D1: attempts are counted per email+IP pair
 * inside a sliding window; exceeding the limit locks the pair out with a
 * generic 429. Failed attempts are also recorded for the audit log.
 */

function randomHex(bytes: number): string {
  const buffer = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(buffer, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function newToken(bytes = 32): string {
  return randomHex(bytes);
}

export interface RateLimitVerdict {
  allowed: boolean;
  retryAfterSeconds: number;
}

export async function checkLoginRateLimit(
  env: Env,
  email: string,
  ip: string,
): Promise<RateLimitVerdict> {
  const policy = await getSecurityPolicy(env);
  const windowMs = policy.login_window_minutes * 60_000;
  const since = new Date(Date.now() - windowMs).toISOString();
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS attempts FROM login_attempts WHERE email = ? AND ip = ? AND at > ?',
  )
    .bind(email, ip, since)
    .first<{ attempts: number }>();
  const attempts = row?.attempts ?? 0;
  if (attempts >= policy.login_max_attempts) {
    const oldest = await env.DB.prepare(
      'SELECT MIN(at) AS oldest FROM login_attempts WHERE email = ? AND ip = ? AND at > ?',
    )
      .bind(email, ip, since)
      .first<{ oldest: string }>();
    const oldestMs = oldest?.oldest ? new Date(oldest.oldest).getTime() : Date.now();
    const retryAfter = Math.max(1, Math.ceil((oldestMs + windowMs - Date.now()) / 1000));
    return { allowed: false, retryAfterSeconds: retryAfter };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

export async function recordLoginAttempt(env: Env, email: string, ip: string): Promise<void> {
  await env.DB.prepare('INSERT INTO login_attempts (email, ip, at) VALUES (?, ?, ?)')
    .bind(email, ip, new Date().toISOString())
    .run();
}

export async function clearLoginAttempts(env: Env, email: string, ip: string): Promise<void> {
  await env.DB.prepare('DELETE FROM login_attempts WHERE email = ? AND ip = ?')
    .bind(email, ip)
    .run();
}

/** Housekeeping: drop attempt records far outside any active window. */
export async function pruneLoginAttempts(env: Env): Promise<void> {
  const since = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  await env.DB.prepare('DELETE FROM login_attempts WHERE at < ?').bind(since).run();
}
