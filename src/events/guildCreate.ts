import { EmbedBuilder, PermissionFlagsBits, type Guild, type GuildMember } from 'discord.js';
import { config } from '../config.js';
import { buildInviteUrl, missingPermissions, rolesAboveBot } from '../botPermissions.js';
import { kiesTaal, t, type Taal } from '../taal.js';
import { meldInServer } from '../util/melden.js';
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
      (missing.length > 0
        ? ` — mist rechten: ${missing.join(', ')}`
        : me.permissions.has(PermissionFlagsBits.Administrator)
          ? ' — alle rechten aanwezig'
          : ' — geen Administrator; community-modus en bijzondere rolrechten worden overgeslagen'),
  );

  // De taal van de server waar hij net is binnengekomen; dit bericht blijft staan
  // en is voor iedereen die het kanaal leest.
  const taal = kiesTaal(guild.preferredLocale);

  const embed =
    missing.length > 0
      ? incompleteEmbed(missing, inviteUrl, taal)
      : me.permissions.has(PermissionFlagsBits.Administrator)
        ? readyEmbed(guild, me, taal)
        : zonderAdminEmbed(guild, me, inviteUrl, taal);

  await meldInServer(guild, me, embed);
}

/**
 * Hij kan aan de slag, maar zonder Administrator blijft een deel liggen. Dat
 * hoort hij meteen te zeggen, niet pas als iemand een template uitrolt: een
 * bot kan geen recht uitdelen dat hij zelf niet heeft, en community-modus
 * aanzetten kan met niets minder.
 */
function zonderAdminEmbed(guild: Guild, me: GuildMember, inviteUrl: string, taal: Taal): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(t(taal, 'join.geenadmin.titel'))
    .setColor(0xfee75c)
    .setDescription(
      t(taal, 'join.geenadmin.tekst', {
        invite: inviteUrl,
        rol: me.roles.botRole?.name ?? me.user.username,
      }),
    );

  const blocked = rolesAboveBot(guild, me);
  if (blocked > 0) {
    embed.addFields({
      name: t(taal, 'join.volgorde.naam'),
      value: telRollen(blocked, taal) + t(taal, 'join.volgorde.geenadmin'),
    });
  }

  return embed;
}

/** "Er staan 3 rollen boven mijn eigen rol. " — of de Engelse variant. */
function telRollen(aantal: number, taal: Taal): string {
  return aantal === 1 ? t(taal, 'join.volgorde.een') : t(taal, 'join.volgorde.meer', { aantal });
}

function readyEmbed(guild: Guild, me: GuildMember, taal: Taal): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(t(taal, 'join.klaar.titel'))
    .setColor(0x57f287)
    .setDescription(t(taal, 'join.klaar.tekst'));

  const blocked = rolesAboveBot(guild, me);
  if (blocked > 0) {
    embed.addFields({
      name: t(taal, 'join.volgorde.naam'),
      value: telRollen(blocked, taal) + t(taal, 'join.volgorde.klaar'),
    });
  }

  embed.setFooter({ text: t(taal, 'join.klaar.voet') });
  return embed;
}

function incompleteEmbed(missing: string[], inviteUrl: string, taal: Taal): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(t(taal, 'join.mist.titel'))
    .setColor(0xed4245)
    .setDescription(
      t(taal, 'join.mist.tekst', {
        rechten: missing.map((name) => `**${name}**`).join(', '),
        invite: inviteUrl,
      }),
    );
}
