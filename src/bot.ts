import { Events, MessageFlags, type AutocompleteInteraction, type ChatInputCommandInteraction, type Client } from 'discord.js';
import * as setup from './commands/setup.js';
import * as clan from './commands/clan.js';
import { config } from './config.js';
import { zorgVoorCommandos, type CommandoJSON } from './commandos.js';
import { KOPPEL_KNOP, KOPPEL_VENSTER, toonKoppelVenster, verwerkKoppelVenster } from './clan/knop.js';
import { ROLMENU_KIES, ROLMENU_KNOP } from './rolmenu.js';
import { kiesInRolmenu, klikRolmenu } from './rolmenuKlik.js';
import { handleGuildCreate } from './events/guildCreate.js';
import { handleGuildMemberAdd } from './events/guildMemberAdd.js';
import { verwerkNaamBericht } from './clan/verificatie.js';
import { synchroniseerIdentiteiten } from './botIdentiteit.js';
import { logger } from './util/logger.js';

/**
 * De commando's van deze bot. Twee takken: /setup richt een server in vanuit een
 * template, /clan hangt er de clanrangen uit OSRS aan. Ze staan hier naast
 * elkaar zodat het registreren, het afhandelen en het uitrollen naar Discord
 * allemaal uit dezelfde lijst lezen.
 */
export const COMMANDS: Array<{
  data: { name: string; toJSON: () => unknown };
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
  autocomplete?: (interaction: AutocompleteInteraction) => Promise<void>;
}> = [setup, clan];

/**
 * Alles wat de bot in Discord zelf doet: de commando's en het welkom als hij aan
 * een server wordt toegevoegd.
 *
 * Staat hier apart zodat zowel `npm start` (alleen de bot) als het dashboard
 * hetzelfde koppelt. Draai je het dashboard ergens live, dan werkt /setup daar
 * dus gewoon mee — anders zou dat stilletjes wegvallen.
 */
export function koppelBot(client: Client): void {
  // Zodra de bot binnen is: kijken of Discord dezelfde commando's kent als deze
  // versie. Eerder was dat handwerk, en dan bestaat /setup in een nieuwe server
  // gewoon niet zonder dat iets je dat vertelt.
  client.once(Events.ClientReady, async (ready) => {
    if (!config.commandosAanmelden) return;
    await zorgVoorCommandos(ready, COMMANDS.map((command) => command.data.toJSON() as CommandoJSON));
  });

  // Een server met een eigen naam of plaatje voor de bot: dat moet ook na een
  // herstart weer kloppen, niet alleen op het moment dat iemand het instelt.
  client.once(Events.ClientReady, async (ready) => {
    await synchroniseerIdentiteiten(ready, config.historyDir);
  });

  client.on(Events.GuildCreate, async (guild) => {
    try {
      await handleGuildCreate(guild);
    } catch (error) {
      logger.error(`Afhandelen van join in "${guild.name}" mislukt`, error);
    }
  });

  // Nieuwe leden krijgen de knop "Koppel je OSRS-naam". Dit vraagt de
  // Server Members Intent; staat die uit, dan komt deze gebeurtenis niet binnen
  // en blijft de rest gewoon werken.
  client.on(Events.GuildMemberAdd, async (member) => {
    try {
      await handleGuildMemberAdd(member);
    } catch (error) {
      logger.error(`Welkom voor ${member.user.username} in "${member.guild.name}" mislukt`, error);
    }
  });

  // Verplichte naamkoppeling: een bericht in het welkomkanaal telt ook als
  // koppelpoging, naast de knop. Op elke server die dit niet aanzet doet dit
  // niets — de eerste regel van verwerkNaamBericht stopt dan meteen.
  client.on(Events.MessageCreate, async (message) => {
    try {
      await verwerkNaamBericht(message, config.clanDir);
    } catch (error) {
      logger.error(`Naam verwerken in de wachtkamer mislukt voor ${message.author.id}`, error);
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isButton() && interaction.customId === KOPPEL_KNOP) {
        await toonKoppelVenster(interaction);
        return;
      }

      if (interaction.isButton() && interaction.customId.startsWith(ROLMENU_KNOP)) {
        await klikRolmenu(interaction);
        return;
      }

      if (interaction.isStringSelectMenu() && interaction.customId === ROLMENU_KIES) {
        await kiesInRolmenu(interaction);
        return;
      }

      if (interaction.isModalSubmit() && interaction.customId === KOPPEL_VENSTER) {
        await verwerkKoppelVenster(interaction, config.clanDir);
        return;
      }

      if (interaction.isAutocomplete()) {
        const command = COMMANDS.find((kandidaat) => kandidaat.data.name === interaction.commandName);
        await command?.autocomplete?.(interaction);
        return;
      }

      if (interaction.isChatInputCommand()) {
        const command = COMMANDS.find((kandidaat) => kandidaat.data.name === interaction.commandName);
        if (command) await command.execute(interaction);
      }
    } catch (error) {
      logger.error('Interactie mislukt', error);
      if (interaction.isRepliable()) {
        const message = {
          content: 'Er ging iets mis bij het uitvoeren van dit commando.',
          flags: MessageFlags.Ephemeral,
        } as const;
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp(message).catch(() => undefined);
        } else {
          await interaction.reply(message).catch(() => undefined);
        }
      }
    }
  });
}
