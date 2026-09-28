// ─── Fausse notification Flex (test d'affichage) ─────────────────────────────
// Envoie dans un salon une notification Flex construite avec de fausses données,
// en passant par le VRAI circuit du bot : calcul des notes (même barème),
// vignette duo / lane, embed Flex et envoi Discord.
// Aucun appel à l'API Riot, rien n'est écrit en base.
//
// Usage :  node scripts/testFlexNotif.js <channelId> [--joueurs 3|5] [--resultat victoire|defaite|faceoff|remake] [--vrais-joueurs]
//   --joueurs        nombre de joueurs suivis dans la game (1 à 5, défaut 5 ; 2 à 10 en faceoff)
//   --resultat       victoire (défaut), defaite, faceoff (joueurs dans les 2 équipes), remake
//   --vrais-joueurs  utilise les pseudos des joueurs suivis dans ce salon (sinon pseudos fictifs)
//
// Exemples :
//   node scripts/testFlexNotif.js 123456789012345678
//   node scripts/testFlexNotif.js 123456789012345678 --joueurs 3 --resultat defaite
//   node scripts/testFlexNotif.js 123456789012345678 --joueurs 4 --resultat faceoff --vrais-joueurs

require("dotenv").config();
const path = require("path");
const axios = require("axios");
const Database = require("better-sqlite3");

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const CHANNEL_ID = args[0];
const RESULT = getArg("resultat", "victoire");
const FACEOFF = RESULT === "faceoff";
const PLAYER_COUNT = Math.min(Math.max(Number(getArg("joueurs", FACEOFF ? 4 : 5)) || 5, FACEOFF ? 2 : 1), FACEOFF ? 10 : 5);
const REAL_PLAYERS = args.includes("--vrais-joueurs");

if (!CHANNEL_ID || CHANNEL_ID.startsWith("--")) {
    console.error("❌ Usage : node scripts/testFlexNotif.js <channelId> [--joueurs 3|5] [--resultat victoire|defaite|faceoff|remake] [--vrais-joueurs]");
    process.exit(1);
}
if (!["victoire", "defaite", "faceoff", "remake"].includes(RESULT)) {
    console.error(`❌ --resultat inconnu : ${RESULT} (victoire, defaite, faceoff ou remake)`);
    process.exit(1);
}
if (!process.env.DISCORD_TOKEN) {
    console.error("❌ DISCORD_TOKEN manquant dans le .env");
    process.exit(1);
}

// ─── Base de données (lecture seule : pseudos des joueurs suivis) ────────────
const db = new Database(path.join(__dirname, "..", "players.db"), { readonly: true });
global.db = db;

// Serveur du salon : sa vignette (/flex vignette) est utilisée pour le test
const GUILD_ID = db.prepare(`SELECT guild_id FROM player_guilds WHERE channel_id = ? LIMIT 1`).get(CHANNEL_ID)?.guild_id ?? null;

const timelineCache = require("../cache/timelineCache");
const { sendPendingFlexNotifications, updatePatchVersion } = require("../services/monitoringService");

// ─── Fausses données ──────────────────────────────────────────────────────────
const ROLES = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];

// Champions par rôle [équipe bleue, équipe rouge] (noms Data Dragon)
const CHAMPIONS = {
    TOP: ["Darius", "Aatrox"],
    JUNGLE: ["LeeSin", "Viego"],
    MIDDLE: ["Ahri", "Sylas"],
    BOTTOM: ["Jinx", "Kaisa"],
    UTILITY: ["Thresh", "Lulu"],
};

const FAKE_NAMES = ["Alpha#EUW", "Bravo#EUW", "Charlie#EUW", "Delta#EUW", "Echo#EUW", "Foxtrot#EUW", "Golf#EUW", "Hotel#EUW", "India#EUW", "Juliett#EUW"];

