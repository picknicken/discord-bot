import { toBitfield } from './permissions.js';
import type {
  GuildSnapshot,
  SnapshotAutomod,
  SnapshotChannel,
  SnapshotOnboarding,
  SnapshotOverwrite,
} from './snapshot.js';
import type {
  AutomodSpec,
  CategorySpec,
  ChannelSpec,
  EmojiSpec,
  OnboardingSpec,
  Overwrite,
  RoleSpec,
  ServerTemplate,
} from './types.js';

export interface PlanOptions {
  /** Verwijder kanalen/categorieen die niet in de template staan. */
  prune: boolean;
  /** Pas bestaande rollen en kanalen aan als ze afwijken van de template. */
  update: boolean;
}

export type PlanAction =
  | { kind: 'create-role'; role: RoleSpec }
  | { kind: 'update-role'; roleId: string; role: RoleSpec; changes: string[] }
  | { kind: 'create-category'; category: CategorySpec }
  | { kind: 'update-category'; channelId: string; category: CategorySpec; changes: string[] }
  | { kind: 'create-channel'; channel: ChannelSpec; categoryName: string | null }
  | { kind: 'update-channel'; channelId: string; channel: ChannelSpec; categoryName: string | null; changes: string[] }
  | { kind: 'delete-channel'; channelId: string; name: string; isCategory: boolean; onder?: string | null }
  | { kind: 'create-emoji'; emoji: EmojiSpec }
  | { kind: 'create-automod'; rule: AutomodSpec }
  | { kind: 'update-automod'; ruleId: string; rule: AutomodSpec }
  | { kind: 'order-channels'; count: number }
  | { kind: 'order-roles'; count: number }
  | { kind: 'onboarding'; prompts: number }
  | { kind: 'guild-community' }
  | { kind: 'guild-settings'; changes: string[] };

/** Deze kanaaltypes bestaan alleen op een Community-server. */
const COMMUNITY_ONLY: readonly ChannelSpec['type'][] = ['announcement', 'forum', 'stage'];

export const needsCommunity = (type: ChannelSpec['type']) => COMMUNITY_ONLY.includes(type);

export interface Plan {
  templateName: string;
  options: PlanOptions;
  actions: PlanAction[];
  warnings: string[];
}

const normalize = (value: string) => value.trim().toLowerCase();

const ZIEN = toBitfield(['ViewChannel']);

/**
 * Kan @everyone dit kanaal zien?
 *
 * Zelfde volgorde als Discord: het basisrecht van de rol, dan de categorie,
 * dan het kanaal zelf. Nodig voor de onboarding: Discord weigert die in zijn
 * geheel zodra één standaardkanaal voor @everyone verstopt is, en noemt er
 * niet bij welk kanaal hij bedoelt.
 */
function everyoneZiet(snapshot: GuildSnapshot, channel: SnapshotChannel): boolean {
  const everyone = snapshot.roles.find((role) => role.isEveryone);
  let zichtbaar = everyone === undefined || (everyone.permissions & ZIEN) === ZIEN;

  const categorie = channel.parentId
    ? snapshot.categories.find((c) => c.id === channel.parentId)
    : undefined;

  for (const rechten of [categorie?.overwrites, channel.overwrites]) {
    const eigen = rechten?.find((overwrite) => overwrite.roleId === snapshot.id);
    if (!eigen) continue;
    if ((eigen.deny & ZIEN) === ZIEN) zichtbaar = false;
    if ((eigen.allow & ZIEN) === ZIEN) zichtbaar = true;
  }

  return zichtbaar;
}

function hexToInt(color: string | undefined): number | undefined {
  if (!color) return undefined;
  return Number.parseInt(color.replace('#', ''), 16);
}

function planRoles(snapshot: GuildSnapshot, template: ServerTemplate, options: PlanOptions): PlanAction[] {
  const actions: PlanAction[] = [];
  const existingByName = new Map(
    snapshot.roles.filter((role) => !role.isEveryone && !role.managed).map((role) => [normalize(role.name), role]),
  );

  for (const role of template.roles) {
    const existing = existingByName.get(normalize(role.name));
    if (!existing) {
      actions.push({ kind: 'create-role', role });
      continue;
    }
    if (!options.update) continue;

    const changes: string[] = [];
    const wantedColor = hexToInt(role.color);
    if (wantedColor !== undefined && wantedColor !== existing.color) changes.push('kleur');
    if (role.hoist !== existing.hoist) changes.push('apart tonen');
    if (role.mentionable !== existing.mentionable) changes.push('vermeldbaar');
    if (toBitfield(role.permissions) !== existing.permissions) changes.push('permissies');

    if (changes.length > 0) {
      actions.push({ kind: 'update-role', roleId: existing.id, role, changes });
    }
  }

  return actions;
}

