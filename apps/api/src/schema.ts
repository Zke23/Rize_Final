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
  `);
}
