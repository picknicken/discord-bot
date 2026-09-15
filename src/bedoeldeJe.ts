/**
 * "Bedoelde je ...?" bij een naam die net niet klopt.
 *
 * Een template afwijzen met `onbekende permissie "MANAGE_SERVER"` klopt wel,
 * maar helpt niet: je weet niet dat Discord het `ManageGuild` noemt. Met de
 * dichtstbijzijnde naam erbij is het een kwestie van overtypen.
 */

/** Hoeveel losse wijzigingen er nodig zijn om a in b te veranderen. */
export function afstand(a: string, b: string): number {
  const rijen = a.length + 1;
  const kolommen = b.length + 1;
  let vorige = Array.from({ length: kolommen }, (_, index) => index);

  for (let rij = 1; rij < rijen; rij++) {
    const huidige = [rij, ...new Array<number>(kolommen - 1).fill(0)];
    for (let kolom = 1; kolom < kolommen; kolom++) {
      const kost = a[rij - 1] === b[kolom - 1] ? 0 : 1;
      huidige[kolom] = Math.min(
        (huidige[kolom - 1] ?? 0) + 1,
        (vorige[kolom] ?? 0) + 1,
        (vorige[kolom - 1] ?? 0) + kost,
      );
    }
    vorige = huidige;
  }

  return vorige[kolommen - 1] ?? 0;
}

/** Hoe streng we zijn: bij een langere naam mag er meer verschillen. */
const grens = (naam: string) => Math.max(2, Math.floor(naam.length / 3));

/**
 * Namen die Discord in de app anders noemt dan in de API. Dit zijn geen
 * typefouten maar synoniemen, en juist die kosten de meeste tijd: in
 * Serverinstellingen heet het "Manage Server", in een template ManageGuild.
 */
const SYNONIEMEN: Record<string, string> = {
  manageserver: 'ManageGuild',
  manageemojis: 'ManageGuildExpressions',
  manageemojisandstickers: 'ManageGuildExpressions',
  managestickers: 'ManageGuildExpressions',
  manageexpressions: 'ManageGuildExpressions',
  readmessages: 'ViewChannel',
  viewchannels: 'ViewChannel',
  readmessagehistory: 'ReadMessageHistory',
  usevoiceactivity: 'UseVAD',
  usevoiceactivitydetection: 'UseVAD',
  externalemojis: 'UseExternalEmojis',
  useexternalemoji: 'UseExternalEmojis',
  timeoutmembers: 'ModerateMembers',
  timeout: 'ModerateMembers',
  muteteamembers: 'MuteMembers',
  nickname: 'ChangeNickname',
  managenickname: 'ManageNicknames',
  createinvite: 'CreateInstantInvite',
  createinvites: 'CreateInstantInvite',
  slashcommands: 'UseApplicationCommands',
  useslashcommands: 'UseApplicationCommands',
  addreaction: 'AddReactions',
  administrator: 'Administrator',
  admin: 'Administrator',
};

/**
 * De dichtstbijzijnde naam uit de lijst, of null als niets erop lijkt.
 * Hoofdletters, streepjes en underscores tellen niet mee - juist daar gaat het
 * vaak mis: MANAGE_SERVER tegenover ManageGuild.
 */
export function dichtstbij(gezocht: string, opties: readonly string[]): string | null {
  const kaal = (naam: string) => naam.toLowerCase().replace(/[_\-\s]/g, '');
  const doel = kaal(gezocht);
  if (doel === '') return null;

  // Eerst de namen die Discord zelf anders schrijft.
  const synoniem = SYNONIEMEN[doel];
  if (synoniem && opties.includes(synoniem)) return synoniem;

  let beste: string | null = null;
  let besteAfstand = Number.POSITIVE_INFINITY;

  for (const optie of opties) {
    const kaleOptie = kaal(optie);

    // Hetzelfde op hoofdletters en streepjes na, of het een begint met het
    // ander: dan is het overduidelijk bedoeld.
    if (kaleOptie === doel) return optie;
    if (doel.length >= 3 && (kaleOptie.startsWith(doel) || doel.startsWith(kaleOptie))) return optie;

    const gemeten = afstand(doel, kaleOptie);
    if (gemeten < besteAfstand) {
      besteAfstand = gemeten;
      beste = optie;
    }
  }

  return beste !== null && besteAfstand <= grens(doel) ? beste : null;
}

/** Een zin om achter een foutmelding te plakken. Leeg als er niets op lijkt. */
export function bedoeldeJe(gezocht: string, opties: readonly string[]): string {
  const treffer = dichtstbij(gezocht, opties);
  return treffer ? ` — bedoelde je "${treffer}"?` : '';
}
