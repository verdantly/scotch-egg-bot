# Scotch Egg Bot - Discord Event Reminder Bot

A lightweight, Dockerized Discord bot optimized for Raspberry Pi. It automatically announces new Discord Server Events and sends automated 24-hour and 1-hour direct message (DM) reminders to users who opt-in.

## Features
- **Event Announcements:** Automatically posts an embedded announcement to a designated channel when a new Guild Scheduled Event is created.
- **Opt-in DM Reminders:** Users can react to the announcement message with the ⏰ emoji to opt-in to receive personalized DM reminders.
- **Automated Alerts:** Sends out reminders exactly 24 hours and 1 hour before an event's start time.
- **Graceful Fallback:** If no users opt-in, or if the bot cannot DM users, it falls back to posting the reminder in the public announcement channel so the alert is not lost.
- **SD-Card Friendly:** Specifically designed to run on a Raspberry Pi without wearing out the SD card. It uses a lightweight `events.json` mapping to leverage Discord's native reaction system as the primary "database", meaning disk writes only happen upon event creation and deletion.
- **Dynamic Updates:** Automatically resyncs reminders if an event's start time is updated, and cleans up scheduled jobs/data if an event is deleted.

## Prerequisites
- Node.js (v16.14.0 or higher recommended)
- A Bot Token from the [Discord Developer Portal](https://discord.com/developers/applications).
- The bot must have the following **Privileged Intents** enabled in the Developer Portal:
  - `Message Content Intent`
  - `Server Members Intent` (if necessary for fetching specific users, though standard caching might suffice for reactions).
- Docker (Optional, if you wish to run via containers).

## Configuration

1. **Environment Variables:**
   Create a `.env` file in the root directory and add your bot token:
   ```env
   DISCORD_TOKEN=your_actual_token_here
   ```

2. **Channel Configuration:**
   Currently, the bot is hardcoded to post announcements and fallback reminders to a specific channel. 
   Open `index.js` and update the `ANNOUNCEMENT_CHANNEL_ID` variable with the ID of your desired channel:
   ```javascript
   const ANNOUNCEMENT_CHANNEL_ID = '1383197237412237335'; // Replace with your channel ID
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

## Docker Deployment

This bot is designed to be easily containerized and run quietly in the background on devices like a Raspberry Pi.

1. **Build the image:**
   ```bash
   docker build -t scotch-egg-bot .
   ```

2. **Run the container:**
   ```bash
   docker run -d --name scotch-egg-bot --env-file .env scotch-egg-bot
   ```
*(Note: If you want persistent storage of the `events.json` database across container recreations, be sure to map a volume to the working directory).*

## How It Works (Storage Architecture)
To minimize disk wear on single-board computers (like the Raspberry Pi):
- The bot **does not** save individual user reactions to a local database.
- Instead, when an announcement is posted, it simply saves a map of the `{ "EventID": "MessageID" }` to a local `events.json` file.
- When it is time to send a reminder, the bot reads the `MessageID` from the file, fetches the exact message directly from Discord, reads the reactions natively from the Discord API, and DMs the users.
- The `events.json` file is automatically created on the first event creation, and automatically pruned when events are deleted.

## Dependencies
- [discord.js](https://discord.js.org/) - The primary library for interacting with the Discord API.
- [node-schedule](https://github.com/node-schedule/node-schedule) - Used for scheduling the precise 24h and 1h alert triggers.
- [dotenv](https://github.com/motdotla/dotenv) - For loading the bot token from the `.env` file.