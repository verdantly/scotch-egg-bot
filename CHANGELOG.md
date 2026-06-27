# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.6.6] - 2026-06-27

### Fixed

- **Spurious "Rescheduled" Announcements:** Fixed a bug where a native Discord behavior (Discord automatically shifting the scheduled start time of Voice/Stage events to exactly match the moment the host clicks "Start Event") tricked the bot into thinking the event was manually rescheduled, causing it to spam duplicate announcements precisely when the event started.
- **Legacy Event Start Announcements:** Fixed an issue where events created before the bot was invited to a server would erroneously trigger a brand new "New Event" announcement exactly when the event started.
- **Cache Partial Object Protection:** Added strict null-checks during event updates to prevent the bot from incorrectly firing location or time change notifications when recovering from a partial memory state after a restart.

## [1.6.5] - 2026-06-22

### Changed

- **Relaxed Slash Command Permissions:** Lowered the strict permission requirement for `/settings`, `/silenceevent`, and `/stats` commands from `Administrator` to `Manage Server`. This allows server moderators to natively configure the bot and unlocks Discord's Integrations UI so that access can be explicitly delegated to lower-level roles.
- **Documentation OAuth2 Scopes:** Enhanced setup guides to clearly highlight that both the `bot` and `applications.commands` scopes are strictly required, and added explicit recommendations to check **Create Public Threads** and other core bot permissions in the URL generator.
- **Documentation Autodelete Warning:** Added an explicit warning to the `/settings autodelete` command docs and Discord helper text that enabling autodelete will also delete the associated discussion thread.

### Fixed

- **Duplicate Announcements Race Condition:** Fixed a bug where a network timeout during an initial event creation would cause the bot to later double-post "rescheduled" and "initial" announcements simultaneously during an event update.

## [1.6.4] - 2026-06-16

### Fixed

- **Departed Users Edge Case:** Handled an edge case where a user who left the server entirely would cause an `@Invalid-User` mention in the public channel if their DMs were closed.
- **Website Accessibility:** Added `<main>` tags to all documentation HTML pages for proper screen reader navigation (WCAG compliance).
- **Test Suite Resiliency:** Refactored global `fs` mocking in the unit tests to ensure cleaner teardowns and added mock implementations for `guild.members.fetch()`.

## [1.6.3] - 2026-06-13

### Added

- **Startup Environment Variable Verification:** The bot now logs warning notices at startup if recommended `.env` keys (like `ADMIN_USER_ID` or `DEFAULT_INTERVALS`) are missing.
- **Timezone Clarification:** Added timezone handling instructions to the FAQ in the documentation.
- **Slash Command Test Coverage:** Added comprehensive unit tests covering `/help`, `/stats`, and all `/settings` subcommands.

## [1.6.2] - 2026-06-11

### Fixed

- **Recurring Event Canceled Occurrence Rollover:** Fixed a bug where canceling a single occurrence of a recurring scheduled event series caused the bot to incorrectly announce the next week's occurrence as a "new event" (archiving the old announcement as "Rescheduled" and posting a brand new announcement). The bot now dynamically fetches the event's raw exceptions list from the Discord API and treats canceled occurrences as recurring event rollovers, updating the original announcement message in-place and cleaning up the canceled occurrence's reminders.

## [1.6.1] - 2026-06-10

### Fixed

- **Canceled Occurrence Reminders for Recurring Events:** Fixed a bug where reminder notifications (both public channel and direct messages) were still dispatched for individual occurrences of a recurring event series that had been canceled by the host on Discord. The bot now dynamically fetches the event's raw exceptions from the Discord API at dispatch time and skips sending the reminder if the next occurrence has a canceled exception.

## [1.6.0] - 2026-06-06

### Added