function channelChanges(spec: ChannelSpec, existing: SnapshotChannel): string[] {
  const changes: string[] = [];
  if (spec.topic !== undefined && (existing.topic ?? '') !== spec.topic) changes.push('topic');
  if (spec.nsfw !== existing.nsfw) changes.push('nsfw');
  if (spec.slowmodeSeconds !== existing.slowmodeSeconds) changes.push('slowmode');
  if (spec.userLimit !== undefined && existing.userLimit !== null && spec.userLimit !== existing.userLimit) {
    changes.push('gebruikerslimiet');
  }
  return changes;
}

/**
 * Staan de rechten van de template al zo op de server?
 *
 * De momentopname bewaart rolrechten per rol-id, de template noemt rollen bij
 * hun sleutel. Vandaar de omweg via de naam. Bestaat een rol nog niet, dan valt
 * er niets te vergelijken en moet hij dus gezet worden.
 *
 * Rechten voor rollen die de template niet noemt, tellen niet mee. Dat is geen
 * slordigheid: de bot geeft zichzelf een sleutel tot kanalen die voor @everyone
 * verstopt zijn, anders kan hij ze daarna niet meer bijwerken. Zou die meetellen,
 * dan zou elk verstopt kanaal voor eeuwig "anders" blijven.
 */
function rechtenGelijk(
  gewenst: readonly Overwrite[],
  bestaand: readonly SnapshotOverwrite[],
  rolIds: ReadonlyMap<string, string>,
): boolean {
  const opId = new Map(bestaand.map((overwrite) => [overwrite.roleId, overwrite]));
  const genoemd = new Set<string>();

  for (const overwrite of gewenst) {
    const id = rolIds.get(overwrite.role);
    if (!id) return false;
    genoemd.add(id);

    const nu = opId.get(id);
    if (!nu) return false;
    if (nu.allow !== toBitfield(overwrite.allow) || nu.deny !== toBitfield(overwrite.deny)) return false;
  }

  // Een recht dat de template kent maar niet meer noemt, hoort weg. Van rollen
  // buiten de template blijven we af.
  for (const overwrite of bestaand) {
    if (genoemd.has(overwrite.roleId)) continue;
    if ([...rolIds.values()].includes(overwrite.roleId)) return false;
  }

  return true;
}

/** Rolsleutel uit de template -> het echte rol-id op de server, via de naam. */
function rolIdsVanTemplate(snapshot: GuildSnapshot, template: ServerTemplate): Map<string, string> {
  const opNaam = new Map(snapshot.roles.map((role) => [normalize(role.name), role.id]));
  const ids = new Map<string, string>([['@everyone', snapshot.id]]);

  for (const role of template.roles) {
    const id = opNaam.get(normalize(role.name));
    if (id) ids.set(role.key, id);
  }
  return ids;
}

function planChannels(snapshot: GuildSnapshot, template: ServerTemplate, options: PlanOptions): {
  actions: PlanAction[];
  keptChannelIds: Set<string>;
  keptCategoryIds: Set<string>;
} {
  const actions: PlanAction[] = [];
  const keptChannelIds = new Set<string>();
  const keptCategoryIds = new Set<string>();

  const rolIds = rolIdsVanTemplate(snapshot, template);
  const categoryByName = new Map(snapshot.categories.map((category) => [normalize(category.name), category]));

  const findChannel = (name: string, type: ChannelSpec['type'], parentId: string | null) =>
    snapshot.channels.find(
      (channel) =>
        normalize(channel.name) === normalize(name) &&
        channel.type === type &&
        (parentId === null || channel.parentId === parentId),
    );

  for (const category of template.categories) {
    const existingCategory = categoryByName.get(normalize(category.name));
    if (!existingCategory) {
      actions.push({ kind: 'create-category', category });
      for (const channel of category.channels) {
        actions.push({ kind: 'create-channel', channel, categoryName: category.name });
      }
      continue;
    }

    keptCategoryIds.add(existingCategory.id);
    if (options.update && !rechtenGelijk(category.overwrites, existingCategory.overwrites, rolIds)) {
      actions.push({
        kind: 'update-category',
        channelId: existingCategory.id,
        category,
        changes: ['permissies'],
      });
    }

    for (const channel of category.channels) {
      const existing = findChannel(channel.name, channel.type, existingCategory.id);
      if (!existing) {
        actions.push({ kind: 'create-channel', channel, categoryName: category.name });
        continue;
      }
      keptChannelIds.add(existing.id);
      if (!options.update) continue;

      // Een kanaal erft de rechten van zijn categorie zodra het er zelf geen
      // heeft. Dan is "leeg" precies goed en hoeft er niets gezet te worden.
      const changes = channelChanges(channel, existing);
      if (channel.overwrites.length > 0 && !rechtenGelijk(channel.overwrites, existing.overwrites, rolIds)) {
        changes.push('permissies');
      }
      if (changes.length === 0) continue;

      actions.push({
        kind: 'update-channel',
        channelId: existing.id,
        channel,
        categoryName: category.name,
        changes,
      });
    }
  }

  for (const channel of template.uncategorizedChannels) {
    const existing = findChannel(channel.name, channel.type, null);
    if (!existing) {
      actions.push({ kind: 'create-channel', channel, categoryName: null });
      continue;
    }
    keptChannelIds.add(existing.id);
    if (!options.update) continue;

    const changes = channelChanges(channel, existing);
    if (channel.overwrites.length > 0 && !rechtenGelijk(channel.overwrites, existing.overwrites, rolIds)) {
      changes.push('permissies');
    }
    if (changes.length === 0) continue;

    actions.push({ kind: 'update-channel', channelId: existing.id, channel, categoryName: null, changes });
  }

  return { actions, keptChannelIds, keptCategoryIds };
}

