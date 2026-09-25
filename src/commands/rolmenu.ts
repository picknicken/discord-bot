import {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type Guild,
  type GuildTextBasedChannel,
  type Role,
} from 'discord.js';
import { config } from '../config.js';
import { geldigeKleur } from '../embedVelden.js';
import { bouwRolmenu, optieLabel, type RolmenuOptie } from '../rolmenu.js';
import { overMij, waaromNiet } from '../rolmenuKlik.js';
import { kiesTaal, t, type Taal } from '../taal.js';
import { serverToegestaan } from '../toegestaan.js';

/**
 * Een rolmenu neerzetten zonder daar een hele template voor te hoeven bouwen.
 *
 * `/setup` kent rolmenu's al langer, maar alleen als onderdeel van een
 * template die je eerst moet schrijven en uitrollen. Dat is voor een server die
 * net z'n eerste "kies je pingrol"-bericht wil net zo veel moeite als voor een
 * server die zijn hele indeling opnieuw opbouwt. Dit commando doet alleen dat
 * ene bericht, meteen, met wat er al stond aan opbouwlogica in `rolmenu.ts` en
 * `rolmenuKlik.ts` - de knoppen werken hierna precies hetzelfde.
 */

const en = (tekst: string) => ({ 'en-US': tekst, 'en-GB': tekst });

const MAX_ROLLEN = 25;

export const data = new SlashCommandBuilder()
  .setName('rolmenu')
  .setDescription('Zet een bericht neer waarmee leden zichzelf een rol geven')
  .setDescriptionLocalizations(en('Post a message that lets members give themselves a role'))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
  .setDMPermission(false)
  .addStringOption((option) =>
    option
      .setName('titel')
      .setNameLocalizations(en('title'))
      .setDescription('De titel boven het menu')
      .setDescriptionLocalizations(en('The title above the menu'))
      .setRequired(true)
      .setMaxLength(256),
  )
  .addStringOption((option) =>
    option
      .setName('rollen')
      .setNameLocalizations(en('roles'))
      .setDescription('De rollen, gescheiden door een komma: Naam[:emoji[:label]], bv. "Gamer:🎮, Muziek"')
      .setDescriptionLocalizations(en('The roles, comma-separated: Name[:emoji[:label]], e.g. "Gamer:🎮, Music"'))
      .setRequired(true)
      .setMaxLength(1500),
  )
  .addStringOption((option) =>
    option
      .setName('beschrijving')
      .setNameLocalizations(en('description'))
      .setDescription('Tekst onder de titel')
      .setDescriptionLocalizations(en('Text below the title'))
      .setMaxLength(4000),
  )
  .addStringOption((option) =>
    option
      .setName('stijl')
      .setNameLocalizations(en('style'))
      .setDescription('Knoppen (standaard) of een keuzemenu')
      .setDescriptionLocalizations(en('Buttons (default) or a dropdown menu'))
      .addChoices(
        { name: 'Knoppen', value: 'buttons', name_localizations: en('Buttons') },
        { name: 'Keuzemenu', value: 'menu', name_localizations: en('Dropdown menu') },
      ),
  )
  .addStringOption((option) =>
    option
      .setName('kleur')
      .setNameLocalizations(en('color'))
      .setDescription('Kleur van de streep links, als hex (bv. #5865F2)')
      .setDescriptionLocalizations(en('Color of the left-hand stripe, as hex (e.g. #5865F2)')),
  )
  .addChannelOption((option) =>
    option
      .setName('kanaal')
      .setNameLocalizations(en('channel'))
      .setDescription('Waar het menu komt te staan (standaard dit kanaal)')
      .setDescriptionLocalizations(en('Where the menu gets posted (default: this channel)'))
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
  );

interface RolInvoer {
  rolTekst: string;
  emoji: string | null;
  label: string | null;
}

/** "Gamer:🎮, Muziek:🎵:Muziek liefhebber" -> losse rij-invoer, of zeggen waarom dat niet kan. */
export function verwerkRollenVeld(taal: Taal, ruw: string): { entries: RolInvoer[] } | { fout: string } {
  const stukjes = ruw
    .split(',')
    .map((deel) => deel.trim())
    .filter(Boolean);

  if (stukjes.length === 0) return { fout: t(taal, 'rolmenu.geenrollen') };
  if (stukjes.length > MAX_ROLLEN) return { fout: t(taal, 'rolmenu.teveelrollen', { aantal: MAX_ROLLEN }) };

  const entries = stukjes.map((stukje) => {
    const [rolTekst = '', emoji = '', ...labelDelen] = stukje.split(':').map((deel) => deel.trim());
    return {
      rolTekst,
      emoji: emoji || null,
      label: labelDelen.length > 0 ? labelDelen.join(':').trim() || null : null,
    };
  });

  return { entries };
}

