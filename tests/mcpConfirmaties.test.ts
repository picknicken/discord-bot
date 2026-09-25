import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Plan } from '../src/planner.js';
import {
  ConfirmatieFout,
  maakConfirmatie,
  planHash,
  verbruikConfirmatie,
  wisAlleConfirmatiesVoorTests,
} from '../src/mcp/confirmaties.js';

/**
 * De confirmatie tussen preview_template en apply_template, los van MCP en
 * HTTP getoetst — dit is waar de eis uit de opdracht precies op zit:
 * `correct token → toegestaan`, `verkeerd token → geweigerd`, `token voor
 * andere guild/template → geweigerd`, `gewijzigd plan → geweigerd`,
 * `verlopen token → geweigerd`.
 */
function nepPlan(naam = 'Minimaal'): Plan {
  return {
    templateName: naam,
    options: { prune: false, update: true },
    actions: [],
    warnings: [],
    verwijzingen: { kanalen: new Map(), categorieen: new Map() },
  } as unknown as Plan;
}

describe('confirmatie tussen preview en apply', () => {
  beforeEach(() => wisAlleConfirmatiesVoorTests());

  it('een geldig token voor precies dezelfde guild/template/plan wordt geaccepteerd', () => {
    const plan = nepPlan();
    const { token } = maakConfirmatie('g1', 'minimaal', plan);
    expect(() => verbruikConfirmatie(token, 'g1', 'minimaal', plan)).not.toThrow();
  });

  it('een onbekend (verzonnen) token wordt geweigerd', () => {
    const plan = nepPlan();
    expect(() => verbruikConfirmatie('bestaat-niet', 'g1', 'minimaal', plan)).toThrow(ConfirmatieFout);
  });

  it('is eenmalig: hetzelfde token nogmaals gebruiken wordt geweigerd', () => {
    const plan = nepPlan();
    const { token } = maakConfirmatie('g1', 'minimaal', plan);
    verbruikConfirmatie(token, 'g1', 'minimaal', plan);
    expect(() => verbruikConfirmatie(token, 'g1', 'minimaal', plan)).toThrow(ConfirmatieFout);
  });

  it('een token voor een andere server wordt geweigerd', () => {
    const plan = nepPlan();
    const { token } = maakConfirmatie('g1', 'minimaal', plan);
    expect(() => verbruikConfirmatie(token, 'g2', 'minimaal', plan)).toThrow(/andere server/);
  });

  it('een token voor een andere template wordt geweigerd', () => {
    const plan = nepPlan();
    const { token } = maakConfirmatie('g1', 'minimaal', plan);
    expect(() => verbruikConfirmatie(token, 'g1', 'anders', plan)).toThrow(/andere template/);
  });

  it('een gewijzigd plan (andere acties dan bij de preview) wordt geweigerd', () => {
    const plan = nepPlan();
    const { token } = maakConfirmatie('g1', 'minimaal', plan);
    const anderPlan: Plan = { ...plan, actions: [{ kind: 'create-role', role: { key: 'x', name: 'X', permissions: [] } }] } as unknown as Plan;
    expect(() => verbruikConfirmatie(token, 'g1', 'minimaal', anderPlan)).toThrow(/niet meer hetzelfde/);
  });

  it('de hash verandert zodra de acties in het plan veranderen', () => {
    const plan = nepPlan();
    const anderPlan: Plan = { ...plan, actions: [{ kind: 'create-role', role: { key: 'x', name: 'X', permissions: [] } }] } as unknown as Plan;
    expect(planHash('g1', 'minimaal', plan)).not.toBe(planHash('g1', 'minimaal', anderPlan));
  });

  describe('vervaltijd', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('een token binnen de geldigheid werkt gewoon', () => {
      const plan = nepPlan();
      const { token } = maakConfirmatie('g1', 'minimaal', plan);
      vi.advanceTimersByTime(9 * 60 * 1000);
      expect(() => verbruikConfirmatie(token, 'g1', 'minimaal', plan)).not.toThrow();
    });

    it('een verlopen token (ouder dan tien minuten) wordt geweigerd', () => {
      const plan = nepPlan();
      const { token } = maakConfirmatie('g1', 'minimaal', plan);
      vi.advanceTimersByTime(11 * 60 * 1000);
      expect(() => verbruikConfirmatie(token, 'g1', 'minimaal', plan)).toThrow(/verlopen/);
    });
  });
});
