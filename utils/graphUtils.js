// lp-graph.js — générateur de graphique ELO style moderne
const { createCanvas } = require('canvas');
const logger = require("./loggers");

// ─── CONFIG ─────────────────────────────────────────────────────────────────

const PALETTE = {
    bg: '#0d0d0f',
    bgCard: '#111114',
    gridLine: 'rgba(255,255,255,0.10)',
    textMuted: 'rgba(255,255,255,0.35)',
    textDim: 'rgba(255,255,255,0.55)',
    win: '#22c55e',
    loss: '#ef4444',
    white: '#ffffff',
};

const TIERS = [
    { name: 'Iron', base: 0, line: '#CD853F', bg: '139,111,71' },
    { name: 'Bronze', base: 400, line: '#CD853F', bg: '205,133,63' },
    { name: 'Silver', base: 800, line: '#C0C0C0', bg: '192,192,192' },
    { name: 'Gold', base: 1200, line: '#FFD700', bg: '255,215,0' },
    { name: 'Platinum', base: 1600, line: '#00CED1', bg: '0,206,209' },
    { name: 'Emerald', base: 2000, line: '#50C878', bg: '80,200,120' },
    { name: 'Diamond', base: 2400, line: '#B9F2FF', bg: '100,149,237' },
    { name: 'Master', base: 2800, line: '#DA70D6', bg: '138,43,226' },
    { name: 'Grandmaster', base: 3200, line: '#FF4500', bg: '220,20,60' },
    { name: 'Challenger', base: 3600, line: '#FFD700', bg: '255,215,0' },
];

const DIVS = ['IV', 'III', 'II', 'I'];
const PAD = { top: 56, right: 48, bottom: 72, left: 130 };
const W = 600;
const H = 300;

const MIN_POINTS = 2;
const BIG_SWING_LP = 20;
const DEFAULT_QUALITY = 0.9;
const DEFAULT_RENDER_SCALE = 3; // 2x = rendu "retina", texte/traits nets sur Discord

// ─── HELPERS LP ─────────────────────────────────────────────────────────────

function rankToLP(rankStr, lp = 0) {
    if (!rankStr || rankStr === 'UNRANKED') return 0;
    const [tierRaw, divRaw] = rankStr.toLowerCase().split(' ');
    const tier = TIERS.find(t => t.name.toLowerCase() === tierRaw);
    if (!tier) {
        logger.warn?.('GRAPH', `Rang inconnu ignoré: "${rankStr}"`);
        return 0;
    }
    const divIdx = DIVS.map(d => d.toLowerCase()).indexOf((divRaw || 'iv').toLowerCase());
    const safeLp = Math.max(0, Number(lp) || 0);
    return tier.base + Math.max(0, divIdx) * 100 + (safeLp % 100);
}

function lpToLabel(lp) {
    for (let i = TIERS.length - 1; i >= 0; i--) {
        if (lp >= TIERS[i].base) {
            if (i >= 7) return TIERS[i].name;               // Master+
            const div = Math.min(3, Math.floor((lp - TIERS[i].base) / 100));
            return `${TIERS[i].name} ${DIVS[div]}`;
        }
    }
    return 'Iron IV';
}

function getTierForLP(lp) {
    for (let i = TIERS.length - 1; i >= 0; i--) {
        if (lp >= TIERS[i].base) return TIERS[i];
    }
    return TIERS[0];
}

// ─── DB ─────────────────────────────────────────────────────────────────────

function fetchHistory(playerId, limit) {
    if (!global.db) throw new Error('global.db non initialisé');
    return global.db.prepare(
        `SELECT rank_after, lp_after, win, lp_change, game_creation
     FROM match_history WHERE player_id = ?
     ORDER BY game_creation DESC LIMIT ?`
    ).all(playerId, limit).reverse();
}

/**
 * Calcule les bornes min/max LP sur TOUT l'historique du joueur (pas
 * seulement les games affichées), pour garder un axe Y stable d'une
 * génération de graphique à l'autre. Réutilise rankToLP au lieu de
 * dupliquer la logique de tiers en SQL.
 */
function fetchAllTimeBounds(playerId) {
    if (!global.db) return null;

    const rows = global.db.prepare(
        `SELECT rank_after, lp_after FROM match_history WHERE player_id = ?`
    ).all(playerId);

    if (!rows.length) return null;

    let minLP = Infinity, maxLP = -Infinity;
    for (const r of rows) {
        const lp = rankToLP(r.rank_after, r.lp_after);
        if (lp < minLP) minLP = lp;
        if (lp > maxLP) maxLP = lp;
    }

    if (!Number.isFinite(minLP) || !Number.isFinite(maxLP)) return null;

    return {
        minLP: Math.max(0, minLP - 180),
        maxLP: maxLP + 180,
    };
}