/** Een rol vinden op mention (`<@&id>`) of, vaker, gewoon op naam. */
export function vindRol(guild: Guild, tekst: string): Role | null {
  const schoon = tekst.trim();
  const mention = /^<@&(\d+)>$/.exec(schoon);
  if (mention?.[1]) return guild.roles.cache.get(mention[1]) ?? null;

  const naam = schoon.replace(/^@/, '').toLowerCase();
  return guild.roles.cache.find((rol) => rol.name.toLowerCase() === naam) ?? null;
}

function bepaalKanaal(interaction: ChatInputCommandInteraction): GuildTextBasedChannel | null {
  const gekozen = interaction.options.getChannel('kanaal', false, [
    ChannelType.GuildText,
    ChannelType.GuildAnnouncement,
  ]);
  const kanaal = gekozen ?? interaction.channel;
  return kanaal && kanaal.isTextBased() ? (kanaal as GuildTextBasedChannel) : null;
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const taal: Taal = kiesTaal(interaction.locale);

  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({ content: t(taal, 'cmd.alleen.server'), flags: MessageFlags.Ephemeral });
    return;
  }

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles)) {
    await interaction.reply({ content: t(taal, 'rolmenu.cmd.geen.rechten'), flags: MessageFlags.Ephemeral });
    return;
  }

  if (!serverToegestaan(interaction.guildId, config.toegestaneServers)) {
    await interaction.reply({ content: t(taal, 'server.niet.toegestaan'), flags: MessageFlags.Ephemeral });
    return;
  }

  const uitkomst = verwerkRollenVeld(taal, interaction.options.getString('rollen', true));
  if ('fout' in uitkomst) {
    await interaction.reply({ content: uitkomst.fout, flags: MessageFlags.Ephemeral });
    return;
  }

  const resolved: { entry: RolInvoer; rol: Role }[] = [];
  for (const entry of uitkomst.entries) {
    const rol = vindRol(interaction.guild, entry.rolTekst);
    if (!rol) {
      await interaction.reply({
        content: t(taal, 'rolmenu.rol.onbekend', { naam: entry.rolTekst }),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (resolved.some(({ rol: eerder }) => eerder.id === rol.id)) {
      await interaction.reply({
        content: t(taal, 'rolmenu.rol.dubbel', { rol: rol.name }),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    resolved.push({ entry, rol });
  }

  const ikInfo = overMij(interaction.guild.members.me);
  for (const { rol } of resolved) {
    const nee = waaromNiet(rol, ikInfo, taal);
    if (nee) {
      await interaction.reply({ content: nee, flags: MessageFlags.Ephemeral });
      return;
    }
  }

  const ruweKleur = interaction.options.getString('kleur');
  if (ruweKleur && geldigeKleur(ruweKleur) === null) {
    await interaction.reply({
      content: t(taal, 'embed.kleur.ongeldig', { kleur: ruweKleur }),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const kanaal = bepaalKanaal(interaction);
  if (!kanaal) {
    await interaction.reply({ content: t(taal, 'embed.kanaal.ongeldig'), flags: MessageFlags.Ephemeral });
    return;
  }

  const ikBen = interaction.guild.members.me;
  const rechten = ikBen ? kanaal.permissionsFor(ikBen) : null;
  if (
    !rechten?.has(PermissionFlagsBits.ViewChannel) ||
    !rechten.has(PermissionFlagsBits.SendMessages) ||
    !rechten.has(PermissionFlagsBits.EmbedLinks)
  ) {
    await interaction.reply({
      content: t(taal, 'embed.geen.kanaalrechten', { kanaal: kanaal.toString() }),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const stijl = (interaction.options.getString('stijl') ?? 'buttons') as 'buttons' | 'menu';
  const opties: RolmenuOptie[] = resolved.map(({ entry, rol }) => ({
    roleId: rol.id,
    label: optieLabel(entry.label ?? undefined, rol.name),
    emoji: entry.emoji,
    description: null,
  }));

  const bericht = bouwRolmenu(
    {
      title: interaction.options.getString('titel', true),
      description: interaction.options.getString('beschrijving') ?? '',
      color: ruweKleur ?? undefined,
      style: stijl,
    },
    opties,
    taal,
  );

  try {
    await kanaal.send(bericht);
  } catch (error) {
    const fout = error instanceof Error ? error.message : String(error);
    await interaction.reply({ content: t(taal, 'rolmenu.plaatsen.mislukt', { fout }), flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.reply({
    content: t(taal, 'rolmenu.geplaatst', { kanaal: kanaal.toString(), aantal: opties.length }),
    flags: MessageFlags.Ephemeral,
  });
}
