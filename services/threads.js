const { getAnnouncementChannelId, getThreadPruneEnabled } = require('./config.js');
const { eventDb } = require('../storage.js');

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Checks if a thread is a discussion thread eligible for pruning.
 * @param {import('discord.js').ThreadChannel} thread 
 * @param {import('discord.js').Guild} guild 
 * @param {import('discord.js').TextChannel|import('discord.js').AnnouncementChannel} [channel]
 * @returns {boolean}
 */
function isScotchEggDiscussionThread(thread, guild, channel = null) {
    if (!thread) return false;
    const name = thread.name || '';
    
    // 1. Thread name matches discussion pattern or emoji
    if (name.startsWith('💬') || /discussion/i.test(name) || /discus/i.test(name) || /diskussion/i.test(name) || /débat/i.test(name) || /event/i.test(name)) {
        return true;
    }
    
    // 2. Created by or owned by the bot
    const botId = guild?.client?.user?.id;
    if (botId && (thread.ownerId === botId || thread.creatorId === botId)) {
        return true;
    }
    
    // 3. Thread ID matches an announcement message ID in eventDb
    if (eventDb && eventDb[thread.id]) {
        return true;
    }
    
    // 4. Any thread inside the announcement channel
    if (channel && (thread.parentId === channel.id || thread.parent?.id === channel.id)) {
        return true;
    }

    const announcementChannelId = guild ? getAnnouncementChannelId(guild.id) : null;
    if (announcementChannelId && (thread.parentId === announcementChannelId || thread.parent?.id === announcementChannelId)) {
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

    const candidateThreads = new Map();

    // 1. Fetch public archived threads via fetchArchived with cursor pagination
    try {
        let hasMore = true;
        let before = undefined;
        let pageCount = 0;

        while (hasMore && pageCount < 50) {
            pageCount++;
            const fetchOptions = { limit: 100 };
            if (before) {
                fetchOptions.before = before instanceof Date ? before.toISOString() : new Date(before).toISOString();
            }

            const archivedData = await channel.threads.fetchArchived(fetchOptions).catch(err => {
                console.error(`Error fetching public archived threads in channel ${channel.id}:`, err);
                return null;
            });

            if (!archivedData || !archivedData.threads || archivedData.threads.size === 0) {
                break;
            }

            for (const [id, thread] of archivedData.threads) {
                candidateThreads.set(id, thread);
            }

            hasMore = archivedData.hasMore === true && archivedData.threads.size > 0;
            const lastThread = Array.from(archivedData.threads.values()).pop();
            if (lastThread) {
                before = lastThread.archivedAt || (lastThread.archiveTimestamp ? new Date(lastThread.archiveTimestamp) : null);
            }
            if (!before) break;
        }
    } catch (err) {
        console.error(`Error in public archived thread pagination for channel ${channel.id}:`, err);
    }

    // 2. Fetch standard thread fetch / active threads
    try {
        if (typeof channel.threads.fetchActive === 'function') {
            const activeData = await channel.threads.fetchActive().catch(() => null);
            if (activeData && activeData.threads) {
                for (const [id, thread] of activeData.threads) {
                    candidateThreads.set(id, thread);
                }
            }
        }
    } catch (err) {
        console.error(`Error fetching active threads in channel ${channel.id}:`, err);
    }

    try {
        if (typeof channel.threads.fetch === 'function') {
            const fetched = await channel.threads.fetch().catch(() => null);
            if (fetched && fetched.threads) {
                for (const [id, thread] of fetched.threads) {
                    candidateThreads.set(id, thread);
                }
            }
        }
    } catch (err) {
        console.error(`Error fetching general threads in channel ${channel.id}:`, err);
    }

    // 3. Check thread cache on the channel and guild
    if (channel.threads && channel.threads.cache) {
        for (const [id, thread] of channel.threads.cache) {
            candidateThreads.set(id, thread);
        }
    }

    if (guild && guild.channels && guild.channels.cache) {
        for (const ch of guild.channels.cache.values()) {
            if (ch.isThread && ch.isThread() && (ch.parentId === channel.id || ch.parent?.id === channel.id)) {
                candidateThreads.set(ch.id, ch);
            }
        }
    }

    // Process all collected candidate threads
    for (const [id, thread] of candidateThreads.entries()) {
        if (processedThreadIds.has(id)) continue;
        processedThreadIds.add(id);

        const createdTs = thread.createdTimestamp || (Number(BigInt(id) >> 22n) + 1420070400000);
        const age = now - createdTs;

        if (isScotchEggDiscussionThread(thread, guild, channel) && age >= THIRTY_DAYS_MS) {
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
                    console.error(`Failed to delete inactive thread ${id} (${thread.name}):`, deleteErr);
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

    const channelsToScan = new Set();

    if (customChannel) {
        channelsToScan.add(customChannel);
    }

    const configuredChannelId = getAnnouncementChannelId(guild.id);
    if (configuredChannelId) {
        const primaryChannel = (guild.channels && guild.channels.cache ? guild.channels.cache.get(configuredChannelId) : null) || 
                              (guild.channels && typeof guild.channels.fetch === 'function' ? await guild.channels.fetch(configuredChannelId).catch(() => null) : null);
        if (primaryChannel) channelsToScan.add(primaryChannel);
    }

    // Also scan all text channels in guild cache
    if (guild.channels && guild.channels.cache) {
        for (const ch of guild.channels.cache.values()) {
            if (ch.threads && (ch.type === 0 || ch.type === 5)) {
                channelsToScan.add(ch);
            }
        }
    }

    let totalPruned = 0;
    for (const ch of channelsToScan) {
        try {
            totalPruned += await pruneChannelThreads(ch, guild);
        } catch (err) {
            console.error(`Error pruning threads in channel ${ch.id}:`, err);
        }
    }

    return totalPruned;
}

module.exports = {
    pruneInactiveThreads,
    pruneChannelThreads,
    isScotchEggDiscussionThread,
    THIRTY_DAYS_MS
};
