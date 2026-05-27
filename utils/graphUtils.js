// lp-graph.js — générateur de graphique ELO style moderne
const { createCanvas } = require('canvas');
const logger = require("../utils/loggers");

// ─── CONFIG ─────────────────────────────────────────────────────────────────

const PALETTE = {
    bg: '#0d0d0f',
    bgCard: '#111114',
    gridLine: 'rgba(255,255,255,0.05)',
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
const W = 600; // 1280
const H = 300; //580

// ─── HELPERS LP ─────────────────────────────────────────────────────────────

function rankToLP(rankStr, lp = 0) {
    if (!rankStr || rankStr === 'UNRANKED') return 0;
    const [tierRaw, divRaw] = rankStr.toLowerCase().split(' ');
    const tier = TIERS.find(t => t.name.toLowerCase() === tierRaw);
    if (!tier) return 0;
    const divIdx = DIVS.map(d => d.toLowerCase()).indexOf((divRaw || 'iv').toLowerCase());
    return tier.base + Math.max(0, divIdx) * 100 + (lp % 100);
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
    return global.db.prepare(
        `SELECT rank_after, lp_after, win, lp_change, game_creation
     FROM match_history WHERE player_id = ?
     ORDER BY game_creation DESC LIMIT ?`
    ).all(playerId, limit).reverse();
}

function fetchAllTimeBounds(playerId) {
    const row = global.db.prepare(`
    SELECT
      MIN(
        CASE
          WHEN LOWER(rank_after) LIKE '%iron%'        THEN 0
          WHEN LOWER(rank_after) LIKE '%bronze%'      THEN 400
          WHEN LOWER(rank_after) LIKE '%silver%'      THEN 800
          WHEN LOWER(rank_after) LIKE '%gold%'        THEN 1200
          WHEN LOWER(rank_after) LIKE '%platinum%'    THEN 1600
          WHEN LOWER(rank_after) LIKE '%emerald%'     THEN 2000
          WHEN LOWER(rank_after) LIKE '%diamond%'     THEN 2400
          WHEN LOWER(rank_after) LIKE '%master%'      THEN 2800
          WHEN LOWER(rank_after) LIKE '%grandmaster%' THEN 3200
          WHEN LOWER(rank_after) LIKE '%challenger%'  THEN 3600
          ELSE 0
        END
        + CASE
          WHEN LOWER(rank_after) LIKE '% iv%'  THEN 0
          WHEN LOWER(rank_after) LIKE '% iii%' THEN 100
          WHEN LOWER(rank_after) LIKE '% ii%'  THEN 200
          WHEN LOWER(rank_after) LIKE '% i%'   THEN 300
          ELSE 0
        END
        + COALESCE(lp_after, 0)
      ) AS min_lp,
      MAX(
        CASE
          WHEN LOWER(rank_after) LIKE '%iron%'        THEN 0
          WHEN LOWER(rank_after) LIKE '%bronze%'      THEN 400
          WHEN LOWER(rank_after) LIKE '%silver%'      THEN 800
          WHEN LOWER(rank_after) LIKE '%gold%'        THEN 1200
          WHEN LOWER(rank_after) LIKE '%platinum%'    THEN 1600
          WHEN LOWER(rank_after) LIKE '%emerald%'     THEN 2000
          WHEN LOWER(rank_after) LIKE '%diamond%'     THEN 2400
          WHEN LOWER(rank_after) LIKE '%master%'      THEN 2800
          WHEN LOWER(rank_after) LIKE '%grandmaster%' THEN 3200
          WHEN LOWER(rank_after) LIKE '%challenger%'  THEN 3600
          ELSE 0
        END
        + CASE
          WHEN LOWER(rank_after) LIKE '% iv%'  THEN 0
          WHEN LOWER(rank_after) LIKE '% iii%' THEN 100
          WHEN LOWER(rank_after) LIKE '% ii%'  THEN 200
          WHEN LOWER(rank_after) LIKE '% i%'   THEN 300
          ELSE 0
        END
        + COALESCE(lp_after, 0)
      ) AS max_lp
    FROM match_history
    WHERE player_id = ?
  `).get(playerId);

    return {
        minLP: Math.max(0, (row?.min_lp ?? 0) - 180),
        maxLP: (row?.max_lp ?? 1200) + 180,
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
            ctx.strokeStyle = `rgba(${tier.bg},0.22)`;
            ctx.lineWidth = 0.5;
            ctx.setLineDash([6, 6]);
            ctx.beginPath();
            ctx.moveTo(PAD.left, ySep);
            ctx.lineTo(PAD.left + graphW, ySep);
            ctx.stroke();
            ctx.restore();
        }

        // Label du tier dans la bande (si assez de place)
        const bandPx = y2 - y1;
        if (bandPx > 20) {
            ctx.save();
            ctx.fillStyle = `rgba(${tier.bg},0.55)`;
            ctx.font = `500 10px "Arial Narrow", Arial, sans-serif`;
            ctx.letterSpacing = '0.08em';
            ctx.textAlign = 'right';
            ctx.fillText(tier.name.toUpperCase(), PAD.left - 10, (y1 + y2) / 2 + 4);
            ctx.restore();
        }
    });
}

