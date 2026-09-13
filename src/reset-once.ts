import { Client, Events, GatewayIntentBits } from 'discord.js';
import { config } from './config.js';
import { backupGuild } from './backup.js';
import { missingPermissions } from './botPermissions.js';
import { ALLES, applyReset, countReset, describeReset, describeScope, planReset, type ResetScope } from './reset.js';
import { snapshotGuildFresh } from './snapshot.js';
import { logger } from './util/logger.js';
import { login } from './util/start.js';
import { annoteer, schrijfSamenvatting } from './util/samenvatting.js';

/**
 * Een server leeghalen vanaf de commandoregel. Standaard laat hij alleen zien wat
 * hij zou weggooien; pas met --bevestig "<servernaam>" gebeurt het echt, en dan
 * alleen als die naam exact klopt. Er gaat altijd eerst een momentopname naar
 * schijf — die brengt de structuur terug, geen berichten.
 */
interface Options {
  guildId: string;
  confirm: string | null;
  backup: boolean;
  scope: ResetScope;
}

function parseArguments(argv: string[]): Options | null {
  const options: Options = {
    guildId: '',
    confirm: null,
    backup: true,
    scope: { ...ALLES, behoudRollen: [] },
  };
  const behoudRollen: string[] = [];

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--guild') options.guildId = argv[++index] ?? '';
    else if (argument === '--bevestig' || argument === '--confirm') options.confirm = argv[++index] ?? '';
    else if (argument === '--geen-backup') options.backup = false;
    else if (argument === '--behoud-rollen') options.scope.roles = false;
    else if (argument === '--behoud-kanalen') options.scope.channels = false;
    else if (argument === '--behoud-automod') options.scope.automod = false;
    else if (argument === '--behoud-rol') {
      // Mag meerdere keren, en een komma-lijstje mag ook: --behoud-rol "Admin,Mod"
      for (const naam of (argv[++index] ?? '').split(',')) {
        if (naam.trim() !== '') behoudRollen.push(naam.trim());
      }
    }
  }

  options.scope.behoudRollen = behoudRollen;
  return options.guildId ? options : null;
}

const options = parseArguments(process.argv.slice(2));

if (!options) {
  console.error(
    [
      '',
      '  Gebruik: npm run reset -- --guild <server-id> [--bevestig "<servernaam>"]',
      '',
      '    --guild            id van de server',
      '    --bevestig         de servernaam, exact overgetypt; zonder dit blijft het een preview',
      '    --geen-backup      sla de momentopname vooraf over (niet aangeraden)',
      '    --behoud-rollen    laat alle rollen staan',
      '    --behoud-rol NAAM  laat deze ene rol staan; mag vaker, of als "A,B"',
      '    --behoud-kanalen   laat de kanalen staan',
      '    --behoud-automod   laat de automod-regels staan',
      '',
      '  Standaard verdwijnen alle kanalen, alle rollen die de bot mag beheren en de',
      '  AutoMod-regels. Leden, berichten in bewaarde kanalen en emoji\'s blijven.',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async (ready) => {
  try {
    const guild = ready.guilds.cache.get(options.guildId);
    if (!guild) {
      logger.error(`De bot zit niet in server ${options.guildId}.`);
      process.exitCode = 1;
      return;
    }

    const me = await guild.members.fetchMe();
    const snapshot = await snapshotGuildFresh(guild);
    const plan = planReset(snapshot, me.roles.highest.position, options.scope);

    logger.info(`Server: ${guild.name} (${guild.id})`);
    logger.info(describeScope(options.scope));
    logger.info(
      `Weg: ${plan.channels.length} kanalen, ${plan.roles.length} rollen, ${plan.automod.length} automod-regels.`,
    );
    for (const line of describeReset(plan)) console.log(`   ${line}`);

    if (options.confirm === null) {
      logger.info('');
      logger.info('Preview — er is niets verwijderd.');
      logger.info(`Echt leeghalen? Voeg toe: --bevestig "${guild.name}"`);
      return;
    }

    if (options.confirm.trim() !== guild.name) {
      logger.error(`De bevestiging klopt niet. Typ de servernaam exact over: "${guild.name}"`);
      process.exitCode = 1;
      return;
    }

    const missing = missingPermissions(me);
    if (missing.length > 0) {
      logger.error(`De bot mist rechten in deze server: ${missing.join(', ')}`);
      process.exitCode = 1;
      return;
    }

    if (countReset(plan) === 0) {
      logger.info('Er valt niets te verwijderen.');
      return;
    }

    if (options.backup) {
      const file = await backupGuild(guild, config.backupsDir, 'voor-leeghalen');
      logger.info(`Momentopname bewaard: ${file}`);
    }

    const result = await applyReset(guild, plan, `Leeghalen door ${ready.user.tag}`);
    logger.info(`Klaar: ${result.deleted} verwijderd, ${result.failed} mislukt.`);

    const letop = [...result.errors, ...(result.hint ? [result.hint] : [])];

    await schrijfSamenvatting({
      kop: `${guild.name} leeggehaald`,
      regels: [`${result.deleted} verwijderd, ${result.failed} mislukt`, describeScope(options.scope)],
      letop,
    });

    annoteer('notice', `${guild.name}: ${result.deleted} verwijderd, ${result.failed} mislukt.`);
    for (const regel of letop) annoteer(result.failed > 0 ? 'error' : 'warning', regel);
    for (const error of result.errors) logger.warn(error);
    if (result.hint) {
      logger.error('');
      logger.error(result.hint);
    }
    if (result.failed > 0) process.exitCode = 1;
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    await client.destroy();
  }
});

await login(client, config.token);
