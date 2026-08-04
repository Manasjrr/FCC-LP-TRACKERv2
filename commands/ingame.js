const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { getActiveGame } = require("../services/riotApiService");
const { getRankEmoji } = require("../utils/rankUtils");
const { getChampionName } = require("../utils/championUtils");
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

const ROLES = ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"];

// ─── ID summoner spell Smite ───────────────────────────────
const SMITE_SPELL_ID = 11;

// ─── Pool de rôles probables par champion ─────────────────────────────────────
const CHAMPION_ROLES = {
    266: { TOP: 0.9, JUNGLE: 0.1 },                    // Aatrox
    103: { MID: 0.85, TOP: 0.15 },                      // Ahri
    84: { MID: 0.7, TOP: 0.3 },                        // Akali
    166: { MID: 0.8, TOP: 0.1 },                        // Akshan
    12: { SUPPORT: 0.9, TOP: 0.1 },                    // Alistar
    32: { JUNGLE: 0.85, SUPPORT: 0.15 },                // Amumu
    34: { MID: 1.0, TOP: 0.2 },                         // Anivia
    1: { MID: 0.6, SUPPORT: 0.2 },                    // Annie
    523: { ADC: 1.0 },                                  // Aphelios
    22: { ADC: 0.9, SUPPORT: 0.1 },                    // Ashe
    136: { MID: 1.0 },                                  // Aurelion Sol
    268: { MID: 1.0 },                                  // Azir
    432: { SUPPORT: 1.0 },                              // Bard
    200: { JUNGLE: 1.0 },                               // Bel'Veth
    53: { SUPPORT: 1 },                                // Blitzcrank
    63: { SUPPORT: 0.5, MID: 0.5, JUNGLE: 0.5 },       // Brand
    201: { SUPPORT: 1.0 },                              // Braum
    233: { JUNGLE: 0.9, TOP: 0.1 },                     // Briar
    51: { ADC: 1.0 },                                  // Caitlyn
    164: { TOP: 1.0, SUPPORT: 0.2 },                   // Camille
    69: { MID: 0.9, TOP: 0.1 },                        // Cassiopeia
    31: { TOP: 0.6, JUNGLE: 0.4 },                     // Cho'Gath
    42: { MID: 0.1, ADC: 0.7 },                        // Corki
    122: { TOP: 1.0 },                                  // Darius
    131: { JUNGLE: 0.5, MID: 0.5 },                     // Diana
    36: { TOP: 0.8, JUNGLE: 0.2 },                     // Dr. Mundo
    119: { ADC: 1.0 },                                  // Draven
    245: { JUNGLE: 0.7, MID: 0.3 },                     // Ekko
    60: { JUNGLE: 0.8, SUPPORT: 0.2 },                 // Elise
    28: { JUNGLE: 1.0 },                               // Evelynn
    81: { ADC: 0.8, MID: 0.05 },                        // Ezreal
    9: { JUNGLE: 0.9, SUPPORT: 0.01 },                 // Fiddlesticks
    114: { TOP: 1.0 },                                  // Fiora
    105: { MID: 0.6, JUNGLE: 0.1 },                     // Fizz
    3: { SUPPORT: 0.5, MID: 0.5 },                    // Galio
    41: { TOP: 1.0 },                                  // Gangplank
    86: { TOP: 1.0 },                                  // Garen
    150: { TOP: 0.8 },                                  // Gnar
    79: { JUNGLE: 0.7, TOP: 0.3, MID: 0.1 },             // Gragas
    104: { JUNGLE: 1.0 },                               // Graves
    887: { TOP: 0.7 },                    // Gwen
    120: { JUNGLE: 1.0 },                               // Hecarim
    74: { MID: 0.01, SUPPORT: 0.5, TOP: 0.2 },                    // Heimerdinger
    910: { MID: 0.8, SUPPORT: 0.2 },                    // Hwei
    420: { TOP: 1.0 },                                  // Illaoi
    39: { TOP: 0.9, MID: 0.25 },                        // Irelia
    427: { JUNGLE: 1.0 },                               // Ivern
    40: { SUPPORT: 1.0 },                              // Janna
    59: { JUNGLE: 0.9, TOP: 0.1 },                     // Jarvan IV
    24: { TOP: 0.75, JUNGLE: 0.3, MID: 0.2 },           // Jax
    126: { MID: 0.2, TOP: 0.6 },                        // Jayce
    202: { ADC: 1.0 },                                  // Jhin
    222: { ADC: 1.0 },                                  // Jinx
    145: { ADC: 1.0 },                                  // Kai'Sa
    429: { ADC: 1.0 },                                  // Kalista
    43: { SUPPORT: 0.8 },                                // Karma
    30: { JUNGLE: 0.5, MID: 0.2, ADC: 0.4 },              // Karthus
    38: { MID: 1.0 },                                 // Kassadin
    55: { MID: 0.8 },                                   // Katarina
    10: { TOP: 0.8 },                                    // Kayle
    141: { JUNGLE: 1.0, TOP: 0.15 },                     // Kayn
    85: { TOP: 0.55, MID: 0.5 },                        // Kennen
    121: { JUNGLE: 1.0 },                               // Kha'Zix
    203: { JUNGLE: 1.0 },                               // Kindred
    240: { TOP: 1.0 },                                  // Kled
    96: { ADC: 1.0 },                                  // Kog'Maw
    897: { TOP: 1.0 },                                  // K'Sante
    7: { MID: 1.0 },                                  // LeBlanc
    64: { JUNGLE: 1.0 },                               // Lee Sin
    89: { SUPPORT: 1.0 },                              // Leona
    876: { JUNGLE: 0.7 },                               // Lillia
    127: { MID: 1.0 },                                  // Lissandra
    236: { ADC: 1.0 },                                  // Lucian
    117: { SUPPORT: 1.0 },                              // Lulu
    99: { MID: 0.6, SUPPORT: 0.4 },                    // Lux
    54: { TOP: 0.7, SUPPORT: 0.3 },                    // Malphite
    90: { MID: 0.8 },                                // Malzahar
    57: { SUPPORT: 0.5, JUNGLE: 0.3, TOP: 0.2 },       // Maokai
    11: { JUNGLE: 0.8, TOP: 0.1, MID: 0.1 },            // Master Yi
    902: { SUPPORT: 1.0 },                              // Milio
    21: { ADC: 1.0 },                                  // Miss Fortune
    82: { TOP: 0.7, MID: 0.02 },                        // Mordekaiser
    25: { SUPPORT: 0.8, MID: 0.02 },                    // Morgana
    950: { MID: 0.6, JUNGLE: 0.8 },                     // Naafiri
    267: { SUPPORT: 1.0 },                              // Nami
    75: { TOP: 1.0, JUNGLE: 0.4 },                      // Nasus
    111: { SUPPORT: 0.7 },                               // Nautilus
    518: { MID: 0.45, SUPPORT: 0.7 },                    // Neeko
    76: { JUNGLE: 1.0, TOP: 0.05, SUPPORT: 0.1 },        // Nidalee
    895: { ADC: 0.7 },                                 // Nilah
    56: { JUNGLE: 1.0 },                               // Nocturne
    20: { JUNGLE: 1.0 },                               // Nunu & Willump
    2: { TOP: 0.7, JUNGLE: 0.3 },                     // Olaf
    61: { MID: 1.0 },                                  // Orianna
    516: { TOP: 1.0 },                                  // Ornn
    80: { SUPPORT: 0.5, JUNGLE: 0.3, TOP: 0.25 },       // Pantheon
    78: { TOP: 0.5, JUNGLE: 0.5, SUPPORT: 0.2 },         // Poppy
    555: { SUPPORT: 0.5 },                               // Pyke
    246: { MID: 0.6, JUNGLE: 0.4 },                     // Qiyana
    133: { TOP: 0.7, SUPPORT: 0.03 },                    // Quinn
    497: { SUPPORT: 1.0 },                              // Rakan
    33: { JUNGLE: 1.0 },                               // Rammus
    421: { JUNGLE: 1.0 },                               // Rek'Sai
    526: { SUPPORT: 1.0 },                              // Rell
    888: { SUPPORT: 1.0 },                              // Renata Glasc
    58: { TOP: 1.0 },                                  // Renekton
    107: { JUNGLE: 1.0 },                               // Rengar
    92: { TOP: 1.0 },                                  // Riven
    68: { TOP: 0.9, MID: 0.4 },                        // Rumble
    13: { MID: 0.8, TOP: 0.3 },                        // Ryze
    360: { ADC: 1.0 },                                  // Samira
    113: { JUNGLE: 1.0 },                               // Sejuani
    235: { SUPPORT: 0.7, ADC: 0.2 },                    // Senna
    147: { SUPPORT: 0.8 },                             // Seraphine
    875: { TOP: 1.0 },                                  // Sett
    35: { JUNGLE: 0.8, SUPPORT: 0.2 },                 // Shaco
    98: { TOP: 1.0, SUPPORT: 0.4, JUNGLE: 0.2 },        // Shen
    102: { JUNGLE: 0.8, TOP: 0.2 },                     // Shyvana
    27: { TOP: 1.0 },                                  // Singed
    14: { TOP: 0.7, SUPPORT: 0.2 },                    // Sion
    15: { ADC: 1.0 },                                  // Sivir
    901: { JUNGLE: 1.0 },                               // Skarner
    903: { ADC: 1.0 },                                  // Smolder
    37: { SUPPORT: 1.0 },                              // Sona
    16: { SUPPORT: 1.0 },                              // Soraka
    50: { MID: 0.2, SUPPORT: 0.5 },                        // Swain
    517: { MID: 0.7, TOP: 0.1 },                        // Sylas
    134: { MID: 1.0 },                                  // Syndra
    223: { TOP: 0.5, SUPPORT: 0.5 },                    // Tahm Kench
    163: { JUNGLE: 0.5, MID: 0.5 },                     // Taliyah
    91: { MID: 1.0 },                                  // Talon
    44: { SUPPORT: 1.0 },                              // Taric
    17: { TOP: 0.75, SUPPORT: 0.2 },                    // Teemo
    412: { SUPPORT: 1.0 },                              // Thresh
    18: { ADC: 1.0 },                                  // Tristana
    48: { TOP: 0.6, JUNGLE: 0.4 },                     // Trundle
    23: { TOP: 1.0 },                                  // Tryndamere
    4: { MID: 0.5, TOP: 0.3, ADC: 0.2 },              // Twisted Fate
    29: { ADC: 0.6 },                                   // Twitch
    77: { JUNGLE: 0.6, TOP: 0.4 },                     // Udyr
    6: { TOP: 1.0 },                                  // Urgot
    110: { ADC: 0.9, MID: 0.1, TOP: 0.1 },               // Varus
    67: { ADC: 1.0, TOP: 0.25 },                         // Vayne
    45: { MID: 0.7, SUPPORT: 0.05 },                    // Veigar
    161: { MID: 0.6, SUPPORT: 0.4 },                    // Vel'Koz
    711: { MID: 1.0 },                                  // Vex
    254: { JUNGLE: 1.0 },                               // Vi
    234: { JUNGLE: 1.0 },                               // Viego
    112: { MID: 1.0 },                                  // Viktor
    8: { MID: 0.5, TOP: 0.5 },                        // Vladimir
    106: { TOP: 0.6, JUNGLE: 0.4 },                     // Volibear
    19: { JUNGLE: 0.8, TOP: 0.2 },                     // Warwick
    62: { TOP: 0.6, JUNGLE: 0.4 },                     // Wukong
    498: { ADC: 1.0 },                                  // Xayah
    101: { MID: 1.0, SUPPORT: 0.2 },                   // Xerath
    5: { JUNGLE: 1.0 },                               // Xin Zhao
    157: { TOP: 0.5, MID: 0.5 },                        // Yasuo
    777: { MID: 0.5, TOP: 0.5 },                        // Yone
    83: { TOP: 0.7, JUNGLE: 0.3 },                     // Yorick
    350: { SUPPORT: 1.0 },                              // Yuumi
    154: { JUNGLE: 1.0 },                               // Zac
    238: { MID: 0.7, JUNGLE: 0.3 },                     // Zed
    221: { ADC: 1.0 },                                  // Zeri
    115: { MID: 0.7, ADC: 0.3 },                        // Ziggs
    26: { SUPPORT: 0.7, MID: 0.3 },                    // Zilean
    142: { MID: 1.0 },                                  // Zoe
    143: { SUPPORT: 0.6, MID: 0.4 },                    // Zyra
    804: { ADC: 1.0 },                                  // Yunara
    799: { TOP: 0.8 },                                   // Ambessa
    904: { TOP: 0.8 },                                   // Zaahen
};

