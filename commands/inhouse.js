// ─── /inhouse : récap d'une inhouse DPM (fonctionnalité TEMPORAIRE) ──────────
// Embed court (résultat, elo moyen, MVP / ACE) + tableau des scores en image :
// les 10 joueurs avec leur rang SoloQ actuel, KDA, CS, dégâts et note de la game
// (même barème que les notifications Flex). Version texte si l'image échoue.
//
// Rien n'est enregistré en base. Le bouton réutilise un handler existant
// (gamescore_p|), qui fonctionne pour n'importe quel match.
//
// Pourquoi une commande et pas une détection automatique : l'API Riot ne liste
// pas les customs (match-v5 by-puuid) et l'API spectateur ne les voit plus depuis
// le patch 14.1 (RiotGames/developer-relations#884). Seul le détail par ID marche.
//
// SUPPRESSION : effacer ce fichier puis redémarrer le bot. Le déploiement des
// commandes remplace la liste complète → /inhouse disparaît de Discord.
// (Le champ facultatif "rank" de utils/scoreboardUtils.js peut rester.)

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const axios = require("axios");
const FormData = require("form-data");
const { getMatch, getTimeline, getSoloQData } = require("../services/riotApiService");
const { getPatchVersion } = require("../services/monitoringService");
const matchCache = require("../cache/matchCache");
const timelineCache = require("../cache/timelineCache");
const { extractFullMatchStats, isRemakeMatch } = require("../utils/matchStatsUtils");
const { computeGameScore } = require("../utils/ratingUtils");
const { getRankEmoji, getRankOrder } = require("../utils/rankUtils");
const { getChampionName, getChampionIconUrl } = require("../utils/championUtils");
const { buildScoreboardImage } = require("../utils/scoreboardUtils");
const { getDpmUrl } = require("../utils/playerUtils");
const logger = require("../utils/loggers");

const DEFAULT_PLATFORM = "EUW1";
const CUSTOM_QUEUE = 0;
const SCOREBOARD_FILE = "inhouse.png";
const ROLE_ORDER = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];
const ROLE_EMOJIS = { TOP: "🗡️", JUNGLE: "🌿", MIDDLE: "🔮", BOTTOM: "🏹", UTILITY: "🛡️" };
const TEAMS = {
    100: { name: "Équipe bleue", emoji: "🔵", color: 0x3b82f6 },
    200: { name: "Équipe rouge", emoji: "🔴", color: 0xef4444 },
};

// Rangs : nom affiché, abréviation (pastille de l'image) et couleur
const TIERS = {
    IRON:        { name: "Iron",        short: "I",     color: 0x8a8a8a },
    BRONZE:      { name: "Bronze",      short: "B",     color: 0xb0764f },
    SILVER:      { name: "Silver",      short: "S",     color: 0xb4c0cc },
    GOLD:        { name: "Gold",        short: "G",     color: 0xe0b44c },
    PLATINUM:    { name: "Platinum",    short: "P",     color: 0x3fc1b5 },
    EMERALD:     { name: "Emerald",     short: "E",     color: 0x2ecc71 },
    DIAMOND:     { name: "Diamond",     short: "D",     color: 0x6c9cff },
    MASTER:      { name: "Master",      short: "Master", color: 0xc06ee8, apex: true },
    GRANDMASTER: { name: "Grandmaster", short: "GM",    color: 0xff5a5f, apex: true },
    CHALLENGER:  { name: "Challenger",  short: "Chall", color: 0xf4d27a, apex: true },
};
const DIVISION_NUMBERS = { I: 1, II: 2, III: 3, IV: 4 };
const UNRANKED_COLOR = 0x6d717a;
const TIER_BY_ORDER = [null, "IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "EMERALD", "DIAMOND"];
const DIVISION_BY_ORDER = [null, "IV", "III", "II", "I"];
const APEX_BASE = 7 * 400 + 4 * 100 + 100; // même échelle que getRankOrder

// "8053816249", "EUW1_8053816249", "EUW_8053816249" → "EUW1_8053816249"
function normalizeMatchId(input) {
    const digits = input.match(/\d{6,}/)?.[0];
    return digits ? `${DEFAULT_PLATFORM}_${digits}` : null;
}

const formatThousands = (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v}`);

function getRiotId(p) {
    return p.riotIdGameName ? `${p.riotIdGameName}#${p.riotIdTagline}` : p.summonerName || getChampionName(p.championId);
}

