const assert = require('assert');
const path = require('path');
const fs = require('fs');

describe('Commands Unit Tests', () => {
    describe('Command Loader Validation', () => {
        const commandsPath = path.join(__dirname, '..', 'commands');
        const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

        it('all command modules should export a data object and an execute function', () => {
            for (const file of commandFiles) {
                const command = require(path.join(commandsPath, file));
                assert.ok('data' in command, `Command ${file} is missing 'data' property`);
                assert.ok('execute' in command, `Command ${file} is missing 'execute' function`);
                assert.strictEqual(typeof command.execute, 'function', `Command ${file} 'execute' must be a function`);
            }
        });
    });

    describe('Settings Command', () => {
        const settingsCommand = require('../commands/settings.js');

        it('should have the correct slash command structure', () => {
            const data = settingsCommand.data.toJSON();
            assert.strictEqual(data.name, 'settings');
            assert.strictEqual(data.description, 'Manage bot configuration for this server.');
            assert.ok(data.options.length > 0, 'Settings should have subcommands');
        });

        it('should handle view subcommand by checking permissions and deferring reply', async () => {
            let replyCalled = false;
            
            const mockInteraction = {
                options: {
                    getSubcommand: () => 'view'
                },
                guildId: 'guild_123',
                locale: 'en',
                guild: {
                    name: 'Test Guild',
                    members: {
                        me: {
                            permissionsIn: () => ({
                                has: () => true
                            })
                        }
                    }
                },
                channel: {
                    id: 'channel_123'
                },
                reply: async (payload) => {
                    replyCalled = true;
                    assert.ok(payload.content.includes('Current Server Settings'));
                }
            };

            await settingsCommand.execute(mockInteraction);

            assert.strictEqual(replyCalled, true, 'Command should reply with settings view');
        });
    });
});
