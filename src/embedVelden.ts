import { EmbedBuilder } from 'discord.js';

/**
 * Wat een embed opbouwt, en de twee controles die daarbij horen: een geldige
 * hexkleur en een geldige http(s)-link. Dit staat los van `/embed` omdat
 * `/tag` en een geplande aankondiging dezelfde velden hebben en dezelfde
 * fouten moeten afvangen — één plek dus, in plaats van drie keer dezelfde
 * regex.
 */

export const MAX_TITEL = 256;
export const MAX_BESCHRIJVING = 4096;
export const MAX_FOOTER = 2048;

const HEX_KLEUR = /^#?[0-9a-f]{6}$/i;

/** "#5865F2" of "5865F2" naar een getal, of null als het geen geldige hexkleur is. */
export function geldigeKleur(ruw: string): number | null {
  const schoon = ruw.trim();
  if (!HEX_KLEUR.test(schoon)) return null;
  return parseInt(schoon.replace('#', ''), 16);
}

/** Alleen http(s)-links; Discord haalt de afbeelding zelf op en heeft niets aan een ander schema. */
export function geldigeUrl(ruw: string): string | null {
  try {
    const url = new URL(ruw.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export interface EmbedVelden {
  titel: string | null;
  beschrijving: string | null;
  kleur: number | null;
  afbeelding: string | null;
  thumbnail: string | null;
  footer: string | null;
}

export function bouwEmbed(velden: EmbedVelden): EmbedBuilder {
  const embed = new EmbedBuilder();
  if (velden.titel) embed.setTitle(velden.titel);
  if (velden.beschrijving) embed.setDescription(velden.beschrijving);
  if (velden.kleur !== null) embed.setColor(velden.kleur);
  if (velden.afbeelding) embed.setImage(velden.afbeelding);
  if (velden.thumbnail) embed.setThumbnail(velden.thumbnail);
  if (velden.footer) embed.setFooter({ text: velden.footer });
  return embed;
}