// ─── Rang SoloQ ───────────────────────────────────────────────────────────────
// → { label, pill: { text, color }, score } · score : échelle de getRankOrder (elo moyen)
// null si l'appel a échoué
async function getSoloQRank(puuid) {
    try {
        const data = await getSoloQData(puuid);
        if (!data) {
            return { label: `${getRankEmoji("UNRANKED")} Unranked`, pill: { text: "Unranked", color: UNRANKED_COLOR }, score: null };
        }
        const tier = TIERS[data.tier];
        const rank = `${data.tier} ${data.rank}`;
        const lp = data.leaguePoints;
        const short = tier?.apex ? tier.short : `${tier?.short ?? data.tier}${DIVISION_NUMBERS[data.rank] ?? ""}`;
        return {
            label: `${getRankEmoji(rank)} ${tier?.apex ? data.tier : rank} · ${lp} LP`,
            pill: { text: `${short} · ${lp} LP`, color: tier?.color ?? UNRANKED_COLOR },
            score: getRankOrder(rank, lp).totalScore,
        };
    } catch (error) {
        logger.warn("INHOUSE", `Rang SoloQ indisponible`, { status: error.response?.status, error: error.message });
        return null;
    }
}

// Elo moyen d'une équipe (joueurs classés uniquement) → "💎 Diamond III" ou null
function formatAverageElo(scores) {
    const ranked = scores.filter((s) => s != null);
    if (!ranked.length) return null;
    const avg = Math.round(ranked.reduce((a, b) => a + b, 0) / ranked.length);

    if (avg >= APEX_BASE) return `${getRankEmoji("MASTER")} Master+ · ${avg - APEX_BASE} LP`;
    const tierOrder = Math.min(7, Math.max(1, Math.floor(avg / 400)));
    const divisionOrder = Math.min(4, Math.max(1, Math.floor((avg - tierOrder * 400) / 100)));
    const tier = TIER_BY_ORDER[tierOrder];
    return `${getRankEmoji(tier)} ${TIERS[tier].name} ${DIVISION_BY_ORDER[divisionOrder]}`;
}

async function loadTimeline(matchId) {
    const cached = timelineCache.getTimeline(matchId);
    if (cached) return cached;
    try {
        return timelineCache.setTimeline(matchId, await getTimeline(matchId));
    } catch (error) {
        logger.warn("INHOUSE", `Timeline indisponible pour ${matchId}, notes sans stats de lane`, {
            status: error.response?.status,
        });
        return null;
    }
}

// ─── Joueurs suivis du serveur présents dans la game (lecture seule) ─────────
// → Set des puuid. Ils deviennent le "personnage principal" : titre du point de
// vue de leur équipe, équipe affichée en premier, ligne surlignée dans l'image.
function getTrackedPuuids(guildId, participants) {
    if (!global.db || !guildId) return new Set();
    try {
        const puuids = participants.map((p) => p.puuid);
        const rows = global.db.prepare(`
            SELECT DISTINCT p.puuid FROM players p
            JOIN player_guilds pg ON pg.player_id = p.id
            WHERE pg.guild_id = ? AND pg.active = 1
              AND p.puuid IN (${puuids.map(() => "?").join(",")})
        `).all(guildId, ...puuids);
        return new Set(rows.map((r) => r.puuid));
    } catch (error) {
        logger.warn("INHOUSE", `Joueurs suivis illisibles, récap neutre`, { error: error.message });
        return new Set();
    }
}

function joinNames(names) {
    return names.length > 1 ? `${names.slice(0, -1).join(", ")} et ${names.at(-1)}` : names[0];
}

// Équipes dans l'ordre d'affichage : celle des joueurs suivis en premier
function getTeamOrder(game) {
    return game.mainTeamId === 200 ? [200, 100] : [100, 200];
}

