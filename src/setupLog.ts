import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Wie heeft wanneer welke template op welke server gezet, en ging dat goed?
 *
 * Een template kan door drie deuren naar binnen: het dashboard, de
 * commandoregel en een GitHub Action. Zonder logboek weet niemand achteraf
 * welke van de drie het was, of wat er die keer misging. Eén regel per uitrol,
 * als JSON, zodat je hem ook met de hand kunt lezen.
 */

export interface SetupRun {
  at: string;
  guildId: string;
  guildName: string;
  template: string;
  /** Wie het startte: een Discord-naam, "commandoregel", of een GitHub-account. */
  door: string;
  mode: 'preview' | 'apply';
  onderdelen: string[];
  applied: number;
  failed: number;
  /** Pad naar de momentopname van vlak ervoor, als die er is. */
  backup: string | null;
  /** Wat er is overgeslagen of misging, kort. */
  notes: string[];
}

const BESTAND = 'setups.jsonl';

export async function logSetup(dir: string, run: SetupRun): Promise<void> {
  try {
    await mkdir(dir, { recursive: true });
    await appendFile(path.join(dir, BESTAND), `${JSON.stringify(run)}\n`, 'utf8');
  } catch {
    // Een logboek dat niet weggeschreven kan worden is vervelend, maar geen
    // reden om een geslaagde uitrol alsnog te laten klappen.
  }
}

/** De laatste uitrollen, nieuwste eerst. Regels die stuk zijn worden overgeslagen. */
export async function readSetups(dir: string, limit = 50): Promise<SetupRun[]> {
  let inhoud: string;
  try {
    inhoud = await readFile(path.join(dir, BESTAND), 'utf8');
  } catch {
    return [];
  }

  const runs: SetupRun[] = [];
  for (const regel of inhoud.split('\n')) {
    if (regel.trim() === '') continue;
    try {
      runs.push(JSON.parse(regel) as SetupRun);
    } catch {
      continue;
    }
  }

  return runs.reverse().slice(0, limit);
}

/** Wie deze uitrol startte, als het niet uit het dashboard komt. */
export function wieDraait(): string {
  const actor = process.env.GITHUB_ACTOR;
  if (actor) return `${actor} (GitHub Action)`;
  return 'commandoregel';
}

/** Eén regel over een uitrol, voor een lijst. */
export function beschrijfRun(run: SetupRun): string {
  const uitkomst =
    run.mode === 'preview'
      ? 'preview'
      : run.failed > 0
        ? `${run.applied} gelukt, ${run.failed} mislukt`
        : `${run.applied} gelukt`;

  return `${run.template} op ${run.guildName} — ${uitkomst} — door ${run.door}`;
}
