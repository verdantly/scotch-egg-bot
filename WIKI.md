# 🥚 Scotch Egg Bot: Installation & Usage Guide

Welcome to the official setup guide for the **Scotch Egg Bot**! This lightweight, highly-resilient, and localized Discord bot automatically announces server events and sends opt-in reminders (via private DM, public channel @ mentions, or a hybrid configuration) to your community exactly when you need them.

Scotch Egg Bot features robust **Multi-Language Support** (fully localized in English, Spanish, German, French, and Portuguese) and **Automatic Database Self-Healing** (to prevent database corruption on low-end hardware like Raspberry Pis during sudden power losses).

This guide will walk you through the setup process step-by-step.

---

## 📋 Phase 1: Prerequisites & Discord Setup

Before running the code, you need to create a bot application on Discord and gather some credentials.

1. **Create the Application:** Go to the [Discord Developer Portal](https://discord.com/developers/applications) and click **New Application**.
2. **Get your Client ID:** On the "General Information" tab, copy your **Application ID** (this is your `CLIENT_ID`).
3. **Get your Bot Token:** Navigate to the "Bot" tab, click **Reset Token**, and copy the new token (this is your `DISCORD_TOKEN`). *Never share this publicly!*
4. **Invite the Bot:** Go to "OAuth2" -> "URL Generator". Check the `bot` and `applications.commands` scopes. Give it the necessary permissions (Send Messages, Read Message History, View Channels, Embed Links), copy the generated URL, and paste it into your browser to invite the bot to your server.

*(Note: This bot uses modern interactions and does **not** require any Privileged Intents to function!)*

---

## ⚙️ Phase 2: Configuration

Clone this repository to your host machine (e.g., your Raspberry Pi, VPS, or local computer).

### 1. The `.env` File
Create a new file named `.env` in the root directory of the project and add your credentials:
```env
DISCORD_TOKEN=your_actual_token_here
CLIENT_ID=your_bot_client_id_here
ADMIN_USER_ID=your_discord_user_id_here # Optional: Receives DM on errors
ANNOUNCEMENT_CHANNEL_ID=your_optional_fallback_channel_id_here
```
*(Note: `ANNOUNCEMENT_CHANNEL_ID` acts as a fallback. You will configure the primary channel inside Discord later).*

### 2. Database & Config Files (Crucial for Docker)
If you are deploying via Docker, you **must** create empty configuration files on your host machine first so Docker doesn't accidentally create directories instead of files.
Run this in your terminal:
```bash
echo "{}" > events.json
echo "{}" > config.json
```

---

## 🚀 Phase 3: Deployment

You can run the bot locally using Node.js, or securely inside a Docker container (recommended).

### Option A: Docker Compose (Recommended)
This is the best method, especially for devices like a Raspberry Pi, as it maps your data files properly and ensures the bot restarts automatically.

1. Ensure Docker and Docker Compose are installed.
2. In the project directory, start the container:
   ```bash
   docker compose up -d --build
   ```

### Option B: Local Node.js
If you prefer not to use Docker:

1. Ensure Node.js (v16.14.0+) is installed.
2. Install the required dependencies:
   ```bash
   npm install
   ```
3. Start the bot:
   ```bash
   node index.js
   ```

---

## 💻 Phase 4: Registering Slash Commands

Because the bot uses modern Discord slash (`/`) commands, you need to register them with Discord's API. **You only need to do this once.**

### Option A: Registering Locally (Outside Docker)
If you have Node.js installed on your computer, you can register the commands directly:

1. Open your terminal in the project directory.
2. Ensure you have run `npm install` and your `.env` file is set up.
3. Run the following command:
   ```bash
   node deploy-commands.js
   ```

### Option B: Registering Inside Docker
If you are running the bot purely through Docker and don't have Node.js installed locally, you can run the script inside the active container:

1. Ensure your container is running by deploying with `docker compose up -d`.
2. Run the following command in your host terminal:
   ```bash
   docker exec -it scotch-egg-bot node deploy-commands.js
   ```

If successful, you should see a message saying: *Successfully reloaded application (/) commands.*

---

## 🎮 Phase 5: Using the Bot

Now that the bot is online and commands are registered, open your Discord server!

### 1. Set the Announcement Channel
Administrators must tell the bot which text channel to use for event announcements. 
Type the following command in any channel:
> `/settings channel channel:#events`

*Success! Event announcements will now be posted in #events.*

### 2. Creating Events
Simply use Discord's native **Create Event** button at the top of your channel list. 
The moment you create an event, the bot will instantly post a rich-embed announcement in your configured channel.

### 3. Opting In (The "Remind Me!" Button)
Users who want to be notified can click the **⏰ Remind Me!** button on the announcement. Next to it, they'll find a **📅 Add to Calendar** button to easily add the event to their Google Calendar, and a **🔗 View Event** button to jump directly to the native Discord event page (preventing double embed issues).

- Depending on the server's configuration mode, the bot will notify them via public channel @ mentions (`Public`), direct message alerts (`Private`), or post to the public channel with zero pings while sending direct message alerts (`Hybrid`).
- If they click it again, they will be opted out.

### 4. Database Resiliency & Storage (Self-Healing)
To minimize disk wear on single-board computers (like the Raspberry Pi) and protect your data against sudden power outages:
- When an announcement is posted, it creates a record for that event in a local `events.json` database. Bot configurations are saved to `config.json`.
- **Double-Layer Backups:** When save events occur, the storage engine automatically maintains matching `.bak` duplicate copies (`events.json.bak` and `config.json.bak`).
- **Startup Loading Fallbacks:** On startup, if a primary file is corrupt, it seamlessly loads from the `.bak` file.
- **Regex Salvage Parsing:** If both the primary and backup are corrupt, a recursive Regex-based JSON salvage parser scans the damaged files, extracts intact records, and automatically reconstructs the database structure to prevent data loss.
- **Low disk-write wear:** The database utilizes null-prototype in-memory cache and performs minified batched saves to disk, saving your Raspberry Pi's MicroSD card from wear and tear.

### 5. Commands Reference

**Administrator Commands**
- `/settings channel [channel]` - Sets or changes the server's announcement channel.
- `/settings mode [mode]` - Selects the reminder delivery mode (`Public` channel @ pings, `Private` DM-only alerts, or `Hybrid` public-channel-posts with private DMs and zero user mentions).
- `/settings view` - Admin command that shows current bot configurations.
- `/settings calendar [enabled]` - Toggles the "Add to Calendar" button on announcements.
- `/settings threads [enabled]` - Toggles the automatic creation of discussion threads.
- `/settings autodelete [enabled]` - Toggles whether event announcements are completely deleted when the event ends, rather than just being gracefully archived (public reminder messages are always deleted entirely to reduce channel clutter).
- `/settings intervals [times]` - Sets custom reminder intervals using a comma-separated list (e.g., `24h, 1h, 15m`).
- `/settings testreminder` - Displays a mock preview of what a reminder message will look like with the server's current settings.
- `/settings cleanup` - Admin command that scans the announcement channel's recent messages, automatically archives (or deletes) concluded event announcements, and performs a deep fail-safe scan (matching event links and event names in message text) to delete **all** matching public event reminder messages and keep the channel clean.
- `/announceevent [event_link_or_id]` - Manually forces the bot to post an announcement for an existing event (useful if the bot was offline when the event was originally created).
- `/stats` - Admin command to view opt-in statistics for upcoming events in this server.

**Public Commands**
- `/upcoming` - Public command to view a paginated list of upcoming events and quickly opt in to reminders.
- `/myreminders` - Public command that lists a paginated view of all upcoming events you are currently receiving reminders for in this server.
- `/help` - Displays information on how to use the bot and a list of available commands (dynamically filtered to only show Administrator commands to server administrators).

---

## 🔄 Phase 6: Updating the Bot

If you ever edit the code or download an updated version of the bot, applying the changes is simple and won't delete your data.

1. Run the following command to rebuild the container with the new code:
   `docker compose up -d --build`
2. If your update includes changes to slash commands, register them by running:
   `docker exec -it scotch-egg-bot node deploy-commands.js`

---

## ❓ Frequently Asked Questions (FAQ)

**Q: How does the Multi-Language support work?**  
A: Scotch Egg Bot automatically detects the preferred language of your Discord server to translate public event announcements. It also dynamically detects each user's specific Discord client language to instantly translate interactive slash commands, options, select menus, confirmation replies, and DM reminder alerts on the fly!

**Q: How does Database Self-Healing protect my data?**  
A: If your host device (like a Raspberry Pi) experiences a sudden power outage during a disk write, the active database file can get truncated or corrupted. On startup, Scotch Egg Bot automatically attempts to load the database, falling back to a `.bak` copy if the primary is damaged. If both are corrupted, it executes a Regex salvage parser to scan the damaged file, extract all intact records, and rebuild the database structure automatically.

---

### 🎉 You're All Set!
Your Scotch Egg Bot is now actively monitoring your server, ready to keep your community engaged and on time. If you ever restart the bot, don't worry—your `events.json` and `config.json` files safely preserve all opted-in users and settings!