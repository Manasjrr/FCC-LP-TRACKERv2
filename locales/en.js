// ─── English (default language) ──────────────────────────────────────────────
// Reference file: to add a language, copy this file to locales/<code>.js
// and translate the values (keys and {variables} must stay unchanged).

const plural = (count, one, many) => (count === 1 ? one : many);

module.exports = {
    meta: {
        name: "English",
        locale: "en-GB",       // date / number formatting (Intl)
        discordLocale: null,   // Discord client locale for translated option names (null = none)
    },

    // ─── Slash command definitions ────────────────────────────────────────────
    commands: {
        add: {
            description: "Add a League of Legends account to tracking",
            options: {
                "riot-id": { description: "Riot ID (Name#TAG)" },
            },
        },
        remove: {
            description: "Remove an account from tracking",
            options: {
                player: { description: "Riot ID of the account to remove" },
            },
        },
        list: {
            description: "Show the list of tracked accounts",
        },
        stats: {
            description: "Detailed player statistics with performance analysis",
            options: {
                player: { description: "Player's Riot ID" },
            },
        },
        history: {
            description: "A player's recent match history",
            options: {
                player: { description: "Player's Riot ID" },
                count: { description: "Number of matches to show (1-25, default: 5)" },
            },
        },
        ingame: {
            description: "Show tracked players currently in game (SoloQ / Flex)",
        },
        flex: {
            description: "Flex notification settings (admins only)",
            options: {
                enabled: { description: "true = post Flex games, false = stop posting them" },
                thumbnail: {
                    description: "Thumbnail for games with 3+ tracked players / face-offs",
                    choices: {
                        gif: "Animated GIF (each champion + their role)",
                        mosaique: "Mosaic (all champions in one image)",
                    },
                },
            },
        },
        clear: {
            description: "Delete all messages in the channel",
            options: {
                count: { description: "Number of messages to delete (max 1000, default: all)" },
                channel: { description: "ID of the channel to clean (default: current channel)" },
            },
        },
        forcerecap: {
            description: "Force the weekly recap (OWNER ONLY)",
        },
        help: {
            description: "Show the documentation and the list of available commands",
        },
        language: {
            description: "Change the bot language on this server (admins only)",
            options: {
                language: { description: "New language of the bot" },
            },
        },
    },

    // ─── Shared ───────────────────────────────────────────────────────────────
    common: {
        dbUnavailable: "❌ Database unavailable",
        playerNotFound: "❌ No player found for **{player}** on this server.\n*Use autocomplete or check `/list`.*",
        playerNotFoundById: "❌ Player not found (ID: {id})",
        noTrackedAccounts: "📭 No accounts tracked on this server.",
        error: "❌ An error occurred",
        errorWithMessage: "❌ Error: {message}",
        requestedBy: "Requested by {user}",
        accessDeniedTitle: "🚫 Access denied",
        accessDenied: "You don't have the required permissions to use this command.",
        requiredPermissions: "Required permissions",
        requiredPermissionsList: "• Administrator\n• Authorized user",
        winsInARow: ({ count }) => `${count} ${plural(count, "win", "wins")} in a row`,
        lossesInARow: ({ count }) => `${count} ${plural(count, "loss", "losses")} in a row`,
    },

    roles: {
        TOP: "Top",
        JUNGLE: "Jungle",
        MIDDLE: "Mid",
        BOTTOM: "ADC",
        UTILITY: "Support",
        DEFAULT: "Unknown",
    },

    // ─── Commands ─────────────────────────────────────────────────────────────
    add: {
        invalidFormat: "❌ Invalid format! Use: Name#TAG",
        alreadyTracked: "❌ This account is already tracked on this server!",
        title: "✅ Account added!",
        description: "**{riotId}** is now tracked on this server!\n📊 **Rank:** {rank} ({lp} LP)",
        sharedStats: "*This player is already tracked on other servers, stats are shared!*",
        notFound: "❌ Player not found: **{riotId}**",
        invalidApiKey: "❌ Invalid or expired Riot API key!",
        alreadyInDb: "❌ This account already exists in the database.",
    },

    remove: {
        title: "🗑️ Account removed from tracking",
        descriptionAddedBy: "**{riotId}** (added by {user}) is no longer tracked on this server.\n*Match history is kept.*",
        description: "**{riotId}** is no longer tracked on this server.\n*Match history is kept.*",
        error: "❌ Error while removing the account.",
    },

    list: {
        title: "📋 Tracked accounts",
        footer: ({ count }) => `${count} ${plural(count, "account", "accounts")} in total`,
        sortedByRank: "🏆 *Sorted by rank (highest first)*",
        provisional: "*prov.*",
        userNotFound: "⚠️ User/Channel not found",
        dpmLeaderboard: "ℹ️ DPM leaderboard",
    },

    stats: {
        noRating: "❔ No rating yet (no games)",
        provisional: "*provisional*",
        noStreak: "➖ No active streak",
        requestedBy: "*Analysis requested by {user}*",
        rankTitle: "🏆 **RANK & PROGRESSION**",
        lpLast50: "{lp} LP (last 50)",
        performanceTitle: "⚡ **RECENT PERFORMANCE**",
        serverTitle: "🌐 **SERVER LEADERBOARD**",
        gamesAnalyzed: ({ count }) => `🎯 ${count} ${plural(count, "game", "games")} analyzed`,
        championsTitle: "🏆 RECENT CHAMPIONS",
        footer: "🔄 {time} • Cache 10 min",
        localData: "🔗 Local data only",
        lastKnownRank: "🏆 **LAST KNOWN RANK**",
        savedLocally: "⚠️ Data saved locally",
        apiUnavailable: "Riot API unavailable – Try again later",
        buttons: {
            refresh: "🔄 Refresh",
            lpChart: "📈 LP Graph",
            history: "📜 Match History",
            ratingInfo: "🧮 Rating info",
        },
    },

    history: {
        title: "📜 {riotId}'s match history",
        lastMatches: ({ count }) => `**Last ${count} ${plural(count, "match", "matches")}**`,
        maxAvailable: "(maximum available)",
        fieldTitle: "🎮 Match history",
        noMatchesFound: "No matches found",
        statsTitle: "📊 Overall stats",
        avgKda: "⚔️ **Average KDA:** {kda}",
        totalLp: "{emoji} **Total LP:** {lp}",
        winrate: "🎯 **Winrate:** {wins}W-{losses}L ({winrate}%)",
        remakes: ({ count }) => `⚪ **${plural(count, "Remake", "Remakes")}:** ${count} (not counted)`,
        minutesAgo: "{n}m ago",
        hoursAgo: "{n}h ago",
        daysAgo: "{n}d ago",
        noMatchesFor: "❌ No matches found for **{riotId}**.",
        noMatches: "❌ No matches found.",
        error: "❌ Error while fetching the match history.",
        modalTitle: "📜 Match history",
        modalLabel: "Number of matches to show (1-25)",
        overLimit: "⚠️ Limit exceeded! Showing **25 matches** maximum.",
    },

    ingame: {
        roles: {
            TOP: "Top",
            JUNGLE: "Jungle",
            MID: "Mid",
            ADC: "ADC",
            SUPPORT: "Support",
            NONE: "Unknown role",
        },
        teams: {
            100: "🔵 Blue side",
            200: "🔴 Red side",
        },
        queue: "Queue {id}",
        loading: "🔜 Loading...",
        versusTitle: "⚔️ Face-off in {queue}",
        duoTitle: "🤝 Duo Q",
        groupTitle: "👥 Group of {count} in {queue}",
        winrateLine: "📊 **{winrate}%** WR ({wins}W {losses}L)",
        checking: ({ count }) => `🔍 Checking ${count} ${plural(count, "player", "players")}...`,
        noneTitle: "🎮 Players in game",
        noneDescription: "😴 No tracked player is currently in SoloQ or Flex.",
        playersChecked: ({ count }) => `${count} ${plural(count, "player", "players")} checked`,
        apiErrors: ({ count }) => `⚠️ ${count} API ${plural(count, "error", "errors")}`,
        inGameCount: ({ count, total }) => `${count}/${total} ${plural(total, "player", "players")} in game`,
        hiddenGames: ({ count }) => `${count} ${plural(count, "game", "games")} not shown`,
        summary: ({ count, games }) =>
            `🎮 **${count}** ${plural(count, "player", "players")} in game · ${games} ${plural(games, "game", "games")}`,
    },

    flex: {
        thumbnails: {
            gif: "🎞️ Animated GIF (each champion + their role)",
            mosaique: "🧩 Mosaic (all champions in one image)",
        },
        enabled: "Flex notifications **enabled**",
        disabled: "Flex notifications **disabled**",
        thumbnailChanged: "thumbnail: **{label}**",
        title: "⚙️ Flex notifications",
        currentSettings: "Current server settings:",
        flexGames: "Flex games",
        notified: "✅ Posted *(not counted in stats, LP or ratings)*",
        notNotified: "❌ Not posted",
        groupThumbnail: "Group thumbnail (3+ players / face-off)",
        footerChanged: "Changed by {user} · /flex enabled / thumbnail to change",
        footer: "/flex enabled / thumbnail to change",
    },

    clear: {
        channel: "Channel",
        invalidChannelTitle: "❌ Invalid channel",
        invalidChannel: "The specified channel is not a text channel.",
        channelNotFoundTitle: "❌ Channel not found",
        channelNotFound: "Unable to find the channel with ID: `{id}`",
        checkTitle: "Check that",
        checkList: "• The ID is correct\n• The bot has access to the channel\n• The channel exists on this server",
        progressTitle: "⏳ Deleting...",
        progress: "**{count}** messages deleted so far...",
        noteTitle: "⚠️ Note",
        note: "Don't close Discord during the operation.",
        doneTitle: "🧹 Messages deleted",
        done: "✅ **{count}** messages have been deleted!",
        executedBy: "Executed by",
        specialUser: "(Special user)",
        admin: "(Administrator)",
        errorTitle: "❌ Error",
        error: "Unable to delete the messages.",
        missingPermissions: "Missing permissions.",
        missingPermissionsDetails: "The bot doesn't have the required permissions in this channel.",
        details: "Details",
    },

    forcerecap: {
        ownerOnly: "This command is reserved for the bot owner.",
        success: "**Weekly recap forced successfully!**\n\nCheck the configured channels to see the results.",
        error: "❌ **Error while generating the recap:**\n```{message}```",
    },

    help: {
        title: "📖 Documentation — Ambessa Bot",
        description: "Here's a quick overview of the available commands.\nFor the full documentation, click the button below!\n\n> 🔗 **{url}**",
        fullDocs: "📖 Full documentation",
        commands: {
            add: { description: "Add a League of Legends account to tracking", usage: "/add riot-id: Name#TAG" },
            remove: { description: "Remove an account from tracking", usage: "/remove player: Name#TAG" },
            list: { description: "Show all accounts tracked on this server", usage: "/list" },
            stats: { description: "Detailed player statistics with performance analysis", usage: "/stats player: Name#TAG" },
            history: { description: "A player's recent match history (1 to 25)", usage: "/history player: Name#TAG [count: 5]" },
            ingame: { description: "Show all tracked accounts currently in game", usage: "/ingame" },
            flex: {
                description: "Flex game notifications and group thumbnail style (admins only)",
                usage: "/flex [enabled: true / false] [thumbnail: GIF / Mosaic]",
            },
            language: { description: "Change the bot language (admins only)", usage: "/language language: English / Français" },
        },
    },

    language: {
        title: "🌐 Language",
        changed: "✅ The bot now speaks **{language}** on this server.",
        current: "Current language: **{language}**",
        available: "Available languages",
        commandsUpdating: "*Slash command descriptions are being updated, this may take a few seconds.*",
    },

    // ─── Buttons / interactions ───────────────────────────────────────────────
    buttons: {
        refreshed: "🔄 **Cache refreshed!**\nRun `/stats` again to see the new data.",
        unknown: "❓ Unknown button: {id}",
        lpChartTitle: "📊 Rank evolution",
        lpChartDescription: "Evolution graph for **{riotId}**",
        noRankedGame: "❔ **{riotId}** has no recorded ranked game yet.",
        matchDataNotFound: "❌ Match data not found.",
        share: "📢 Send to everyone",
        gameScore: "🧮 Rating breakdown",
        noRemakeScore: "⚪ No rating for a remake.",
        scoreUnavailable: "❌ Rating unavailable for this game.",
        pickerPlaceholder: "See another player's rating",
        pickerScore: "Rating {score}/100 ({grade})",
    },

    graph: {
        title: "ELO HISTORY",
        notEnoughData: "Not enough data to generate the graph",
    },

    // ─── Player rating ────────────────────────────────────────────────────────
    rating: {
        tiers: {
            "S+": "🌟 CANNA-MESSI-CR7",
            S: "🔥 EXCELLENT",
            A: "⭐ VERY GOOD",
            B: "✅ SOLID",
            C: "⚡ AVERAGE",
            D: "❌ BAD",
            Z: "❄️ RAZMO TIER",
        },
        categories: {
            combat: "⚔️ Combat",
            farm: "🌾 Farm",
            lane: "🥊 Lane",
            vision: "👁️ Vision",
            objectives: "🏰 Objectives",
        },
        metrics: {
            kda: "KDA",
            kill_participation: "Kill participation",
            damage_share: "Damage share",
            solo_kills: "Solo kills",
            cs_per_min: "CS/min",
            cs_10: "CS at 10 min",
            jungle_cs_10: "Jungle CS at 10 min",
            vision_per_min: "Vision/min",
            control_wards: "Control wards bought",
            wards_killed: "Wards destroyed",
            turret_takedowns: "Turrets destroyed",
            team_grubs: "Void grubs (team)",
            team_heralds: "Rift Herald (team)",
            early_dragons: "First 2 dragons",
            early_objective: "Herald or 3 grubs",
            gold_diff_15: "Gold diff at 15 min",
            xp_diff_15: "XP diff at 15 min",
            cs_diff_15: "CS diff at 15 min",
            epic_monsters: "Dragons + Barons",
        },
        evolution: "{emoji} {diff} ({days}d)",

        // Player rating card
        title: "🧮 {riotId}'s rating",
        serverRank: "🏅 **#{position}** / {total} in the server rating leaderboard",
        evolutionLine: "📊 Evolution: {list}",
        mainRole: ({ role, count }) => `🎭 Main role: **${role}** (${count} ${plural(count, "game", "games")})`,
        mainRoleUnknown: "🎭 Main role: *unknown (old games without detailed stats)*",
        gamesAnalyzed: ({ count }) => `🎯 ${count} ${plural(count, "game", "games")} analyzed`,
        detailedGames: " ({count} with detailed stats)",
        provisional: "⚠️ *Provisional rating: fewer than {min} games, it is pulled towards 50 (raw rating: {raw}/100)*",
        performance: "🎮 In-game performance — {points}",
        noData: "No data",
        statsDetail: "📊 Stats breakdown",
        target: "*(target {target})*",
        results: "🏆 Results — {points}",
        winrateLine: "Winrate **{winrate}%** ({wins}W-{losses}L) → {points}",
        avgLpLine: "Average LP **{lp}**/game → {points}",
        form: "🔥 Form — {points}",
        formWinrate: "**{winrate}%** over the last {count}",
        noStreak: "➖ No streak",

        // Game rating breakdown
        gameTitle: "🧮 Game rating — {score}/100 ({grade})",
        gameExplanation: "*Each stat earns points between its min (0%) and its target (100%).*",
        heraldTaken: "Taken",
        heraldNotTaken: "Not taken",
        heraldScale: "scale: taken = 100%",
        scale: "scale {min} → {target}",
        notCounted: "{label} — not counted",
        laneUnavailable: "*15-min stats unavailable (game < 15 min or missing timeline)*",
        dataUnavailable: "*Data unavailable for this game*",
        metricUnavailable: "*not available*",
        pointsLostOn: "📉 **Points mostly lost on:** {list}",
        almostAll: "🌟 **Almost all points earned!**",
        totalWithMalus: "🧾 Total: {raw}/100 × {multiplier} ({role} penalty) = **{score}/100**",
        total: "🧾 Total: **{score}/100**",
        summary: "📌 Summary",
    },

    // ─── Match notifications ──────────────────────────────────────────────────
    match: {
        victory: "🟢 VICTORY",
        defeat: "🔴 DEFEAT",
        remake: "⚪ REMAKE",
        remakeDescription: "{player} just had a remake!",
        finishedDescription: "{player} just finished a game!",
        notCounted: "*This game does not count in the stats.*",
        duoWith: "👥 Duo with {names}",
        against: "⚔️ Against {names}",
        pentakill: "🔥 **PENTAKILL x{count}** 🔥",
        quadrakill: "⚡ **QUADRA KILL x{count}**",
        performance: "🎯 Performance",
        championLevel: "🏆 {champion} (Lvl.{level})",
        lpChange: "📊 LP Change",
        duration: "⏱️ Duration",
        minutes: "{n}min",
        gameScore: "🧮 Game rating",
        serverRank: "🏅 Server leaderboard",
        detailedStats: "📊 Detailed stats",
        duoQ: "👥 DuoQ",
        groupOf: "👥 Group of {count}",
        and: "&",
        groupRemake: "👥 {names} had a remake together.",
        groupFaceOff: "⚔️ {names} faced each other!",
        damage: "{damage} damage",
        flexRemake: "⚪ FLEX REMAKE",
        flexFaceOff: "⚔️ FLEX FACE-OFF",
        flexVictory: "🟢 FLEX VICTORY",
        flexDefeat: "🔴 FLEX DEFEAT",
        trackedPlayers: "👥 {count} tracked players",
        teamVictory: "🟢 Victory",
        teamDefeat: "🔴 Defeat",
        teamRemake: "⚪ Remake",
        promotion: "📈 PROMOTION!",
        demotion: "📉 DEMOTION",
        rankChanged: "**{riotId}** changed rank!",
        oldRank: "Previous rank",
        newRank: "New rank",
        renameTitle: "✏️ NAME CHANGE",
        renameDescription: "**{oldRiotId}** is now called [**{newRiotId}**]({url})!",
    },

    detailedStats: {
        title: "Detailed game stats",
        allies: "Allied team",
        enemies: "Enemy team",
        victory: "Victory",
        defeat: "Defeat",
        remake: "Remake",
        duration: "{minutes} min",
        yourScore: "Game rating: **{score}/100** ({grade})",
        versus: "Against {champion}",
        requestedBy: "Requested by {user}",
        score: "Rating",
        columnDamage: "Damage",
        perMin: "{value}/min",
        gold: "💰 Gold",
        goldDiff15: "⏱️ Gold @15",
        xpDiff15: "⏱️ XP @15",
        damage: "💥 Damage",
        vision: "👁️ Vision",
        csDiff15: "⏱️ CS @15",
        csTotal: "🌾 CS",
        assists15: "🛡️ Assists @15",
        soloKills: "🗡️ Solo kills",
    },

    // ─── Weekly recap ─────────────────────────────────────────────────────────
    recap: {
        title: "🏆 WEEKLY RECAP",
        week: "📅 **Week of {start} to {end}**",
        players: "📈 **PLAYERS OF THE WEEK:**",
        games: "🎮 **{count} games** ({wins}W • {losses}L - {winrate}% WR)",
        rating: "🧮 **Rating:** {score}/100 ({grade}){diff}",
        ratingUp: " • 📈 +{diff} this week",
        ratingDown: " • 📉 {diff} this week",
        ratingStable: " • ➖ stable",
        favoriteChampion: "🦹 **Favorite champion:** {champion} ({games} games - {winrate}% WR)",
        avgKda: "⚔️ **Average KDA:** {kda}",
        globalStats: "📊 **GLOBAL STATS**",
        totalGames: "• Total games: {games} • Group WR: {winrate}%",
        groupLp: "• Group net LP: {lp} LP",
        tooManyPlayers: "*... (too many players to display them all)*",
        footer: "Recap generated on {date}",
    },

    // ─── Bot owner ────────────────────────────────────────────────────────────
    owner: {
        apiDown: "**RIOT API DOWN** - The API key no longer works!",
    },
};
