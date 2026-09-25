/**
 * Twee talen: Nederlands en Engels.
 *
 * De bot praat met leden, en die spreken lang niet allemaal Nederlands. Een
 * bevriende server met Engelse leden krijgt "Koppel je OSRS-naam" te zien en doet
 * er niets mee - niet omdat ze niet willen, maar omdat er niet staat wat het is.
 *
 * Discord weet al in welke taal iemand zit. Bij een klik of een commando is dat
 * de taal van die persoon zelf; bij een bericht dat in een kanaal blijft staan is
 * het de taal van de server, want dat leest iedereen mee. Meer dan die twee
 * bronnen hebben we niet nodig.
 *
 * Alles wat niet Nederlands is krijgt Engels. Dat is eerlijker dan Nederlands als
 * standaard: wie Frans of Duits in Discord heeft staan begrijpt het Engels wel,
 * en het Nederlands vrijwel zeker niet.
 */

export type Taal = 'nl' | 'en';

/** De taal van een Discord-locale, zoals "nl", "en-US" of "de". */
export function kiesTaal(locale: string | null | undefined): Taal {
  return typeof locale === 'string' && locale.toLowerCase().startsWith('nl') ? 'nl' : 'en';
}

const TEKSTEN = {
  // --- koppelen --------------------------------------------------------------
  'naam.ongeldig': {
    nl: '"{rsn}" kan geen OSRS-naam zijn: maximaal 12 tekens, alleen letters, cijfers, spaties en streepjes.',
    en: '"{rsn}" cannot be an OSRS name: 12 characters at most, and only letters, numbers, spaces and hyphens.',
  },
  'naam.bezet': {
    nl: '"{rsn}" staat al gekoppeld aan <@{wie}>. Klopt dat niet? Vraag een beheerder om het recht te zetten.',
    en: '"{rsn}" is already linked to <@{wie}>. Not right? Ask an admin to sort it out.',
  },
  'koppel.geenclan': {
    nl: 'Genoteerd: **{rsn}**. Er is voor deze server nog geen clan gekozen, dus er is nog geen rol aan te geven.',
    en: 'Noted: **{rsn}**. No clan has been chosen for this server yet, so there is no role to hand out.',
  },
  'koppel.womstil': {
    nl: 'Genoteerd, maar WiseOldMan antwoordde niet: {fout}',
    en: 'Noted, but WiseOldMan did not answer: {fout}',
  },
  'koppel.mislukt': {
    nl: 'Er ging iets mis bij het koppelen. Probeer het zo nog eens.',
    en: 'Something went wrong while linking. Please try again in a moment.',
  },
  'staat.in': { nl: '**{rsn}** staat in {plekken}.', en: '**{rsn}** is in {plekken}.' },
  'staat.plek': { nl: '**{clan}** als **{rang}**', en: '**{clan}** as **{rang}**' },
  'staat.en': { nl: ' en ', en: ' and ' },
  'rol.klopte': { nl: 'Je rol klopte al.', en: 'Your role was already correct.' },
  'rol.geenrol': {
    nl: 'Aan deze clan hangt hier nog geen Discord-rol. Een beheerder koppelt die in het dashboard, onder Clan.',
    en: 'This clan has no Discord role attached here yet. An admin can set that in the dashboard, under Clan.',
  },
  'let.op': { nl: 'Let op: {fout}', en: 'Note: {fout}' },
  'aanpassen.mislukt': { nl: 'aanpassen mislukte', en: 'the change failed' },
  'buiten.een': { nl: '{clan}', en: '{clan}' },
  'buiten.meer': { nl: 'een van deze clans: {clans}', en: 'any of these clans: {clans}' },
  'buiten.elders': {
    nl: '**{rsn}** staat niet in {waar}, maar wel in {elders}. Die telt hier niet mee.{staart}',
    en: '**{rsn}** is not in {waar}, but is in {elders}. That one does not count here.{staart}',
  },
  'buiten.nergens': {
    nl:
      '**{rsn}** staat niet in {waar}. Klopt je naam precies? Is dat zo, dan staat hij nog niet in de ' +
      'ledenlijst op WiseOldMan — die wordt door de clan zelf bijgehouden.{staart}',
    en:
      '**{rsn}** is not in {waar}. Is your name spelled exactly right? If it is, you are not on the ' +
      'WiseOldMan member list yet — the clan keeps that list itself.{staart}',
  },
  'buiten.staart': {
    nl: ' Je naam blijft gekoppeld, dus zodra je lid wordt telt hij vanzelf mee.',
    en: ' Your name stays linked, so the moment you join it counts automatically.',
  },

  // --- de knop ---------------------------------------------------------------
  'knop.label': { nl: 'Koppel je OSRS-naam', en: 'Link your OSRS name' },
  'knop.titel': { nl: 'Koppel je OSRS-naam', en: 'Link your OSRS name' },
  'knop.titel.welkom': { nl: 'Welkom! Zit je in de clan?', en: 'Welcome! Are you in the clan?' },
  'knop.onzeclan': { nl: 'onze clan', en: 'our clan' },
  'knop.of': { nl: ' of ', en: ' or ' },
  'knop.uitleg': {
    nl:
      'Zit je in {clans}? Koppel dan je OSRS-naam, dan krijg je meteen de rol die bij je rang hoort.\n\n' +
      'Zit je er niet in? Koppel hem gerust — je krijgt er geen rol van, maar dan weten we wel wie je ' +
      'bent in het spel, en zodra je lid wordt telt hij vanzelf mee.',
    en:
      'Are you in {clans}? Link your OSRS name and you will get the role that matches your rank right away.\n\n' +
      'Not a member? Link it anyway — it will not give you a role, but then we know who you are in game, ' +
      'and the moment you join it counts automatically.',
  },
  'knop.voet': { nl: 'Alleen jij ziet het antwoord.', en: 'Only you will see the reply.' },
  'knop.verplicht.naam': { nl: 'Verplicht om verder te kunnen', en: 'Required to unlock the rest' },
  'knop.verplicht.tekst': {
    nl: 'Typ je naam ook gewoon hier in dit kanaal — dat werkt net zo goed als de knop. Zodra je naam ' +
      'gekoppeld is, zie je de rest van de server.',
    en: 'You can also just type your name here in this channel — that works just as well as the button. ' +
      'Once your name is linked, you will see the rest of the server.',
  },
  'venster.veld': { nl: 'Je naam in Old School RuneScape', en: 'Your Old School RuneScape name' },
  'venster.voorbeeld': { nl: 'bijvoorbeeld: Sparc Mac', en: 'for example: Sparc Mac' },

  // --- /clan -----------------------------------------------------------------
  'alleen.server': { nl: 'Dit werkt alleen in een server.', en: 'This only works inside a server.' },
  'cmd.alleen.server': {
    nl: 'Dit commando werkt alleen in een server.',
    en: 'This command only works inside a server.',
  },
  'server.niet.toegestaan': {
    nl: 'Deze server staat niet in de lijst met servers waar deze bot iets mag.',
    en: 'This server is not on the list of servers this bot is allowed to touch.',
  },
  'recht.rollen': {
    nl: 'Hier heb je het recht "Rollen beheren" voor nodig.',
    en: 'You need the "Manage Roles" permission for this.',
  },
  'cmd.onbekend': { nl: 'Onbekend subcommando.', en: 'Unknown subcommand.' },
  'mij.geenkoppeling': {
    nl: 'Je hebt nog geen OSRS-naam gekoppeld. Doe `/clan koppel rsn:jouwnaam`.',
    en: 'You have not linked an OSRS name yet. Use `/clan link rsn:yourname`.',
  },
  'clan.nietgekozen': {
    nl: 'Er is voor deze server nog geen clan gekozen.',
    en: 'No clan has been chosen for this server yet.',
  },
  'ontkoppel.niets': { nl: 'Er stond hier geen OSRS-naam van jou.', en: 'You had no OSRS name linked here.' },
  'ontkoppel.weg.rollen': {
    nl: 'Koppeling weg, en {aantal} clanrol(len) afgenomen.',
    en: 'Link removed, and {aantal} clan role(s) taken away.',
  },
  'ontkoppel.weg': { nl: 'Koppeling weg.', en: 'Link removed.' },
  'status.titel': { nl: 'Clanrangen', en: 'Clan ranks' },
  'status.clans': { nl: 'Clans die hier meetellen', en: 'Clans that count here' },
  'status.nogeen': { nl: 'nog geen', en: 'none yet' },
  'status.leden': { nl: 'Gekoppelde leden', en: 'Linked members' },
  'status.jij': { nl: 'Jij', en: 'You' },
  'status.nietgekoppeld': {
    nl: 'nog niet gekoppeld (`/clan koppel`)',
    en: 'not linked yet (`/clan link`)',
  },
  'status.voet': { nl: 'Laatst bijgewerkt: {tijd}', en: 'Last updated: {tijd}' },
  'wie.gekoppeld': {
    nl: '<@{id}> is {wat}{gezien}. Gekoppeld door {door}.',
    en: '<@{id}> is {wat}{gezien}. Linked by {door}.',
  },
  'wie.gezienop': { nl: ' (gezien op {datum})', en: ' (seen on {datum})' },
  'wie.niets': {
    nl: '<@{id}> heeft hier geen OSRS-naam gekoppeld.',
    en: '<@{id}> has no OSRS name linked here.',
  },
  'koppeling.onbekend': { nl: '**{rsn}** — clan nog onbekend', en: '**{rsn}** — clan still unknown' },
  'koppeling.rang': { nl: '{rang} in {clan}', en: '{rang} in {clan}' },
  'sync.groep': { nl: '**{clan}** — {aantal} leden opgehaald.', en: '**{clan}** — {aantal} members fetched.' },
  'sync.bijgewerkt': {
    nl: '{aantal} lid/leden bijgewerkt, {ongewijzigd} stonden al goed.',
    en: '{aantal} member(s) updated, {ongewijzigd} were already correct.',
  },
  'sync.mislukt': { nl: '{aantal} mislukt.', en: '{aantal} failed.' },
  'sync.ongekoppeld': {
    nl: '{aantal} clanleden hebben hier nog geen Discord-koppeling.',
    en: '{aantal} clan members are not linked to a Discord account here yet.',
  },
  'sync.fout': { nl: 'Dat lukte niet: {fout}', en: 'That did not work: {fout}' },
  'sync.fout.kaal': { nl: 'Dat lukte niet.', en: 'That did not work.' },
  'knop.geenclan': {
    nl: 'Kies eerst een clan in het dashboard, anders valt er nog niets te koppelen.',
    en: 'Choose a clan in the dashboard first, otherwise there is nothing to link to.',
  },
  'knop.geenkanaal': {
    nl: 'Hier kan de bot geen bericht plaatsen. Probeer het in een ander kanaal.',
    en: 'The bot cannot post here. Try another channel.',
  },
  'knop.geplaatst': {
    nl: 'De knop staat er. Hij blijft werken, ook voor wie later komt.',
    en: 'The button is up. It keeps working, also for people who join later.',
  },

  // --- rolmenu's -------------------------------------------------------------
  'rolmenu.rolweg': {
    nl: 'Die rol bestaat niet meer. Vraag een beheerder om dit menu bij te werken.',
    en: 'That role no longer exists. Ask an admin to update this menu.',
  },
  'rolmenu.ikweg': {
    nl: 'Ik kan mezelf niet vinden in deze server.',
    en: 'I cannot find myself in this server.',
  },
  'rolmenu.geenrechten': {
    nl: 'Ik mag hier geen rollen beheren. Vraag een beheerder om "Rollen beheren".',
    en: 'I am not allowed to manage roles here. Ask an admin for "Manage Roles".',
  },
  'rolmenu.managed': {
    nl: '@{rol} hoort bij een bot of een boost; die kan niemand zelf aan- of uitzetten.',
    en: '@{rol} belongs to a bot or a boost; nobody can switch that one on or off.',
  },
  'rolmenu.boven': {
    nl: '@{rol} staat boven mijn eigen rol. Sleep mijn rol erboven, dan kan ik hem uitdelen.',
    en: '@{rol} sits above my own role. Drag my role above it and I can hand it out.',
  },
  'rolmenu.erbij': { nl: 'Je hebt nu **{rol}**.', en: 'You now have **{rol}**.' },
  'rolmenu.eraf': { nl: '**{rol}** is eraf gehaald.', en: '**{rol}** has been removed.' },
  'rolmenu.gevenmislukt': { nl: 'Het lukte niet om **{rol}** te geven.', en: 'Could not give you **{rol}**.' },
  'rolmenu.halenmislukt': {
    nl: 'Het lukte niet om **{rol}** weg te halen.',
    en: 'Could not take **{rol}** away.',
  },
  'rolmenu.bijwerkenmislukt': {
    nl: 'Het lukte niet om je rollen bij te werken.',
    en: 'Could not update your roles.',
  },
  'rolmenu.niets': { nl: 'Er is niets veranderd.', en: 'Nothing changed.' },
  'rolmenu.waterbij': { nl: '{rollen} erbij', en: '{rollen} added' },
  'rolmenu.wateraf': { nl: '{rollen} eraf', en: '{rollen} removed' },
  'rolmenu.kiezen': { nl: 'Kies je rollen', en: 'Pick your roles' },

  // --- binnenkomen in een server ---------------------------------------------
  'join.geenadmin.titel': {
    nl: 'Bijna klaar — ik mis Administrator',
    en: 'Almost ready — I am missing Administrator',
  },
  'join.geenadmin.tekst': {
    nl:
      'Kanalen en categorieen kan ik aanmaken. Twee dingen lukken zonder **Administrator** niet:\n\n' +
      '• **Community-modus aanzetten.** Discord staat dat alleen toe met Administrator. Zonder ' +
      'community-modus bestaan forum-, aankondigings- en stagekanalen niet.\n' +
      '• **Rollen met rechten die ik zelf niet heb.** Een rol met Kicken of Administrator erin maak ' +
      'ik dan aan zonder die rechten.\n\n' +
      'Ik stop daar niet voor: ik richt de rest gewoon in en zeg daarna precies wat er is ' +
      'overgeslagen. Maar compleet wordt het pas hiermee:\n' +
      '[voeg me opnieuw toe, met Administrator]({invite})\n\n' +
      'Ik hoef daarvoor niet weg. Het kan ook met de hand: Serverinstellingen → Rollen → {rol} → ' +
      'Administrator aan.',
    en:
      'I can create channels and categories. Two things do not work without **Administrator**:\n\n' +
      '• **Turning on Community mode.** Discord only allows that with Administrator. Without ' +
      'Community mode there are no forum, announcement or stage channels.\n' +
      '• **Roles with permissions I do not have myself.** A role with Kick or Administrator in it ' +
      'gets created without those permissions.\n\n' +
      'That does not stop me: I will set up the rest and tell you exactly what was skipped ' +
      'afterwards. But it only becomes complete with this:\n' +
      '[add me again, with Administrator]({invite})\n\n' +
      'I do not have to leave for that. By hand also works: Server Settings → Roles → {rol} → turn ' +
      'on Administrator.',
  },
  'join.klaar.titel': {
    nl: 'Klaar om deze server in te richten',
    en: 'Ready to set up this server',
  },
  'join.klaar.tekst': {
    nl:
      'Ik heb alle rechten die ik nodig heb.\n\n' +
      '`/setup list` — welke templates er zijn\n' +
      '`/setup preview` — laat zien wat er zou gebeuren, zonder iets te wijzigen\n' +
      '`/setup apply` — voert het plan uit\n' +
      '`/setup export` — deze server opslaan als template',
    en:
      'I have every permission I need.\n\n' +
      '`/setup list` — which templates exist\n' +
      '`/setup preview` — shows what would happen, without changing anything\n' +
      '`/setup apply` — carries out the plan\n' +
      '`/setup export` — save this server as a template',
  },
  'join.klaar.voet': {
    nl: 'Begin met /setup preview — daar verandert nog niets van.',
    en: 'Start with /setup preview — that changes nothing yet.',
  },
  'join.mist.titel': { nl: 'Ik mis nog rechten', en: 'I am still missing permissions' },
  'join.mist.tekst': {
    nl:
      'Zonder {rechten} kan ik geen templates uitvoeren.\n\n' +
      'Een bot kan zichzelf geen rechten geven, maar dit lost het in een klik op:\n' +
      '[voeg me opnieuw toe met de juiste rechten]({invite})\n\n' +
      'Ik hoef daarvoor niet weg — opnieuw autoriseren werkt mijn bestaande rol bij.',
    en:
      'Without {rechten} I cannot carry out templates.\n\n' +
      'A bot cannot give itself permissions, but this fixes it in one click:\n' +
      '[add me again with the right permissions]({invite})\n\n' +
      'I do not have to leave for that — authorising again updates my existing role.',
  },
  'join.volgorde.naam': { nl: 'Let op: rolvolgorde', en: 'Heads up: role order' },
  'join.volgorde.een': {
    nl: 'Er staat 1 rol boven mijn eigen rol. ',
    en: '1 role sits above my own role. ',
  },
  'join.volgorde.meer': {
    nl: 'Er staan {aantal} rollen boven mijn eigen rol. ',
    en: '{aantal} roles sit above my own role. ',
  },
  'join.volgorde.geenadmin': {
    nl: 'Die kan ik niet beheren, ook niet met Administrator.',
    en: 'I cannot manage those, not even with Administrator.',
  },
  'join.volgorde.klaar': {
    nl:
      'Discord laat me die niet beheren. Sleep mijn rol in Serverinstellingen → Rollen naar boven ' +
      'als een template rollen op dat niveau moet aanmaken.',
    en:
      'Discord does not let me manage those. Drag my role up under Server Settings → Roles if a ' +
      'template needs to create roles at that level.',
  },

  // --- algemeen --------------------------------------------------------------
  'iets.mis': {
    nl: 'Er ging iets mis bij het uitvoeren van dit commando.',
    en: 'Something went wrong while running this command.',
  },
} as const satisfies Record<string, Record<Taal, string>>;

export type Sleutel = keyof typeof TEKSTEN;

/**
 * De tekst in de gevraagde taal, met `{naam}` ingevuld.
 *
 * Een waarde die niet meegegeven is blijft als `{naam}` staan. Dat is lelijk,
 * maar het is wél zichtbaar - stiller weglaten levert een halve zin op waar
 * niemand meer aan ziet dat er iets mist.
 */
export function t(taal: Taal, sleutel: Sleutel, vars: Record<string, string | number> = {}): string {
  return TEKSTEN[sleutel][taal].replace(/\{(\w+)\}/g, (heel, naam: string) =>
    naam in vars ? String(vars[naam]) : heel,
  );
}

/** Alles wat er te vertalen valt; voor de test die kijkt of er niets ontbreekt. */
export const SLEUTELS = Object.keys(TEKSTEN) as Sleutel[];
