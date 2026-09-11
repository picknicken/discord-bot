import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PermissionsBitField, REST, Routes } from 'discord.js';
import { config } from './config.js';
import { buildInviteUrl, INVITE_PERMISSIONS, INVITE_SCOPES } from './botPermissions.js';
import { logger } from './util/logger.js';

/**
 * Zet de applicatie-instellingen die bij elke join meekomen:
 *
 *  1. de default install-settings, zodat elke "Add App"-knop automatisch om precies
 *     de juiste rechten vraagt;
 *  2. de gebruikersnaam en avatar van de bot, zoals die in de ledenlijst verschijnen;
 *  3. het applicatie-icoon, dat op het autorisatiescherm staat.
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
await syncAvatar();

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

/**
 * Avatar en applicatie-icoon. Discord telt dit mee in de rate limit op het
 * bijwerken van het account, dus een ongewijzigde afbeelding wordt overgeslagen:
 * de hash van het bestand ligt naast de afbeelding opgeslagen.
 */
async function syncAvatar(): Promise<void> {
  let image: Buffer;
  try {
    image = await readFile(config.avatarFile);
  } catch {
    logger.info(`Geen avatar gevonden op ${config.avatarFile} — overgeslagen.`);
    return;
  }

  const hash = createHash('sha256').update(image).digest('hex');
  const marker = path.join(path.dirname(config.avatarFile), '.avatar-hash');
  const previous = await readFile(marker, 'utf8').catch(() => '');

  if (previous.trim() === hash) {
    logger.info('Avatar is al ingesteld op deze afbeelding.');
    return;
  }

  const dataUri = `data:${mediaType(config.avatarFile)};base64,${image.toString('base64')}`;

  try {
    await rest.patch(Routes.user(), { body: { avatar: dataUri } });
    await rest.patch(Routes.currentApplication(), { body: { icon: dataUri } });
    await writeFile(marker, `${hash}\n`, 'utf8');
    logger.info(`Avatar en applicatie-icoon bijgewerkt (${Math.round(image.length / 1024)} KB).`);
  } catch (error) {
    logger.warn(`Avatar niet bijgewerkt: ${describe(error)}`);
  }
}

function mediaType(file: string): string {
  const extension = path.extname(file).toLowerCase();
  if (extension === '.gif') return 'image/gif';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  return 'image/png';
}

function describe(error: unknown): string {
  if (error && typeof error === 'object' && 'rawError' in error) {
    return JSON.stringify((error as { rawError: unknown }).rawError);
  }
  return error instanceof Error ? error.message : String(error);
}
