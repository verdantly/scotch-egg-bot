const { getAnnouncementChannelId, getThreadPruneEnabled } = require('./config.js');

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Prunes inactive bot-created discussion threads that are at least 30 days old.
 * @param {import('discord.js').Guild} guild 
 * @param {import('discord.js').TextChannel|import('discord.js').AnnouncementChannel} [customChannel] 
 * @returns {Promise<number>} Number of pruned threads
 */
async function pruneInactiveThreads(guild, customChannel = null) {
    if (!guild) return 0;
    if (!getThreadPruneEnabled(guild.id)) return 0;

    let channel = customChannel;
    if (!channel) {
        const channelId = getAnnouncementChannelId(guild.id);
        channel = channelId ? await guild.channels.fetch(channelId).catch(() => null) : null;
    }

    if (!channel || !channel.threads) return 0;

    let deletedCount = 0;
    const now = Date.now();

    try {
        // 1. Fetch archived public threads
        const archivedData = await channel.threads.fetchArchived({ type: 'public' }).catch(() => null);
        if (archivedData && archivedData.threads) {
            for (const [id, thread] of archivedData.threads) {
                const createdTs = thread.createdTimestamp || (Number(BigInt(id) >> 22n) + 1420070400000);
                const age = now - createdTs;
                const lastActivityAge = thread.archiveTimestamp ? (now - thread.archiveTimestamp) : age;

                const isBotDiscussion = (thread.name && thread.name.startsWith('💬 Discussion:')) || 
                                       (thread.ownerId && guild.client && guild.client.user && thread.ownerId === guild.client.user.id);

                if (isBotDiscussion && age >= THIRTY_DAYS_MS && lastActivityAge >= THIRTY_DAYS_MS) {
                    try {
                        await thread.delete('Pruning inactive discussion thread older than 30 days');
                        deletedCount++;
                    } catch (err) {
                        console.error(`Failed to delete archived thread ${id}:`, err);
                    }
                }
            }
        }

        // 2. Fetch active threads that have been stale/inactive for 30+ days
        const activeData = await channel.threads.fetchActive().catch(() => null);
        if (activeData && activeData.threads) {
            for (const [id, thread] of activeData.threads) {
                const createdTs = thread.createdTimestamp || (Number(BigInt(id) >> 22n) + 1420070400000);
                const age = now - createdTs;

                const isBotDiscussion = (thread.name && thread.name.startsWith('💬 Discussion:')) || 
                                       (thread.ownerId && guild.client && guild.client.user && thread.ownerId === guild.client.user.id);

                if (isBotDiscussion && age >= THIRTY_DAYS_MS) {
                    const lastMsgTs = thread.lastMessageId ? Number((BigInt(thread.lastMessageId) >> 22n) + 1420070400000) : createdTs;
                    if (now - lastMsgTs >= THIRTY_DAYS_MS) {
                        try {
                            await thread.delete('Pruning inactive discussion thread older than 30 days');
                            deletedCount++;
                        } catch (err) {
                            console.error(`Failed to delete active thread ${id}:`, err);
                        }
                    }
                }
            }
        }
    } catch (err) {
        console.error(`Error while pruning threads in channel ${channel.id}:`, err);
    }

    return deletedCount;
}

module.exports = {
    pruneInactiveThreads,
    THIRTY_DAYS_MS
};