function planEmojis(snapshot: GuildSnapshot, template: ServerTemplate): PlanAction[] {
  const existing = new Set(snapshot.emojis.map(normalize));
  return template.emojis
    .filter((emoji) => !existing.has(normalize(emoji.name)))
    .map((emoji) => ({ kind: 'create-emoji', emoji }));
}

/**
 * Dezelfde verzameling, ongeacht volgorde en hoofdletters.
 *
 * AutoMod trekt zich van geen van beide iets aan: "Spam" en "spam" blokkeren
 * hetzelfde. Een regel herschrijven omdat de woorden in een andere volgorde
 * staan levert dus niets op, behalve een regel in elke preview.
 */
function zelfdeVerzameling(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const links = [...a].map(normalize).sort();
  const rechts = [...b].map(normalize).sort();
  return links.every((waarde, index) => waarde === rechts[index]);
}

/** Kanaalnaam -> het id op de server, voor kanalen die er al zijn. */
function kanaalIdsVanServer(snapshot: GuildSnapshot): Map<string, string> {
  return new Map(snapshot.channels.map((channel) => [normalize(channel.name), channel.id]));
}

/**
 * De ids bij een lijstje namen of sleutels, of null als er eentje ontbreekt.
 *
 * Ontbreken betekent: die rol of dat kanaal wordt in deze ronde nog aangemaakt.
 * Dan valt er niets te vergelijken en moet het dus gezet worden - hem overslaan
 * omdat de ids die we wel kennen toevallig kloppen, laat juist het nieuwe stuk liggen.
 */
function alleIds(namen: readonly string[], ids: ReadonlyMap<string, string>): string[] | null {
  const gevonden: string[] = [];
  for (const naam of namen) {
    const id = ids.get(naam) ?? ids.get(normalize(naam));
    if (!id) return null;
    gevonden.push(id);
  }
  return gevonden;
}

/**
 * Staat deze AutoMod-regel er al precies zo op?
 *
 * Vergeleken wordt alles wat de applier ook stuurt - niet minder, want dan zou
 * een echte wijziging stilletjes overgeslagen worden.
 */
function automodGelijk(
  rule: AutomodSpec,
  bestaand: SnapshotAutomod,
  rolIds: ReadonlyMap<string, string>,
  kanalen: ReadonlyMap<string, string>,
): boolean {
  if (bestaand.name !== rule.name) return false;
  if (bestaand.enabled !== rule.enabled) return false;
  if (bestaand.trigger !== rule.trigger) return false;

  if (rule.trigger === 'keyword') {
    if (!zelfdeVerzameling(bestaand.keywords, rule.keywords)) return false;
    if (!zelfdeVerzameling(bestaand.regexPatterns, rule.regexPatterns)) return false;
    if (!zelfdeVerzameling(bestaand.allowList, rule.allowList)) return false;
  } else if (rule.trigger === 'keyword_preset') {
    if (!zelfdeVerzameling(bestaand.presets, rule.presets)) return false;
    if (!zelfdeVerzameling(bestaand.allowList, rule.allowList)) return false;
  } else if (rule.trigger === 'mention_spam') {
    if (bestaand.mentionLimit !== (rule.mentionLimit ?? 5)) return false;
  }

  // De applier zet precies één actie neer en gooit de rest weg.
  const [actie, ...verder] = bestaand.acties;
  if (!actie || verder.length > 0) return false;
  if (actie.soort !== rule.action) return false;
  if (rule.action === 'block' && (actie.customMessage ?? '') !== (rule.customMessage ?? '')) return false;
  if (rule.action === 'timeout' && actie.timeoutSeconds !== (rule.timeoutSeconds ?? 300)) return false;
  if (rule.action === 'alert') {
    const id = rule.alertChannel ? kanalen.get(normalize(rule.alertChannel)) : undefined;
    if (!id || actie.channelId !== id) return false;
  }

  const gewensteRollen = alleIds(rule.exemptRoles, rolIds);
  return gewensteRollen !== null && zelfdeVerzameling(bestaand.exemptRoleIds, gewensteRollen);
}

