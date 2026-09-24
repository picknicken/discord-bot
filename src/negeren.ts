import type { PlanAction } from './planner.js';
import type { GuildSnapshot } from './snapshot.js';

/**
 * Wat de bot met rust laat.
 *
 * Een ticketbot maakt kanalen aan die niemand van tevoren kan opschrijven:
 * `ticket-0042` bestaat vanmiddag en morgen niet meer. Die horen niet in een
 * template, en precies daarom gingen ze mis: bij een uitrol met prune aan is
 * alles wat niet in de template staat "weg ermee", en dat zijn dan de
 * openstaande tickets van je leden.
 *
 * Met `"negeer": ["Tickets"]` blijft die hele categorie buiten schot. De bot mag
 * er nog wel dingen bíj maken als de template daarom vraagt, maar hij verandert
 * en verwijdert er niets meer. Dat verschil is belangrijk: "negeren" betekent
 * niet dat hij er blind voor is, het betekent dat hij er vanaf blijft.
 *
 * Namen mogen een `*` bevatten, want de helft van wat je wil negeren heeft geen
 * vaste naam: `ticket-*` vangt ze allemaal.
 */

/** Van de lijst uit de template naar één vraag: blijft dit met rust? */
export function maakNegeer(patronen: readonly string[]): (naam: string) => boolean {
  if (patronen.length === 0) return () => false;

  const regels = patronen.map(patroonNaarRegex);
  return (naam) => {
    const kaal = naam.trim().toLowerCase();
    return regels.some((regel) => regel.test(kaal));
  };
}

function patroonNaarRegex(patroon: string): RegExp {
  // Alles behalve de * is gewone tekst; een kanaal dat "c++" heet hoort geen
  // reguliere expressie te worden.
  const stukken = patroon
    .trim()
    .toLowerCase()
    .split('*')
    .map((deel) => deel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

  return new RegExp(`^${stukken.join('.*')}$`);
}

/**
 * De ids van alles wat met rust blijft: wat zelf genoemd wordt, en alles wat in
 * een genoemde categorie staat.
 *
 * Dat tweede is waar het om begonnen is. De kanalen van een ticketbot hebben
 * geen naam die je kunt opschrijven, maar ze staan wel altijd op dezelfde plek.
 */
export function genegeerdeIds(snapshot: GuildSnapshot, negeer: readonly string[]): Set<string> {
  const blijftMetRust = maakNegeer(negeer);
  if (negeer.length === 0) return new Set();

  const ids = new Set<string>();
  const categorieen = new Set<string>();

  for (const categorie of snapshot.categories) {
    if (blijftMetRust(categorie.name)) {
      ids.add(categorie.id);
      categorieen.add(categorie.id);
    }
  }

  for (const kanaal of snapshot.channels) {
    if (blijftMetRust(kanaal.name) || (kanaal.parentId !== null && categorieen.has(kanaal.parentId))) {
      ids.add(kanaal.id);
    }
  }

  return ids;
}

/** Zou deze actie iets aanraken wat met rust moet blijven? */
export function raaktGenegeerd(action: PlanAction, genegeerd: ReadonlySet<string>): boolean {
  switch (action.kind) {
    case 'delete-channel':
      return genegeerd.has(action.channelId);
    case 'update-channel':
      return genegeerd.has(action.channelId);
    case 'update-category':
      return genegeerd.has(action.channelId);
    default:
      // Aanmaken mag wel: de template blijft de baas over wat er hoort te zijn.
      return false;
  }
}

/** Eén regel over wat er is overgeslagen, met een paar namen als voorbeeld. */
export function beschrijfGenegeerd(acties: readonly PlanAction[]): string {
  const namen = acties
    .map((actie) =>
      actie.kind === 'delete-channel'
        ? actie.name
        : actie.kind === 'update-channel'
          ? actie.channel.name
          : actie.kind === 'update-category'
            ? actie.category.name
            : '',
    )
    .filter(Boolean);

  const zichtbaar = namen.slice(0, 5).join(', ');
  const rest = namen.length > 5 ? ` en nog ${namen.length - 5}` : '';

  return (
    `${namen.length} ${namen.length === 1 ? 'ding blijft' : 'dingen blijven'} met rust omdat de ` +
    `template ze negeert: ${zichtbaar}${rest}.`
  );
}
