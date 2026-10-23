CREATE TABLE IF NOT EXISTS users (
  id bigint PRIMARY KEY,
  login text NOT NULL,
  name text NOT NULL,
  avatar_url text NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS oauth_states (
  token_hash text PRIMARY KEY,
  verifier text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS sources (
  id uuid PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  kind text NOT NULL CHECK (kind IN ('upload', 'github', 'git')),
  repository text,
  branch text,
  revision integer NOT NULL DEFAULT 0,
  commit_sha text,
  target_commit text,
  synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Extend existing installations without replacing their sources or published posts.
ALTER TABLE sources ADD COLUMN IF NOT EXISTS target_commit text;
ALTER TABLE sources ADD COLUMN IF NOT EXISTS auto_sync boolean NOT NULL DEFAULT false;
ALTER TABLE sources DROP CONSTRAINT IF EXISTS sources_kind_check;
ALTER TABLE sources ADD CONSTRAINT sources_kind_check CHECK (kind IN ('upload', 'github', 'git'));
CREATE INDEX IF NOT EXISTS sources_owner ON sources(user_id);
CREATE TABLE IF NOT EXISTS repository_credentials (
  source_id uuid PRIMARY KEY REFERENCES sources(id) ON DELETE CASCADE,
  encrypted bytea NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS directories (
  source_id uuid NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  path text NOT NULL,
  PRIMARY KEY (source_id, path)
);
CREATE TABLE IF NOT EXISTS files (
  source_id uuid NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  path text NOT NULL,
  content bytea NOT NULL,
  PRIMARY KEY (source_id, path)
);
-- NULL keeps existing inline bytea files readable without rewriting their contents.
ALTER TABLE files ADD COLUMN IF NOT EXISTS byte_size integer CHECK (byte_size >= 0);
CREATE TABLE IF NOT EXISTS file_chunks (
  source_id uuid NOT NULL,
  path text NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  content bytea NOT NULL,
  PRIMARY KEY (source_id, path, ordinal),
  FOREIGN KEY (source_id, path) REFERENCES files(source_id, path) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS posts (
  id uuid PRIMARY KEY,
  source_id uuid NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  entry_path text NOT NULL,
  title text NOT NULL,
  format text NOT NULL CHECK (format IN ('markdown', 'typst')),
  content bytea NOT NULL,
  source_revision integer NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, entry_path)
);
CREATE TABLE IF NOT EXISTS post_assets (
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  path text NOT NULL,
  content bytea NOT NULL,
  media_type text NOT NULL,
  PRIMARY KEY (post_id, path)
);
