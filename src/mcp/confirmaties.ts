import { randomUUID, createHash } from 'node:crypto';
import type { Plan } from '../planner.js';

/**
 * De confirmatie tussen `preview_template` en `apply_template`.
 *
 * Claude kan geen `bevestig: <exacte servernaam>` typen zoals `/setup apply`
 * dat vraagt — dus krijgt hij hier iets waar hij net zo min omheen kan: een
 * token die je alleen kunt krijgen door eerst een preview te doen, die maar
 * één keer werkt, na een kwartier verloopt, en die vastzit aan precies dít
 * plan voor precies déze server en déze template. Verander de template
 * tussendoor, en de hash klopt niet meer — dan moet er een nieuwe preview
 * komen, net zoals `/setup apply` zelf ook altijd opnieuw plant vlak voor het
 * uitvoert in plaats van een oud plan te hergebruiken.
 *
 * In het geheugen, met opzet: dit hoeft geen herstart te overleven, en een
 * kwartier oud token is toch al niets meer waard.
 */

export interface ConfirmatieUitkomst {
  token: string;
  verlooptOm: string;
}

interface Confirmatie {
  guildId: string;
  templateId: string;
  planHash: string;
  verlooptOm: number;
}

const GELDIGHEID_MS = 10 * 60 * 1000;
const bewaard = new Map<string, Confirmatie>();

/** Een stabiele hash van het plan: verandert zodra de acties erin veranderen. */
export function planHash(guildId: string, templateId: string, plan: Plan): string {
  const stabiel = JSON.stringify({ guildId, templateId, actions: plan.actions });
  return createHash('sha256').update(stabiel).digest('hex');
}

export function maakConfirmatie(guildId: string, templateId: string, plan: Plan): ConfirmatieUitkomst {
  ruimVerlopenOp();

  const token = randomUUID();
  const verlooptOm = Date.now() + GELDIGHEID_MS;
  bewaard.set(token, { guildId, templateId, planHash: planHash(guildId, templateId, plan), verlooptOm });

  return { token, verlooptOm: new Date(verlooptOm).toISOString() };
}

export class ConfirmatieFout extends Error {}

/**
 * Verbruikt het token — geldig of niet. Bij een geldig token gebeurt er
 * verder niets (geen fout); bij een ongeldig token staat in de fout precies
 * waarom, zonder daarbij te verklappen wat er in een ándere server of
 * template staat.
 */
export function verbruikConfirmatie(token: string, guildId: string, templateId: string, plan: Plan): void {
  const gevonden = bewaard.get(token);
  bewaard.delete(token); // eenmalig: ook een falende poging verbruikt het token

  if (!gevonden) {
    throw new ConfirmatieFout('Onbekende of al gebruikte confirmation_token. Vraag een nieuwe preview op.');
  }
  if (Date.now() > gevonden.verlooptOm) {
    throw new ConfirmatieFout('Deze confirmation_token is verlopen. Vraag een nieuwe preview op.');
  }
  if (gevonden.guildId !== guildId) {
    throw new ConfirmatieFout('Deze confirmation_token hoort bij een andere server.');
  }
  if (gevonden.templateId !== templateId) {
    throw new ConfirmatieFout('Deze confirmation_token hoort bij een andere template.');
  }
  if (gevonden.planHash !== planHash(guildId, templateId, plan)) {
    throw new ConfirmatieFout(
      'Het plan is niet meer hetzelfde als toen deze confirmation_token werd gegeven — de template of de ' +
        'server is intussen veranderd. Vraag een nieuwe preview op en bevestig die.',
    );
  }
}

function ruimVerlopenOp(): void {
  const nu = Date.now();
  for (const [token, confirmatie] of bewaard) {
    if (confirmatie.verlooptOm < nu) bewaard.delete(token);
  }
}

/** Alleen voor tests: begint weer bij niets. */
export function wisAlleConfirmatiesVoorTests(): void {
  bewaard.clear();
}
