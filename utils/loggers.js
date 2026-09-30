const fs = require('fs');
const path = require('path');

// Créer le dossier logs s'il n'existe pas
const logsDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

// Formatter la date/heure
function getTimestamp() {
    return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

// Nom du fichier du jour
function getDailyLogFile() {
    const date = new Date().toISOString().substring(0, 10); // 2025-01-15
    return path.join(logsDir, `${date}.log`);
}

// Écriture dans un fichier
// Les lignes sont regroupées puis écrites en asynchrone toutes les 200 ms :
// appendFileSync bloquait tout le bot (Discord, monitoring) à chaque ligne de log
const FLUSH_DELAY = 200;
const pending = new Map(); // chemin → lignes en attente
let flushTimer = null;
let flushing = false;

function writeToFile(filePath, message) {
    let lines = pending.get(filePath);
    if (!lines) {
        lines = [];
        pending.set(filePath, lines);
    }
    lines.push(message);
    scheduleFlush();
}

function scheduleFlush() {
    if (flushTimer || flushing) return;
    flushTimer = setTimeout(flush, FLUSH_DELAY);
    flushTimer.unref();
}

// Une seule écriture en cours à la fois → l'ordre des lignes est conservé
function flush() {
    flushTimer = null;
    if (!pending.size) return;

    const batch = [...pending];
    pending.clear();
    flushing = true;

    let remaining = batch.length;
    for (const [filePath, lines] of batch) {
        fs.appendFile(filePath, lines.join('\n') + '\n', 'utf8', (err) => {
            if (err) console.error(`[LOGGER] Écriture impossible dans ${filePath} : ${err.message}`);
            if (--remaining === 0) {
                flushing = false;
                if (pending.size) scheduleFlush();
            }
        });
    }
}

// Arrêt du process (crash compris) : les lignes en attente sont écrites tout de suite
process.on('exit', () => {
    for (const [filePath, lines] of pending) {
        try {
            fs.appendFileSync(filePath, lines.join('\n') + '\n', 'utf8');
        } catch { /* rien de plus à faire à l'arrêt */ }
    }
    pending.clear();
});

// Niveaux de log
const LEVELS = {
    INFO:    { label: 'INFO ',  console: '\x1b[36m' },  // Cyan
    SUCCESS: { label: 'OK   ',  console: '\x1b[32m' },  // Vert
    WARN:    { label: 'WARN ',  console: '\x1b[33m' },  // Jaune
    ERROR:   { label: 'ERROR',  console: '\x1b[31m' },  // Rouge
    DEBUG:   { label: 'DEBUG',  console: '\x1b[90m' },  // Gris
    API:     { label: 'API  ',  console: '\x1b[35m' },  // Violet
    MATCH:   { label: 'MATCH',  console: '\x1b[34m' },  // Bleu
};

const RESET = '\x1b[0m';

// Fonction principale de log
function log(level, category, message, extra = null) {
    const lvl = LEVELS[level] || LEVELS.INFO;
    const timestamp = getTimestamp();
    const extraStr = extra ? ` | ${JSON.stringify(extra)}` : '';

    // Format ligne de log
    const fileLine  = `[${timestamp}] [${lvl.label}] [${category}] ${message}${extraStr}`;
    const consoleLine = `${lvl.console}[${lvl.label}]${RESET} [${category}] ${message}${extraStr}`;

    // Console (comportement actuel conservé)
    console.log(consoleLine);

    //  Fichier du jour (tout)
    writeToFile(getDailyLogFile(), fileLine);

    //  Fichier erreurs séparé
    if (level === 'ERROR' || level === 'WARN') {
        writeToFile(path.join(logsDir, 'errors.log'), fileLine);
    }

    // Fichier API séparé
    if (level === 'API') {
        writeToFile(path.join(logsDir, 'api.log'), fileLine);
    }
}

//  Raccourcis pratiques
const logger = {
    info:    (category, msg, extra) => log('INFO',    category, msg, extra),
    success: (category, msg, extra) => log('SUCCESS', category, msg, extra),
    warn:    (category, msg, extra) => log('WARN',    category, msg, extra),
    error:   (category, msg, extra) => log('ERROR',   category, msg, extra),
    debug:   (category, msg, extra) => log('DEBUG',   category, msg, extra),
    api:     (category, msg, extra) => log('API',     category, msg, extra),
    match:   (category, msg, extra) => log('MATCH',   category, msg, extra),
};

module.exports = logger;
