const path = require("path");
const { registerFont } = require("canvas");
const logger = require("./loggers");

// ─── Police embarquée pour les images (tableau des scores, graphique LP) ─────
// Sur un serveur Linux sans police installée, "Arial" n'existe pas et tout le
// texte du canvas s'affiche en carrés. Arimo a les mêmes dimensions qu'Arial :
// rendu identique partout, sans dépendre des polices de la machine.
// Doit être enregistrée AVANT la création du premier canvas.
const FONTS_DIR = path.join(__dirname, "..", "assets", "fonts");

try {
    registerFont(path.join(FONTS_DIR, "Arimo-Regular.ttf"), { family: "Arimo" });
    registerFont(path.join(FONTS_DIR, "Arimo-Bold.ttf"), { family: "Arimo", weight: "bold" });
} catch (error) {
    logger.error("CANVAS", `Échec chargement de la police Arimo`, { error: error.message });
}
