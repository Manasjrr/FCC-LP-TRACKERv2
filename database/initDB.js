function initDB(db) {
    db.pragma("foreign_keys = ON");

    // ── Table players (globale, un seul enregistrement par joueur/puuid) ──────
    db.prepare(`
        CREATE TABLE IF NOT EXISTS players (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id       TEXT,
            guild_id      TEXT,
            channel_id    TEXT,
            riot_id       TEXT,
            puuid         TEXT,
            last_match_id TEXT,
            last_lp       INTEGER DEFAULT 0,
            last_rank     TEXT    DEFAULT '',
            last_update   TEXT,
            active        INTEGER DEFAULT 1
        )
    `).run();

    db.prepare(`CREATE INDEX IF NOT EXISTS idx_players_guild_id
        ON players (guild_id)`).run();

    db.prepare(`CREATE INDEX IF NOT EXISTS idx_players_puuid
        ON players (puuid)`).run();

    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_players_guild_riot
        ON players (guild_id, riot_id)`).run();

    // ── Table player_guilds (relation joueur ↔ serveur) ──────────────────────
    db.prepare(`
        CREATE TABLE IF NOT EXISTS player_guilds (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            player_id  INTEGER NOT NULL,
            guild_id   TEXT    NOT NULL,
            channel_id TEXT,
            user_id    TEXT,
            active     INTEGER DEFAULT 1,
            FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
            UNIQUE(player_id, guild_id)
        )
    `).run();

    db.prepare(`CREATE INDEX IF NOT EXISTS idx_player_guilds_guild
        ON player_guilds (guild_id)`).run();

    db.prepare(`CREATE INDEX IF NOT EXISTS idx_player_guilds_player
        ON player_guilds (player_id)`).run();

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

    // ── Migrations ────────────────────────────────────────────────────────────
    runMigrations(db);

    console.log("Base de données initialisée");
}

// ─── Migrations progressives ──────────────────────────────────────────────────
function runMigrations(db) {

    // Migration 1 — Ajout colonne active dans players
    const hasActive = db.prepare(`
        SELECT COUNT(*) as count FROM pragma_table_info('players') WHERE name = 'active'
    `).get().count > 0;

    if (!hasActive) {
        db.prepare(`ALTER TABLE players ADD COLUMN active INTEGER DEFAULT 1`).run();
        console.log("Migration : colonne active ajoutée à players");
    }

    // Migration 2 — Remplissage de player_guilds depuis players existants
    const playerGuildsEmpty = db.prepare(`
        SELECT COUNT(*) as count FROM player_guilds
    `).get().count === 0;

    const hasExistingPlayers = db.prepare(`
        SELECT COUNT(*) as count FROM players
    `).get().count > 0;

    if (playerGuildsEmpty && hasExistingPlayers) {
        const players = db.prepare(`SELECT * FROM players WHERE guild_id IS NOT NULL`).all();

        const insert = db.prepare(`
            INSERT OR IGNORE INTO player_guilds (player_id, guild_id, channel_id, user_id, active)
            VALUES (?, ?, ?, ?, 1)
        `);

        const migrate = db.transaction(() => {
            for (const p of players) {
                insert.run(p.id, p.guild_id, p.channel_id, p.user_id);
            }
        });

        migrate();
        console.log(`Migration : ${players.length} joueur(s) migrés vers player_guilds`);
    }
}

module.exports = { initDB, runMigrations };