// Meilleure note d'une liste de joueurs (null si aucune note)
function getBest(entries) {
    const scored = entries.filter((e) => e.gameScore);
    return scored.length ? scored.reduce((best, e) => (e.gameScore.score > best.gameScore.score ? e : best)) : null;
}

// ─── Embed (résumé ; détail dans l'image) ─────────────────────────────────────
function buildSummaryEmbed(info, matchId, game) {
    const { entries, isRemake, winnerTeamId, mvp, ace } = game;
    const kills = (teamId) => entries.filter((e) => e.participant.teamId === teamId).reduce((s, e) => s + e.participant.kills, 0);
    const endTimestamp = Math.floor((info.gameEndTimestamp ?? info.gameStartTimestamp + info.gameDuration * 1000) / 1000);

    const lines = [
        `-# 🗓️ <t:${endTimestamp}:f> · ⏱️ ${Math.floor(info.gameDuration / 60)} min`,
        `${TEAMS[100].emoji} **${kills(100)}** – **${kills(200)}** ${TEAMS[200].emoji}`,
    ];

    const elos = [100, 200].map((teamId) => formatAverageElo(entries.filter((e) => e.participant.teamId === teamId).map((e) => e.rank?.score)));
    if (elos.some(Boolean)) {
        lines.push(`📈 Elo moyen : ${TEAMS[100].emoji} ${elos[0] ?? "?"}  ·  ${TEAMS[200].emoji} ${elos[1] ?? "?"}`);
    }

    const describe = (label, e) => {
        const riotId = getRiotId(e.participant);
        return `${label} **[${riotId}](${getDpmUrl(riotId)})** · ${getChampionName(e.participant.championId)}`
            + ` · **${e.gameScore.score}**/100 (${e.gameScore.tier.grade})`;
    };
    if (mvp) lines.push(describe("⭐ MVP", mvp));
    if (ace) lines.push(describe("🎖️ ACE", ace));

    // Titre : point de vue des joueurs suivis s'il y en a, sinon neutre (équipe gagnante)
    const trackedNames = joinNames(entries.filter((e) => e.tracked).map((e) => e.participant.riotIdGameName || getRiotId(e.participant)));
    let title, color;
    if (isRemake) {
        title = "⚔️ Inhouse DPM — Remake";
        color = 0x808080;
    } else if (game.faceOff) {
        title = `⚔️ Inhouse DPM — Face-à-face : ${trackedNames}`;
        color = 0xffa500;
    } else if (game.mainTeamId) {
        const win = game.mainTeamId === winnerTeamId;
        title = `⚔️ Inhouse DPM — ${win ? "Victoire" : "Défaite"} de ${trackedNames}`;
        color = win ? 0x2ecc71 : 0xe74c3c;
    } else {
        title = `⚔️ Inhouse DPM — Victoire de l'${TEAMS[winnerTeamId]?.name.toLowerCase() ?? "équipe ?"}`;
        color = TEAMS[winnerTeamId]?.color ?? 0x5865f2;
    }

    return new EmbedBuilder()
        .setTitle(title.slice(0, 256))
        .setDescription(lines.join("\n"))
        .setColor(color)
        .setFooter({ text: `Match ID: ${matchId}` })
        .setTimestamp(endTimestamp * 1000);
}

// ─── Tableau des scores (image) ───────────────────────────────────────────────
async function buildInhouseScoreboard(info, game) {
    const { entries, isRemake, winnerTeamId, mvp, ace } = game;
    const teams = getTeamOrder(game).map((teamId) => ({
        teamId,
        label: TEAMS[teamId].name,
        result: isRemake ? "Remake" : teamId === winnerTeamId ? "Victoire" : "Défaite",
        players: entries
            .filter((e) => e.participant.teamId === teamId)
            .map((e) => ({
                participant: e.participant,
                score: e.gameScore,
                highlight: e.tracked,
                badge: e === mvp ? "MVP" : e === ace ? "ACE" : null,
                rank: e.rank?.pill,
            })),
    }));

    return buildScoreboardImage(teams, {
        patchVersion: getPatchVersion(),
        gameMinutes: info.gameDuration / 60,
        columns: { kda: "KDA", cs: "CS", damage: "Dégâts", score: "Note" },
        fmt: {
            number: (n) => n.toLocaleString("fr-FR"),
            perMin: (n) => `${n.toLocaleString("fr-FR", { maximumFractionDigits: 1 })}/min`,
        },
    });
}

