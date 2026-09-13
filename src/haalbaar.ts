import { PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { needsCommunity, type Plan, type PlanAction } from './planner.js';
import { toBitfield, toNames } from './permissions.js';
import type { Overwrite } from './types.js';

/**
 * Een template vragen wat de bot niet mag, en dan stoppen, levert een lege
 * server op. Een template half uitvoeren en niets zeggen levert een server op
 * waarvan je denkt dat hij klopt. Allebei niet goed.
 *
 * Dus: het plan wordt bijgesteld naar wat deze bot op deze server echt kan, en
 * elke bijstelling wordt genoemd. Geen verrassingen, en geen template die
 * blijft steken - deze of een toekomstige.
 *
 * De twee regels van Discord waar dit over gaat:
 *  - een bot deelt geen recht uit dat hij zelf niet heeft;
 *  - community-modus aanzetten vraagt Administrator.
 */

const ADMINISTRATOR = PermissionFlagsBits.Administrator;

/** Alle bits die er bestaan; met Administrator mag een bot alles uitdelen. */
const ALLE_BITS = Object.values(PermissionFlagsBits).reduce((alles, bit) => alles | bit, 0n);

/** Wat deze bot mag uitdelen. */
export function grantableBits(botPermissions: PermissionsBitField): bigint {
  return botPermissions.has(ADMINISTRATOR) ? ALLE_BITS : botPermissions.bitfield;
}

/**
 * Wat we veilig kunnen wegschrijven: wat de template wil waar het mag, en waar
 * het niet mag blijft staan wat er al stond. Zo zet een bot zonder Administrator
 * die permissie niet per ongeluk uit bij een rol die hem al heeft.
 */
export function veiligeBits(gewenst: bigint, bestaand: bigint, mag: bigint): bigint {
  return (gewenst & mag) | (bestaand & ~mag);
}

/** Namen van de bits die wegvallen, voor de melding. */
function weggelaten(gewenst: bigint, mag: bigint): string[] {
  return toNames(gewenst & ~mag);
}

function beperkOverwrites(
  overwrites: readonly Overwrite[],
  mag: bigint,
): { overwrites: Overwrite[]; weg: string[] } {
  const weg = new Set<string>();

  const overwrites2 = overwrites.map((overwrite) => {
    for (const naam of weggelaten(toBitfield(overwrite.allow), mag)) weg.add(naam);
    for (const naam of weggelaten(toBitfield(overwrite.deny), mag)) weg.add(naam);

    return {
      ...overwrite,
      allow: toNames(toBitfield(overwrite.allow) & mag),
      deny: toNames(toBitfield(overwrite.deny) & mag),
    };
  });

  return { overwrites: overwrites2, weg: [...weg] };
}

export interface HaalbaarPlan {
  plan: Plan;
  /** Wat er is bijgesteld, in gewone taal. Leeg als alles kon zoals bedoeld. */
  aanpassingen: string[];
}

/**
 * Stelt het plan bij naar wat deze bot kan. `alCommunity` zegt of de server al
 * een community-server is: dan hoeft community-modus niet meer aangezet te
 * worden en kunnen forum-, aankondigings- en stagekanalen gewoon.
 */
export function maakHaalbaar(
  plan: Plan,
  botPermissions: PermissionsBitField,
  opties: { alCommunity?: boolean } = {},
): HaalbaarPlan {
  const mag = grantableBits(botPermissions);
  const aanpassingen: string[] = [];

  const communityMogelijk = botPermissions.has(ADMINISTRATOR) || opties.alCommunity === true;
  const actions: PlanAction[] = [];
  let overgeslagenKanalen = 0;

  for (const action of plan.actions) {
    switch (action.kind) {
      case 'guild-community': {
        if (opties.alCommunity) break; // staat al aan; niets te doen
        if (!communityMogelijk) {
          aanpassingen.push(
            'community-modus overgeslagen: dat aanzetten vraagt Administrator, en die heeft de bot niet.',
          );
          break;
        }
        actions.push(action);
        break;
      }

      case 'create-channel': {
        if (!communityMogelijk && needsCommunity(action.channel.type)) {
          overgeslagenKanalen += 1;
          break;
        }
        const { overwrites, weg } = beperkOverwrites(action.channel.overwrites, mag);
        if (weg.length > 0) {
          aanpassingen.push(`kanaal ${action.channel.name}: ${weg.join(', ')} niet gezet (de bot heeft dat zelf niet).`);
        }
        actions.push({ ...action, channel: { ...action.channel, overwrites } });
        break;
      }

      case 'update-channel': {
        const { overwrites, weg } = beperkOverwrites(action.channel.overwrites, mag);
        if (weg.length > 0) {
          aanpassingen.push(`kanaal ${action.channel.name}: ${weg.join(', ')} niet gezet (de bot heeft dat zelf niet).`);
        }
        actions.push({ ...action, channel: { ...action.channel, overwrites } });
        break;
      }

      case 'create-category':
      case 'update-category': {
        const { overwrites, weg } = beperkOverwrites(action.category.overwrites, mag);
        if (weg.length > 0) {
          aanpassingen.push(
            `categorie ${action.category.name}: ${weg.join(', ')} niet gezet (de bot heeft dat zelf niet).`,
          );
        }
        actions.push({ ...action, category: { ...action.category, overwrites } });
        break;
      }

      case 'create-role':
      case 'update-role': {
        const gewenst = toBitfield(action.role.permissions);
        const weg = weggelaten(gewenst, mag);
        if (weg.length > 0) {
          aanpassingen.push(`rol @${action.role.name}: ${weg.join(', ')} niet gezet (de bot heeft dat zelf niet).`);
        }
        actions.push({ ...action, role: { ...action.role, permissions: toNames(gewenst & mag) } });
        break;
      }

      case 'onboarding': {
        if (!communityMogelijk) {
          aanpassingen.push('onboarding overgeslagen: dat werkt alleen op een community-server.');
          break;
        }
        actions.push(action);
        break;
      }

      default:
        actions.push(action);
    }
  }

  if (overgeslagenKanalen > 0) {
    aanpassingen.push(
      `${overgeslagenKanalen} forum-, aankondigings- of stagekanalen overgeslagen: die bestaan alleen op een community-server.`,
    );
  }

  if (aanpassingen.length > 0) {
    aanpassingen.push(
      'Geef de bot Administrator en draai dit opnieuw, dan worden deze dingen alsnog gezet.',
    );
  }

  return { plan: { ...plan, actions }, aanpassingen };
}
