import { Client, Events, GatewayIntentBits } from 'discord.js';
import { config } from './config.js';
import { applyPlan } from './applier.js';
import { buildInviteUrl, missingPermissions } from './botPermissions.js';
import { explainShortfalls, planShortfalls } from './preflight.js';
import { maakHaalbaar } from './haalbaar.js';
import { schrijfSamenvatting } from './util/samenvatting.js';
import {
  beschrijfOnderdelen,
  filterPlan,
  leesOnderdelen,
  ONDERDELEN,
  UITLEG,
  type Onderdeel,
} from './onderdelen.js';
import { describeActions, planSetup, summarizePlan } from './planner.js';
import { snapshotGuildFresh } from './snapshot.js';
import { loadTemplate } from './templates.js';
import { logger } from './util/logger.js';
import { login } from './util/start.js';

/**
 * Eén template, één server, één keer — zonder dashboard. Bedoeld voor plekken
 * waar geen browser is: een server via SSH, of een GitHub Action die je vanaf je
 * telefoon start. Standaard laat hij alleen zien wat hij zou doen; wijzigen
 * gebeurt pas met --apply.
 */
interface Options {
  guildId: string;
  template: string;
  apply: boolean;
  prune: boolean;
  /** Stoppen zodra de bot iets niet mag, in plaats van doen wat wel kan. */
  stopBijTekort: boolean;
  /** Welke delen van de template meedoen. */
  onderdelen: Onderdeel[];
}

function parseArguments(argv: string[]): Options | null {
  const options: Options = {
    guildId: '',
    template: '',
    apply: false,
    prune: false,
    stopBijTekort: false,
    onderdelen: [...ONDERDELEN],
  };
  let onderdelenInvoer: string | undefined;

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--guild') options.guildId = argv[++index] ?? '';
    else if (argument === '--template') options.template = argv[++index] ?? '';
    else if (argument === '--apply') options.apply = true;
    else if (argument === '--prune') options.prune = true;
    else if (argument === '--stop-bij-tekort') options.stopBijTekort = true;
    else if (argument === '--onderdelen' || argument === '--alleen') onderdelenInvoer = argv[++index] ?? '';
  }

  const gekozen = leesOnderdelen(onderdelenInvoer);
  if (!gekozen) {
    logger.error(`Onbekend onderdeel. Kies uit: ${ONDERDELEN.join(', ')} — of "alles".`);
    return null;
  }
  options.onderdelen = gekozen;

  return options.guildId && options.template ? options : null;
}

const options = parseArguments(process.argv.slice(2));

if (!options) {
  console.error(
    [
      '',
      '  Gebruik: npm run apply -- --guild <server-id> --template <naam> [--apply] [--prune]',
      '',
      '    --guild     id van de server (Discord: rechtermuisknop op de server -> ID kopieren)',
      '    --template  bestandsnaam zonder .json uit de templates-map',
      '    --apply     voer het plan echt uit; zonder dit laat hij alleen zien wat hij zou doen',
      '    --prune     verwijder kanalen die niet in de template staan (alleen samen met --apply)',
      '    --stop-bij-tekort  stop zodra de bot iets niet mag; standaard doet hij wat wel kan',
      '    --alleen    welke delen meedoen, met komma\'s; standaard alles',
      '',
      '  Onderdelen:',
      ...ONDERDELEN.map((onderdeel) => `    ${onderdeel.padEnd(13)} ${UITLEG[onderdeel]}`),
      '',
      '  Bijvoorbeeld: --alleen rollen        (alleen de rollen bijwerken)',
      '                --alleen kanalen,categorieen',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

if (options.prune && !options.apply) {
  logger.warn('--prune zonder --apply doet niets; dit blijft een preview.');
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async (ready) => {
  try {
    const guild = ready.guilds.cache.get(options.guildId);

    if (!guild) {
      logger.error(
        `De bot zit niet in server ${options.guildId}. Nodig hem daar eerst uit; ` +
          `"npm run invite" print de link. Hij zit nu in: ${
            ready.guilds.cache.map((candidate) => `${candidate.name} (${candidate.id})`).join(', ') || 'geen enkele server'
          }`,
      );
      process.exitCode = 1;
      return;
    }

    const template = await loadTemplate(config.templatesDir, options.template);
    const plan = filterPlan(
      planSetup(await snapshotGuildFresh(guild), template, {
        prune: options.prune && options.apply,
        update: true,
      }),
      options.onderdelen,
    );

    logger.info(`Server: ${guild.name} (${guild.id})`);
    logger.info(beschrijfOnderdelen(options.onderdelen));
    logger.info(`Template: ${template.name} — ${summarizePlan(plan)}`);
    for (const line of describeActions(plan, 200)) console.log(`   ${line}`);
    for (const warning of plan.warnings) logger.warn(warning);

    // De rechtencontrole hoort bij het plan, niet bij het uitvoeren: juist in de
    // preview wil je weten wat er niet gaat lukken.
    const me = await guild.members.fetchMe();
    const tekort = planShortfalls(plan, me.permissions);

    // Standaard doet hij wat wel kan, en zegt hij wat er is bijgesteld. Stoppen
    // bij het eerste dat niet mag levert een lege server op, en dat helpt niemand.
    const haalbaar = maakHaalbaar(plan, me.permissions, { alCommunity: guild.features.includes('COMMUNITY') });

    if (tekort.length > 0) {
      for (const line of explainShortfalls(tekort, config.clientId ? buildInviteUrl(config.clientId) : null)) {
        logger.warn(line);
      }
    }

    if (haalbaar.aanpassingen.length > 0 && !options.stopBijTekort) {
      logger.warn('');
      logger.warn('Bijgesteld naar wat deze bot kan:');
      for (const regel of haalbaar.aanpassingen) logger.warn(`  ${regel}`);
    }

    if (!options.apply) {
      logger.info('Preview — er is niets gewijzigd. Voeg --apply toe om dit uit te voeren.');
      return;
    }

    const missing = missingPermissions(me);
    if (missing.length > 0) {
      logger.error(`De bot mist rechten in deze server: ${missing.join(', ')}`);
      logger.error(`Uitnodigen met de juiste rechten: ${buildInviteUrl(config.clientId)}`);
      process.exitCode = 1;
      return;
    }

    if (tekort.length > 0 && options.stopBijTekort) {
      logger.error('');
      logger.error('Gestopt voordat er iets gewijzigd is (--stop-bij-tekort).');
      process.exitCode = 1;
      return;
    }

    const uitvoeren = haalbaar.plan;
    if (uitvoeren.actions.length === 0) {
      logger.info('Niets te doen — de server komt al overeen met de template.');
      return;
    }

    const result = await applyPlan(guild, template, uitvoeren);
    logger.info(`Klaar: ${result.applied} acties gelukt, ${result.failed} mislukt.`);
    for (const error of result.errors) logger.warn(error);

    if (haalbaar.aanpassingen.length > 0) {
      logger.warn('');
      logger.warn('Niet alles kon zoals de template het vraagt:');
      for (const regel of haalbaar.aanpassingen) logger.warn(`  ${regel}`);
    }

    await schrijfSamenvatting({
      kop: `${template.name} op ${guild.name}`,
      regels: [
        `${result.applied} acties gelukt, ${result.failed} mislukt`,
        beschrijfOnderdelen(options.onderdelen),
      ],
      letop: [...result.errors, ...haalbaar.aanpassingen],
    });

    if (result.failed > 0) process.exitCode = 1;
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    await client.destroy();
  }
});

await login(client, config.token);
