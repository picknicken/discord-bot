import { renderEditor, resetSelection, zetFocus } from './editor.js';
import { clanTelling, koppelClan, toonClan } from './clan.js';
import { ask, busy, CHANNEL_ICONS, emptyState, escapeHtml as escape, icon, initTheme, kanDownloaden, kiesUit, toast, toonTekst, zoekUit } from './ui.js';

const state = {
  templates: [], guilds: [], backups: [], permissions: [],
  selected: null, original: '', simRole: null, template: null, dirty: false,
  session: null, scherm: 'templates', fouten: null, uitgerold: false,
  /** Per server: wijkt hij af van de template die er het laatst op ging? */
  drift: null, driftTijd: 0, driftBezig: false,
  /** De server waar het serverscherm over gaat. */
  serverId: null,
};

const $ = (id) => document.getElementById(id);

/** Bewerkingen in de structuur-editor, zodat Ctrl+Z werkt. */
const history = { past: [], future: [], last: null, limit: 100 };

function recordEdit(after) {
  if (history.last !== null && history.last !== after) {
    history.past.push(history.last);
    if (history.past.length > history.limit) history.past.shift();
    history.future = [];
  }
  history.last = after;
  renderUndo();
}

/** Tekstbewerkingen in de JSON-tab tellen als een stap zodra je de tab verlaat. */
function captureManualEdit() {
  const current = $('editor').value;
  if (state.selected && history.last !== null && current !== history.last) recordEdit(current);
}

function step(from, to) {
  if (from.length === 0) return;
  to.push($('editor').value);
  const value = from.pop();
  history.last = value;
  $('editor').value = value;
  setDirty(true);
  renderTree();
  renderUndo();
}

const undo = () => step(history.past, history.future);
const redo = () => step(history.future, history.past);

function renderUndo() {
  $('undo').disabled = history.past.length === 0;
  $('redo').disabled = history.future.length === 0;
}

async function api(path, { timeout = 30000, ...options } = {}) {
  let response;
  try {
    // Zonder deadline blijft de pagina eeuwig "laden" als er niets terugkomt.
    // Werk dat Discord per stuk moet doen — uitrollen, leeghalen — krijgt langer.
    response = await fetch('/api' + path, {
      ...options,
      headers: options.body ? { 'content-type': 'application/json' } : {},
      signal: AbortSignal.timeout(timeout),
    });
  } catch (error) {
    throw new Error(
      error.name === 'TimeoutError'
        ? 'De server reageert niet. Draait het dashboard nog?'
        : 'Geen verbinding met het dashboard: ' + error.message,
    );
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'HTTP ' + response.status);
  return data;
}

// --- schermen en stappen ----------------------------------------------------

/**
 * Eén scherm tegelijk, links de navigatie. "Bewerken" en "Controle" zijn geen
 * eigen scherm maar een tabblad binnen Templates: je bewerkt nooit iets zonder
 * eerst een template te kiezen, dus die twee horen bij elkaar te staan.
 */
const VIEW_VAN = {
  overzicht: 'overzicht',
  instellingen: 'instellingen',
  templates: 'templates',
  bewerken: 'templates',
  controle: 'templates',
  servers: 'servers',
  server: 'server',
  uitrollen: 'uitrollen',
  clan: 'clan',
  geschiedenis: 'geschiedenis',
  backups: 'backups',
};

function toonScherm(naam) {
  state.scherm = naam;
  const view = VIEW_VAN[naam] || 'overzicht';

  for (const sectie of document.querySelectorAll('.view')) {
    sectie.classList.toggle('actief', sectie.id === 'view-' + view);
  }
  for (const knop of document.querySelectorAll('#sidebar button, #mobilenav button[data-scherm], #meerBlad button[data-scherm]')) {
    knop.setAttribute('aria-current', String(VIEW_VAN[knop.dataset.scherm] === view));
  }

  // Zit het huidige scherm achter "Meer", dan hoort die knop op te lichten -
  // anders lijkt het alsof je nergens bent.
  const achterMeer = [...document.querySelectorAll('#meerBlad button[data-scherm]')].some(
    (knop) => VIEW_VAN[knop.dataset.scherm] === view,
  );
  $('meerKnop').setAttribute('aria-current', String(achterMeer));

  if (naam === 'overzicht' || naam === 'servers' || naam === 'server') void laadDrift();
  if (naam === 'server') renderServerDetail();

  if (naam === 'controle') showTab('Check');
  else if (naam === 'bewerken' && $('treeView').hidden) showTab('Tree');
  // Het clanscherm haalt zijn eigen gegevens op; dat hoeft niet bij elke
  // verversing van de rest, alleen als je er daadwerkelijk naar kijkt.
  else if (naam === 'clan') void toonClan();

  window.scrollTo({ top: 0, behavior: 'smooth' });
  tekenWizard();
}

/**
 * De volgorde waarin je een server opbouwt. Elke stap weet zelf of hij af is,
 * zodat de rail laat zien waar je bent zonder dat je iets hoeft af te vinken.
 */
function stappen() {
  const t = state.template;
  const kanalen = t ? t.categories.reduce((n, c) => n + c.channels.length, 0) + t.uncategorizedChannels.length : 0;
  const overwrites = t
    ? t.categories.some((c) => c.overwrites.length) ||
      t.categories.some((c) => c.channels.some((k) => k.overwrites.length))
    : false;

  return [
    { naam: 'Template', klaar: Boolean(state.selected), scherm: 'templates', focus: 'alles' },
    { naam: 'Rollen', klaar: Boolean(t && t.roles.length), scherm: 'bewerken', focus: 'rollen' },
    { naam: 'Kanalen', klaar: kanalen > 0, scherm: 'bewerken', focus: 'kanalen' },
    { naam: 'Rechten', klaar: overwrites, scherm: 'bewerken', focus: 'alles' },
    { naam: 'Controle', klaar: state.fouten === 0, scherm: 'controle', focus: 'alles' },
    { naam: 'Toepassen', klaar: state.uitgerold, scherm: 'uitrollen', focus: 'alles' },
  ];
}

/** De stappenrail hoort bij het bouwen. Op Overzicht of Back-ups zegt hij niets. */
const WIZARD_OP = ['templates', 'bewerken', 'controle', 'uitrollen'];

function tekenWizard() {
  const rail = $('wizard');
  const lijst = stappen();
  const nu = lijst.findIndex((stap) => !stap.klaar);

  rail.hidden = !WIZARD_OP.includes(state.scherm);
  if (rail.hidden) return;
  rail.innerHTML = lijst
    .map((stap, index) => {
      const klasse = stap.klaar ? 'klaar' : index === nu ? 'nu' : '';
      const bol = stap.klaar ? icon('check', 'sm') : String(index + 1);
      return (
        '<button class="' + klasse + '" data-stap="' + stap.scherm + '" data-focus="' + stap.focus + '">' +
        '<span class="bol">' + bol + '</span>' + escape(stap.naam) + '</button>'
      );
    })
    .join('');

  for (const knop of rail.querySelectorAll('[data-stap]')) {
    knop.onclick = () => {
      zetFocus(knop.dataset.focus);
      toonScherm(knop.dataset.stap);
    };
  }
}

// --- inloggen ---------------------------------------------------------------

/** Vraagt of we binnen mogen. Zo niet: inlogscherm en verder niets laden. */
async function checkSession() {
  const data = await api('/session');
  state.session = data;

  if (!data.authenticated) {
    $('gate').hidden = false;
    $('gateNote').textContent = '';
    return false;
  }

  $('gate').hidden = true;
  renderWho();
  renderJoinable();
  return true;
}

function renderWho() {
  const user = state.session?.user;
  if (!user) { $('who').innerHTML = ''; return; }

  $('who').innerHTML =
    '<img src="' + escape(user.avatarUrl) + '" alt="">' +
    '<span>' + escape(user.globalName || user.username) + '</span>' +
    '<a class="btn-icon" href="/auth/logout" title="Uitloggen" style="display:inline-flex;color:var(--muted)">' +
    icon('undo') + '</a>';
}

/** Servers waar jij beheerder bent maar de bot nog niet in zit. */
function renderJoinable() {
  const target = $('joinable');
  const missing = (state.session?.guilds || []).filter((guild) => !guild.botPresent);

  if (missing.length === 0) { target.innerHTML = ''; return; }

  target.innerHTML =
    '<div style="margin-top:16px;border-top:1px solid var(--border);padding-top:12px">' +
    '<h4 style="font-size:10.5px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin-bottom:6px">' +
    'Jouw servers zonder de bot</h4>' +
    missing
      .map((guild) =>
        '<div class="joinrow">' +
        (guild.iconUrl ? '<img src="' + escape(guild.iconUrl) + '" alt="">' : icon('server', 'sm')) +
        '<span class="truncate">' + escape(guild.name) + '</span>' +
        '<a class="btn-sm" href="' + escape(guild.inviteUrl) + '" target="_blank" rel="noopener">' +
        icon('plus', 'sm') + 'Toevoegen</a></div>')
      .join('') +
    '</div>';
}

// --- status ----------------------------------------------------------------

async function refresh() {
  const data = await api('/state');
  state.templates = data.templates;
  state.guilds = data.guilds;
  state.backups = data.backups || [];
  state.setups = data.setups || [];
  state.permissions = data.permissions || [];
  state.onderdelen = data.onderdelen || [];

  $('avatar').src = data.avatarUrl;
  $('botName').textContent = data.botName;
  $('botSub').innerHTML =
    '<span class="dot-live"></span>' +
    escape(data.guilds.length + ' server' + (data.guilds.length === 1 ? '' : 's')) +
    ' · ' + escape(data.templates.length + ' templates') +
    ' · <span class="mono pad">' + escape(data.templatesDir) + '</span>';

  renderTemplates();
  renderGuilds();
  renderVariabelen();
  renderOnderdelen();
  renderBackups();
  renderSetups();
  renderOverzicht();
  renderServerKaarten();
  renderInstellingen(data.instellingen);
  $('telTemplates').textContent = state.templates.length || '';
  $('telServers').textContent = state.guilds.length || '';
  $('telClan').textContent = clanTelling() || '';
  $('demoBalk').hidden = !state.guilds.some((guild) => guild.id.length < 5);
}

// --- overzicht en servers ---------------------------------------------------

/** Wat er aan de hand is, in de volgorde waarin het je zou moeten opvallen. */
/**
 * Klopt elke server nog met de template die er het laatst op ging?
 *
 * Vergelijken kon al, maar alleen als je er zelf naartoe ging - per template,
 * per server. Dit is hetzelfde getal, maar dan zonder erom te vragen.
 *
 * Het kost van elke server een verse momentopname bij Discord, dus niet bij elke
 * verversing: alleen op de schermen waar het getal staat, en hoogstens eens per
 * halve minuut.
 */
