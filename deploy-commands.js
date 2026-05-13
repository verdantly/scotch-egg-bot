const { REST, Routes, SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
require('dotenv').config();

if (!process.env.DISCORD_TOKEN || !process.env.CLIENT_ID) {
    console.error('FATAL ERROR: DISCORD_TOKEN and CLIENT_ID must be defined in your .env file.');
    process.exit(1);
}

const commands = [
    new SlashCommandBuilder()
        .setName('settings')
        .setDescription('Manage bot configuration for this server.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .setDMPermission(false)
        .addSubcommand(subcommand =>
            subcommand
                .setName('channel')
                .setDescription('Sets the channel for event announcements and reminders.')
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('The text channel to use for announcements')
                        .setRequired(true)
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('mode')
                .setDescription('Choose whether event reminders are posted publicly or privately via DM.')
                .addStringOption(option =>
                    option.setName('mode')
                        .setDescription('The announcement mode')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Public Channel Reminders', value: 'public' },
                            { name: 'Private DM Reminders (Opt-in)', value: 'private' }
                        )))
        .addSubcommand(subcommand =>
            subcommand
                .setName('view')
                .setDescription('View the current bot settings for this server.')),
    new SlashCommandBuilder()
        .setName('myreminders')
        .setDescription('Lists all upcoming events you are currently receiving reminders for in this server.')
        .setDMPermission(false),
    new SlashCommandBuilder()
        .setName('help')
        .setDescription('Displays information on how to use the bot and a list of available commands.')
        .setDMPermission(false),
    new SlashCommandBuilder()
        .setName('announceevent')
        .setDescription('Manually posts an announcement for an existing event.')
        .addStringOption(option =>
            option.setName('event_link_or_id')
                .setDescription('The link to the event or its ID')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .setDMPermission(false),
    new SlashCommandBuilder()
        .setName('stats')
        .setDescription('View opt-in statistics for upcoming events in this server.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .setDMPermission(false),
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        console.log(`Started refreshing ${commands.length} application (/) commands.`);
        // The put method is used to fully refresh all commands in the guild with the current set
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error('Failed to reload application (/) commands:', error);
    }
})();