# Scotch Egg Bot - Discord Event Reminder Bot

A lightweight, Dockerized Discord bot optimized for Raspberry Pi. It automatically announces new Discord Server Events and sends automated 24-hour and 1-hour direct message (DM) reminders to users who opt-in.

## Features
- **Event Announcements:** Automatically posts an embedded announcement to a designated channel when a new Guild Scheduled Event is created.
- **Opt-in DM Reminders:** Users can click the interactive **"Remind Me!" button** on the announcement message to seamlessly opt-in or out of personalized DM reminders.
- **Automated Alerts:** Sends out reminders exactly 24 hours and 1 hour before an event's start time.
  - Alerts use a clean, text-based format (including event name, description, location, and dynamic Discord timestamps) to avoid cluttered double-embeds.
- **Graceful Fallback:** If no users opt-in, or if the bot cannot DM users, it falls back to posting the reminder in the public announcement channel so the alert is not lost.
- **SD-Card Friendly:** Specifically designed to run on a Raspberry Pi without wearing out the SD card. It uses a lightweight `events.json` file to store opted-in users, mapping them safely with minimal disk writes.
- **Dynamic Updates:** Automatically resyncs reminders if an event's start time is updated, and cleans up scheduled jobs/data if an event is deleted.

## Prerequisites
- Node.js (v16.14.0 or higher recommended)
- A Bot Token from the [Discord Developer Portal](https://discord.com/developers/applications).
- The bot must have the following **Privileged Intents** enabled in the Developer Portal:
  - `Message Content Intent`
  - `Server Members Intent`
- Docker (Optional, if you wish to run via containers).

## Configuration

**Environment Variables:**
   Create a `.env` file in the root directory and configure your bot token and channels:
   ```env
   DISCORD_TOKEN=your_actual_token_here
   
   # For single-server setups:
   ANNOUNCEMENT_CHANNEL_ID=your_announcement_channel_id_here
   # For multi-server setups (JSON map of ServerID:ChannelID):
   # ANNOUNCEMENT_CHANNELS={"123456789":"987654321", "22334455":"66778899"}
   ```

## Local Installation

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the bot:
   ```bash
   node index.js
   ```

## Docker Deployment (CLI)

This bot is designed to be easily containerized and run quietly in the background on devices like a Raspberry Pi.

1. **Build the image:**
   ```bash
   docker build -t scotch-egg-bot .
   ```

2. **Run the container:**
   ```bash
   docker run -d --name scotch-egg-bot --env-file .env scotch-egg-bot
   ```

## Docker Compose Deployment (Recommended)

Using Docker Compose makes it much easier to manage the container and perfectly map the `events.json` file so that your reminder database survives container restarts.

1. **Create an empty database file first:**
   Before starting the container, you *must* create an empty `events.json` file on your host machine. If you skip this, Docker will mistakenly create a directory named `events.json`.
   ```bash
   echo "{}" > events.json
   ```

2. **Start the bot:**
   Run the following command in the same directory as your `docker-compose.yml`:
   ```bash
   docker-compose up -d --build
   ```
   The bot will now run in the background, and any events or users who opt-in will be saved securely to the physical `events.json` file right next to your code.

## How It Works (Storage Architecture)
To minimize disk wear on single-board computers (like the Raspberry Pi):
- When an announcement is posted, it saves an entry to a local `events.json` file mapping the event ID to an array of opted-in users.
- When a user clicks the "Remind Me!" button, their Discord User ID is safely added to (or removed from) this local list.
- When it is time to send a reminder, the bot reads the opted-in users directly from the database and DMs them, respecting Discord rate limits with artificial delays.
- The database is automatically pruned when events are deleted, canceled, or completed to keep it lightweight.

## Dependencies
- [discord.js](https://discord.js.org/) - The primary library for interacting with the Discord API.
- [node-schedule](https://github.com/node-schedule/node-schedule) - Used for scheduling the precise 24h and 1h alert triggers.
- [dotenv](https://github.com/motdotla/dotenv) - For loading the bot token from the `.env` file.