- **Rescheduled Event Announcements:** When a scheduled event's start time is updated, the bot now archives the old announcement as "Rescheduled" (disabling buttons and striking through the outdated description) and posts a new, active announcement message in the channel. This ensures high visibility for rescheduled events while automatically carrying over the "Remind Me!" count and registration metadata to the new announcement.
- **Reminder Silencing and Tag-Based Exclusions:** Added ability to exclude or silence automatic reminders for specific events or recurring series. Administrators can use new slash commands `/settings silenceevent` and `/settings unsilenceevent` to toggle reminders, which disables the announcement's "Remind Me!" button and displays a silenced notice. Additionally, adding `[silent]` or `[exclude]` in the event's title or description on Discord will completely exclude the event from automatic announcement and reminder scheduling.
- **Interactive Cancellation Choice for Recurring Series:** When users click "Cancel Reminders" under a DM alert for a recurring event series, the bot now displays a prompt asking if they want to opt out of the next occurrence only or unsubscribe from the entire series.
- **Silent Public Reminders:** Added a `/settings mentions` command that allows server administrators to disable user pings on public channel reminders. This sends the reminder alert to the channel silently, preventing notification fatigue in large servers while preserving the "Remind Me!" opt-in counter.
- **Global Default Intervals:** Administrators hosting the bot can now set a `DEFAULT_INTERVALS` variable in their `.env` file (e.g. `DEFAULT_INTERVALS="24h, 1h"`). Any server that hasn't explicitly set their own intervals will seamlessly inherit these global defaults.

### Fixed

- **Robust Interaction Timeout Handling:** Improved the Discord `10062 Unknown Interaction` timeout handler. It now correctly parses nested `discord.js` raw error codes using loose typing, successfully preventing noisy stack traces and bot crashes during temporary Discord API latency or network hiccups.
- **Database Overwriting Prevention:** Fixed an edge case where manually announcing an event or updating its details would overwrite the database entry, causing a loss of pre-existing metadata such as the `remindersDisabled` setting, reminder recipient lists, or other event settings.
- **Recurring Event Automatic Reminder Cleanup:** Concluded recurring event occurrences now automatically delete their associated public reminder messages (e.g. 1 hr/24 hr reminders) upon rollover to the next occurrence, instead of leaving them in the channel.
- **Upgraded Settings Cleanup Command for Recurring Events:** Enhanced `/settings cleanup` to successfully delete old public reminder messages for active recurring events by comparing the timestamp in the reminder message against the event's current scheduled start time.
- **Self-Healing Offline Reminder Purge:** Updated startup synchronization to automatically identify and clean up obsolete reminder messages that rolled over or postponed while the bot was offline. Utilizes bit-shifted Discord Snowflake timestamp deconstruction to avoid API query overhead.
- **Discord API Rate Limit Prevention (Debounce):** Fixed a critical `HTTP 429 Rate Limit` vulnerability by debouncing the "Remind Me" button updates. The bot now intelligently batches live counter updates to execute only once every 5 seconds, allowing it to easily handle dozens of concurrent user interactions on large event announcements.
- **Automatic 30-Day Database Purge:** Implemented a zero-maintenance garbage collection system that reads Discord Snowflake creation timestamps. It automatically and permanently deletes any concluded events older than 30 days from `events.json`, ensuring the database file remains lightweight and never blocks the Node.js event loop over months of continuous uptime.

## [1.5.2] - 2026-06-01

### Fixed

- **Recurring Event Public Reminder Cleanup:** Resolved a bug in `/settings cleanup` where orphaned public reminder pings for past occurrences of recurring events were not deleted because they shared the same name as upcoming occurrences. The bot now extracts and matches the unique Discord start timestamp tag (`<t:TIMESTAMP:F>`) to safely distinguish and clean up only the concluded occurrence.

## [1.5.1] - 2026-05-30

### Changed

- **Always Delete Public Reminders on Conclusion:** Refactored the reminder archiving logic to always delete public reminder messages entirely on event conclusion, regardless of whether `autoDelete` is enabled or disabled. This leaves only the main, low-contrast event announcement message in the channel, significantly reducing chat history clutter.

### Fixed