// ─── Version texte (secours si l'image échoue) ───────────────────────────────
function buildPlayerBlock(entry, gameDuration, badges) {
    const { participant: p, rank, gameScore } = entry;
    const kda = p.deaths === 0 ? "Perfect" : ((p.kills + p.assists) / p.deaths).toFixed(1);
    const cs = (p.totalMinionsKilled ?? 0) + (p.neutralMinionsKilled ?? 0);
    const csPerMin = gameDuration > 0 ? (cs / (gameDuration / 60)).toFixed(1) : "0";
    const riotId = getRiotId(p);
    const badge = badges.get(entry);

    const header = `${ROLE_EMOJIS[p.teamPosition] ?? "❓"} ${entry.tracked ? "📌 " : ""}**[${riotId}](${getDpmUrl(riotId)})** · ${getChampionName(p.championId)}`
        + (badge ? ` · **${badge}**` : "");
    const lines = [
        rank?.label ?? "❔ Rang indisponible",
        `⚔️ **${p.kills} / ${p.deaths} / ${p.assists}** · ${kda} KDA`
            + (gameScore ? `  ·  🧮 **${gameScore.score}**/100 (${gameScore.tier.grade})` : ""),
        `🌾 ${cs} CS (${csPerMin}/min) · 💥 ${formatThousands(p.totalDamageDealtToChampions ?? 0)} dégâts`,
    ];
    return [header, ...lines.map((l) => `> ${l}`)].join("\n");
}

function addTextScoreboard(embed, info, game) {
    const badges = new Map([[game.mvp, "⭐ MVP"], [game.ace, "🎖️ ACE"]]);
    const parts = [embed.data.description];
    for (const teamId of getTeamOrder(game)) {
        const result = game.isRemake ? "Remake" : teamId === game.winnerTeamId ? "Victoire 🏆" : "Défaite";
        parts.push(`__**${TEAMS[teamId].emoji} ${TEAMS[teamId].name} — ${result}**__`);
        parts.push(...game.entries
            .filter((e) => e.participant.teamId === teamId)
            .map((e) => buildPlayerBlock(e, info.gameDuration, badges)));
    }
    embed.setDescription(parts.join("\n\n").slice(0, 4096));
    const thumbnail = game.mvp?.participant.championName;
    if (thumbnail) embed.setThumbnail(getChampionIconUrl(thumbnail, getPatchVersion()));
    return embed;
}

// ─── Envoi ────────────────────────────────────────────────────────────────────
// Image envoyée via axios, comme le reste du bot (voir sendFileViaAxios)
async function editReplyWithImage(interaction, embed, components, buffer) {
    const form = new FormData();
    form.append("payload_json", JSON.stringify({
        embeds: [embed.toJSON()],
        components: components.map((row) => row.toJSON()),
        attachments: [{ id: 0, filename: SCOREBOARD_FILE }],
    }));
    form.append("files[0]", buffer, SCOREBOARD_FILE);

    const url = `https://discord.com/api/v10/webhooks/${interaction.client.user.id}/${interaction.token}/messages/@original`;
    return axios.patch(url, form, { headers: form.getHeaders(), timeout: 15000 });
}

