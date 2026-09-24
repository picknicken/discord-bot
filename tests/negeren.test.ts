import { describe, expect, it } from 'vitest';
import { maakNegeer } from '../src/negeren.js';
import { planSetup, type PlanAction } from '../src/planner.js';
import { parseTemplate } from '../src/types.js';
import type { GuildSnapshot } from '../src/snapshot.js';
import { standaardInstellingen } from './helpers/snapshot.js';

/**
 * Een ticketbot maakt kanalen die niemand van tevoren kan opschrijven. Zonder
 * negeer-lijst gooit een uitrol met prune aan de openstaande tickets van je
 * leden weg, en telt elke open ticket ondertussen als een afwijking.
 */

describe('welke namen blijven met rust', () => {
  it('een naam die er precies zo in staat', () => {
    expect(maakNegeer(['Tickets'])('Tickets')).toBe(true);
  });

  it('trekt zich niets aan van hoofdletters of spaties', () => {
    expect(maakNegeer([' tickets '])('TICKETS')).toBe(true);
  });

  it('een naam die er niet in staat blijft gewoon meedoen', () => {
    expect(maakNegeer(['Tickets'])('Lobby')).toBe(false);
  });

  it('met een ster vang je een hele reeks', () => {
    const negeert = maakNegeer(['ticket-*']);
    expect(negeert('ticket-0042')).toBe(true);
    expect(negeert('ticket-')).toBe(true);
    expect(negeert('mijn-ticket-1')).toBe(false);
  });

  it('behandelt de rest van de naam als gewone tekst', () => {
    // Zonder ontsnappen zou "c++" een kapotte reguliere expressie zijn.
    expect(maakNegeer(['c++'])('c++')).toBe(true);
    expect(maakNegeer(['c++'])('cxx')).toBe(false);
  });

  it('zonder lijst blijft er niets met rust', () => {
    expect(maakNegeer([])('wat dan ook')).toBe(false);
  });
});

const kanaal = (id: string, name: string, parentId: string | null = null) => ({
  id,
  name,
  type: 'text' as const,
  parentId,
  topic: null,
  nsfw: false,
  slowmodeSeconds: 0,
  userLimit: null,
  position: 0,
  overwrites: [],
});

/** Een server met een ticketcategorie waar twee tickets in openstaan. */
const server = (): GuildSnapshot => ({
  id: 'g1',
  name: 'NEXUS',
  roles: [
    { id: 'g1', name: '@everyone', color: 0, hoist: false, mentionable: false, permissions: 0n, position: 0, rawPosition: 0, managed: false, isEveryone: true },
  ],
  categories: [
    { id: 'cat-tickets', name: 'Tickets', position: 0, overwrites: [] },
    { id: 'cat-lobby', name: 'Lobby', position: 1, overwrites: [] },
  ],
  channels: [
    kanaal('t1', 'ticket-0042', 'cat-tickets'),
    kanaal('t2', 'ticket-0043', 'cat-tickets'),
    kanaal('c1', 'chat', 'cat-lobby'),
    kanaal('los', 'oud-kanaal', null),
  ],
  emojis: [],
  automod: [],
  settings: standaardInstellingen,
  onboarding: null,
  rolmenus: [],
  rolmenusGelezen: true,
});

const template = (negeer: string[] = []) =>
  parseTemplate({
    name: 'Test',
    negeer,
    categories: [
      { name: 'Tickets', channels: [] },
      { name: 'Lobby', channels: [{ name: 'chat', topic: 'Praat hier' }] },
    ],
  });

const verwijderd = (acties: PlanAction[]) =>
  acties.filter((actie) => actie.kind === 'delete-channel').map((actie) => actie.name);

describe('uitrollen met prune', () => {
  it('gooit zonder negeer-lijst de openstaande tickets weg', () => {
    const plan = planSetup(server(), template(), { prune: true, update: true });

    // Dit is het gedrag waar het om begonnen is: niemand bedoelt dit.
    expect(verwijderd(plan.actions)).toContain('ticket-0042');
  });

  it('laat de tickets staan zodra de categorie genegeerd wordt', () => {
    const plan = planSetup(server(), template(['Tickets']), { prune: true, update: true });

    expect(verwijderd(plan.actions)).not.toContain('ticket-0042');
    expect(verwijderd(plan.actions)).not.toContain('ticket-0043');
    // En wat er níet in staat gaat gewoon weg.
    expect(verwijderd(plan.actions)).toContain('oud-kanaal');
  });

  it('zegt wat er is overgeslagen', () => {
    const plan = planSetup(server(), template(['Tickets']), { prune: true, update: true });

    expect(plan.warnings.join(' ')).toContain('met rust');
    expect(plan.warnings.join(' ')).toContain('ticket-0042');
  });

  it('laat de categorie zelf met rust, maar maakt hem niet opnieuw aan', () => {
    const plan = planSetup(server(), template(['Tickets']), { prune: true, update: true });

    expect(verwijderd(plan.actions)).not.toContain('Tickets');
    expect(plan.actions.some((actie) => actie.kind === 'create-category')).toBe(false);
  });

  it('werkt een genegeerd kanaal ook niet bij', () => {
    // "chat" wijkt af van de template (geen topic), maar blijft met rust.
    const plan = planSetup(server(), template(['Lobby']), { prune: false, update: true });

    expect(plan.actions.filter((actie) => actie.kind === 'update-channel')).toEqual([]);
  });

  it('vangt losse kanalen met een ster', () => {
    const plan = planSetup(server(), template(['oud-*']), { prune: true, update: true });
    expect(verwijderd(plan.actions)).not.toContain('oud-kanaal');
  });
});
