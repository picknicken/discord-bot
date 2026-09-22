import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type BaseMessageOptions,
  type Guild,
  type Message,
} from 'discord.js';
import { t, type Taal } from './taal.js';
import type { RoleMenuSpec } from './types.js';

/**
 * Rolmenu's: een bericht met knoppen waarmee leden zichzelf een rol geven.
 *
 * "Klik op 🎮 voor de gamer-rol" staat op half Discord, en tot nu toe moest je
 * daar een tweede bot voor installeren die niets van je template weet. Nu staat
 * het in de template zelf: welk kanaal, welke tekst, welke rollen. De bot plaatst
 * het bericht en houdt het bij.
 *
 * Bijhouden is het punt. Een bericht dat bij elke uitrol opnieuw geplaatst wordt
 * levert na een maand tien rolmenu's op in hetzelfde kanaal, allemaal met andere
 * rollen. Daarom herkent de bot zijn eigen bericht - aan de knoppen, want die
 * dragen zijn eigen id - en werkt hij dat bij in plaats van een nieuw te sturen.
 *
 * Er is geen bestand waarin bijgehouden wordt welk bericht bij welk menu hoort.
 * Alles staat in het bericht zelf: welke rol bij welke knop hoort staat in de
 * customId, en de titel zegt welk menu het is. Dat scheelt een administratie die
 * kan gaan afwijken van de werkelijkheid.
 */

/** Waar een knop in een rolmenu aan te herkennen is; erachter staat het rol-id. */
export const ROLMENU_KNOP = 'rolmenu:';

/** Het keuzemenu. Welke rollen erin zitten staat in de opties zelf. */
export const ROLMENU_KIES = 'rolmenu-kies';

export interface RolmenuOptie {
  roleId: string;
  label: string;
  emoji: string | null;
  description: string | null;
}

/** Een rolmenu zoals het nu in een kanaal staat. */
export interface GeplaatstRolmenu {
  channelId: string;
  channelName: string;
  messageId: string;
  title: string;
  description: string;
  color: number | null;
  style: RoleMenuSpec['style'];
  options: RolmenuOptie[];
}

const kleurGetal = (kleur: string | undefined): number | null =>
  kleur === undefined ? null : Number.parseInt(kleur.replace('#', ''), 16);

/**
 * Emoji vergelijken zonder over de schrijfwijze te vallen.
 *
 * Een template schrijft een eigen emoji als `<:naam:123>`; Discord geeft hem
 * terug als naam en id apart. Voor een gewone emoji is de naam het teken zelf.
 */
export function emojiNaam(emoji: string | null | undefined): string | null {
  if (!emoji) return null;
  const eigen = /^<a?:([\w~]+):(\d+)>$/.exec(emoji.trim());
  return eigen ? (eigen[1] ?? null) : emoji.trim();
}

/** Wat er op de knop komt te staan als de template het niet zegt. */
export const optieLabel = (label: string | undefined, rolNaam: string): string =>
  (label ?? rolNaam).slice(0, 80);

/**
 * Het bericht zoals het eruit hoort te zien.
 *
 * De rollen zijn hier al opgezocht: wie ze niet kan opzoeken (omdat de rol nog
 * aangemaakt moet worden) kan dit bericht niet bouwen, en dat is precies waarom
 * dit pas gebeurt nadat de rollen bestaan.
 */
export function bouwRolmenu(
  menu: RoleMenuSpec,
  opties: readonly RolmenuOptie[],
  taal: Taal = 'nl',
): BaseMessageOptions {
  const embed = new EmbedBuilder().setTitle(menu.title);
  if (menu.description !== '') embed.setDescription(menu.description);
  const kleur = kleurGetal(menu.color);
  if (kleur !== null) embed.setColor(kleur);

  if (menu.style === 'menu') {
    const kiezer = new StringSelectMenuBuilder()
      .setCustomId(ROLMENU_KIES)
      .setPlaceholder(t(taal, 'rolmenu.kiezen'))
      // Nul mogen kiezen is hoe je ze allemaal weer uitzet.
      .setMinValues(0)
      .setMaxValues(opties.length)
      .addOptions(
        opties.map((optie) => {
          const keuze = new StringSelectMenuOptionBuilder().setLabel(optie.label).setValue(optie.roleId);
          if (optie.description) keuze.setDescription(optie.description);
          if (optie.emoji) keuze.setEmoji(optie.emoji);
          return keuze;
        }),
      );

    return { embeds: [embed], components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(kiezer)] };
  }

  // Vijf knoppen per rij; Discord staat vijf rijen toe, dus vijfentwintig rollen.
  const rijen: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let start = 0; start < opties.length; start += 5) {
    const knoppen = opties.slice(start, start + 5).map((optie) => {
      const knop = new ButtonBuilder()
        .setCustomId(ROLMENU_KNOP + optie.roleId)
        .setLabel(optie.label)
        .setStyle(ButtonStyle.Secondary);
      if (optie.emoji) knop.setEmoji(optie.emoji);
      return knop;
    });
    rijen.push(new ActionRowBuilder<ButtonBuilder>().addComponents(knoppen));
  }

  return { embeds: [embed], components: rijen };
}

