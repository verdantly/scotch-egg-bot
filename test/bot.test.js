const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Set environment to test so index.js exports functions and does not log in
process.env.NODE_ENV = 'test';
process.env.ANNOUNCEMENT_CHANNEL_ID = 'env_channel_default';

const DB_PATH = path.resolve(__dirname, '../events.json');
const CONFIG_PATH = path.resolve(__dirname, '../config.json');

// Mock filesystem before importing anything
const originalExistsSync = fs.existsSync;
const originalReadFileSync = fs.readFileSync;
const originalWriteFileSync = fs.writeFileSync;
const originalPromises = fs.promises;

let mockFiles = {};
mockFiles[DB_PATH] = '{}';
mockFiles[CONFIG_PATH] = '{}';

fs.existsSync = (p) => {
    if (typeof p === 'string' && (p === DB_PATH || p === CONFIG_PATH || p.endsWith('.bak') || p.endsWith('.tmp'))) {
        return p in mockFiles;
    }
    return originalExistsSync(p);
};
fs.readFileSync = (p, encoding) => {
    if (typeof p === 'string' && (p === DB_PATH || p === CONFIG_PATH || p.endsWith('.bak') || p.endsWith('.tmp'))) {
        if (p in mockFiles) return mockFiles[p];
        throw new Error(`ENOENT: no such file or directory, open '${p}'`);
    }
    return originalReadFileSync(p, encoding);
};
fs.writeFileSync = (p, content) => {
    if (p === DB_PATH || p === CONFIG_PATH || p.endsWith('.bak') || p.endsWith('.tmp')) {
        mockFiles[p] = content;
        return;
    }
    return originalWriteFileSync(p, content);
};
fs.promises = {
    ...originalPromises,
    writeFile: async (p, content) => {
        if (p === DB_PATH || p === CONFIG_PATH || p.endsWith('.bak') || p.endsWith('.tmp')) {
            mockFiles[p] = content;
            return;
        }
        return originalPromises.writeFile(p, content);
    },
    rename: async (oldP, newP) => {
        if (oldP === DB_PATH || oldP === CONFIG_PATH || oldP.endsWith('.bak') || oldP.endsWith('.tmp')) {
            mockFiles[newP] = mockFiles[oldP];
            delete mockFiles[oldP];
            return;
        }
        return originalPromises.rename(oldP, newP);
    },
    unlink: async (p) => {
        if (p === DB_PATH || p === CONFIG_PATH || p.endsWith('.bak') || p.endsWith('.tmp')) {
            delete mockFiles[p];
            return;
        }
        return originalPromises.unlink(p);
    }
};

// Mock node-schedule before index.js imports it
const schedule = require('node-schedule');
const scheduledJobs = {};
schedule.scheduledJobs = {};
schedule.scheduleJob = (id, time, callback) => {
    scheduledJobs[id] = { id, time, callback };
    const job = {
        cancel: () => {
            delete scheduledJobs[id];
            delete schedule.scheduledJobs[id];
        }
    };
    schedule.scheduledJobs[id] = job;
    return job;
};

// Now import storage.js and index.js
const storage = require('../storage.js');
const bot = require('../index.js');
const { client } = bot;

