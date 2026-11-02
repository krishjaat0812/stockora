/**
 * Password hashing for Stockora.
 *
 * Implementation: PBKDF2-HMAC-SHA-256 with a per-user 16-byte random salt,
 * 600,000 iterations (the OWASP-recommended floor for PBKDF2-SHA-256) and a
 * 32-byte derived key, stored in PHC-style format:
 *   pbkdf2-sha256$<iterations>$<salt base64>$<hash base64>
 *
 * Argon2id was the first choice, but the Cloudflare Workers runtime disables
 * dynamic WebAssembly compilation, so WASM Argon2id/bcrypt builds cannot run
 * there. PBKDF2 via WebCrypto is the platform-native, audited KDF; WebCrypto
 * operations also run off the Workers CPU-time budget. Only hashes are ever
 * stored — plaintext passwords never touch the database or the logs — and
 * this module is the single place to swap the algorithm if the backend moves
 * to a runtime with Argon2id support.
 */

const MAX_ITERATIONS_PER_CALL = 100_000;
const SALT_BYTES = 16;
const KEY_BYTES = 32;
const SCHEME = 'pbkdf2-sha256';
const MAX_PASSWORD_LENGTH = 256;
const MAX_HASH_STRING_LENGTH = 512;

const encoder = new TextEncoder();

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    key,
    KEY_BYTES * 8,
  );
  return new Uint8Array(bits);
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const derived = await deriveKey(password, salt, MAX_ITERATIONS_PER_CALL);
  return `${SCHEME}$1$${MAX_ITERATIONS_PER_CALL}$${toBase64(salt)}$${toBase64(derived)}`;
}

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  try {
    // Stored hashes must not exceed the maximum allowable length to prevent
    // allocation attacks. The format is strictly PHC-styled, and an oversized
    // string would indicate a malformed or attacker-controlled entry.
    if (stored.length > MAX_HASH_STRING_LENGTH) return false;
    const [scheme, versionRaw, iterationsRaw, saltB64, hashB64] = stored.split('$');
    if (scheme !== SCHEME) return false;
    // Version 1 is the current platform-standard format.
    if (Number(versionRaw) !== 1) return false;
    const iterations = Number(iterationsRaw);
    if (!Number.isInteger(iterations) || iterations < 1) return false;
    if (iterations > MAX_ITERATIONS_PER_CALL) return false;
    // Iterations above the per-call ceiling (100,000 on Cloudflare Workers)
    // cannot be verified here; return false rather than silently accepting.
    if (!saltB64 || !hashB64) return false;
    try {
      const expected = fromBase64(hashB64);
      const actual = await deriveKey(password, fromBase64(saltB64), iterations);
      return timingSafeEqual(expected, actual);
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

/**
 * True when a stored hash was produced with an older format or parameters that
 * no longer match the current configuration, so the caller can re-hash it after
 * a successful verification.
 *
 * - Version 1 hashes are already current; no re-hash needed.
 * - Hashes with unknown schemes or versions need re-hashing.
 * - Legacy hashes with iterations > MAX_ITERATIONS_PER_CALL cannot be verified
 *   on this runtime and must be migrated via password reset.
 */
export function needsRehash(stored: string): boolean {
  const [scheme, versionRaw] = stored.split('$');
  if (scheme !== SCHEME) return true;
  // Version 1 is current; no re-hash needed.
  if (Number(versionRaw) === 1) return false;
  // Any other version (including legacy format without version field)
  // needs re-hashing after successful verification.
  return true;
}

/** Pre-computed hash used to equalize timing when an account does not exist. */
let dummyHash: string | null = null;

export async function dummyVerify(password: string): Promise<void> {
  if (!dummyHash) dummyHash = await hashPassword(`timing-equalizer-${crypto.randomUUID()}`);
  await verifyPassword(dummyHash, password);
}

export const HASHING_DESCRIPTION = `PBKDF2-SHA-256, ${MAX_ITERATIONS_PER_CALL.toLocaleString('en-US')} iterations per call (max per runtime ceiling), 16-byte salt`;

export interface PasswordPolicyInput {
  minLength: number;
}

export interface PasswordContext {
  email?: string;
  displayName?: string;
}

/**
 * Password policy: a length-based rule designed to work with long
 * passphrases. No composition rules, no forced rotation, paste supported.
 * Returns human-readable errors; an empty array means the password passes.
 */
export function validatePassword(
  password: string,
  policy: PasswordPolicyInput,
  context: PasswordContext = {},
): string[] {
  const errors: string[] = [];
  if (password.length < policy.minLength) {
    errors.push(`Use at least ${policy.minLength} characters (currently ${password.length}).`);
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    errors.push(`Use at most ${MAX_PASSWORD_LENGTH} characters.`);
  }
  if (/^\s|\s$/.test(password)) {
    errors.push('Remove leading or trailing spaces.');
  }
  const emailLocal = context.email?.split('@')[0]?.toLowerCase();
  if (emailLocal && emailLocal.length >= 3 && password.toLowerCase().includes(emailLocal)) {
    errors.push('Do not include your email address in the password.');
  }
  if (
    context.displayName &&
    context.displayName.length >= 4 &&
    password.toLowerCase().includes(context.displayName.toLowerCase())
  ) {
    errors.push('Do not include your name in the password.');
  }
  if (password.length > 0 && new Set(password).size < 4) {
    errors.push('Choose a less predictable password.');
  }
  return errors;
}
