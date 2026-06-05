/**
 * Command Deployment Script
 * Run this script locally or in your Docker container to register the bot's 
 * Slash Commands with the Discord API. This only needs to be run once, or 
 * whenever a command's structure or description is updated.
 */
const { REST, Routes, SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
require('dotenv').config();

if (!process.env.DISCORD_TOKEN || !process.env.CLIENT_ID) {
    console.error('FATAL ERROR: DISCORD_TOKEN and CLIENT_ID must be defined in your .env file.');
    process.exit(1);
}

const commands = [
    new SlashCommandBuilder()
        .setName('settings')
        .setNameLocalizations({
            'es-ES': 'configuracion',
            'de': 'einstellungen',
            'fr': 'parametres',
            'pt-BR': 'configuracoes'
        })
        .setDescription('Manage bot configuration for this server.')
        .setDescriptionLocalizations({
            'es-ES': 'Administrar la configuración del bot para este servidor.',
            'de': 'Verwalte die Bot-Konfiguration für diesen Server.',
            'fr': 'Gérer la configuration du bot pour ce serveur.',
            'pt-BR': 'Gerenciar a configuração do bot para este servidor.'
        })
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .setDMPermission(false)
        .addSubcommand(subcommand =>
            subcommand
                .setName('channel')
                .setNameLocalizations({
                    'es-ES': 'canal',
                    'de': 'kanal',
                    'fr': 'salon',
                    'pt-BR': 'canal'
                })
                .setDescription('Sets the channel for event announcements and reminders.')
                .setDescriptionLocalizations({
                    'es-ES': 'Establece el canal para anuncios y recordatorios de eventos.',
                    'de': 'Legt den Kanal für Event-Ankündigungen und Erinnerungen fest.',
                    'fr': 'Définit le salon pour les annonces d\'événements et les rappels.',
                    'pt-BR': 'Define o canal para anúncios e lembretes de eventos.'
                })
                .addChannelOption(option =>
                    option.setName('channel')
                        .setNameLocalizations({
                            'es-ES': 'canal',
                            'de': 'kanal',
                            'fr': 'salon',
                            'pt-BR': 'canal'
                        })
                        .setDescription('The text channel to use for announcements')
                        .setDescriptionLocalizations({
                            'es-ES': 'El canal de texto a usar para los anuncios',
                            'de': 'Der Textkanal, der für Ankündigungen verwendet werden soll',
                            'fr': 'Le salon textuel à utiliser pour les annonces',
                            'pt-BR': 'O canal de texto para usar para anúncios'
                        })
                        .setRequired(true)
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('mode')
                .setNameLocalizations({
                    'es-ES': 'modo',
                    'de': 'modus',
                    'fr': 'mode',
                    'pt-BR': 'modo'
                })
                .setDescription('Choose the reminder delivery mode (Public channel pings, Private DM-only, or Hybrid).')
                .setDescriptionLocalizations({
                    'es-ES': 'Elige el modo de entrega de recordatorios (Canal público, MD privado o Híbrido).',
                    'de': 'Wähle den Übertragungsmodus für Erinnerungen (Öffentlicher Kanal, Private DM oder Hybrid).',
                    'fr': 'Choisir le mode d\'envoi des rappels (Salon public, DM privé ou Hybride).',
                    'pt-BR': 'Escolha o modo de envio dos lembretes (Canal público, DM privada ou Híbrido).'
                })
                .addStringOption(option =>
                    option.setName('mode')
                        .setNameLocalizations({
                            'es-ES': 'modo',
                            'de': 'modus',
                            'fr': 'mode',
                            'pt-BR': 'modo'
                        })
                        .setDescription('The announcement mode')
                        .setDescriptionLocalizations({
                            'es-ES': 'El modo de anuncio',
                            'de': 'Der Ankündigungsmodus',
                            'fr': 'Le mode d\'annonce',
                            'pt-BR': 'O modo de anúncio'
                        })
                        .setRequired(true)
                        .addChoices(
                            { 
                                name: 'Public Channel Reminders', 
                                nameLocalizations: {
                                    'es-ES': 'Recordatorios de canal público',
                                    'de': 'Öffentliche Kanal-Erinnerungen',
                                    'fr': 'Rappels de salon public',
                                    'pt-BR': 'Lembretes de canal público'
                                },
                                value: 'public' 
                            },
                            { 
                                name: 'Private DM Reminders (Opt-in)', 
                                nameLocalizations: {
                                    'es-ES': 'Recordatorios de MD privado (Opt-in)',
                                    'de': 'Private DM-Erinnerungen (Opt-in)',
                                    'fr': 'Rappels de DM privé (Opt-in)',
                                    'pt-BR': 'Lembretes de DM privado (Opt-in)'
                                },
                                value: 'private' 
                            },
                            { 
                                name: 'Hybrid (Public Channel & DM)', 
                                nameLocalizations: {
                                    'es-ES': 'Híbrido (Canal público y MD)',
                                    'de': 'Hybrid (Öffentlicher Kanal & DM)',
                                    'fr': 'Hybride (Salon public & DM)',
                                    'pt-BR': 'Híbrido (Canal público e DM)'
                                },
                                value: 'hybrid' 
                            }
                        )))
        .addSubcommand(subcommand =>
            subcommand
                .setName('view')
                .setNameLocalizations({
                    'es-ES': 'ver',
                    'de': 'anzeigen',
                    'fr': 'voir',
                    'pt-BR': 'visualizar'
                })
                .setDescription('View the current bot settings for this server.')
                .setDescriptionLocalizations({
                    'es-ES': 'Ver la configuración actual del bot para este servidor.',
                    'de': 'Zeige die aktuellen Bot-Einstellungen für diesen Server an.',
                    'fr': 'Voir les paramètres actuels du bot pour ce serveur.',
                    'pt-BR': 'Ver as configurações atuais do bot para este servidor.'
                }))
        .addSubcommand(subcommand =>
            subcommand
                .setName('calendar')
                .setNameLocalizations({
                    'es-ES': 'calendario',
                    'de': 'kalender',
                    'fr': 'calendrier',
                    'pt-BR': 'calendario'
                })
                .setDescription('Toggle the "Add to Calendar" button on event announcements.')
                .setDescriptionLocalizations({
                    'es-ES': 'Alternar el botón "Añadir al calendario" en los anuncios de eventos.',
                    'de': 'Schalte die "Zum Kalender hinzufügen"-Schaltfläche bei Event-Ankündigungen um.',
                    'fr': 'Activer/Désactiver le bouton "Ajouter au calendrier" sur les annonces d\'événements.',
                    'pt-BR': 'Alternar o botão "Adicionar ao Calendário" nos anúncios de eventos.'
                })
                .addBooleanOption(option =>
                    option.setName('enabled')
                        .setNameLocalizations({
                            'es-ES': 'activado',
                            'de': 'aktiviert',
                            'fr': 'active',
                            'pt-BR': 'ativado'
                        })
                        .setDescription('Enable or disable the calendar button')
                        .setDescriptionLocalizations({
                            'es-ES': 'Activar o desactivar el botón de calendario',
                            'de': 'Aktivieren oder Deaktivieren der Kalenderschaltfläche',
                            'fr': 'Activer ou désactiver le bouton calendrier',
                            'pt-BR': 'Ativar ou desativar o botão do calendário'
                        })
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('threads')
                .setNameLocalizations({
                    'es-ES': 'hilos',
                    'de': 'threads',
                    'fr': 'fils',
                    'pt-BR': 'topicos'
                })
                .setDescription('Toggle whether the bot automatically creates a discussion thread for new events.')
                .setDescriptionLocalizations({
                    'es-ES': 'Alternar si el bot crea automáticamente un hilo de discusión para nuevos eventos.',
                    'de': 'Schalte um, ob der Bot automatisch einen Diskussionsthread für neue Events erstellt.',
                    'fr': 'Choisir si le bot crée automatiquement un fil de discussion pour les nouveaux événements.',
                    'pt-BR': 'Alternar se o bot cria automaticamente um tópico de discussão para novos eventos.'
                })
                .addBooleanOption(option =>
                    option.setName('enabled')
                        .setNameLocalizations({
                            'es-ES': 'activado',
                            'de': 'aktiviert',
                            'fr': 'active',
                            'pt-BR': 'ativado'
                        })
                        .setDescription('Enable or disable auto-thread creation')
                        .setDescriptionLocalizations({
                            'es-ES': 'Activar o desactivar la creación automática de hilos',
                            'de': 'Aktivieren oder Deaktivieren der automatischen Thread-Erstellung',
                            'fr': 'Activer ou désactiver la création automatique de fils',
                            'pt-BR': 'Ativar ou desativar a criação de tópicos automáticos'
                        })
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('autodelete')
                .setNameLocalizations({
                    'es-ES': 'autoeliminar',
                    'de': 'autoloeschen',
                    'fr': 'autosuppression',
                    'pt-BR': 'autoexcluir'
                })
                .setDescription('Toggle whether event announcements are completely deleted when the event ends.')
                .setDescriptionLocalizations({
                    'es-ES': 'Alternar si los anuncios se eliminan por completo cuando termina el evento.',
                    'de': 'Schalte um, ob Event-Ankündigungen nach Event-Ende vollständig gelöscht werden.',
                    'fr': 'Choisir si les annonces d\'événements sont complètement supprimées à la fin de l\'événement.',
                    'pt-BR': 'Alternar se os anúncios de eventos são totalmente excluídos quando o evento termina.'
                })
                .addBooleanOption(option =>
                    option.setName('enabled')
                        .setNameLocalizations({
                            'es-ES': 'activado',
                            'de': 'aktiviert',
                            'fr': 'active',
                            'pt-BR': 'ativado'
                        })
                        .setDescription('Enable to delete, disable to gracefully archive')
                        .setDescriptionLocalizations({
                            'es-ES': 'Activar para eliminar, desactivar para archivar elegantemente',
                            'de': 'Aktivieren zum Löschen, Deaktivieren zum graziösen Archivieren',
                            'fr': 'Activer pour supprimer, désactiver pour archiver gracieusement',
                            'pt-BR': 'Ativar para excluir, desativar para arquivar graciosamente'
                        })
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('intervals')
                .setNameLocalizations({
                    'es-ES': 'intervalos',
                    'de': 'intervalle',
                    'fr': 'intervalles',
                    'pt-BR': 'intervalos'
                })
                .setDescription('Set custom reminder intervals (e.g., 24h, 1h, 15m).')
                .setDescriptionLocalizations({
                    'es-ES': 'Establecer intervalos de recordatorio personalizados (ej. 24h, 1h, 15m).',
                    'de': 'Lege benutzerdefinierte Erinnerungsintervalle fest (z.B. 24h, 1h, 15m).',
                    'fr': 'Définir des intervalles de rappel personnalisés (ex. 24h, 1h, 15m).',
                    'pt-BR': 'Definir intervalos de lembrete personalizados (ex: 24h, 1h, 15m).'
                })
                .addStringOption(option =>
                    option.setName('times')
                        .setNameLocalizations({
                            'es-ES': 'tiempos',
                            'de': 'zeiten',
                            'fr': 'temps',
                            'pt-BR': 'tempos'
                        })
                        .setDescription('Comma-separated list of times (max 5). Examples: "24h, 1h", "7d, 24h, 30m"')
                        .setDescriptionLocalizations({
                            'es-ES': 'Lista de tiempos separada por comas (máx 5). Ejemplos: "24h, 1h", "7d, 24h, 30m"',
                            'de': 'Kommagetrennte Liste von Zeiten (max 5). Beispiele: "24h, 1h", "7d, 24h, 30m"',
                            'fr': 'Liste de temps séparée par des virgules (max 5). Exemples : "24h, 1h", "7d, 24h, 30m"',
                            'pt-BR': 'Lista de tempos separada por vírgulas (máx 5). Exemplos: "24h, 1h", "7d, 24h, 30m"'
                        })
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('testreminder')
                .setNameLocalizations({
                    'es-ES': 'recordatoriodeprueba',
                    'de': 'testerinnerung',
                    'fr': 'testrappel',
                    'pt-BR': 'lembretedeteste'
                })
                .setDescription('Test what an event reminder will look like in your server.')
                .setDescriptionLocalizations({
                    'es-ES': 'Prueba cómo se verá un recordatorio de evento en tu servidor.',
                    'de': 'Teste, wie eine Event-Erinnerung auf deinem Server aussehen wird.',
                    'fr': 'Tester à quoi ressemblera un rappel d\'événement sur votre serveur.',
                    'pt-BR': 'Teste como um lembrete de evento ficará no seu servidor.'
                }))
        .addSubcommand(subcommand =>
            subcommand
                .setName('cleanup')
                .setNameLocalizations({
                    'es-ES': 'limpieza',
                    'de': 'bereinigung',
                    'fr': 'nettoyage',
                    'pt-BR': 'limpeza'
                })
                .setDescription('Scan and archive any unarchived concluded event announcements.')
                .setDescriptionLocalizations({
                    'es-ES': 'Escanear y archivar anuncios de eventos concluidos no archivados.',
                    'de': 'Scanne und archiviere unarchivierte beendete Event-Ankündigungen.',
                    'fr': 'Scanner et archiver les annonces d\'événements terminés non archivées.',
                    'pt-BR': 'Escanear e arquivar anúncios de eventos concluídos não arquivados.'
                }))
        .addSubcommand(subcommand =>
            subcommand
                .setName('silenceevent')
                .setNameLocalizations({
                    'es-ES': 'silenciarevento',
                    'de': 'eventstummschalten',
                    'fr': 'silenceevenement',
                    'pt-BR': 'silenciarevento'
                })
                .setDescription('Disable reminder scheduling for a specific event (stops DMs and pings).')
                .setDescriptionLocalizations({
                    'es-ES': 'Desactiva la programación de recordatorios para un evento específico (detiene MDs y pings).',
                    'de': 'Deaktiviere die Erinnerungsplanung für ein bestimmtes Event (stoppt DMs und Pings).',
                    'fr': 'Désactiver la planification des rappels pour un événement spécifique (arrête les DM et les pings).',
                    'pt-BR': 'Desativa o agendamento de lembretes para um evento específico (para DMs e pings).'
                })
                .addStringOption(option =>
                    option.setName('event')
                        .setNameLocalizations({
                            'es-ES': 'evento',
                            'de': 'event',
                            'fr': 'evenement',
                            'pt-BR': 'evento'
                        })
                        .setDescription('The event link or ID to silence')
                        .setDescriptionLocalizations({
                            'es-ES': 'El enlace o ID del evento a silenciar',
                            'de': 'Der Event-Link oder die ID zum Stummschalten',
                            'fr': 'Le lien ou l\'ID de l\'événement à rendre silencieux',
                            'pt-BR': 'O link ou ID do evento para silenciar'
                        })
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('unsilenceevent')
                .setNameLocalizations({
                    'es-ES': 'desactivarsilencioevento',
                    'de': 'eventlautschalten',
                    'fr': 'desactiver-silence-evenement',
                    'pt-BR': 'desativarsilencioevento'
                })
                .setDescription('Re-enable reminder scheduling for a silenced event.')
                .setDescriptionLocalizations({
                    'es-ES': 'Vuelve a activar la programación de recordatorios para un evento silenciado.',
                    'de': 'Aktiviere die Erinnerungsplanung für ein stummgeschaltetes Event wieder.',
                    'fr': 'Réactiver la planification des rappels pour un événement rendu silencieux.',
                    'pt-BR': 'Reativa o agendamento de lembretes para um evento silenciado.'
                })
                .addStringOption(option =>
                    option.setName('event')
                        .setNameLocalizations({
                            'es-ES': 'evento',
                            'de': 'event',
                            'fr': 'evenement',
                            'pt-BR': 'evento'
                        })
                        .setDescription('The event link or ID to unsilence')
                        .setDescriptionLocalizations({
                            'es-ES': 'El enlace o ID del evento a activar',
                            'de': 'Der Event-Link oder die ID zum Aktivieren',
                            'fr': 'Le lien ou l\'ID de l\'événement à réactiver',
                            'pt-BR': 'O link ou ID do evento para reativar'
                        })
                        .setRequired(true))),
    new SlashCommandBuilder()
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
    new SlashCommandBuilder()
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
    new SlashCommandBuilder()
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
    new SlashCommandBuilder()
        .setName('announceevent')
        .setNameLocalizations({
            'es-ES': 'anunciarevento',
            'de': 'eventankundigen',
            'fr': 'annoncerevenement',
            'pt-BR': 'anunciarevento'
        })
        .setDescription('Manually posts an announcement for an existing event.')
        .setDescriptionLocalizations({
            'es-ES': 'Publica manualmente un anuncio para un evento existente.',
            'de': 'Postet manuell eine Ankündigung für ein existierendes Event.',
            'fr': 'Poste manuellement une annonce pour un événement existant.',
            'pt-BR': 'Publica manualmente um anúncio para um evento existente.'
        })
        .addStringOption(option =>
            option.setName('event_link_or_id')
                .setNameLocalizations({
                    'es-ES': 'enlace_o_id_del_evento',
                    'de': 'event_link_oder_id',
                    'fr': 'lien_ou_id_de_evenement',
                    'pt-BR': 'link_ou_id_do_evento'
                })
                .setDescription('The link to the event or its ID')
                .setDescriptionLocalizations({
                    'es-ES': 'El enlace al evento o su ID',
                    'de': 'Der Link zum Event oder seine ID',
                    'fr': 'Le lien vers l\'événement ou son ID',
                    'pt-BR': 'O link para o evento ou o ID dele'
                })
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .setDMPermission(false),
    new SlashCommandBuilder()
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