const DRIFT_VERS = 30000;

function driftBadge(guildId) {
  if (!state.drift) return '<span class="badge">nakijken…</span>';

  const status = state.drift[guildId];
  if (!status || status.template === null) return '<span class="badge">nog niet uitgerold</span>';
  if (status.count === null) return '<span class="badge">niet te vergelijken</span>';
  if (status.count === 0) {
    return '<span class="badge ok">' + icon('check', 'sm') + 'komt overeen met ' + escape(status.template) + '</span>';
  }
  // Aanklikbaar: van "er zijn verschillen" naar het scherm waar je ze ziet en
  // rechtzet, met die server en die template al ingevuld.
  return (
    '<button class="badge warn" data-verschil="' + escape(guildId) + '" data-template="' +
    escape(status.template) + '">' + status.count + ' verschil' + (status.count === 1 ? '' : 'len') +
    ' met ' + escape(status.template) + '</button>'
  );
}

async function laadDrift(opnieuw = false) {
  if (state.driftBezig) return;
  if (!opnieuw && state.drift && Date.now() - state.driftTijd < DRIFT_VERS) return;

  state.driftBezig = true;
  try {
    const data = await api('/drift', { timeout: 60000 });
    state.drift = Object.fromEntries(data.servers.map((server) => [server.guildId, server]));
    state.driftTijd = Date.now();
    renderServerKaarten();
    renderOverzicht();
  } catch {
    // Niet kunnen kijken is geen reden om het scherm vol te zetten met een
    // foutmelding; de badges blijven dan staan op wat ze waren.
  } finally {
    state.driftBezig = false;
  }
}

function problemen() {
  const uit = [];

  for (const guild of state.guilds) {
    const drift = state.drift?.[guild.id];
    if (drift && drift.count > 0) {
      uit.push({
        soort: 'waarschuwing',
        wat: guild.name + ' wijkt af van "' + drift.template + '"',
        waarom: drift.samenvatting || drift.count + ' acties zouden dat rechtzetten.',
      });
    }
    if (guild.missing.length > 0) {
      uit.push({
        soort: 'fout',
        wat: guild.name + ' mist rechten',
        waarom: 'De bot kan hier niet alles: ' + guild.missing.join(', ') + '.',
      });
    }
    if (guild.rolesAbove > 0) {
      uit.push({
        soort: 'waarschuwing',
        wat: guild.name + ': ' + guild.rolesAbove + ' rol' + (guild.rolesAbove === 1 ? '' : 'len') + ' boven de bot',
        waarom: 'Die rollen kan hij niet aanpassen. Sleep de rol van de bot omhoog in Discord.',
      });
    }
  }

  for (const template of state.templates) {
    if (template.error) {
      uit.push({
        soort: 'fout',
        wat: 'Template "' + template.id + '" is stuk',
        waarom: template.error.split('\n')[0],
      });
    }
  }

  return uit;
}

function renderOverzicht() {
  const uitgerold = state.setups.filter((run) => run.mode === 'apply').length;
  const cijfers = [
    ['Servers', state.guilds.length],
    ['Templates', state.templates.length],
    ['Uitgerold', uitgerold],
    ['Back-ups', state.backups.length],
  ];

  $('overzichtStats').innerHTML = cijfers
    .map(([label, cijfer]) =>
      '<div class="stat"><div class="cijfer">' + cijfer + '</div><div class="label">' + label + '</div></div>',
    )
    .join('');

  const lijst = problemen();
  $('overzichtProblemen').innerHTML = lijst.length
    ? lijst
        .map(
          (probleem) =>
            '<div class="probleem ' + probleem.soort + '">' +
            icon(probleem.soort === 'fout' ? 'xcircle' : 'alert') +
            '<div><strong>' + escape(probleem.wat) + '</strong>' +
            '<small>' + escape(probleem.waarom) + '</small></div></div>',
        )
        .join('')
    : '<div class="probleem goed">' + icon('check') +
      '<div><strong>Niets aan de hand.</strong><small>Alle servers hebben de rechten die de bot ' +
      'nodig heeft, en alle templates zijn leesbaar.</small></div></div>';

  const recent = state.setups.slice(0, 5);
  $('overzichtRecent').innerHTML = recent.length
    ? recent
        .map((run) => {
          const uitkomst =
            run.mode === 'preview'
              ? '<span class="badge">preview</span>'
              : run.failed > 0
                ? '<span class="badge warn">' + run.applied + ' gelukt, ' + run.failed + ' mislukt</span>'
                : '<span class="badge ok">' + run.applied + ' gelukt</span>';
          return (
            '<div class="backup"><span class="grow"><strong>' + escape(run.template) + '</strong> op ' +
            escape(run.guildName) + '<div class="meta muted" style="font-size:11px">door ' +
            escape(run.door) + '</div></span>' + uitkomst + '</div>'
          );
        })
        .join('')
    : '<p class="hint">Nog niets uitgerold.</p>';
}

/** Per server een kaart met de stand van zaken, in plaats van badges in een rij. */
function renderServerKaarten() {
  const doel = $('serverCards');
  if (!doel) return;

  if (state.guilds.length === 0) {
    doel.innerHTML = emptyState(
      'server',
      state.session?.user
        ? 'Geen servers waar jij beheerder bent en de bot in zit.'
        : 'De bot zit nog in geen enkele server.',
    );
    return;
  }

  doel.innerHTML = state.guilds
    .map((guild) => {
      const status = [
        driftBadge(guild.id),
        guild.missing.length
          ? '<span class="badge bad">' + icon('alert', 'sm') + 'mist ' + guild.missing.length + ' recht' +
            (guild.missing.length === 1 ? '' : 'en') + '</span>'
          : '<span class="badge ok">' + icon('check', 'sm') + 'rechten in orde</span>',
        guild.rolesAbove > 0
          ? '<span class="badge warn">' + guild.rolesAbove + ' rol boven de bot</span>'
          : '<span class="badge ok">rolvolgorde in orde</span>',
        guild.admin ? '<span class="badge">administrator</span>' : '',
      ]
        .filter(Boolean)
        .join('');

      return (
        '<div class="servercard">' +
        '<button class="naam" data-open="' + escape(guild.id) + '" title="Alles over deze server">' +
        (guild.iconUrl ? '<img src="' + escape(guild.iconUrl) + '" alt="" style="width:22px;height:22px;border-radius:6px">' : icon('server')) +
        '<span class="truncate">' + escape(guild.name) + '</span></button>' +
        '<div class="muted" style="font-size:11.5px">' + guild.memberCount + ' leden · ' +
        guild.roleCount + ' rollen · ' + guild.channelCount + ' kanalen</div>' +
        '<div class="statusrij">' + status + '</div>' +
        '<div class="acties">' +
        '<button class="btn-sm" data-vergelijk="' + escape(guild.id) + '">Vergelijken</button>' +
        '<button class="btn-sm" data-uitrollen="' + escape(guild.id) + '">Uitrollen</button>' +
        '<button class="btn-sm btn-danger" data-leeghalen="' + escape(guild.id) + '">Leeghalen</button>' +
        '</div></div>'
      );
    })
    .join('');

  for (const knop of doel.querySelectorAll('[data-open]')) {
    knop.onclick = () => openServer(knop.dataset.open);
  }

  for (const knop of doel.querySelectorAll('[data-verschil]')) {
    knop.onclick = async () => {
      if (state.selected !== knop.dataset.template) await select(knop.dataset.template);
      toonScherm('uitrollen');
      kiesAlleenServer(knop.dataset.verschil);
      await preview();
    };
  }

  for (const knop of doel.querySelectorAll('[data-vergelijk]')) {
    knop.onclick = () => {
      kiesAlleenServer(knop.dataset.vergelijk);
      toonScherm('bewerken');
      showTab('Server');
      runCompare();
    };
  }

  for (const knop of doel.querySelectorAll('[data-uitrollen]')) {
    knop.onclick = () => {
      kiesAlleenServer(knop.dataset.uitrollen);
      toonScherm('uitrollen');
    };
  }

  for (const knop of doel.querySelectorAll('[data-leeghalen]')) {
    knop.onclick = () => leeghalen(knop.dataset.leeghalen);
  }
}

// --- instellingen -----------------------------------------------------------

const rij = (wat, waarde) => '<div class="rij"><span class="wat">' + escape(wat) + '</span><span class="waarde">' + waarde + '</span></div>';
const mono = (waarde) => '<code>' + escape(waarde) + '</code>';
const jaNee = (waarde, ja, nee) =>
  waarde ? '<span class="badge ok">' + escape(ja) + '</span>' : '<span class="badge">' + escape(nee) + '</span>';

