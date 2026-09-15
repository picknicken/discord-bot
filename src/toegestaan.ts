/**
 * Welke servers deze installatie mag aanraken.
 *
 * Het dashboard weet wie er ingelogd is en kijkt per gebruiker of hij daar
 * beheerder is. Een GitHub Action weet dat niet: daar is het een invoerveld, en
 * iedereen die de knop mag indrukken kan er elk server-id in typen. De token in
 * de secrets doet de rest — ook in een server waar dat nooit de bedoeling was.
 *
 * Deze lijst is de rem. Staat hij leeg, dan is er geen beperking; dat is de
 * stand voor wie de bot op zijn eigen computer draait en zelf de enige is.
 */

export function serverToegestaan(guildId: string, toegestaan: readonly string[]): boolean {
  if (toegestaan.length === 0) return true;
  return toegestaan.includes(guildId.trim());
}

/** Waarom het niet mag, en wat je eraan doet. */
export function uitlegNietToegestaan(guildId: string, toegestaan: readonly string[]): string {
  return (
    `Server ${guildId} staat niet in de lijst met toegestane servers ` +
    `(${toegestaan.join(', ')}). Er is niets veranderd. ` +
    'Klopt het id wel? Zet het er dan bij onder Settings -> Secrets and variables -> Actions -> Variables, bij GUILD_IDS.'
  );
}

/** Leest de lijst uit een omgevingsvariabele: komma's, spaties of nieuwe regels. */
export function leesToegestaneServers(waarde: string | undefined): string[] {
  return (waarde ?? '')
    .split(/[\s,]+/)
    .map((id) => id.trim())
    .filter(Boolean);
}
