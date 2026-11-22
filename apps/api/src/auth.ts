import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import type { RequestHandler } from "express";
import type { PoolClient } from "pg";
import { database } from "./services";

const sessionLifetimeMs = 30 * 24 * 60 * 60 * 1000;
const passwordKeyLength = 64;

interface AccountCredentials {
  email: string;
  password: string;
}

interface AccountRow {
  id: string;
  email: string;
  password_salt: string;
  password_hash: string;
}

interface SessionResponse {
  token: string;
  expiresAt: string;
  email: string;
}

function derivePasswordKey(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, passwordKeyLength, (error, derivedKey) => {
      if (error) {
        reject(error);
      } else {
        resolve(derivedKey);
      }
    });
  });
}

function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function insertSession(
  client: PoolClient,
  userId: string,
  email: string,
): Promise<SessionResponse> {
  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + sessionLifetimeMs);

  await client.query("DELETE FROM auth_sessions WHERE expires_at <= NOW()");
  await client.query(
    `INSERT INTO auth_sessions (token_hash, user_id, expires_at)
     VALUES ($1, $2, $3)`,
    [hashSessionToken(token), userId, expiresAt],
  );

  return { token, expiresAt: expiresAt.toISOString(), email };
}

export async function registerAccount(
  credentials: AccountCredentials,
): Promise<SessionResponse> {
  const userId = randomUUID();
  const salt = randomBytes(16).toString("hex");
  const passwordHash = (await derivePasswordKey(credentials.password, salt)).toString("hex");
  const client = await database.connect();

  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO app_users (id, email, password_salt, password_hash)
       VALUES ($1, $2, $3, $4)`,
      [userId, credentials.email, salt, passwordHash],
    );
    const session = await insertSession(client, userId, credentials.email);
    await client.query("COMMIT");
    return session;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Failed to roll back account registration:", rollbackError);
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function loginAccount(
  credentials: AccountCredentials,
): Promise<SessionResponse | null> {
  const result = await database.query<AccountRow>(
    `SELECT id, email, password_salt, password_hash
     FROM app_users
     WHERE email = $1`,
    [credentials.email],
  );
  const account = result.rows[0];
  const fallbackSalt = "00000000000000000000000000000000";
  const passwordKey = await derivePasswordKey(
    credentials.password,
    account?.password_salt ?? fallbackSalt,
  );
  const expectedKey = account
    ? Buffer.from(account.password_hash, "hex")
    : Buffer.alloc(passwordKeyLength);
  const passwordMatches =
    expectedKey.length === passwordKey.length && timingSafeEqual(expectedKey, passwordKey);

  if (!account || !passwordMatches) {
    return null;
  }

  const client = await database.connect();
  try {
    return await insertSession(client, account.id, account.email);
  } finally {
    client.release();
  }
}

export const requireAuthentication: RequestHandler = async (request, response, next) => {
  const authorization = request.header("authorization");
  const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]+)$/);
  if (!match) {
    response.status(401).json({ error: "Authentication required" });
    return;
  }

  const tokenHash = hashSessionToken(match[1]);
  try {
    const result = await database.query<{ user_id: string }>(
      `SELECT user_id
       FROM auth_sessions
       WHERE token_hash = $1 AND expires_at > NOW()`,
      [tokenHash],
    );
    const session = result.rows[0];
    if (!session) {
      response.status(401).json({ error: "Session is invalid or expired" });
      return;
    }

    response.locals.userId = session.user_id;
    response.locals.sessionTokenHash = tokenHash;
    next();
  } catch (error) {
    next(error);
  }
};

export function parseCredentials(value: unknown): AccountCredentials | null {
  if (
    typeof value !== "object" ||
    value === null ||
    !("email" in value) ||
    !("password" in value)
  ) {
    return null;
  }

  const { email, password } = value;
  if (typeof email !== "string" || typeof password !== "string") {
    return null;
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (
    normalizedEmail.length === 0 ||
    normalizedEmail.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) ||
    password.length < 8 ||
    password.length > 128
  ) {
    return null;
  }

  return { email: normalizedEmail, password };
}
