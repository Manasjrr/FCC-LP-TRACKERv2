const { EmbedBuilder } = require("discord.js");
const { CONFIDENT_GAMES, ROLE_LABELS, CATEGORY_LABELS } = require("../utils/ratingUtils");

// ─── Helpers d'affichage ──────────────────────────────────────────────────────
function progressBar(ratio, size = 10) {
    const filled = Math.round(Math.max(0, Math.min(1, ratio)) * size);
    return "▰".repeat(filled) + "▱".repeat(size - filled);
}

const pts = (value, max) => `${value.toFixed(1)}/${max}`;

// ─── Fiche de note d'un joueur ────────────────────────────────────────────────
// rating = computePlayerRating(), ranking = { position, total } sur le serveur
function buildRatingEmbed(player, rating, ranking) {
    const { tier, performance, results, form } = rating;
    const mainRoleLabel = ROLE_LABELS[rating.mainRole];
    const mainRoleGames = rating.roleCounts[rating.mainRole] ?? 0;

    const roleDistribution = Object.entries(rating.roleCounts)
        .filter(([role]) => role !== "DEFAULT")
        .sort((a, b) => b[1] - a[1])
        .map(([role, count]) => `${ROLE_LABELS[role]} ${count}`)
        .join(" · ");

    const description = [
        `## ${tier.label} — **${rating.score}/100** (${tier.grade})`,
        ranking?.position ? `🏅 **#${ranking.position}** / ${ranking.total} au classement des notes du serveur` : null,
        rating.mainRole !== "DEFAULT"
            ? `🎭 Rôle principal : **${mainRoleLabel}** (${mainRoleGames} game${mainRoleGames > 1 ? "s" : ""})` +
              (roleDistribution && Object.keys(rating.roleCounts).length > 1 ? `\n└ ${roleDistribution}` : "")
            : `🎭 Rôle principal : *inconnu (anciennes games sans stats détaillées)*`,
        `🎯 ${rating.games} game${rating.games > 1 ? "s" : ""} analysée${rating.games > 1 ? "s" : ""}` +
            (rating.detailedGames < rating.games ? ` (${rating.detailedGames} avec stats détaillées)` : ""),
        rating.provisional
            ? `⚠️ *Note provisoire : moins de ${CONFIDENT_GAMES} games, elle est ramenée vers 50 (note brute : ${rating.rawScore}/100)*`
            : null,
    ].filter(Boolean).join("\n");

    // ── Performance en jeu ────────────────────────────────────────────────────
    const categoryLines = Object.entries(performance.categories).map(([category, ratio]) =>
        `${CATEGORY_LABELS[category]} ${progressBar(ratio)} **${Math.round(ratio * 100)}%**`
    );

    // ── Détail des stats ──────────────────────────────────────────────────────
    const metricLines = performance.metrics.map((m) =>
        `${progressBar(m.score, 5)} ${m.label} : **${m.display}** *(objectif ${m.target})*`
    );

    // ── Résultats & forme ─────────────────────────────────────────────────────
    const avgLpText = `${results.avgLp >= 0 ? "+" : ""}${results.avgLp.toFixed(1)}`;
    const last5Text = form.last5.map((w) => (w ? "🟢" : "🔴")).join("");
    const streakText = form.streak >= 2
        ? `${form.streakType === "win" ? "🔥" : "💀"} ${form.streak} ${form.streakType === "win" ? "victoires" : "défaites"} d'affilée`
        : "➖ Pas de série";

    const embed = new EmbedBuilder()
        .setTitle(`🧮 Note de ${player.riot_id}`)
        .setDescription(description)
        .setColor(tier.color)
        .addFields(
            {
                name: `🎮 Performance en jeu — ${pts(performance.points, performance.max)}`,
                value: categoryLines.join("\n") || "Aucune donnée",
                inline: false,
            },
            {
                name: `📊 Détail des stats${rating.mainRole !== "DEFAULT" ? ` (${mainRoleLabel})` : ""}`,
                value: metricLines.join("\n") || "Aucune donnée",
                inline: false,
            },
            {
                name: `🏆 Résultats — ${pts(results.points, results.max)}`,
                value:
                    `Winrate **${Math.round(results.winrate * 100)}%** (${results.wins}W-${results.losses}L) → ${pts(results.winratePoints, 20)}\n` +
                    `LP moyen **${avgLpText}**/game → ${pts(results.lpPoints, 10)}`,
                inline: true,
            },
            {
                name: `🔥 Forme — ${pts(form.points, form.max)}`,
                value: `${last5Text}\n${streakText}`,
                inline: true,
            }
        )
        .setTimestamp();

    return embed;
}

module.exports = { buildRatingEmbed };
