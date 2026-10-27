import { hash, verify, type Options } from "@node-rs/argon2";

// Password hashing with Argon2id, using OWASP's recommended minimum settings
// (19 MiB memory, 2 passes, 1 thread).
const ARGON2_OPTIONS: Options = {
  algorithm: 2, // Algorithm.Argon2id (a const enum, so we use its value)
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 256;

/** Usernames are case-insensitive: trimmed and lowercased everywhere. */
export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

/** Returns a problem description, or null if the new credentials are acceptable. */
export function validateNewCredentials(username: string, password: string): string | null {
  if (!USERNAME_PATTERN.test(username)) {
    return "Username must be 3-32 characters: lowercase letters, digits, dot, underscore or dash.";
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`;
  }
  return null;
}

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

/** True if the password matches. A malformed hash counts as "no match". */
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * For unknown usernames: do the same Argon2 work as a real check, so response
 * time doesn't reveal whether a username exists.
 */
export async function verifyAgainstDummy(password: string): Promise<void> {
  dummyHash ??= hashPassword("dummy password used only for timing");
  await verifyPassword(await dummyHash, password);
}