// Stats typiques par rôle, légèrement aléatoires pour varier les notes
const rand = (min, max) => Math.round(min + Math.random() * (max - min));
function fakeStats(role, win) {
    const bonus = win ? 1 : 0;
    const base = {
        TOP:     { k: rand(2, 8) + bonus * 2, d: rand(2, 7), a: rand(2, 8),  cs: rand(170, 260), vision: rand(12, 28), dmg: rand(15000, 30000), share: 0.2 },
        JUNGLE:  { k: rand(3, 9) + bonus * 2, d: rand(2, 7), a: rand(6, 14), cs: rand(140, 210), vision: rand(25, 45), dmg: rand(10000, 22000), share: 0.16, epic: rand(1, 4) },
        MIDDLE:  { k: rand(3, 10) + bonus * 2, d: rand(2, 7), a: rand(4, 10), cs: rand(190, 280), vision: rand(15, 30), dmg: rand(18000, 34000), share: 0.26 },
        BOTTOM:  { k: rand(4, 12) + bonus * 2, d: rand(2, 7), a: rand(4, 10), cs: rand(210, 300), vision: rand(12, 25), dmg: rand(20000, 36000), share: 0.28 },
        UTILITY: { k: rand(0, 3), d: rand(2, 8), a: rand(10, 22) + bonus * 3, cs: rand(20, 45), vision: rand(55, 95), dmg: rand(6000, 14000), share: 0.08 },
    }[role];
    return base;
}

function buildParticipant({ participantId, puuid, riotId, teamId, role, win, gameDuration }) {
    const s = fakeStats(role, win);
    const minutes = gameDuration / 60;
    const [gameName, tagLine] = riotId.split("#");
    return {
        participantId,
        puuid,
        riotIdGameName: gameName,
        riotIdTagline: tagLine,
        teamId,
        teamPosition: role,
        championName: CHAMPIONS[role][teamId === 100 ? 0 : 1],
        championId: 0,
        win,
        kills: s.k,
        deaths: s.d,
        assists: s.a,
        champLevel: rand(13, 18),
        totalMinionsKilled: role === "JUNGLE" ? rand(20, 40) : s.cs,
        neutralMinionsKilled: role === "JUNGLE" ? s.cs : rand(0, 8),
        totalDamageDealtToChampions: s.dmg,
        totalDamageTaken: rand(15000, 35000),
        goldEarned: rand(9000, 15000),
        visionScore: s.vision,
        wardsPlaced: rand(8, 30),
        wardsKilled: rand(1, 8),
        visionWardsBoughtInGame: rand(1, 6),
        turretTakedowns: rand(0, 4),
        dragonKills: role === "JUNGLE" ? Math.min(s.epic, 3) : 0,
        baronKills: role === "JUNGLE" && s.epic > 3 ? 1 : 0,
        doubleKills: rand(0, 2),
        tripleKills: rand(0, 3) === 3 ? 1 : 0,
        quadraKills: Math.random() < 0.1 ? 1 : 0,
        pentaKills: Math.random() < 0.03 ? 1 : 0,
        largestKillingSpree: rand(0, 6),
        challenges: {
            killParticipation: Math.min(0.95, (s.k + s.a) / (s.k + s.a + rand(4, 14))),
            teamDamagePercentage: s.share + (Math.random() - 0.5) * 0.08,
            laneMinionsFirst10Minutes: role === "JUNGLE" || role === "UTILITY" ? rand(0, 10) : rand(50, 85),
            soloKills: rand(0, 3),
            goldPerMinute: rand(300, 500),
            damagePerMinute: s.dmg / minutes,
            visionScorePerMinute: s.vision / minutes,
        },
    };
}

// Timeline minimale : frames jusqu'à 15 min + 2 premiers dragons
function buildTimeline(participants) {
    const frames = [];
    for (let minute = 0; minute <= 16; minute++) {
        const participantFrames = {};
        for (const p of participants) {
            const lead = (p.win ? 1 : -1) * rand(0, 60) * minute;
            participantFrames[p.participantId] = {
                totalGold: 500 + minute * 380 + lead,
                xp: minute * 420 + lead,
                minionsKilled: p.teamPosition === "JUNGLE" || p.teamPosition === "UTILITY" ? rand(0, 2) * minute : 7 * minute + rand(-10, 10),
                jungleMinionsKilled: p.teamPosition === "JUNGLE" ? 6 * minute : 0,
            };
        }
        const events = minute === 7 || minute === 13
            ? [{ type: "ELITE_MONSTER_KILL", monsterType: "DRAGON", killerTeamId: Math.random() < 0.6 ? 100 : 200, timestamp: minute * 60000 }]
            : [];
        frames.push({ timestamp: minute * 60000, participantFrames, events });
    }
    return { info: { frames } };
}

function getRealPlayers() {
    return db.prepare(`
        SELECT DISTINCT p.id, p.riot_id, p.puuid FROM players p
        JOIN player_guilds pg ON pg.player_id = p.id
        WHERE pg.channel_id = ? AND pg.active = 1
    `).all(CHANNEL_ID);
}