function renderInstellingen(instellingen) {
  const doel = $('instellingenInhoud');
  if (!doel || !instellingen) return;

  const servers = instellingen.toegestaneServers || [];
  const lokaal = ['127.0.0.1', 'localhost', '::1'].includes(instellingen.host);

  const bot =
    '<div class="rijen" style="margin-bottom:14px">' +
    rij('Bot', escape(instellingen.botNaam) + ' · ' + mono(instellingen.clientId)) +
    rij('Draait op', mono(instellingen.host + ':' + instellingen.poort) +
      (lokaal ? ' <span class="badge">alleen deze computer</span>' : ' <span class="badge warn">van buiten bereikbaar</span>')) +
    rij('Adres', mono(instellingen.dashboardUrl)) +
    (instellingen.demo ? rij('Modus', '<span class="badge warn">demo — er verandert niets in Discord</span>') : '') +
    (instellingen.inviteUrl
      ? rij('Uitnodigen', '<a href="' + escape(instellingen.inviteUrl) + '" target="_blank" rel="noopener">Bot toevoegen aan een server</a>')
      : '') +
    '</div>';

  // Het inlogadres staat hier omdat het de meestgemaakte fout is: één letter
  // verschil met het portal en Discord weigert de inlog, zonder te zeggen welk
  // adres hij dan wel kreeg.
  const inloggen =
    '<div class="rijen" style="margin-bottom:14px">' +
    rij('Inloggen met Discord', jaNee(instellingen.inloggen, 'aan', 'uit')) +
    (instellingen.redirectUri
      ? rij(
          'Redirect-URL',
          mono(instellingen.redirectUri) +
            '<br><small class="muted">Moet letterlijk zo in het Developer Portal staan, onder OAuth2 → Redirects.</small>',
        )
      : rij(
          'Redirect-URL',
          '<span class="muted">niet van toepassing zolang inloggen uitstaat</span>',
        )) +
    '</div>';

  const kijken =
    '<div class="rijen" style="margin-bottom:14px">' +
    rij(
      'Zelf kijken of een server afdwaalt',
      instellingen.driftCheckUren > 0
        ? 'elke ' + instellingen.driftCheckUren + ' uur' +
          '<br><small class="muted">Hij zegt het in de server zodra er iets verandert, niet elke ronde opnieuw. ' +
          'Aanpassen: DRIFT_CHECK_UREN (0 is uit).</small>'
        : '<span class="muted">uit</span>' +
          '<br><small class="muted">Aanzetten: DRIFT_CHECK_UREN met het aantal uren erin.</small>',
    ) +
    '</div>';

  const grens =
    '<div class="rijen" style="margin-bottom:14px">' +
    rij(
      'Toegestane servers',
      servers.length
        ? servers.map(mono).join(' ') +
          '<br><small class="muted">Alleen deze servers mag de bot aanraken. Aanpassen: GUILD_IDS.</small>'
        : '<span class="muted">geen beperking — elke server waar de bot in zit mag</span>' +
          '<br><small class="muted">Wil je dat inperken: zet GUILD_IDS met de server-ids erin.</small>',
    ) +
    '</div>';

  const mappen =
    '<div class="rijen" style="margin-bottom:14px">' +
    rij('Templates', mono(instellingen.mappen.templates)) +
    rij('Back-ups', mono(instellingen.mappen.backups)) +
    rij('Geschiedenis', mono(instellingen.mappen.history)) +
    rij(
      'Volume',
      instellingen.volume
        ? mono(instellingen.volume) + ' <span class="badge ok">blijft bewaard</span>'
        : '<span class="badge warn">geen</span> <span class="muted">bij een hostingpartij is alles weg na een nieuwe deploy</span>',
    ) +
    '</div>';

  const thema =
    '<div class="rijen">' +
    rij('Thema', '<button class="btn-sm" id="themaKnop">Wisselen tussen licht en donker</button>') +
    (state.session?.user
      ? rij(
          'Ingelogd als',
          escape(state.session.user.globalName || state.session.user.username) +
            ' · <a href="/auth/logout">uitloggen</a>',
        )
      : '') +
    '</div>';

  doel.innerHTML = bot + inloggen + grens + kijken + mappen + thema;
  const knop = $('themaKnop');
  if (knop) knop.onclick = () => $('themeToggle').click();
}

// --- leeghalen --------------------------------------------------------------

/**
 * Twee schermen, met opzet. Eerst kiezen wat er weg mag, dan zien wat dat
 * precies is, en pas daarna de naam overtypen. Eén knop waarmee een server in
 * één klik leeg is, is geen knop die je op een telefoon wilt hebben.
 */
async function leeghalen(guildId) {
  const guild = state.guilds.find((kandidaat) => kandidaat.id === guildId);
  if (!guild) return;

  const keuze = await leeghaalOpties(guild.name);
  if (!keuze) return;

  let plan;
  try {
    plan = await api('/reset', { method: 'POST', body: JSON.stringify({ guildId, scope: keuze }) });
  } catch (error) {
    toast(error.message, 'bad');
    return;
  }

  if (plan.totaal === 0) {
    toast('Er valt niets te verwijderen in ' + guild.name + '.', 'info');
    return;
  }

  const bevestigd = await ask({
    title: 'Weet je het zeker?',
    body:
      'Dit verwijdert ' + plan.totaal + ' onderdelen uit "' + plan.guildName + '": ' +
      plan.counts.kanalen + ' kanalen, ' + plan.counts.rollen + ' rollen, ' +
      plan.counts.automod + ' automod-regels. Berichten in verwijderde kanalen zijn ook weg en komen ' +
      'nergens meer terug. Er gaat eerst een momentopname van de structuur naar de back-ups. ' +
      'Typ de servernaam over om door te gaan.',
    confirmLabel: 'Leeghalen',
    danger: true,
    requireText: plan.guildName,
  });

  if (!bevestigd) return;

  toast('Bezig met leeghalen…', 'info');
  try {
    const uitkomst = await api('/reset', {
      method: 'POST',
      body: JSON.stringify({ guildId, scope: keuze, bevestig: plan.guildName }),
      // Elk kanaal is een apart verzoek aan Discord; bij een volle server tikt
      // dat aan. Halverwege afbreken zou het ergste moment zijn om op te geven.
      timeout: 5 * 60 * 1000,
    });

    if (uitkomst.note) toast(uitkomst.note, 'info');
    else if (uitkomst.failed > 0) {
      toast(uitkomst.deleted + ' verwijderd, ' + uitkomst.failed + ' mislukt', 'warn');
      toonTekst({
        title: 'Wat er misging',
        tekst: (uitkomst.errors || []).join('\n'),
        hint: uitkomst.hint || '',
      });
    } else toast(uitkomst.deleted + ' onderdelen verwijderd uit ' + plan.guildName, 'ok');
  } catch (error) {
    toast(error.message, 'bad');
  }

  await refresh();
}

/** Wat mag er weg, en wat blijft hoe dan ook staan. */
function leeghaalOpties(guildName) {
  const dialog = $('dialog');

  dialog.innerHTML =
    '<form method="dialog">' +
    '<div class="dhead"><h3>' + escape(guildName) + ' leeghalen</h3></div>' +
    '<div class="dbody">' +
    '<p class="hint">Vink uit wat je wilt laten staan. Leden, berichten in bewaarde kanalen en ' +
    'emoji\'s blijven sowieso.</p>' +
    '<label class="check"><input type="checkbox" id="lhKanalen" checked><span>Kanalen en categorieën</span></label>' +
    '<label class="check"><input type="checkbox" id="lhRollen" checked><span>Rollen</span></label>' +
    '<label class="check"><input type="checkbox" id="lhAutomod" checked><span>AutoMod-regels</span></label>' +
    '<label style="display:block;margin-top:12px;font-size:12px" class="muted">Rollen die hoe dan ook blijven staan</label>' +
    '<input type="text" id="lhBehoud" placeholder="Admin, Moderator" autocomplete="off">' +
    '</div>' +
    '<div class="dfoot">' +
    '<button value="cancel" type="submit">Annuleren</button>' +
    '<button value="ok" type="submit" class="btn-danger">Bekijk wat er weggaat</button>' +
    '</div></form>';

  dialog.showModal();

  return new Promise((resolve) => {
    dialog.addEventListener(
      'close',
      () => {
        if (dialog.returnValue !== 'ok') return resolve(null);
        resolve({
          kanalen: $('lhKanalen').checked,
          rollen: $('lhRollen').checked,
          automod: $('lhAutomod').checked,
          behoudRollen: $('lhBehoud').value.split(',').map((naam) => naam.trim()).filter(Boolean),
        });
      },
      { once: true },
    );
  });
}

/** Vanaf een serverkaart werk je met die ene server, niet met alles wat aanstond. */
function kiesAlleenServer(guildId) {
  for (const vinkje of document.querySelectorAll('#guildList input[type="checkbox"]')) {
    vinkje.checked = vinkje.value === guildId;
  }
}

function renderTemplates() {
  const list = $('templateList');

  if (state.templates.length === 0) {
    list.innerHTML = emptyState('folder', 'Nog geen templates.');
  } else {
    list.innerHTML = state.templates
      .map((template) => {
        const body = template.error
          ? '<small style="color:var(--bad)">' + escape(template.error.split('\n')[0]) + '</small>'
          : '<small>' + template.roles + ' rollen · ' + template.categories + ' cat · ' +
            template.channels + ' kanalen</small>';
        return (
          '<button class="item" data-template="' + escape(template.id) + '" aria-selected="' +
          (template.id === state.selected) + '">' +
          icon(template.error ? 'alert' : 'file') +
          '<span class="grow"><strong class="truncate">' + escape(template.id) + '</strong>' + body + '</span></button>'
        );
      })
      .join('');

    for (const button of list.querySelectorAll('[data-template]')) {
      button.onclick = () => select(button.dataset.template);
    }
  }

  $('dupTemplate').disabled = !state.selected;
  $('delTemplate').disabled = !state.selected;
}

/** De vinkjes voor "welke onderdelen doen mee". Standaard staat alles aan. */
function renderOnderdelen() {
  const lijst = $('onderdelenLijst');
  if (!lijst) return;

  const aan = new Set(gekozenOnderdelen());
  lijst.innerHTML = state.onderdelen
    .map(
      (onderdeel) =>
        '<label class="check"><input type="checkbox" class="onderdeelpick" value="' + escape(onderdeel.naam) + '"' +
        (aan.size === 0 || aan.has(onderdeel.naam) ? ' checked' : '') + '><span>' + escape(onderdeel.naam) +
        '<br><small class="muted">' + escape(onderdeel.uitleg) + '</small></span></label>',
    )
    .join('');

  for (const vinkje of lijst.querySelectorAll('.onderdeelpick')) {
    vinkje.onchange = toonOnderdeelKop;
  }
  toonOnderdeelKop();
}

function gekozenOnderdelen() {
  return [...document.querySelectorAll('.onderdeelpick:checked')].map((vinkje) => vinkje.value);
}

/** In de kop zien of je iets hebt uitgezet, ook als het blok dichtgeklapt is. */
function toonOnderdeelKop() {
  const blok = $('onderdelenBlok');
  if (!blok) return;
  const gekozen = gekozenOnderdelen();
  const alles = gekozen.length === state.onderdelen.length;
  blok.querySelector('summary').innerHTML =
    icon('shield', 'sm') + ' Welke onderdelen ' +
    (alles ? '(alles)' : '<span class="badge warn">' + gekozen.length + ' van ' + state.onderdelen.length + '</span>');
}

