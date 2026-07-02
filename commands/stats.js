const { SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits, GuildScheduledEventStatus } = require('discord.js');
const { t, getNormalizedLocale } = require('../i18n.js');
const { eventDb } = require('../storage.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stats')
        .setNameLocalizations({
            'es-ES': 'estadisticas',
            'de': 'statistiken',
            'fr': 'statistiques',
            'pt-BR': 'estatisticas'
        })
        .setDescription('View opt-in statistics for upcoming events in this server.')
        .setDescriptionLocalizations({
            'es-ES': 'Ver estadísticas de inscripción para eventos próximos en este servidor.',
            'de': 'Zeige Anmelde-Statistiken für bevorstehende Events auf diesem Server an.',
            'fr': 'Voir les statistiques d\'inscription pour les événements à venir sur ce serveur.',
            'pt-BR': 'Ver estatísticas de inscrição para eventos futuros neste servidor.'
        })
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .setDMPermission(false),
    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const userLocale = getNormalizedLocale(interaction.locale);

        const guildEvents = await interaction.guild.scheduledEvents.fetch();
        const activeEvents = guildEvents.filter(e => e.status === GuildScheduledEventStatus.Scheduled || e.status === GuildScheduledEventStatus.Active);
        
        if (activeEvents.size === 0) {
            return interaction.editReply({ content: t(userLocale, 'stats_no_events') });
        }

        let totalOptIns = 0;
        let description = '';

        activeEvents.forEach(event => {
            const eventData = eventDb[event.id];
            const usersOptedIn = eventData && eventData.users ? Object.keys(eventData.users).length : 0;
            totalOptIns += usersOptedIn;
            
            const nextLine = `• **${event.name}**: ${usersOptedIn} opt-in(s)\n`;
            if (description.length + nextLine.length < 3900) {
                description += nextLine;
            }
        });

        const embed = new EmbedBuilder()
            .setTitle(t(userLocale, 'stats_title'))
            .setDescription(description || t(userLocale, 'stats_empty'))
            .addFields({ name: t(userLocale, 'stats_total'), value: totalOptIns.toString(), inline: true })
            .setColor('#0099ff');

        await interaction.editReply({ embeds: [embed] });
    }
};
