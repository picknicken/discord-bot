import { PermissionsBitField, REST, Routes } from 'discord.js';
import { config } from './config.js';
import { buildInviteUrl, INVITE_PERMISSIONS, INVITE_SCOPES } from './botPermissions.js';
import { logger } from './util/logger.js';

/**
 * Zet de applicatie-instellingen die bij elke join meekomen:
 *
 *  1. de default install-settings, zodat elke "Add App"-knop automatisch om precies
 *     de juiste rechten vraagt;
 *  2. de gebruikersnaam van de bot, zoals die in de ledenlijst verschijnt.
 *
 * De naam van de *applicatie* (de titel op het autorisatiescherm en in de App
 * Directory) kan alleen in het Developer Portal gewijzigd worden — daar is geen
 * API voor. Dit script zegt het er expliciet bij.
 */
const rest = new REST().setToken(config.token);

const application = (await rest.patch(Routes.currentApplication(), {
  body: {
    install_params: {
      scopes: [...INVITE_SCOPES],
      permissions: INVITE_PERMISSIONS.bitfield.toString(),
    },
  },
})) as { name?: string; install_params?: { permissions?: string; scopes?: string[] } };

const permissions = application.install_params?.permissions ?? '(onbekend)';

logger.info('Default install-settings bijgewerkt.');
logger.info(`  scopes:      ${application.install_params?.scopes?.join(' ') ?? '(onbekend)'}`);
logger.info(`  permissions: ${permissions}`);
logger.info(`  rechten:     ${new PermissionsBitField(BigInt(permissions)).toArray().join(', ')}`);

await syncUsername();

logger.info(`  invite-link: ${buildInviteUrl(config.clientId)}`);

if (application.name && application.name !== config.botName) {
  logger.warn(
    `De applicatie heet nog "${application.name}". Die naam staat op het autorisatiescherm ` +
      'en is alleen te wijzigen in het Developer Portal (General Information → Name).',
  );
}

async function syncUsername(): Promise<void> {
  const current = (await rest.get(Routes.user())) as { username?: string };

  if (current.username === config.botName) {
    logger.info(`Gebruikersnaam staat al op "${config.botName}".`);
    return;
  }

  try {
    const updated = (await rest.patch(Routes.user(), { body: { username: config.botName } })) as {
      username?: string;
    };
    logger.info(`Gebruikersnaam gewijzigd: "${current.username}" → "${updated.username}"`);
  } catch (error) {
    // Discord weigert onder andere namen met "discord" of "clyde" erin, en staat
    // maar twee naamswijzigingen per uur toe. Beide gevallen zijn het melden waard
    // in plaats van de hele run te laten klappen — de install-settings staan al goed.
    logger.warn(`Gebruikersnaam niet gewijzigd naar "${config.botName}": ${describe(error)}`);
    logger.warn('  Zet hem anders handmatig in het Developer Portal onder Bot → Username.');
  }
}

function describe(error: unknown): string {
  if (error && typeof error === 'object' && 'rawError' in error) {
    return JSON.stringify((error as { rawError: unknown }).rawError);
  }
  return error instanceof Error ? error.message : String(error);
}
