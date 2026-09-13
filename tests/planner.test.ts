import { describe, expect, it } from 'vitest';
import { planSetup, summarizePlan } from '../src/planner.js';
import type { GuildSnapshot } from '../src/snapshot.js';
import { parseTemplate } from '../src/types.js';
import { toBitfield } from '../src/permissions.js';

const emptyGuild: GuildSnapshot = {
  id: '1',
  name: 'Testserver',
  roles: [
    {
      id: '1',
      name: '@everyone',
      color: 0,
      hoist: false,
      mentionable: false,
      permissions: 0n,
      position: 0,
      rawPosition: 0,
      managed: false,
      isEveryone: true,
    },
  ],
  categories: [],
  channels: [],
  emojis: [],
  automod: [],
};

const template = parseTemplate({
  name: 'Test',
  roles: [{ key: 'lid', name: 'Lid', color: '#57f287', permissions: ['ViewChannel'] }],
  categories: [
    {
      name: 'Algemeen',
      overwrites: [{ role: '@everyone', deny: ['ViewChannel'] }],
      channels: [{ name: 'chat', type: 'text' }],
    },
  ],
});

describe('community-kanalen', () => {
  const metForum = parseTemplate({
    name: 'T',
    guild: { community: true, rulesChannel: 'regels', updatesChannel: 'nieuws' },
    categories: [{
      name: 'Info',
      channels: [
        { name: 'regels' },
        { name: 'nieuws' },
        { name: 'vragen', type: 'forum' },
        { name: 'mededelingen', type: 'announcement' },
      ],
    }],
  });

  const plan = planSetup(emptyGuild, metForum, { prune: false, update: true });
  const soorten = plan.actions.map((action) => action.kind);

  it('zet community-modus aan voor de kanalen die het nodig hebben', () => {
    const community = soorten.indexOf('guild-community');
    const forum = plan.actions.findIndex(
      (action) => action.kind === 'create-channel' && action.channel.type === 'forum',
    );

    expect(community).toBeGreaterThan(-1);
    expect(community).toBeLessThan(forum);
  });

  it('maakt de gewone kanalen wel eerst aan, want daar hangt community aan vast', () => {
    const regels = plan.actions.findIndex(
      (action) => action.kind === 'create-channel' && action.channel.name === 'regels',
    );
    expect(regels).toBeLessThan(soorten.indexOf('guild-community'));
  });

  it('laat de volgorde met rust als er niets is dat community nodig heeft', () => {
    const gewoon = parseTemplate({
      name: 'T',
      guild: { community: true, rulesChannel: 'regels', updatesChannel: 'regels' },
      categories: [{ name: 'Info', channels: [{ name: 'regels' }] }],
    });
    expect(planSetup(emptyGuild, gewoon, { prune: false, update: true }).actions
      .some((action) => action.kind === 'guild-community')).toBe(false);
  });
});

describe('planSetup', () => {
  it('maakt alles aan op een lege server', () => {
    const plan = planSetup(emptyGuild, template, { prune: false, update: true });
    const kinds = plan.actions.map((action) => action.kind);
    expect(kinds).toEqual(['create-role', 'create-category', 'create-channel', 'order-channels']);
  });

  it('houdt rol-aanmaak voor kanaal-aanmaak', () => {
    const plan = planSetup(emptyGuild, template, { prune: false, update: true });
    const firstChannel = plan.actions.findIndex((action) => action.kind === 'create-channel');
    const lastRole = plan.actions.map((action) => action.kind).lastIndexOf('create-role');
    expect(lastRole).toBeLessThan(firstChannel);
  });

  it('maakt niets dubbel aan als alles al bestaat', () => {
    const existing: GuildSnapshot = {
      ...emptyGuild,
      roles: [
        ...emptyGuild.roles,
        {
          id: '2',
          name: 'Lid',
          color: 0x57f287,
          hoist: false,
          mentionable: false,
          permissions: toBitfield(['ViewChannel']),
          position: 1,
          rawPosition: 1,
          managed: false,
          isEveryone: false,
        },
      ],
      categories: [{ id: '10', name: 'Algemeen', position: 0 }],
      channels: [
        {
          id: '11',
          name: 'chat',
          type: 'text',
          parentId: '10',
          topic: null,
          nsfw: false,
          slowmodeSeconds: 0,
          userLimit: null,
          position: 0,
        },
      ],
    };

    const plan = planSetup(existing, template, { prune: false, update: false });
    expect(plan.actions).toHaveLength(0);
    expect(summarizePlan(plan)).toMatch(/Geen wijzigingen/);
  });

  it('matcht hoofdletterongevoelig op naam', () => {
    const existing: GuildSnapshot = {
      ...emptyGuild,
      categories: [{ id: '10', name: 'ALGEMEEN', position: 0 }],
    };
    const plan = planSetup(existing, template, { prune: false, update: false });
    expect(plan.actions.some((action) => action.kind === 'create-category')).toBe(false);
  });

  it('verwijdert alleen met prune', () => {
    const withExtra: GuildSnapshot = {
      ...emptyGuild,
      channels: [
        {
          id: '99',
          name: 'oud-kanaal',
          type: 'text',
          parentId: null,
          topic: null,
          nsfw: false,
          slowmodeSeconds: 0,
          userLimit: null,
          position: 0,
        },
      ],
    };

    expect(
      planSetup(withExtra, template, { prune: false, update: true }).actions.some((a) => a.kind === 'delete-channel'),
    ).toBe(false);
    expect(
      planSetup(withExtra, template, { prune: true, update: true }).actions.some((a) => a.kind === 'delete-channel'),
    ).toBe(true);
  });

  it('negeert door integraties beheerde rollen', () => {
    const withBotRole: GuildSnapshot = {
      ...emptyGuild,
      roles: [
        ...emptyGuild.roles,
        {
          id: '3',
          name: 'Lid',
          color: 0,
          hoist: false,
          mentionable: false,
          permissions: 0n,
          position: 2,
          rawPosition: 2,
          managed: true,
          isEveryone: false,
        },
      ],
    };
    const plan = planSetup(withBotRole, template, { prune: false, update: true });
    expect(plan.actions.some((action) => action.kind === 'create-role')).toBe(true);
  });
});