function planAutomod(snapshot: GuildSnapshot, template: ServerTemplate, options: PlanOptions): PlanAction[] {
  const existing = new Map(snapshot.automod.map((rule) => [normalize(rule.name), rule]));
  const rolIds = rolIdsVanTemplate(snapshot, template);
  const kanalen = kanaalIdsVanServer(snapshot);

  return template.automod.flatMap<PlanAction>((rule) => {
    const match = existing.get(normalize(rule.name));
    if (!match) return [{ kind: 'create-automod', rule }];
    if (!options.update) return [];
    if (automodGelijk(rule, match, rolIds, kanalen)) return [];
    return [{ kind: 'update-automod', ruleId: match.id, rule }];
  });
}

/**
 * Staat de onboarding er al zo op?
 *
 * De volgorde van de vragen telt mee - die zien leden ook zo - maar de rollen
 * en kanalen binnen een keuze niet: dat is een verzameling, geen lijstje.
 */
function onboardingGelijk(
  spec: OnboardingSpec,
  bestaand: SnapshotOnboarding,
  rolIds: ReadonlyMap<string, string>,
  kanalen: ReadonlyMap<string, string>,
): boolean {
  const zelfdeKanalen = (nu: readonly string[], namen: readonly string[]) => {
    const ids = alleIds(namen, kanalen);
    return ids !== null && zelfdeVerzameling(nu, ids);
  };
  const zelfdeRollen = (nu: readonly string[], keys: readonly string[]) => {
    const ids = alleIds(keys, rolIds);
    return ids !== null && zelfdeVerzameling(nu, ids);
  };

  if (bestaand.enabled !== spec.enabled) return false;
  if (bestaand.mode !== spec.mode) return false;
  if (!zelfdeKanalen(bestaand.defaultChannelIds, spec.defaultChannels)) return false;
  if (bestaand.prompts.length !== spec.prompts.length) return false;

  return spec.prompts.every((vraag, index) => {
    const nu = bestaand.prompts[index];
    if (!nu) return false;
    if (nu.title !== vraag.title || nu.singleSelect !== vraag.singleSelect || nu.required !== vraag.required) {
      return false;
    }
    if (nu.options.length !== vraag.options.length) return false;

    return vraag.options.every((keuze, plek) => {
      const optie = nu.options[plek];
      if (!optie) return false;
      if (optie.title !== keuze.title) return false;
      if ((optie.description ?? '') !== (keuze.description ?? '')) return false;
      if ((optie.emoji ?? '') !== (keuze.emoji ?? '')) return false;
      if (!zelfdeRollen(optie.roleIds, keuze.roles)) return false;
      return zelfdeKanalen(optie.channelIds, keuze.channels);
    });
  });
}

/** Staan de rollen die al bestaan in dezelfde volgorde als in de template? */
function rolesOutOfOrder(snapshot: GuildSnapshot, template: ServerTemplate): boolean {
  const byName = new Map(snapshot.roles.map((role) => [normalize(role.name), role]));
  const positions = template.roles
    .map((role) => byName.get(normalize(role.name))?.position)
    .filter((position): position is number => position !== undefined);

  // De template loopt van hoog naar laag, dus de posities horen te dalen.
  return positions.some((position, index) => index > 0 && position >= (positions[index - 1] ?? 0));
}

function channelsOutOfOrder(snapshot: GuildSnapshot, template: ServerTemplate): boolean {
  const categoryPositions = template.categories
    .map((category) => snapshot.categories.find((c) => normalize(c.name) === normalize(category.name))?.position)
    .filter((position): position is number => position !== undefined);

  if (categoryPositions.some((position, index) => index > 0 && position <= (categoryPositions[index - 1] ?? -1))) {
    return true;
  }

  for (const category of template.categories) {
    const parent = snapshot.categories.find((c) => normalize(c.name) === normalize(category.name));
    if (!parent) continue;
    const positions = category.channels
      .map((channel) =>
        snapshot.channels.find(
          (existing) => existing.parentId === parent.id && normalize(existing.name) === normalize(channel.name),
        )?.position,
      )
      .filter((position): position is number => position !== undefined);
    if (positions.some((position, index) => index > 0 && position <= (positions[index - 1] ?? -1))) return true;
  }

  return false;
}