// ─── DESSIN ─────────────────────────────────────────────────────────────────

function scaleY(lp, minLP, maxLP, graphH) {
    return PAD.top + ((maxLP - lp) / (maxLP - minLP)) * graphH;
}

function drawBackground(ctx) {
    ctx.fillStyle = PALETTE.bg;
    ctx.fillRect(0, 0, W, H);
    // subtle vignette (bords plus sombres)
    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.85);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
}

function drawTierBands(ctx, minLP, maxLP, graphW, graphH) {
    TIERS.forEach(tier => {
        const bandTop = tier.base + 400;
        const bandBottom = tier.base;
        if (bandTop < minLP || bandBottom > maxLP) return;

        const y1 = scaleY(Math.min(bandTop, maxLP), minLP, maxLP, graphH);
        const y2 = scaleY(Math.max(bandBottom, minLP), minLP, maxLP, graphH);

        // Zone colorée très légère
        ctx.fillStyle = `rgba(${tier.bg},0.055)`;
        ctx.fillRect(PAD.left, y1, graphW, y2 - y1);

        // Ligne de séparation (bas de la division)
        if (bandBottom >= minLP && bandBottom <= maxLP) {
            const ySep = scaleY(bandBottom, minLP, maxLP, graphH);
            ctx.save();
            ctx.strokeStyle = `rgba(${tier.bg},0.45)`;
            ctx.lineWidth = 1;
            ctx.setLineDash([6, 6]);
            ctx.beginPath();
            ctx.moveTo(PAD.left, ySep);
            ctx.lineTo(PAD.left + graphW, ySep);
            ctx.stroke();
            ctx.restore();
        }
    });
}

function drawGridLines(ctx, minLP, maxLP, graphW, graphH) {
    // Lignes horizontales légères (toutes les 100 LP = une division)
    ctx.save();
    ctx.lineWidth = 0.75;
    ctx.setLineDash([3, 8]);
    for (let lp = Math.ceil(minLP / 100) * 100; lp <= maxLP; lp += 100) {
        const y = scaleY(lp, minLP, maxLP, graphH);
        ctx.strokeStyle = PALETTE.gridLine;
        ctx.beginPath();
        ctx.moveTo(PAD.left, y);
        ctx.lineTo(PAD.left + graphW, y);
        ctx.stroke();
    }
    ctx.restore();
}

function drawAxes(ctx, minLP, maxLP, graphW, graphH, pointCount) {
    ctx.save();
    // Axe Y — labels de rang
    ctx.font = '11px Arial, sans-serif';
    ctx.textAlign = 'right';

    TIERS.forEach(tier => {
        ['IV', 'III', 'II', 'I'].forEach((div, i) => {
            const lp = tier.base + i * 100;
            if (lp < minLP || lp > maxLP) return;
            const y = scaleY(lp, minLP, maxLP, graphH);
            const label = tier.base >= 2800 ? tier.name : `${tier.name[0]}${tier.name.slice(1).toLowerCase()} ${div}`;
            ctx.fillStyle = `rgba(${tier.bg},0.7)`;
            ctx.fillText(label.length > 12 ? tier.name : label, PAD.left - 8, y + 4);
        });
    });

    // Axe X — numéros de games (indices dédupliqués pour éviter les labels répétés)
    ctx.fillStyle = PALETTE.textMuted;
    ctx.textAlign = 'center';
    const xSteps = Math.min(10, Math.max(1, Math.ceil(pointCount / 20)));
    const seen = new Set();
    for (let i = 0; i <= xSteps; i++) {
        const idx = Math.round((pointCount - 1) * i / xSteps);
        if (seen.has(idx)) continue;
        seen.add(idx);
        const x = PAD.left + (idx / (pointCount - 1)) * graphW;
        ctx.fillText(`G${idx + 1}`, x, H - PAD.bottom + 18);
    }

    ctx.restore();
}

function drawLine(ctx, points, minLP, maxLP, graphW, graphH) {
    if (points.length < MIN_POINTS) return;

    // Ombre portée de la courbe
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 8;

    for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[i];
        const p1 = points[i + 1];
        const x0 = PAD.left + (i / (points.length - 1)) * graphW;
        const y0 = scaleY(p0.lp, minLP, maxLP, graphH);
        const x1 = PAD.left + ((i + 1) / (points.length - 1)) * graphW;
        const y1 = scaleY(p1.lp, minLP, maxLP, graphH);

        const tier = getTierForLP(p1.lp);
        ctx.strokeStyle = tier.line;
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.setLineDash([]);

        ctx.beginPath();
        ctx.moveTo(x0, y0);
        // Légère courbe de Bézier pour adoucir
        const cx = (x0 + x1) / 2;
        ctx.bezierCurveTo(cx, y0, cx, y1, x1, y1);
        ctx.stroke();
    }

    ctx.restore();
}

