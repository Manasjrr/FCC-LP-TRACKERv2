function initDB(db) {
    // ── Table players ─────────────────────────────────────────────────────────
    db.prepare(`
        CREATE TABLE IF NOT EXISTS players (
            id INTEGER PRIMARY KEY,
            user_id TEXT,
            guild_id TEXT,
            channel_id TEXT,
            riot_id TEXT,
            puuid TEXT,
            last_match_id TEXT,
            last_lp INTEGER DEFAULT 0,
            last_rank TEXT DEFAULT '',
            last_update TEXT
        )
    `).run();

    // ── Table user_links ──────────────────────────────────────────────────────
    db.prepare(`
        CREATE TABLE IF NOT EXISTS user_links (
            user_id TEXT,
            guild_id TEXT,
            player_id INTEGER,
            PRIMARY KEY (user_id, guild_id),
            FOREIGN KEY (player_id) REFERENCES players(id)
        )
    `).run();

    // ── Table match_history ───────────────────────────────────────────────────
    db.prepare(`
        CREATE TABLE IF NOT EXISTS match_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            player_id INTEGER,
            match_id TEXT,
            champion_id INTEGER,
            champion_name TEXT,
            kills INTEGER,
            deaths INTEGER,
            assists INTEGER,
            win BOOLEAN,
            lp_change INTEGER,
            rank_before TEXT,
            rank_after TEXT,
            lp_before INTEGER,
            lp_after INTEGER,
            match_duration INTEGER,
            game_creation BIGINT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (player_id) REFERENCES players(id),
            UNIQUE(player_id, match_id)
        )
    `).run();

    console.log("✅ Base de données initialisée");
}

module.exports = { initDB };
