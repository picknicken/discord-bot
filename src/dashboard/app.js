import { renderEditor, resetSelection } from './editor.js';

const state = { templates: [], guilds: [], backups: [], permissions: [], selected: null, original: '', simRole: null, template: null };
const $ = (id) => document.getElementById(id);

async function api(path, options = {}) {
  const response = await fetch('/api' + path, {
    ...options,
    headers: options.body ? { 'content-type': 'application/json' } : {},
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || ('HTTP ' + response.status));
  return data;
}

async function refresh() {
  const data = await api('/state');
  state.templates = data.templates;
  state.guilds = data.guilds;

  state.backups = data.backups || [];
  state.permissions = data.permissions || [];

  $('avatar').src = data.avatarUrl;
  $('botName').textContent = data.botName;
  $('botSub').textContent =
    data.guilds.length + ' server(s) · ' + data.templates.length + ' templates · ' + data.templatesDir;

  renderTemplates();
  renderGuilds();
  renderBackups();
}

function renderTemplates() {
  const list = $('templateList');
  list.innerHTML = '';

  for (const template of state.templates) {
    const button = document.createElement('button');
    button.className = 'item';
    button.setAttribute('aria-selected', String(template.id === state.selected));
    button.innerHTML = template.error
      ? '<strong>' + escape(template.id) + '</strong><small class="bad">⚠ ' + escape(template.error.split('\n')[0]) + '</small>'
      : '<strong>' + escape(template.id) + '</strong><small>' +
        template.roles + ' rollen · ' + template.categories + ' cat · ' + template.channels + ' kanalen</small>';
    button.onclick = () => select(template.id);
    list.appendChild(button);
  }

  $('dupTemplate').disabled = !state.selected;
  $('delTemplate').disabled = !state.selected;
}

function renderGuilds() {
  const list = $('guildList');
  if (state.guilds.length === 0) {
    list.innerHTML = '<p class="muted">De bot zit nog in geen enkele server.</p>';
    return;
  }

  const checked = new Set(selectedGuilds());
  list.innerHTML = state.guilds.map((guild, index) => {
    const notes = [
      guild.missing.length ? '<span class="bad">mist ' + escape(guild.missing.join(', ')) + '</span>' : '',
      guild.rolesAbove > 0 ? '<span class="warn">' + guild.rolesAbove + ' rol(len) boven de bot</span>' : '',
    ].filter(Boolean).join(' · ');

    const on = checked.size ? checked.has(guild.id) : index === 0;
    return '<label class="guildrow"><input type="checkbox" class="guildpick" value="' + escape(guild.id) + '"' +
      (on ? ' checked' : '') + '><span><strong>' + escape(guild.name) + '</strong><div class="meta">' +
      guild.memberCount + ' leden · ' + guild.channelCount + ' kanalen · ' + guild.roleCount + ' rollen' +
      (notes ? '<br>' + notes : '') + '</div></span></label>';
  }).join('');
}

function selectedGuilds() {
  return [...document.querySelectorAll('.guildpick:checked')].map((input) => input.value);
}

function renderBackups() {
  const list = $('backupList');
  if (!state.backups || state.backups.length === 0) {
    list.innerHTML = '<p class="muted" style="font-size:12px">Nog geen back-ups.</p>';
    return;
  }

  list.innerHTML = state.backups.slice(0, 15).map((backup) =>
    '<div class="backup"><span>' + escape(backup.guildName) + '<br><span class="muted">' +
    escape(backup.createdAt.slice(0, 16).replace('T', ' ')) + ' · ' + backup.roles + ' rollen · ' +
    backup.channels + ' kanalen</span></span>' +
    '<button data-backup="' + escape(backup.file) + '">Terugzetten</button></div>').join('');

  for (const button of list.querySelectorAll('button[data-backup]')) {
    button.onclick = () => restoreBackup(button.dataset.backup);
  }
}

async function restoreBackup(file) {
  const backup = state.backups.find((candidate) => candidate.file === file);
  if (!confirm('Back-up van "' + backup.guildName + '" terugzetten?\n\nDit vult aan en werkt bij. Verwijderde kanalen komen niet terug.')) return;

  $('planResult').innerHTML = '<p class="muted">Bezig met terugzetten…</p>';
  try {
    const result = await api('/backups/restore', { method: 'POST', body: JSON.stringify({ file }) });
    $('planResult').innerHTML = '<div class="note ok" style="margin-top:12px">' +
      (result.note || result.applied + ' acties gelukt, ' + result.failed + ' mislukt') + '</div>';
    await refresh();
  } catch (error) {
    $('planResult').innerHTML = '<div class="note bad" style="margin-top:12px">' + escape(error.message) + '</div>';
  }
}

async function renderVersions() {
  const select = $('versions');
  if (!state.selected) { select.innerHTML = ''; return; }

  const data = await api('/templates/' + state.selected + '/versions');
  select.innerHTML = '<option value="">Versies (' + data.versions.length + ')</option>' +
    data.versions.map((version) =>
      '<option value="' + escape(version.stamp) + '">' +
      escape(version.stamp.slice(0, 16).replace('T', ' ').replace(/-(\d{2})-(\d{2})$/, ':$1')) +
      '</option>').join('');
}

async function select(id) {
  state.selected = id;
  const data = await api('/templates/' + id);
  state.original = data.json;
  $('editor').value = data.json;
  $('editorTitle').textContent = id;
  resetSelection();
  $('saveNote').textContent = '';
  renderTemplates();
  renderTree();
  await renderVersions();
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
      $('editor').value = JSON.stringify(state.template, null, 2);
      $('saveNote').textContent = 'niet opgeslagen';
    },
  });
}