/**
 * Ligne pointillée horizontale au niveau du meilleur LP atteint sur la
 * fenêtre affichée, si ce pic est au-dessus du LP actuel.
 */
function drawPeakLine(ctx, points, minLP, maxLP, graphW, graphH) {
    const current = points[points.length - 1];
    const peak = points.reduce((a, b) => (b.lp > a.lp ? b : a), points[0]);
    if (peak.lp <= current.lp) return null;

    const y = scaleY(peak.lp, minLP, maxLP, graphH);

    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(PAD.left, y);
    ctx.lineTo(PAD.left + graphW, y);
    ctx.stroke();
    ctx.restore();

    // Petit label discret directement sur la ligne, côté gauche du graphe
    // (là où il y a de la place, loin du bloc résumé en haut à droite)
    ctx.save();
    ctx.font = '600 9px Arial, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.textAlign = 'left';
    ctx.fillText('PEAK', PAD.left + 6, y - 4);
    ctx.restore();

    return peak; // renvoyé pour être utilisé par drawPeakSummary
}

/**
 * Affiche le détail du peak (rang + LP exacts) en haut à droite du
 * graphique, juste en dessous du rang actuel affiché par drawStats.
 */
function drawPeakSummary(ctx, peak, graphW) {
    if (!peak) return;

    const tier = getTierForLP(peak.lp);
    const lpInDivision = peak.lp - tier.base - (Math.floor((peak.lp - tier.base) / 100) * 100);
    const label = tier.base >= 2800
        ? `Peak ${tier.name} · ${peak.lp - tier.base} LP`
        : `Peak ${lpToLabel(peak.lp)} · ${lpInDivision} LP`;

    ctx.save();
    ctx.font = '500 11px Arial, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.textAlign = 'right';
    // Juste sous le rang actuel, qui est positionné à PAD.top - 14 dans drawStats
    ctx.fillText(label, PAD.left + graphW, PAD.top + 2);
    ctx.restore();
}

function drawPoints(ctx, points, minLP, maxLP, graphW, graphH) {
    const n = points.length;
    // Seuil adaptatif : moins de points si beaucoup de games
    const step = n > 150 ? 4 : n > 80 ? 2 : 1;
    const radius = n > 100 ? 2.5 : 3.5;

    points.forEach((p, i) => {
        const isFirst = i === 0;
        const isLast = i === n - 1;
        const bigSwing = Math.abs(p.delta || 0) >= BIG_SWING_LP;
        if (!isFirst && !isLast && i % step !== 0 && !bigSwing) return;

        const x = PAD.left + (i / (n - 1)) * graphW;
        const y = scaleY(p.lp, minLP, maxLP, graphH);

        // Glow autour du point
        const color = p.win ? PALETTE.win : PALETTE.loss;
        ctx.save();
        ctx.shadowColor = color;
        ctx.shadowBlur = isLast ? 14 : 6;

        ctx.beginPath();
        ctx.arc(x, y, isLast ? radius + 2 : radius, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.strokeStyle = PALETTE.bg;
        ctx.lineWidth = 1.5;
        ctx.fill();
        ctx.stroke();
        ctx.restore();

        // Badge LP change pour les gros swings
        if (bigSwing && n < 120) {
            ctx.save();
            ctx.font = 'bold 9px Arial, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillStyle = color;
            ctx.fillText(
                `${p.delta > 0 ? '+' : ''}${p.delta}`,
                x,
                y - radius - 5
            );
            ctx.restore();
        }
    });
}

function drawStats(ctx, points, graphW) {
    const wins = points.filter(p => p.win).length;
    const losses = points.length - wins;
    const wr = ((wins / points.length) * 100).toFixed(0);
    const chg = points[points.length - 1].lp - points[0].lp;
    const l10 = points.slice(-10);
    const l10w = l10.filter(p => p.win).length;
    const l10chg = l10[l10.length - 1].lp - l10[0].lp;

    const baseY = H - 22;
    ctx.font = '13px Arial, sans-serif';

    const pieces = [
        { text: `${points.length} games`, color: PALETTE.textDim },
        { text: ` · `, color: PALETTE.textMuted },
        { text: `${wins}W`, color: PALETTE.win },
        { text: `/`, color: PALETTE.textMuted },
        { text: `${losses}L`, color: PALETTE.loss },
        { text: ` · `, color: PALETTE.textMuted },
        { text: `${wr}% WR`, color: PALETTE.textDim },
        { text: `  `, color: PALETTE.textMuted },
        {
            text: `${chg >= 0 ? '+' : ''}${chg} LP`,
            color: chg >= 0 ? PALETTE.win : PALETTE.loss
        },
        { text: `  L10: `, color: PALETTE.textMuted },
        { text: `${l10w}W/${10 - l10w}L`, color: PALETTE.textDim },
        {
            text: ` (${l10chg >= 0 ? '+' : ''}${l10chg})`,
            color: l10chg >= 0 ? PALETTE.win : PALETTE.loss
        },
    ];

    let x = PAD.left;
    ctx.textBaseline = 'alphabetic';
    pieces.forEach(p => {
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, x, baseY);
        x += ctx.measureText(p.text).width;
    });

    // Rang actuel (haut droite)
    const lastRank = lpToLabel(points[points.length - 1].lp);
    const tier = getTierForLP(points[points.length - 1].lp);
    ctx.font = '600 15px Arial, sans-serif';
    ctx.fillStyle = tier.line;
    ctx.textAlign = 'right';
    ctx.fillText(lastRank, PAD.left + graphW, PAD.top - 14);

    // Titre
    ctx.font = '12px Arial, sans-serif';
    ctx.fillStyle = PALETTE.textMuted;
    ctx.textAlign = 'left';
    ctx.fillText('HISTORIQUE ELO', PAD.left, PAD.top - 14);
}

