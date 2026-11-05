const assert = require('assert');
const path = require('path');
const fs = require('fs');

describe('Commands Unit Tests', () => {
    let originalPromises;
    before(() => {
        originalPromises = fs.promises;
        Object.defineProperty(fs, 'promises', {
            value: { ...originalPromises, writeFile: async () => {}, rename: async () => {}, unlink: async () => {} },
            configurable: true,
            writable: true
        });
    });
    after(() => {
        Object.defineProperty(fs, 'promises', {
            value: originalPromises,
            configurable: true,
            writable: true
        });
    });
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
        it('should return interactive dashboard components on /settings view', () => {
            const payload = settingsCommand.buildSettingsDashboard('guild_123', 'en');
            assert.ok(payload.content.includes('Current Server Settings'));
            assert.strictEqual(payload.components.length, 2, 'Dashboard should include toggle button row and mode select row');
            assert.strictEqual(payload.components[0].components.length, 5, 'Toggle row should have 5 toggle buttons');
            assert.strictEqual(payload.components[1].components.length, 1, 'Select row should have 1 select menu');
        });

        it('should support autocomplete for /settings silenceevent and /announceevent', async () => {
            const announceCmd = require('../commands/announceevent.js');
            let respondedChoices = null;
            const mockEvents = new Map([
                ['evt_1', { id: 'evt_1', name: 'Board Game Night', status: 1, scheduledStartTimestamp: 1780272000000 }],
                ['evt_2', { id: 'evt_2', name: 'Movie Night', status: 1, scheduledStartTimestamp: 1780358400000 }]
            ]);

            const mockAutoInteraction = {
                options: {
                    getSubcommand: () => 'silenceevent',
                    getFocused: () => 'board'
                },
                guild: {
                    scheduledEvents: {
                        cache: mockEvents,
                        fetch: async () => mockEvents
                    }
                },
                respond: async (choices) => { respondedChoices = choices; }
            };

            await settingsCommand.autocomplete(mockAutoInteraction);
            assert.ok(Array.isArray(respondedChoices));
            assert.strictEqual(respondedChoices.length, 1);
            assert.strictEqual(respondedChoices[0].value, 'evt_1');
            assert.ok(respondedChoices[0].name.includes('Board Game Night'));

            let announceChoices = null;
            await announceCmd.autocomplete({
                ...mockAutoInteraction,
                options: { getFocused: () => 'movie' },
                respond: async (choices) => { announceChoices = choices; }
            });
            assert.strictEqual(announceChoices.length, 1);
            assert.strictEqual(announceChoices[0].value, 'evt_2');
        });
    });

    describe('Live Announcement Refresh (5.5)', () => {
        it('should refresh active guild announcement embeds and buttons when settings change', async () => {
            const { refreshGuildAnnouncements } = require('../services/announcements.js');
            const { eventDb, serverConfig } = require('../storage.js');

            let editedPayload = null;
            const mockEvent = {
                id: 'evt_refresh_1',
                name: 'Community Hangout',
                status: 1,
                scheduledStartTimestamp: Date.now() + 86400000,
                guild: { id: 'guild_refresh', preferredLocale: 'en' },
                coverImageURL: () => null
            };

            eventDb['evt_refresh_1'] = {
                messageId: 'msg_refresh_1',
                channelId: 'chan_refresh_1',
                guildId: 'guild_refresh',
                users: { 'u1': true, 'u2': true }
            };
            serverConfig['guild_refresh'] = {
                channelId: 'chan_refresh_1',
                mode: 'public',
                calendarEnabled: false,
                intervals: [{ value: 12, unit: 'h', ms: 43200000 }]
            };

            const mockGuild = {
                id: 'guild_refresh',
                preferredLocale: 'en',
                scheduledEvents: {
                    fetch: async () => new Map([['evt_refresh_1', mockEvent]])
                },
                channels: {
                    fetch: async () => ({
                        messages: {
                            fetch: async () => ({
                                edit: async (payload) => { editedPayload = payload; }
                            })
                        }
                    })
                }
            };

            const count = await refreshGuildAnnouncements(mockGuild);
            assert.strictEqual(count, 1);
            assert.ok(editedPayload);
            const embedDesc = editedPayload.embeds[0].data.description;
            assert.ok(embedDesc.includes('12h'), 'Refreshed embed should reflect updated 12h interval');
            const buttons = editedPayload.components[0].components;
            assert.strictEqual(buttons.length, 2, 'Calendar button should be omitted when calendarEnabled is false');
            assert.ok(buttons[0].data.label.includes('(2)'), 'Remind button should preserve live opt-in count (2)');

            delete eventDb['evt_refresh_1'];
            delete serverConfig['guild_refresh'];
        });
    });
});