// ─── Génération des permutations (5! = 120) ───────────────────────────────────
function getPermutations(arr) {
    if (arr.length <= 1) return [arr];
    const result = [];
    for (let i = 0; i < arr.length; i++) {
        const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
        for (const perm of getPermutations(rest)) {
            result.push([arr[i], ...perm]);
        }
    }
    return result;
}

// Pré-calcul unique des 120 permutations de rôles (constant, calculé une seule fois)
const ROLE_PERMUTATIONS = getPermutations(ROLES);

// ─── Calcul du score d'un joueur pour un rôle donné ──────────────────────────
// Combine le score champion ET le bonus summoner spell (Smite)
function getRoleScore(participant, role) {
    const champScores = CHAMPION_ROLES[participant.championId] ?? {};
    let score = champScores[role] ?? 0.05;

    const hasSmite =
        participant.spell1Id === SMITE_SPELL_ID ||
        participant.spell2Id === SMITE_SPELL_ID;

    if (hasSmite) {
        // Smite est un signal certain de JUNGLE
        // On booste très fortement ce rôle et on pénalise les autres
        // pour ce joueur, sans totalement écraser le score champion
        if (role === "JUNGLE") {
            score = Math.max(score, 1);
        } else {
            score = score * 0.01; // fortement pénalisé sur les autres rôles
        }
    }

    return score;
}