/** Is dit een bericht dat wij ooit als rolmenu geplaatst hebben? */
export function leesRolmenu(message: Message, kanaalNaam: string): GeplaatstRolmenu | null {
  const opties: RolmenuOptie[] = [];
  let style: RoleMenuSpec['style'] | null = null;

  for (const rij of message.components) {
    for (const onderdeel of 'components' in rij ? rij.components : []) {
      const component = onderdeel as {
        customId?: string | null;
        label?: string | null;
        emoji?: { name?: string | null } | null;
        options?: { value: string; label: string; description?: string | null; emoji?: { name?: string | null } | null }[];
      };

      if (component.customId === ROLMENU_KIES && component.options) {
        style = 'menu';
        for (const optie of component.options) {
          opties.push({
            roleId: optie.value,
            label: optie.label,
            emoji: optie.emoji?.name ?? null,
            description: optie.description ?? null,
          });
        }
        continue;
      }

      if (typeof component.customId === 'string' && component.customId.startsWith(ROLMENU_KNOP)) {
        style = style ?? 'buttons';
        opties.push({
          roleId: component.customId.slice(ROLMENU_KNOP.length),
          label: component.label ?? '',
          emoji: component.emoji?.name ?? null,
          description: null,
        });
      }
    }
  }

  if (style === null) return null;

  const embed = message.embeds[0];
  return {
    channelId: message.channelId,
    channelName: kanaalNaam,
    messageId: message.id,
    title: embed?.title ?? '',
    description: embed?.description ?? '',
    color: embed?.color ?? null,
    style,
    options: opties,
  };
}

/**
 * Staat het er al precies zo?
 *
 * `rolId` geeft het id van een rol-key, of null als die rol nog niet bestaat.
 * In dat laatste geval is het antwoord altijd nee: een menu dat naar een rol
 * wijst die er nog niet is, moet sowieso opnieuw.
 */
export function rolmenuGelijk(
  geplaatst: GeplaatstRolmenu,
  menu: RoleMenuSpec,
  rolId: (key: string) => string | null,
  rolNaam: (key: string) => string,
): boolean {
  if (geplaatst.title !== menu.title) return false;
  if (geplaatst.description !== menu.description) return false;
  if (geplaatst.style !== menu.style) return false;

  const kleur = kleurGetal(menu.color);
  if (kleur !== null && geplaatst.color !== kleur) return false;
  if (geplaatst.options.length !== menu.options.length) return false;

  return menu.options.every((optie, index) => {
    const staat = geplaatst.options[index];
    if (!staat) return false;

    const id = rolId(optie.role);
    if (id === null || staat.roleId !== id) return false;
    if (staat.label !== optieLabel(optie.label, rolNaam(optie.role))) return false;
    if (emojiNaam(staat.emoji) !== emojiNaam(optie.emoji)) return false;
    // Een beschrijving telt alleen mee in een keuzemenu; een knop heeft er geen.
    if (menu.style === 'menu' && (staat.description ?? null) !== (optie.description ?? null)) return false;
    return true;
  });
}

/**
 * De rolmenu's die nu in deze kanalen staan.
 *
 * Alleen de kanalen waar de template een menu in wil: alle kanalen van een server
 * langslopen is honderden verzoeken voor iets wat bijna nergens staat. Kan de bot
 * er niet in kijken, dan levert dat geen fout op maar een leeg antwoord - dan
 * plant hij een nieuw bericht, en loopt hij tegen dezelfde rechten aan op een
 * plek waar het wél opvalt.
 */
export async function leesRolmenus(guild: Guild, kanaalNamen: readonly string[]): Promise<GeplaatstRolmenu[]> {
  const gezocht = new Set(kanaalNamen.map((naam) => naam.trim().toLowerCase()));
  if (gezocht.size === 0) return [];

  // Voorzichtig: een nagebouwde server (demo, test) heeft niet altijd een client.
  const ik = guild.client?.user?.id;
  const gevonden: GeplaatstRolmenu[] = [];

  for (const kanaal of guild.channels.cache.values()) {
    if (kanaal.type !== ChannelType.GuildText && kanaal.type !== ChannelType.GuildAnnouncement) continue;
    if (!gezocht.has(kanaal.name.trim().toLowerCase())) continue;

    // Via een promise, zodat een kanaaltype zonder berichten (of een nagebouwd
    // kanaal in de demo) hier niet halverwege de momentopname omvalt.
    const berichten = await Promise.resolve()
      .then(() => kanaal.messages.fetch({ limit: 50 }))
      .catch(() => null);
    if (!berichten) continue;

    for (const bericht of berichten.values()) {
      if (ik !== undefined && bericht.author.id !== ik) continue;
      const gelezen = leesRolmenu(bericht, kanaal.name);
      if (gelezen) gevonden.push(gelezen);
    }
  }

  return gevonden;
}