// Bouton existant : détail de la note, avec un menu pour les 10 joueurs
function buildButtons(info, matchId, game) {
    if (game.isRemake) return [];
    const focus = (game.mvp ?? game.entries[0]).participant;
    const index = info.participants.findIndex((p) => p.puuid === focus.puuid);
    return [new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`gamescore_p|${matchId}|${index}`)
            .setLabel("🧮 Détail des notes")
            .setStyle(ButtonStyle.Secondary)
    )];
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName("inhouse")
        .setDescription("Récap d'une inhouse DPM : elo SoloQ, champions et notes des 10 joueurs")
        .addStringOption((option) =>
            option
                .setName("match")
                .setDescription("ID du match (ex : EUW1_8053816249 ou 8053816249)")
                .setRequired(true)
        ),

    async execute(interaction) {
        const input = interaction.options.getString("match");
        const matchId = normalizeMatchId(input);
        if (!matchId) {
            return interaction.reply({ content: "❌ ID de match invalide (ex : `EUW1_8053816249`).", flags: MessageFlags.Ephemeral });
        }

        await interaction.deferReply();
        logger.info("INHOUSE", `/inhouse ${matchId} par ${interaction.user.tag}`, { guild: interaction.guildId });

        let info = matchCache.getMatch(matchId);
        if (!info) {
            try {
                info = (await getMatch(matchId)).info;
                matchCache.setMatch(matchId, info);
            } catch (error) {
                const status = error.response?.status;
                logger.warn("INHOUSE", `Match ${matchId} inaccessible`, { status });
                return interaction.editReply({
                    content: status === 404 || status === 403
                        ? `❌ Match \`${matchId}\` introuvable (ID faux, ou game pas encore disponible : réessaie dans quelques minutes).`
                        : `❌ Impossible de récupérer le match \`${matchId}\` (erreur ${status ?? "réseau"}).`,
                });
            }
        }

        // Pas bloquant : on affiche quand même, mais on garde une trace si ce n'est pas une custom
        if (info.queueId !== CUSTOM_QUEUE) {
            logger.warn("INHOUSE", `${matchId} n'est pas une custom (file ${info.queueId})`);
        }

        const isRemake = isRemakeMatch(info);
        // Timeline : écarts à 15 min et dragons utilisés par la note (inutile sur un remake)
        const timeline = isRemake ? null : await loadTimeline(matchId);
        const ranks = await Promise.all(info.participants.map((p) => getSoloQRank(p.puuid)));

        const roleIndex = (p) => {
            const i = ROLE_ORDER.indexOf(p.teamPosition);
            return i === -1 ? ROLE_ORDER.length : i;
        };
        const tracked = getTrackedPuuids(interaction.guildId, info.participants);
        const entries = info.participants
            .map((participant, i) => ({
                participant,
                tracked: tracked.has(participant.puuid),
                rank: ranks[i],
                gameScore: isRemake ? null : computeGameScore(extractFullMatchStats(info, participant, timeline)),
            }))
            .sort((a, b) => roleIndex(a.participant) - roleIndex(b.participant));

        const winnerTeamId = info.teams.find((t) => t.win)?.teamId;
        // Équipe(s) des joueurs suivis : une seule → personnage principal, deux → face-à-face
        const trackedTeams = [...new Set(entries.filter((e) => e.tracked).map((e) => e.participant.teamId))];
        const game = {
            entries,
            isRemake,
            winnerTeamId,
            mainTeamId: trackedTeams.length === 1 ? trackedTeams[0] : null,
            faceOff: trackedTeams.length > 1,
            mvp: isRemake ? null : getBest(entries.filter((e) => e.participant.teamId === winnerTeamId)),
            ace: isRemake ? null : getBest(entries.filter((e) => e.participant.teamId !== winnerTeamId)),
        };

        const embed = buildSummaryEmbed(info, matchId, game);
        const components = buildButtons(info, matchId, game);

        try {
            const buffer = await buildInhouseScoreboard(info, game);
            embed.setImage(`attachment://${SCOREBOARD_FILE}`);
            await editReplyWithImage(interaction, embed, components, buffer);
        } catch (error) {
            logger.warn("INHOUSE", `Image impossible pour ${matchId}, envoi en texte`, {
                error: error.message,
                status: error.response?.status,
            });
            embed.setImage(null);
            await interaction.editReply({ embeds: [addTextScoreboard(embed, info, game)], components });
        }

        logger.success("INHOUSE", `Récap inhouse envoyé pour ${matchId}`, { guild: interaction.guildId });
    },
};
