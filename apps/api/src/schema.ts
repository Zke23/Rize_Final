import { database } from "./services";

export async function initializeSchema(): Promise<void> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS app_users (
      id UUID PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      token_hash CHAR(64) PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS auth_sessions_user_id_idx ON auth_sessions(user_id);
    CREATE INDEX IF NOT EXISTS auth_sessions_expires_at_idx ON auth_sessions(expires_at);

    CREATE TABLE IF NOT EXISTS wrestler_profiles (
      user_id UUID PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
      weight_class VARCHAR(40) NOT NULL,
      school VARCHAR(120) NOT NULL,
      season_record VARCHAR(20) NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS videos (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      file_name TEXT NOT NULL UNIQUE,
      mime_type TEXT NOT NULL,
      caption VARCHAR(280) NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS videos_created_at_idx ON videos(created_at DESC, id DESC);

    CREATE TABLE IF NOT EXISTS video_reactions (
      video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      reaction VARCHAR(10) NOT NULL CHECK (reaction IN ('like', 'dislike')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (video_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS video_comments (
      id UUID PRIMARY KEY,
      video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      body VARCHAR(500) NOT NULL CHECK (length(trim(body)) > 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS video_comments_video_created_at_idx
      ON video_comments(video_id, created_at);

    CREATE TABLE IF NOT EXISTS video_shares (
      id UUID PRIMARY KEY,
      video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS video_shares_video_id_idx ON video_shares(video_id);
  `);
}
