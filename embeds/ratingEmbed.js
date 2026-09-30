const { EmbedBuilder } = require("discord.js");
const {
    CONFIDENT_GAMES,
    formatEvolution,
    getTierLabel,
    getRoleLabel,
    getCategoryLabel,
    getMetricLabel,
} = require("../utils/ratingUtils");

// ─── Helpers d'affichage ──────────────────────────────────────────────────────
function progressBar(ratio, size = 10) {
    const filled = Math.round(Math.max(0, Math.min(1, ratio)) * size);
    return "▰".repeat(filled) + "▱".repeat(size - filled);
}

const pts = (value, max) => `${value.toFixed(1)}/${max}`;

// ─── Fiche de note d'un joueur ────────────────────────────────────────────────
// rating = computePlayerRating(), ranking = { position, total } sur le serveur
// evolutions = [getRatingEvolution(...)] (7 jours, 30 jours...) — facultatif
// tr = traducteur i18n (langue du serveur)
function buildRatingEmbed(player, rating, ranking, evolutions = [], tr) {
    const { tier, performance, results, form } = rating;
    const mainRoleLabel = getRoleLabel(rating.mainRole, tr);
    const mainRoleGames = rating.roleCounts[rating.mainRole] ?? 0;

    const roleDistribution = Object.entries(rating.roleCounts)
        .filter(([role]) => role !== "DEFAULT")
        .sort((a, b) => b[1] - a[1])
        .map(([role, count]) => `${getRoleLabel(role, tr)} ${count}`)
        .join(" · ");

    const description = [
        `## ${getTierLabel(tier, tr)} — **${rating.score}/100** (${tier.grade})`,
        ranking?.position ? tr("rating.serverRank", { position: ranking.position, total: ranking.total }) : null,
        evolutions?.length
            ? tr("rating.evolutionLine", {
                list: evolutions.map((e) => `${formatEvolution(e, tr)} *(${e.past} → ${e.current})*`).join(" · "),
            })
            : null,
        rating.mainRole !== "DEFAULT"
            ? tr("rating.mainRole", { role: mainRoleLabel, count: mainRoleGames }) +
              (roleDistribution && Object.keys(rating.roleCounts).length > 1 ? `\n└ ${roleDistribution}` : "")
            : tr("rating.mainRoleUnknown"),
        tr("rating.gamesAnalyzed", { count: rating.games }) +
            (rating.detailedGames < rating.games ? tr("rating.detailedGames", { count: rating.detailedGames }) : ""),
        rating.provisional
            ? tr("rating.provisional", { min: CONFIDENT_GAMES, raw: rating.rawScore })
            : null,
    ].filter(Boolean).join("\n");

    // ── Performance en jeu ────────────────────────────────────────────────────
    const categoryLines = Object.entries(performance.categories).map(([category, ratio]) =>
        `${getCategoryLabel(category, tr)} ${progressBar(ratio)} **${Math.round(ratio * 100)}%**`
    );

    // ── Détail des stats ──────────────────────────────────────────────────────
    const metricLines = performance.metrics.map((m) =>
        `${progressBar(m.score, 5)} ${getMetricLabel(m.metric, tr)} : **${m.display}** ${tr("rating.target", { target: m.target })}`
    );

    // ── Résultats & forme ─────────────────────────────────────────────────────
    const avgLpText = `${results.avgLp >= 0 ? "+" : ""}${results.avgLp.toFixed(1)}`;
    const lastGamesText = form.lastGames.map((w) => (w ? "🟢" : "🔴")).join("");
    const streakText = form.streak >= 2
        ? form.streakType === "win"
            ? `🔥 ${tr("common.winsInARow", { count: form.streak })}`
            : `💀 ${tr("common.lossesInARow", { count: form.streak })}`
        : tr("rating.noStreak");

    const embed = new EmbedBuilder()
        .setTitle(tr("rating.title", { riotId: player.riot_id }))
        .setDescription(description)
        .setColor(tier.color)
        .addFields(
            {
                name: tr("rating.performance", { points: pts(performance.points, performance.max) }),
                value: categoryLines.join("\n") || tr("rating.noData"),
                inline: false,
            },
            {
                name: tr("rating.statsDetail") + (rating.mainRole !== "DEFAULT" ? ` (${mainRoleLabel})` : ""),
                value: metricLines.join("\n") || tr("rating.noData"),
                inline: false,
            },
            {
                name: tr("rating.results", { points: pts(results.points, results.max) }),
                value:
                    tr("rating.winrateLine", {
                        winrate: Math.round(results.winrate * 100),
                        wins: results.wins,
                        losses: results.losses,
                        points: pts(results.winratePoints, results.winrateMax),
                    }) + "\n" +
                    tr("rating.avgLpLine", { lp: avgLpText, points: pts(results.lpPoints, results.lpMax) }),
                inline: true,
            },
            {
                name: tr("rating.form", { points: pts(form.points, form.max) }),
                value:
                    `${lastGamesText}\n` +
                    tr("rating.formWinrate", { winrate: Math.round(form.winrate * 100), count: form.lastGames.length }) + "\n" +
                    streakText,
                inline: true,
            }
        )
        .setTimestamp();

    return embed;
}

