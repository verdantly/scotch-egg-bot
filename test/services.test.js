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

    describe('Threads Service - pruneInactiveThreads', () => {
        const { pruneInactiveThreads, THIRTY_DAYS_MS } = require('../services/threads.js');
        let originalServerConfig;

        beforeEach(() => {
            originalServerConfig = JSON.parse(JSON.stringify(storage.serverConfig));
            storage.serverConfig['guild_threads'] = {
                channelId: 'channel_threads',
                threadPruneEnabled: true
            };
        });

        afterEach(() => {
            Object.keys(storage.serverConfig).forEach(k => delete storage.serverConfig[k]);
            Object.assign(storage.serverConfig, originalServerConfig);
        });

        it('should prune bot-created archived threads older than 30 days', async () => {
            const now = Date.now();
            let deletedThreadIds = [];

            const oldArchivedThread = {
                id: 'thread_old',
                name: '💬 Discussion: Old Event',
                ownerId: 'bot_id',
                createdTimestamp: now - (THIRTY_DAYS_MS + 10000),
                archiveTimestamp: now - (THIRTY_DAYS_MS + 5000),
                archived: true,
                delete: async () => {
                    deletedThreadIds.push('thread_old');
                }
            };

            const recentArchivedThread = {
                id: 'thread_recent',
                name: '💬 Discussion: Recent Event',
                ownerId: 'bot_id',
                createdTimestamp: now - (5 * 24 * 60 * 60 * 1000),
                archiveTimestamp: now - (2 * 24 * 60 * 60 * 1000),
                archived: true,
                delete: async () => {
                    deletedThreadIds.push('thread_recent');
                }
            };

            const userCreatedOldThread = {
                id: 'thread_user',
                name: 'General Discussion',
                ownerId: 'user_123',
                createdTimestamp: now - (40 * 24 * 60 * 60 * 1000),
                archiveTimestamp: now - (35 * 24 * 60 * 60 * 1000),
                archived: true,
                delete: async () => {
                    deletedThreadIds.push('thread_user');
                }
            };

            const mockChannel = {
                id: 'channel_threads',
                threads: {
                    fetchArchived: async () => ({
                        threads: new Map([
                            ['thread_old', oldArchivedThread],
                            ['thread_recent', recentArchivedThread],
                            ['thread_user', userCreatedOldThread]
                        ])
                    }),
                    fetchActive: async () => ({
                        threads: new Map()
                    })
                }
            };

            const mockGuild = {
                id: 'guild_threads',
                client: {
                    user: { id: 'bot_id' }
                },
                channels: {
                    fetch: async (id) => (id === 'channel_threads' ? mockChannel : null)
                }
            };

            const count = await pruneInactiveThreads(mockGuild);

            assert.strictEqual(count, 1);
            assert.deepStrictEqual(deletedThreadIds, ['thread_old']);
        });

        it('should handle pagination and ISO string before parameter', async () => {
            const now = Date.now();
            let deletedThreadIds = [];
            let callCount = 0;

            const page1Thread = {
                id: 'thread_page1',
                name: '💬 Discussion: Event 1',
                ownerId: 'bot_id',
                createdTimestamp: now - (THIRTY_DAYS_MS + 10000),
                archiveTimestamp: now - (THIRTY_DAYS_MS + 5000),
                archived: true,
                delete: async () => { deletedThreadIds.push('thread_page1'); }
            };

            const page2Thread = {
                id: 'thread_page2',
                name: '💬 Discussion: Event 2',
                ownerId: 'bot_id',
                createdTimestamp: now - (THIRTY_DAYS_MS + 20000),
                archiveTimestamp: now - (THIRTY_DAYS_MS + 15000),
                archived: true,
                delete: async () => { deletedThreadIds.push('thread_page2'); }
            };

            const mockChannel = {
                id: 'channel_threads',
                threads: {
                    fetchArchived: async (options) => {
                        callCount++;
                        if (options.type === 'private') {
                            return { threads: new Map(), hasMore: false };
                        }
                        if (!options.before) {
                            return {
                                threads: new Map([['thread_page1', page1Thread]]),
                                hasMore: true
                            };
                        } else {
                            return {
                                threads: new Map([['thread_page2', page2Thread]]),
                                hasMore: false
                            };
                        }
                    },
                    fetchActive: async () => ({ threads: new Map() })
                }
            };

            const mockGuild = {
                id: 'guild_threads',
                client: { user: { id: 'bot_id' } },
                channels: {
                    fetch: async (id) => (id === 'channel_threads' ? mockChannel : null),
                    cache: new Map()
                }
            };

            const count = await pruneInactiveThreads(mockGuild);

            assert.strictEqual(count, 2);
            assert.deepStrictEqual(deletedThreadIds, ['thread_page1', 'thread_page2']);
            assert.strictEqual(callCount >= 2, true);
        });

        it('should do nothing if threadPruneEnabled is false', async () => {
            storage.serverConfig['guild_threads'].threadPruneEnabled = false;
            const mockGuild = {
                id: 'guild_threads'
            };

            const count = await pruneInactiveThreads(mockGuild);
            assert.strictEqual(count, 0);
        });
    });
});
