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
- Your bot's Client ID from the Developer Portal.
- The bot must have the following **Privileged Intents** enabled in the Developer Portal:
  - `Message Content Intent`
  - `Server Members Intent` (Optional, but recommended for potential future features).
- Docker (Optional, if you wish to run via containers).

## Configuration

**Environment Variables:**
   Create a `.env` file in the root directory and configure your bot token and Client ID. The `ANNOUNCEMENT_CHANNEL_ID` is now optional and acts as a fallback if the `/setchannel` command has not been used in a server.
   ```env
   DISCORD_TOKEN=your_actual_token_here
   CLIENT_ID=your_bot_client_id_here
   ADMIN_USER_ID=your_discord_user_id_here # Optional: Receives DM on errors
   ANNOUNCEMENT_CHANNEL_ID=your_announcement_channel_id_here # Optional fallback
   ```

## Slash Command Setup

This bot uses slash commands for configuration. Before running the bot for the first time, you must register its commands with Discord.

1.  Make sure your `.env` file is configured with your `DISCORD_TOKEN` and `CLIENT_ID`.
2.  Run the deployment script:
    ```bash
    node deploy-commands.js
    ```
    You only need to do this once, or whenever you add/change a command.

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
   Before starting the container, you *must* create empty database and config files on your host machine. If you skip this, Docker will mistakenly create directories instead of files.
   ```bash
   echo "{}" > events.json
   echo "{}" > config.json
   ```

2. **Start the bot:**
   Run the following command in the same directory as your `compose.yaml` (or `docker-compose.yml`):
   ```bash
   docker compose up -d --build
   ```
   The bot will now run in the background, and any events or users who opt-in will be saved securely to the physical `events.json` file right next to your code.

## Admin Commands

*   `/setchannel [channel]`
    -   **Permission:** Administrator
    -   **Action:** Sets the specific channel where the bot will post new event announcements and fallback reminders for the current server. This is the recommended way to configure the bot and overrides any settings in the `.env` file.

*   `/announceevent [event_link_or_id]`
    -   **Permission:** Administrator
    -   **Action:** Manually posts an announcement for an existing event. This is useful if the bot was offline when the event was created.

*   `/checkchannel`
    -   **Permission:** Everyone
    -   **Action:** Displays the currently configured channel for event announcements.

## How It Works (Storage Architecture)
To minimize disk wear on single-board computers (like the Raspberry Pi):
- When an announcement is posted, it saves an entry to a local `events.json` file mapping the event ID to an array of opted-in users.
- When a user clicks the "Remind Me!" button, their Discord User ID is safely added to (or removed from) this local list.
- When it is time to send a reminder, the bot reads the opted-in users directly from the database and DMs them, respecting Discord rate limits with artificial delays.
- The database is automatically pruned when events are deleted, canceled, or completed to keep it lightweight.

### Architecture Diagram

```mermaid
graph TD
    Admin[Discord Admin] -->|Creates Event| DiscordAPI((Discord API))
    DiscordAPI -->|EventCreate| Bot[Scotch Egg Bot]
    Bot -->|Reads Channel config| Config[(config.json)]
    Bot -->|Posts Announcement| Channel[Discord Channel]
    
    User[Discord User] -->|Clicks 'Remind Me!'| Channel
    Channel -->|InteractionCreate| Bot
    Bot -->|Saves User ID| DB[(events.json)]
    
    Bot -->|Schedules Reminder| Scheduler{Node Schedule}
    Scheduler -->|Triggers at 24h & 1h| Bot
    
    Bot -->|Reads Opt-ins| DB
    Bot -->|Sends DMs (Rate Limited)| User
    Bot -.->|Fallback if DMs fail| Channel
```

## Dependencies
- [discord.js](https://discord.js.org/) - The primary library for interacting with the Discord API.
- [node-schedule](https://github.com/node-schedule/node-schedule) - Used for scheduling the precise 24h and 1h alert triggers.
- [dotenv](https://github.com/motdotla/dotenv) - For loading the bot token from the `.env` file.