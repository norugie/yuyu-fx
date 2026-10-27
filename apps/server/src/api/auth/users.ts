import { eq } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { users } from "../../db/schema.js";
import { hashPassword, normalizeUsername } from "./credentials.js";

export class UserExistsError extends Error {
  override name = "UserExistsError";
}

/**
 * Store a user with an Argon2id hash of their password (the password itself is never stored).
 * Callers validate the credentials first (see validateNewCredentials).
 */
export async function createUser(
  db: Database,
  rawUsername: string,
  password: string,
): Promise<{ id: string; username: string }> {
  const username = normalizeUsername(rawUsername);
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, username))
    .limit(1);
  if (existing) throw new UserExistsError(`User "${username}" already exists.`);

  const passwordHash = await hashPassword(password);
  const [created] = await db
    .insert(users)
    .values({ username, passwordHash })
    .returning({ id: users.id, username: users.username });
  if (!created) throw new Error("Insert returned no row");
  return created;
}
