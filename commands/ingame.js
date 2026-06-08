const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { getActiveGame } = require("../services/riotApiService");
const { getRankEmoji } = require("../utils/rankUtils");
const logger = require("../utils/loggers");

// ─── Maps utilitaires ─────────────────────────────────────────────────────────
const QUEUE_NAMES = {
    420: "SoloQ",
    440: "Flex",
};

const ROLE_EMOJIS = {
    TOP: "🗡️",
    JUNGLE: "🌿",
    MID: "🔮",
    ADC: "🏹",
    SUPPORT: "🛡️",
    NONE: "❓",
};

// ─── IDs des sorts d'invocateur ───────────────────────────────────────────────
const SMITE = 11;
const FLASH = 4;
const HEAL = 7;
const EXHAUST = 3;
const IGNITE = 14;
const BARRIER = 21;
const TELEPORT = 12;
const GHOST = 6;
const CLEANSE = 1;

// ─── Champions exclusivement joués Support ────────────────────────────────────
// Utilisé pour affiner la détection Bot vs Support quand Heal est présent
const SUPPORT_ONLY_CHAMPIONS = new Set([
    40,  // Janna
    267, // Nami
    412, // Thresh
    201, // Braum
    117, // Lulu
    37,  // Sona
    16,  // Soraka
    25,  // Morgana
    44,  // Taric
    432, // Bard
    497, // Rakan
    526, // Rell
    902, // Milio
    235, // Senna    (peut être ADC, mais souvent support)
    147, // Seraphine
    888, // Renata Glasc
    350, // Yuumi
]);

// ─── Champions exclusivement joués ADC ───────────────────────────────────────
const ADC_ONLY_CHAMPIONS = new Set([
    51,  // Caitlyn
    222, // Jinx
    202, // Jhin
    22,  // Ashe
    15,  // Sivir
    429, // Kalista
    498, // Xayah
    110, // Varus
    119, // Draven
    236, // Lucian
    21,  // Miss Fortune
    18,  // Tristana
    29,  // Twitch
    96,  // Kog'Maw
    42,  // Corki
    133, // Quinn
    221, // Zeri
    360, // Samira
    895, // Nilah
    903, // Smolder
    523, // Aphelios
]);

// ─── Détection du rôle via les sorts d'invocateur + champion ─────────────────
/**
 * Fiabilité estimée :
 *  - JUNGLE  → 100% (smite exclusif)
 *  - SUPPORT → ~85% (exhaust/barrier très liés au support)
 *  - ADC  → ~80% (heal + champion ADC connu)
 *  - TOP     → ~65% (téléport + pas heal + pas smite)
 *  - MID  → ~55% (ignite sans heal, par élimination)
 *  - NONE    → cas bzr restants
 */
function getRoleFromSpells(spell1Id, spell2Id, championId) {
    const spells = [spell1Id, spell2Id];

    // ── Jungle ────────────────────────────────────────────────
    if (spells.includes(SMITE)) return "JUNGLE";

    // ── Support (exhaust ou barrier) ───────────
    if (spells.includes(EXHAUST) || spells.includes(BARRIER)) return "SUPPORT";

    // ── ADC / Support avec Heal ────────────────────────────────────────────
    if (spells.includes(HEAL)) {
        // Champion identifié comme support → SUPPORT
        if (championId && SUPPORT_ONLY_CHAMPIONS.has(championId)) return "SUPPORT";
        // Champion identifié comme ADC → ADC
        if (championId && ADC_ONLY_CHAMPIONS.has(championId)) return "ADC";
        // Heal sans info champion précise → probablement ADC
        return "ADC";
    }

    // ── Téléport → Top dans la grande majorité des cas ───────────────────────
    // (Mid prend rarement TP en ranked, encore moins avec Ignite)
    if (spells.includes(TELEPORT)) {
        // TP + Ignite → Mid possible, mais Top reste majoritaire
        if (spells.includes(IGNITE)) return "TOP";
        return "TOP";
    }

    // ── Ignite sans Heal/Exhaust/TP → Mid ou Top ─────────────────────────────
    // Flash + Ignite est commun Mid. Ghost + Ignite aussi.
    if (spells.includes(IGNITE)) {
        // Support avec ignite possible mais rare → on préfère MID
        if (championId && SUPPORT_ONLY_CHAMPIONS.has(championId)) return "SUPPORT";
        return "MID";
    }

    // ── Ghost → souvent Top (Darius, Garen, Mordekaiser…) ────────────────────
    if (spells.includes(GHOST)) return "TOP";

    // ── Cleanse → ADC ou Mid, on ne peut pas trancher ────────────────────────
    return "NONE";
}