// ─── Assignation optimale des rôles pour une équipe (5 joueurs) ──────────────
// Recherche exhaustive sur les 120 permutations possibles → garantit l'optimum
// global (contrairement à l'ancien algorithme glouton qui pouvait être sous-optimal
// quand plusieurs champions se disputaient le même rôle fort).
function assignRolesForTeam(participants) {
    if (participants.length !== 5) {
        // Cas limite (ex: partie custom à effectif réduit) → fallback simple
        const assignments = {};
        const usedRoles = new Set();
        for (const p of participants) {
            const best = ROLES
                .filter((r) => !usedRoles.has(r))
                .sort((a, b) => getRoleScore(p, b) - getRoleScore(p, a))[0];
            if (best) {
                assignments[p.puuid] = best;
                usedRoles.add(best);
            }
        }
        return assignments;
    }

    let bestPermutation = null;
    let bestScore = -Infinity;

    for (const perm of ROLE_PERMUTATIONS) {
        let score = 0;
        for (let i = 0; i < participants.length; i++) {
            score += getRoleScore(participants[i], perm[i]);
        }
        if (score > bestScore) {
            bestScore = score;
            bestPermutation = perm;
        }
    }

    const assignments = {};
    participants.forEach((p, i) => {
        assignments[p.puuid] = bestPermutation[i];
    });

    return assignments;
}

