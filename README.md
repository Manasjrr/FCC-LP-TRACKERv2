# FCC-LP-TRACKERv2

> A Discord bot that automatically monitors League of Legends player accounts and reports their ranked performance in real time.

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Player Rating](#player-rating)
- [Match Data](#match-data)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Commands](#commands)
- [Maintenance](#maintenance)
- [Dependencies](#dependencies)
- [License](#license)

---

## Overview

**FCC-LP-TRACKERv2** is the official Discord bot of the **FCC community**, designed to track League of Legends Solo/Duo Queue ranked games for a list of monitored players. Built and maintained by **Manas**.

It automatically detects new matches, posts win/loss alerts in designated channels, and provides detailed statistics, a role-aware player rating, match history, LP graphs and weekly recaps — all from Discord slash commands.

---

## Features

- 🔍 **Automatic match detection** — polls the Riot API every 2 minutes to catch new ranked games
- 👥 **Duo detection** — tracked players in the same game are grouped into a single notification (duo header with each player's role + their usual match embeds). Opponents in the same game are shown as a "⚔️ face-off"
- 🧮 **Player rating (/100)** — role-aware score with a letter grade and its evolution over 7 / 30 days, shown in `/stats`, `/list` and the "🧮 Infos note" button (see [Player Rating](#player-rating))
- 🎯 **Game rating** — every match notification shows the player's performance in that game, out of 100, according to the role played
- 📊 **Detailed player stats** — rank, winrate, KDA, LP trend, rating, top champions and server leaderboard
- 📜 **Match history** — last N ranked games (1-25) for any tracked player, via `/history` or the `/stats` button
- 📈 **LP progression graph** — visual chart of LP gains and losses over time
- 🏆 **Weekly recap** — automated summary posted every **Friday at 6:00 PM (Paris time)**, with each player's rating and its weekly evolution
- ➕ **Player management** — add, remove and list tracked accounts per server
- ⚡ **API-efficient** — every stat is extracted from data the bot already downloads (match + timeline): a match shared by several tracked players is only fetched once, and timelines are cached

---

## Player Rating

Each player gets a score out of **100** computed from their **30 most recent ranked games** (remakes excluded). No extra Riot API call is needed: everything comes from the match history stored in the database.

| Component | Points | Details |
|---|---|---|
| 🎮 In-game performance | 60 | Each game is scored according to the **role played in that game**, comparing the player's stats to role-specific targets |
| 🏆 Results | 30 | Winrate from 35% to 65% (20 pts) + average LP per game from −10 to +10 (10 pts) |
| 🔥 Form | 10 | Winrate over the last 10 games: 30% → 0 pts, 50% → 5 pts, 80% → 10 pts |

**Performance weights per role (out of 60):**

| Role | ⚔️ Combat | 🌾 Farm | 🥊 Lane | 👁️ Vision | 🏰 Objectives |
|---|---|---|---|---|---|
| Top | 18 | 12 | 14 | 6 | 10 |
| Jungle | 22 | 10 | — | 12 | 16 |
| Mid | 24 | 14 | 14 | 8 | — |
| ADC | 22 | 18 | 14 | 6 | — |
| Support | 25 | — | — | 25 | 10 |

- **Combat**: KDA, kill participation, damage share (+ solo kills for Top/Mid)
- **Farm**: CS/min, CS at 10 min
- **Lane**: gold, XP and CS difference against the direct lane opponent at 15:00 (from the match timeline)
- **Vision**: vision score/min (+ control wards and destroyed wards for Jungle/Support)
- **Objectives**: turrets (Top), dragons + barons (Jungle), team void grubs / Rift Herald / first 2 dragons (Support)
- Support performance has a −10% modifier
- Games recorded without detailed stats are rated on KDA only
- Fewer than 10 games: the rating is **provisional** and pulled towards 50

**Evolution:** the rating can be recomputed as it was at any past date (using only the games played before that date), which gives the evolution over 7 / 30 days in `/stats` and "Infos note", and over the week in the weekly recap — without storing any history.

**Game rating:** the in-game performance of a single game (role-based, results and form excluded), scaled to 100. Shown in each match notification.

**Grades:**

| Score | Grade | Tier |
|---|---|---|
| 85-100 | S+ | 🌟 CANNA-MESSI-CR7 |
| 72-84 | S | 🔥 EXCELLENT |
| 60-71 | A | ⭐ TRÈS BON |
| 48-59 | B | ✅ SOLIDE |
| 35-47 | C | ⚡ MOYEN |
| 0-34 | Z | ❄️ RAZMO TIER |

All weights, targets and tiers are configured in [`utils/ratingUtils.js`](utils/ratingUtils.js) (`ROLE_PROFILES`, `ROLE_PERFORMANCE_MULTIPLIER`, `RATING_TIERS`, `FORM_SCALE`).

---

## Match Data

Every ranked game is stored in the `match_history` table with:

- **Core data** — champion, K/D/A, win, LP change, rank before/after, duration, remake flag
- **Detailed stats** — role, lane opponent, CS, gold, damage (dealt, taken, share), kill participation, vision, wards, objectives, multi-kills, items, summoner spells, runes (see [`utils/matchStatsUtils.js`](utils/matchStatsUtils.js))
- **Timeline stats** — gold / XP / CS difference against the lane opponent at 15:00, number of the first 2 dragons taken by the team
- **Raw data** — the full Riot participant object (`participant_json`), so any other stat can be extracted later (e.g. for a web dashboard)

The timeline is downloaded in the background when a new game is detected (once per match). If the download fails, it is retried automatically on the next monitoring cycles (up to 3 attempts, games under 7 days old).

New columns are created automatically at startup: to add a stat, declare it in `MATCH_STATS_COLUMNS` and fill it in `extractMatchStats`.

---

## Architecture

```
FCC-LP-TRACKERv2/
│
├── index.js          # Entry point — initializes bot, events, cron jobs, monitoring loop
├── players.db        # better-SQLite3 database (auto-generated)
├── .env              # Environment variables
│
├── cache/
│   ├── matchCache.js     # In-memory cache for match data (reduces API calls)
│   └── timelineCache.js  # In-memory cache for match timelines
│
├── commands/
│   ├── add.js          # Add a player to monitoring
│   ├── remove.js       # Remove a tracked player
│   ├── list.js         # List all monitored players (rank + rating)
│   ├── stats.js        # Detailed stats and rating for a player
│   ├── history.js      # Match history for a player
│   ├── ingame.js       # Show tracked players currently in game
│   ├── clear.js        # Delete messages (Admin/Owner only)
│   ├── force-recap.js  # Force the weekly recap (Owner only)
│   └── help.js         # Show the commands documentation
│
├── database/
│   └── initDB.js     # Database schema creation + indexes + migrations
│
├── embeds/
│   ├── detailedStatsEmbed.js # Advanced match stats embed (timeline + comparisons)
│   ├── matchEmbed.js         # Match notifications (solo, duo/group, remake), rank and Riot ID change embeds
│   └── ratingEmbed.js        # Player rating details ("Infos note" button)
│
├── handlers/
│   ├── commandHandler.js      # Load + deploy slash commands dynamically
│   └── interactionHandler.js  # Central router for commands, buttons, and modals
│
├── scripts/
│   └── backfillMatchStats.js  # One-off backfill of detailed / timeline stats for older games
│
├── services/
│   ├── matchService.js       # Match processing (LP calc, remake detection, stats, timeline, Riot ID sync)
│   ├── monitoringService.js  # Main loop — detects new matches and sends (grouped) notifications
│   └── riotApiService.js     # Riot API wrapper (retry, rate limit handling, endpoints)
│
└── utils/
    ├── playerUtils.js      # Player lookups, server ranking, DPM links, shared autocomplete
    ├── ratingUtils.js      # Role-aware player rating (/100)
    ├── matchStatsUtils.js  # Detailed match stats extraction (match + timeline)
    ├── historyUtils.js     # Match history embed builder
    ├── rankUtils.js        # Rank emoji and ordering helpers
    ├── championUtils.js    # Champion names / ids / icons
    ├── graphUtils.js       # LP graph generation (Canvas)
    ├── weeklyRecap.js      # Weekly recap builder and sender
    └── loggers.js          # Console and file logger
```

---

## Prerequisites

- [Node.js](https://nodejs.org/) v18 or higher
- A [Discord Application](https://discord.com/developers/applications) with a bot token
- A [Riot Games API key](https://developer.riotgames.com/) (Development or Production)

---

## Installation

```bash
# 1. Clone the repository
git clone https://github.com/Manasjrr/FCC-LP-TRACKERv2
cd FCC-LP-TRACKERv2

# 2. Install dependencies
npm install

# 3. Create and fill in your environment file
cp .env.example .env
# Then edit .env with your values (see Configuration)

# 4. Start the bot
node index.js
```

The database and its migrations are applied automatically at startup. After updating the code, **restart the bot** for the changes to take effect.

---

## Configuration

Create a `.env` file at the root of the project:

```env
DISCORD_TOKEN=
CLIENT_ID=
RIOT_API_KEY=
OWNER_ID=
```

| Variable | Description |
|---|---|
| `DISCORD_TOKEN` | Your Discord bot's secret token — [Developer Portal](https://discord.com/developers/applications) → Bot → Token |
| `CLIENT_ID` | Your bot's application ID — Developer Portal → General Information → Application ID |
| `RIOT_API_KEY` | Your Riot Games API key — [Riot Developer Portal](https://developer.riotgames.com/). Development keys expire every 24h; a production key is recommended for permanent deployment |
| `OWNER_ID` | Discord user ID of the bot owner. Grants access to restricted administrative commands |

---

## Commands

| Command | Description |
|---|---|
| `/add riot-id` | Add a League of Legends account to the monitoring list |
| `/remove joueur` | Remove a tracked account from the server |
| `/list` | Display all monitored accounts, sorted by rank, with their rating (/100 + grade) |
| `/stats joueur` | Detailed ranked stats and rating of a tracked player |
| `/history joueur [nombre]` | Last N ranked games (1-25, default 5) of a tracked player |
| `/ingame` | Show all monitored players currently in game (SoloQ / Flex) |
| `/help` | Show the commands documentation |
| `/clear [nombre] [channel]` | Delete messages in a channel *(Admin and Owner only)* |
| `/forcerecap` | Force the weekly recap *(Owner only)* |

The `joueur` options support autocompletion with the players tracked on the server.

**`/stats` buttons:**

| Button | Description |
|---|---|
| 🔄 Actualiser | Refresh reminder |
| 📈 Graphique LP | LP progression graph |
| 📜 Match History | Match history (choose the number of games) |
| 🧮 Infos note | Rating breakdown: score, server rating ranking, main role, categories, per-stat details vs. targets, results and form |

**Match notification button:** 📊 Stats détaillées — full game breakdown (teams, lane opponent comparison, @15 timeline diffs), with two buttons:
- 📢 Envoyer à tout le monde — share the breakdown publicly
- 🧮 Détail de la note — game rating breakdown: for each stat of the role played, its value, its scale (min → target), the points earned / possible and the points lost, plus a summary of the stats that cost the most points

---

## Maintenance

### Backfilling older games

Games recorded before the detailed stats were introduced can be completed with:

```bash
node scripts/backfillMatchStats.js [--delay 1500] [--limit 100] [--dry-run] [--db path.db]
```

- Downloads the match (and its timeline when needed) for each incomplete game, most recent first
- Uses **2 Riot API requests per game** — run it with a slow `--delay` if the bot is running at the same time (same API key)
- Can be stopped and restarted at any time: only incomplete games are processed
- `--dry-run` only displays how many games and requests would be needed

This is only needed once (e.g. after a long bot downtime): new games are filled automatically by the bot.

> 💡 Back up `players.db` before running scripts that write to the database.

---

## Dependencies

| Package | Purpose |
|---|---|
| `discord.js` | Discord API interactions and slash commands |
| `better-sqlite3` | Local SQLite database for players and match history |
| `axios` | HTTP requests to the Riot Games API |
| `node-cron` | Scheduled tasks (weekly recap on Fridays) |
| `canvas` | Server-side LP graph image generation |
| `dotenv` | Environment variable loading |
| `form-data` | File uploads (LP graph) |

---

## License

This project is open to everyone within the **FCC community** and beyond.
Maintained by **Manas**.

💡 Got ideas or improvements? Don't hesitate to reach out!
Discord: **scotted**

Currently deployed on a limited number of servers, planning to expand
once the Riot production API key is approved.
