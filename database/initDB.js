const { MATCH_STATS_COLUMNS } = require("../utils/matchStatsUtils");

// ─── Performances SQLite ──────────────────────────────────────────────────────
// • WAL : les écritures ne bloquent plus les lectures, et chaque écriture coûte
//   beaucoup moins cher (pas de réécriture complète du journal)
// • synchronous NORMAL : sûr en WAL (aucune corruption possible), bien plus rapide
// • requêtes préparées mises en cache : le code appelle db.prepare(sql) à chaque
//   exécution → le SQL n'est plus recompilé à chaque fois
const MAX_CACHED_STATEMENTS = 500;

function tuneDB(db) {
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");

    const prepare = db.prepare.bind(db);
    const statements = new Map();
    db.prepare = (sql) => {
        let statement = statements.get(sql);
        if (!statement) {
            // Garde-fou : SQL généré dynamiquement en très grand nombre
            if (statements.size >= MAX_CACHED_STATEMENTS) statements.clear();
            statement = prepare(sql);
            statements.set(sql, statement);
        }
        return statement;
    };
}

function initDB(db) {
    tuneDB(db);
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
            is_remake      INTEGER DEFAULT 0,
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

    // Migration 3 — Ajout colonne is_remake dans match_history
    // + marquage des remakes existants (partie < 5 min et aucune variation de LP)
    const hasIsRemake = db.prepare(`
        SELECT COUNT(*) as count FROM pragma_table_info('match_history') WHERE name = 'is_remake'
    `).get().count > 0;

    if (!hasIsRemake) {
        db.prepare(`ALTER TABLE match_history ADD COLUMN is_remake INTEGER DEFAULT 0`).run();
        const { changes } = db.prepare(`
            UPDATE match_history SET is_remake = 1
            WHERE match_duration < 300 AND lp_change = 0
        `).run();
        console.log(`Migration : colonne is_remake ajoutée à match_history (${changes} remake(s) détecté(s))`);
    }

    // Migration 4 — Harmonisation du rang non classé ("Non classé" → "UNRANKED")
    // Évite une fausse notification de changement de rang ("Non classé" ≠ "UNRANKED")
    const unrankedPlayers = db.prepare(`
        UPDATE players SET last_rank = 'UNRANKED' WHERE last_rank = 'Non classé'
    `).run().changes;
    const unrankedMatches = db.prepare(`
        UPDATE match_history
        SET rank_before = CASE WHEN rank_before = 'Non classé' THEN 'UNRANKED' ELSE rank_before END,
            rank_after  = CASE WHEN rank_after  = 'Non classé' THEN 'UNRANKED' ELSE rank_after  END
        WHERE rank_before = 'Non classé' OR rank_after = 'Non classé'
    `).run().changes;

    if (unrankedPlayers || unrankedMatches) {
        console.log(`Migration : "Non classé" → "UNRANKED" (${unrankedPlayers} joueur(s), ${unrankedMatches} match(s))`);
    }

    // Migration 5 — Statistiques détaillées dans match_history (rôle, CS, dégâts, vision...)
    // Les colonnes sont définies dans utils/matchStatsUtils.js : toute nouvelle stat
    // ajoutée là-bas est créée ici automatiquement
    const existingColumns = new Set(
        db.prepare(`SELECT name FROM pragma_table_info('match_history')`).all().map((c) => c.name)
    );
    const missingColumns = Object.entries(MATCH_STATS_COLUMNS)
        .filter(([name]) => !existingColumns.has(name));

    if (missingColumns.length) {
        db.transaction(() => {
            for (const [name, type] of missingColumns) {
                db.prepare(`ALTER TABLE match_history ADD COLUMN ${name} ${type}`).run();
            }
        })();
        console.log(`Migration : ${missingColumns.length} colonne(s) de stats ajoutée(s) à match_history`);
    }

    db.prepare(`CREATE INDEX IF NOT EXISTS idx_match_history_player_role
        ON match_history (player_id, team_position)`).run();

    // Migration 6 — Paramètres par serveur (notifications Flex...)
    db.prepare(`
        CREATE TABLE IF NOT EXISTS guild_settings (
            guild_id           TEXT PRIMARY KEY,
            flex_notifications INTEGER DEFAULT 0
        )
    `).run();

    // Migration 6b — Style de la vignette des groupes (gif / mosaique)
    const hasGroupThumbnail = db.prepare(`
        SELECT COUNT(*) as count FROM pragma_table_info('guild_settings') WHERE name = 'group_thumbnail'
    `).get().count > 0;

    if (!hasGroupThumbnail) {
        db.prepare(`ALTER TABLE guild_settings ADD COLUMN group_thumbnail TEXT DEFAULT 'gif'`).run();
        console.log("Migration : colonne group_thumbnail ajoutée à guild_settings");
    }

    // Migration 6c — Langue du bot par serveur (anglais par défaut, /language pour changer)
    const hasLanguage = db.prepare(`
        SELECT COUNT(*) as count FROM pragma_table_info('guild_settings') WHERE name = 'language'
    `).get().count > 0;

    if (!hasLanguage) {
        db.prepare(`ALTER TABLE guild_settings ADD COLUMN language TEXT DEFAULT 'en'`).run();
        console.log("Migration : colonne language ajoutée à guild_settings");
    }

    // Migration 7 — Dernier match ranked (SoloQ + Flex) traité par joueur
    // (curseur du mode "ranked" utilisé quand /flex est activé)
    const hasLastRankedMatch = db.prepare(`
        SELECT COUNT(*) as count FROM pragma_table_info('players') WHERE name = 'last_ranked_match_id'
    `).get().count > 0;

    if (!hasLastRankedMatch) {
        db.prepare(`ALTER TABLE players ADD COLUMN last_ranked_match_id TEXT`).run();
        console.log("Migration : colonne last_ranked_match_id ajoutée à players");
    }
}

module.exports = { initDB, runMigrations };
