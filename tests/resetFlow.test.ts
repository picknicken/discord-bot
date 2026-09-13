import { Collection, type Guild } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { applyReset, explainDeleteFailure, planReset } from '../src/reset.js';
import type { GuildSnapshot } from '../src/snapshot.js';

/** Fout zoals discord.js hem gooit: met een code, en soms alleen een status. */
class NepFout extends Error {
  constructor(message: string, readonly code?: number, readonly status?: number) {
    super(message);
  }
}

function nepServer(opties: { features?: string[]; kanaalFout?: (naam: string) => Error | null } = {}) {
  const verwijderd: string[] = [];
  const edits: Record<string, unknown>[] = [];
  const features = [...(opties.features ?? [])];

  const kanaal = (id: string, name: string) => ({
    id,
    name,
    delete: async () => {
      const fout = opties.kanaalFout?.(name);
      if (fout) throw fout;
      verwijderd.push(`kanaal ${name}`);
    },
  });

  const kanalen = new Collection([
    ['c1', kanaal('c1', '✅│regels')],
    ['c2', kanaal('c2', '🔔│discord-updates')],
    ['c3', kanaal('c3', '🗣️│algemeen')],
  ]);

  const guild = {
    id: 'g1',
    name: 'Nepserver',
    get features() {
      return features;
    },
    channels: { fetch: async (id: string) => kanalen.get(id) ?? null },
    roles: {
      fetch: async (id: string) => ({ id, delete: async () => verwijderd.push(`rol ${id}`) }),
    },
    autoModerationRules: {
      delete: async (id: string) => {
        if (id === 'weg') throw new NepFout('404: Not Found', undefined, 404);
        verwijderd.push(`automod ${id}`);
      },
    },
    edit: async (payload: Record<string, unknown>) => {
      edits.push(payload);
      if (Array.isArray(payload.features)) {
        features.length = 0;
        features.push(...(payload.features as string[]));
      }
      return guild;
    },
  };

  return { guild: guild as unknown as Guild, verwijderd, edits, features };
}

const snapshot: GuildSnapshot = {
  id: 'g1',
  name: 'Nepserver',
  roles: [],
  categories: [],
  channels: [
    { id: 'c1', name: '✅│regels' },
    { id: 'c2', name: '🔔│discord-updates' },
    { id: 'c3', name: '🗣️│algemeen' },
  ],
  emojis: [],
  automod: [{ id: 'weg', name: 'Block Mention Spam' }],
} as unknown as GuildSnapshot;

const plan = () => planReset(snapshot, 5);

describe('een community-server leeghalen', () => {
  it('zet community-modus uit voordat hij kanalen weggooit', async () => {
    // Discord weigert het regels- en updateskanaal zolang die modus aanstaat.
    const nep = nepServer({ features: ['COMMUNITY'] });
    const result = await applyReset(nep.guild, plan(), 'test');

    expect(nep.edits[0]?.features).not.toContain('COMMUNITY');
    expect(result.errors.join(' ')).toContain('community-modus uitgezet');
    expect(nep.verwijderd).toContain('kanaal ✅│regels');
  });

  it('raakt de kenmerken niet aan op een gewone server', async () => {
    const nep = nepServer();
    await applyReset(nep.guild, plan(), 'test');
    expect(nep.edits).toHaveLength(0);
  });

  it('zegt wat je moet doen als community-modus niet uit kan', async () => {
    const nep = nepServer({ features: ['COMMUNITY'] });
    nep.guild.edit = (async () => {
      throw new NepFout('Missing Permissions', 50013);
    }) as never;

    const result = await applyReset(nep.guild, plan(), 'test');
    expect(result.errors.join(' ')).toContain('Serverinstellingen -> Inschakelen community');
  });

  it('legt uit waarom Discord zo een kanaal weigert', () => {
    const uitleg = explainDeleteFailure(
      new NepFout('Cannot delete a channel required for community servers', 50074),
    );
    expect(uitleg).toContain('regels- of updateskanaal');
    expect(uitleg).toContain('Inschakelen community');
  });

  it('telt een automod-regel die al weg is als opgeruimd', async () => {
    const nep = nepServer();
    const result = await applyReset(nep.guild, plan(), 'test');

    // De regel bestaat niet meer (404) — dat is geen fout.
    expect(result.failed).toBe(0);
    expect(result.deleted).toBe(4);
  });

  it('telt een kanaal dat echt weigert wel als fout', async () => {
    const nep = nepServer({
      kanaalFout: (naam) => (naam === '🗣️│algemeen' ? new NepFout('Missing Permissions', 50013) : null),
    });
    const result = await applyReset(nep.guild, plan(), 'test');

    expect(result.failed).toBe(1);
    expect(result.errors.join(' ')).toContain('🗣️│algemeen');
  });
});