- **Concluded Event Archiving in Settings Cleanup:** Fixed a bug where concluded event announcements were not being archived or deleted during `/settings cleanup` if they were still tracked in `eventDb` but missing their `messageId` field. `archiveAnnouncementMessage` now accepts an optional pre-fetched message parameter to ensure it can archive the message directly and safely populate `messageId`.
- **Regional Locale Normalization:** Fixed a major internationalization bug where regional Discord locale tags (such as `es-ES`, `pt-BR`, `fr-FR`, `de-DE`) bypassed localized string checks (like `userLocale === 'es'` or `guildLocale === 'pt'`), causing the bot's messages, settings menus, and logs to fall back to English. Systematic locale normalization now handles all raw locale strings cleanly.
- **Multilingual Strike-Through Matching:** Replaced hardcoded English text regexes (`**Time:**` and `**Location:**`) with dynamic, language-agnostic emoji-based matching (`(🗓️ \*\*.*?\*\* .*?)` and `(📍 \*\*.*?\*\* .*?)`) to ensure Time and Location details are successfully struck-through on event conclusion across all five supported native languages.
- **Native Embed Title Strike-Through:** Discord embed titles do not support standard Markdown formatting (like `~~strikethrough~~`), causing literal `~~` tildes to be shown as raw text. Implemented native client-side strike-through rendering for titles using Unicode combining characters (`U+0336`).
- **Resilient Empty Description Status Banner:** Fixed a bug where the bold status banner (e.g. `⏹️ This event has concluded.`) was omitted if the original Discord event had no description. If the description is empty, it is now cleanly set to display only the status banner.

## [1.5.0] - 2026-05-28

### Added

- **Hybrid Reminder Mode:** Introduced a new, third configuration option for server reminders (`hybrid`). When enabled, the bot posts public event reminders in the configured text channel with **zero user mentions/pings** (preserving clean channel histories), while simultaneously dispatching **private DM reminders** directly to opted-in users. Enforces strict privacy by suppressing any fallback mentions in public chat if a user's DMs are closed.
- **Manual Concluded Event Cleanup:** Added a new `/settings cleanup` subcommand (natively localized across English, Spanish, German, French, and Portuguese). It scans the last 100 messages of the announcement channel, matches orphaned announcements using the unique Discord event URL, and automatically archives or deletes them to conform to server settings.
- **Offline Startup Auto-Archiving:** Upgraded the `Events.ClientReady` offline garbage collection routine to fetch live event statuses and dynamically archive or delete announcements of events that concluded while the bot was offline, preventing orphaned announcements from ever accumulating.
- **Automatic Database Self-Healing:** Implemented a robust, dual-layer resilience mechanism in `storage.js` to prevent data loss. The system automatically maintains atomic `.bak` backup files for both events and configs. If a primary database file fails to load due to truncation or corruption, it seamlessly falls back to the backup. If both files are damaged, it engages a recursive, Regex-based partial JSON salvage utility to extract intact records and automatically reconstructs the database structure.
- **Multi-Language (Localization) Support:** Integrated comprehensive localization support for 5 major native locales: English (`en`), Spanish (`es`), German (`de`), French (`fr`), and Portuguese (`pt`). Implemented localized name and description metadata for all slash commands in `deploy-commands.js`. Created `i18n.js` to dynamically translate event announcements, button labels, select menus, DMs, reminders, and interactive UI feedback on the fly using user client or guild locale preferences.
- **Native Event Link Button:** Implemented a new link button (`View Event`) on all event announcements, public reminders, private DM reminders, and settings previews. This button links directly to the Discord native scheduled event window, eliminating the need to embed the URL in message text and preventing Discord from rendering a duplicate "double embed."

### Changed

- **Dynamic Help Slash Command:** Customized the `/help` command to conditionally display the list of Administrator commands only if the command is executed by a user with Administrator permissions. The `/settings testreminder` footer tip is also dynamically hidden for non-administrators.
- **Help Attribution Link:** Added a subtle powered-by attribution link pointing to the GitHub repository within the `/help` command description embed.

### Fixed

- **Interaction Syntax Error:** Fixed a critical `SyntaxError: Unexpected token 'catch'` startup crash in `index.js` caused by a truncated button interaction handler.
- **Mention-Stripping Regex Bug:** Resolved a bug in the event archiver where secondary user mentions left trailing `>` characters and third/subsequent mentions were not stripped during event archival, cluttering archived chat histories.
- **Multilingual Footer Stripping:** Generalized the opt-in footer-stripping regex to correctly match and remove opt-in text in all five supported languages when archiving announcements.
- **Discord Description Length Constraint:** Fixed an `ExpectedConstraintError` during command deployment by shortening the French and Portuguese slash command description localizations to stay strictly under Discord's 100-character API limit.
- **Database Loading Metadata Loss:** Fixed a critical bug in `storage.js` where `guildId` and `reminderMessageIds` were lost upon bot restart. This restores full capability to modify, clean up, and strip mentions from older public reminders upon event conclusion after a reboot.
- **Startup Garbage Collection Wipeout:** Fixed a critical edge case in startup synchronization where a single guild sync failure (due to API timeouts or outages) would trigger a complete deletion of that guild's active reminder database records.

