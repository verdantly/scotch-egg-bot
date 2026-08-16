const { getAnnouncementChannelId, getThreadPruneEnabled } = require('./config.js');
const { eventDb } = require('../storage.js');

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Checks if a thread was created by Scotch Egg for event discussions.
 * @param {import('discord.js').ThreadChannel} thread 
 * @param {import('discord.js').Guild} guild 
 * @returns {boolean}
 */
function isScotchEggDiscussionThread(thread, guild) {
    if (!thread) return false;
    const name = thread.name || '';
    
    // Check name patterns
    if (name.startsWith('💬 Discussion:') || name.startsWith('💬') || /discussion/i.test(name)) {
        return true;
    }
    
    // Check owner
    const botId = guild?.client?.user?.id;
    if (botId && thread.ownerId === botId) {
        return true;
    }
    
    // Check eventDb (message threads share their id with the announcement message)
    if (eventDb && eventDb[thread.id]) {
        return true;
    }
    
    return false;
}

/**
 * Prunes inactive bot-created discussion threads that are at least 30 days old in a specific channel.
 * @param {import('discord.js').TextChannel|import('discord.js').AnnouncementChannel} channel 
 * @param {import('discord.js').Guild} guild 
 * @returns {Promise<number>}
 */
async function pruneChannelThreads(channel, guild) {
    if (!channel || !channel.threads) return 0;
    let deletedCount = 0;
    const now = Date.now();
    const processedThreadIds = new Set();

    // 1. Fetch archived threads (public and private) with cursor-based pagination
    for (const type of ['public', 'private']) {
        let hasMore = true;
        let before = undefined;
        let pageCount = 0;

        while (hasMore && pageCount < 50) {
            pageCount++;
            const fetchOptions = { type, limit: 100 };
            if (before) {
                fetchOptions.before = before instanceof Date ? before.toISOString() : new Date(before).toISOString();
            }

            let archivedData;
            try {
                archivedData = await channel.threads.fetchArchived(fetchOptions);
            } catch (fetchErr) {
                // Ignore 403 / 50001 (Missing Permissions / Access) for private threads
                if (type !== 'private') {
                    console.error(`Failed to fetch archived ${type} threads in channel ${channel.id}:`, fetchErr);
                }
                break;
            }

            if (!archivedData || !archivedData.threads || archivedData.threads.size === 0) {
                break;
            }

            for (const [id, thread] of archivedData.threads) {
                if (processedThreadIds.has(id)) continue;
                processedThreadIds.add(id);

                const createdTs = thread.createdTimestamp || (Number(BigInt(id) >> 22n) + 1420070400000);
                const age = now - createdTs;

                if (isScotchEggDiscussionThread(thread, guild) && age >= THIRTY_DAYS_MS) {
                    let isInactive = thread.archived === true;
                    if (!isInactive) {
                        const lastMsgTs = thread.lastMessageId 
                            ? Number((BigInt(thread.lastMessageId) >> 22n) + 1420070400000) 
                            : createdTs;
                        isInactive = (now - lastMsgTs) >= THIRTY_DAYS_MS;
                    }

                    if (isInactive) {
                        try {
                            await thread.delete('Pruning inactive discussion thread older than 30 days');
                            deletedCount++;
                        } catch (deleteErr) {
                            console.error(`Failed to delete archived thread ${id}:`, deleteErr);
                        }
                    }
                }
            }

            hasMore = archivedData.hasMore === true && archivedData.threads.size > 0;
            const lastThread = Array.from(archivedData.threads.values()).pop();
            if (lastThread) {
                before = lastThread.archivedAt || (lastThread.archiveTimestamp ? new Date(lastThread.archiveTimestamp) : null);
            }
            if (!before) break;
        }
    }

    // 2. Fetch active threads that have been stale/inactive for 30+ days
    try {
        const activeData = await channel.threads.fetchActive().catch(() => null);
        if (activeData && activeData.threads) {
            for (const [id, thread] of activeData.threads) {
                if (processedThreadIds.has(id)) continue;
                processedThreadIds.add(id);

                const createdTs = thread.createdTimestamp || (Number(BigInt(id) >> 22n) + 1420070400000);
                const age = now - createdTs;

                const lastMsgTs = thread.lastMessageId 
                    ? Number((BigInt(thread.lastMessageId) >> 22n) + 1420070400000) 
                    : createdTs;
                const lastMsgAge = now - lastMsgTs;

                if (isScotchEggDiscussionThread(thread, guild) && age >= THIRTY_DAYS_MS && lastMsgAge >= THIRTY_DAYS_MS) {
                    try {
                        await thread.delete('Pruning inactive discussion thread older than 30 days');
                        deletedCount++;
                    } catch (deleteErr) {
                        console.error(`Failed to delete active thread ${id}:`, deleteErr);
                    }
                }
            }
        }
    } catch (err) {
        console.error(`Error fetching active threads in channel ${channel.id}:`, err);
    }

    // 3. Check any threads in guild cache that match this channel
    if (guild && guild.channels && guild.channels.cache) {
        for (const ch of guild.channels.cache.values()) {
            if (ch.isThread && ch.isThread() && ch.parentId === channel.id) {
                if (processedThreadIds.has(ch.id)) continue;
                processedThreadIds.add(ch.id);

                const createdTs = ch.createdTimestamp || (Number(BigInt(ch.id) >> 22n) + 1420070400000);
                const age = now - createdTs;

                if (isScotchEggDiscussionThread(ch, guild) && age >= THIRTY_DAYS_MS) {
                    const lastMsgTs = ch.lastMessageId 
                        ? Number((BigInt(ch.lastMessageId) >> 22n) + 1420070400000) 
                        : createdTs;
                    const isInactive = ch.archived === true || (now - lastMsgTs >= THIRTY_DAYS_MS);

                    if (isInactive) {
                        try {
                            await ch.delete('Pruning inactive discussion thread older than 30 days');
                            deletedCount++;
                        } catch (deleteErr) {
                            console.error(`Failed to delete cached thread ${ch.id}:`, deleteErr);
                        }
                    }
                }
            }
        }
    }

    return deletedCount;
}

/**
 * Prunes inactive bot-created discussion threads that are at least 30 days old across a guild.
 * @param {import('discord.js').Guild} guild 
 * @param {import('discord.js').TextChannel|import('discord.js').AnnouncementChannel} [customChannel] 
 * @returns {Promise<number>} Number of pruned threads
 */
async function pruneInactiveThreads(guild, customChannel = null) {
    if (!guild) return 0;
    if (!getThreadPruneEnabled(guild.id)) return 0;

    if (customChannel) {
        return await pruneChannelThreads(customChannel, guild);
    }

    let totalPruned = 0;
    const channelId = getAnnouncementChannelId(guild.id);
    const primaryChannel = channelId ? await guild.channels.fetch(channelId).catch(() => null) : null;

    if (primaryChannel) {
        totalPruned += await pruneChannelThreads(primaryChannel, guild);
    }

    return totalPruned;
}

module.exports = {
    pruneInactiveThreads,
    pruneChannelThreads,
    isScotchEggDiscussionThread,
    THIRTY_DAYS_MS
};