/**
 * Welke serverinstellingen wijken af van wat de template wil?
 *
 * Eerst stond hier simpelweg alles wat de template noemt. Dat betekende bij elke
 * uitrol een regel "serverinstellingen" in de preview, en erger: community-modus
 * werd elke keer opnieuw gezet, terwijl Discord daar juist zuinig mee wil zijn.
 */
/**
 * Kanalen en categorieen waarvan er meer dan een dezelfde naam heeft.
 *
 * De bot zoekt alles op naam op: de template kent geen id's. Staan er twee met
 * dezelfde naam, dan kiest hij er willekeurig een, en dan blijft er een verschil
 * bestaan dat je nergens terugvindt - precies wat er op de testserver gebeurde
 * toen de template er per ongeluk twee keer op stond.
 *
 * Alleen namen die de template zelf gebruikt; wat verder in de server staat is
 * niet onze zaak.
 */
function dubbeleNamen(snapshot: GuildSnapshot, template: ServerTemplate): string[] {
  const kanaalNamen = new Set(
    [...template.categories.flatMap((category) => category.channels), ...template.uncategorizedChannels].map(
      (channel) => normalize(channel.name),
    ),
  );
  const categorieNamen = new Set(template.categories.map((category) => normalize(category.name)));

  const tel = (namen: ReadonlySet<string>, wat: string, lijst: readonly { name: string }[]) => {
    const geteld = new Map<string, { naam: string; aantal: number }>();
    for (const item of lijst) {
      const sleutel = normalize(item.name);
      if (!namen.has(sleutel)) continue;
      const staat = geteld.get(sleutel);
      if (staat) staat.aantal += 1;
      else geteld.set(sleutel, { naam: item.name, aantal: 1 });
    }
    return [...geteld.values()]
      .filter((staat) => staat.aantal > 1)
      .map(
        (staat) =>
          `Er staan ${staat.aantal} ${wat} met de naam "${staat.naam}" in de server. De bot zoekt op naam ` +
          'en kan er maar een bedoelen; haal de dubbele weg of geef ze een eigen naam.',
      );
  };

  return [...tel(categorieNamen, 'categorieen', snapshot.categories), ...tel(kanaalNamen, 'kanalen', snapshot.channels)];
}

function planGuildSettings(snapshot: GuildSnapshot, template: ServerTemplate, warnings: string[]): PlanAction[] {
  const gewenst = template.guild;
  const nu = snapshot.settings;
  const kanalen = kanaalIdsVanServer(snapshot);
  const changes: string[] = [];

  const anders = (sleutel: string, waarde: string | number | undefined, huidig: string | number) => {
    if (waarde !== undefined && waarde !== huidig) changes.push(sleutel);
  };

  /** Een kanaal dat nog niet bestaat wordt straks aangemaakt: dan moet de verwijzing dus alsnog gezet. */
  const kanaalAnders = (sleutel: string, wat: string, naam: string | undefined, huidig: string | null) => {
    if (naam === undefined) return;
    const gevonden = kanalen.get(normalize(naam));
    if (gevonden === (huidig ?? undefined)) return;
    changes.push(sleutel);

    // Staat er al iets anders, zeg dan waar het nu op staat. Zonder dat blijft
    // het bij "serverinstellingen" en zie je niet dat de server iets anders
    // vasthoudt dan wat je uitrolt.
    if (!huidig) return;
    const staatOp = snapshot.channels.find((channel) => channel.id === huidig);
    const opNu = staatOp ? `"${staatOp.name}"` : 'een kanaal dat niet meer bestaat';
    warnings.push(
      gevonden
        ? `${wat} staat op ${opNu}; de template wil "${naam}".`
        : `${wat} staat op ${opNu}; een kanaal met de naam "${naam}" staat niet in de server.`,
    );
  };

  // Op een community-server dwingt Discord het inhoudsfilter en een minimale
  // verificatie af, en stuurt de applier die dus ook mee als de template erover
  // zwijgt. Vergelijken doen we met diezelfde waarden, anders blijft het verschil.
  const community = gewenst.community === true || nu.community;
  const verificatie = community
    ? gewenst.verificationLevel === undefined || gewenst.verificationLevel === 'none'
      ? 'low'
      : gewenst.verificationLevel
    : gewenst.verificationLevel;

  anders('verificationLevel', verificatie, nu.verificationLevel);
  anders('explicitContentFilter', community ? 'all_members' : gewenst.explicitContentFilter, nu.explicitContentFilter);
  anders('defaultMessageNotifications', gewenst.defaultMessageNotifications, nu.defaultMessageNotifications);
  anders('afkTimeoutSeconds', gewenst.afkTimeoutSeconds, nu.afkTimeoutSeconds);
  anders('description', gewenst.description, nu.description ?? '');

  kanaalAnders('systemChannel', 'Het systeemkanaal', gewenst.systemChannel, nu.systemChannelId);
  kanaalAnders('afkChannel', 'Het afk-kanaal', gewenst.afkChannel, nu.afkChannelId);

  // Een regels- en updateskanaal bestaan alleen op een community-server; op een
  // gewone server weigert Discord ze en slaat de applier ze over.
  if (community) {
    kanaalAnders('rulesChannel', 'Het regelskanaal', gewenst.rulesChannel, nu.rulesChannelId);
    kanaalAnders('updatesChannel', 'Het updateskanaal', gewenst.updatesChannel, nu.updatesChannelId);
  }

  if (gewenst.community === true && !nu.community) changes.push('community');

  // Een pad of URL valt niet te vergelijken met wat Discord ervan gemaakt heeft,
  // dus die gaan altijd mee. Staat er niets in de template, dan blijft het zoals het is.
  if (gewenst.icon !== undefined) changes.push('icon');
  if (gewenst.banner !== undefined) changes.push('banner');

  return changes.length > 0 ? [{ kind: 'guild-settings', changes }] : [];
}

