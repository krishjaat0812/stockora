/// <reference types="@cloudflare/workers-types" />

export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
  /** Comma-separated list of allowed browser origins for state-changing requests. */
  APP_ORIGINS?: string;
  /** "true" when cookies may carry the Secure attribute (production). */
  COOKIE_SECURE?: string;
  /** "true" only in local development: expose issued reset/invite links in API responses. */
  DEV_LINKS?: string;
  SEED_ADMIN_EMAIL?: string;
  SEED_ADMIN_PASSWORD?: string;
  SEED_OWNER_EMAIL?: string;
  SEED_OWNER_PASSWORD?: string;
}
