const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, GuildScheduledEventStatus } = require('discord.js');
const { t, getNormalizedLocale } = require('../i18n.js');
const { eventDb } = require('../storage.js');
const { getFormattedTimeString } = require('../utils.js');

async function generateUpcomingPage(interaction, page = 0) {
    const userId = interaction.user.id;
    const guildEvents = await interaction.guild.scheduledEvents.fetch();
    
    const upcomingEvents = Array.from(guildEvents.values()).filter(event => {
        const users = eventDb[event.id]?.users || {};
        return !users[userId] && (event.status === GuildScheduledEventStatus.Scheduled || event.status === GuildScheduledEventStatus.Active);
    }).sort((a, b) => a.scheduledStartTimestamp - b.scheduledStartTimestamp);

    const userLocale = getNormalizedLocale(interaction.locale);
    if (upcomingEvents.length === 0) {
        return { content: t(userLocale, 'upcoming_no_events'), components: [] };
    }

    const totalPages = Math.ceil(upcomingEvents.length / 25);
    if (page >= totalPages) page = totalPages - 1;
    if (page < 0) page = 0;

    const startIndex = page * 25;
    const pageEvents = upcomingEvents.slice(startIndex, startIndex + 25);

    const pageText = totalPages > 1 ? ` - Page ${page + 1}/${totalPages}` : '';
    let replyMessage = t(userLocale, 'upcoming_title', { pageText: pageText });
    
    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('list_optin_select')
        .setPlaceholder(t(userLocale, 'upcoming_select_placeholder'))
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
        selectMenu.addOptions({ label: label, value: event.id, emoji: '⏰' });
    });

    const components = [new ActionRowBuilder().addComponents(selectMenu)];

    if (totalPages > 1) {
        const navRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`upcoming_page_${page - 1}`)
                .setLabel(t(userLocale, 'upcoming_btn_prev'))
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === 0),
            new ButtonBuilder()
                .setCustomId(`upcoming_page_${page + 1}`)
                .setLabel(t(userLocale, 'upcoming_btn_next'))
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === totalPages - 1)
        );
        components.push(navRow);
    }
    return { content: replyMessage, components: components };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('upcoming')
        .setNameLocalizations({
            'es-ES': 'proximos',
            'de': 'bevorstehende',
            'fr': 'a-venir',
            'pt-BR': 'proximos'
        })
        .setDescription('View upcoming events and easily opt-in to receive reminders.')
        .setDescriptionLocalizations({
            'es-ES': 'Ver los próximos eventos e inscribirse fácilmente para recibir recordatorios.',
            'de': 'Zeige bevorstehende Events an und melde dich einfach für Erinnerungen an.',
            'fr': 'Voir les événements à venir et s\'inscrire facilement pour recevoir des rappels.',
            'pt-BR': 'Veja os próximos eventos e inscreva-se facilmente para receber lembretes.'
        })
        .setDMPermission(false),
    generateUpcomingPage,
    async execute(interaction) {
        await interaction.deferReply({ flags: 64 }); // Ephemeral
        const payload = await generateUpcomingPage(interaction, 0);
        await interaction.editReply(payload);
    }
};
