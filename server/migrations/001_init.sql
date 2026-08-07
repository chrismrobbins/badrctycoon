-- BadRCTycoon — initial schema
-- Target: PostgreSQL 14+ (gen_random_uuid() is in core from 13; citext needs the extension)
--
-- Design notes:
--   * Every game-scoped table carries game_id so the arcade can share one account. See
--     docs/ARCHITECTURE.md §6.4 — adding this later is a painful backfill.
--   * Session tokens are stored hashed. A DB leak must not be a session leak.
--   * Save blobs live in their own table so the load screen and leaderboard never read them.
--   * Headline stats are denormalised onto save_slots for the same reason.

BEGIN;

CREATE EXTENSION IF NOT EXISTS citext;

-- ---------------------------------------------------------------------------
-- shared helper: keep updated_at honest
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- games — one row per title on the platform
-- ---------------------------------------------------------------------------
CREATE TABLE games (
  id          text PRIMARY KEY,                 -- 'badrctycoon', 'blaster', …
  title       text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO games (id, title) VALUES ('badrctycoon', 'Bad RC Tycoon');

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  username       citext      NOT NULL UNIQUE,
  email          citext      UNIQUE,            -- nullable: username-only accounts
  password_hash  text,                          -- nullable: OAuth-only accounts
  display_name   text        NOT NULL,
  is_admin       boolean     NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz,

  CONSTRAINT users_username_format CHECK (username ~ '^[A-Za-z0-9_-]{3,24}$'),
  CONSTRAINT users_display_name_len CHECK (char_length(display_name) BETWEEN 1 AND 40),
  -- an account must be reachable by at least one credential
  CONSTRAINT users_has_credential CHECK (password_hash IS NOT NULL OR email IS NOT NULL)
);

CREATE TRIGGER users_touch BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- auth_identities — Google / GitHub / etc. One row per linked provider.
-- ---------------------------------------------------------------------------
CREATE TABLE auth_identities (
  provider    text        NOT NULL,             -- 'google', 'github', …
  subject     text        NOT NULL,             -- provider's stable user id
  user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email       citext,
  linked_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, subject)
);

CREATE INDEX auth_identities_user_idx ON auth_identities (user_id);

-- ---------------------------------------------------------------------------
-- sessions — opaque bearer/cookie tokens, stored as sha256(token)
-- ---------------------------------------------------------------------------
CREATE TABLE sessions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  bytea       NOT NULL UNIQUE,      -- sha256 of the token; never the token
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  last_used_at timestamptz,
  user_agent  text,
  ip          inet
);

-- token_hash's UNIQUE constraint already provides the lookup index; no second one.
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expiry_idx ON sessions (expires_at);

-- ---------------------------------------------------------------------------
-- save_slots — the "file" a player names. Metadata only; blob lives next door.
--
-- `revision` is the optimistic-concurrency token. Clients send the revision they
-- based their edit on; a stale write gets 409 and the conflict UI. See §6.2.
-- ---------------------------------------------------------------------------
CREATE TABLE save_slots (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id       text        NOT NULL REFERENCES games(id),
  slot          smallint    NOT NULL,
  park_name     text        NOT NULL,
  save_version  integer     NOT NULL,           -- client save-schema version

  -- denormalised headline stats: load screen + leaderboard never touch the blob
  day           integer     NOT NULL DEFAULT 1,
  funds         bigint      NOT NULL DEFAULT 0,
  park_value    bigint      NOT NULL DEFAULT 0,
  rating        integer     NOT NULL DEFAULT 0,
  guests        integer     NOT NULL DEFAULT 0,
  playtime_ms   bigint      NOT NULL DEFAULT 0,

  revision      integer     NOT NULL DEFAULT 1,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  UNIQUE (user_id, game_id, slot),
  CONSTRAINT save_slots_slot_range CHECK (slot BETWEEN 1 AND 12),
  CONSTRAINT save_slots_name_len   CHECK (char_length(park_name) BETWEEN 1 AND 48),
  CONSTRAINT save_slots_day_sane   CHECK (day >= 1)
);

CREATE INDEX save_slots_user_game_idx ON save_slots (user_id, game_id, updated_at DESC);

CREATE TRIGGER save_slots_touch BEFORE UPDATE ON save_slots
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- save_blobs — the serialized game state, 1:1 with save_slots
--
-- jsonb over bytea: Postgres TOASTs + compresses anything over ~2 KB anyway, and
-- keeping it queryable makes server-side migrations and analytics possible.
-- Expect 100–200 KB for a full 35x35 park; the API rejects anything over 2 MB.
-- ---------------------------------------------------------------------------
-- The 2 MB size cap is enforced in the API, not here: pg_column_size() is STABLE,
-- and Postgres only accepts IMMUTABLE expressions in CHECK constraints. The API
-- boundary is the better place for it anyway — a 413 with a useful message beats a
-- constraint violation.
CREATE TABLE save_blobs (
  slot_id    uuid        PRIMARY KEY REFERENCES save_slots(id) ON DELETE CASCADE,
  state      jsonb       NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER save_blobs_touch BEFORE UPDATE ON save_blobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- save_history — rolling backups. Lets a player recover from a bad autosave and
-- gives us something to replay when a migration goes wrong. Pruned to N per slot
-- by a scheduled job, not by a trigger.
-- ---------------------------------------------------------------------------
CREATE TABLE save_history (
  id         bigserial   PRIMARY KEY,
  slot_id    uuid        NOT NULL REFERENCES save_slots(id) ON DELETE CASCADE,
  revision   integer     NOT NULL,
  state      jsonb       NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX save_history_slot_idx ON save_history (slot_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- scores — one row per (user, game, metric); best value only, like the arcade's
-- scores table. Submitting a worse value must not overwrite.
-- ---------------------------------------------------------------------------
CREATE TABLE scores (
  user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id     text        NOT NULL REFERENCES games(id),
  metric      text        NOT NULL,             -- 'park_value' | 'guests_peak' | 'day_reached'
  value       bigint      NOT NULL,
  slot_id     uuid        REFERENCES save_slots(id) ON DELETE SET NULL,
  achieved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, game_id, metric)
);

CREATE INDEX scores_leaderboard_idx ON scores (game_id, metric, value DESC);

-- ---------------------------------------------------------------------------
-- achievements — mirrors the in-game AWARD_DEFS, earned once per account
-- ---------------------------------------------------------------------------
CREATE TABLE achievements (
  user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id    text        NOT NULL REFERENCES games(id),
  award_id   text        NOT NULL,              -- 'clean', 'thrill', 'tycoon', …
  slot_id    uuid        REFERENCES save_slots(id) ON DELETE SET NULL,
  earned_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, game_id, award_id)
);

COMMIT;
