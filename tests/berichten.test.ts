import { ChannelType, Collection, PermissionFlagsBits, PermissionsBitField, type Guild } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { applyPlan } from '../src/applier.js';
import { planSetup } from '../src/planner.js';
import { parseTemplate } from '../src/types.js';
import type { GuildSnapshot } from '../src/snapshot.js';

/**
 * Een template mag berichten bevatten — een welkomsttekst, de regels. Die zetten
 * echte tekst in je server, zichtbaar voor je leden, met de bot als afzender.
 * Daarom gebeurt dat alleen als je erom vraagt, en niet als bijvangst van "richt
 * mijn server in".
 */
function nepServer() {
  const verstuurd: string[] = [];
  const vastgezet: string[] = [];
  const kanalen = new Collection<string, Record<string, unknown>>();
  let teller = 0;

  const guild = {
    id: 'g1',
    name: 'Nepserver',
    features: [] as string[],
    roles: {
      cache: new Collection(),
      create: async ({ name }: { name: string }) => ({ id: `r${++teller}`, name, managed: false, rawPosition: 1 }),
      fetch: async () => new Collection(),
      setPositions: async () => undefined,
    },
    channels: {
      cache: kanalen,
      create: async ({ name, type }: { name: string; type?: ChannelType }) => {
        const kanaal = {
          id: `c${++teller}`,
          name,
          type: type ?? ChannelType.GuildText,
          isThread: () => false,
          isTextBased: () => true,
          send: async ({ content }: { content: string }) => {
            verstuurd.push(`#${name}: ${content}`);
            return { pin: async () => vastgezet.push(content) };
          },
        };
        kanalen.set(kanaal.id, kanaal);
        return kanaal;
      },
      fetch: async (id?: string) => (id ? (kanalen.get(id) ?? null) : undefined),
      setPositions: async () => undefined,
    },
    members: {
      fetchMe: async () => ({
        id: 'bot',
        roles: { botRole: { id: 'botrol' }, highest: { position: 10, rawPosition: 10 } },
        permissions: new PermissionsBitField([PermissionFlagsBits.Administrator]),
      }),
    },
    autoModerationRules: { create: async () => undefined },
    edit: async () => guild,
  };

  return { guild: guild as unknown as Guild, verstuurd, vastgezet };
}

const leeg = {
  id: 'g1', name: 'Nepserver', roles: [], categories: [], channels: [], emojis: [], automod: [],
} as unknown as GuildSnapshot;

const template = parseTemplate({
  name: 'Met berichten',
  categories: [
    {
      name: 'Info',
      channels: [
        { name: 'welkom', messages: [{ content: 'Welkom bij de server!', pin: true }] },
        // pin staat standaard aan; hier met zoveel woorden uit.
        { name: 'regels', messages: [{ content: 'Regel 1: wees aardig.', pin: false }] },
        { name: 'algemeen' },
      ],
    },
  ],
});

const draai = async (opties?: { berichten?: boolean }) => {
  const nep = nepServer();
  const plan = planSetup(leeg, template, { prune: false, update: true });
  const result = await applyPlan(nep.guild, template, plan, opties);
  return { ...nep, result };
};

describe('berichten posten', () => {
  it('post niets als je er niet om vraagt', async () => {
    const { verstuurd, vastgezet, result } = await draai();

    expect(verstuurd).toEqual([]);
    expect(vastgezet).toEqual([]);
    expect(result.failed).toBe(0);
  });

  it('zegt wel hoeveel berichten het heeft laten staan', async () => {
    const { result } = await draai();
    expect(result.overgeslagenBerichten).toBe(2);
  });

  it('post ze wel als je erom vraagt, en pint wat gepind moet worden', async () => {
    const { verstuurd, vastgezet, result } = await draai({ berichten: true });

    expect(verstuurd).toEqual(['#welkom: Welkom bij de server!', '#regels: Regel 1: wees aardig.']);
    expect(vastgezet).toEqual(['Welkom bij de server!']);
    expect(result.overgeslagenBerichten).toBeUndefined();
  });
});
