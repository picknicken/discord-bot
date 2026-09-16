import type { Plan, PlanAction } from './planner.js';

/**
 * Een template hoeft niet in zijn geheel. Soms wil je alleen de rollen
 * bijwerken, of alleen de kanalen, en de rest met rust laten.
 *
 * Het plan wordt gewoon volledig berekend; hier valt eruit wat je niet
 * aangevinkt hebt. Zo blijft de volgorde kloppen — community-modus vóór de
 * kanalen die hem nodig hebben — en zie je in de preview precies wat er
 * overblijft.
 */

export const ONDERDELEN = [
  'rollen',
  'categorieen',
  'kanalen',
  'automod',
  'emojis',
  'instellingen',
  'onboarding',
] as const;

export type Onderdeel = (typeof ONDERDELEN)[number];

/** Wat er onder elk onderdeel valt, in gewone taal. */
export const UITLEG: Record<Onderdeel, string> = {
  rollen: 'rollen aanmaken, bijwerken en op volgorde zetten',
  categorieen: 'categorieen aanmaken en bijwerken, met hun rechten',
  kanalen: 'kanalen aanmaken, bijwerken, verwijderen en op volgorde zetten, met hun rechten',
  automod: 'de AutoMod-regels',
  emojis: 'de emoji uit de template',
  instellingen: 'serverinstellingen, het systeem- en regelskanaal, en community-modus',
  onboarding: 'de vragen die nieuwe leden krijgen',
};

export function onderdeelVan(action: PlanAction): Onderdeel {
  switch (action.kind) {
    case 'create-role':
    case 'update-role':
    case 'order-roles':
      return 'rollen';
    case 'create-category':
    case 'update-category':
      return 'categorieen';
    case 'create-channel':
    case 'update-channel':
    case 'delete-channel':
    case 'order-channels':
      return 'kanalen';
    case 'create-automod':
    case 'update-automod':
      return 'automod';
    case 'create-emoji':
      return 'emojis';
    case 'onboarding':
      return 'onboarding';
    case 'guild-community':
    case 'guild-settings':
      return 'instellingen';
  }
}

/** Leest "rollen,kanalen" of "alles" uit; geeft null terug bij een onbekende naam. */
export function leesOnderdelen(waarde: string | undefined): Onderdeel[] | null {
  if (!waarde || waarde.trim() === '' || waarde.trim().toLowerCase() === 'alles') return [...ONDERDELEN];

  const gevraagd = waarde
    .split(',')
    .map((deel) => deel.trim().toLowerCase())
    .filter((deel) => deel !== '');

  const gekozen: Onderdeel[] = [];
  for (const naam of gevraagd) {
    const treffer = ONDERDELEN.find((onderdeel) => onderdeel === naam);
    if (!treffer) return null;
    if (!gekozen.includes(treffer)) gekozen.push(treffer);
  }

  return gekozen.length > 0 ? gekozen : null;
}

/**
 * Houdt alleen over wat gekozen is, en let op wat daardoor niet meer kan:
 * een kanaal in een categorie die nog aangemaakt moet worden komt anders
 * zonder categorie op de server te staan.
 */
export function filterPlan(plan: Plan, keuze: readonly Onderdeel[]): Plan {
  if (keuze.length === ONDERDELEN.length) return plan;

  const warnings = [...plan.warnings];
  const gekozen = new Set(keuze);

  // Categorieen die dit plan zelf zou aanmaken bestaan straks niet, als je ze
  // niet meeneemt. Kanalen die daarin horen slaan we dan over.
  const nieuweCategorieen = new Set(
    plan.actions
      .filter((action) => action.kind === 'create-category')
      .map((action) => (action.kind === 'create-category' ? action.category.name : '')),
  );

  const actions: PlanAction[] = [];
  let overgeslagen = 0;

  for (const action of plan.actions) {
    if (!gekozen.has(onderdeelVan(action))) continue;

    if (
      !gekozen.has('categorieen') &&
      action.kind === 'create-channel' &&
      action.categoryName !== null &&
      nieuweCategorieen.has(action.categoryName)
    ) {
      overgeslagen += 1;
      continue;
    }

    actions.push(action);
  }

  if (overgeslagen > 0) {
    warnings.push(
      `${overgeslagen} kanalen overgeslagen: hun categorie moet nog aangemaakt worden en categorieen staan uit.`,
    );
  }

  const uit = ONDERDELEN.filter((onderdeel) => !gekozen.has(onderdeel));
  if (uit.length > 0) warnings.push(`Niet meegenomen: ${uit.join(', ')}.`);

  return { ...plan, actions, warnings };
}

/** Eén regel die zegt wat er deze keer aan de beurt is. */
export function beschrijfOnderdelen(keuze: readonly Onderdeel[]): string {
  if (keuze.length === ONDERDELEN.length) return 'Alle onderdelen.';
  if (keuze.length === 0) return 'Niets gekozen — er gebeurt niets.';
  return `Alleen: ${keuze.join(', ')}.`;
}
