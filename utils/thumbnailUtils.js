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

// ─── Vignette "groupe" : champions de tous les joueurs suivis ────────────────
// Discord affiche la vignette en ~80 px : image générée en 256 px pour rester nette.
// champions = [{ championName, teamColor? }] (teamColor : contour, pour les face-à-face)
const GROUP_SIZE = 256;
const GROUP_GAP = 8;
const TEAM_COLORS = { 100: "#3b82f6", 200: "#ef4444" };

// Positions [x, y, taille, rond ?] selon le nombre de champions
function getGroupLayout(count) {
    const half = (GROUP_SIZE - GROUP_GAP) / 2;
    switch (count) {
        case 2: // côte à côte, centrés verticalement
            return [[0, half / 2, half], [half + GROUP_GAP, half / 2, half]];
        case 3: // 2 en haut, 1 centré en bas
            return [[0, 0, half], [half + GROUP_GAP, 0, half], [half / 2 + GROUP_GAP / 2, half + GROUP_GAP, half]];
        case 4: // carré 2×2
            return [[0, 0, half], [half + GROUP_GAP, 0, half], [0, half + GROUP_GAP, half], [half + GROUP_GAP, half + GROUP_GAP, half]];
        case 5: { // 4 coins + le 3e (mid, joueurs triés top → support) au centre, en rond
            const center = 120;
            const order = [[0, 0, half], [half + GROUP_GAP, 0, half], null, [0, half + GROUP_GAP, half], [half + GROUP_GAP, half + GROUP_GAP, half]];
            order[2] = [(GROUP_SIZE - center) / 2, (GROUP_SIZE - center) / 2, center, true];
            return order;
        }
        default: { // grille 3 colonnes (face-à-face à 6+)
            const size = (GROUP_SIZE - 2 * GROUP_GAP) / 3;
            const rows = Math.ceil(count / 3);
            const offsetY = (GROUP_SIZE - (rows * size + (rows - 1) * GROUP_GAP)) / 2;
            return Array.from({ length: count }, (_, i) => [
                (i % 3) * (size + GROUP_GAP),
                offsetY + Math.floor(i / 3) * (size + GROUP_GAP),
                size,
            ]);
        }
    }
}

async function buildGroupThumbnail(champions, patchVersion) {
    const list = champions.slice(0, 9);
    const icons = await Promise.all(list.map((c) => getChampionIcon(c.championName, patchVersion)));
    const layout = getGroupLayout(list.length);

    const canvas = createCanvas(GROUP_SIZE, GROUP_SIZE);
    const ctx = canvas.getContext("2d");

    // Le rond central (5 joueurs) est dessiné en dernier, par-dessus les coins
    const drawOrder = list.map((_, i) => i).sort((a, b) => Boolean(layout[a][3]) - Boolean(layout[b][3]));

    for (const i of drawOrder) {
        const [x, y, size, round] = layout[i];
        const border = list[i].teamColor ? 6 : 0;
        const path = (inset) => {
            if (round) {
                ctx.beginPath();
                ctx.arc(x + size / 2, y + size / 2, size / 2 - inset, 0, Math.PI * 2);
            } else {
                roundedRectPath(ctx, x + inset, y + inset, size - 2 * inset, size - 2 * inset, size * 0.14);
            }
        };

        // Rond central : anneau sombre pour le détacher des icônes derrière
        if (round) {
            ctx.beginPath();
            ctx.arc(x + size / 2, y + size / 2, size / 2 + 6, 0, Math.PI * 2);
            ctx.fillStyle = "#1e1f22";
            ctx.fill();
        }

        // Contour de couleur d'équipe (face-à-face)
        if (border) {
            path(0);
            ctx.fillStyle = list[i].teamColor;
            ctx.fill();
        }

        ctx.save();
        path(border);
        ctx.clip();
        ctx.drawImage(icons[i], x + border, y + border, size - 2 * border, size - 2 * border);
        ctx.restore();
    }

    return canvas.toBuffer("image/png");
}

module.exports = { getLanePartner, buildDuoLaneThumbnail, buildGroupThumbnail, TEAM_COLORS };
