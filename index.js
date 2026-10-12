require("dotenv").config();
const { Client, GatewayIntentBits, Options } = require("discord.js");
const Database = require("better-sqlite3");
const cron = require("node-cron");
const logger = require("./utils/loggers");

// ─── Services & Handlers ──────────────────────────────────────────────────────
const { initDB } = require("./database/initDB");
const { loadCommands, deployCommands, deployToSingleGuild } = require("./handlers/commandHandler");
const { handleInteraction } = require("./handlers/interactionHandler");
const { checkAllPlayers } = require("./services/monitoringService");
const { sendWeeklyRecap } = require("./utils/weeklyRecap");
const { reportApiUsage, TIMEZONE: API_USAGE_TIMEZONE } = require("./utils/apiUsage");

// ─── Vérification des variables d'environnement ───────────────────────────────
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN || !CLIENT_ID || !process.env.RIOT_API_KEY) {
    logger.error("BOOT", "Variables d'environnement manquantes (DISCORD_TOKEN / CLIENT_ID / RIOT_API_KEY)");
    process.exit(1);
}

// ─── Base de données ──────────────────────────────────────────────────────────
const db = new Database("./players.db");
global.db = db;
initDB(db);

// ─── Client Discord ───────────────────────────────────────────────────────────
// Mémoire : le bot n'utilise que les commandes slash et les boutons.
//   • pas d'intent GuildMessages : aucun message des serveurs n'est reçu ni gardé
//     (/clear lit les messages via l'API, sans cet intent)
//   • caches inutilisés désactivés ; gardés : serveurs, salons et rôles
//     (permissions), membre et utilisateur du bot lui-même (members.me)
const isSelf = (entry) => entry.id === entry.client.user.id;
const client = new Client({
    intents: [GatewayIntentBits.Guilds],
    rest: { timeout: 60000 },
    makeCache: Options.cacheWithLimits({
        MessageManager: 0,
        ReactionManager: 0,
        ReactionUserManager: 0,
        PresenceManager: 0,
        VoiceStateManager: 0,
        GuildEmojiManager: 0,
        BaseGuildEmojiManager: 0,
        GuildStickerManager: 0,
        GuildBanManager: 0,
        GuildInviteManager: 0,
        GuildScheduledEventManager: 0,
        StageInstanceManager: 0,
        AutoModerationRuleManager: 0,
        ThreadMemberManager: 0,
        ApplicationCommandManager: 0,
        GuildMemberManager: { maxSize: 0, keepOverLimit: isSelf },
        UserManager: { maxSize: 0, keepOverLimit: isSelf },
    }),
});

// ─── Chargement des commandes ─────────────────────────────────────────────────
loadCommands(client);

// ─── Événements ───────────────────────────────────────────────────────────────
client.once("ready", async () => {
    logger.success("BOOT", `${client.user.tag} connecté !`, {
        guilds: client.guilds.cache.size,
    });

    client.guilds.cache.forEach((guild) => {
        logger.info("BOOT", `Serveur: ${guild.name} (${guild.id}) — ${guild.memberCount} membres`);
    });

    // Déploiement des commandes slash
    await deployCommands(client);

    // Monitoring
    logger.info("MONITOR", "Démarrage du monitoring...");
    checkAllPlayers(client);
    // Cycle court : chaque joueur a son propre rythme (en partie, actif, inactif),
    // un cycle sans vérification due ne fait aucun appel.
    // (l'état de l'API Riot est déduit du monitoring : MP au propriétaire si elle tombe)
    setInterval(() => checkAllPlayers(client), 30 * 1000);

    // Récap hebdomadaire (vendredi 18h00, Paris)
    cron.schedule("0 18 * * 5", () => sendWeeklyRecap(client), {
        timezone: "Europe/Paris",
    });

    // Bilan quotidien des appels API dans logs/api.log (minuit, Paris) ;
    // au démarrage : journées terminées pendant que le bot était éteint
    reportApiUsage();
    cron.schedule("0 0 * * *", reportApiUsage, { timezone: API_USAGE_TIMEZONE });

    logger.success("BOOT", "Bot entièrement opérationnel ✅");
});

// Nouveau serveur → déploiement automatique (en anglais par défaut)
client.on("guildCreate", async (guild) => {
    logger.info("BOOT", `Nouveau serveur : ${guild.name} (${guild.id})`);
    await deployToSingleGuild(client, guild);
});

// Bot retiré d'un serveur (ses joueurs y restent suivis tant qu'ils ne sont pas retirés)
client.on("guildDelete", (guild) => {
    logger.warn("BOOT", `Bot retiré du serveur : ${guild.name ?? "?"} (${guild.id})`);
});

// Toutes les interactions
client.on("interactionCreate", (interaction) => handleInteraction(interaction));

// ─── Connexion à Discord ──────────────────────────────────────────────────────
// Sans écouteur "error", une erreur du client ferait planter le bot
client.on("error", (error) => logger.error("DISCORD", `Erreur du client Discord`, describeError(error)));
client.on("warn", (message) => logger.warn("DISCORD", message));
client.on("shardDisconnect", (event, shardId) => {
    logger.warn("DISCORD", `Déconnecté de Discord (shard ${shardId})`, { code: event?.code });
});
client.on("shardReconnecting", (shardId) => logger.info("DISCORD", `Reconnexion à Discord… (shard ${shardId})`));
client.on("shardResume", (shardId, replayed) => {
    logger.success("DISCORD", `Reconnecté à Discord (shard ${shardId})`, { replayed });
});
client.on("shardError", (error, shardId) => {
    logger.error("DISCORD", `Erreur de connexion Discord (shard ${shardId})`, describeError(error));
});

// ─── Gestion des erreurs globales ─────────────────────────────────────────────
// La raison d'un rejet n'est pas toujours une Error (undefined, texte...)
function describeError(error) {
    return { error: error?.message ?? String(error), stack: error?.stack };
}

process.on("unhandledRejection", (reason) => {
    logger.error("PROCESS", "Unhandled rejection", describeError(reason));
});

process.on("uncaughtException", (error) => {
    logger.error("PROCESS", "Uncaught exception", describeError(error));
    process.exit(1);
});

// ─── Arrêt propre (pm2 stop / restart, Ctrl+C) ────────────────────────────────
// Sans ça, Node s'arrête sans écrire les derniers logs en attente ;
// la base est aussi fermée proprement (journal -wal reporté dans players.db)
let shuttingDown = false;
function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("PROCESS", `Arrêt du bot (${signal})`);
    try { client.destroy(); } catch { /* arrêt quoi qu'il arrive */ }
    try { db.close(); } catch { /* arrêt quoi qu'il arrive */ }
    process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// ─── Connexion ────────────────────────────────────────────────────────────────
client.login(TOKEN);
