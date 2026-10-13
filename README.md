# FCC-LP-TRACKERv2

> The Discord bot of the **FCC community**: it automatically monitors League of Legends accounts and reports their ranked games in real time. Built and maintained by **Manas**.

---

## Table of Contents

- [Features](#features)
- [Player Rating](#player-rating)
- [Commands](#commands)
- [Installation](#installation)
- [Configuration](#configuration)
- [Deployment & Updates](#deployment--updates)
- [Languages](#languages)
- [Architecture](#architecture)
- [License](#license)

---

## Features

- 🔍 **Automatic match detection** — checks whether each player is in a ranked game, then follows that game every 2 minutes until it ends: notifications arrive as fast as with constant polling, with ~60% fewer Riot API calls
- 👥 **Duo detection** — tracked players in the same team are grouped into a single "duo" embed (one block per player, duration and match ID shown once, thumbnail with both champions). Opponents in the same game are shown as a "⚔️ face-off"
- 🟣 **Flex notifications (optional)** — enabled per server with `/flex`: every Flex game of the tracked players is posted as a single embed (KDA, CS, damage). Flex games are notification only and never count in stats, LP or ratings
- 🧮 **Player rating (/100)** — role-aware score with a letter grade and its evolution over 7 / 30 days, shown in `/stats`, `/list` and the "🧮 Infos note" button (see [Player Rating](#player-rating))
- 🎯 **Game rating** — every match notification shows the player's performance in that game, out of 100, according to the role played
- 📊 **Detailed player stats** — rank, winrate, KDA, LP trend, rating, top champions and server leaderboard
- 📜 **Match history** — last N ranked games (1-25) for any tracked player, via `/history` or the `/stats` button
- 📈 **LP progression graph** — visual chart of LP gains and losses over time
- 🏆 **Weekly recap** — automated summary posted every **Friday at 6:00 PM (Paris time)**, with each player's rating and its weekly evolution
- ➕ **Player management** — add, remove and list tracked accounts per server
- 🌐 **Multilingual** — English by default on every new server, switch to French (or any added language) with `/language` (see [Languages](#languages))
- ⚡ **API-efficient** — every stat is extracted from data the bot already downloads (match + timeline): a match shared by several tracked players is only fetched once, and timelines are cached. Every Riot API call is counted and a daily report is written to `logs/api.log`
- 🚨 **Riot API outage alert** — the owner receives a DM when every Riot API call has been failing for 6 minutes (one DM per outage)

---

## Player Rating

Each player gets a score out of **100** computed from their **30 most recent ranked games** (remakes excluded): 75 points of in-game performance (judged according to the **role played** in each game), 20 points of results (winrate + LP) and 5 points of form. Fewer than 10 games: the rating is **provisional**.

Each match notification also shows a **game rating**: the in-game performance of that single game, out of 100.

| Score | Grade | Tier |
|---|---|---|
| 85-100 | S+ | 🌟 CANNA-MESSI-CR7 |
| 69-84 | S | 🔥 EXCELLENT |
| 60-68 | A | ⭐ TRÈS BON |
| 52-59 | B | ✅ SOLIDE |
| 44-51 | C | ⚡ MOYEN |
| 35-43 | D | ❌ MAUVAIS |
| 0-34 | Z | ❄️ RAZMO TIER |

<details>
<summary><b>How the rating is computed</b></summary>

<br>

| Component | Points | Details |
|---|---|---|
| 🎮 In-game performance | 75 | Each game is scored according to the **role played in that game**, comparing the player's stats to role-specific targets |
| 🏆 Results | 20 | Winrate from 35% to 65% (14 pts) + average LP per game from −10 to +10 (6 pts) |
| 🔥 Form | 5 | Winrate over the last 10 games: 30% → 0 pts, 50% → 2.5 pts, 80% → 5 pts |

**Performance weights per role (relative weights, total 60, scaled to 75):**

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
- **Vision**: vision score/min (+ control wards and destroyed wards for Jungle/Support — Jungle control wards count half as much as vision/min)
- **Objectives**: turrets (Top), dragons + barons (Jungle), team void grubs / Rift Herald / first 2 dragons (Support)
- Support performance has a −10% modifier
- Games recorded without detailed stats are rated on KDA only
- Fewer than 10 games: the rating is pulled towards 50

**Evolution:** the rating can be recomputed as it was at any past date (using only the games played before that date), which gives the evolution over 7 / 30 days in `/stats` and "Infos note", and over the week in the weekly recap — without storing any history.

All weights, targets and tiers are configured in [`utils/ratingUtils.js`](utils/ratingUtils.js) (`ROLE_PROFILES`, `ROLE_PERFORMANCE_MULTIPLIER`, `RATING_TIERS`, `FORM_SCALE`).

</details>

---

## Commands

| Command | Description |
|---|---|
| `/add riot-id` | Add a League of Legends account to the monitoring list |
| `/remove player` | Remove a tracked account from the server |
| `/list` | Display all monitored accounts, sorted by rank, with their rating (/100 + grade) |
| `/stats player` | Detailed ranked stats and rating of a tracked player |
| `/history player [count]` | Last N ranked games (1-25, default 5) of a tracked player |
| `/ingame` | Show all monitored players currently in game (SoloQ / Flex) |
| `/help` | Show the commands documentation |
| `/language [language]` | Change the bot language on the server, or show the current one *(changing it: Admin and Owner only)* |
| `/clear [count] [channel]` | Delete messages in a channel *(Admin and Owner only)* |
| `/flex [enabled] [thumbnail]` | Enable / disable Flex game notifications, choose the group thumbnail (animated GIF or mosaic), or show the current settings *(Admin and Owner only)* |
| `/forcerecap` | Force the weekly recap *(Owner only)* |

The `player` options support autocompletion with the players tracked on the server.

**`/stats` buttons:**

| Button | Description |
|---|---|
| 🔄 Refresh | Refresh reminder |
| 📈 LP Graph | LP progression graph |
| 📜 Match History | Match history (choose the number of games) |
| 🧮 Rating info | Rating breakdown: score, server rating ranking, main role, categories, per-stat details vs. targets, results and form |

**Match notification button:** 📊 Detailed stats — full game breakdown (teams, lane opponent comparison, @15 timeline diffs), with two buttons:
- 📢 Send to everyone — share the breakdown publicly
- 🧮 Rating breakdown — game rating breakdown: for each stat of the role played, its value, its scale (min → target), the points earned / possible and the points lost, plus a summary of the stats that cost the most points

---

## Installation

**Prerequisites:** [Node.js](https://nodejs.org/) v18 or higher, a [Discord Application](https://discord.com/developers/applications) with a bot token, a [Riot Games API key](https://developer.riotgames.com/).

```bash
# 1. Clone the repository
git clone https://github.com/Manasjrr/FCC-LP-TRACKERv2
cd FCC-LP-TRACKERv2

# 2. Install dependencies
npm install

# 3. Create a .env file at the root with your values (see Configuration)

# 4. Start the bot
npm start
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
| `OWNER_ID` | Discord user ID of the bot owner. Grants access to restricted administrative commands and receives the Riot API outage DM |

---

## Deployment & Updates

### Running on a server (e.g. with pm2)

```bash
pm2 start index.js --name fcc-lp-tracker --node-args="--max-semi-space-size=2"
```

`--max-semi-space-size=2` lowers memory usage (it is also used by `npm start`). If squares appear instead of letters in the generated images, install system fonts: `sudo apt install fontconfig fonts-liberation`.

### Updating the bot

```bash
pm2 stop fcc-lp-tracker              # 1. stop the bot (closes the database cleanly)
cp players.db* ~/backup-db/          # 2. back up the database (recommended)
git fetch origin                     # 3. get the latest code
git reset --hard origin/main         #    and replace the local code with it
pm2 start fcc-lp-tracker             # 4. restart (migrations run automatically)
```

- `players.db`, `players.db-wal` and `players.db-shm` are ignored by git: **git never touches the database** (`fetch`, `reset --hard`, `pull`)
- ⚠️ Never run `git clean -x` on the server: it deletes ignored files, including the database and the logs
- ⚠️ Never commit the database: the repository is public and the database contains Discord IDs and Riot accounts

---

## Languages

The bot speaks **English** by default: every server that adds it gets English messages and slash command descriptions. An administrator can switch the server to another language with `/language`:

- the setting is stored per server (`guild_settings.language`) and applies to everything the bot posts there: command replies, buttons, match notifications, rank / name changes and the weekly recap
- the slash command descriptions are redeployed on that server in the new language (option names keep their technical English name; clients using that language see the translated name, e.g. `joueur` in French)

**Adding a language:** copy `locales/en.js` to `locales/<code>.js` (e.g. `es.js`), translate the values — keys and `{variables}` must stay unchanged — and fill in `meta` (`name`, Intl `locale`, Discord `discordLocale`). The language is loaded automatically and appears in the `/language` choices after a restart. Any key missing from a language falls back to English.

---

## Architecture

<details>
<summary><b>Project structure</b></summary>

<br>

```
FCC-LP-TRACKERv2/
│
├── index.js          # Entry point — initializes bot, events, cron jobs, monitoring loop, graceful shutdown
├── players.db        # better-SQLite3 database (auto-generated, never committed)
├── .env              # Environment variables (never committed)
├── logs/             # Log files: one per day, errors.log, api.log (auto-generated, never committed)
│
├── assets/
│   └── fonts/        # Arimo font (SIL OFL) used for every generated image
│
├── cache/
│   ├── ttlCache.js       # Bounded in-memory cache (expiration + max size, LRU)
│   ├── matchCache.js     # In-memory cache for match data (reduces API calls)
│   └── timelineCache.js  # In-memory cache for match timelines (compacted)
│
├── commands/
│   ├── add.js          # Add a player to monitoring
│   ├── remove.js       # Remove a tracked player
│   ├── list.js         # List all monitored players (rank + rating)
│   ├── stats.js        # Detailed stats and rating for a player
│   ├── history.js      # Match history for a player
│   ├── ingame.js       # Show tracked players currently in game
│   ├── clear.js        # Delete messages (Admin/Owner only)
│   ├── flex.js         # Enable / disable Flex notifications (Admin/Owner only)
│   ├── force-recap.js  # Force the weekly recap (Owner only)
│   ├── language.js     # Change the bot language on the server (Admin/Owner only)
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
├── locales/
│   ├── en.js         # English texts (default language, reference file)
│   └── fr.js         # French texts
│
├── handlers/
│   ├── commandHandler.js      # Load + deploy slash commands dynamically
│   └── interactionHandler.js  # Central router for commands, buttons, and modals
│
├── scripts/
│   ├── backfillMatchStats.js  # One-off backfill of detailed / timeline stats for older games
│   └── testFlexNotif.js       # Sends a fake Flex notification on a test server
│
├── services/
│   ├── matchService.js       # Match processing (LP calc, remake detection, stats, timeline, Riot ID sync)
│   ├── monitoringService.js  # Main loop — per-player schedule (in game / active / inactive), new matches,
│   │                         # (grouped) notifications, API outage alert, hourly heartbeat
│   └── riotApiService.js     # Riot API wrapper (retry, rate limit handling, call counting, endpoints)
│
└── utils/
    ├── playerUtils.js      # Player lookups, server ranking, DPM links, shared autocomplete
    ├── guildSettings.js    # Per-server settings (Flex notifications)
    ├── i18n.js             # Translations: per-server language, translator, localized slash commands
    ├── ratingUtils.js      # Role-aware player rating (/100)
    ├── matchStatsUtils.js  # Detailed match stats extraction (match + timeline)
    ├── historyUtils.js     # Match history embed builder
    ├── rankUtils.js        # Rank emoji and ordering helpers
    ├── championUtils.js    # Champion names / ids / icons
    ├── thumbnailUtils.js   # Notification thumbnails (bot lane duo, group mosaic / animated GIF)
    ├── scoreboardUtils.js  # Scoreboard image of a game ("Detailed stats")
    ├── graphUtils.js       # LP graph generation (Canvas)
    ├── fonts.js            # Registers the bundled font before any image is drawn
    ├── weeklyRecap.js      # Weekly recap builder and sender
    ├── apiUsage.js         # Riot API call counter + daily report in logs/api.log
    └── loggers.js          # Console and file logger (Paris time, buffered writes)
```

</details>

---

## License

This project is open to everyone within the **FCC community** and beyond.
Maintained by **Manas**.

💡 Got ideas or improvements? Don't hesitate to reach out!
Discord: **scotted**

Currently deployed on a limited number of servers, planning to expand
once the Riot production API key is approved.