## [1.4.0] - 2026-05-26

### Added

- **Rich Event Announcements:** Announcements now display start-to-end time ranges, dynamic human-readable durations (e.g., `1 hour 30 minutes`), and a dedicated `👤 Host` field linking to the organizer's Discord profile.
- **Smart Voice Channel Calendar Locations:** The "Add to Calendar" link button now dynamically resolves and lists the actual voice or stage channel name (e.g. `General (Discord Voice/Stage)`) in Google Calendar instead of a generic "Discord Server" location.
- **High-Contrast Past Event Visuals:** Announcements now dynamically wrap titles in strike-throughs on conclusion (e.g., `~~New Event: Meeting~~ [Completed]`), strike-through key time/location metadata, dim descriptions using blockquotes, and prepend a bold status banner (e.g., `⏹️ **This event has concluded.**`).
- **Past Reminder Message Archiving:** Added tracking for all sent public channel reminders. On event completion or cancellation, the bot dynamically edits past public reminders to remove components, strip out old user mentions (clearing blue ping highlights from the chat history), strike-through text, and prepend a bold dynamic status banner (e.g. `⏹️ **This event has completed.**`).

### Fixed

- **Dynamic Relative Reminders:** Shifted reminder message generation inside the scheduled node-schedule job callback, resolving an issue where the relative countdown (e.g., `(in 1 hour)`) was missing for events scheduled more than one week in advance.
- **DM Reminder Safe Truncation:** Implemented dynamic 2,000-character safety truncation for event descriptions in DM reminders, preventing message delivery failures and bot crashes for events with very long descriptions.

## [1.3.1] - 2026-05-26

### Fixed

- **Memory Sweepers:** Actually applied the Discord.js sweeper configuration to the client to properly clear cached messages and users, resolving an omission in the v1.3.0 release.
- **Job Cancellation Efficiency:** Updated the node-schedule cancellation loop to use the optimized `for...in` approach as originally intended in v1.3.0.
- **Missing Event Title:** Fixed an issue where the "New Event: [Name]" title was missing from announcement embeds.

## [1.3.0] - 2026-05-22

### Added

- **Rate Limiting & Cooldowns:** Added a comprehensive cooldown system for slash commands, interactive buttons ("Remind Me!"), pagination, and select menus to protect against API spam and rate limits.

### Changed

- **Archived Event UI:** When an event concludes, the archived announcement now grays out the entire description text (using blockquotes) and strips out obsolete relative timestamps for a cleaner, dimmed look.
- **Counter Lookup Efficiency:** The live "Remind Me! (X)" counter now uses an O(1) instant database lookup to find the event's server, significantly reducing CPU overhead.
- **Batched Reminder DMs:** Refactored the DM reminder system to process users in concurrent batches of 5 (with a 1-second delay), drastically speeding up large reminder blasts while safely respecting Discord's limits.
- **Memory Optimization:** Configured Discord.js sweepers to automatically clear cached messages and users every hour, preventing RAM bloat on low-memory devices like Raspberry Pis.
- **Database Lookup Speed:** Replaced standard objects with null-prototype objects (`Object.create(null)`) for the event database, increasing lookup efficiency and eliminating prototype pollution vulnerabilities.
- **Minified Disk Writes:** Database and configuration saves are now minified (whitespace removed), reducing file size and write times to further protect SD card lifespans.
- **Job Cancellation Efficiency:** Optimized the node-schedule job cancellation loop to use a raw `for...in` loop to save event loop cycles when evaluating large sets of scheduled events.

### Fixed

- **Silent Errors:** Fixed an issue where the live counter update function was silently swallowing errors without logging them.
- **Unhandled Rejection Crashes:** Wrapped critical event listeners (`InteractionCreate`, `GuildScheduledEventUpdate`, and the shutdown sequence) in robust `try...catch` blocks to gracefully catch and handle unexpected network or API errors without crashing the bot container.

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

This marks the first stable, production-ready release of Scotch Egg!

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