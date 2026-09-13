import { appendFile } from 'node:fs/promises';

/**
 * Een korte samenvatting boven aan de GitHub-run.
 *
 * Het log lezen op een telefoon is geen pretje: honderd regels, en de ene regel
 * die ertoe doet staat ergens in het midden. GitHub toont wat hier naartoe gaat
 * bovenaan de run, zonder scrollen. Buiten Actions doet dit niets.
 */

export interface Samenvatting {
  kop: string;
  regels: string[];
  /** Punten die aandacht vragen; komen onder een eigen kopje te staan. */
  letop?: string[];
}

export function maakSamenvatting({ kop, regels, letop = [] }: Samenvatting): string {
  const uit = [`## ${kop}`, '', ...regels.map((regel) => `- ${regel}`)];

  if (letop.length > 0) {
    uit.push('', '### Let op', '', ...letop.map((regel) => `- ${regel}`));
  }

  return `${uit.join('\n')}\n`;
}

export async function schrijfSamenvatting(samenvatting: Samenvatting): Promise<void> {
  const doel = process.env.GITHUB_STEP_SUMMARY;
  if (!doel) return;

  // Lukt het schrijven niet, dan is dat geen reden om de hele run te laten
  // klappen: het werk is dan al gedaan.
  await appendFile(doel, maakSamenvatting(samenvatting), 'utf8').catch(() => undefined);
}
