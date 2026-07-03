# Contributing to Scotch Egg

First off, thank you for considering contributing to Scotch Egg! It's people like you that make this bot a great tool for Discord communities.

## Project Architecture

Scotch Egg recently underwent a major refactoring to transition from a single monolithic file into a modular, scalable architecture. If you're looking to contribute, here is how the codebase is structured:

### Directory Structure

- **`/commands`**: Contains all the slash commands for the bot (e.g., `/settings`, `/upcoming`, `/myreminders`). Each file exports a `data` object (the SlashCommandBuilder definition) and an `execute(interaction)` function.
- **`/events`**: Contains native Discord event listeners (e.g., `ready.js`, `interactionCreate.js`, `guildScheduledEventCreate.js`).
- **`/handlers`**: Contains the core logic for loading and managing the bot's components.
  - `commandHandler.js`: Dynamically loads slash commands.
  - `eventHandler.js`: Dynamically loads Discord event listeners.
  - `jobHandler.js`: Manages the `node-schedule` background jobs for sending reminders.
- **`/services`**: Contains business logic and background services decoupled from direct Discord interactions.
  - `reminders.js`: Logic for formatting, sending, and updating reminders (like `updateLiveCounter`).
  - `events.js`: Logic for handling the lifecycle of Discord Scheduled Events.
  - `config.js`: Helpers for reading server-specific configurations.
- **`/test`**: Contains Mocha unit tests for the bot's logic.
- **`storage.js`**: Manages the local `events.json` and `config.json` databases, including the auto-healing fallback mechanisms.
- **`i18n.js`**: Contains all multi-language translations and localization functions.

## Development Workflow

1. **Fork & Clone**: Fork the repository and clone it to your local machine.
2. **Install Dependencies**: Run `npm install`.
3. **Environment**: Create a `.env` file using `.env.example` as a template and add your development Discord Bot Token.
4. **Create a Branch**: Create a new branch for your feature or bug fix (`git checkout -b feature/my-awesome-feature`).
5. **Make Changes**: Write your code! Try to follow the existing modular structure.
6. **Run Tests**: Ensure all tests pass by running `npm run test`. If you add a new service or command, please consider adding a test for it in the `/test` directory.
7. **Commit & Push**: Commit your changes and push them to your fork.
8. **Pull Request**: Open a pull request against the main repository.

## Adding New Commands

To add a new slash command:
1. Create a new file in the `/commands` directory (e.g., `mycommand.js`).
2. Export a `data` object (using `SlashCommandBuilder`) and an `execute` function.
3. Run `node deploy-commands.js` to register the new command with Discord.
4. If your command introduces new text, please add the necessary translation strings to `i18n.js`.

Thank you for helping make Scotch Egg better for everyone!
