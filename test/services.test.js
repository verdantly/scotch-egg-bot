const assert = require('assert');
const { executeLiveCounterUpdate, setClient } = require('../services/reminders.js');
const storage = require('../storage.js');

describe('Services Unit Tests', () => {
    describe('Reminders Service - updateLiveCounter', () => {
        let originalDb;

        let originalServerConfig;

        beforeEach(() => {
            // Backup and reset DB
            originalDb = JSON.parse(JSON.stringify(storage.eventDb));
            originalServerConfig = JSON.parse(JSON.stringify(storage.serverConfig));
            
            // Populate mock data
            storage.eventDb['event_123'] = {
                messageId: 'msg_123',
                channelId: 'channel_123',
                guildId: 'guild_123',
                users: {
                    'user1': true,
                    'user2': true
                }
            };
            
            storage.serverConfig['guild_123'] = {
                channelId: 'channel_123'
            };
        });

        afterEach(() => {
            // Restore DB
            Object.keys(storage.eventDb).forEach(k => delete storage.eventDb[k]);
            Object.assign(storage.eventDb, originalDb);
            
            Object.keys(storage.serverConfig).forEach(k => delete storage.serverConfig[k]);
            Object.assign(storage.serverConfig, originalServerConfig);
        });

        it('should fetch the message and update the button component with the correct user count', async () => {
            let editedComponents = null;

            // Mock Discord client
            const mockMessage = {
                id: 'msg_123',
                components: [
                    {
                        type: 1,
                        components: [
                            { customId: 'remind_event_123', label: 'Remind Me!', style: 1, type: 2 },
                            { customId: 'view_event_123', label: 'View Event', style: 5, type: 2 }
                        ]
                    }
                ],
                edit: async (payload) => {
                    editedComponents = payload.components;
                }
            };

            const mockClient = {
                guilds: {
                    cache: {
                        get: (id) => {
                            if (id === 'guild_123') {
                                return {
                                    id: 'guild_123',
                                    preferredLocale: 'en',
                                    channels: {
                                        cache: {
                                            get: (cId) => {
                                                if (cId === 'channel_123') {
                                                    return {
                                                        messages: {
                                                            fetch: async (msgId) => {
                                                                if (msgId === 'msg_123') return mockMessage;
                                                                return null;
                                                            }
                                                        }
                                                    };
                                                }
                                                return null;
                                            }
                                        }
                                    }
                                };
                            }
                            return null;
                        }
                    }
                }
            };

            // Set the client in the service
            setClient(mockClient);

            // Execute the update
            await executeLiveCounterUpdate('event_123');

            // Assertions
            assert.ok(editedComponents);
            assert.strictEqual(editedComponents.length, 1);
            
            // The label should now include the count (2 users)
            const remindButton = editedComponents[0].components[0];
            assert.ok(remindButton.data.label.includes('(2)'));
        });

        it('should quietly resolve if the channel or message cannot be fetched', async () => {
            let editCalled = false;

            const mockClient = {
                guilds: {
                    cache: {
                        get: () => ({
                            channels: { cache: { get: () => null } }
                        })
                    }
                }
            };

            setClient(mockClient);

            // Execute the update - should not throw an error
            await executeLiveCounterUpdate('event_123');
            
            assert.strictEqual(editCalled, false);
        });
    });
});

