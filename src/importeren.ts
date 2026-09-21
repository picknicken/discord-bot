import { ChannelType, GuildTemplate, type APITemplateSerializedSourceGuild } from 'discord.js';
import { toNames } from './permissions.js';
import { INHOUDSFILTER, MELDINGEN, VERIFICATIE } from './snapshot.js';
import { parseTemplate, type CategorySpec, type ChannelSpec, type Overwrite, type RoleSpec } from './types.js';

/**
 * Een discord.new-link als beginpunt.
 *
 * Discord heeft zijn eigen templates: een link waarmee je een kopie van een
 * server maakt. Die kun je hier niet bewerken, niet uitrollen op een server die
 * al bestaat, en niet vergelijken - maar het is wel een prima startpunt. Deze
 * vertaling haalt hem binnen als gewone template, en daarna is het er een van
 * jou.
 *
 * In zo'n template staan rollen en kanalen niet met echte id's maar met
 * volgnummers; rechten verwijzen naar het volgnummer van een rol. Daar moeten
 * dus namen van gemaakt worden.
 */
const TYPES: Partial<Record<number, ChannelSpec['type']>> = {
  [ChannelType.GuildText]: 'text',
  [ChannelType.GuildVoice]: 'voice',
  [ChannelType.GuildAnnouncement]: 'announcement',
  [ChannelType.GuildStageVoice]: 'stage',
  [ChannelType.GuildForum]: 'forum',
};

const slug = (naam: string) =>
  naam.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'rol';

const kleur = (getal: number | null | undefined) =>
  getal ? `#${getal.toString(16).padStart(6, '0')}` : undefined;

/** De code uit een link, of null als het er geen is. */
export function templateCode(invoer: string): string | null {
  const schoon = invoer.trim();
  const treffer = GuildTemplate.GuildTemplatesPattern.exec(schoon);
  if (treffer?.groups?.code) return treffer.groups.code;

  // Of iemand plakt alleen de code.
  return /^[\w-]{2,255}$/.test(schoon) ? schoon : null;
}

interface BronRol {
  id: number;
  name: string;
  color?: number;
  hoist?: boolean;
  mentionable?: boolean;
  permissions?: string | number;
}

interface BronKanaal {
  id?: number | string;
  type: number;
  name?: string;
  topic?: string | null;
  nsfw?: boolean;
  rate_limit_per_user?: number;
  user_limit?: number;
  parent_id?: number | string | null;
  permission_overwrites?: { id: number | string; allow?: string | number; deny?: string | number }[];
}

export function uitDiscordTemplate(bron: APITemplateSerializedSourceGuild, naam: string): ReturnType<typeof parseTemplate> {
  const bronRollen = ((bron.roles ?? []) as unknown as BronRol[]) ?? [];
  const bronKanalen = ((bron.channels ?? []) as unknown as BronKanaal[]) ?? [];

  // Volgnummer -> rolsleutel. Nummer 0 is altijd @everyone; die staat niet in
  // onze rollenlijst maar wordt wel in rechten genoemd.
  const sleutels = new Map<string, string>();
  const gebruikt = new Set<string>(['@everyone']);
  const roles: RoleSpec[] = [];

  for (const rol of bronRollen) {
    if (String(rol.id) === '0') {
      sleutels.set('0', '@everyone');
      continue;
    }

    let sleutel = slug(rol.name);
    let nummer = 2;
    while (gebruikt.has(sleutel)) sleutel = `${slug(rol.name)}-${nummer++}`;
    gebruikt.add(sleutel);
    sleutels.set(String(rol.id), sleutel);

    roles.push({
      key: sleutel,
      name: rol.name,
      color: kleur(rol.color),
      hoist: Boolean(rol.hoist),
      mentionable: Boolean(rol.mentionable),
      permissions: toNames(BigInt(rol.permissions ?? 0)),
    } as RoleSpec);
  }

  const rechten = (kanaal: BronKanaal): Overwrite[] =>
    (kanaal.permission_overwrites ?? [])
      .map((recht) => {
        const rol = sleutels.get(String(recht.id));
        if (!rol) return null;
        return {
          role: rol,
          allow: toNames(BigInt(recht.allow ?? 0)),
          deny: toNames(BigInt(recht.deny ?? 0)),
        } as Overwrite;
      })
      .filter((recht): recht is Overwrite => recht !== null);

  const kanaalSpec = (kanaal: BronKanaal): ChannelSpec | null => {
    const type = TYPES[kanaal.type];
    if (!type || !kanaal.name) return null;

    return {
      name: kanaal.name,
      type,
      topic: kanaal.topic ?? undefined,
      nsfw: Boolean(kanaal.nsfw),
      slowmodeSeconds: kanaal.rate_limit_per_user ?? 0,
      userLimit: kanaal.user_limit || undefined,
      overwrites: rechten(kanaal),
      tags: [],
    } as unknown as ChannelSpec;
  };

  const categorieen: CategorySpec[] = [];
  const opId = new Map<string, CategorySpec>();

  for (const kanaal of bronKanalen) {
    if (kanaal.type !== ChannelType.GuildCategory || !kanaal.name) continue;
    const categorie = { name: kanaal.name, overwrites: rechten(kanaal), channels: [] } as unknown as CategorySpec;
    opId.set(String(kanaal.id), categorie);
    categorieen.push(categorie);
  }

  const los: ChannelSpec[] = [];
  for (const kanaal of bronKanalen) {
    if (kanaal.type === ChannelType.GuildCategory) continue;
    const spec = kanaalSpec(kanaal);
    if (!spec) continue;

    const ouder = kanaal.parent_id === null || kanaal.parent_id === undefined
      ? undefined
      : opId.get(String(kanaal.parent_id));
    if (ouder) ouder.channels.push(spec);
    else los.push(spec);
  }

  const kanaalNaam = (id: unknown) =>
    bronKanalen.find((kanaal) => String(kanaal.id) === String(id))?.name ?? undefined;

  return parseTemplate({
    name: naam,
    description: `Overgenomen uit een Discord-template op ${new Date().toISOString().slice(0, 10)}`,
    guild: {
      verificationLevel: bron.verification_level === undefined ? undefined : VERIFICATIE[bron.verification_level],
      explicitContentFilter:
        bron.explicit_content_filter === undefined ? undefined : INHOUDSFILTER[bron.explicit_content_filter],
      defaultMessageNotifications:
        bron.default_message_notifications === undefined
          ? undefined
          : MELDINGEN[bron.default_message_notifications],
      systemChannel: kanaalNaam(bron.system_channel_id),
      afkChannel: kanaalNaam(bron.afk_channel_id),
    },
    roles,
    categories: categorieen,
    uncategorizedChannels: los,
  });
}
