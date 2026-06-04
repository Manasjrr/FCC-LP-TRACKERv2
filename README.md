# README

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
- [Dependencies](#dependencies)
- [License](#license)

---

## Overview

**FCC-LP-TRACKERv2** is the official Discord bot of the **FCC community**, designed to track League of Legends Solo/Duo Queue ranked games for a list of monitored players. Built and maintained by **Manas**.

It automatically detects new matches, posts win/loss alerts in designated channels, and provides detailed statistics, rank history, LP graphs, and weekly recaps — all from Discord slash commands.

---

## Features

- 🔍 **Automatic match detection** — polls the Riot API every 2 minutes to catch new ranked games
- 📊 **Detailed player stats** — winrate, KDA, LP trend, top champions, server leaderboard and performance score
- 📈 **LP progression graph** — visual chart of LP gains and losses over time
- 🏆 **Weekly recap** — automated summary posted every **Friday at 6:00 PM (Paris time)**
- 📜 **Match history** — display the last N ranked games for any tracked player (up to 25)
- ➕ **Player management** — add, remove, list and clear tracked accounts per server
- 🔗 **Account linking** — link a Discord user to their League of Legends account

---

## 🗂️ Architecture
```
FCC-LP-TRACKERv2/ 
│ 
├── index.js          # Entry point — boot, events, cron 
├── players.db        # SQLite database (auto-generated)
├── .env              # Environment variables
│
├── core/
│   ├── client.js     # Discord client setup
│   ├── database.js   # DB init and schema
│   ├── deploy.js     # Slash command deployment
│   └── monitoring.js # Match polling, LP logic, notifications
│
├── commands/
│   ├── add.js        # Add a player to monitoring
│   ├── remove.js     # Remove a tracked player
│   ├── list.js       # List all monitored players
│   ├── stats.js      # Detailed stats for a player
│   ├── link.js       # Link Discord to LoL account
│   └── clear.js      # Delete messages (Admin/Owner only)
│
├── handlers/
│   ├── commandHandler.js  # Routes slash commands
│   ├── buttonHandler.js   # Routes button interactions
│   └── modalHandler.js    # Routes modal submissions
│
└── utils/
    ├── rankUtils.js    # Rank emoji and ordering helpers
    ├── graphUtils.js   # LP graph generation (Canvas)
    ├── weeklyRecap.js  # Weekly recap builder and sender
    ├── historyUtils.js # Match history embed builder
    └── loggers.js      # Console and file logger
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
# Then edit .env with your values (see Configuration)

# 4. Start the bot
node index.js
```

---

## ⚙️ Configuration

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

## 💬 Commands

| Command | Description |
|---|---|
| `/add` | Add a League of Legends account to the monitoring list |
| `/remove` | Remove a tracked account from the server |
| `/list` | Display all accounts currently being monitored, sorted by rank |
| `/stats` | Show detailed ranked stats for a tracked player (by rank or linked account) |
| `/link` | Link your Discord account to your League of Legends account |
| `/clear` | Delete messages in a channel *(Admin and Owner only)* |

---

## 📦 Dependencies

| Package | Purpose |
|---|---|
| `discord.js` | Discord API interactions and slash commands |
| `better-sqlite3` | Local SQLite database for players and match history |
| `axios` | HTTP requests to the Riot Games API |
| `node-cron` | Scheduled tasks (weekly recap on Fridays) |
| `canvas` | Server-side LP graph image generation |
| `dotenv` | Environment variable loading |

---

## 📄 License

This project is open to everyone within the **FCC community** and beyond.  
Maintained by **Manas**.  

💡 Got ideas or improvements? Don't hesitate to reach out!  
Discord: **scotted**  

Currently deployed on a limited number of servers, planning to expand  
once the Riot production API key is approved.