// ─── ENCODAGE ───────────────────────────────────────────────────────────────

/**
 * Encode le canvas en JPEG. Tente canvas.toBuffer() (rapide, direct),
 * et se rabat sur toDataURL() si toBuffer() n'est pas supporté par la
 * version de node-canvas installée.
 */
function encodeJPEG(canvas, quality) {
    try {
        return canvas.toBuffer('image/jpeg', { quality });
    } catch (err) {
        logger.warn?.('GRAPH', 'canvas.toBuffer indisponible, fallback toDataURL', { err: err.message });
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        const base64 = dataUrl.replace(/^data:image\/jpeg;base64,/, '');
        return Buffer.from(base64, 'base64');
    }
}

// ─── EXPORT PRINCIPAL ────────────────────────────────────────────────────────

/**
 * @param {string} playerId
 * @param {number} [maxGames=200] Nombre de games affichées sur le graphique
 * @param {object} [opts]
 * @param {number} [opts.quality=0.75] Qualité JPEG (0–1)
 * @param {number} [opts.scale=2] Facteur de sur-échantillonnage (netteté)
 * @param {boolean} [opts.useStableScale=true] Utilise les bornes LP sur tout
 *   l'historique du joueur plutôt que juste les games affichées, pour un
 *   axe Y stable entre deux générations du graphique.
 */
async function generateLPGraph(playerId, maxGames = 200, opts = {}) {
    const {
        quality = DEFAULT_QUALITY,
        scale = DEFAULT_RENDER_SCALE,
        useStableScale = true,
    } = opts;

    const rows = fetchHistory(playerId, maxGames);
    if (!rows || rows.length < MIN_POINTS) {
        throw new Error('Pas assez de données pour générer le graphique');
    }

    const points = rows.map(r => ({
        lp: rankToLP(r.rank_after, r.lp_after),
        win: !!r.win,
        delta: r.lp_change || 0,
    }));

    let bounds = useStableScale ? fetchAllTimeBounds(playerId) : null;
    if (!bounds) {
        let minLP = Infinity, maxLP = -Infinity;
        for (const p of points) {
            if (p.lp < minLP) minLP = p.lp;
            if (p.lp > maxLP) maxLP = p.lp;
        }
        bounds = { minLP: Math.max(0, minLP - 180), maxLP: maxLP + 180 };
    }
    const { minLP, maxLP } = bounds;

    const canvas = createCanvas(W * scale, H * scale);
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale); // tout le code de dessin ci-dessous reste en coordonnées logiques W×H

    const graphW = W - PAD.left - PAD.right;
    const graphH = H - PAD.top - PAD.bottom;

    drawBackground(ctx);
    drawTierBands(ctx, minLP, maxLP, graphW, graphH);
    drawGridLines(ctx, minLP, maxLP, graphW, graphH);
    drawAxes(ctx, minLP, maxLP, graphW, graphH, points.length);

    const peak = drawPeakLine(ctx, points, minLP, maxLP, graphW, graphH);

    drawPeakLine(ctx, points, minLP, maxLP, graphW, graphH);
    drawLine(ctx, points, minLP, maxLP, graphW, graphH);
    drawPoints(ctx, points, minLP, maxLP, graphW, graphH);
    drawStats(ctx, points, graphW);
    drawPeakSummary(ctx, peak, graphW);

    logger.info('GRAPH', `Début encodage JPEG pour playerId: ${playerId}`, {
        points: points.length,
        scale,
    });

    const buffer = encodeJPEG(canvas, quality);
    logger.info('GRAPH', `Encodage JPEG terminé`, { size: buffer.length });

    return buffer;
}

module.exports = { generateLPGraph, rankToLP, lpToLabel };