// ─── Formatage durée ──────────────────────────────────────────────────────────
function formatDuration(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m${s.toString().padStart(2, "0")}s`;
}

// ─── Cache court pour éviter le spam API ─────────────────────────────────────
const ingameCache = new Map();
const INGAME_CACHE_TTL = 30_000; // 30 secondes

async function getActiveGameCached(puuid) {
    const cached = ingameCache.get(puuid);
    if (cached && Date.now() - cached.timestamp < INGAME_CACHE_TTL) {
        logger.debug("INGAME", `Cache hit pour ${puuid.substring(0, 8)}...`);
        return cached.data;
    }
    const data = await getActiveGame(puuid);
    ingameCache.set(puuid, { data, timestamp: Date.now() });
    return data;
}

// ─── Wrapper timeout par joueur ───────────────────────────────────────────────
function withTimeout(promise, ms, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout (${ms}ms) pour ${label}`)), ms)
        ),
    ]);
}

// ─── Commande ─────────────────────────────────────────────────────────────────
module.exports = {
    data: new SlashCommandBuilder()
        .setName("ingame")
        .setDescription("Affiche les joueurs surveillés actuellement en partie (SoloQ / Flex)"),

    async execute(interaction) {
        await interaction.deferReply();

        logger.info("INGAME", `/ingame exécuté par ${interaction.user.tag}`, {
            guild: interaction.guildId,
        });

        // ── Récupérer les joueurs actifs sur ce serveur ───────────────────────
        const players = global.db.prepare(`
            SELECT p.* FROM players p
            JOIN player_guilds pg ON pg.player_id = p.id
            WHERE pg.guild_id = ? AND pg.active = 1
        `).all(interaction.guildId);

        if (!players?.length) {
            return interaction.editReply("📭 Aucun compte surveillé sur ce serveur.");
        }

        logger.info("INGAME", `${players.length} joueur(s) à vérifier`, {
            players: players.map((p) => p.riot_id),
        });

        // Message intermédiaire seulement si beaucoup de joueurs
        if (players.length > 4) {
            await interaction.editReply(
                `🔍 Vérification de ${players.length} joueur(s) en cours...`
            );
        }

        // ── Appels API séquentiels avec délai + cache + timeout ───────────────
        const results = [];

        for (const player of players) {
            logger.debug("INGAME", `Vérification de ${player.riot_id}`, {
                puuid: player.puuid?.substring(0, 8) + "...",
            });

            try {
                const gameData = await withTimeout(
                    getActiveGameCached(player.puuid),
                    5_000,
                    player.riot_id
                );

                logger.debug("INGAME", `Résultat pour ${player.riot_id}`, {
                    inGame: gameData !== null,
                    queueId: gameData?.gameQueueConfigId ?? "N/A",
                    gameId: gameData?.gameId ?? "N/A",
                    gameLength: gameData?.gameLength ?? "N/A",
                    participantsCount: gameData?.participants?.length ?? 0,
                });

                results.push({ status: "fulfilled", value: { player, gameData } });
            } catch (err) {
                logger.error("INGAME", `Erreur API pour ${player.riot_id}`, {
                    status: err.response?.status,
                    message: err.message,
                });
                results.push({ status: "rejected", reason: err });
            }

            // Délai entre chaque appel pour ménager le quota
            await new Promise((r) => setTimeout(r, 150));
        }

        // ── Diagnostic avant filtre ───────────────────────────────────────────
        const fulfilled = results.filter((r) => r.status === "fulfilled");
        const withGame = fulfilled.filter((r) => r.value.gameData !== null);

        logger.info("INGAME", `Résultats bruts`, {
            total: results.length,
            fulfilled: fulfilled.length,
            rejected: results.filter((r) => r.status === "rejected").length,
            withActiveGame: withGame.length,
            queueIds: withGame.map((r) => ({
                player: r.value.player.riot_id,
                queueId: r.value.gameData?.gameQueueConfigId,
            })),
        });

        const inGame = withGame
            .filter((r) => [420, 440].includes(r.value.gameData?.gameQueueConfigId))
            .map((r) => r.value);

        logger.info("INGAME", `Joueurs en SoloQ/Flex après filtre : ${inGame.length}`, {
            players: inGame.map((g) => g.player.riot_id),
        });

        // ── Aucun joueur en game ──────────────────────────────────────────────
        if (!inGame.length) {
            const embed = new EmbedBuilder()
                .setTitle("🎮 Joueurs en partie")
                .setDescription(
                    "😴 Aucun joueur surveillé n'est actuellement en SoloQ ou Flex."
                )
                .setColor(0x808080)
                .setTimestamp()
                .setFooter({ text: `${players.length} joueur(s) vérifié(s)` });

            return interaction.editReply({ content: null, embeds: [embed] });
        }

        // ── Construction de l'embed ───────────────────────────────────────────
        const fields = [];

        for (const { player, gameData } of inGame) {
            const participant = gameData.participants?.find(
                (p) => p.puuid === player.puuid
            );

            if (!participant) {
                logger.warn("INGAME", `Participant introuvable pour ${player.riot_id}`, {
                    gameId: gameData.gameId,
                    participantPuuids: gameData.participants?.map(
                        (p) => p.puuid?.substring(0, 8) + "..."
                    ),
                    playerPuuid: player.puuid?.substring(0, 8) + "...",
                });
                continue;
            }

            logger.debug("INGAME", `Spells de ${player.riot_id}`, {
                spell1Id: participant.spell1Id,
                spell2Id: participant.spell2Id,
                championId: participant.championId,
            });

            const role = getRoleFromSpells(participant.spell1Id, participant.spell2Id, participant.championId);
            const roleEmoji = ROLE_EMOJIS[role] ?? ROLE_EMOJIS["NONE"];
            const roleLabel = role !== "NONE" ? role : "Inconnu";
            const queueName = QUEUE_NAMES[gameData.gameQueueConfigId] ?? `Queue ${gameData.gameQueueConfigId}`;

            // ✅ FIX : gameLength peut être 0 au tout début de la partie
            const rawSeconds = Math.max(0, Math.floor(gameData.gameLength ?? 0));
            const durationLabel = rawSeconds < 60
                ? "🔜 En chargement..."
                : `⏱️ ${formatDuration(rawSeconds)}`;

            const rankEmoji = getRankEmoji(player.last_rank);
            const riotIdFormatted = player.riot_id.replace("#", "-").replace(/ /g, "%20");
            const dpmUrl = `https://dpm.lol/${riotIdFormatted}`;
            const championName = getChampionName(participant.championId);

            // ── Stats récentes depuis la BDD ──────────────────────────────────
            const recentStats = global.db.prepare(`
        SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN win = 1 THEN 1 ELSE 0 END) AS wins
        FROM (
            SELECT win FROM match_history
            WHERE player_id = ?
            ORDER BY game_creation DESC
            LIMIT 20
        )
    `).get(player.id);

            const wrLine = recentStats?.total > 0
                ? `📊 **${Math.round((recentStats.wins / recentStats.total) * 100)}%** WR · ${recentStats.wins}W ${recentStats.total - recentStats.wins}L`
                : null;

            // ── Série en cours ────────────────────────────────────────────────
            const recentMatches = global.db.prepare(`
        SELECT win FROM match_history
        WHERE player_id = ?
        ORDER BY game_creation DESC
        LIMIT 10
    `).all(player.id);

            let streakLine = null;
            if (recentMatches.length >= 2) {
                const first = recentMatches[0].win;
                let count = 0;
                for (const m of recentMatches) {
                    if (Boolean(m.win) === Boolean(first)) count++;
                    else break;
                }
                if (count >= 2) {
                    streakLine = first
                        ? `🔥 **${count} victoires** consécutives`
                        : `💀 **${count} défaites** consécutives`;
                }
            }

            // ── Assemblage du field ───────────────────────────────────────────
            const lines = [
                // Lien cliquable en première ligne de value
                `🔗 [Voir sur DPM](${dpmUrl})`,
                `${rankEmoji} **${player.last_rank ?? "Non classé"}** (${player.last_lp ?? 0} LP)`,
                `${roleEmoji} **${roleLabel}** · 🏆 **${championName}**`,
                `🎯 **${queueName}** · ${durationLabel}`,
            ];
            if (wrLine) lines.push(wrLine);
            if (streakLine) lines.push(streakLine);

            fields.push({
                name: `🔴 ${player.riot_id}`,
                value: lines.join("\n"),
                inline: true,
            });

            logger.success("INGAME", `${player.riot_id} affiché en game`, {
                queue: queueName,
                champion: championName,
                role: roleLabel,
                spell1Id: participant.spell1Id,
                spell2Id: participant.spell2Id,
                duration: durationLabel,
            });
        }

        const remainder = fields.length % 3;
        if (remainder !== 0) {
            const blanksNeeded = 3 - remainder;
            for (let i = 0; i < blanksNeeded; i++) {
                fields.push({ name: "\u200b", value: "\u200b", inline: true });
            }
        }

        const embed = new EmbedBuilder()
            .setTitle("🎮 Joueurs actuellement en partie")
            .setColor(0x00bfff)
            .addFields(fields)
            .setTimestamp()
            .setFooter({
                text: `${inGame.length}/${players.length} joueur(s) en game`,
            });

        await interaction.editReply({ content: null, embeds: [embed] });


    },
};

