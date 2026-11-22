import cors from "cors";
import express from "express";
import type { ErrorRequestHandler } from "express";
import {
  loginAccount,
  parseCredentials,
  registerAccount,
  requireAuthentication,
} from "./auth";
import { cache, database } from "./services";

export const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

interface Profile {
  weightClass: string;
  school: string;
  seasonRecord: string;
}

function parseProfile(value: unknown): Profile | null {
  if (
    typeof value !== "object" ||
    value === null ||
    !("weightClass" in value) ||
    !("school" in value) ||
    !("seasonRecord" in value)
  ) {
    return null;
  }

  const { weightClass, school, seasonRecord } = value;
  if (
    typeof weightClass !== "string" ||
    typeof school !== "string" ||
    typeof seasonRecord !== "string"
  ) {
    return null;
  }

  const profile = {
    weightClass: weightClass.trim(),
    school: school.trim(),
    seasonRecord: seasonRecord.trim(),
  };
  if (
    profile.weightClass.length === 0 ||
    profile.weightClass.length > 40 ||
    profile.school.length === 0 ||
    profile.school.length > 120 ||
    !/^\d{1,3}-\d{1,3}(?:-\d{1,3})?$/.test(profile.seasonRecord)
  ) {
    return null;
  }

  return profile;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505" &&
    "constraint" in error &&
    error.constraint === "app_users_email_key"
  );
}

app.post("/api/auth/register", async (request, response, next) => {
  const credentials = parseCredentials(request.body);
  if (!credentials) {
    response.status(400).json({
      error: "Enter a valid email and a password between 8 and 128 characters.",
    });
    return;
  }

  try {
    const session = await registerAccount(credentials);
    response.status(201).json(session);
  } catch (error) {
    if (isUniqueViolation(error)) {
      response.status(409).json({ error: "An account with that email already exists." });
      return;
    }
    next(error);
  }
});

app.post("/api/auth/login", async (request, response, next) => {
  const credentials = parseCredentials(request.body);
  if (!credentials) {
    response.status(400).json({
      error: "Enter a valid email and a password between 8 and 128 characters.",
    });
    return;
  }

  try {
    const session = await loginAccount(credentials);
    if (!session) {
      response.status(401).json({ error: "Email or password is incorrect." });
      return;
    }
    response.json(session);
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/logout", requireAuthentication, async (_request, response, next) => {
  try {
    const tokenHash: string = response.locals.sessionTokenHash;
    await database.query("DELETE FROM auth_sessions WHERE token_hash = $1", [tokenHash]);
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.get("/api/profile", requireAuthentication, async (_request, response, next) => {
  try {
    const userId: string = response.locals.userId;
    const result = await database.query<Profile>(
      `SELECT
         weight_class AS "weightClass",
         school,
         season_record AS "seasonRecord"
       FROM wrestler_profiles
       WHERE user_id = $1`,
      [userId],
    );
    response.json({ profile: result.rows[0] ?? null });
  } catch (error) {
    next(error);
  }
});

app.put("/api/profile", requireAuthentication, async (request, response, next) => {
  const profile = parseProfile(request.body);
  if (!profile) {
    response.status(400).json({
      error: "Enter a weight class, school, and season record in W-L or W-L-T format.",
    });
    return;
  }

  try {
    const userId: string = response.locals.userId;
    const result = await database.query<Profile>(
      `INSERT INTO wrestler_profiles (user_id, weight_class, school, season_record)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE SET
         weight_class = EXCLUDED.weight_class,
         school = EXCLUDED.school,
         season_record = EXCLUDED.season_record,
         updated_at = NOW()
       RETURNING
         weight_class AS "weightClass",
         school,
         season_record AS "seasonRecord"`,
      [userId, profile.weightClass, profile.school, profile.seasonRecord],
    );
    response.json({ profile: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.get("/api/health", async (_request, response) => {
  const [postgresResult, redisResult] = await Promise.allSettled([
    database.query("SELECT 1"),
    cache.ping(),
  ]);
  const services = {
    postgres: postgresResult.status === "fulfilled" ? "ok" : "unavailable",
    redis: redisResult.status === "fulfilled" ? "ok" : "unavailable",
  };
  const healthy = postgresResult.status === "fulfilled" && redisResult.status === "fulfilled";

  if (!healthy) {
    if (postgresResult.status === "rejected") {
      console.error("PostgreSQL health check failed:", postgresResult.reason);
    }
    if (redisResult.status === "rejected") {
      console.error("Redis health check failed:", redisResult.reason);
    }
  }

  response.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "unavailable",
    services,
  });
});

app.use((_request, response) => {
  response.status(404).json({ error: "Not found" });
});

const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  console.error("API request failed:", error);
  response.status(500).json({ error: "Internal server error" });
};

app.use(errorHandler);
