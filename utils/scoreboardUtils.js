const { createCanvas } = require("canvas");
const { getChampionIcon, roundedRectPath, TEAM_COLORS } = require("./thumbnailUtils");
const { getChampionName } = require("./championUtils");

// ─── Tableau des scores d'une game (image) ───────────────────────────────────
// Icônes : Data Dragon (mises en cache) → aucun appel à l'API Riot.
// Discord réduit les images d'embed (~500 px de large) : tailles de texte
// choisies pour rester lisibles une fois l'image réduite de moitié.
//
// teams = [{ label, result, players: [row] }] (équipe du joueur en premier)
// row = { participant, score: { score, tier } | null, highlight, badge: "MVP" | "ACE" | null }
// columns = { kda, cs, damage, score } (libellés traduits), fmt = { number, perMin }

const W = 1000;
const PAD = 24;
const TEAM_HEADER_H = 46;
const ROW_H = 72;
const TEAM_GAP = 18;
const ICON = 52;

// Colonnes (x de départ)
const COL = {
    icon: PAD + 16,
    name: PAD + 84,
    kda: 390,
    cs: 548,
    damage: 670,
};
const DAMAGE_BAR_W = 150;
const BADGE_W = 100;
const BADGE_H = 48;
const BADGE_X = W - PAD - 16 - BADGE_W;

const COLORS = {
    background: "#1e1f22",
    card: "#2b2d31",
    text: "#f2f3f5",
    muted: "#949ba4",
    line: "rgba(255, 255, 255, 0.06)",
    highlight: "rgba(200, 170, 110, 0.13)",
    gold: "#c8aa6e",
    barTrack: "rgba(255, 255, 255, 0.08)",
};

const hex = (color) => `#${color.toString(16).padStart(6, "0")}`;
const rgba = (color, alpha) => `rgba(${(color >> 16) & 255}, ${(color >> 8) & 255}, ${color & 255}, ${alpha})`;

// Le canvas n'a pas toujours les espaces insécables (séparateur de milliers en français)
const clean = (text) => String(text).replace(/[  ]/g, " ");

function fitText(ctx, text, maxWidth) {
    text = clean(text);
    if (ctx.measureText(text).width <= maxWidth) return text;
    while (text.length > 1 && ctx.measureText(`${text}…`).width > maxWidth) text = text.slice(0, -1);
    return `${text}…`;
}

function drawText(ctx, text, x, y, { font, color = COLORS.text, align = "left" }) {
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(clean(text), x, y);
}

// ── Icône du champion + niveau ────────────────────────────────────────────────
function drawChampion(ctx, icon, participant, x, y) {
    ctx.save();
    roundedRectPath(ctx, x, y, ICON, ICON, 10);
    ctx.clip();
    if (icon) {
        ctx.drawImage(icon, x, y, ICON, ICON);
    } else {
        // Icône indisponible : initiales du champion
        ctx.fillStyle = "#3f4147";
        ctx.fillRect(x, y, ICON, ICON);
        drawText(ctx, getChampionName(participant.championId).slice(0, 2), x + ICON / 2, y + ICON / 2 + 7, {
            font: "bold 20px Arial, sans-serif", color: COLORS.muted, align: "center",
        });
    }
    ctx.restore();

    const cx = x + ICON - 2;
    const cy = y + ICON - 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 13, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.background;
    ctx.fill();
    drawText(ctx, participant.champLevel ?? "", cx, cy + 5, {
        font: "bold 14px Arial, sans-serif", align: "center",
    });
}

// ── Note de la game ───────────────────────────────────────────────────────────
function drawScoreBadge(ctx, score, x, y) {
    roundedRectPath(ctx, x, y, BADGE_W, BADGE_H, 10);
    if (!score) {
        ctx.fillStyle = COLORS.barTrack;
        ctx.fill();
        drawText(ctx, "—", x + BADGE_W / 2, y + 32, { font: "bold 24px Arial, sans-serif", color: COLORS.muted, align: "center" });
        return;
    }

    const { color, grade } = score.tier;
    ctx.fillStyle = rgba(color, 0.16);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = rgba(color, 0.9);
    ctx.stroke();

    drawText(ctx, score.score, x + 16, y + 33, { font: "bold 26px Arial, sans-serif", color: hex(color) });
    drawText(ctx, grade, x + BADGE_W - 14, y + 32, { font: "bold 19px Arial, sans-serif", color: hex(color), align: "right" });
}

// ── Pastille MVP / ACE ────────────────────────────────────────────────────────
function drawBadge(ctx, text, x, y) {
    ctx.font = "bold 13px Arial, sans-serif";
    const w = ctx.measureText(text).width + 14;
    roundedRectPath(ctx, x, y - 15, w, 20, 6);
    ctx.fillStyle = text === "MVP" ? COLORS.gold : "#8e9297";
    ctx.fill();
    drawText(ctx, text, x + w / 2, y, { font: "bold 13px Arial, sans-serif", color: COLORS.background, align: "center" });
}

