import {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  type Guild,
  type GuildMember,
  type TextChannel,
} from 'discord.js';
import { config } from '../config.js';
import { buildInviteUrl, missingPermissions, rolesAboveBot } from '../botPermissions.js';
import { logger } from '../util/logger.js';

/**
 * Een bot kan zichzelf geen rechten geven — die worden vastgelegd bij de invite.
 * Wat hij hier wel doet: bij binnenkomst controleren of hij compleet is en, als dat
 * niet zo is, precies vertellen wat er mist met een link die het in een klik herstelt.
 */
export async function handleGuildCreate(guild: Guild): Promise<void> {
  const me = await guild.members.fetchMe();
  const missing = missingPermissions(me);
  const inviteUrl = buildInviteUrl(config.clientId);

  logger.info(
    `Toegevoegd aan "${guild.name}" (${guild.id})` +
      (missing.length > 0 ? ` — mist rechten: ${missing.join(', ')}` : ' — alle rechten aanwezig'),
  );

  const embed = missing.length > 0 ? incompleteEmbed(missing, inviteUrl) : readyEmbed(guild, me);
  await announce(guild, me, embed);
}

function readyEmbed(guild: Guild, me: GuildMember): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle('Klaar om deze server in te richten')
    .setColor(0x57f287)
    .setDescription(
      [
        'Ik heb alle rechten die ik nodig heb.',
        '',
        '`/setup list` — welke templates er zijn',
        '`/setup preview` — laat zien wat er zou gebeuren, zonder iets te wijzigen',
        '`/setup apply` — voert het plan uit',
        '`/setup export` — deze server opslaan als template',
      ].join('\n'),
    );

  const blocked = rolesAboveBot(guild, me);
  if (blocked > 0) {
    embed.addFields({
      name: 'Let op: rolvolgorde',
      value:
        `Er ${blocked === 1 ? 'staat 1 rol' : `staan ${blocked} rollen`} boven mijn eigen rol. ` +
        'Discord laat me die niet beheren. Sleep mijn rol in Serverinstellingen → Rollen naar boven ' +
        'als een template rollen op dat niveau moet aanmaken.',
    });
  }

  embed.setFooter({ text: 'Begin met /setup preview — daar verandert nog niets van.' });
  return embed;
}

function incompleteEmbed(missing: string[], inviteUrl: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('Ik mis nog rechten')
    .setColor(0xed4245)
    .setDescription(
      [
        `Zonder ${missing.map((name) => `**${name}**`).join(', ')} kan ik geen templates uitvoeren.`,
        '',
        'Een bot kan zichzelf geen rechten geven, maar dit lost het in een klik op:',
        `[voeg me opnieuw toe met de juiste rechten](${inviteUrl})`,
        '',
        'Ik hoef daarvoor niet weg — opnieuw autoriseren werkt mijn bestaande rol bij.',
      ].join('\n'),
    );
}

/** Bericht naar het systeemkanaal, anders het eerste kanaal waar ik mag praten, anders een DM naar de eigenaar. */
async function announce(guild: Guild, me: GuildMember, embed: EmbedBuilder): Promise<void> {
  const target = findWritableChannel(guild, me);

  if (target) {
    try {
      await target.send({ embeds: [embed] });
      return;
    } catch (error) {
      logger.warn(`Kon niet posten in #${target.name} van "${guild.name}"`, error);
    }
  }

  try {
    const owner = await guild.fetchOwner();
    await owner.send({ embeds: [embed] });
  } catch {
    logger.warn(`Geen kanaal en geen DM mogelijk in "${guild.name}" — bericht overgeslagen.`);
  }
}

function findWritableChannel(guild: Guild, me: GuildMember): TextChannel | null {
  const canWrite = (channel: TextChannel) =>
    channel.permissionsFor(me).has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]);

  if (guild.systemChannel && canWrite(guild.systemChannel)) return guild.systemChannel;

  const fallback = guild.channels.cache
    .filter((channel): channel is TextChannel => channel.type === ChannelType.GuildText)
    .sort((a, b) => a.rawPosition - b.rawPosition)
    .find((channel) => canWrite(channel));

  return fallback ?? null;
}
