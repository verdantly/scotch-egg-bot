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

    try {
        // 1. Fetch all archived threads with pagination support
        for (const type of ['public', 'private']) {
            let hasMore = true;
            let before = undefined;

            while (hasMore) {
                const options = { type, limit: 100, fetchAll: true };
                if (before) options.before = before;

                const archivedData = await channel.threads.fetchArchived(options).catch(() => null);
                if (!archivedData || !archivedData.threads || archivedData.threads.size === 0) {
                    break;
                }

                for (const [id, thread] of archivedData.threads) {
                    if (processedThreadIds.has(id)) continue;
                    processedThreadIds.add(id);

                    const createdTs = thread.createdTimestamp || (Number(BigInt(id) >> 22n) + 1420070400000);
                    const age = now - createdTs;

                    // Last message timestamp
                    const lastMsgTs = thread.lastMessageId 
                        ? Number((BigInt(thread.lastMessageId) >> 22n) + 1420070400000) 
                        : createdTs;
                    const lastMsgAge = now - lastMsgTs;

                    if (isScotchEggDiscussionThread(thread, guild) && age >= THIRTY_DAYS_MS && lastMsgAge >= THIRTY_DAYS_MS) {
                        try {
                            await thread.delete('Pruning inactive discussion thread older than 30 days');
                            deletedCount++;
                        } catch (err) {
                            console.error(`Failed to delete archived thread ${id}:`, err);
                        }
                    }
                }

                hasMore = archivedData.hasMore === true && archivedData.threads.size > 0;
                const lastThread = Array.from(archivedData.threads.values()).pop();
                before = lastThread ? (lastThread.archiveTimestamp || lastThread.archivedAt || lastThread.id) : undefined;
                if (!before) break;
            }
        }

        // 2. Fetch active threads that have been stale/inactive for 30+ days
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
                    } catch (err) {
                        console.error(`Failed to delete active thread ${id}:`, err);
                    }
                }
            }
        }
    } catch (err) {
        console.error(`Error while pruning threads in channel ${channel.id}:`, err);
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