export function planSetup(snapshot: GuildSnapshot, template: ServerTemplate, options: PlanOptions): Plan {
  const warnings: string[] = [];
  let actions: PlanAction[] = [...planRoles(snapshot, template, options)];

  const channelPlan = planChannels(snapshot, template, options);
  actions.push(...channelPlan.actions);

  /**
   * Opruimen gaat als laatste, nadat alles klopt.
   *
   * Andersom liep het vast: een kanaal dat Discord nog nodig heeft - het regels-
   * kanaal van een community-server - laat hij niet weghalen. Eerst de
   * verwijzing verzetten en dan pas opruimen lukt in één keer; opruimen voordat
   * de verwijzing verzet is, kost altijd een tweede ronde.
   */
  const verwijderingen: PlanAction[] = [];
  if (options.prune) {
    for (const channel of snapshot.channels) {
      if (!channelPlan.keptChannelIds.has(channel.id)) {
        // De categorie erbij: "#algemeen verdwijnt" is iets anders als je weet
        // dat het om de oude gamingzone gaat en niet om je eigen gesprekskanaal.
        const onder = snapshot.categories.find((categorie) => categorie.id === channel.parentId)?.name ?? null;
        verwijderingen.push({
          kind: 'delete-channel',
          channelId: channel.id,
          name: channel.name,
          isCategory: false,
          onder,
        });
      }
    }
    for (const category of snapshot.categories) {
      if (!channelPlan.keptCategoryIds.has(category.id)) {
        verwijderingen.push({ kind: 'delete-channel', channelId: category.id, name: category.name, isCategory: true });
      }
    }
  }

  // Discord weigert forum-, announcement- en stagekanalen zolang de server geen
  // Community-server is. Die moeten dus wachten tot dat aanstaat, en dat kan pas
  // als het regels- en updateskanaal bestaan.
  if (template.guild.community) {
    const later = actions.filter(
      (action) => action.kind === 'create-channel' && needsCommunity(action.channel.type),
    );
    if (later.length > 0) {
      actions = actions.filter((action) => !later.includes(action));
      actions.push({ kind: 'guild-community' }, ...later);
    }
  }

  actions.push(...planEmojis(snapshot, template));
  actions.push(...planAutomod(snapshot, template, options));

  const createdChannels = actions.some(
    (action) => action.kind === 'create-channel' || action.kind === 'create-category',
  );
  const templateChannelCount =
    template.categories.reduce((sum, category) => sum + category.channels.length, 0) +
    template.uncategorizedChannels.length;

  if (templateChannelCount > 0 && (createdChannels || channelsOutOfOrder(snapshot, template))) {
    actions.push({ kind: 'order-channels', count: templateChannelCount + template.categories.length });
  }

  const createdRoles = actions.some((action) => action.kind === 'create-role');
  if (template.roles.length > 1 && (createdRoles || rolesOutOfOrder(snapshot, template))) {
    actions.push({ kind: 'order-roles', count: template.roles.length });
  }

  // Zonder opgehaalde onboarding valt er niets te vergelijken; dan zetten we hem
  // gewoon, zoals het altijd ging.
  if (template.onboarding) {
    const gelijk =
      snapshot.onboarding !== null &&
      onboardingGelijk(
        template.onboarding,
        snapshot.onboarding,
        rolIdsVanTemplate(snapshot, template),
        kanaalIdsVanServer(snapshot),
      );
    if (!gelijk) actions.push({ kind: 'onboarding', prompts: template.onboarding.prompts.length });
  }

  actions.push(...planGuildSettings(snapshot, template, warnings));
  actions.push(...verwijderingen);

  const totalChannels = template.categories.reduce((sum, category) => sum + category.channels.length, 0) +
    template.uncategorizedChannels.length;
  if (snapshot.channels.length + totalChannels > 500) {
    warnings.push('Discord staat maximaal 500 kanalen per server toe; deze template past er mogelijk niet in.');
  }
  if (template.roles.length > 250) {
    warnings.push('Discord staat maximaal 250 rollen per server toe.');
  }

  warnings.push(...dubbeleNamen(snapshot, template));

  // Alleen kanalen die er al staan; wat deze ronde nog gemaakt wordt krijgt de
  // rechten uit de template, en daar kijkt de controle vooraf al naar.
  for (const naam of template.onboarding?.defaultChannels ?? []) {
    const kanaal = snapshot.channels.find((channel) => normalize(channel.name) === normalize(naam));
    if (kanaal && !everyoneZiet(snapshot, kanaal)) {
      warnings.push(
        `Onboarding: @everyone kan "${naam}" niet zien. Discord weigert de hele onboarding zolang een standaardkanaal verstopt is.`,
      );
    }
  }

  return { templateName: template.name, options, actions, warnings };
}

