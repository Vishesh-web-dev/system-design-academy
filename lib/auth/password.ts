// Pure standard-library crypto — no secrets, environment-agnostic — so it is
// usable from the seed script as well as server actions (hence no `server-only`).
import { scrypt, randomBytes, timingSafeEqual, type BinaryLike, type ScryptOptions } from 'node:crypto';

/**
 * Password hashing with the Node standard library — no third-party dependency.
 * scrypt is a memory-hard KDF suitable for password storage. The stored string
 * is self-describing: `scrypt$N$r$p$saltHex$hashHex`, so the parameters travel
 * with the hash and can be raised later without invalidating old rows.
 */

// Hand-rolled promise wrapper: promisify(scrypt) drops the options overload.
const scryptAsync = (password: BinaryLike, salt: BinaryLike, keylen: number, options: ScryptOptions): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, derivedKey) => (err ? reject(err) : resolve(derivedKey)));
  });

// Cost parameters. N=16384 keeps a hash well under ~100ms on a server core.
const N = 16_384;
const r = 8;
const p = 1;
const KEYLEN = 64;
const SALT_BYTES = 16;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = (await scryptAsync(password.normalize('NFKC'), salt, KEYLEN, { N, r, p, maxmem: 64 * 1024 * 1024 })) as Buffer;
  return `scrypt$${N}$${r}$${p}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nStr, rStr, pStr, saltHex, hashHex] = parts;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  try {
    const derived = (await scryptAsync(password.normalize('NFKC'), salt, expected.length, {
      N: Number(nStr),
      r: Number(rStr),
      p: Number(pStr),
      maxmem: 64 * 1024 * 1024,
    })) as Buffer;
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}
