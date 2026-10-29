import type { ActionPermissions, Permissions } from '../shared/features';

/** JSON API client for the Stockora Worker. Cookies carry the session. */

export type UserRole = 'super_admin' | 'admin' | 'owner';

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  capabilities: string[];
}

export interface SessionPayload {
  user: SessionUser;
  org: { id: string; name: string; planId: string | null } | null;
  permissions: Permissions;
  /** Per-feature action permissions, resolved server-side on every session. */
  actions: ActionPermissions;
  /** Whether the administrator's password policy currently allows self-service password change. */
  canChangePassword: boolean;
  landing: string;
}

export class ApiError extends Error {
  status: number;
  code: string;
  body: Record<string, unknown>;

  constructor(status: number, code: string, message: string, body: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

export const EVENTS = {
  unauthenticated: 'stockora:unauthenticated',
  suspended: 'stockora:suspended',
  featureDenied: 'stockora:feature-denied',
} as const;

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  headers.set('X-Stockora-Client', 'web');
  const response = await fetch(path, {
    ...init,
    headers,
    credentials: 'same-origin',
  });

  const text = await response.text();
  let body: Record<string, unknown> = {};
  if (text) {
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      body = {};
    }
  }

  if (!response.ok) {
    const message = typeof body.message === 'string' ? body.message : 'Request failed.';
    const code = typeof body.code === 'string' ? body.code : 'error';
    if (response.status === 401) {
      window.dispatchEvent(new CustomEvent(EVENTS.unauthenticated));
    } else if (response.status === 403 && code === 'account_suspended') {
      window.dispatchEvent(new CustomEvent(EVENTS.suspended));
    } else if (
      response.status === 403 &&
      (code === 'feature_disabled' || code === 'action_denied')
    ) {
      // A revoked permission must surface immediately: re-resolve the session
      // so the open page reflects what the server now allows.
      window.dispatchEvent(
        new CustomEvent(EVENTS.featureDenied, { detail: { feature: body.feature, action: body.action } }),
      );
    }
    throw new ApiError(response.status, code, message, body);
  }

  return body as T;
}

export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
}

export function apiPut<T>(path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) });
}

export function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) });
}

export function apiDelete<T>(path: string): Promise<T> {
  return apiFetch<T>(path, { method: 'DELETE' });
}