// ─── Détail de la note d'une game (barème + points perdus) ───────────────────
// details = getGameScoreDetails(), match = ligne match_history
function buildGameScoreEmbed(details, match, riotId, tr) {
    const fmtPts = (v) => v.toFixed(1);
    const icon = (score) => (score >= 1 ? "✅" : score >= 0.5 ? "🟡" : "🔴");
    const roleLabel = getRoleLabel(details.role, tr);
    const metricLabel = (m) => getMetricLabel(m.metric, tr);

    // Valeur / barème affichés (le Héraut est un oui / non sur une game)
    const describe = (m) => {
        if (m.metric === "team_heralds") {
            return `**${tr(m.score >= 1 ? "rating.heraldTaken" : "rating.heraldNotTaken")}** · ${tr("rating.heraldScale")}`;
        }
        return `**${m.display}** · ${tr("rating.scale", { min: m.min, target: m.target })}`;
    };

    const embed = new EmbedBuilder()
        .setTitle(tr("rating.gameTitle", { score: details.score, grade: details.tier.grade }))
        .setDescription(
            `**${riotId}** · ${match.champion_name} · ${roleLabel}\n` +
            tr("rating.gameExplanation")
        )
        .setColor(details.tier.color);

    for (const category of details.categories) {
        const categoryLabel = getCategoryLabel(category.category, tr);

        if (!category.available) {
            embed.addFields({
                name: tr("rating.notCounted", { label: categoryLabel }),
                value: tr(category.category === "lane" ? "rating.laneUnavailable" : "rating.dataUnavailable"),
                inline: false,
            });
            continue;
        }

        const lines = category.metrics.map((m) => {
            if (m.score == null) return `➖ ${metricLabel(m)} : ${tr("rating.metricUnavailable")}`;
            const lost = m.max - m.points;
            return `${icon(m.score)} ${metricLabel(m)} : ${describe(m)} → **${fmtPts(m.points)}/${fmtPts(m.max)}**` +
                (lost >= 0.05 ? ` *(−${fmtPts(lost)})*` : "");
        });

        embed.addFields({
            name: `${categoryLabel} — ${fmtPts(category.points)}/${fmtPts(category.max)} pts`,
            value: lines.join("\n"),
            inline: false,
        });
    }

    // Stats où le joueur a perdu le plus de points
    const biggestLosses = details.categories
        .flatMap((c) => c.metrics)
        .filter((m) => m.score != null && m.max - m.points >= 0.5)
        .sort((a, b) => (b.max - b.points) - (a.max - a.points))
        .slice(0, 3);

    const summary = [
        biggestLosses.length
            ? tr("rating.pointsLostOn", {
                list: biggestLosses.map((m) => `${metricLabel(m)} (−${fmtPts(m.max - m.points)})`).join(", "),
            })
            : tr("rating.almostAll"),
        details.multiplier !== 1
            ? tr("rating.totalWithMalus", {
                raw: fmtPts(details.rawPoints),
                multiplier: details.multiplier,
                role: roleLabel,
                score: details.score,
            })
            : tr("rating.total", { score: details.score }),
    ];
    embed.addFields({ name: tr("rating.summary"), value: summary.join("\n"), inline: false });

    return embed;
}

module.exports = { buildRatingEmbed, buildGameScoreEmbed };
