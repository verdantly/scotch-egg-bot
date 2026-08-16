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
            let deferCalled = false;
            let editReplyCalled = false;
            
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
                deferReply: async () => {
                    deferCalled = true;
                },
                editReply: async (payload) => {
                    editReplyCalled = true;
                    assert.ok(payload.content.includes('Current Server Settings'));
                }
            };

            await settingsCommand.execute(mockInteraction);

            assert.strictEqual(deferCalled, true, 'Command should defer reply');
            assert.strictEqual(editReplyCalled, true, 'Command should reply with settings view');
        });

        it('should handle threads subcommand with enabled and prune options', async () => {
            let deferCalled = false;
            let editReplyCalled = false;
            let replyContent = '';

            const mockInteraction = {
                options: {
                    getSubcommand: () => 'threads',
                    getBoolean: (name) => {
                        if (name === 'enabled') return true;
                        if (name === 'prune') return false;
                        return null;
                    }
                },
                guildId: 'guild_123',
                locale: 'en',
                deferReply: async () => {
                    deferCalled = true;
                },
                editReply: async (payload) => {
                    editReplyCalled = true;
                    replyContent = payload.content;
                }
            };

            await settingsCommand.execute(mockInteraction);

            assert.strictEqual(deferCalled, true);
            assert.strictEqual(editReplyCalled, true);
            assert.ok(replyContent.includes('Auto-creating discussion threads is now **enabled**'));
            assert.ok(replyContent.includes('30-day inactive thread auto-pruning is **disabled**'));
        });

        it('should correctly defer and edit reply for the intervals subcommand', async () => {
            let deferCalled = false;
            let editReplyCalled = false;
            
            const mockInteraction = {
                options: {
                    getSubcommand: () => 'intervals',
                    getString: () => '24h, 1h'
                },
                guildId: 'guild_123',
                locale: 'en',
                guild: {
                    scheduledEvents: {
                        fetch: async () => [] // Mock an empty array of events
                    },
                    members: {
                        me: {
                            permissionsIn: () => ({
                                has: () => true
                            })
                        }
                    }
                },
                deferReply: async () => {
                    deferCalled = true;
                },
                editReply: async (payload) => {
                    editReplyCalled = true;
                    assert.ok(payload.content.includes('24h, 1h'));
                }
            };

            await settingsCommand.execute(mockInteraction);

            assert.strictEqual(deferCalled, true, 'Command should call deferReply to prevent API timeouts');
            assert.strictEqual(editReplyCalled, true, 'Command should call editReply after processing');
        });
    });
});