export function summarizePlan(plan: Plan): string {
  if (plan.actions.length === 0) {
    return 'Geen wijzigingen nodig — de server komt al overeen met de template.';
  }

  const counts = new Map<PlanAction['kind'], number>();
  for (const action of plan.actions) {
    counts.set(action.kind, (counts.get(action.kind) ?? 0) + 1);
  }

  const labels: Record<PlanAction['kind'], string> = {
    'create-role': 'rol aanmaken',
    'update-role': 'rol bijwerken',
    'create-category': 'categorie aanmaken',
    'update-category': 'categorie bijwerken',
    'create-channel': 'kanaal aanmaken',
    'update-channel': 'kanaal bijwerken',
    'delete-channel': 'verwijderen',
    'create-emoji': 'emoji toevoegen',
    'create-automod': 'automod-regel aanmaken',
    'update-automod': 'automod-regel bijwerken',
    'order-channels': 'kanaalvolgorde zetten',
    'order-roles': 'rolvolgorde zetten',
    onboarding: 'onboarding instellen',
    'guild-community': 'community-modus aanzetten',
    'guild-settings': 'serverinstellingen',
  };

  return [...counts.entries()].map(([kind, count]) => `${count}x ${labels[kind]}`).join(' · ');
}

/**
 * Korte naam van één actie, voor foutmeldingen. "create-role" alleen zegt niets;
 * je wilt weten welke rol of welk kanaal het niet deed.
 */
export function actionLabel(action: PlanAction): string {
  switch (action.kind) {
    case 'create-role':
    case 'update-role':
      return `${action.kind} @${action.role.name}`;
    case 'create-category':
    case 'update-category':
      return `${action.kind} ${action.category.name}`;
    case 'create-channel':
    case 'update-channel':
      return `${action.kind} #${action.channel.name}`;
    case 'delete-channel':
      return `delete-channel ${action.name}`;
    case 'create-emoji':
      return `create-emoji :${action.emoji.name}:`;
    case 'create-automod':
    case 'update-automod':
      return `${action.kind} "${action.rule.name}"`;
    default:
      return action.kind;
  }
}

/**
 * Hetzelfde plan, maar uit elkaar gehaald in plaats van in een zin geplakt.
 *
 * De tekstregels hieronder zijn prima voor een log, maar een scherm wil weten
 * wát er verandert: een plusje bij een nieuw kanaal, een streepje bij iets dat
 * verdwijnt, en het onderscheid tussen "dit maak ik aan" en "dit gooi ik weg,
 * en alleen omdat jij prune hebt aangevinkt". Die laatste hoor je apart te zien.
 */
