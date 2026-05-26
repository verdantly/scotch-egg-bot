/**
 * Parses a user-input string of time intervals into an array of interval objects.
 * @param {string} input - Comma-separated time strings (e.g., '24h, 1h, 15m').
 * @returns {Array<{value: number, unit: string, ms: number}>} Parsed, deduplicated, and sorted intervals.
 */
function parseIntervals(input) {
    const matches = input.matchAll(/(\d+)\s*([mhd])/gi);
    const intervals = [];
    for (const match of matches) {
        const value = parseInt(match[1], 10);
        const unit = match[2].toLowerCase();
        let ms = 0;
        if (unit === 'm') ms = value * 60 * 1000;
        else if (unit === 'h') ms = value * 60 * 60 * 1000;
        else if (unit === 'd') ms = value * 24 * 60 * 60 * 1000;
        
        if (ms > 0 && ms <= 30 * 24 * 60 * 60 * 1000) { // Max 30 days
            intervals.push({ value, unit, ms });
        }
    }
    // Deduplicate identical times and sort longest to shortest
    const unique = [];
    const seen = new Set();
    for (const i of intervals) {
        if (!seen.has(i.ms)) {
            seen.add(i.ms);
            unique.push(i);
        }
    }
    return unique.sort((a, b) => b.ms - a.ms).slice(0, 5); 
}

/**
 * Generates a standard or relative Discord timestamp string based on time remaining or a range.
 * Supports legacy signature getFormattedTimeString(timestamp, format) automatically.
 * @param {number} startTimestamp - The start epoch timestamp in milliseconds.
 * @param {number|string|null} [endTimestamp=null] - The end epoch timestamp, or format string for legacy signature.
 * @param {string} [format='F'] - The Discord timestamp format (e.g., 'F', 'f', 'R').
 * @returns {string} The formatted timestamp string.
 */
function getFormattedTimeString(startTimestamp, endTimestamp = null, format = 'F') {
    // Handle legacy signature: getFormattedTimeString(timestamp, format)
    if (typeof endTimestamp === 'string') {
        format = endTimestamp;
        endTimestamp = null;
    }

    const startStr = `<t:${Math.floor(startTimestamp / 1000)}:${format}>`;
    let timeString = startStr;

    if (endTimestamp) {
        const startDate = new Date(startTimestamp);
        const endDate = new Date(endTimestamp);
        const isSameDay = startDate.toDateString() === endDate.toDateString();
        
        // If it's on the same day, only show the time portion for the end time.
        // Otherwise, show full date and time for the end time.
        const endFormat = isSameDay ? 't' : format; 
        timeString = `${startStr} to <t:${Math.floor(endTimestamp / 1000)}:${endFormat}>`;
    }

    const timeUntil = startTimestamp - Date.now();
    const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
    if (timeUntil > 0 && timeUntil <= oneWeekMs) {
        return `${timeString} (<t:${Math.floor(startTimestamp / 1000)}:R>)`;
    }
    return timeString;
}

/**
 * Formats a duration between start and end timestamps into a human-readable string.
 * @param {number} startMs - The start epoch timestamp in milliseconds.
 * @param {number} endMs - The end epoch timestamp in milliseconds.
 * @returns {string|null} The formatted duration or null.
 */
function formatDuration(startMs, endMs) {
    if (!endMs) return null;
    const diffMs = endMs - startMs;
    if (diffMs <= 0) return null;
    
    const totalMinutes = Math.floor(diffMs / (60 * 1000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    
    const parts = [];
    if (hours > 0) {
        parts.push(`${hours} hour${hours > 1 ? 's' : ''}`);
    }
    if (minutes > 0) {
        parts.push(`${minutes} minute${minutes > 1 ? 's' : ''}`);
    }
    return parts.join(' ') || null;
}

/**
 * Generates a dynamic Google Calendar Template URL for an event.
 * @param {GuildScheduledEvent} event - The Discord Scheduled Event object.
 * @returns {string} The encoded Google Calendar URL.
 */
function generateGoogleCalendarLink(event) {
    const text = encodeURIComponent((event.name || '').substring(0, 100));
    const locationStr = (event.entityMetadata?.location || 'Discord Server').substring(0, 100);
    const location = encodeURIComponent(locationStr);

    const formatToUTC = (timestamp) => {
        const d = new Date(timestamp);
        return d.toISOString().replace(/-|:|\.\d\d\d/g, "");
    };

    const startTime = formatToUTC(event.scheduledStartTimestamp);
    const endTime = event.scheduledEndTimestamp ? formatToUTC(event.scheduledEndTimestamp) : formatToUTC(event.scheduledStartTimestamp + (60 * 60 * 1000)); 

    const eventUrl = `https://discord.com/events/${event.guildId}/${event.id}`;
    const encodedLink = encodeURIComponent(`\n\nDiscord Event Link: ${eventUrl}`);
    
    const baseUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${text}&dates=${startTime}/${endTime}&location=${location}`;
    
    // Discord button URLs have a strict maximum length of 512 characters.
    const remainingSpace = 512 - baseUrl.length - '&details='.length - encodedLink.length;
    
    let details = encodedLink;
    
    if (event.description && remainingSpace > 20) {
        // Encode characters can expand (e.g., space -> %20). Assume x3 expansion for safety.
        const maxSafeChars = Math.floor(remainingSpace / 3);
        let truncatedDesc = event.description.substring(0, maxSafeChars);
        if (truncatedDesc.length < event.description.length) truncatedDesc += '...';
        details = encodeURIComponent(truncatedDesc) + encodedLink;
    }

    let finalUrl = `${baseUrl}&details=${details}`;
    
    // Final safety nets to guarantee we do not crash the Discord API
    if (finalUrl.length > 512) {
        finalUrl = `${baseUrl}&details=${encodedLink}`;
        if (finalUrl.length > 512) finalUrl = baseUrl;
    }

    return finalUrl;
}

module.exports = {
    parseIntervals,
    getFormattedTimeString,
    generateGoogleCalendarLink,
    formatDuration
};