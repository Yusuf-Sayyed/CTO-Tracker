# DexScreener CTO Monitor

A Telegram bot that monitors DexScreener for new Community Takeover (CTO) tokens and sends real-time alerts.

## Features

- Real-time monitoring of DexScreener CTO listings
- PumpFun token filtering (bonded tokens only)
- Quality filters: age, socials, boost cap, market cap
- Automatic token price tracking with milestone alerts (2x-5x)
- Telegram bot commands: /start, /status, /check, /tracked, /update

## Tech Stack

- **Runtime**: Node.js (ES Modules)
- **Telegram**: node-telegram-bot-api
- **API**: DexScreener REST API

## Installation

```bash
git clone https://github.com/Yusuf-Sayyed/CTO-Tracker.git
cd CTO-Tracker
```

```bash
npm install
```

## Configuration

Copy the example environment file and fill in your values:

```bash
cp .env.example .env
```

## Usage

```bash
npm start
```

## Bot Commands

| Command | Description |
|---------|-------------|
| /start | Welcome message and help |
| /status | Check bot uptime and stats |
| /check | Force an immediate poll |
| /tracked | View all tracked tokens |
| /update | Force a tracking refresh |
| /chatid | Get your chat ID |

## Filters

The bot applies these quality filters before alerting:
