# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-05-17

### Added

- **Configurable Reminder Intervals:** Server administrators can now fully customize the timing of event reminders using the new `/settings intervals` command (e.g., `24h, 1h, 15m`).
- **Test Reminder Command:** Added `/settings testreminder` for admins to generate an ephemeral preview of what their configured reminders will look like.
- **Pagination:** Both `/upcoming` and `/myreminders` commands now support paginated navigation for servers with more than 25 active events.
- **Auto-Delete Concluded Events:** Server administrators can now use `/settings autodelete` to choose between permanently deleting or gracefully archiving event announcements when they conclude or are canceled.
- **Auto-Create Discussion Threads:** The bot now can automatically create a dedicated discussion thread on every new event announcement.
- **Relative Timestamps:** Dates in `/upcoming`, `/myreminders`, and announcements will now show a relative countdown alongside the date and time (e.g., *Tuesday, October 24, 2023 8:00 PM (in 3 days)*) if the event is less than one week away.

### Changed

- **Toggleable Features:** The "Add to Calendar" button and "Auto-Create Discussion Threads" features can now be toggled on or off per-server using the new `/settings calendar` and `/settings threads` commands.
- **Modular Architecture:** Abstracted database operations and pure utility functions into dedicated `storage.js` and `utils.js` files for a cleaner core codebase.
- **Performance Optimizations:** The bot now utilizes concurrent API fetching (`Promise.all`) and memory caching to process large reminder distributions and server syncs significantly faster.
- **Dynamic Reminder Buttons:** Interactive buttons now intelligently hide when they are no longer useful (e.g., hiding "Remind Me!" on the final reminder, and hiding "Add to Calendar" if the event is ≤1 hour away).

### Fixed

- **Docker Permissions:** Fixed a critical bug in the `Dockerfile` where the non-root `node` user lacked write permissions for the app directory, which prevented atomic database saves.
- **Uncaught Exception Handling:** The bot now correctly exits (`process.exit(1)`) after logging an `uncaughtException` instead of resuming with a potentially corrupted memory state. This allows Docker to safely and automatically restart a clean instance.
- **Button URL Limit Crashes (`DiscordAPIError[50035]`):** Implemented dynamic truncation for Google Calendar links to guarantee they never exceed Discord's strict 512-character limit for interactive button URLs.
- **Embed Limit Crashes:** Added defensive truncation for event announcements and archival messages to prevent API errors if event details exceed Discord's 4096-character description or 256-character title limits.
- **Live Counter Desynchronization:** The live "Remind Me! (X)" counter on announcements now accurately updates in the background if a user opts out via DMs or the `/myreminders` command.
- **Proactive Permission Checks:** The `/announceevent` command now gracefully verifies channel permissions (`ViewChannel`, `SendMessages`, `EmbedLinks`) before attempting to post, providing clear feedback in the channel instead of failing silently or throwing a generic error.

## [1.1.0] - 2026-05-15

### Added

- **`/upcoming` Command:** New public command allowing users to view a list of upcoming events and easily opt in to multiple reminders at once via a dropdown menu.
- **Add to Calendar Button:** Event announcements now include a link button to dynamically generate and add the event directly to Google Calendar.

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