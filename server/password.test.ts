import { describe, expect, it } from 'vitest';
import { dummyVerify, hashPassword, validatePassword, verifyPassword } from './auth/password';

describe('password hashing', () => {
  it('hashes with PBKDF2-SHA256 and never stores the plaintext', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(stored.startsWith('pbkdf2-sha256$600000$')).toBe(true);
    expect(stored).not.toContain('correct horse');
    expect(stored.split('$')[2]!.length).toBeGreaterThan(10); // salt present
  });

  it('verifies the correct password and rejects the wrong one', async () => {
    const stored = await hashPassword('a very long passphrase 123');
    expect(await verifyPassword(stored, 'a very long passphrase 123')).toBe(true);
    expect(await verifyPassword(stored, 'a very long passphrase 124')).toBe(false);
    expect(await verifyPassword(stored, '')).toBe(false);
  });

  it('uses a fresh salt per hash', async () => {
    const a = await hashPassword('same password twice over');
    const b = await hashPassword('same password twice over');
    expect(a).not.toBe(b);
    expect(await verifyPassword(a, 'same password twice over')).toBe(true);
    expect(await verifyPassword(b, 'same password twice over')).toBe(true);
  });

  it('rejects malformed or weakly configured stored hashes', async () => {
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
    expect(await verifyPassword('pbkdf2-sha256$10$c2FsdA$aGFzaA', 'x')).toBe(false);
    await expect(dummyVerify('anything')).resolves.toBeUndefined();
  });
});

describe('password policy', () => {
  const policy = { minLength: 12 };

  it('accepts a long passphrase', () => {
    expect(validatePassword('purple elephants dance slowly', policy)).toEqual([]);
  });

  it('rejects short passwords with a helpful message', () => {
    const errors = validatePassword('short1!', policy);
    expect(errors[0]).toContain('at least 12 characters');
  });

  it('rejects passwords containing the email or the name', () => {
    expect(validatePassword('anuj.kushwaha-secure-phrase', policy, { email: 'anuj.kushwaha@shop.com' })).toEqual(
      expect.arrayContaining([expect.stringContaining('email')]),
    );
    expect(validatePassword('FreshMart forever 2026', policy, { displayName: 'FreshMart' })).toEqual(
      expect.arrayContaining([expect.stringContaining('name')]),
    );
  });

  it('rejects leading/trailing whitespace and ultra-low variety', () => {
    expect(validatePassword(' padded passphrase ', policy)).toEqual(
      expect.arrayContaining([expect.stringContaining('spaces')]),
    );
    expect(validatePassword('aaaaaaaaaaaaaaaa', policy)).toEqual(
      expect.arrayContaining([expect.stringContaining('predictable')]),
    );
  });

  it('rejects passwords above the maximum length', () => {
    expect(validatePassword('a'.repeat(300), policy)).toEqual(
      expect.arrayContaining([expect.stringContaining('at most')]),
    );
  });
});
