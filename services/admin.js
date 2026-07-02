const { setStorageErrorHandler } = require('../storage.js');

let discordClient = null;

function setClient(client) {
    discordClient = client;
}

/**
 * Sends a Direct Message to the configured administrator user with error details.
 * @param {string} contextMessage - A description of what the bot was doing when the error occurred.
 * @param {Error|string} error - The error object or string.
 * @returns {Promise<void>}
 */
async function notifyAdmin(contextMessage, error) {
    const adminId = process.env.ADMIN_USER_ID;
    if (!adminId || !discordClient || !discordClient.isReady()) return;

    try {
        const admin = await discordClient.users.fetch(adminId);
        if (admin) {
            const errorMessage = error instanceof Error ? error.stack : error;
            const msg = `⚠️ **Bot Error Alert** ⚠️\n**Context:** ${contextMessage}\n\`\`\`js\n${String(errorMessage).slice(0, 1800)}\n\`\`\``;
            await admin.send(msg);
        }
    } catch (err) {
        console.error('Failed to notify admin via DM:', err);
    }
}

// Hook it up to storage.js error handler automatically
setStorageErrorHandler(notifyAdmin);

module.exports = {
    setClient,
    notifyAdmin
};