// ── Ligne d'un joueur ─────────────────────────────────────────────────────────
function drawPlayerRow(ctx, row, icon, y, { teamColor, maxDamage, gameMinutes, fmt, isLast }) {
    const p = row.participant;

    if (row.highlight) {
        ctx.fillStyle = COLORS.highlight;
        ctx.fillRect(PAD, y, W - 2 * PAD, ROW_H);
        ctx.fillStyle = COLORS.gold;
        ctx.fillRect(PAD, y, 4, ROW_H);
    }
    if (!isLast) {
        ctx.fillStyle = COLORS.line;
        ctx.fillRect(PAD + 12, y + ROW_H - 1, W - 2 * PAD - 24, 1);
    }

    const top = y + 31;    // ligne principale
    const bottom = y + 56; // ligne secondaire

    drawChampion(ctx, icon, p, COL.icon, y + (ROW_H - ICON) / 2);

    // Pseudo + champion
    const name = p.riotIdGameName || p.summonerName || getChampionName(p.championId);
    ctx.font = "bold 21px Arial, sans-serif";
    const nameText = fitText(ctx, name, COL.kda - COL.name - (row.badge ? 70 : 16));
    drawText(ctx, nameText, COL.name, top, { font: "bold 21px Arial, sans-serif", color: row.highlight ? COLORS.gold : COLORS.text });
    if (row.badge) drawBadge(ctx, row.badge, COL.name + ctx.measureText(nameText).width + 10, top - 1);
    drawText(ctx, getChampionName(p.championId), COL.name, bottom, { font: "17px Arial, sans-serif", color: COLORS.muted });

    // KDA
    const ratio = p.deaths === 0 ? "Perfect" : ((p.kills + p.assists) / p.deaths).toFixed(2);
    drawText(ctx, `${p.kills} / ${p.deaths} / ${p.assists}`, COL.kda, top, { font: "bold 21px Arial, sans-serif" });
    drawText(ctx, `${ratio} KDA`, COL.kda, bottom, { font: "17px Arial, sans-serif", color: COLORS.muted });

    // CS
    const cs = (p.totalMinionsKilled ?? 0) + (p.neutralMinionsKilled ?? 0);
    drawText(ctx, cs, COL.cs, top, { font: "bold 21px Arial, sans-serif" });
    drawText(ctx, fmt.perMin(gameMinutes ? cs / gameMinutes : 0), COL.cs, bottom, { font: "17px Arial, sans-serif", color: COLORS.muted });

    // Dégâts + barre (relative au max de la game)
    const damage = p.totalDamageDealtToChampions ?? 0;
    drawText(ctx, fmt.number(damage), COL.damage, top, { font: "bold 21px Arial, sans-serif" });
    roundedRectPath(ctx, COL.damage, bottom - 11, DAMAGE_BAR_W, 8, 4);
    ctx.fillStyle = COLORS.barTrack;
    ctx.fill();
    const barW = maxDamage ? Math.max(8, (damage / maxDamage) * DAMAGE_BAR_W) : 0;
    if (barW) {
        roundedRectPath(ctx, COL.damage, bottom - 11, barW, 8, 4);
        ctx.fillStyle = teamColor;
        ctx.fill();
    }

    drawScoreBadge(ctx, row.score, BADGE_X, y + (ROW_H - BADGE_H) / 2);
}

// ── Bloc d'une équipe ─────────────────────────────────────────────────────────
function drawTeam(ctx, team, icons, y, options) {
    const height = TEAM_HEADER_H + team.players.length * ROW_H;
    const teamColor = TEAM_COLORS[team.teamId] ?? COLORS.muted;

    roundedRectPath(ctx, PAD, y, W - 2 * PAD, height, 14);
    ctx.fillStyle = COLORS.card;
    ctx.fill();

    // En-tête : équipe + résultat, libellés des colonnes
    ctx.save();
    roundedRectPath(ctx, PAD, y, W - 2 * PAD, height, 14);
    ctx.clip();
    ctx.fillStyle = teamColor;
    ctx.fillRect(PAD, y, W - 2 * PAD, 4);
    ctx.restore();

    const headerY = y + 31;
    drawText(ctx, team.label.toUpperCase(), COL.icon, headerY, { font: "bold 17px Arial, sans-serif", color: teamColor });
    ctx.font = "bold 17px Arial, sans-serif";
    const labelW = ctx.measureText(clean(team.label.toUpperCase())).width;
    drawText(ctx, `·  ${team.result}`, COL.icon + labelW + 10, headerY, { font: "17px Arial, sans-serif", color: COLORS.muted });

    const columnFont = { font: "bold 14px Arial, sans-serif", color: COLORS.muted };
    drawText(ctx, options.columns.kda.toUpperCase(), COL.kda, headerY, columnFont);
    drawText(ctx, options.columns.cs.toUpperCase(), COL.cs, headerY, columnFont);
    drawText(ctx, options.columns.damage.toUpperCase(), COL.damage, headerY, columnFont);
    drawText(ctx, options.columns.score.toUpperCase(), BADGE_X + BADGE_W / 2, headerY, { ...columnFont, align: "center" });

    team.players.forEach((row, i) => {
        drawPlayerRow(ctx, row, icons.get(row.participant.championName), y + TEAM_HEADER_H + i * ROW_H, {
            ...options,
            teamColor,
            isLast: i === team.players.length - 1,
        });
    });

    return height;
}

async function buildScoreboardImage(teams, { patchVersion, gameMinutes, columns, fmt }) {
    // Icônes en parallèle ; une icône manquante n'empêche pas l'image
    const names = [...new Set(teams.flatMap((t) => t.players.map((r) => r.participant.championName)))];
    const loaded = await Promise.all(names.map((n) => getChampionIcon(n, patchVersion).catch(() => null)));
    const icons = new Map(names.map((n, i) => [n, loaded[i]]));

    const maxDamage = Math.max(0, ...teams.flatMap((t) => t.players.map((r) => r.participant.totalDamageDealtToChampions ?? 0)));

    const height = PAD * 2
        + teams.reduce((sum, t) => sum + TEAM_HEADER_H + t.players.length * ROW_H, 0)
        + TEAM_GAP * (teams.length - 1);

    const canvas = createCanvas(W, height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, W, height);

    let y = PAD;
    for (const team of teams) {
        y += drawTeam(ctx, team, icons, y, { maxDamage, gameMinutes, columns, fmt }) + TEAM_GAP;
    }

    return canvas.toBuffer("image/png");
}

module.exports = { buildScoreboardImage };