function renderGuilds() {
  const list = $('guildList');
  if (state.guilds.length === 0) {
    // Ingelogd zie je alleen servers waar je zelf beheerder bent. "De bot zit
    // nergens in" zou dan een leugen zijn: hij zit er misschien in tien, alleen
    // niet in een van jou.
    list.innerHTML = emptyState(
      'server',
      state.session?.user
        ? 'Geen servers waar jij beheerder bent en de bot in zit.'
        : 'De bot zit nog in geen enkele server.',
    );
    return;
  }

  const checked = new Set(selectedGuilds());
  list.innerHTML = state.guilds
    .map((guild, index) => {
      const badges = [
        guild.missing.length
          ? '<span class="badge bad">' + icon('alert', 'sm') + 'mist rechten</span>'
          : '<span class="badge ok">' + icon('check', 'sm') + 'klaar</span>',
        guild.rolesAbove > 0
          ? '<span class="badge warn">' + guild.rolesAbove + ' rol' + (guild.rolesAbove === 1 ? '' : 'len') + ' boven de bot</span>'
          : '',
        // Zonder Administrator lukt community-modus niet en blijven bijzondere
        // rolrechten leeg; hij rolt de rest wel gewoon uit.
        guild.admin === false
          ? '<span class="badge warn">' + icon('alert', 'sm') + 'geen Administrator</span>'
          : '',
      ].join(' ');

      const on = checked.size ? checked.has(guild.id) : index === 0;
      return (
        '<label class="guildrow"><input type="checkbox" class="guildpick" value="' + escape(guild.id) + '"' +
        (on ? ' checked' : '') + '><span class="grow"><strong>' + escape(guild.name) + '</strong>' +
        '<div class="meta">' + guild.memberCount + ' leden · ' + guild.channelCount + ' kanalen · ' +
        guild.roleCount + ' rollen</div><div class="meta" style="margin-top:4px">' + badges + '</div>' +
        (guild.admin === false
          ? '<div class="meta" style="margin-top:4px">Community-modus en rollen met bijzondere rechten ' +
            'worden overgeslagen. ' +
            (guild.inviteUrl
              ? '<a href="' + escape(guild.inviteUrl) + '" target="_blank" rel="noopener">Opnieuw toevoegen met Administrator</a>'
              : 'Geef de bot Administrator in Serverinstellingen → Rollen.') +
            '</div>'
          : '') +
        (guild.missing.length ? '<div class="meta" style="color:var(--bad)">' + escape(guild.missing.join(', ')) + '</div>' : '') +
        '</span></label>'
      );
    })
    .join('');
}

const selectedGuilds = () => [...document.querySelectorAll('.guildpick:checked')].map((input) => input.value);

function renderBackups() {
  const list = $('backupList');
  if (state.backups.length === 0) {
    list.innerHTML = '<p class="hint">Nog geen back-ups.</p>';
    return;
  }

  list.innerHTML = state.backups
    .slice(0, 15)
    .map((backup) =>
      '<div class="backup"><span class="grow"><strong>' + escape(backup.guildName) + '</strong>' +
      '<div class="meta muted" style="font-size:11px">' + escape(backup.createdAt.slice(0, 16).replace('T', ' ')) +
      ' · ' + backup.roles + ' rollen · ' + backup.channels + ' kanalen</div></span>' +
      '<a class="btn-sm" href="/api/backups/' + encodeURIComponent(backup.file) + '" download title="Opslaan op dit apparaat">' +
      icon('download', 'sm') + '</a>' +
      '<button class="btn-sm" data-backup="' + escape(backup.file) + '">' + icon('undo', 'sm') + 'Terug</button></div>')
    .join('');

  for (const button of list.querySelectorAll('[data-backup]')) {
    button.onclick = () => restoreBackup(button.dataset.backup);
  }
}

/**
 * Eén server, alles bij elkaar.
 *
 * Uitrollen stond op Uitrollen, back-ups op Back-ups, wat er gebeurd is bij
 * Geschiedenis en leeghalen bij Servers - terwijl je in je hoofd met één server
 * bezig bent. Dit scherm zet het naast elkaar; het uitrollen zelf blijft op één
 * plek, want daar horen de vinkjes en de preview bij.
 */
function openServer(guildId) {
  state.serverId = guildId;
  toonScherm('server');
}

function renderServerDetail() {
  const guild = state.guilds.find((kandidaat) => kandidaat.id === state.serverId);
  if (!guild) {
    $('serverNaam').textContent = 'Server';
    $('serverDetail').innerHTML = emptyState('server', 'Die server staat niet (meer) in de lijst.');
    return;
  }

  $('serverNaam').textContent = guild.name;
  $('serverSub').textContent =
    guild.memberCount + ' leden · ' + guild.roleCount + ' rollen · ' + guild.channelCount + ' kanalen';

  const drift = state.drift?.[guild.id];
  const runs = state.setups.filter((run) => run.guildId === guild.id).slice(0, 6);
  const backups = state.backups.filter((backup) => backup.guildId === guild.id).slice(0, 6);

  const status =
    driftBadge(guild.id) +
    (guild.missing.length
      ? '<span class="badge bad">' + icon('alert', 'sm') + 'mist ' + guild.missing.length + ' recht' +
        (guild.missing.length === 1 ? '' : 'en') + '</span>'
      : '<span class="badge ok">' + icon('check', 'sm') + 'rechten in orde</span>') +
    (guild.rolesAbove > 0
      ? '<span class="badge warn">' + guild.rolesAbove + ' rol boven de bot</span>'
      : '<span class="badge ok">rolvolgorde in orde</span>') +
    (guild.admin ? '<span class="badge">administrator</span>' : '');

  const runRij = (run) =>
    '<div class="backup"><span class="grow"><strong>' + escape(run.template) + '</strong>' +
    '<div class="meta muted" style="font-size:11px">' + escape(prettyStamp(run.at)) + ' · door ' +
    escape(run.door) + '</div></span>' +
    (run.mode === 'preview'
      ? '<span class="badge">preview</span>'
      : run.failed > 0
        ? '<span class="badge warn">' + run.applied + ' gelukt, ' + run.failed + ' mislukt</span>'
        : '<span class="badge ok">' + run.applied + ' gelukt</span>') +
    '</div>';

  const backupRij = (backup) =>
    '<div class="backup"><span class="grow"><strong>' + escape(prettyStamp(backup.createdAt)) + '</strong>' +
    '<div class="meta muted" style="font-size:11px">' + backup.roles + ' rollen · ' + backup.channels +
    ' kanalen</div></span>' +
    '<a class="btn-sm" href="/api/backups/' + encodeURIComponent(backup.file) + '" download ' +
    'title="Opslaan op dit apparaat">' + icon('download', 'sm') + '</a>' +
    '<button class="btn-sm" data-backup="' + escape(backup.file) + '">' + icon('undo', 'sm') + 'Terug</button></div>';

  $('serverDetail').innerHTML =
    '<div class="statusrij" style="margin-bottom:14px">' + status + '</div>' +
    '<div class="row" style="margin-bottom:18px">' +
    '<button class="btn-primary" data-doe="uitrollen">' + icon('zap', 'sm') + 'Uitrollen</button>' +
    '<button class="btn-sm" data-doe="vergelijken">' + icon('eye', 'sm') + 'Vergelijken</button>' +
    '<button class="btn-sm" data-doe="bewaren">' + icon('download', 'sm') + 'Opslaan als template</button>' +
    '<button class="btn-sm btn-danger" data-doe="leeghalen">' + icon('trash', 'sm') + 'Leeghalen</button>' +
    '</div>' +
    (drift && drift.count > 0
      ? '<div class="note warn" style="margin-bottom:18px">' + escape(drift.samenvatting || '') + '</div>'
      : '') +
    '<div class="dubbel">' +
    '<section class="panel"><div class="phead">' + icon('history') +
    '<h2 class="grow">Wat er gebeurd is</h2></div><div class="pbody">' +
    (runs.length ? runs.map(runRij).join('') : '<p class="hint">Nog niets uitgerold op deze server.</p>') +
    '</div></section>' +
    '<section class="panel"><div class="phead">' + icon('archive') +
    '<h2 class="grow">Back-ups</h2></div><div class="pbody">' +
    (backups.length ? backups.map(backupRij).join('') : '<p class="hint">Nog geen back-ups van deze server.</p>') +
    '</div></section></div>';

  for (const knop of $('serverDetail').querySelectorAll('[data-backup]')) {
    knop.onclick = () => restoreBackup(knop.dataset.backup);
  }

  const doe = {
    uitrollen: async () => {
      if (drift?.template && state.selected !== drift.template) await select(drift.template);
      toonScherm('uitrollen');
      kiesAlleenServer(guild.id);
    },
    vergelijken: () => {
      kiesAlleenServer(guild.id);
      toonScherm('bewerken');
      showTab('Server');
      runCompare();
    },
    bewaren: () => exportGuild(guild.id),
    leeghalen: () => leeghalen(guild.id),
  };

  for (const knop of $('serverDetail').querySelectorAll('[data-doe]')) {
    knop.onclick = () => void doe[knop.dataset.doe]();
  }
}

/**
 * Invulvelden voor de {{variabelen}} van de gekozen template. Zonder deze
 * velden is een template met variabelen alleen vanaf de commandoregel te
 * gebruiken, en dat is precies het tegenovergestelde van de bedoeling.
 */
function renderVariabelen() {
  const blok = $('variabelenBlok');
  if (!blok) return;

  const template = state.templates.find((kandidaat) => kandidaat.id === state.selected);
  const variabelen = template && template.variables ? Object.entries(template.variables) : [];

  blok.hidden = variabelen.length === 0;
  if (variabelen.length === 0) return;

  const eerder = gekozenVariabelen();
  $('variabelenVelden').innerHTML = variabelen
    .map(([naam, spec]) => {
      const waarde = eerder[naam] ?? spec.standaard ?? '';
      return (
        '<label class="field"><span>' + escape(naam) + '</span>' +
        '<input type="text" class="variabele" data-naam="' + escape(naam) + '" value="' + escape(waarde) + '"' +
        ' placeholder="' + escape(spec.standaard || '') + '">' +
        (spec.beschrijving ? '<small class="muted">' + escape(spec.beschrijving) + '</small>' : '') +
        '</label>'
      );
    })
    .join('');
}

function gekozenVariabelen() {
  const waarden = {};
  for (const veld of document.querySelectorAll('.variabele')) {
    if (veld.value.trim() !== '') waarden[veld.dataset.naam] = veld.value;
  }
  return waarden;
}

/** Het logboek: wie heeft wat waar uitgerold, en ging het goed. */
function renderSetups() {
  const lijst = $('setupList');
  if (!lijst) return;

  if (!state.setups || state.setups.length === 0) {
    lijst.innerHTML = '<p class="hint">Nog niets uitgerold.</p>';
    return;
  }

  lijst.innerHTML = state.setups
    .map((run) => {
      const uitkomst =
        run.mode === 'preview'
          ? '<span class="badge">preview</span>'
          : run.failed > 0
            ? '<span class="badge warn">' + run.applied + ' gelukt, ' + run.failed + ' mislukt</span>'
            : '<span class="badge ok">' + run.applied + ' gelukt</span>';

      return (
        '<div class="backup"><span class="grow"><strong>' + escape(run.template) + '</strong> op ' +
        escape(run.guildName) + '<div class="meta muted" style="font-size:11px">' +
        escape(prettyStamp(run.at.replace(/[:.]/g, '-'))) + ' · door ' + escape(run.door) +
        (run.notes && run.notes.length ? ' · ' + run.notes.length + ' opmerking' + (run.notes.length === 1 ? '' : 'en') : '') +
        '</div></span>' + uitkomst + '</div>' +
        (run.notes && run.notes.length
          ? '<pre class="actions" style="margin:2px 0 10px">' + escape(run.notes.join('\n')) + '</pre>'
          : '')
      );
    })
    .join('');
}