describe('Bot Logic Unit Tests', () => {
    beforeEach(() => {
        // Reset databases
        for (const key in storage.eventDb) delete storage.eventDb[key];
        for (const key in storage.serverConfig) delete storage.serverConfig[key];
        // Reset scheduled jobs
        for (const key in scheduledJobs) delete scheduledJobs[key];
        for (const key in schedule.scheduledJobs) delete schedule.scheduledJobs[key];
    });

    after(() => {
        // Restore filesystem
        fs.existsSync = originalExistsSync;
        fs.readFileSync = originalReadFileSync;
        fs.writeFileSync = originalWriteFileSync;
        fs.promises = originalPromises;
    });

    describe('isEventSilenced()', () => {
        it('should return true if name contains [silent] or [exclude]', () => {
            assert.strictEqual(bot.isEventSilenced({ name: 'Meeting [silent]', description: '' }), true);
            assert.strictEqual(bot.isEventSilenced({ name: 'Class [exclude]', description: '' }), true);
        });

        it('should return true if description contains [silent] or [exclude]', () => {
            assert.strictEqual(bot.isEventSilenced({ name: 'Meeting', description: 'This is [silent] discussion' }), true);
            assert.strictEqual(bot.isEventSilenced({ name: 'Class', description: 'This is [exclude] discussion' }), true);
        });

        it('should return true if event is marked disabled in eventDb', () => {
            storage.eventDb['event_1'] = { remindersDisabled: true };
            assert.strictEqual(bot.isEventSilenced({ id: 'event_1', name: 'Meeting', description: '' }), true);
        });

        it('should return false for regular events', () => {
            assert.strictEqual(bot.isEventSilenced({ id: 'event_normal', name: 'Normal Meeting', description: 'Regular description' }), false);
        });
    });

    describe('getAnnouncementChannelId()', () => {
        it('should prioritize guild config channel if set', () => {
            storage.serverConfig['guild_1'] = { channelId: 'guild_config_channel' };
            assert.strictEqual(bot.getAnnouncementChannelId('guild_1'), 'guild_config_channel');
        });

        it('should fall back to process.env.ANNOUNCEMENT_CHANNEL_ID', () => {
            assert.strictEqual(bot.getAnnouncementChannelId('guild_none'), 'env_channel_default');
        });
    });

    describe('getPingsEnabled()', () => {
        it('should return true by default if no guild config exists', () => {
            assert.strictEqual(bot.getPingsEnabled('guild_new'), true);
        });

        it('should return config value if explicitly set', () => {
            storage.serverConfig['guild_1'] = { pingsEnabled: false };
            assert.strictEqual(bot.getPingsEnabled('guild_1'), false);
        });
    });

    describe('Reminder Dispatch Exception Handling (v1.6.1)', () => {
        let sentMessages = [];
        let fetchedChannel = null;

        const mockGuild = {
            id: 'guild_123',
            preferredLocale: 'en',
            channels: {
                fetch: async (id) => fetchedChannel
            }
        };

        const mockChannel = {
            id: 'channel_announce',
            send: async (payload) => {
                sentMessages.push(payload);
                return { id: 'sent_msg_id' };
            }
        };

        beforeEach(() => {
            sentMessages = [];
            fetchedChannel = mockChannel;
        });

        it('should skip reminder when occurrence is marked as canceled in exceptions', async () => {
            // Setup database event
            storage.eventDb['event_recurring'] = {
                messageId: 'announce_msg',
                users: {}
            };

            const scheduledTime = 1780272000000; // 2026-06-01T00:00:00.000Z
            
            // matching exception id for 2026-06-01T00:00:00.000Z
            const exceptionId = (BigInt(1780272000000 - 1420070400000) << 22n).toString();

            const event = {
                id: 'event_recurring',
                scheduledStartTimestamp: scheduledTime,
                guild: mockGuild,
                client: {
                    rest: {
                        get: async () => ({
                            status: 1, // Scheduled
                            scheduled_start_time: '2026-06-01T00:00:00.000Z',
                            guild_scheduled_event_exceptions: [
                                { event_exception_id: exceptionId, is_canceled: true }
                            ]
                        })
                    }
                }
            };

            // Call scheduleRemindersForEvent to schedule the job
            // Set now to be 25 hours before scheduledTime so 24h job schedules
            const now = scheduledTime - (25 * 60 * 60 * 1000);
            bot.scheduleRemindersForEvent(event, now);

            // Fetch the scheduled job (id is 'event_recurring-24h')
            const job = scheduledJobs['event_recurring-24h'];
            assert.ok(job);

            // Execute the callback
            await job.callback();

            // Verify no messages were sent
            assert.strictEqual(sentMessages.length, 0);
        });

        it('should proceed with reminder if occurrence exception is NOT canceled', async () => {
            storage.eventDb['event_recurring'] = {
                messageId: 'announce_msg',
                users: {}
            };

            const scheduledTime = 1780272000000;
            const exceptionId = (BigInt(1780272000000 - 1420070400000) << 22n).toString();

            const event = {
                id: 'event_recurring',
                scheduledStartTimestamp: scheduledTime,
                guild: mockGuild,
                client: {
                    rest: {
                        get: async () => ({
                            status: 1,
                            scheduled_start_time: '2026-06-01T00:00:00.000Z',
                            guild_scheduled_event_exceptions: [
                                { event_exception_id: exceptionId, is_canceled: false }
                            ]
                        })
                    }
                }
            };

            const now = scheduledTime - (25 * 60 * 60 * 1000);
            bot.scheduleRemindersForEvent(event, now);

            const job = scheduledJobs['event_recurring-24h'];
            await job.callback();

            // Should have successfully sent the reminder
            assert.strictEqual(sentMessages.length, 1);
            assert.ok(sentMessages[0] || true);
        });

        it('should skip reminder if the scheduled start time has changed (rescheduled)', async () => {
            storage.eventDb['event_recurring'] = {
                messageId: 'announce_msg',
                users: {}
            };

            const event = {
                id: 'event_recurring',
                scheduledStartTimestamp: 1780272000000, // old time
                guild: mockGuild,
                client: {
                    rest: {
                        get: async () => ({
                            status: 1,
                            scheduled_start_time: '2026-06-02T00:00:00.000Z', // new time
                            guild_scheduled_event_exceptions: []
                        })
                    }
                }
            };

            const now = 1780272000000 - (25 * 60 * 60 * 1000);
            bot.scheduleRemindersForEvent(event, now);

            const job = scheduledJobs['event_recurring-24h'];
            await job.callback();

            // Verify no message was sent (skipped due to start time mismatch)
            assert.strictEqual(sentMessages.length, 0);
        });

        it('should skip reminder if the API fetch returns 404/null', async () => {
            storage.eventDb['event_recurring'] = {
                messageId: 'announce_msg',
                users: {}
            };

            const event = {
                id: 'event_recurring',
                scheduledStartTimestamp: 1780272000000,
                guild: mockGuild,
                client: {
                    rest: {
                        get: async () => {
                            throw new Error('404 Not Found');
                        }
                    }
                }
            };

            const now = 1780272000000 - (25 * 60 * 60 * 1000);
            bot.scheduleRemindersForEvent(event, now);

            const job = scheduledJobs['event_recurring-24h'];
            await job.callback();

            assert.strictEqual(sentMessages.length, 0);
        });
    });

    describe('Offline Garbage Collection (ClientReady)', () => {
        it('should purge events from guilds the bot is no longer in', async () => {
            const oldGuildEventId = '111111111111111111';
            const activeGuildEventId = '222222222222222222';

            storage.eventDb[oldGuildEventId] = {
                guildId: 'old_guild_id',
                users: {}
            };
            storage.eventDb[activeGuildEventId] = {
                guildId: 'active_guild_id',
                users: {}
            };

            const activeEvent = {
                id: activeGuildEventId,
                guild: { id: 'active_guild_id' },
                status: 1,
                scheduledStartTimestamp: Date.now() + 10000
            };
            const scheduledEventsMap = new Map([[activeGuildEventId, activeEvent]]);

            const mockClient = {
                user: {
                    tag: 'TestBot#0000',
                    setActivity: () => {}
                },
                guilds: {
                    cache: {
                        has: (id) => id === 'active_guild_id',
                        get: (id) => id === 'active_guild_id' ? {
                            id: 'active_guild_id',
                            scheduledEvents: {
                                fetch: async () => scheduledEventsMap,
                                cache: scheduledEventsMap
                            },
                            channels: {
                                fetch: async () => null
                            }
                        } : null,
                        map: (fn) => [fn({
                            id: 'active_guild_id',
                            scheduledEvents: {
                                fetch: async () => scheduledEventsMap,
                                cache: scheduledEventsMap
                            },
                            channels: {
                                fetch: async () => null
                            }
                        })]
                    }
                }
            };

            const readyListeners = client.listeners('clientReady');
            assert.ok(readyListeners.length > 0);
            
            await readyListeners[0](mockClient);

            // oldGuildEventId should be deleted, activeGuildEventId should be kept
            assert.strictEqual(storage.eventDb[oldGuildEventId], undefined);
            assert.ok(storage.eventDb[activeGuildEventId]);
        });

        it('should purge inactive events older than 30 days but keep active ones', async () => {
            const now = Date.now();
            const olderThan30DaysEventId = (BigInt(now - (35 * 24 * 60 * 60 * 1000) - 1420070400000) << 22n).toString();
            const activeOlderThan30DaysEventId = (BigInt(now - (36 * 24 * 60 * 60 * 1000) - 1420070400000) << 22n).toString();

            storage.eventDb[olderThan30DaysEventId] = {
                guildId: 'active_guild_id',
                users: {}
            };
            storage.eventDb[activeOlderThan30DaysEventId] = {
                guildId: 'active_guild_id',
                users: {}
            };

            const activeEvent = {
                id: activeOlderThan30DaysEventId,
                guild: { id: 'active_guild_id' },
                status: 1,
                scheduledStartTimestamp: now + 10000
            };
            const scheduledEventsMap = new Map([[activeOlderThan30DaysEventId, activeEvent]]);

            const mockClient = {
                user: {
                    tag: 'TestBot#0000',
                    setActivity: () => {}
                },
                guilds: {
                    cache: {
                        has: (id) => id === 'active_guild_id',
                        get: (id) => id === 'active_guild_id' ? {
                            id: 'active_guild_id',
                            scheduledEvents: {
                                fetch: async () => scheduledEventsMap,
                                cache: scheduledEventsMap
                            },
                            channels: {
                                fetch: async () => null
                            }
                        } : null,
                        map: (fn) => [fn({
                            id: 'active_guild_id',
                            scheduledEvents: {
                                fetch: async () => scheduledEventsMap,
                                cache: scheduledEventsMap
                            },
                            channels: {
                                fetch: async () => null
                            }
                        })]
                    }
                }
            };

            const readyListeners = client.listeners('clientReady');
            await readyListeners[0](mockClient);

            // Inactive older than 30 days should be deleted
            assert.strictEqual(storage.eventDb[olderThan30DaysEventId], undefined);
            // Active older than 30 days should be kept
            assert.ok(storage.eventDb[activeOlderThan30DaysEventId]);
        });
    });

    describe('Button Interaction Handling', () => {
        it('should handle remind_ button to add and remove users from events', async () => {
            const eventId = '333333333333333333';
            storage.eventDb[eventId] = {
                messageId: 'msg_123',
                guildId: 'guild_123',
                users: {}
            };

            let editReplyContent = null;
            let originalMsgEdited = false;

            const mockInteractionOptIn = {
                customId: `remind_${eventId}`,
                locale: 'en',
                user: { id: 'user_remind_optin' },
                guildId: 'guild_123',
                guild: {
                    preferredLocale: 'en',
                    scheduledEvents: {
                        fetch: async (id) => ({ id, status: 1, scheduledStartTimestamp: Date.now() + 10000 })
                    }
                },
                message: {
                    id: 'msg_123',
                    components: [
                        {
                            components: [
                                { customId: `remind_${eventId}`, label: '⏰ Remind Me!' }
                            ]
                        }
                    ],
                    edit: async () => {
                        originalMsgEdited = true;
                    }
                },
                isChatInputCommand: () => false,
                isStringSelectMenu: () => false,
                reply: async () => {},
                deferReply: async () => {},
                editReply: async (payload) => {
                    editReplyContent = payload.content;
                }
            };

            const mockInteractionOptOut = {
                ...mockInteractionOptIn,
                user: { id: 'user_remind_optout' },
                editReply: async (payload) => {
                    editReplyContent = payload.content;
                }
            };

            const interactionListeners = client.listeners('interactionCreate');
            assert.ok(interactionListeners.length > 0);

            // Click to Opt In (using user_remind_optin)
            await interactionListeners[0](mockInteractionOptIn);
            assert.strictEqual(storage.eventDb[eventId].users['user_remind_optin'], true);
            assert.ok(editReplyContent.includes('Reminder set') || editReplyContent.includes('configurado') || editReplyContent.includes('definido'));
            assert.strictEqual(originalMsgEdited, true);

            // Set up opt-out state by ensuring the database has user_remind_optout as opted in
            storage.eventDb[eventId].users['user_remind_optout'] = true;

            // Click again to Opt Out (using user_remind_optout)
            editReplyContent = null;
            originalMsgEdited = false;
            await interactionListeners[0](mockInteractionOptOut);
            assert.strictEqual(storage.eventDb[eventId].users['user_remind_optout'], undefined);
            assert.ok(editReplyContent.includes('no longer') || editReplyContent.includes('recibir') || editReplyContent.includes('receber'));
            assert.strictEqual(originalMsgEdited, true);
        });

        it('should handle cancel_remind_ button for recurring events', async () => {
            const eventId = '444444444444444444';
            storage.eventDb[eventId] = {
                messageId: 'msg_123',
                guildId: 'guild_123',
                users: { 'user_cancel_remind': true }
            };

            let updatedPayload = null;

            const mockInteraction = {
                customId: `cancel_remind_${eventId}`,
                locale: 'en',
                user: { id: 'user_cancel_remind' },
                guildId: 'guild_123',
                guild: {
                    preferredLocale: 'en'
                },
                message: {
                    id: 'msg_123',
                    content: 'Active Reminder',
                    components: []
                },
                isChatInputCommand: () => false,
                isStringSelectMenu: () => false,
                reply: async () => {},
                deferReply: async () => {},
                update: async (payload) => {
                    updatedPayload = payload;
                }
            };

            const originalGuildsCacheGet = client.guilds.cache.get;
            client.guilds.cache.get = (id) => ({
                scheduledEvents: {
                    fetch: async (id) => ({
                        id,
                        status: 1, // Scheduled
                        recurrenceRule: {}
                    })
                }
            });

            const interactionListeners = client.listeners('interactionCreate');
            await interactionListeners[0](mockInteraction);

            // Should show interactive cancel options (next occurrence or entire series)
            assert.ok(updatedPayload);
            assert.ok(updatedPayload.content.includes('recurring series') || updatedPayload.content.includes('recurrente') || updatedPayload.content.includes('recorrente'));
            assert.strictEqual(updatedPayload.components.length, 1);
            
            client.guilds.cache.get = originalGuildsCacheGet;
        });

        it('should handle cancel_occ_ button to cancel only next occurrence', async () => {
            const eventId = '555555555555555555';
            const startTime = Date.now() + 100000;
            storage.eventDb[eventId] = {
                messageId: 'msg_123',
                guildId: 'guild_123',
                users: { 'user_cancel_occ': true },
                skippedUsers: {}
            };

            let updatedPayload = null;

            const mockInteraction = {
                customId: `cancel_occ_${eventId}`,
                locale: 'en',
                user: { id: 'user_cancel_occ' },
                guildId: 'guild_123',
                message: {
                    content: 'Active Reminder'
                },
                isChatInputCommand: () => false,
                isStringSelectMenu: () => false,
                reply: async () => {},
                deferReply: async () => {},
                update: async (payload) => {
                    updatedPayload = payload;
                }
            };

            const originalGuildsCacheGet = client.guilds.cache.get;
            client.guilds.cache.get = (id) => ({
                scheduledEvents: {
                    fetch: async (id) => ({
                        id,
                        scheduledStartTimestamp: startTime
                    })
                }
            });

            const interactionListeners = client.listeners('interactionCreate');
            await interactionListeners[0](mockInteraction);

            // User should be in skippedUsers for this occurrence
            assert.strictEqual(storage.eventDb[eventId].skippedUsers['user_cancel_occ'], startTime);
            assert.strictEqual(storage.eventDb[eventId].users['user_cancel_occ'], true); // Series opt-in stays true
            assert.ok(updatedPayload.content.includes('cancelled') || updatedPayload.content.includes('canceló') || updatedPayload.content.includes('Successfully'));

            client.guilds.cache.get = originalGuildsCacheGet;
        });

        it('should handle cancel_series_ button to cancel entire series', async () => {
            const eventId = '666666666666666666';
            storage.eventDb[eventId] = {
                messageId: 'msg_123',
                guildId: 'guild_123',
                users: { 'user_cancel_series': true },
                skippedUsers: { 'user_cancel_series': 12345 }
            };

            let updatedPayload = null;

            const mockInteraction = {
                customId: `cancel_series_${eventId}`,
                locale: 'en',
                user: { id: 'user_cancel_series' },
                guildId: 'guild_123',
                message: {
                    content: 'Active Reminder'
                },
                isChatInputCommand: () => false,
                isStringSelectMenu: () => false,
                reply: async () => {},
                deferReply: async () => {},
                update: async (payload) => {
                    updatedPayload = payload;
                }
            };

            const interactionListeners = client.listeners('interactionCreate');
            await interactionListeners[0](mockInteraction);

            // User should be removed completely
            assert.strictEqual(storage.eventDb[eventId].users['user_cancel_series'], undefined);
            assert.strictEqual(storage.eventDb[eventId].skippedUsers['user_cancel_series'], undefined);
            assert.ok(updatedPayload.content.includes('Unsubscribed') || updatedPayload.content.includes('serie') || updatedPayload.content.includes('série'));
        });
    });
});
