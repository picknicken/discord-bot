import { renderEditor, resetSelection } from './editor.js';
import { ask, busy, CHANNEL_ICONS, emptyState, escapeHtml as escape, icon, initTheme, toast } from './ui.js';

const state = {
  templates: [], guilds: [], backups: [], permissions: [],
  selected: null, original: '', simRole: null, template: null, dirty: false,
  session: null, scherm: 'templates', fouten: null, uitgerold: false,
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

async function api(path, options = {}) {
  let response;
  try {
    // Zonder deadline blijft de pagina eeuwig "laden" als er niets terugkomt.
    response = await fetch('/api' + path, {
      ...options,
      headers: options.body ? { 'content-type': 'application/json' } : {},
      signal: AbortSignal.timeout(30000),
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

/** Op een telefoon staat er een scherm tegelijk; op een breed scherm alles naast elkaar. */
function toonScherm(naam) {
  state.scherm = naam;
  const paneel = naam === 'controle' ? 'bewerken' : naam;

  for (const sectie of document.querySelectorAll('.grid > section')) {
    sectie.classList.toggle('actief', sectie.id === 'scherm-' + paneel);
  }
  for (const knop of document.querySelectorAll('#mobilenav button')) {
    knop.setAttribute('aria-current', String(knop.dataset.scherm === naam));
  }

  if (naam === 'controle') showTab('Check');
  else if (naam === 'bewerken' && $('treeView').hidden) showTab('Tree');

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
    { naam: 'Template', klaar: Boolean(state.selected), scherm: 'templates' },
    { naam: 'Rollen', klaar: Boolean(t && t.roles.length), scherm: 'bewerken' },
    { naam: 'Kanalen', klaar: kanalen > 0, scherm: 'bewerken' },
    { naam: 'Rechten', klaar: overwrites, scherm: 'bewerken' },
    { naam: 'Controle', klaar: state.fouten === 0, scherm: 'controle' },
    { naam: 'Toepassen', klaar: state.uitgerold, scherm: 'uitrollen' },
  ];
}

function tekenWizard() {
  const rail = $('wizard');
  const lijst = stappen();
  const nu = lijst.findIndex((stap) => !stap.klaar);

  rail.hidden = false;
  rail.innerHTML = lijst
    .map((stap, index) => {
      const klasse = stap.klaar ? 'klaar' : index === nu ? 'nu' : '';
      const bol = stap.klaar ? icon('check', 'sm') : String(index + 1);
      return (
        '<button class="' + klasse + '" data-stap="' + stap.scherm + '">' +
        '<span class="bol">' + bol + '</span>' + escape(stap.naam) + '</button>'
      );
    })
    .join('');

  for (const knop of rail.querySelectorAll('[data-stap]')) {
    knop.onclick = () => toonScherm(knop.dataset.stap);
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
  state.permissions = data.permissions || [];

  $('avatar').src = data.avatarUrl;
  $('botName').textContent = data.botName;
  $('botSub').innerHTML =
    '<span class="dot-live"></span>' +
    escape(data.guilds.length + ' server' + (data.guilds.length === 1 ? '' : 's')) +
    ' · ' + escape(data.templates.length + ' templates') +
    ' · <span class="mono pad">' + escape(data.templatesDir) + '</span>';

  renderTemplates();
  renderGuilds();
  renderBackups();
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

function renderGuilds() {
  const list = $('guildList');
  if (state.guilds.length === 0) {
    list.innerHTML = emptyState('server', 'De bot zit nog in geen enkele server.');
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
      ].join(' ');

      const on = checked.size ? checked.has(guild.id) : index === 0;
      return (
        '<label class="guildrow"><input type="checkbox" class="guildpick" value="' + escape(guild.id) + '"' +
        (on ? ' checked' : '') + '><span class="grow"><strong>' + escape(guild.name) + '</strong>' +
        '<div class="meta">' + guild.memberCount + ' leden · ' + guild.channelCount + ' kanalen · ' +
        guild.roleCount + ' rollen</div><div class="meta" style="margin-top:4px">' + badges + '</div>' +
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
      '<button class="btn-sm" data-backup="' + escape(backup.file) + '">' + icon('undo', 'sm') + 'Terug</button></div>')
    .join('');

  for (const button of list.querySelectorAll('[data-backup]')) {
    button.onclick = () => restoreBackup(button.dataset.backup);
  }
}

// --- template kiezen en bewerken -------------------------------------------

async function select(id) {
  state.selected = id;
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
      '<div class="toen">' + escape(prettyStamp(version.stamp)) + '</div></span>' +
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

/** Zet tekst als bestand klaar in de browser. */
function bewaarBestand(naam, inhoud) {
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
        s.messages ? s.messages + ' berichten' : '',
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

const colorize = (lines) =>
  lines
    .map((line) => {
      const cls = line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : line.startsWith('~') ? 'mod' : '';
      return '<span class="' + cls + '">' + escape(line) + '</span>';
    })
    .join('\n');

// --- uitrollen -------------------------------------------------------------

const planBody = () => ({
  templateId: state.selected,
  guildIds: selectedGuilds(),
  prune: $('prune').checked,
  update: $('update').checked,
});

async function preview() {
  if (!state.selected) return toast('Kies eerst een template.', 'bad');
  if (selectedGuilds().length === 0) return toast('Vink minstens een server aan.', 'bad');

  $('planResult').innerHTML = busy('Plan berekenen…');
  try {
    const data = await api('/plan', { method: 'POST', body: JSON.stringify(planBody()) });
    $('planResult').innerHTML = data.plans
      .map((plan) =>
        '<div style="margin-top:14px"><div class="spread"><strong>' + escape(plan.guildName) + '</strong>' +
        '<span class="badge">' + plan.count + ' acties</span></div>' +
        '<div class="note ok" style="margin-top:6px">' + escape(plan.summary) + '</div>' +
        (plan.warnings.length ? '<div class="note warn" style="margin-top:6px">' + escape(plan.warnings.join('\n')) + '</div>' : '') +
        (plan.actions.length ? '<pre class="actions">' + colorize(plan.actions) + '</pre>' : '') + '</div>')
      .join('');
  } catch (error) {
    $('planResult').innerHTML = '<div class="note bad" style="margin-top:12px">' + escape(error.message) + '</div>';
  }
}

async function apply() {
  if (!state.selected) return toast('Kies eerst een template.', 'bad');
  const targets = state.guilds.filter((guild) => selectedGuilds().includes(guild.id));
  if (targets.length === 0) return toast('Vink minstens een server aan.', 'bad');

  const names = targets.map((guild) => guild.name);
  const requireText = targets.length === 1 ? names[0] : 'TOEPASSEN';

  const confirmed = await ask({
    title: 'Template toepassen?',
    body:
      ($('prune').checked ? 'LET OP: kanalen die niet in de template staan worden VERWIJDERD.\n\n' : '') +
      '"' + state.selected + '" gaat naar:\n· ' + names.join('\n· ') +
      '\n\nVan elke server wordt eerst een back-up gemaakt.\n\nTyp ter bevestiging: ' + requireText,
    confirmLabel: 'Toepassen',
    danger: $('prune').checked,
    requireText,
  });
  if (!confirmed) return;

  $('planResult').innerHTML = busy('Toepassen…');
  try {
    const data = await api('/apply', { method: 'POST', body: JSON.stringify(planBody()) });
    $('planResult').innerHTML = data.results
      .map((result) =>
        '<div style="margin-top:14px"><strong>' + escape(result.guildName) + '</strong>' +
        '<div class="note ' + (result.failed ? 'warn' : 'ok') + '" style="margin-top:6px">' +
        escape(result.note || result.applied + ' acties gelukt, ' + result.failed + ' mislukt') +
        (result.backup ? ' · back-up gemaakt' : '') + '</div>' +
        (result.errors.length ? '<pre class="actions">' + escape(result.errors.join('\n')) + '</pre>' : '') +
        '</div>')
      .join('');

    state.uitgerold = data.results.some((resultaat) => resultaat.applied > 0);
    tekenWizard();
    toast(data.failed ? data.applied + ' gelukt, ' + data.failed + ' mislukt' : 'Uitgerold: ' + data.applied + ' acties',
      data.failed ? 'bad' : 'ok');
    await refresh();
    if (state.session?.authEnabled) await checkSession();
  } catch (error) {
    $('planResult').innerHTML = '<div class="note bad" style="margin-top:12px">' + escape(error.message) + '</div>';
  }
}

async function restoreBackup(file) {
  const backup = state.backups.find((candidate) => candidate.file === file);
  const confirmed = await ask({
    title: 'Back-up terugzetten?',
    body:
      'Van "' + backup.guildName + '", ' + backup.createdAt.slice(0, 16).replace('T', ' ') + '.\n\n' +
      'Dit vult aan en werkt bij. Verwijderde kanalen en hun berichten komen niet terug.',
    confirmLabel: 'Terugzetten',
  });
  if (!confirmed) return;

  $('planResult').innerHTML = busy('Terugzetten…');
  try {
    const result = await api('/backups/restore', { method: 'POST', body: JSON.stringify({ file }) });
    const rest = (result.leftover || 0) + (result.mismatch || 0);

    $('planResult').innerHTML =
      '<div class="note ' + (result.failed ? 'warn' : 'ok') + '" style="margin-top:12px">' +
      escape(result.note || result.applied + ' acties gelukt, ' + result.failed + ' mislukt') + '</div>' +
      (rest > 0
        ? '<div class="note warn" style="margin-top:8px">' + rest +
          ' onderdeel(en) staan er nog die niet in deze back-up zaten. Terugzetten vult aan en ' +
          'verwijdert niets, dus de server is niet identiek aan de back-up. Kijk in de tab ' +
          'Server om te zien wat er afwijkt.</div>'
        : '');

    toast(rest > 0 ? 'Teruggezet, maar niet identiek' : 'Back-up teruggezet', rest > 0 ? 'bad' : 'ok');
    await refresh();
  } catch (error) {
    $('planResult').innerHTML = '<div class="note bad" style="margin-top:12px">' + escape(error.message) + '</div>';
  }
}

// --- handlers --------------------------------------------------------------

for (const knop of document.querySelectorAll('#mobilenav button')) {
  knop.onclick = () => toonScherm(knop.dataset.scherm);
}

$('tabTree').onclick = () => showTab('Tree');
$('tabJson').onclick = () => showTab('Json');
$('tabCheck').onclick = () => showTab('Check');
$('tabServer').onclick = () => showTab('Server');
$('runCompare').onclick = () => runCompare();
$('undo').onclick = undo;
$('redo').onclick = redo;
$('runCheck').onclick = () => runCheck();
$('save').onclick = save;
$('preview').onclick = preview;
$('apply').onclick = apply;
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

$('exportGuild').onclick = async () => {
  const guildId = selectedGuilds()[0];
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
};

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
toonScherm('templates');

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