function showTab(which) {
  for (const [tab, view] of [['tabTree', 'treeView'], ['tabJson', 'jsonView'], ['tabCheck', 'checkView']]) {
    const active = tab === 'tab' + which;
    $(tab).setAttribute('aria-selected', String(active));
    $(view).hidden = !active;
  }
  if (which === 'Tree') renderTree();
  if (which === 'Check') runCheck();
}

async function runCheck(role) {
  if (!state.selected) return;
  const target = $('checkResult');
  target.innerHTML = '<p class="muted">Bezig…</p>';

  try {
    const data = await api('/analyze', {
      method: 'POST',
      body: JSON.stringify({ json: $('editor').value, role: role || state.simRole }),
    });
    state.simRole = data.simulation ? data.simulation.role : null;
    target.innerHTML = renderCheck(data);
    const picker = $('simRole');
    if (picker) picker.onchange = () => runCheck(picker.value);
  } catch (error) {
    target.innerHTML = '<div class="note bad">' + escape(error.message) + '</div>';
  }
}

function renderCheck(data) {
  const counts =
    '<div class="counts">' +
    [['error', 'fouten'], ['warning', 'waarschuwingen'], ['info', 'opmerkingen']]
      .map(([key, label]) =>
        '<div><b class="' + (data.counts[key] ? key : 'muted') + '" style="color:var(--' +
        (key === 'error' ? 'bad' : key === 'warning' ? 'warn' : 'muted') + ')">' +
        data.counts[key] + '</b><span class="muted">' + label + '</span></div>')
      .join('') +
    '</div>';

  const findings = data.findings.length
    ? data.findings.map((finding) =>
        '<div class="finding"><span class="sev ' + finding.severity + '">' + finding.severity +
        '</span><span>' + escape(finding.message) + ' <span class="where">— ' + escape(finding.where) +
        '</span></span></div>').join('')
    : '<div class="note ok">Niets gevonden. Deze template kan de deur uit.</div>';

  const simulation = data.simulation;
  const options = data.roles
    .map((role) => '<option value="' + escape(role.key) + '"' +
      (simulation && role.key === simulation.role ? ' selected' : '') + '>' + escape(role.name) + '</option>')
    .join('');

  const tree = simulation
    ? simulation.categories.map((category) =>
        '<div class="cat"><h3>' + escape(category.name) + '</h3><ul>' +
        category.channels.map((channel) =>
          '<li><div class="vis ' + (channel.visible ? '' : 'off') + '">' +
          '<span class="eye">' + (channel.visible ? '✓' : '·') + '</span>' +
          '<span class="type">' + escape(channel.type) + '</span>' +
          '<span>' + escape(channel.name) + '</span>' +
          '<span class="why">' + escape(channel.reason) + '</span></div></li>').join('') +
        '</ul></div>').join('')
    : '';

  return counts + '<div class="panel" style="margin-bottom:16px"><div class="body">' + findings + '</div></div>' +
    '<h3 style="font-size:13px">Wat ziet ' + (simulation ? escape(simulation.roleName) : '') + '?</h3>' +
    '<div class="row"><select id="simRole">' + options + '</select>' +
    (simulation ? '<span class="muted">' + simulation.visibleCount + ' van ' + simulation.totalCount +
      ' kanalen zichtbaar' + (simulation.administrator ? ' (Administrator)' : '') + '</span>' : '') +
    '</div>' + tree;
}

