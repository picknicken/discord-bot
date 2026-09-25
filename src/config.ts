import 'dotenv/config';
import { leesToegestaneServers } from './toegestaan.js';

/**
 * Een waarde uit de omgeving, zonder de rommel eromheen.
 *
 * Plakken gaat vaak mis: een spatie ervoor, een enter erachter, aanhalingstekens
 * eromheen omdat het op een instelling leek. Die tekens zie je nergens terug —
 * niet in het Railway-scherm, niet in je .env — maar ze gaan wel mee. Een enter
 * achter DASHBOARD_URL levert een inlogadres met een regeleinde erin op, en dan
 * zegt Discord alleen "Ongeldige OAuth2 redirect_uri" terwijl je adres er goed
 * uitziet. Dus: weghalen, hier, één keer.
 */
function schoon(waarde: string | undefined): string {
  return (waarde ?? '').trim().replace(/^["']|["']$/g, '').trim();
}

/** Een URL heeft nooit witruimte in zich; ook niet midden in een plakactie. */
function schoneUrl(waarde: string | undefined): string {
  return schoon(waarde).replace(/\s+/g, '').replace(/\/$/, '');
}

function required(name: string): string {
  const value = schoon(process.env[name]);
  if (value) return value;

  // Een stacktrace helpt hier niemand; dit is gewoon een ontbrekende instelling.
  console.error(
    `\n  Ontbrekende instelling: ${name}\n\n` +
      '  Kopieer .env.example naar .env en vul hem in:\n' +
      '    cp .env.example .env\n\n' +
      '  Even rondkijken zonder Discord-account? Draai `npm run demo`.\n',
  );
  process.exit(1);
}

/**
 * Een aangekoppeld volume. Railway zet dit pad zelf in de omgeving zodra je er
 * een volume aan hangt; alles wat daarbuiten wordt weggeschreven is bij de
 * volgende deploy weg. Dus: staat er een volume, dan is dat de standaardplek
 * voor templates, back-ups en de geschiedenis.
 */
const volume = schoon(process.env.RAILWAY_VOLUME_MOUNT_PATH) || schoon(process.env.DATA_DIR);
const opVolume = (naam: string): string | null => (volume ? `${volume.replace(/\/$/, '')}/${naam}` : null);

export const config = {
  token: required('DISCORD_TOKEN'),
  clientId: required('DISCORD_CLIENT_ID'),
  devGuildId: schoon(process.env.DISCORD_DEV_GUILD_ID) || undefined,
  templatesDir: schoon(process.env.TEMPLATES_DIR) || opVolume('templates') || './templates',
  /** Weergavenaam van de bot. Wordt toegepast door `npm run configure-install`. */
  botName: schoon(process.env.BOT_NAME) || 'Setup Bot',
  /** Demo-modus: geen echte bot, dus toepassen wordt geweigerd in plaats van geprobeerd. */
  demo: process.env.DEMO === '1',
  /** Afbeelding voor de botavatar en het applicatie-icoon. */
  avatarFile: schoon(process.env.BOT_AVATAR) || './assets/logo.png',
  /**
   * Poort van het dashboard. PORT is wat hostingpartijen zoals Railway zelf
   * invullen; die wint, want daar luistert hun router op.
   */
  dashboardPort: Number(process.env.PORT || process.env.DASHBOARD_PORT || 4000),
  /** Adres om op te luisteren. Alles behalve localhost vereist inloggen. */
  dashboardHost: schoon(process.env.DASHBOARD_HOST) || '127.0.0.1',
  /** Client secret uit het Developer Portal; zonder dit is inloggen uitgeschakeld. */
  clientSecret: schoon(process.env.DISCORD_CLIENT_SECRET),
  /** Discord-gebruikers-ids die binnen mogen. Leeg = alleen de eigenaar van de applicatie. */
  dashboardOwners: (process.env.DASHBOARD_OWNERS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean),
  /** Basis-URL waarop het dashboard bereikbaar is; moet in het portal staan als redirect. */
  dashboardUrl: schoneUrl(process.env.DASHBOARD_URL) || `http://127.0.0.1:${process.env.DASHBOARD_PORT ?? 4000}`,
  /** Momentopnames van servers, weggeschreven voor elk toepassen. */
  backupsDir: schoon(process.env.BACKUPS_DIR) || opVolume('backups') || './backups',
  /** Vorige versies van templates, bijgehouden door het dashboard. */
  historyDir: schoon(process.env.HISTORY_DIR) || opVolume('history') || './history',
  /** Clankoppelingen en rangrollen, per server één bestand. */
  clanDir: schoon(process.env.CLAN_DIR) || opVolume('clan') || './clan',
  /** Eigen commando's (`/tag`), per server één bestand. */
  tagsDir: schoon(process.env.TAGS_DIR) || opVolume('tags') || './tags',
  /** Hoe vaak de clanrangen vanzelf worden bijgewerkt, in minuten. 0 = nooit. */
  clanSyncMinuten: Math.max(0, Number(schoon(process.env.CLAN_SYNC_MINUTEN) || 60)),
  /** Hoe vaak de bot zelf kijkt of een server is afgedwaald. 0 is uit. */
  driftCheckUren: Math.max(0, Number(schoon(process.env.DRIFT_CHECK_UREN) || 24)),
  /**
   * Meldt de bot zijn slash-commando's zelf aan bij het opstarten?
   *
   * Aan, want anders sta je na elke wijziging een workflow te starten en merk je
   * pas in Discord dat je het vergeten bent. Uit te zetten met COMMANDS_AANMELDEN=uit
   * voor wie dat liever met de hand doet.
   */
  commandosAanmelden: (schoon(process.env.COMMANDS_AANMELDEN) || 'aan').toLowerCase() !== 'uit',
  /** Hoe vaak er vanzelf een momentopname wordt gemaakt. 0 is uit. */
  backupUren: Math.max(0, Number(schoon(process.env.BACKUP_UREN) || 168)),
  /** Hoeveel automatische momentopnames er per server bewaard blijven. */
  backupBewaar: Math.max(1, Number(schoon(process.env.BACKUP_BEWAAR) || 8)),
  /**
   * Server-ids waar deze installatie iets mag. Leeg = geen beperking.
   * Vooral voor GitHub Actions: daar is het server-id een invoerveld.
   */
  toegestaneServers: leesToegestaneServers(process.env.GUILD_IDS),

  // --- MCP (Claude als externe koppeling) -----------------------------------
  /**
   * Staat MCP uberhaupt aan? Standaard uit: een bot die draait mag niet in één
   * keer ook een externe koppeling naar Claude openzetten zonder dat iemand
   * dat expliciet aanzet.
   */
  mcpEnabled: (schoon(process.env.MCP_ENABLED) || 'false').toLowerCase() === 'true',
  /**
   * Welke servers Claude via MCP mag zien en aanraken. Met opzet een eigen
   * instelling, los van GUILD_IDS: daar betekent leeg "geen beperking", en dat
   * zou hier betekenen dat een vergeten configuratie in één klap elke server
   * voor Claude openzet. Hier betekent leeg dus het omgekeerde: geen enkele
   * server, tot er expliciet één is ingevuld. Dezelfde komma-gescheiden
   * schrijfwijze als GUILD_IDS, in Railway of .env aan te passen zonder dat er
   * ergens in code gezocht hoeft te worden.
   */
  mcpAllowedGuilds: leesToegestaneServers(process.env.MCP_ALLOWED_GUILD_IDS),
  /**
   * Het geheim dat een MCP-verzoek moet meesturen (`Authorization: Bearer
   * <dit>`). Zonder dit geheim - ook als MCP_ENABLED aanstaat - blijft de
   * /mcp-ingang dicht: een endpoint dat naar buiten toe openstaat zonder eigen
   * wachtwoord is geen instelling die per ongeluk goed hoort te gaan.
   */
  mcpAuthToken: schoon(process.env.MCP_AUTH_TOKEN),
};
