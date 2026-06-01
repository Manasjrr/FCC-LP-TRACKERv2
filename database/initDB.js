function initDB(db) {
    db.pragma("foreign_keys = ON");

    // ── Table players ─────────────────────────────────────────────────────────
    db.prepare(`
        CREATE TABLE IF NOT EXISTS players (
            id          INTEGER PRIMARY KEY,
            user_id     TEXT,
            guild_id    TEXT,
            channel_id  TEXT,
            riot_id     TEXT,
            puuid       TEXT,
            last_match_id TEXT,
            last_lp     INTEGER DEFAULT 0,
            last_rank   TEXT    DEFAULT '',
            last_update TEXT
        )
    `).run();

    db.prepare(`CREATE INDEX IF NOT EXISTS idx_players_guild_id
        ON players (guild_id)`).run();

    db.prepare(`CREATE INDEX IF NOT EXISTS idx_players_puuid
        ON players (puuid)`).run();

    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_players_guild_riot
        ON players (guild_id, riot_id)`).run();

    // ── Table user_links ──────────────────────────────────────────────────────
    db.prepare(`
        CREATE TABLE IF NOT EXISTS user_links (
            user_id   TEXT,
            guild_id  TEXT,
            player_id INTEGER,
            PRIMARY KEY (user_id, guild_id),
            FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
        )
    `).run();

    db.prepare(`CREATE INDEX IF NOT EXISTS idx_user_links_player_id
        ON user_links (player_id)`).run();

    // ── Table match_history ───────────────────────────────────────────────────
    db.prepare(`
        CREATE TABLE IF NOT EXISTS match_history (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            player_id      INTEGER,
            match_id       TEXT,
            champion_id    INTEGER,
            champion_name  TEXT,
            kills          INTEGER,
            deaths         INTEGER,
            assists        INTEGER,
            win            BOOLEAN,
            lp_change      INTEGER,
            rank_before    TEXT,
            rank_after     TEXT,
            lp_before      INTEGER,
            lp_after       INTEGER,
            match_duration INTEGER,
            game_creation  BIGINT,
            created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
            UNIQUE(player_id, match_id)
        )
    `).run();

    db.prepare(`CREATE INDEX IF NOT EXISTS idx_match_history_player_creation
        ON match_history (player_id, game_creation DESC)`).run();

    db.prepare(`CREATE INDEX IF NOT EXISTS idx_match_history_match_id
        ON match_history (match_id)`).run();

    console.log("Base de données initialisée");
}

module.exports = { initDB };