function escape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function colorize(lines) {
  return lines.map((line) => {
    const cls = line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : line.startsWith('~') ? 'mod' : '';
    return '<span class="' + cls + '">' + escape(line) + '</span>';
  }).join('\n');
}

// --- Acties ---------------------------------------------------------------

$('tabTree').onclick = () => showTab('Tree');
$('tabJson').onclick = () => showTab('Json');
$('tabCheck').onclick = () => showTab('Check');
$('runCheck').onclick = () => runCheck();
$('allGuilds').onclick = () => {
  for (const input of document.querySelectorAll('.guildpick')) input.checked = true;
};
$('noGuilds').onclick = () => {
  for (const input of document.querySelectorAll('.guildpick')) input.checked = false;
};
$('versions').onchange = async () => {
  const stamp = $('versions').value;
  if (!stamp) return;
  if (!confirm('Deze versie terugzetten? De huidige inhoud wordt als versie bewaard.')) return;
  const data = await api('/templates/' + state.selected + '/restore', {
    method: 'POST',
    body: JSON.stringify({ stamp }),
  });
  $('editor').value = data.json;
  state.original = data.json;
  $('saveNote').innerHTML = '<span class="ok">versie teruggezet</span>';
  renderTree();
  await renderVersions();
};
$('editor').oninput = () => { $('saveNote').textContent = 'niet opgeslagen'; };

$('save').onclick = async () => {
  try {
    await api('/templates/' + state.selected, { method: 'PUT', body: JSON.stringify({ json: $('editor').value }) });
    state.original = $('editor').value;
    $('saveNote').innerHTML = '<span class="ok">opgeslagen</span>';
    await refresh();
    renderTree();
  } catch (error) {
    $('saveNote').innerHTML = '';
    $('planResult').innerHTML = '<div class="note bad" style="margin-top:10px">' + escape(error.message) + '</div>';
  }
};

$('revert').onclick = () => { $('editor').value = state.original; $('saveNote').textContent = ''; renderTree(); };

$('newTemplate').onclick = async () => {
  const name = prompt('Naam van de nieuwe template?');
  if (!name) return;
  const created = await api('/templates', { method: 'POST', body: JSON.stringify({ id: name }) });
  await refresh();
  await select(created.id);
};

$('dupTemplate').onclick = async () => {
  const name = prompt('Naam van de kopie?', state.selected + '-kopie');
  if (!name) return;
  const created = await api('/templates', { method: 'POST', body: JSON.stringify({ id: name, from: state.selected }) });
  await refresh();
  await select(created.id);
};

$('delTemplate').onclick = async () => {
  if (!confirm('"' + state.selected + '" verwijderen?')) return;
  await api('/templates/' + state.selected, { method: 'DELETE' });
  state.selected = null;
  $('editor').value = '';
  $('editorTitle').textContent = 'Geen template gekozen';
  $('treeView').innerHTML = '<p class="muted">Kies links een template.</p>';
  await refresh();
};

