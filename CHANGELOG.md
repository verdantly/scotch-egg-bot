# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-05-13

This marks the first stable, production-ready release of the Scotch Egg Bot!

### Added
- **Event Announcements:** Automatically posts a rich embed when a new Discord Scheduled Event is created.
- **Opt-in Reminders:** Users can click a "Remind Me!" button to receive alerts.
- **Dual Reminder Modes:** Server admins can use `/settings mode` to choose between private DM reminders or public channel pings.
- **Automated Alerts:** Schedules and sends reminders precisely 24 hours and 1 hour before an event.
- **Graceful Shutdown:** Bot saves all data to disk before exiting when running in Docker or via `Ctrl+C`.
- **Admin Error Notifications:** A configured `ADMIN_USER_ID` will receive DMs for any critical runtime errors.
- **`/myreminders` Command:** Allows users to see all their upcoming reminders in a server and opt-out.
- **`/stats` Command:** New administrator command to view opt-in statistics for all upcoming events.
- **Custom Bot Status:** Bot now displays a helpful status (`⏰ Announcing events & sending reminders | /help`).
- **Live Button Counter:** The "Remind Me!" button now displays a live count of how many users have opted in (e.g., "Remind Me! (5)").

### Changed
- **Improved `/myreminders` UX:** Replaced the wall of individual "Cancel" buttons with a single, clean multi-select dropdown menu for batch cancellations.
- **Optimized Database Saves:** Implemented a 5-second batched write system to dramatically reduce disk I/O, improving SD card longevity on Raspberry Pi.
- **Atomic File Writes:** Database and config saves now use a temporary file and atomic rename to prevent data corruption if the bot crashes mid-save.
- **Updated Help Command:** The `/help` embed now includes information on all new and existing commands.

### Fixed
- **Docker `EBUSY` Error:** The file-saving logic now includes a robust fallback to prevent `EBUSY: resource busy or locked` errors when using Docker volume mounts for `config.json` and `events.json`.
- **`ephemeral` Deprecation:** All ephemeral interaction replies now use the modern `flags: MessageFlags.Ephemeral` system instead of the deprecated `{ ephemeral: true }` option.
- **Message Length Crashes:** Added absolute safety truncation to all reminder messages to ensure the bot never crashes by attempting to send a message over Discord's 2,000-character limit.
- **`deploy-commands.js` Crash:** Fixed a crash on fresh installs by importing `PermissionFlagsBits` from `discord.js` instead of a missing dependency.
- **DM Reminder Cancellation:** The "Cancel Reminders" button sent via DM now correctly updates the message to provide clear feedback to the user.

### Removed
- **Privileged Intent Requirement:** The bot is now built entirely on modern slash commands and interactions, completely removing the need for the `Server Members Intent`.