// ─── Construction de la fausse game ───────────────────────────────────────────
function buildFakeGame() {
    const isRemake = RESULT === "remake";
    const gameDuration = isRemake ? rand(150, 280) : rand(22 * 60, 38 * 60);
    const blueWins = RESULT !== "defaite";

    // Emplacements des joueurs suivis : équipe bleue, ou réparti entre les 2 équipes en faceoff
    const slots = [];
    if (FACEOFF) {
        const blue = Math.ceil(PLAYER_COUNT / 2);
        ROLES.slice(0, blue).forEach((role) => slots.push({ teamId: 100, role }));
        ROLES.slice(0, PLAYER_COUNT - blue).forEach((role) => slots.push({ teamId: 200, role }));
    } else {
        // 3 joueurs → top / mid / adc par exemple ; ordre mélangé pour varier les rôles
        const roles = [...ROLES].sort(() => Math.random() - 0.5).slice(0, PLAYER_COUNT);
        roles.forEach((role) => slots.push({ teamId: 100, role }));
    }

    let names = FAKE_NAMES.map((riotId, i) => ({ id: -(i + 1), riot_id: riotId, puuid: `fake-puuid-${i}` }));
    if (REAL_PLAYERS) {
        const real = getRealPlayers();
        if (real.length < slots.length) {
            console.warn(`⚠️ Seulement ${real.length} joueur(s) suivi(s) dans ce salon : complété avec des pseudos fictifs`);
        }
        names = [...real, ...names].slice(0, Math.max(slots.length, real.length));
    }

    const participants = [];
    const trackedPlayers = [];
    let participantId = 1;
    for (const teamId of [100, 200]) {
        for (const role of ROLES) {
            const slotIndex = slots.findIndex((s) => s.teamId === teamId && s.role === role);
            const player = slotIndex >= 0 ? names[slotIndex] : null;
            const participant = buildParticipant({
                participantId: participantId++,
                puuid: player?.puuid ?? `random-${teamId}-${role}`,
                riotId: player?.riot_id ?? `Random${participantId}#EUW`,
                teamId,
                role,
                win: isRemake ? false : (teamId === 100) === blueWins,
                gameDuration,
            });
            participants.push(participant);
            if (player) trackedPlayers.push({ player, participant });
        }
    }

    const now = Date.now();
    const match = {
        queueId: 440,
        gameDuration,
        gameCreation: now - gameDuration * 1000 - 60000,
        gameEndTimestamp: now - 60000,
        teams: [100, 200].map((teamId) => ({ teamId, win: (teamId === 100) === blueWins })),
        participants,
    };
    return { match, trackedPlayers, timeline: buildTimeline(participants) };
}

// ─── Client minimal : envoi via l'API REST Discord ───────────────────────────
const discordClient = {
    channels: {
        fetch: async (channelId) => ({
            send: (payload) => axios.post(
                `https://discord.com/api/v10/channels/${channelId}/messages`,
                {
                    embeds: payload.embeds.map((e) => e.toJSON()),
                    components: (payload.components ?? []).map((c) => c.toJSON()),
                },
                { headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` }, timeout: 15000 }
            ),
        }),
    },
};

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
    await updatePatchVersion();

    const { match, trackedPlayers, timeline } = buildFakeGame();
    const matchId = `EUW1_TEST${Date.now()}`;

    // Timeline préchargée : aucun appel à l'API Riot
    timelineCache.setTimeline(matchId, timeline);

    const pending = new Map([[`${CHANNEL_ID}|${matchId}`, {
        channelId: CHANNEL_ID,
        guildId: GUILD_ID,
        matchId,
        match,
        entries: trackedPlayers.map(({ player, participant }) => ({ player, result: { participant } })),
    }]]);

    console.log(`📨 Envoi d'une fausse Flex (${RESULT}, ${trackedPlayers.length} joueur(s) suivi(s)) dans le salon ${CHANNEL_ID}...`);
    for (const { player, participant } of trackedPlayers) {
        console.log(`   • ${player.riot_id} — ${participant.championName} (${participant.teamPosition}, équipe ${participant.teamId})`);
    }

    await sendPendingFlexNotifications(discordClient, pending);
    console.log("✅ Terminé (vérifie le salon ; en cas d'erreur, elle apparaît dans les logs ci-dessus)");
    process.exit(0);
})().catch((error) => {
    console.error("❌ Erreur :", error.response?.data ?? error.message);
    process.exit(1);
});