$('preview').onclick = async () => {
  if (!state.selected) return alert('Kies eerst een template.');
  if (selectedGuilds().length === 0) return alert('Vink minstens een server aan.');

  $('planResult').innerHTML = '<p class="muted">Bezig…</p>';
  try {
    const data = await api('/plan', { method: 'POST', body: JSON.stringify(planBody()) });
    $('planResult').innerHTML = data.plans.map((plan) =>
      '<div style="margin-top:12px"><strong>' + escape(plan.guildName) + '</strong>' +
      '<div class="note ok" style="margin-top:6px">' + escape(plan.summary) + '</div>' +
      (plan.warnings.length ? '<div class="note warn" style="margin-top:6px">' + escape(plan.warnings.join('\n')) + '</div>' : '') +
      (plan.actions.length ? '<pre class="actions">' + colorize(plan.actions) + '</pre>' : '') + '</div>').join('');
  } catch (error) {
    $('planResult').innerHTML = '<div class="note bad" style="margin-top:12px">' + escape(error.message) + '</div>';
  }
};

$('apply').onclick = async () => {
  if (!state.selected) return alert('Kies eerst een template.');
  const targets = state.guilds.filter((guild) => selectedGuilds().includes(guild.id));
  if (targets.length === 0) return alert('Vink minstens een server aan.');

  const names = targets.map((guild) => guild.name);
  const confirmation = targets.length === 1 ? names[0] : 'TOEPASSEN';
  const warning =
    (($('prune').checked
      ? 'LET OP: kanalen die niet in "' + state.selected + '" staan worden VERWIJDERD.\n\n'
      : '') +
      'Template "' + state.selected + '" toepassen op:\n· ' + names.join('\n· ') +
      '\n\nEr wordt eerst een back-up van elke server gemaakt.\n\nTyp "' + confirmation + '" om te bevestigen:');

  if (prompt(warning) !== confirmation) return alert('Niet bevestigd — er is niets gewijzigd.');

  $('planResult').innerHTML = '<p class="muted">Bezig met toepassen…</p>';
  try {
    const data = await api('/apply', { method: 'POST', body: JSON.stringify(planBody()) });
    $('planResult').innerHTML = data.results.map((result) =>
      '<div style="margin-top:12px"><strong>' + escape(result.guildName) + '</strong>' +
      '<div class="note ' + (result.failed ? 'warn' : 'ok') + '" style="margin-top:6px">' +
      (result.note || result.applied + ' acties gelukt, ' + result.failed + ' mislukt') +
      (result.backup ? ' · back-up gemaakt' : '') + '</div>' +
      (result.errors.length ? '<pre class="actions">' + escape(result.errors.join('\n')) + '</pre>' : '') +
      '</div>').join('');
    await refresh();
  } catch (error) {
    $('planResult').innerHTML = '<div class="note bad" style="margin-top:12px">' + escape(error.message) + '</div>';
  }
};

$('exportGuild').onclick = async () => {
  const guildId = selectedGuilds()[0];
  if (!guildId) return alert('Vink eerst een server aan.');
  const exported = await api('/export/' + guildId);
  const name = prompt('Opslaan als template met naam:', exported.id);
  if (!name) return;
  const created = await api('/templates', { method: 'POST', body: JSON.stringify({ id: name }) });
  await api('/templates/' + created.id, { method: 'PUT', body: JSON.stringify({ json: exported.json }) });
  await refresh();
  await select(created.id);
  alert('Opgeslagen als "' + created.id + '".');
};

function planBody() {
  return {
    templateId: state.selected,
    guildIds: selectedGuilds(),
    prune: $('prune').checked,
    update: $('update').checked,
  };
}

refresh().catch((error) => { $('botName').textContent = 'Fout: ' + error.message; });