// --- template kiezen en bewerken -------------------------------------------

async function select(id) {
  state.selected = id;
  setTimeout(renderVariabelen, 0);
  const data = await api('/templates/' + id);
  state.original = data.json;
  $('editor').value = data.json;
  $('editorTitle').textContent = id;
  history.past = [];
  history.future = [];
  history.last = data.json;
  state.fouten = null;
  renderUndo();
  setDirty(false);
  resetSelection();
  renderTemplates();
  renderTree();
  tekenWizard();
  await renderVersions();

  // Op een telefoon wil je na het kiezen meteen naar het bewerkscherm.
  if (window.matchMedia('(max-width: 900px)').matches && state.scherm === 'templates') {
    toonScherm('bewerken');
  }
}

function setDirty(dirty) {
  state.dirty = dirty;
  $('saveNote').innerHTML = dirty ? '<span style="color:var(--warn)">niet opgeslagen</span>' : '';
}

function renderTree() {
  const view = $('treeView');
  try {
    state.template = JSON.parse($('editor').value);
  } catch (error) {
    view.innerHTML = '<div class="note bad">JSON is nu ongeldig: ' + escape(error.message) + '</div>';
    return;
  }

  renderEditor(view, {
    template: state.template,
    permissions: state.permissions,
    // Het voorbeeld laat zien wat een rol straks ziet. Dat rekent de server uit,
    // met dezelfde simulatie als het controlescherm — niet een tweede keer
    // nagebouwd in de browser, want dan lopen die twee uit elkaar.
    simuleer: async (json, role) => {
      const data = await api('/analyze', { method: 'POST', body: JSON.stringify({ json, role }) });
      return data.simulation;
    },
    onChange: () => {
      // De JSON blijft de bron van waarheid voor opslaan en controleren.
      const after = JSON.stringify(state.template, null, 2);
      recordEdit(after);
      $('editor').value = after;
      setDirty(true);
    },
  });
}

async function renderVersions() {
  const lijst = $('versions');
  if (!state.selected) { lijst.innerHTML = ''; return; }

  const data = await api('/templates/' + state.selected + '/versions');
  $('versieblok').querySelector('summary').innerHTML =
    icon('history', 'sm') + ' Versies (' + data.versions.length + ')';

  if (data.versions.length === 0) {
    lijst.innerHTML = '<p class="hint">Nog geen eerdere versies. Elke keer dat je opslaat komt er een bij.</p>';
    return;
  }

  lijst.innerHTML = data.versions
    .map((version) =>
      '<div class="versie"><span>' +
      '<div class="wat">' + escape(version.summary || 'opgeslagen zonder wijziging') + '</div>' +
      '<div class="toen">' + escape(prettyStamp(version.stamp)) +
      (version.door ? ' · door ' + escape(version.door) : '') + '</div></span>' +
      '<span class="knoppen">' +
      '<button class="btn-sm" data-versie="' + escape(version.stamp) + '">Terug</button>' +
      '<button class="btn-icon" data-versiedownload="' + escape(version.stamp) + '" title="Download">' +
      icon('download', 'sm') + '</button></span></div>')
    .join('');

  for (const knop of lijst.querySelectorAll('[data-versie]')) {
    knop.onclick = () => zetVersieTerug(knop.dataset.versie);
  }
  for (const knop of lijst.querySelectorAll('[data-versiedownload]')) {
    knop.onclick = async () => {
      const data = await api('/templates/' + state.selected + '/version?stamp=' + encodeURIComponent(knop.dataset.versiedownload));
      bewaarBestand(state.selected + '-' + knop.dataset.versiedownload + '.json', data.json);
    };
  }
}

/**
 * Zet tekst als bestand klaar in de browser. Mag de browser geen bestanden
 * aanbieden (de demo draait in een afgeschermd venster), dan tonen we de
 * inhoud zodat je hem alsnog kunt kopiëren.
 */
