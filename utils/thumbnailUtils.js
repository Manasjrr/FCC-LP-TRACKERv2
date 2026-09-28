const axios = require("axios");
const { createCanvas, loadImage } = require("canvas");
const { getChampionIconUrl } = require("./championUtils");

// ─── Icônes de champions (Data Dragon, mises en cache en mémoire) ────────────
const iconCache = new Map(); // "patch|champion" → Image

async function getChampionIcon(championName, patchVersion) {
    const key = `${patchVersion}|${championName}`;
    if (iconCache.has(key)) return iconCache.get(key);

    const res = await axios.get(getChampionIconUrl(championName, patchVersion), {
        responseType: "arraybuffer",
        timeout: 5000,
    });
    const image = await loadImage(Buffer.from(res.data));
    iconCache.set(key, image);
    return image;
}

// ─── Partenaire de botlane ────────────────────────────────────────────────────
// ADC → support de son équipe, Support → ADC de son équipe, autres rôles → null
const LANE_PARTNER_ROLE = { BOTTOM: "UTILITY", UTILITY: "BOTTOM" };

function getLanePartner(participant, participants) {
    const partnerRole = LANE_PARTNER_ROLE[participant.teamPosition];
    if (!partnerRole) return null;
    return participants.find((p) => p.teamId === participant.teamId && p.teamPosition === partnerRole) ?? null;
}

// ─── Vignette "duo lane" : champion en grand + partenaire en petit ───────────
const SIZE = 128;
const MAIN_SIZE = 112;
const PARTNER_SIZE = 52;
const BORDER = 4;

function roundedRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

async function buildDuoLaneThumbnail(championName, partnerChampionName, patchVersion) {
    const [main, partner] = await Promise.all([
        getChampionIcon(championName, patchVersion),
        getChampionIcon(partnerChampionName, patchVersion),
    ]);

    const canvas = createCanvas(SIZE, SIZE);
    const ctx = canvas.getContext("2d");

    // Champion joué (grand, coins arrondis)
    ctx.save();
    roundedRectPath(ctx, 0, 0, MAIN_SIZE, MAIN_SIZE, 14);
    ctx.clip();
    ctx.drawImage(main, 0, 0, MAIN_SIZE, MAIN_SIZE);
    ctx.restore();

    // Partenaire de lane (petit, rond, en bas à droite)
    const cx = SIZE - PARTNER_SIZE / 2 - 2;
    const cy = SIZE - PARTNER_SIZE / 2 - 2;
    ctx.beginPath();
    ctx.arc(cx, cy, PARTNER_SIZE / 2 + BORDER, 0, Math.PI * 2);
    ctx.fillStyle = "#1e1f22";
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, PARTNER_SIZE / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(partner, cx - PARTNER_SIZE / 2, cy - PARTNER_SIZE / 2, PARTNER_SIZE, PARTNER_SIZE);
    ctx.restore();

    return canvas.toBuffer("image/png");
}

module.exports = { getLanePartner, buildDuoLaneThumbnail };
