const { SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { t, getNormalizedLocale } = require('../i18n.js');
const { version } = require('../package.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setNameLocalizations({
            'es-ES': 'ayuda',
            'de': 'hilfe',
            'fr': 'aide',
            'pt-BR': 'ajuda'
        })
        .setDescription('Displays information on how to use the bot and a list of available commands.')
        .setDescriptionLocalizations({
            'es-ES': 'Muestra información sobre cómo usar el bot y una lista de comandos disponibles.',
            'de': 'Zeigt Informationen zur Nutzung des Bots und eine Liste der verfügbaren Befehle.',
            'fr': 'Affiche des informations sur l\'utilisation du bot et une liste des commandes disponibles.',
            'pt-BR': 'Exibe informações sobre como usar o bot e uma lista de comandos disponíveis.'
        })
        .setDMPermission(false),
    async execute(interaction) {
        const isAdmin = interaction.member && interaction.member.permissions && interaction.member.permissions.has(PermissionFlagsBits.ManageGuild);
        const userLocale = getNormalizedLocale(interaction.locale);

        const fields = [
            { 
                name: t(userLocale, 'help_everyone_title'), 
                value: t(userLocale, 'help_everyone_value')
            }
        ];

        if (isAdmin) {
            fields.push({
                name: t(userLocale, 'help_admin_title'),
                value: t(userLocale, 'help_admin_value')
            });
        }

        const embed = new EmbedBuilder()
            .setTitle('🥚 Scotch Egg Help')
            .setDescription(t(userLocale, 'help_description'))
            .addFields(fields)
            .setColor('#0099ff');

        if (isAdmin) {
            embed.setFooter({ text: t(userLocale, 'help_footer_admin', { version: version }) });
        } else {
            embed.setFooter({ text: t(userLocale, 'help_footer_everyone', { version: version }) });
        }
        
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
};
