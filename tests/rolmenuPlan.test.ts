import { describe, expect, it } from 'vitest';
import { planSetup, type PlanAction } from '../src/planner.js';
import type { GuildSnapshot } from '../src/snapshot.js';
import type { GeplaatstRolmenu } from '../src/rolmenu.js';
import { standaardInstellingen } from './helpers/snapshot.js';
import { parseTemplate } from '../src/types.js';

/**
 * Een rolmenu dat bij elke uitrol opnieuw geplaatst wordt levert na een maand
 * tien berichten op in hetzelfde kanaal. De planner kijkt dus eerst wat er staat.
 */

const template = parseTemplate({
  name: 'Test',
  roles: [{ key: 'pc', name: 'PC' }],
  uncategorizedChannels: [{ name: 'rollen' }],
  roleMenus: [
    {
      channel: 'rollen',
      title: 'Waar speel je op?',
      description: 'Klik maar.',
      options: [{ role: 'pc', emoji: '🖥️' }],
    },
  ],
});

const staatErOp: GeplaatstRolmenu = {
  channelId: 'k1',
  channelName: 'rollen',
  messageId: 'm1',
  title: 'Waar speel je op?',
  description: 'Klik maar.',
  color: null,
  style: 'buttons',
  options: [{ roleId: 'r1', label: 'PC', emoji: '🖥️', description: null }],
};

const server = (rolmenus: GeplaatstRolmenu[] | null): GuildSnapshot => ({
  id: '1',
  name: 'Testserver',
  roles: [
    { id: '1', name: '@everyone', color: 0, hoist: false, mentionable: false, permissions: 0n, position: 0, rawPosition: 0, managed: false, isEveryone: true },
    { id: 'r1', name: 'PC', color: 0, hoist: false, mentionable: false, permissions: 0n, position: 1, rawPosition: 1, managed: false, isEveryone: false },
  ],
  categories: [],
  channels: [
    { id: 'k1', name: 'rollen', type: 'text', parentId: null, topic: null, nsfw: false, slowmodeSeconds: 0, userLimit: null, position: 0, overwrites: [] },
  ],
  emojis: [],
  automod: [],
  settings: standaardInstellingen,
  onboarding: null,
  rolmenus: rolmenus ?? [],
  rolmenusGelezen: rolmenus !== null,
});

const rolmenuActies = (snapshot: GuildSnapshot): PlanAction[] =>
  planSetup(snapshot, template, { prune: false, update: true }).actions.filter(
    (actie) => actie.kind === 'role-menu',
  );

describe('rolmenu plannen', () => {
  it('plaatst het bericht als het er nog niet staat', () => {
    const acties = rolmenuActies(server([]));

    expect(acties).toHaveLength(1);
    expect(acties[0]).toMatchObject({ kind: 'role-menu', messageId: null });
  });

  it('doet niets als het er al precies zo staat', () => {
    expect(rolmenuActies(server([staatErOp]))).toEqual([]);
  });

  it('werkt het bestaande bericht bij als de tekst anders is', () => {
    const acties = rolmenuActies(server([{ ...staatErOp, description: 'Iets anders' }]));

    expect(acties).toHaveLength(1);
    // Bijwerken en niet opnieuw plaatsen: het bericht blijft staan waar het staat.
    expect(acties[0]).toMatchObject({ messageId: 'm1' });
  });

  it('werkt bij als er een rol uit is gehaald', () => {
    expect(rolmenuActies(server([{ ...staatErOp, options: [] }]))).toHaveLength(1);
  });

  it('kijkt niet naar een menu met dezelfde titel in een ander kanaal', () => {
    const elders = { ...staatErOp, channelName: 'algemeen' };
    expect(rolmenuActies(server([elders]))).toHaveLength(1);
  });

  it('plaatst niets zolang er niet naar de berichten gekeken is', () => {
    const plan = planSetup(server(null), template, { prune: false, update: true });

    expect(plan.actions.filter((actie) => actie.kind === 'role-menu')).toEqual([]);
    expect(plan.warnings.join(' ')).toContain('niet gekeken');
  });

  it('telt mee in de samenvatting van wat er gebeurt', () => {
    const plan = planSetup(server([]), template, { prune: false, update: true });
    expect(plan.actions.some((actie) => actie.kind === 'role-menu')).toBe(true);
  });
});

describe('een rolmenu zonder rollen', () => {
  const leeg = parseTemplate({
    name: 'Test',
    uncategorizedChannels: [{ name: 'rollen' }],
    roleMenus: [{ channel: 'rollen', title: 'Kies', options: [] }],
  });

  it('is geldig, want zo begint er één', () => {
    expect(leeg.roleMenus[0]?.options).toEqual([]);
  });

  it('wordt niet geplaatst', () => {
    const plan = planSetup(server([]), leeg, { prune: false, update: true });
    expect(plan.actions.filter((actie) => actie.kind === 'role-menu')).toEqual([]);
  });
});
