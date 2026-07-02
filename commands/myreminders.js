const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, GuildScheduledEventStatus } = require('discord.js');
const { t, getNormalizedLocale } = require('../i18n.js');
const { eventDb } = require('../storage.js');
const { getFormattedTimeString } = require('../utils.js');

async function generateMyRemindersPage(interaction, page = 0) {
    const userId = interaction.user.id;
    const myEventIds = new Set();

    for (const [eventId, data] of Object.entries(eventDb)) {
        if (data.users && data.users[userId]) {
            myEventIds.add(eventId);
        }
    }

    const userLocale = getNormalizedLocale(interaction.locale);
    if (myEventIds.size === 0) {
        return { content: t(userLocale, 'myreminders_no_events'), components: [] };
    }

    const guildEvents = await interaction.guild.scheduledEvents.fetch();
    const myGuildEvents = Array.from(guildEvents.values())
        .filter(event => myEventIds.has(event.id) && (event.status === GuildScheduledEventStatus.Scheduled || event.status === GuildScheduledEventStatus.Active))
        .sort((a, b) => a.scheduledStartTimestamp - b.scheduledStartTimestamp);

    if (myGuildEvents.length === 0) {
         return { content: t(userLocale, 'myreminders_no_guild_events'), components: [] };
    }

    const totalPages = Math.ceil(myGuildEvents.length / 25);
    if (page >= totalPages) page = totalPages - 1;
    if (page < 0) page = 0;

    const startIndex = page * 25;
    const pageEvents = myGuildEvents.slice(startIndex, startIndex + 25);

    const pageText = totalPages > 1 ? ` - Page ${page + 1}/${totalPages}` : '';
    let replyMessage = t(userLocale, 'myreminders_title', { pageText: pageText });
    
    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('list_cancel_select')
        .setPlaceholder(t(userLocale, 'myreminders_select_placeholder'))
        .setMinValues(1)
        .setMaxValues(pageEvents.length);

    pageEvents.forEach(event => {
        const timeString = getFormattedTimeString(event.scheduledStartTimestamp, 'f');
        const nextLine = `• **${event.name}** - ${timeString}\n`;
        if (replyMessage.length + nextLine.length < 1900) {
            replyMessage += nextLine;
        }
        let label = event.name;
        if (label.length > 100) label = label.substring(0, 97) + '...';
        selectMenu.addOptions({ label: label, value: event.id, emoji: '🔕' });
    });

    const components = [new ActionRowBuilder().addComponents(selectMenu)];

    if (totalPages > 1) {
        const navRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`myreminders_page_${page - 1}`).setLabel(t(userLocale, 'upcoming_btn_prev')).setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
            new ButtonBuilder().setCustomId(`myreminders_page_${page + 1}`).setLabel(t(userLocale, 'upcoming_btn_next')).setStyle(ButtonStyle.Secondary).setDisabled(page === totalPages - 1)
        );
        components.push(navRow);
    }
    return { content: replyMessage, components: components };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('myreminders')
        .setNameLocalizations({
            'es-ES': 'misrecordatorios',
            'de': 'meineerinnerungen',
            'fr': 'mesrappels',
            'pt-BR': 'meuslembretes'
        })
        .setDescription('Lists all upcoming events you are currently receiving reminders for in this server.')
        .setDescriptionLocalizations({
            'es-ES': 'Lista todos los próximos eventos de los que estás recibiendo recordatorios en este servidor.',
            'de': 'Listet alle bevorstehenden Events auf, für die du aktuell Erinnerungen auf diesem Server erhältst.',
            'fr': 'Liste les événements à venir dont vous recevez des rappels sur ce serveur.',
            'pt-BR': 'Lista todos os próximos eventos para os quais você está recebendo lembretes neste servidor.'
        })
        .setDMPermission(false),
    generateMyRemindersPage,
    async execute(interaction) {
        await interaction.deferReply({ flags: 64 });
        const payload = await generateMyRemindersPage(interaction, 0);
        await interaction.editReply(payload);
    }
};
