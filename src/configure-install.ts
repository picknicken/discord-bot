import { PermissionsBitField, REST, Routes } from 'discord.js';
import { config } from './config.js';
import { buildInviteUrl, INVITE_PERMISSIONS, INVITE_SCOPES } from './botPermissions.js';
import { logger } from './util/logger.js';

/**
 * Zet de default install-settings van de applicatie. Vanaf dat moment vraagt elke
 * "Add App"-knop (App Directory, profiel van de bot) automatisch om precies deze
 * rechten — je hoeft dan geen handgemaakte invite-link meer rond te sturen.
 */
const rest = new REST().setToken(config.token);

const application = (await rest.patch(Routes.currentApplication(), {
  body: {
    install_params: {
      scopes: [...INVITE_SCOPES],
      permissions: INVITE_PERMISSIONS.bitfield.toString(),
    },
  },
})) as { install_params?: { permissions?: string; scopes?: string[] } };

const confirmed = application.install_params?.permissions ?? '(onbekend)';

logger.info('Default install-settings bijgewerkt.');
logger.info(`  scopes:      ${application.install_params?.scopes?.join(' ') ?? '(onbekend)'}`);
logger.info(`  permissions: ${confirmed}`);
logger.info(`  rechten:     ${new PermissionsBitField(BigInt(confirmed)).toArray().join(', ')}`);
logger.info(`  invite-link: ${buildInviteUrl(config.clientId)}`);