// ─── Champion ID → Nom ────────────────────────────────────────────────────────
function getChampionName(championId) {
    const CHAMPION_NAMES = {
        266: "Aatrox", 103: "Ahri", 84: "Akali", 166: "Akshan",
        12: "Alistar", 799: "Ambessa", 32: "Amumu", 34: "Anivia",
        1: "Annie", 523: "Aphelios", 22: "Ashe", 136: "Aurelion Sol",
        893: "Aurora", 268: "Azir", 432: "Bard", 200: "Bel'Veth",
        53: "Blitzcrank", 63: "Brand", 201: "Braum", 233: "Briar",
        51: "Caitlyn", 164: "Camille", 69: "Cassiopeia", 31: "Cho'Gath",
        42: "Corki", 122: "Darius", 131: "Diana", 36: "Dr. Mundo",
        119: "Draven", 245: "Ekko", 60: "Elise", 28: "Evelynn",
        81: "Ezreal", 9: "Fiddlesticks", 114: "Fiora", 105: "Fizz",
        3: "Galio", 41: "Gangplank", 86: "Garen", 150: "Gnar",
        79: "Gragas", 104: "Graves", 887: "Gwen", 120: "Hecarim",
        74: "Heimerdinger", 910: "Hwei", 420: "Illaoi", 39: "Irelia",
        427: "Ivern", 40: "Janna", 59: "Jarvan IV", 24: "Jax",
        126: "Jayce", 202: "Jhin", 222: "Jinx", 145: "Kai'Sa",
        429: "Kalista", 43: "Karma", 30: "Karthus", 38: "Kassadin",
        55: "Katarina", 10: "Kayle", 141: "Kayn", 85: "Kennen",
        121: "Kha'Zix", 203: "Kindred", 240: "Kled", 96: "Kog'Maw",
        897: "K'Sante", 7: "LeBlanc", 64: "Lee Sin", 89: "Leona",
        876: "Lillia", 127: "Lissandra", 236: "Lucian", 117: "Lulu",
        99: "Lux", 54: "Malphite", 90: "Malzahar", 57: "Maokai",
        11: "Master Yi", 902: "Milio", 21: "Miss Fortune", 82: "Mordekaiser",
        25: "Morgana", 950: "Naafiri", 267: "Nami", 75: "Nasus",
        111: "Nautilus", 518: "Neeko", 76: "Nidalee", 895: "Nilah",
        56: "Nocturne", 20: "Nunu & Willump", 2: "Olaf", 61: "Orianna",
        516: "Ornn", 80: "Pantheon", 78: "Poppy", 555: "Pyke",
        246: "Qiyana", 133: "Quinn", 497: "Rakan", 33: "Rammus",
        421: "Rek'Sai", 526: "Rell", 888: "Renata Glasc", 58: "Renekton",
        107: "Rengar", 92: "Riven", 68: "Rumble", 13: "Ryze",
        360: "Samira", 113: "Sejuani", 235: "Senna", 147: "Seraphine",
        875: "Sett", 35: "Shaco", 98: "Shen", 102: "Shyvana",
        27: "Singed", 14: "Sion", 15: "Sivir", 901: "Skarner",
        903: "Smolder", 37: "Sona", 16: "Soraka", 50: "Swain",
        517: "Sylas", 134: "Syndra", 223: "Tahm Kench", 163: "Taliyah",
        91: "Talon", 44: "Taric", 17: "Teemo", 412: "Thresh",
        18: "Tristana", 48: "Trundle", 23: "Tryndamere", 4: "Twisted Fate",
        29: "Twitch", 77: "Udyr", 6: "Urgot", 110: "Varus",
        67: "Vayne", 45: "Veigar", 161: "Vel'Koz", 711: "Vex",
        254: "Vi", 234: "Viego", 112: "Viktor", 8: "Vladimir",
        106: "Volibear", 19: "Warwick", 62: "Wukong", 498: "Xayah",
        101: "Xerath", 5: "Xin Zhao", 157: "Yasuo", 777: "Yone",
        83: "Yorick", 350: "Yuumi", 154: "Zac", 238: "Zed",
        221: "Zeri", 115: "Ziggs", 26: "Zilean", 142: "Zoe",
        143: "Zyra",
    };
    return CHAMPION_NAMES[championId] ?? `Champion#${championId}`;
}