function assignRolesForGame(participants) {
    const team1 = participants.filter((p) => p.teamId === 100);
    const team2 = participants.filter((p) => p.teamId === 200);

    return {
        ...assignRolesForTeam(team1),
        ...assignRolesForTeam(team2),
    };
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

setInterval(() => {
    const now = Date.now();
    for (const [key, val] of ingameCache.entries()) {
        if (now - val.timestamp > INGAME_CACHE_TTL * 2) {
            ingameCache.delete(key);
        }
    }
}, 5 * 60 * 1000);

async function getActiveGameCached(puuid) {
    const cached = ingameCache.get(puuid);
    if (cached && Date.now() - cached.timestamp < INGAME_CACHE_TTL) {
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

// ─── Traitement par batch pour paralléliser sans spam l'API ─────────────────
async function processBatch(players, batchSize = 3, delayMs = 200) {
    const results = [];

    for (let i = 0; i < players.length; i += batchSize) {
        const batch = players.slice(i, i + batchSize);

        const batchResults = await Promise.allSettled(
            batch.map((p) =>
                withTimeout(getActiveGameCached(p.puuid), 5_000, p.riot_id)
            )
        );

        batchResults.forEach((result, idx) => {
            const player = batch[idx];
            if (result.status === "fulfilled") {
                results.push({ status: "fulfilled", value: { player, gameData: result.value } });
            } else {
                results.push({ status: "rejected", player, reason: result.reason });
            }
        });

        if (i + batchSize < players.length) {
            await new Promise((r) => setTimeout(r, delayMs));
        }
    }

    return results;
}

// ─── Stats récentes + série depuis la BDD ────────────────────────────────────
function getPlayerRecentStats(playerId) {
    const matches = global.db.prepare(`
        SELECT win FROM match_history
        WHERE player_id = ?
        ORDER BY game_creation DESC
        LIMIT 20
    `).all(playerId);

    if (!matches.length) return { wrLine: null, streakLine: null };

    const total = matches.length;
    const wins = matches.filter((m) => m.win).length;
    const wrLine = `📊 **${Math.round((wins / total) * 100)}%** WR · ${wins}W ${total - wins}L`;

    let streakLine = null;
    if (matches.length >= 2) {
        const first = matches[0].win;
        let count = 0;
        for (const m of matches) {
            if (Boolean(m.win) === Boolean(first)) count++;
            else break;
        }
        if (count >= 2) {
            streakLine = first
                ? `🔥 **${count} victoires** consécutives`
                : `💀 **${count} défaites** consécutives`;
        }
    }

    return { wrLine, streakLine };
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

        if (players.length > 4) {
            await interaction.editReply(
                `🔍 Vérification de ${players.length} joueur(s) en cours...`
            );
        }

        // ── Appels API en parallèle par batch (plus rapide que le séquentiel) ─
        const results = await processBatch(players, 3, 200);

        const fulfilled = results.filter((r) => r.status === "fulfilled");
        const withGame = fulfilled.filter((r) => r.value.gameData !== null);
        const rejected = results.filter((r) => r.status === "rejected");

        if (rejected.length > 0) {
            for (const r of rejected) {
                logger.error("INGAME", `Erreur API pour ${r.player.riot_id}`, {
                    status: r.reason?.response?.status,
                    message: r.reason?.message,
                });
            }
        }

        logger.info("INGAME", `Résultats bruts`, {
            total: results.length,
            fulfilled: fulfilled.length,
            rejected: rejected.length,
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

        if (!inGame.length) {
            const embed = new EmbedBuilder()
                .setTitle("🎮 Joueurs en partie")
                .setDescription("😴 Aucun joueur surveillé n'est actuellement en SoloQ ou Flex.")
                .setColor(0x808080)
                .setTimestamp()
                .setFooter({
                    text: `${players.length} joueur(s) vérifié(s)${rejected.length > 0 ? ` · ⚠️ ${rejected.length} erreur(s) API` : ""}`,
                });

            return interaction.editReply({ content: null, embeds: [embed] });
        }

        // ── Construction des fields ───────────────────────────────────────────
        const fields = [];

        for (let i = 0; i < inGame.length; i++) {
            const { player, gameData } = inGame[i];
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

            // Matching optimal (permutations) + bonus Smite = bien plus fiable
            const roleAssignments = assignRolesForGame(gameData.participants);
            const role = roleAssignments[participant.puuid] ?? "NONE";
            const roleEmoji = ROLE_EMOJIS[role] ?? ROLE_EMOJIS["NONE"];
            const roleLabel = role !== "NONE" ? role : "Inconnu";

            const queueName = QUEUE_NAMES[gameData.gameQueueConfigId] ?? `Queue ${gameData.gameQueueConfigId}`;
            const championName = getChampionName(participant.championId);
            const rankEmoji = getRankEmoji(player.last_rank);

            const rawSeconds = Math.max(0, Math.floor(gameData.gameLength ?? 0));
            const durationLabel = rawSeconds < 60
                ? "🔜 En chargement..."
                : `⏱️ ${formatDuration(rawSeconds)}`;

            const riotIdFormatted = player.riot_id.replace("#", "-").replace(/ /g, "%20");
            const dpmUrl = `https://dpm.lol/${riotIdFormatted}`;

            const { wrLine, streakLine } = getPlayerRecentStats(player.id);

            const lines = [
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
                inline: false,
            });

            if (i < inGame.length - 1) {
                fields.push({
                    name: "─────────────────────",
                    value: "\u200b",
                    inline: false,
                });
            }

            logger.success("INGAME", `${player.riot_id} affiché en game`, {
                queue: queueName,
                champion: championName,
                role: roleLabel,
                duration: durationLabel,
            });
        }

        const embed = new EmbedBuilder()
            .setTitle("🎮 Joueurs actuellement en partie")
            .setColor(0x00bfff)
            .addFields(fields)
            .setTimestamp()
            .setFooter({
                text: `${inGame.length}/${players.length} joueur(s) en game${rejected.length > 0 ? ` · ⚠️ ${rejected.length} erreur(s) API` : ""}`,
            });

        await interaction.editReply({ content: null, embeds: [embed] });
    },
};