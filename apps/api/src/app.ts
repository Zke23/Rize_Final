import { randomUUID } from "node:crypto";
import { rm, unlink } from "node:fs/promises";
import { join } from "node:path";
import cors from "cors";
import express from "express";
import type { ErrorRequestHandler } from "express";
import multer from "multer";
import {
  loginAccount,
  parseCredentials,
  registerAccount,
  requireAuthentication,
} from "./auth";
import { config } from "./config";
import { cache, database } from "./services";

export const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const videoExtensions: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/x-m4v": "m4v",
};

class UnsupportedVideoTypeError extends Error {}

const videoUpload = multer({
  storage: multer.diskStorage({
    destination: config.videoStorageDir,
    filename: (_request, file, callback) => {
      callback(null, `${randomUUID()}.${videoExtensions[file.mimetype]}`);
    },
  }),
  limits: { fileSize: 100 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => {
    if (!videoExtensions[file.mimetype]) {
      callback(new UnsupportedVideoTypeError("Choose an MP4 or MOV video."));
      return;
    }
    callback(null, true);
  },
});

interface Profile {
  weightClass: string;
  school: string;
  seasonRecord: string;
}

interface VideoRow {
  id: string;
  caption: string;
  mimeType: string;
  createdAt: Date;
  fileName: string;
}

interface FeedVideoRow {
  id: string;
  caption: string;
  mimeType: string;
  createdAt: Date;
}

type VideoReaction = "like" | "dislike";

interface VideoSocialStats {
  likeCount: number;
  dislikeCount: number;
  nominationCount: number;
  commentCount: number;
  shareCount: number;
  myReaction: VideoReaction | null;
  myNomination: string | null;
}

interface VideoSocialStatsRow {
  likeCount: string;
  dislikeCount: string;
  nominationCount: string;
  commentCount: string;
  shareCount: string;
  myReaction: VideoReaction | null;
  myNomination: string | null;
}

interface KingOfHillVideoRow {
  id: string;
  caption: string;
  nominationCount: number;
}

interface VideoCommentRow {
  id: string;
  text: string;
  authorSchool: string;
  createdAt: Date;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseVideoId(value: unknown): string | null {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

async function getVideoSocialStats(
  videoId: string,
  userId: string,
): Promise<VideoSocialStats | null> {
  const result = await database.query<VideoSocialStatsRow>(
    `SELECT
       (SELECT COUNT(*) FROM video_reactions WHERE video_id = videos.id AND reaction = 'like') AS "likeCount",
       (SELECT COUNT(*) FROM video_reactions WHERE video_id = videos.id AND reaction = 'dislike') AS "dislikeCount",
       (SELECT COUNT(*) FROM video_nominations WHERE video_id = videos.id) AS "nominationCount",
       (SELECT COUNT(*) FROM video_comments WHERE video_id = videos.id) AS "commentCount",
       (SELECT COUNT(*) FROM video_shares WHERE video_id = videos.id) AS "shareCount",
       (SELECT reaction FROM video_reactions WHERE video_id = videos.id AND user_id = $2) AS "myReaction",
       (SELECT video_id FROM video_nominations WHERE user_id = $2) AS "myNomination"
     FROM videos
     WHERE videos.id = $1`,
    [videoId, userId],
  );
  const stats = result.rows[0];
  if (!stats) {
    return null;
  }
  return {
    likeCount: Number(stats.likeCount),
    dislikeCount: Number(stats.dislikeCount),
    nominationCount: Number(stats.nominationCount),
    commentCount: Number(stats.commentCount),
    shareCount: Number(stats.shareCount),
    myReaction: stats.myReaction,
    myNomination: stats.myNomination,
  };
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

app.get("/api/profile/videos", requireAuthentication, async (_request, response, next) => {
  try {
    const userId: string = response.locals.userId;
    const result = await database.query<Pick<VideoRow, "id" | "caption" | "createdAt">>(
      `SELECT
         id,
         caption,
         created_at AS "createdAt"
       FROM videos
       WHERE user_id = $1
       ORDER BY created_at DESC, id DESC`,
      [userId],
    );
    response.json({ videos: result.rows });
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

app.get("/api/videos", requireAuthentication, async (request, response, next) => {
  const offsetText = request.query.offset;
  const offset =
    offsetText === undefined ? 0 : typeof offsetText === "string" ? Number(offsetText) : NaN;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10000) {
    response.status(400).json({ error: "Video feed offset is invalid." });
    return;
  }

  try {
    const result = await database.query<FeedVideoRow>(
      `SELECT
         videos.id,
         videos.caption,
         videos.mime_type AS "mimeType",
         videos.created_at AS "createdAt"
       FROM videos
       ORDER BY videos.created_at DESC, videos.id DESC
       LIMIT 21 OFFSET $1`,
      [offset],
    );
    const hasMore = result.rows.length > 20;
    const videos = result.rows.slice(0, 20).map((video) => ({
      ...video,
      streamPath: `/api/videos/${video.id}/stream`,
    }));
    response.json({ videos, hasMore });
  } catch (error) {
    next(error);
  }
});

app.get("/api/videos/king-of-the-hill", requireAuthentication, async (_request, response, next) => {
  try {
    const result = await database.query<KingOfHillVideoRow>(
      `SELECT
         videos.id,
         videos.caption,
         COUNT(video_nominations.user_id)::int AS "nominationCount"
       FROM videos
       JOIN video_nominations ON video_nominations.video_id = videos.id
       GROUP BY videos.id
       ORDER BY COUNT(video_nominations.user_id) DESC, videos.created_at DESC, videos.id DESC
       LIMIT 3`,
    );
    response.json({ videos: result.rows });
  } catch (error) {
    next(error);
  }
});

app.get("/api/videos/:id/social", requireAuthentication, async (request, response, next) => {
  const videoId = parseVideoId(request.params.id);
  if (!videoId) {
    response.status(404).json({ error: "Video not found." });
    return;
  }

  try {
    const stats = await getVideoSocialStats(videoId, response.locals.userId);
    if (!stats) {
      response.status(404).json({ error: "Video not found." });
      return;
    }
    response.json(stats);
  } catch (error) {
    next(error);
  }
});

app.put("/api/videos/:id/nomination", requireAuthentication, async (request, response, next) => {
  const videoId = parseVideoId(request.params.id);
  if (!videoId) {
    response.status(404).json({ error: "Video not found." });
    return;
  }

  try {
    const userId: string = response.locals.userId;
    const result = await database.query(
      `INSERT INTO video_nominations (user_id, video_id)
       SELECT $1, videos.id
       FROM videos
       WHERE videos.id = $2
       ON CONFLICT (user_id) DO UPDATE SET
         video_id = EXCLUDED.video_id,
         updated_at = NOW()
       RETURNING video_id`,
      [userId, videoId],
    );
    if (result.rowCount === 0) {
      response.status(404).json({ error: "Video not found." });
      return;
    }

    const stats = await getVideoSocialStats(videoId, userId);
    if (!stats) {
      response.status(404).json({ error: "Video not found." });
      return;
    }
    response.json(stats);
  } catch (error) {
    next(error);
  }
});

app.put("/api/videos/:id/reaction", requireAuthentication, async (request, response, next) => {
  const videoId = parseVideoId(request.params.id);
  if (!videoId) {
    response.status(404).json({ error: "Video not found." });
    return;
  }

  const reaction = isRecord(request.body) ? request.body.reaction : undefined;
  if (reaction !== null && reaction !== "like" && reaction !== "dislike") {
    response.status(400).json({ error: "Choose like, dislike, or no reaction." });
    return;
  }

  try {
    const video = await database.query("SELECT 1 FROM videos WHERE id = $1", [videoId]);
    if (video.rowCount === 0) {
      response.status(404).json({ error: "Video not found." });
      return;
    }

    const userId: string = response.locals.userId;
    if (reaction === null) {
      await database.query(
        "DELETE FROM video_reactions WHERE video_id = $1 AND user_id = $2",
        [videoId, userId],
      );
    } else {
      await database.query(
        `INSERT INTO video_reactions (video_id, user_id, reaction)
         VALUES ($1, $2, $3)
         ON CONFLICT (video_id, user_id) DO UPDATE SET
           reaction = EXCLUDED.reaction,
           created_at = NOW()`,
        [videoId, userId, reaction],
      );
    }

    const stats = await getVideoSocialStats(videoId, userId);
    if (!stats) {
      response.status(404).json({ error: "Video not found." });
      return;
    }
    response.json(stats);
  } catch (error) {
    next(error);
  }
});

app.get("/api/videos/:id/comments", requireAuthentication, async (request, response, next) => {
  const videoId = parseVideoId(request.params.id);
  if (!videoId) {
    response.status(404).json({ error: "Video not found." });
    return;
  }

  try {
    const video = await database.query("SELECT 1 FROM videos WHERE id = $1", [videoId]);
    if (video.rowCount === 0) {
      response.status(404).json({ error: "Video not found." });
      return;
    }

    const result = await database.query<VideoCommentRow>(
      `SELECT
         comments.id,
         comments.body AS "text",
         COALESCE(wrestler_profiles.school, 'Matroom wrestler') AS "authorSchool",
         comments.created_at AS "createdAt"
       FROM video_comments AS comments
       LEFT JOIN wrestler_profiles ON wrestler_profiles.user_id = comments.user_id
       WHERE comments.video_id = $1
       ORDER BY comments.created_at DESC
       LIMIT 100`,
      [videoId],
    );
    response.json({ comments: result.rows.reverse() });
  } catch (error) {
    next(error);
  }
});

app.post("/api/videos/:id/comments", requireAuthentication, async (request, response, next) => {
  const videoId = parseVideoId(request.params.id);
  if (!videoId) {
    response.status(404).json({ error: "Video not found." });
    return;
  }

  const text =
    isRecord(request.body) && typeof request.body.text === "string"
      ? request.body.text.trim()
      : "";
  if (text.length === 0 || text.length > 500) {
    response.status(400).json({ error: "Comments must be between 1 and 500 characters." });
    return;
  }

  try {
    const result = await database.query<VideoCommentRow>(
      `WITH inserted AS (
         INSERT INTO video_comments (id, video_id, user_id, body)
         SELECT $1, videos.id, $3, $4
         FROM videos
         WHERE videos.id = $2
         RETURNING id, user_id, body, created_at
       )
       SELECT
         inserted.id,
         inserted.body AS "text",
         COALESCE(wrestler_profiles.school, 'Matroom wrestler') AS "authorSchool",
         inserted.created_at AS "createdAt"
       FROM inserted
       LEFT JOIN wrestler_profiles ON wrestler_profiles.user_id = inserted.user_id`,
      [randomUUID(), videoId, response.locals.userId, text],
    );
    const comment = result.rows[0];
    if (!comment) {
      response.status(404).json({ error: "Video not found." });
      return;
    }
    response.status(201).json({ comment });
  } catch (error) {
    next(error);
  }
});

app.post("/api/videos/:id/shares", requireAuthentication, async (request, response, next) => {
  const videoId = parseVideoId(request.params.id);
  if (!videoId) {
    response.status(404).json({ error: "Video not found." });
    return;
  }

  try {
    const result = await database.query(
      `INSERT INTO video_shares (id, video_id, user_id)
       SELECT $1, videos.id, $3
       FROM videos
       WHERE videos.id = $2
       RETURNING id`,
      [randomUUID(), videoId, response.locals.userId],
    );
    if (result.rowCount === 0) {
      response.status(404).json({ error: "Video not found." });
      return;
    }

    const stats = await getVideoSocialStats(videoId, response.locals.userId);
    if (!stats) {
      response.status(404).json({ error: "Video not found." });
      return;
    }
    response.status(201).json({ shareCount: stats.shareCount });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/videos/:id", requireAuthentication, async (request, response, next) => {
  const videoId = parseVideoId(request.params.id);
  if (!videoId) {
    response.status(404).json({ error: "Video not found." });
    return;
  }

  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{ fileName: string }>(
      `DELETE FROM videos
       WHERE id = $1 AND user_id = $2
       RETURNING file_name AS "fileName"`,
      [videoId, response.locals.userId],
    );
    const video = result.rows[0];
    if (!video) {
      await client.query("ROLLBACK");
      response.status(404).json({ error: "Video not found." });
      return;
    }

    await rm(join(config.videoStorageDir, video.fileName), { force: true });
    await client.query("COMMIT");
    response.status(204).end();
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});

app.post(
  "/api/videos",
  requireAuthentication,
  videoUpload.single("video"),
  async (request, response, next) => {
    const file = request.file;
    if (!file) {
      response.status(400).json({ error: "Choose a video to upload." });
      return;
    }

    const caption =
      typeof request.body.caption === "string" ? request.body.caption.trim() : "";
    if (caption.length > 280) {
      try {
        await unlink(file.path);
      } catch (error) {
        console.error("Failed to remove a video with an invalid caption:", error);
      }
      response.status(400).json({ error: "Captions must be 280 characters or fewer." });
      return;
    }

    const id = randomUUID();
    try {
      const result = await database.query<VideoRow>(
        `INSERT INTO videos (id, user_id, file_name, mime_type, caption)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING
           id,
           caption,
           mime_type AS "mimeType",
           created_at AS "createdAt",
           file_name AS "fileName"`,
        [id, response.locals.userId, file.filename, file.mimetype, caption],
      );
      const video = result.rows[0];
      response.status(201).json({
        id: video.id,
        caption: video.caption,
        mimeType: video.mimeType,
        createdAt: video.createdAt,
        streamPath: `/api/videos/${id}/stream`,
      });
    } catch (error) {
      try {
        await unlink(file.path);
      } catch (cleanupError) {
        console.error("Failed to remove an unrecorded video upload:", cleanupError);
      }
      next(error);
    }
  },
);

app.get("/api/videos/:id/stream", requireAuthentication, async (request, response, next) => {
  const videoId = parseVideoId(request.params.id);
  if (!videoId) {
    response.status(404).json({ error: "Video not found." });
    return;
  }

  try {
    const result = await database.query<{ fileName: string; mimeType: string }>(
      `SELECT file_name AS "fileName", mime_type AS "mimeType"
       FROM videos
       WHERE id = $1`,
      [videoId],
    );
    const video = result.rows[0];
    if (!video) {
      response.status(404).json({ error: "Video not found." });
      return;
    }

    response.type(video.mimeType);
    response.sendFile(join(config.videoStorageDir, video.fileName), (error) => {
      if (error) {
        next(error);
      }
    });
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

const errorHandler: ErrorRequestHandler = (error, _request, response, next) => {
  if (error instanceof UnsupportedVideoTypeError) {
    response.status(415).json({ error: error.message });
    return;
  }
  if (error instanceof multer.MulterError) {
    const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    response.status(status).json({
      error: status === 413 ? "Videos must be 100 MB or smaller." : "The video upload is invalid.",
    });
    return;
  }
  if (response.headersSent) {
    next(error);
    return;
  }
  console.error("API request failed:", error);
  response.status(500).json({ error: "Internal server error" });
};

app.use(errorHandler);
