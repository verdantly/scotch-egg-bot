# Scotch Egg Bot - Discord Event Reminder Bot

A completely free Discord bot that hooks seamlessly into native Discord events. No clunky special event commands. End `@everyone` spam and send automated event reminders only to the users who actually want them. Optimized for Raspberry Pi.

## Features

### 💬 Discord & User-Facing Features
- **Native Discord Events:** Automatically posts an embedded announcement to a designated channel when a new Guild Scheduled Event is created. No need to learn complicated `!create` commands.
- **Strictly Opt-In Reminders:** Built on a core philosophy of user consent. Instead of annoying mass `@everyone` pings, users explicitly choose which events they want to be notified about. Keep your community in the loop exactly how you prefer via Private DMs, Public Mentions, or a Hybrid configuration (Public reminders + Private DM alerts).
- **Automated Alerts:** Sends out reminders at customizable intervals (defaults to 24 hours and 1 hour) before an event's start time.
- **Auto-Cleanup / Auto-Archive:** Automatically grays out and archives (or optionally deletes entirely) old announcements when events conclude, while **always deleting** the associated public reminders to keep channels completely clutter-free.
- **Add to Calendar & View Event Buttons:** Event announcements and reminders feature dedicated interactive link buttons. The **Add to Calendar** button lets users add the event directly to Google Calendar pre-filled with the details. The **View Event** button links directly to Discord's native event window, resolving duplicate "double embed" clutter in chat.
- **Auto-Create Discussion Threads:** The bot automatically creates a dedicated discussion thread on new event announcements to encourage community engagement.
- **Dynamic Relative Timestamps:** Event dates display a relative countdown alongside the date and time (e.g., *Tuesday, October 24, 2023 8:00 PM (in 3 days)*) when the event is less than a week away.
- **Multi-Language (Localization):** Fully supports 5 major native locales: English (`en`), Spanish (`es`), German (`de`), French (`fr`), and Portuguese (`pt`). Features native name and description slash command metadata, client-locale detection for translating slash command interfaces on the fly, and guild-locale preferred language detection for dynamic server announcements.
- **Sleek Web Dashboard (Optional):** Fully customize configurations, announcement channels, reminder modes (Private, Public, Hybrid), dynamic intervals, and toggles (threads, calendar buttons, auto-delete) from a premium dark-mode glassmorphic browser panel. Fully secured via Discord OAuth2.

### ⚡ Runtime & Technical Features
- **SD-Card Friendly:** Specifically designed to run on a Raspberry Pi without wearing out the SD card. It uses a lightweight `events.json` file to store opted-in users, mapping them safely with minimal disk writes.
- **Automatic Database Self-Healing:** Premium dual-layer resiliency mechanism in `storage.js` to protect your data. Automatically maintains atomic `.bak` backup copies for all databases on write events, seamlessly falling back to them if a primary file is corrupt or truncated (e.g. from power loss on Raspberry Pis). Engages a recursive, Regex-based partial JSON salvage parser as a final line of defense to recover intact records from severely damaged files.
- **Resilience & Fallbacks:** In Private Mode, if no users opt-in or if the bot cannot DM users, it falls back to posting the reminder in the public announcement channel so the alert is not lost. In Hybrid Mode, public fallbacks are suppressed if DMs fail to protect user privacy. Supported by robust atomic `.bak` fallbacks and Regex salvage healing tools for unmatched stability.
- **Offline Sync & Garbage Collection:** Every time the bot starts up, it automatically syncs with Discord, schedules reminders for any new events it missed, and automatically archives/deletes announcements and public reminders for events that concluded while it was offline.
- **Dynamic Live Updates:** Automatically resyncs scheduled reminder jobs in response to real-time Discord event updates, and cleans up scheduled jobs/data instantly if an event is deleted.

## Example Reminder Message
**Public Reminder (24-Hour Alert)**  
> 📢 24h until **Sunday Brunch at Eggcellent Café**!
> 🗓️ Sunday, May 31, 2026 11:00 AM (in 1 day)
> 📍 Eggcellent Café
> 
> It's been far too long since we've had eggs benedict, french toast, and bottomless mimosas together.  Also, we need our yearly consumption of Scotch eggs as well!
> 
> @User1 @User2 @User3
> 
> `[ ⏰ Remind Me! ]` `[ 📅 Add to Calendar ]` *(Interactive Buttons)*

## Prerequisites & Discord Setup

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and click **New Application**.
2. On the "General Information" page, copy your **Application ID** (this will be your `CLIENT_ID`).
3. Navigate to the "Bot" tab on the left, click **Reset Token**, and copy the new token (this will be your `DISCORD_TOKEN`).
4. Go to "OAuth2" > "OAuth2 URL Generator". Check the `bot` and `applications.commands` scopes. Copy the generated URL at the bottom and open it in your browser to invite the bot to your server.
5. Ensure you have **Node.js (v16.14.0 or higher)** installed, OR **Docker** if you prefer containerized deployment.

*Note: **No Privileged Intents are required!** The bot relies entirely on modern slash commands.*

## Configuration

**Environment Variables:**
   Create a `.env` file in the root directory and configure your bot token and Client ID. The `ANNOUNCEMENT_CHANNEL_ID` is now optional and acts as a fallback if the `/setchannel` command has not been used in a server.
   ```env
   DISCORD_TOKEN=your_actual_token_here
   CLIENT_ID=your_bot_client_id_here
   ADMIN_USER_ID=your_discord_user_id_here # Optional: Receives DM on errors
   ANNOUNCEMENT_CHANNEL_ID=your_optional_fallback_channel_id_here
   DASHBOARD_PORT=8080 # Optional: The port the web dashboard server will run on (defaults to 8080)
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
   Expose port 8080 (or your custom dashboard port) to access the web panel:
   ```bash
   docker run -d --name scotch-egg-bot -p 8080:8080 --env-file .env scotch-egg-bot
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