export interface ActieRegel {
  teken: '+' | '~' | '-';
  soort: 'rol' | 'categorie' | 'kanaal' | 'emoji' | 'automod' | 'volgorde' | 'onboarding' | 'instellingen';
  naam: string;
  /** Kanaaltype, voor het juiste icoontje. */
  type?: ChannelSpec['type'];
  /** In welke categorie het kanaal komt. */
  onder?: string | null;
  /** Wat er precies verandert, bij een bijwerking. */
  detail?: string;
  /** Deze regel gebeurt alleen omdat "verwijderen wat niet in de template staat" aanstaat. */
  prune?: boolean;
}

export function planRegels(plan: Plan): ActieRegel[] {
  return plan.actions.map((action): ActieRegel => {
    switch (action.kind) {
      case 'create-role':
        return { teken: '+', soort: 'rol', naam: `@${action.role.name}` };
      case 'update-role':
        return { teken: '~', soort: 'rol', naam: `@${action.role.name}`, detail: action.changes.join(', ') };
      case 'create-category':
        return { teken: '+', soort: 'categorie', naam: action.category.name };
      case 'update-category':
        return {
          teken: '~',
          soort: 'categorie',
          naam: action.category.name,
          detail: action.changes.join(', '),
        };
      case 'create-channel':
        return {
          teken: '+',
          soort: 'kanaal',
          naam: action.channel.name,
          type: action.channel.type,
          onder: action.categoryName,
        };
      case 'update-channel':
        return {
          teken: '~',
          soort: 'kanaal',
          naam: action.channel.name,
          type: action.channel.type,
          onder: action.categoryName,
          detail: action.changes.join(', '),
        };
      case 'delete-channel':
        return {
          teken: '-',
          soort: action.isCategory ? 'categorie' : 'kanaal',
          naam: action.name,
          onder: action.onder ?? null,
          prune: true,
        };
      case 'create-emoji':
        return { teken: '+', soort: 'emoji', naam: `:${action.emoji.name}:` };
      case 'create-automod':
        return { teken: '+', soort: 'automod', naam: action.rule.name, detail: action.rule.trigger };
      case 'update-automod':
        return { teken: '~', soort: 'automod', naam: action.rule.name };
      case 'order-channels':
        return { teken: '~', soort: 'volgorde', naam: `${action.count} kanalen en categorieen` };
      case 'order-roles':
        return { teken: '~', soort: 'volgorde', naam: `${action.count} rollen` };
      case 'onboarding':
        return { teken: '~', soort: 'onboarding', naam: `${action.prompts} vragen` };
      case 'guild-community':
        return {
          teken: '~',
          soort: 'instellingen',
          naam: 'community-modus aanzetten',
          detail: 'nodig voor forum- en announcementkanalen',
        };
      case 'guild-settings':
        return { teken: '~', soort: 'instellingen', naam: 'serverinstellingen', detail: action.changes.join(', ') };
    }
  });
}

export function describeActions(plan: Plan, limit = 25): string[] {
  const lines = plan.actions.map((action) => {
    switch (action.kind) {
      case 'create-role':
        return `+ rol @${action.role.name}`;
      case 'update-role':
        return `~ rol @${action.role.name} (${action.changes.join(', ')})`;
      case 'create-category':
        return `+ categorie ${action.category.name}`;
      case 'update-category':
        return `~ categorie ${action.category.name}`;
      case 'create-channel': {
        const extras = [action.channel.tags.length > 0 ? `${action.channel.tags.length} tags` : ''].filter(
          Boolean,
        );
        return (
          `+ ${action.channel.type} #${action.channel.name}` +
          (action.categoryName ? ` in ${action.categoryName}` : '') +
          (extras.length ? ` (${extras.join(', ')})` : '')
        );
      }
      case 'update-channel':
        return `~ #${action.channel.name} (${action.changes.join(', ')})`;
      case 'delete-channel':
        return `- ${action.isCategory ? 'categorie' : 'kanaal'} ${action.name}`;
      case 'create-emoji':
        return `+ emoji :${action.emoji.name}:`;
      case 'create-automod':
        return `+ automod "${action.rule.name}" (${action.rule.trigger})`;
      case 'update-automod':
        return `~ automod "${action.rule.name}"`;
      case 'order-channels':
        return `~ volgorde van ${action.count} kanalen/categorieen`;
      case 'order-roles':
        return `~ volgorde van ${action.count} rollen`;
      case 'onboarding':
        return `~ onboarding (${action.prompts} vragen)`;
      case 'guild-community':
        return '~ community-modus aanzetten (nodig voor forum- en announcementkanalen)';
      case 'guild-settings':
        return `~ serverinstellingen (${action.changes.join(', ')})`;
    }
  });

  if (lines.length <= limit) return lines;
  return [...lines.slice(0, limit), `… en nog ${lines.length - limit} acties`];
}
