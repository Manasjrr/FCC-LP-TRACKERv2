# FCC-LP-TRACKERv2

> A Discord bot that automatically monitors League of Legends player accounts and reports their ranked performance in real time.

---

## 📋 Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Commands](#commands)
- [License](#license)

---

## Overview

**FCC-LP-TRACKERv2** is the official Discord bot of the **FCC community**, designed to track League of Legends Solo/Duo Queue ranked games for a list of monitored players. Built and maintained by **Manas**. It automatically detects new matches, posts win/loss alerts in designated channels, and provides detailed statistics, rank history, LP graphs, and weekly recaps — all from Discord slash commands.



---

##  Features

- 🔍 **Automatic match detection** — polls the Riot API at regular intervals to catch new ranked games
- 📊 **Detailed player stats** — winrate, KDA, LP trend, top champions, performance score
- 📈 **LP progression graph** — visual chart of LP gains and losses over time
- 🏆 **Weekly recap** — automated summary posted every **Friday at 6:00 PM (Paris time)** covering each tracked player's ranked week
- 📜 **Match history** — display the last N ranked games for any tracked player (max 30)
- ➕ **Player management** — add, remove, list and clear tracked accounts per server
- 🥇 **Server leaderboard** — rank all tracked players on the server by their ELO

---

## 🗂️ Architecture

```
FCC-LP-TRACKERv2/
├── index.js                 # Entry point — bot init, monitoring loop, event handling
├── players.db               # SQLite database (auto-generated)
├── .env                     # Environment variables (see Configuration)
│
├── commands/
│   ├── add.js               # Add a player to monitoring
│   ├── remove.js            # Remove a player from monitoring
│   ├── list.js              # List all monitored players on the server
│   ├── clear.js             # Remove all monitored players / clear channel messages
│   ├── link.js              # Link a Discord account to a LoL account
│   └── stats.js             # Display detailed stats for a player
│
└── utils/
    ├── rankUtils.js         # Rank emoji, rank ordering, score helpers
    ├── graphUtils.js        # LP progression chart generation (Canvas)
    ├── weeklyRecap.js       # Weekly recap embed builder and scheduler
    └── historyUtils.js      # Match history formatting and embed builder
    └── loggers.js           # Fichier d'initialisation des logs
```

---

## 🛠️ Prerequisites

- [Node.js](https://nodejs.org/) v18 or higher
- A [Discord Application](https://discord.com/developers/applications) with a bot token
- A [Riot Games API key](https://developer.riotgames.com/) (Development or Production)

---

## 🚀 Installation

```bash
# 1. Clone the repository
git clone https://github.com/your-username/FCC-LP-TRACKERv2.git
cd FCC-LP-TRACKERv2

# 2. Install dependencies
npm install

# 3. Create and fill in your environment file
cp .env.example .env
# Then edit .env with your values (see below)

# 4. Start the bot
node index.js
```

---

## ⚙️ Configuration

Create a `.env` file at the root of the project with the following variables:

```env
DISCORD_TOKEN=
CLIENT_ID=
RIOT_API_KEY=
OWNER_ID=
```

| Variable | Description |
|---|---|
| `DISCORD_TOKEN` | Your Discord bot's secret token. Found in the [Discord Developer Portal](https://discord.com/developers/applications) under your application → **Bot** → **Token**. |
| `CLIENT_ID` | The application ID of your Discord bot. Found in the Developer Portal under **General Information** → **Application ID**. Used to register slash commands. |
| `RIOT_API_KEY` | Your Riot Games API key. Obtainable from the [Riot Developer Portal](https://developer.riotgames.com/). Development keys expire every 24 hours; a production key is recommended for permanent deployment. |
| `OWNER_ID` | The Discord user ID of the bot owner. Used to restrict sensitive administrative commands to a single trusted user. |

## 💬 Commands

| Command | Description |
|---|---|
| `/add` | Add a League of Legends account to the monitoring list |
| `/remove` | Remove a tracked account from the server |
| `/list` | Display all accounts currently being monitored |
| `/stats` | Show detailed ranked stats for a tracked player |
| `/link` | Link your Discord account to your League of Legends account |
| `/clear` | Delete messages in a channel (ADMIN AND OWNER ONLY) |

---

## 📦 Key Dependencies

| Package | Purpose |
|---|---|
| `discord.js` | Discord API interactions and slash commands |
| `better-sqlite3` | Local database for storing players and match history |
| `axios` | HTTP requests to the Riot Games API |
| `node-cron` | Scheduled tasks (monitoring loop, weekly recap) |
| `canvas` | Server-side LP graph image generation |

---
