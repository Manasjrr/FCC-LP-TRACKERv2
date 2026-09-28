const { EmbedBuilder } = require("discord.js");
const { CONFIDENT_GAMES, ROLE_LABELS, CATEGORY_LABELS, formatEvolution } = require("../utils/ratingUtils");

// ─── Helpers d'affichage ──────────────────────────────────────────────────────
function progressBar(ratio, size = 10) {
    const filled = Math.round(Math.max(0, Math.min(1, ratio)) * size);
    return "▰".repeat(filled) + "▱".repeat(size - filled);
}

const pts = (value, max) => `${value.toFixed(1)}/${max}`;

// ─── Fiche de note d'un joueur ────────────────────────────────────────────────
// rating = computePlayerRating(), ranking = { position, total } sur le serveur
// evolutions = [getRatingEvolution(...)] (7 jours, 30 jours...) — facultatif
function buildRatingEmbed(player, rating, ranking, evolutions = []) {
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
        evolutions?.length
            ? `📊 Évolution : ${evolutions.map((e) => `${formatEvolution(e)} *(${e.past} → ${e.current})*`).join(" · ")}`
            : null,
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
    const lastGamesText = form.lastGames.map((w) => (w ? "🟢" : "🔴")).join("");
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
                value:
                    `${lastGamesText}\n` +
                    `**${Math.round(form.winrate * 100)}%** sur les ${form.lastGames.length} dernières\n` +
                    streakText,
                inline: true,
            }
        )
        .setTimestamp();

    return embed;
}

// ─── Détail de la note d'une game (barème + points perdus) ───────────────────
// details = getGameScoreDetails(), match = ligne match_history
function buildGameScoreEmbed(details, match, riotId) {
    const fmtPts = (v) => v.toFixed(1);
    const icon = (score) => (score >= 1 ? "✅" : score >= 0.5 ? "🟡" : "🔴");

    // Valeur / barème affichés (le Héraut est un oui / non sur une game)
    const describe = (m) => {
        if (m.metric === "team_heralds") {
            return `**${m.score >= 1 ? "Pris" : "Non pris"}** · barème : pris = 100%`;
        }
        return `**${m.display}** · barème ${m.min} → ${m.target}`;
    };

    const embed = new EmbedBuilder()
        .setTitle(`🧮 Note de la game — ${details.score}/100 (${details.tier.grade})`)
        .setDescription(
            `**${riotId}** · ${match.champion_name} · ${details.roleLabel}\n` +
            `*Chaque stat rapporte des points entre son min (0%) et son objectif (100%).*`
        )
        .setColor(details.tier.color);

    for (const category of details.categories) {
        if (!category.available) {
            embed.addFields({
                name: `${category.label} — non comptée`,
                value: category.category === "lane"
                    ? "*Stats à 15 min indisponibles (game < 15 min ou timeline manquante)*"
                    : "*Données indisponibles pour cette game*",
                inline: false,
            });
            continue;
        }

        const lines = category.metrics.map((m) => {
            if (m.score == null) return `➖ ${m.label} : *non disponible*`;
            const lost = m.max - m.points;
            return `${icon(m.score)} ${m.label} : ${describe(m)} → **${fmtPts(m.points)}/${fmtPts(m.max)}**` +
                (lost >= 0.05 ? ` *(−${fmtPts(lost)})*` : "");
        });

        embed.addFields({
            name: `${category.label} — ${fmtPts(category.points)}/${fmtPts(category.max)} pts`,
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
            ? `📉 **Points perdus surtout sur :** ${biggestLosses.map((m) => `${m.label} (−${fmtPts(m.max - m.points)})`).join(", ")}`
            : "🌟 **Presque tous les points obtenus !**",
        details.multiplier !== 1
            ? `🧾 Total : ${fmtPts(details.rawPoints)}/100 × ${details.multiplier} (malus ${details.roleLabel}) = **${details.score}/100**`
            : `🧾 Total : **${details.score}/100**`,
    ];
    embed.addFields({ name: "📌 Résumé", value: summary.join("\n"), inline: false });

    return embed;
}

module.exports = { buildRatingEmbed, buildGameScoreEmbed };