function drawGridLines(ctx, minLP, maxLP, graphW, graphH) {
    // Lignes horizontales légères (toutes les 100 LP = une division)
    ctx.save();
    ctx.lineWidth = 0.5;
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

    // Axe X — numéros de games
    ctx.fillStyle = PALETTE.textMuted;
    ctx.textAlign = 'center';
    const xSteps = Math.min(10, Math.ceil(pointCount / 20));
    for (let i = 0; i <= xSteps; i++) {
        const idx = Math.round((pointCount - 1) * i / xSteps);
        const x = PAD.left + (idx / (pointCount - 1)) * graphW;
        ctx.fillText(`G${idx + 1}`, x, H - PAD.bottom + 18);
    }

    ctx.restore();
}

function drawLine(ctx, points, minLP, maxLP, graphW, graphH) {
    if (points.length < 2) return;

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

function drawPoints(ctx, points, minLP, maxLP, graphW, graphH) {
    const n = points.length;
    // Seuil adaptatif : moins de points si beaucoup de games
    const step = n > 150 ? 4 : n > 80 ? 2 : 1;
    const radius = n > 100 ? 2.5 : 3.5;

    points.forEach((p, i) => {
        const isFirst = i === 0;
        const isLast = i === n - 1;
        const bigSwing = Math.abs(p.delta || 0) >= 20;
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

// ─── EXPORT PRINCIPAL ────────────────────────────────────────────────────────

async function generateLPGraph(playerId, maxGames = 200) {
    const rows = fetchHistory(playerId, maxGames);
    if (!rows || rows.length < 2) {
        throw new Error('Pas assez de données pour générer le graphique');
    }

    const points = rows.map(r => ({
        lp: rankToLP(r.rank_after, r.lp_after),
        win: !!r.win,
        delta: r.lp_change || 0,
    }));

    let minLP = Infinity, maxLP = -Infinity;
    for (const p of points) {
        if (p.lp < minLP) minLP = p.lp;
        if (p.lp > maxLP) maxLP = p.lp;
    }
    minLP = Math.max(0, minLP - 180);
    maxLP = maxLP + 180;

    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const graphW = W - PAD.left - PAD.right;
    const graphH = H - PAD.top - PAD.bottom;

    drawBackground(ctx);
    drawTierBands(ctx, minLP, maxLP, graphW, graphH);
    drawGridLines(ctx, minLP, maxLP, graphW, graphH);
    drawAxes(ctx, minLP, maxLP, graphW, graphH, points.length);
    drawLine(ctx, points, minLP, maxLP, graphW, graphH);
    drawPoints(ctx, points, minLP, maxLP, graphW, graphH);
    drawStats(ctx, points, graphW);

    logger.info('GRAPH', `Début encodage PNG pour playerId: ${playerId}`, {
        points: points.length
    });

    // Convertir via toDataURL — fonctionne sur toutes les versions node-canvas
    const dataUrl = canvas.toDataURL('image/jpeg', 0.75);
    const base64 = dataUrl.replace(/^data:image\/jpeg;base64,/, '');
    const buffer = Buffer.from(base64, 'base64');
    logger.info('GRAPH', `Encodage JPEG terminé`, { size: buffer.length });

    return buffer;
}

module.exports = { generateLPGraph };