## Commands Reference

### Administrator Commands

*   `/settings channel [channel]`
    -   **Action:** Sets the specific channel where the bot will post new event announcements and reminders for the current server.

*   `/settings mode [mode]`
    -   **Action:** Sets the reminder delivery mode: public channel reminders with user mentions (`Public`), private DM-only reminders (`Private`), or public channel reminders without mentions while DMed privately to opted-in users (`Hybrid`).

*   `/settings view`
    -   **Action:** Displays the currently configured channel and reminder mode for this server.

*   `/settings calendar [enabled]`
    -   **Action:** Toggles whether the bot includes an "Add to Calendar" button on event announcements.

*   `/settings threads [enabled]`
    -   **Action:** Toggles whether the bot automatically creates a dedicated discussion thread on new announcements.

*   `/settings autodelete [enabled]`
    -   **Action:** Toggles whether event announcements are completely deleted from the channel when the event ends, rather than just being gracefully archived.

*   `/settings intervals [times]`
    -   **Action:** Sets custom reminder intervals using a comma-separated list (e.g., `24h, 1h, 15m`). Up to 5 intervals can be set per server.

*   `/settings testreminder`
    -   **Action:** Displays a mock preview of what a reminder message will look like with the server's current settings.

*   `/settings cleanup`
    -   **Action:** Scans the announcement channel's recent messages, automatically archives (or deletes) concluded event announcements, and performs a deep fail-safe scan (matching event links and event names in message text) to delete **all** matching public event reminder messages and keep the channel clean.

*   `/announceevent [event_link_or_id]`
    -   **Action:** Manually posts an announcement for an existing event. The bot proactively verifies channel permissions before posting. This is useful if the bot was offline when the event was created.

*   `/stats`
    -   **Action:** View opt-in statistics for upcoming events in this server.

### Public Commands

*   `/upcoming`
    -   **Action:** View a paginated list of upcoming events in this server and easily opt-in to reminders for them.

*   `/myreminders`
    -   **Action:** Lists all upcoming events you are currently receiving reminders for in this server.

*   `/help`
    -   **Action:** Displays information on how to use the bot and a list of available commands.

## How It Works (Storage Architecture)
To minimize disk wear on single-board computers (like the Raspberry Pi):

- When an announcement is posted, it creates a record for that event in a local `events.json` file.
- When a user clicks the "Remind Me!" button, their Discord User ID is added to (or removed from) an object of opted-in users associated with that event's record. This object-based storage is highly efficient for lookups.
- When it is time to send a reminder, the bot reads the opted-in users directly from the database and notifies them (via public channel pings in Public Mode, direct message alerts in Private Mode, or a mixture of both in Hybrid Mode).
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
    Scheduler -->|Triggers at 24h and 1h| Bot
    
    Bot -->|Reads Opt-ins| DB
    Bot -->|Sends Rate-Limited DMs / Public Pings| User
    Bot -.->|Fallback if DMs fail| Channel
```

## Dependencies

- [discord.js](https://discord.js.org/) - The primary library for interacting with the Discord API.
- [node-schedule](https://github.com/node-schedule/node-schedule) - Used for scheduling the precise 24h and 1h alert triggers.
- [dotenv](https://github.com/motdotla/dotenv) - For loading the bot token from the `.env` file.

## FAQ

**Q: Does the bot support multiple servers (Guilds)?**
A: Yes! You can invite the bot to as many servers as you want. Just use `/settings channel` in each server to configure where announcements should be posted. The bot keeps all reminders and configurations perfectly separated.

**Q: What happens if the bot goes offline while an event is created, deleted, or concluded?**
A: Don't worry! Every time the bot starts up, it performs "Offline Garbage Collection." It automatically syncs with Discord, schedules reminders for any new events it missed, and automatically archives or deletes announcements for events that concluded while it was down. Furthermore, administrators can run `/settings cleanup` at any time to manually scan and archive any orphaned legacy announcements.

**Q: Why do I need to create empty `events.json` and `config.json` files for Docker?**
A: Docker Compose maps these files from your host to the container. If the files don't exist on your host machine *before* you run `docker compose up`, Docker assumes you are trying to map directories and will create folders named `events.json` and `config.json`. This will crash the bot.

**Q: Why are the DM reminders plain text instead of Rich Embeds?**
A: This is intentional. When an event URL is sent in a DM, Discord automatically generates a Rich Embed preview for it. If the bot sent an Embed, it would result in a cluttered "double-embed" in the user's DM.

**Q: Can users opt out of reminders?**
A: Yes! Users can either click the "Remind Me!" button on the announcement again, click the "Cancel Reminders" button at the bottom of a DM reminder, or use the `/myreminders` command to see a list of their events and opt out from there.

**Q: How does the Multi-Language support work?**
A: Scotch Egg Bot automatically detects the preferred language of your Discord server to translate public event announcements. It also dynamically detects each user's specific Discord client language to instantly translate interactive slash commands, options, select menus, confirmation replies, and DM reminder alerts on the fly!

**Q: How does Database Self-Healing protect my data?**
A: If your host device (like a Raspberry Pi) experiences a sudden power outage during a disk write, the active database file can get truncated or corrupted. On startup, Scotch Egg Bot automatically attempts to load the database, falling back to a `.bak` copy if the primary is damaged. If both are corrupted, it executes a Regex salvage parser to scan the damaged file, extract all intact records, and rebuild the database structure automatically.