function bewaarBestand(naam, inhoud) {
  if (!kanDownloaden()) {
    toonTekst({
      title: naam,
      tekst: inhoud,
      hint: 'Downloaden mag hier niet. Kopieer de tekst en bewaar hem zelf als ' + naam + '.',
    });
    return;
  }
  const blob = new Blob([inhoud], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = naam;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

async function zetVersieTerug(stamp) {
  const akkoord = await ask({
    title: 'Versie terugzetten?',
    body: prettyStamp(stamp) + '\n\nDe huidige inhoud wordt eerst als versie bewaard.',
    confirmLabel: 'Terugzetten',
  });
  if (!akkoord) return;

  const data = await api('/templates/' + state.selected + '/restore', {
    method: 'POST',
    body: JSON.stringify({ stamp }),
  });
  $('editor').value = data.json;
  state.original = data.json;
  setDirty(false);
  renderTree();
  await renderVersions();
  toast('Versie teruggezet', 'ok');
}

const prettyStamp = (stamp) => stamp.slice(0, 16).replace('T', ' ').replace(/-(\d{2})$/, ':$1');

async function save() {
  if (!state.selected) return;
  try {
    await api('/templates/' + state.selected, { method: 'PUT', body: JSON.stringify({ json: $('editor').value }) });
    state.original = $('editor').value;
    setDirty(false);
    toast('Template opgeslagen', 'ok');
    await refresh();
    await renderVersions();
  } catch (error) {
    toast(error.message.split('\n')[0], 'bad', 6000);
    $('planResult').innerHTML = '<div class="note bad" style="margin-top:10px">' + escape(error.message) + '</div>';
  }
}

// --- tabs en controle ------------------------------------------------------

function showTab(which) {
  captureManualEdit();

  for (const [tab, view] of [
    ['tabTree', 'treeView'], ['tabJson', 'jsonView'], ['tabCheck', 'checkView'], ['tabServer', 'serverView'],
  ]) {
    const active = tab === 'tab' + which;
    $(tab).setAttribute('aria-selected', String(active));
    $(view).hidden = !active;
  }
  if (which === 'Tree') renderTree();
  if (which === 'Check') runCheck();
  if (which === 'Server') runCompare();
}

// --- template naast de echte server ---------------------------------------

async function runCompare() {
  if (!state.selected) return;
  const target = $('compareResult');
  const guildId = selectedGuilds()[0];

  if (!guildId) {
    target.innerHTML = emptyState('server', 'Vink rechts een server aan om mee te vergelijken.');
    return;
  }

  target.innerHTML = busy('Server uitlezen…');
  try {
    const data = await api('/compare', {
      method: 'POST',
      body: JSON.stringify({ json: $('editor').value, guildId }),
    });
    target.innerHTML = renderCompare(data);

    const knop = $('herstelMist');
    if (knop) knop.onclick = () => herstelWatMist(guildId);
  } catch (error) {
    target.innerHTML = '<div class="note bad">' + escape(error.message) + '</div>';
  }
}

/** Vult aan wat er in de template staat maar niet op de server; raakt de rest niet aan. */
async function herstelWatMist(guildId) {
  const server = state.guilds.find((kandidaat) => kandidaat.id === guildId);

  const akkoord = await ask({
    title: 'Herstel wat mist?',
    body:
      'Op "' + (server ? server.name : guildId) + '" wordt alleen aangemaakt wat ontbreekt.\n\n' +
      'Bestaande kanalen en rollen blijven ongemoeid en er wordt niets verwijderd.',
    confirmLabel: 'Aanvullen',
  });
  if (!akkoord) return;

  const target = $('compareResult');
  target.innerHTML = busy('Aanvullen…');

  try {
    const data = await api('/apply', {
      method: 'POST',
      timeout: 5 * 60 * 1000,
      body: JSON.stringify({
        templateId: state.selected,
        guildIds: [guildId],
        prune: false,
        update: false,
      }),
    });

    const resultaat = data.results[0] || {};
    toast(resultaat.note || resultaat.applied + ' onderdelen aangevuld', data.failed ? 'bad' : 'ok');
    await runCompare();
  } catch (error) {
    target.innerHTML = '<div class="note bad">' + escape(error.message) + '</div>';
  }
}

const PILLS = {
  new: ['new', 'nieuw'],
  same: ['same', 'staat er'],
  extra: ['extra', 'alleen op server'],
  'type-mismatch': ['mismatch', 'ander type'],
};

function comparedRow(item, iconName) {
  const [cls, label] = PILLS[item.status];
  return (
    '<li class="cmp ' + item.status + '">' + icon(iconName, 'sm') +
    '<span>' + escape(item.name) + '</span>' +
    (item.note ? '<span class="note">' + escape(item.note) + '</span>' : '') +
    '<span class="pill ' + cls + '">' + label + '</span></li>'
  );
}

function renderCompare(data) {
  const legend =
    '<div class="legend">' +
    [['var(--ok)', 'nieuw: komt erbij'], ['var(--surface-3)', 'staat er al'],
     ['var(--warn)', 'alleen op de server'], ['var(--bad)', 'naam bestaat, ander type']]
      .map(([color, label]) => '<span><i class="swatch" style="background:' + color + '"></i>' + escape(label) + '</span>')
      .join('') +
    '</div>';

  const counts =
    '<div class="counts">' +
    [['new', 'nieuw'], ['same', 'staat er al'], ['extra', 'alleen op server'], ['type-mismatch', 'ander type']]
      .map(([key, label]) =>
        '<div class="count ' + (key === 'type-mismatch' && data.counts[key] ? 'on error' : '') +
        (key === 'extra' && data.counts[key] ? ' on warning' : '') + '"><b>' + data.counts[key] +
        '</b><span>' + label + '</span></div>')
      .join('') +
    '</div>';

  const roles = data.roles.length
    ? '<h4 style="font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin:18px 0 6px">Rollen</h4>' +
      '<ul style="list-style:none;margin:0;padding:0">' +
      data.roles.map((role) => comparedRow(role, 'shield')).join('') + '</ul>'
    : '';

  const categories = data.categories
    .map((category) => {
      const [cls, label] = PILLS[category.status];
      return (
        '<div class="cat"><h3 style="display:flex;align-items:center;gap:6px">' + escape(category.name) +
        '<span class="pill ' + cls + '">' + label + '</span></h3><ul>' +
        (category.channels.length
          ? category.channels.map((channel) => comparedRow(channel, CHANNEL_ICONS[channel.type] || 'hash')).join('')
          : '<li class="hint">geen kanalen</li>') +
        '</ul></div>'
      );
    })
    .join('');

  const loose = data.loose.length
    ? '<div class="cat"><h3>Zonder categorie</h3><ul>' +
      data.loose.map((channel) => comparedRow(channel, CHANNEL_ICONS[channel.type] || 'hash')).join('') + '</ul></div>'
    : '';

  const herstel = data.counts.new > 0
    ? '<button id="herstelMist" class="btn-primary" style="margin-bottom:14px">' + icon('zap', 'sm') +
      'Herstel wat mist (' + data.counts.new + ')</button>' +
      '<p class="hint">Maakt alleen aan wat ontbreekt. Bestaande kanalen en rollen blijven zoals ze zijn, ' +
      'en er wordt niets verwijderd.</p>'
    : '';

  return (
    '<p class="hint">Vergeleken met <strong>' + escape(data.guildName) + '</strong></p>' +
    herstel +
    counts + legend + roles +
    '<h4 style="font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin:18px 0 6px">Kanalen</h4>' +
    categories + loose
  );
}

async function runCheck(role) {
  if (!state.selected) return;
  const target = $('checkResult');
  target.innerHTML = busy('Controleren…');

  try {
    const data = await api('/analyze', {
      method: 'POST',
      body: JSON.stringify({ json: $('editor').value, role: role || state.simRole }),
    });
    state.simRole = data.simulation ? data.simulation.role : null;
    state.fouten = data.counts.error;
    target.innerHTML = renderCheck(data);
    tekenWizard();

    const picker = $('simRole');
    if (picker) picker.onchange = () => runCheck(picker.value);
  } catch (error) {
    target.innerHTML = '<div class="note bad">' + escape(error.message) + '</div>';
  }
}

function renderCheck(data) {
  const s = data.summary;
  const gecontroleerd = s
    ? '<p class="hint" style="margin-bottom:10px">Gecontroleerd: ' +
      [
        s.roles + ' rollen',
        s.categories + ' categorieen',
        s.channels + ' kanalen',
        s.overwrites + ' rechtenregels',
        s.automod ? s.automod + ' automod-regels' : '',
      ].filter(Boolean).join(' · ') + '</p>'
    : '';

  const counts =
    '<div class="counts">' +
    [['error', 'fouten'], ['warning', 'waarschuwingen'], ['info', 'opmerkingen']]
      .map(([key, label]) =>
        '<div class="count ' + (data.counts[key] ? 'on ' + key : '') + '"><b>' + data.counts[key] +
        '</b><span>' + label + '</span></div>')
      .join('') +
    '</div>';

  const icons = { error: 'xcircle', warning: 'alert', info: 'info' };
  const findings = data.findings.length
    ? data.findings
        .map((finding) =>
          '<div class="finding ' + finding.severity + '">' + icon(icons[finding.severity]) +
          '<span class="grow">' + escape(finding.message) +
          '<div class="where">' + escape(finding.where) + '</div></span></div>')
        .join('')
    : '<div class="note ok">' + escape('Niets gevonden. Deze template kan de deur uit.') + '</div>';

  const simulation = data.simulation;
  const options = data.roles
    .map((role) =>
      '<option value="' + escape(role.key) + '"' +
      (simulation && role.key === simulation.role ? ' selected' : '') + '>' + escape(role.name) + '</option>')
    .join('');

  const tree = simulation
    ? simulation.categories
        .map((category) =>
          '<div class="cat"><h3>' + escape(category.name) + '</h3><ul>' +
          category.channels
            .map((channel) =>
              '<li class="vis ' + (channel.visible ? '' : 'off') + '">' +
              icon(channel.visible ? 'eye' : 'eyeoff', 'sm') +
              icon(CHANNEL_ICONS[channel.type] || 'hash', 'sm') +
              '<span>' + escape(channel.name) + '</span>' +
              '<span class="why">' + escape(channel.reason) + '</span></li>')
            .join('') +
          '</ul></div>')
        .join('')
    : '';

  return (
    gecontroleerd + counts +
    '<div style="border:1px solid var(--border);border-radius:var(--r-2);padding:4px 12px;margin-bottom:18px">' +
    findings + '</div>' +
    '<div class="spread" style="margin-bottom:8px"><h4 style="font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted)">Wat ziet deze rol?</h4>' +
    '<select id="simRole">' + options + '</select></div>' +
    (simulation
      ? '<p class="hint">' + simulation.visibleCount + ' van ' + simulation.totalCount + ' kanalen zichtbaar' +
        (simulation.administrator ? ' — Administrator ziet alles' : '') + '</p>'
      : '') +
    tree
  );
}

// --- uitrollen -------------------------------------------------------------

const planBody = () => ({
  templateId: state.selected,
  guildIds: selectedGuilds(),
  prune: $('prune').checked,
  update: $('update').checked,
  onderdelen: gekozenOnderdelen(),
  variabelen: gekozenVariabelen(),
});

/**
 * Het plan als diff. Een blok tekst laat je zoeken naar wat er nu eigenlijk
 * verdwijnt; een lijst met tekens ervoor laat het zien. Verwijderregels staan
 * apart, want dat is het enige dat je niet terugkrijgt.
 */
const SOORT_ICOON = {
  rol: 'shield',
  categorie: 'folder',
  kanaal: 'hash',
  emoji: 'zap',
  automod: 'alert',
  volgorde: 'up',
  onboarding: 'info',
  instellingen: 'server',
};

function diffRegel(regel) {
  const naam =
    regel.soort === 'kanaal'
      ? '#' + regel.naam + (regel.onder ? '<span class="waar"> in ' + escape(regel.onder) + '</span>' : '')
      : escape(regel.naam);

  const icoon = regel.soort === 'kanaal' ? CHANNEL_ICONS[regel.type] || 'hash' : SOORT_ICOON[regel.soort] || 'info';

  return (
    '<div class="diffrij ' + (regel.teken === '+' ? 'nieuw' : regel.teken === '-' ? 'weg' : 'anders') + '">' +
    '<span class="teken">' + regel.teken + '</span>' +
    icon(icoon, 'sm') +
    '<span class="grow truncate">' + (regel.soort === 'kanaal' ? naam : escape(regel.naam)) + '</span>' +
    (regel.detail ? '<span class="detail truncate">' + escape(regel.detail) + '</span>' : '') +
    (regel.prune ? '<span class="badge bad">verdwijnt</span>' : '') +
    '</div>'
  );
}

/**
 * Lange lijsten klappen in. Bij dertig regels scroll je anders langs je eigen
 * plan heen; de eerste tien zeggen meestal al waar het over gaat.
 */
const TOON = 10;

function diffBlok(regels) {
  if (regels.length <= TOON + 2) return regels.map(diffRegel).join('');

  return (
    regels.slice(0, TOON).map(diffRegel).join('') +
    '<details class="meer"><summary>nog ' + (regels.length - TOON) + ' regels</summary>' +
    regels.slice(TOON).map(diffRegel).join('') +
    '</details>'
  );
}

function diffLijst(regels) {
  const weg = regels.filter((regel) => regel.teken === '-');
  const rest = regels.filter((regel) => regel.teken !== '-');

  return (
    '<div class="diff">' +
    diffBlok(rest) +
    (weg.length
      ? '<div class="diffkop">' + weg.length + ' worden verwijderd — dit kun je niet terugdraaien</div>' +
        diffBlok(weg)
      : '') +
    '</div>'
  );
}

/**
 * Waarschuwingen als losse regels.
 *
 * Aan elkaar geplakt in één kader lees je ze als een lap tekst en zie je de
 * tweede niet meer - terwijl er juist dingen tussen staan als "er staan twee
 * kanalen met dezelfde naam", die om een besluit vragen.
 */
function waarschuwingen(lijst) {
  if (!lijst || lijst.length === 0) return '';

  const rij = (regel) => '<div class="waarschuwingsrij">' + icon('alert', 'sm') + '<span>' + escape(regel) + '</span></div>';
  const kop = 4;

  // Een server waar de bot te weinig rechten heeft levert een regel per rol op.
  // Dan is de lijst zelf het probleem niet meer; de eerste paar zeggen genoeg.
  const inhoud =
    lijst.length <= kop + 2
      ? lijst.map(rij).join('')
      : lijst.slice(0, kop).map(rij).join('') +
        '<details class="meer"><summary>nog ' + (lijst.length - kop) + ' waarschuwingen</summary>' +
        lijst.slice(kop).map(rij).join('') +
        '</details>';

  return '<div class="waarschuwingen">' + inhoud + '</div>';
}

/**
 * Waar het getoonde plan bij hoorde.
 *
 * Vink je daarna prune aan of een server uit, dan blijft dat plan gewoon staan
 * alsof het nog klopt. Dus onthouden we waar het bij hoort, en zeggen we het
 * zodra dat niet meer zo is.
 */
let planSleutel = null;

const planSleutelNu = () => JSON.stringify(planBody());

function markeerVerouderd() {
  $('planResult').classList.toggle('verouderd', planSleutel !== null && planSleutel !== planSleutelNu());
}

const verouderdBalk =
  '<div class="verouderdbalk">' +
  '<span class="grow">Je hebt iets gewijzigd — dit plan is van daarvoor.</span>' +
  '<button class="btn-sm" data-doe="preview">Opnieuw berekenen</button></div>';

function planKaart(plan) {
  return (
    '<div class="planblok"><div class="spread"><strong>' + escape(plan.guildName) + '</strong>' +
    '<span class="badge">' + plan.count + ' acties</span></div>' +
    '<div class="note ok" style="margin-top:6px">' + escape(plan.summary) + '</div>' +
    waarschuwingen(plan.warnings) +
    (plan.regels && plan.regels.length ? diffLijst(plan.regels) : '') +
    '</div>'
  );
}

async function preview() {
  if (!state.selected) return toast('Kies eerst een template.', 'bad');
  if (selectedGuilds().length === 0) return toast('Vink minstens een server aan.', 'bad');
  if (gekozenOnderdelen().length === 0) return toast('Vink minstens een onderdeel aan.', 'bad');

  planSleutel = null;
  $('planResult').classList.remove('verouderd');
  $('planResult').innerHTML = busy('Plan berekenen…');
  try {
    const sleutel = planSleutelNu();
    const data = await api('/plan', { method: 'POST', body: JSON.stringify(planBody()) });
    const totaal = data.plans.reduce((som, plan) => som + plan.count, 0);

    // De knop hoort onder wat je net gelezen hebt. Hij stond bovenaan bij
    // Preview, dus moest je terugscrollen naar een knop die het plan opnieuw
    // uitrekende in plaats van dit plan toe te passen.
    $('planResult').innerHTML =
      verouderdBalk +
      data.plans.map(planKaart).join('') +
      (totaal > 0
        ? '<div class="planvoet"><button class="btn-primary" data-doe="apply">' +
          icon('zap', 'sm') + 'Dit toepassen</button></div>'
        : '');
    planSleutel = sleutel;
  } catch (error) {
    $('planResult').innerHTML = '<div class="note bad" style="margin-top:12px">' + escape(error.message) + '</div>';
  }
}

/**
 * Nog een keer kijken, met precies wat er net is toegepast.
 *
 * Een lijst van wat er gedaan is zegt niet of het nu klopt. "Geen wijzigingen
 * nodig" zegt dat wel - en dat is het enige waar je op af kunt gaan.
 */
async function naControle(body) {
  const blok = document.createElement('div');
  blok.className = 'nacontrole';
  blok.innerHTML = busy('Nakijken…');
  $('planResult').appendChild(blok);

  try {
    const data = await api('/plan', { method: 'POST', body: JSON.stringify(body) });
    const open = data.plans.reduce((som, plan) => som + plan.count, 0);

    blok.innerHTML =
      open === 0
        ? '<div class="note ok">' + icon('check', 'sm') + ' Nagekeken: de server staat nu zoals de template het beschrijft.</div>'
        : '<div class="note warn">Nagekeken: er blijven ' + open + ' acties over.</div>' +
          data.plans.filter((plan) => plan.count > 0).map(planKaart).join('');
  } catch (error) {
    blok.innerHTML = '<div class="note warn">Nakijken lukte niet: ' + escape(error.message) + '</div>';
  }
}

/**
 * @param {string[] | null} alleen  Alleen deze servers; anders wat er aangevinkt staat.
 * @param {boolean} opnieuw  Een herkansing voor servers waar iets misging.
 */
async function apply(alleen = null, opnieuw = false) {
  if (!state.selected) return toast('Kies eerst een template.', 'bad');
  const ids = alleen ?? selectedGuilds();
  const targets = state.guilds.filter((guild) => ids.includes(guild.id));
  if (targets.length === 0) return toast('Vink minstens een server aan.', 'bad');
  if (gekozenOnderdelen().length === 0) return toast('Vink minstens een onderdeel aan.', 'bad');

  const names = targets.map((guild) => guild.name);

  // De naam overtypen is een rem op iets wat je niet terugdraait. Bij één
  // server zonder verwijderen valt er niets te verliezen, en op een telefoon is
  // een servernaam met emoji overtypen een straf.
  const streng = $('prune').checked || targets.length > 1;
  const requireText = streng ? (targets.length === 1 ? names[0] : 'TOEPASSEN') : null;

  const confirmed = await ask({
    title: opnieuw ? 'Opnieuw proberen?' : 'Template toepassen?',
    body:
      ($('prune').checked ? 'LET OP: kanalen die niet in de template staan worden VERWIJDERD.\n\n' : '') +
      (gekozenOnderdelen().length < state.onderdelen.length
        ? 'Alleen deze onderdelen: ' + gekozenOnderdelen().join(', ') + '.\n\n'
        : '') +
      '"' + state.selected + '" gaat naar:\n· ' + names.join('\n· ') +
      '\n\nVan elke server wordt eerst een back-up gemaakt.' +
      (requireText ? '\n\nTyp ter bevestiging: ' + requireText : ''),
    confirmLabel: opnieuw ? 'Opnieuw' : 'Toepassen',
    danger: $('prune').checked,
    requireText,
  });
  if (!confirmed) return;

  const body = { ...planBody(), guildIds: ids };
  planSleutel = null;
  $('planResult').classList.remove('verouderd');
  $('planResult').innerHTML = busy('Toepassen…');

  try {
    // Elke rol en elk kanaal is een apart verzoek aan Discord; een volle
    // template haalt de standaarddeadline niet. Dan lijkt het mislukt terwijl
    // hij gewoon nog bezig is.
    const data = await api('/apply', { method: 'POST', body: JSON.stringify(body), timeout: 5 * 60 * 1000 });

    $('planResult').innerHTML = data.results
      .map((result) =>
        '<div class="planblok"><strong>' + escape(result.guildName) + '</strong>' +
        '<div class="note ' + (result.failed ? 'warn' : 'ok') + '" style="margin-top:6px">' +
        escape(result.note || result.applied + ' acties gelukt, ' + result.failed + ' mislukt') +
        (result.backup ? ' · back-up gemaakt' : '') + '</div>' +
        (result.errors.length ? '<pre class="actions">' + escape(result.errors.join('\n')) + '</pre>' : '') +
        // Alles overnieuw doen om twee mislukte acties is zonde van de tijd, en
        // het plan wordt toch opnieuw uitgerekend: wat al klopt blijft met rust.
        (result.failed
          ? '<div class="planvoet"><button class="btn-sm" data-doe="opnieuw" data-guild="' +
            escape(result.guildId) + '">' + icon('refresh', 'sm') + 'Alleen deze opnieuw</button></div>'
          : '') +
        '</div>')
      .join('');

    state.uitgerold = data.results.some((resultaat) => resultaat.applied > 0);
    tekenWizard();
    toast(data.failed ? data.applied + ' gelukt, ' + data.failed + ' mislukt' : 'Uitgerold: ' + data.applied + ' acties',
      data.failed ? 'bad' : 'ok');

    await naControle(body);
    await laadDrift(true);
    await refresh();
    if (state.session?.authEnabled) await checkSession();
  } catch (error) {
    $('planResult').innerHTML = '<div class="note bad" style="margin-top:12px">' + escape(error.message) + '</div>';
  }
}

async function restoreBackup(file) {
  const backup = state.backups.find((candidate) => candidate.file === file);

  // Twee manieren, en het verschil is te groot om achter één knop te verstoppen.
  const hoe = await kiesUit({
    title: 'Back-up terugzetten',
    body: 'Van "' + backup.guildName + '", ' + prettyStamp(backup.createdAt) + '.',
    opties: [
      {
        waarde: 'aanvullen',
        naam: 'Aanvullen en bijwerken',
        uitleg: 'Zet terug wat in de back-up staat. Wat er sindsdien bij is gekomen blijft staan.',
      },
      {
        waarde: 'volledig',
        naam: 'Volledig terugzetten',
        uitleg: 'Ook weghalen wat niet in de back-up stond. Daarna is de server weer zoals toen.',
      },
    ],
  });
  if (!hoe) return;

  const volledig = hoe === 'volledig';
  const akkoord = await ask({
    title: volledig ? 'Volledig terugzetten?' : 'Back-up terugzetten?',
    body: volledig
      ? 'Kanalen en categorieën die er nu zijn maar niet in deze back-up staan, worden VERWIJDERD - ' +
        'inclusief de berichten erin. Een back-up bewaart de structuur, niet wat erin gezegd is.\n\n' +
        'Van de huidige stand wordt eerst een momentopname gemaakt.\n\nTyp ter bevestiging: ' + backup.guildName
      : 'Dit vult aan en werkt bij. Verwijderde kanalen en hun berichten komen niet terug.',
    confirmLabel: 'Terugzetten',
    danger: volledig,
    requireText: volledig ? backup.guildName : null,
  });
  if (!akkoord) return;

  await zetTerug({ file, volledig }, backup.guildName);
}

/**
 * Een back-up uit een bestand op je eigen apparaat. Zonder dit is een
 * gedownloade back-up een bestand waar je niets mee kunt.
 */
async function backupUitBestand(bestand) {
  let inhoud;
  try {
    inhoud = await bestand.text();
  } catch {
    return toast('Kon het bestand niet lezen.', 'bad');
  }

  const doel = await kiesServer('Op welke server terugzetten?');
  if (!doel) return;

  const server = state.guilds.find((guild) => guild.id === doel);
  const akkoord = await ask({
    title: 'Back-up terugzetten?',
    body:
      'Uit "' + bestand.name + '", op "' + (server?.name ?? doel) + '".\n\n' +
      'Dit vult aan en werkt bij; er wordt niets verwijderd. Let op: je zet hier de structuur van ' +
      'de ene server op de andere, dus kijk of dat is wat je bedoelt.',
    confirmLabel: 'Terugzetten',
  });
  if (!akkoord) return;

  await zetTerug({ inhoud, guildId: doel }, server?.name ?? doel);
}

/** Kies een van je servers. Bij precies één is er niets te kiezen. */
async function kiesServer(titel) {
  if (state.guilds.length === 0) {
    toast('Geen server om naar terug te zetten.', 'bad');
    return null;
  }
  if (state.guilds.length === 1) return state.guilds[0].id;

  return kiesUit({
    title: titel,
    opties: state.guilds.map((guild) => ({
      waarde: guild.id,
      naam: guild.name,
      uitleg: guild.memberCount + ' leden · ' + guild.channelCount + ' kanalen',
    })),
  });
}

async function zetTerug(body, naam) {
  const doel = $('backupResult');
  doel.innerHTML = busy('Terugzetten…');

  try {
    const result = await api('/backups/restore', {
      method: 'POST',
      body: JSON.stringify(body),
      timeout: 5 * 60 * 1000,
    });
    const rest = (result.leftover || 0) + (result.mismatch || 0);

    doel.innerHTML =
      '<div class="note ' + (result.failed ? 'warn' : 'ok') + '" style="margin-top:12px">' +
      escape(naam + ': ' + (result.note || result.applied + ' acties gelukt, ' + result.failed + ' mislukt')) +
      (result.backup ? ' · momentopname vooraf gemaakt' : '') +
      '</div>' +
      (rest > 0
        ? '<div class="note warn" style="margin-top:8px">' + rest +
          ' onderdeel(en) staan er nog die niet in deze back-up zaten. ' +
          (body.volledig
            ? 'Die konden niet weg - kijk in de tab Server wat het is.'
            : 'Aanvullen verwijdert niets, dus de server is niet identiek aan de back-up. Kijk in de tab ' +
              'Server om te zien wat er afwijkt.') +
          '</div>'
        : '');

    toast(rest > 0 ? 'Teruggezet, maar niet identiek' : 'Back-up teruggezet', rest > 0 ? 'bad' : 'ok');
    await refresh();
  } catch (error) {
    doel.innerHTML = '<div class="note bad" style="margin-top:12px">' + escape(error.message) + '</div>';
  }
}

// --- handlers --------------------------------------------------------------

$('backupUit').onclick = () => $('backupBestand').click();
$('backupBestand').onchange = async () => {
  const bestand = $('backupBestand').files[0];
  $('backupBestand').value = '';
  if (bestand) await backupUitBestand(bestand);
};

for (const knop of document.querySelectorAll('#mobilenav button[data-scherm], #sidebar button, #meerBlad button[data-scherm]')) {
  knop.onclick = () => {
    $('meerBlad').close();
    toonScherm(knop.dataset.scherm);
  };
}

// --- het blad met de overige schermen ---------------------------------------

$('meerKnop').onclick = () => $('meerBlad').showModal();
$('bladSluit').onclick = () => $('meerBlad').close();
$('bladThema').onclick = () => {
  $('themeToggle').click();
  $('meerBlad').close();
};

// Tikken naast het blad sluit het ook; een dialog vangt die klik zelf op.
$('meerBlad').onclick = (event) => {
  if (event.target === $('meerBlad')) $('meerBlad').close();
};

$('tabTree').onclick = () => showTab('Tree');
$('tabJson').onclick = () => showTab('Json');
$('tabCheck').onclick = () => showTab('Check');
$('tabServer').onclick = () => showTab('Server');
$('runCompare').onclick = () => runCompare();
$('undo').onclick = undo;
$('redo').onclick = redo;
$('runCheck').onclick = () => runCheck();
$('save').onclick = save;

/**
 * Springen zonder te zoeken waar iets staat.
 *
 * Met acht schermen, je templates en je servers erbij is klikken langs de
 * zijbalk de langste weg. Ctrl+K (of Cmd+K) opent een lijst waarin je typt.
 */
function paletKeuzes() {
  const schermen = [
    ['overzicht', 'Overzicht'],
    ['templates', 'Templates'],
    ['servers', 'Servers'],
    ['uitrollen', 'Uitrollen'],
    ['clan', 'Clan'],
    ['geschiedenis', 'Geschiedenis'],
    ['backups', 'Back-ups'],
    ['instellingen', 'Instellingen'],
  ];

  const keuzes = schermen.map(([scherm, naam]) => ({
    naam,
    uitleg: 'Ga naar dit scherm',
    doe: () => toonScherm(scherm),
  }));

  for (const template of state.templates) {
    keuzes.push({
      naam: template.id,
      uitleg: 'Template openen',
      doe: async () => {
        await select(template.id);
        toonScherm('bewerken');
      },
    });
  }

  for (const guild of state.guilds) {
    keuzes.push({
      naam: guild.name,
      uitleg: 'Deze server uitrollen',
      doe: () => {
        toonScherm('uitrollen');
        kiesAlleenServer(guild.id);
      },
    });
  }

  if (state.selected) {
    keuzes.push({ naam: 'Preview draaien', uitleg: 'Voor "' + state.selected + '"', doe: () => preview() });
  }

  return keuzes;
}

async function palet() {
  const keuze = await zoekUit({ title: 'Waar wil je heen?', items: paletKeuzes() });
  if (keuze) await keuze.doe();
}

$('paletKnop').onclick = () => void palet();

document.addEventListener('keydown', (gebeurtenis) => {
  const metToets = gebeurtenis.metaKey || gebeurtenis.ctrlKey;
  if (!metToets) return;

  if (gebeurtenis.key === 'k' || gebeurtenis.key === 'K') {
    gebeurtenis.preventDefault();
    void palet();
    return;
  }

  // Opslaan waar je het verwacht: in de editor. Zonder dit bood de browser aan
  // om de hele pagina als bestand te bewaren.
  if ((gebeurtenis.key === 's' || gebeurtenis.key === 'S') && state.selected && VIEW_VAN[state.scherm] === 'templates') {
    gebeurtenis.preventDefault();
    void save();
  }
});
$('preview').onclick = () => preview();
$('apply').onclick = () => apply();

// De knoppen in het plan worden telkens opnieuw getekend; daarom hier, op het
// vak eromheen, in plaats van op elke knop apart.
$('planResult').addEventListener('click', (gebeurtenis) => {
  const knop = gebeurtenis.target.closest('[data-doe]');
  if (!knop) return;
  if (knop.dataset.doe === 'preview') void preview();
  if (knop.dataset.doe === 'apply') void apply();
  if (knop.dataset.doe === 'opnieuw') void apply([knop.dataset.guild], true);
});

// Verandert er iets aan de keuzes, dan klopt een plan dat er al staat niet meer.
$('scherm-uitrollen').addEventListener('change', markeerVerouderd);
$('scherm-uitrollen').addEventListener('input', markeerVerouderd);
$('editor').oninput = () => setDirty(true);

$('revert').onclick = () => {
  $('editor').value = state.original;
  setDirty(false);
  renderTree();
};

$('allGuilds').onclick = () => {
  for (const input of document.querySelectorAll('.guildpick')) input.checked = true;
};
$('noGuilds').onclick = () => {
  for (const input of document.querySelectorAll('.guildpick')) input.checked = false;
};

$('allOnderdelen').onclick = () => {
  for (const input of document.querySelectorAll('.onderdeelpick')) input.checked = true;
  toonOnderdeelKop();
};
$('noOnderdelen').onclick = () => {
  for (const input of document.querySelectorAll('.onderdeelpick')) input.checked = false;
  toonOnderdeelKop();
};

$('newTemplate').onclick = async () => {
  const name = await ask({
    title: 'Nieuwe template',
    body: 'Letters, cijfers en streepjes.',
    confirmLabel: 'Aanmaken',
    input: { value: '', placeholder: 'bijvoorbeeld: mijn-server' },
  });
  if (!name) return;

  try {
    const created = await api('/templates', { method: 'POST', body: JSON.stringify({ id: name }) });
    await refresh();
    await select(created.id);
    toast('Template "' + created.id + '" aangemaakt', 'ok');
  } catch (error) {
    toast(error.message, 'bad');
  }
};

$('dupTemplate').onclick = async () => {
  const name = await ask({
    title: 'Template kopiëren',
    body: 'Kopie van "' + state.selected + '".',
    confirmLabel: 'Kopiëren',
    input: { value: state.selected + '-kopie' },
  });
  if (!name) return;

  try {
    const created = await api('/templates', { method: 'POST', body: JSON.stringify({ id: name, from: state.selected }) });
    await refresh();
    await select(created.id);
    toast('Gekopieerd naar "' + created.id + '"', 'ok');
  } catch (error) {
    toast(error.message, 'bad');
  }
};

$('delTemplate').onclick = async () => {
  const confirmed = await ask({
    title: 'Template verwijderen?',
    body: '"' + state.selected + '" wordt van schijf verwijderd. Eerdere versies blijven staan in history/.',
    confirmLabel: 'Verwijderen',
    danger: true,
  });
  if (!confirmed) return;

  const removed = state.selected;
  await api('/templates/' + removed, { method: 'DELETE' });
  state.selected = null;
  state.template = null;
  $('editor').value = '';
  $('editorTitle').textContent = 'Geen template gekozen';
  $('treeView').innerHTML = emptyState('file', 'Kies links een template om te bewerken.');
  await refresh();
  toast('"' + removed + '" verwijderd', 'ok');
};

/** Een bestaande server uitlezen en als nieuwe template opslaan. */
async function exportGuild(guildId) {
  if (!guildId) return toast('Vink eerst een server aan.', 'bad');

  const exported = await api('/export/' + guildId);
  const name = await ask({
    title: 'Server opslaan als template',
    confirmLabel: 'Opslaan',
    input: { value: exported.id },
  });
  if (!name) return;

  try {
    const created = await api('/templates', { method: 'POST', body: JSON.stringify({ id: name }) });
    await api('/templates/' + created.id, { method: 'PUT', body: JSON.stringify({ json: exported.json }) });
    await refresh();
    await select(created.id);
    toast('Opgeslagen als "' + created.id + '"', 'ok');
  } catch (error) {
    toast(error.message, 'bad');
  }
}

$('exportGuild').onclick = () => exportGuild(selectedGuilds()[0]);
$('terugNaarServers').onclick = () => toonScherm('servers');

$('download').onclick = () => {
  if (!state.selected) return;
  bewaarBestand(state.selected + '.json', $('editor').value);
};

$('importTemplate').onclick = () => $('importFile').click();

$('importFile').onchange = async () => {
  const bestand = $('importFile').files[0];
  if (!bestand) return;

  const inhoud = await bestand.text();
  $('importFile').value = '';

  const naam = await ask({
    title: 'Template importeren',
    body: 'Uit ' + bestand.name + '.',
    confirmLabel: 'Importeren',
    input: { value: bestand.name.replace(/\.json$/i, '') },
  });
  if (!naam) return;

  try {
    const gemaakt = await api('/templates', { method: 'POST', body: JSON.stringify({ id: naam }) });
    await api('/templates/' + gemaakt.id, { method: 'PUT', body: JSON.stringify({ json: inhoud }) });
    await refresh();
    await select(gemaakt.id);
    toast('Geïmporteerd als "' + gemaakt.id + '"', 'ok');
  } catch (error) {
    toast(error.message.split('\n')[0], 'bad', 6000);
  }
};

document.addEventListener('keydown', (event) => {
  if (!(event.metaKey || event.ctrlKey)) return;

  if (event.key === 's') {
    event.preventDefault();
    save();
    return;
  }

  // In de JSON-tab houdt de browser zijn eigen tekst-undo; die laten we met rust.
  const inTextarea = event.target instanceof HTMLTextAreaElement;
  if (event.key.toLowerCase() === 'z' && !inTextarea) {
    event.preventDefault();
    if (event.shiftKey) redo(); else undo();
  }
});

window.addEventListener('beforeunload', (event) => {
  if (state.dirty) event.preventDefault();
});

initTheme($('themeToggle'));
koppelClan({ api, state });
toonScherm('overzicht');

checkSession()
  .then((allowed) => (allowed ? refresh() : undefined))
  .catch((error) => {
    $('botName').textContent = 'Verbinding mislukt';
    $('botSub').innerHTML =
      '<span style="color:var(--bad)">' + escape(error.message) + '</span>';
    $('templateList').innerHTML =
      '<div class="note bad" style="margin:12px">' + escape(error.message) +
      '<br><br>Herlaad de pagina zodra het dashboard weer draait.</div>';
    $('gate').hidden = true;
  });
