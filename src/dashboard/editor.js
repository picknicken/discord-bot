/**
 * De klik-editor. Werkt rechtstreeks op het template-object en roept onChange aan
 * zodra er iets verandert; opslaan en valideren blijft aan app.js.
 */

import { CHANNEL_ICONS, emptyState, escapeHtml, icon } from './ui.js';

const CHANNEL_TYPES = ['text', 'voice', 'forum', 'announcement', 'stage'];
const STATES = { 1: '✓', 0: '·', '-1': '✗' };
const STATE_TITLES = { 1: 'toestaan', 0: 'niet ingesteld', '-1': 'weigeren' };

let ctx = null;
let selection = { type: 'none' };
let showAllPermissions = false;

export function renderEditor(container, context) {
  ctx = context;
  draw(container);
}

export function resetSelection() {
  selection = { type: 'none' };
}

function changed() {
  ctx.onChange();
  draw(ctx.container);
}

function draw(container) {
  ctx.container = container;
  container.innerHTML =
    '<div class="editor"><div class="tree">' + tree() + '</div><div class="props">' + props() + '</div></div>';
  bind(container);
}

const esc = escapeHtml;

// --- boom ------------------------------------------------------------------

function tree() {
  const template = ctx.template;

  const roles = template.roles
    .map((role, index) => {
      const active = selection.type === 'role' && selection.index === index;
      return (
        '<li class="node' + (active ? ' on' : '') + '" data-pick="role" data-index="' + index + '">' +
        '<span class="dot" style="background:' + esc(role.color || 'var(--muted)') + '"></span>' +
        '<span class="grow truncate">' + esc(role.name) + '</span>' +
        '<span class="tools">' +
        moveButtons('role', index, template.roles.length) +
        '<button class="btn-icon" data-del="role" data-index="' + index + '" title="Verwijderen">' +
        icon('trash', 'sm') + '</button>' +
        '</span></li>'
      );
    })
    .join('');

  const categories = template.categories
    .map((category, categoryIndex) => {
      const activeCategory = selection.type === 'category' && selection.index === categoryIndex;
      const channels = category.channels
        .map((channel, channelIndex) => {
          const active =
            selection.type === 'channel' &&
            selection.category === categoryIndex &&
            selection.index === channelIndex;
          return (
            '<li class="node' + (active ? ' on' : '') + '" data-pick="channel" data-category="' +
            categoryIndex + '" data-index="' + channelIndex + '">' +
            icon(CHANNEL_ICONS[channel.type] || 'hash', 'sm') +
            '<span class="grow truncate">' + esc(channel.name) + '</span>' +
            '<span class="tools">' +
            moveButtons('channel', channelIndex, category.channels.length, categoryIndex) +
            '<button class="btn-icon" data-del="channel" data-category="' + categoryIndex + '" data-index="' +
            channelIndex + '" title="Verwijderen">' + icon('trash', 'sm') + '</button>' +
            '</span></li>'
          );
        })
        .join('');

      return (
        '<li class="group"><div class="node head' + (activeCategory ? ' on' : '') +
        '" data-pick="category" data-index="' + categoryIndex + '">' +
        icon('folder', 'sm') + '<span class="grow truncate"><strong>' + esc(category.name) + '</strong></span>' +
        '<span class="tools">' +
        moveButtons('category', categoryIndex, template.categories.length) +
        '<button class="btn-icon" data-add="channel" data-category="' + categoryIndex +
        '" title="Kanaal toevoegen">' + icon('plus', 'sm') + '</button>' +
        '<button class="btn-icon" data-del="category" data-index="' + categoryIndex + '" title="Verwijderen">' +
        icon('trash', 'sm') + '</button>' +
        '</span></div><ul>' + channels + '</ul></li>'
      );
    })
    .join('');

  const loose = template.uncategorizedChannels
    .map((channel, index) => {
      const active = selection.type === 'channel' && selection.category === null && selection.index === index;
      return (
        '<li class="node' + (active ? ' on' : '') + '" data-pick="channel" data-category="" data-index="' +
        index + '">' + icon(CHANNEL_ICONS[channel.type] || 'hash', 'sm') + '<span class="grow truncate">' +
        esc(channel.name) + '</span><span class="tools">' +
        '<button class="btn-icon" data-del="channel" data-category="" data-index="' + index +
        '" title="Verwijderen">' + icon('trash', 'sm') + '</button>' +
        '</span></li>'
      );
    })
    .join('');

  return (
    '<div class="treehead"><h4>Rollen</h4><button class="btn-sm" data-add="role">' + icon('plus', 'sm') +
    'Rol</button></div>' +
    '<p class="hint">Bovenaan staat de hoogste rol.</p>' +
    '<ul>' + (roles || '<li class="hint">nog geen rollen</li>') + '</ul>' +
    '<div class="treehead"><h4>Kanalen</h4><button class="btn-sm" data-add="category">' + icon('plus', 'sm') +
    'Categorie</button></div>' +
    '<ul>' + categories + '</ul>' +
    (loose ? '<div class="treehead"><h4>Zonder categorie</h4></div><ul>' + loose + '</ul>' : '')
  );
}

function moveButtons(kind, index, total, category) {
  const data =
    'data-move="' + kind + '" data-index="' + index +
    (category === undefined ? '' : '" data-category="' + category) + '"';
  return (
    '<button class="btn-icon" ' + data + ' data-dir="-1" title="Omhoog"' + (index === 0 ? ' disabled' : '') + '>' +
    icon('up', 'sm') + '</button>' +
    '<button class="btn-icon" ' + data + ' data-dir="1" title="Omlaag"' + (index === total - 1 ? ' disabled' : '') + '>' +
    icon('down', 'sm') + '</button>'
  );
}

// --- eigenschappen ---------------------------------------------------------

function props() {
  if (selection.type === 'role') return roleProps(ctx.template.roles[selection.index]);
  if (selection.type === 'category') return categoryProps(ctx.template.categories[selection.index]);
  if (selection.type === 'channel') return channelProps(currentChannel());
  return emptyState('shield', 'Kies links een rol, categorie of kanaal.');
}

function currentChannel() {
  return selection.category === null
    ? ctx.template.uncategorizedChannels[selection.index]
    : ctx.template.categories[selection.category].channels[selection.index];
}

function field(label, input, hint) {
  return (
    '<label class="field"><span>' + esc(label) + '</span>' + input +
    (hint ? '<small class="muted">' + esc(hint) + '</small>' : '') + '</label>'
  );
}

function text(name, value, extra = '') {
  return '<input type="text" data-edit="' + name + '" value="' + esc(value ?? '') + '" ' + extra + '>';
}

function checkbox(name, value, label) {
  return (
    '<label class="check"><input type="checkbox" data-edit="' + name + '"' + (value ? ' checked' : '') +
    '><span>' + esc(label) + '</span></label>'
  );
}

function roleProps(role) {
  if (!role) return '';

  const groups = ['Algemeen', 'Tekst', 'Spraak', 'Overig']
    .map((group) => {
      const items = ctx.permissions.filter((permission) => permission.group === group);
      if (items.length === 0) return '';
      return (
        '<details' + (group === 'Algemeen' ? ' open' : '') + '><summary>' + group + ' <span class="muted">(' +
        items.filter((item) => role.permissions.includes(item.name)).length + ')</span></summary><div class="perms">' +
        items
          .map(
            (permission) =>
              '<label class="check"><input type="checkbox" data-perm="' + permission.name + '"' +
              (role.permissions.includes(permission.name) ? ' checked' : '') + '><span>' +
              esc(permission.label) + '</span></label>',
          )
          .join('') +
        '</div></details>'
      );
    })
    .join('');

  return (
    '<h3>Rol</h3><p class="hint">Positie in de lijst bepaalt de hierarchie.</p>' +
    field('Naam', text('name', role.name)) +
    field('Kleur', '<input type="color" data-edit="color" value="' + esc(role.color || '#99aab5') + '">') +
    '<div class="row">' +
    checkbox('hoist', role.hoist, 'Apart tonen in de ledenlijst') +
    checkbox('mentionable', role.mentionable, 'Iedereen mag deze rol pingen') +
    '</div>' +
    '<h4>Rechten</h4>' +
    groups
  );
}

function categoryProps(category) {
  if (!category) return '';
  return (
    '<h3>Categorie</h3><p class="hint">Kanalen zonder eigen rechten erven die van hier.</p>' +
    field('Naam', text('name', category.name)) +
    matrix(category.overwrites, 'Rechten in deze categorie', 'Kanalen zonder eigen rechten erven deze.')
  );
}

function channelProps(channel) {
  if (!channel) return '';

  const types = CHANNEL_TYPES.map(
    (type) => '<option value="' + type + '"' + (channel.type === type ? ' selected' : '') + '>' + type + '</option>',
  ).join('');

  const messages = (channel.messages || [])
    .map(
      (message, index) =>
        '<div class="msg"><textarea data-message="' + index + '" rows="3">' + esc(message.content) +
        '</textarea><div class="row">' +
        '<label class="check"><input type="checkbox" data-messagepin="' + index + '"' +
        (message.pin ? ' checked' : '') + '><span>vastpinnen</span></label>' +
        '<button class="btn-sm btn-danger" data-delmessage="' + index + '">' + icon('trash', 'sm') +
        '</button></div></div>',
    )
    .join('');

  const forum =
    channel.type === 'forum'
      ? field('Tags', text('tags', (channel.tags || []).map((tag) => tag.name).join(', ')), 'Komma gescheiden') +
        field('Standaardreactie', text('defaultReaction', channel.defaultReaction || ''), 'Een emoji, bijvoorbeeld 👍')
      : '';

  const voice =
    channel.type === 'voice' || channel.type === 'stage'
      ? field(
          'Maximaal aantal leden',
          '<input type="number" min="0" max="99" data-edit="userLimit" value="' + (channel.userLimit ?? 0) + '">',
          '0 is geen limiet',
        )
      : '';

  const textOnly =
    channel.type === 'text' || channel.type === 'announcement' || channel.type === 'forum'
      ? field('Onderwerp', text('topic', channel.topic || '')) +
        field(
          'Slowmode (seconden)',
          '<input type="number" min="0" max="21600" data-edit="slowmodeSeconds" value="' +
            (channel.slowmodeSeconds ?? 0) + '">',
        ) +
        '<div class="row">' + checkbox('nsfw', channel.nsfw, 'Markeren als NSFW') + '</div>'
      : '';

  const messageBlock =
    channel.type === 'text' || channel.type === 'announcement'
      ? '<h4>Berichten bij aanmaken</h4><p class="hint">Alleen geplaatst als het kanaal nieuw is.</p>' +
        messages + '<button class="btn-sm" data-addmessage="1">' + icon('plus', 'sm') + 'Bericht</button>'
      : '';

  return (
    '<h3>Kanaal</h3><p class="hint">' + esc(channel.type) + '-kanaal</p>' +
    field('Naam', text('name', channel.name)) +
    field('Type', '<select data-edit="type">' + types + '</select>') +
    textOnly + voice + forum +
    matrix(
      channel.overwrites,
      'Rechten in dit kanaal',
      channel.overwrites.length === 0
        ? 'Leeg = dit kanaal erft de rechten van zijn categorie.'
        : 'Zodra hier iets staat, erft dit kanaal niets meer van de categorie.',
    ) +
    messageBlock
  );
}

// --- overwrite-matrix ------------------------------------------------------

function matrix(overwrites, title, hint) {
  const roles = [{ key: '@everyone', name: '@everyone' }, ...ctx.template.roles];
  const permissions = ctx.permissions.filter((permission) => showAllPermissions || permission.common);

  const header =
    '<thead><tr><th></th>' + roles.map((role) => '<th>' + esc(role.name) + '</th>').join('') + '</tr></thead>';

  const rows = permissions
    .map((permission) => {
      const cells = roles
        .map((role) => {
          const state = overwriteState(overwrites, role.key, permission.name);
          return (
            '<td><button class="tri s' + (state === -1 ? 'neg' : state) + '" data-tri="' +
            esc(role.key) + '|' + permission.name + '" title="' + STATE_TITLES[state] + '">' +
            STATES[state] + '</button></td>'
          );
        })
        .join('');
      return '<tr><th>' + esc(permission.label) + '</th>' + cells + '</tr>';
    })
    .join('');

  return (
    '<h4>' + esc(title) + '</h4>' +
    (hint ? '<p class="hint">' + esc(hint) + '</p>' : '') +
    '<label class="check"><input type="checkbox" data-allperms' + (showAllPermissions ? ' checked' : '') +
    '><span>alle permissies tonen</span></label>' +
    '<div class="matrixwrap"><table class="matrix">' + header + '<tbody>' + rows + '</tbody></table></div>'
  );
}

function overwriteState(overwrites, roleKey, permission) {
  const entry = overwrites.find((candidate) => candidate.role === roleKey);
  if (!entry) return 0;
  if (entry.allow.includes(permission)) return 1;
  if (entry.deny.includes(permission)) return -1;
  return 0;
}

function cycleOverwrite(overwrites, roleKey, permission) {
  let entry = overwrites.find((candidate) => candidate.role === roleKey);
  if (!entry) {
    entry = { role: roleKey, allow: [], deny: [] };
    overwrites.push(entry);
  }

  const current = overwriteState(overwrites, roleKey, permission);
  entry.allow = entry.allow.filter((name) => name !== permission);
  entry.deny = entry.deny.filter((name) => name !== permission);

  if (current === 0) entry.allow.push(permission);
  else if (current === 1) entry.deny.push(permission);

  // Lege entries weghalen, anders "erft" een kanaal ineens niets meer voor niets.
  const index = overwrites.indexOf(entry);
  if (entry.allow.length === 0 && entry.deny.length === 0) overwrites.splice(index, 1);
}

function currentOverwrites() {
  if (selection.type === 'category') return ctx.template.categories[selection.index].overwrites;
  if (selection.type === 'channel') return currentChannel().overwrites;
  return null;
}

// --- acties ----------------------------------------------------------------

function bind(container) {
  const on = (selectorAttribute, handler) => {
    for (const element of container.querySelectorAll('[' + selectorAttribute + ']')) {
      element.onclick = (event) => {
        event.stopPropagation();
        handler(element.dataset, element);
      };
    }
  };

  on('data-pick', (data) => {
    selection =
      data.pick === 'channel'
        ? { type: 'channel', category: data.category === '' ? null : Number(data.category), index: Number(data.index) }
        : { type: data.pick, index: Number(data.index) };
    draw(container);
  });

  on('data-add', (data) => {
    const template = ctx.template;
    if (data.add === 'role') {
      template.roles.push({ key: uniqueKey('rol'), name: 'Nieuwe rol', hoist: false, mentionable: false, permissions: [] });
      selection = { type: 'role', index: template.roles.length - 1 };
    } else if (data.add === 'category') {
      template.categories.push({ name: 'Nieuwe categorie', overwrites: [], channels: [] });
      selection = { type: 'category', index: template.categories.length - 1 };
    } else {
      const category = template.categories[Number(data.category)];
      category.channels.push(newChannel());
      selection = { type: 'channel', category: Number(data.category), index: category.channels.length - 1 };
    }
    changed();
  });

  on('data-del', (data) => {
    const template = ctx.template;
    if (data.del === 'role') {
      const [removed] = template.roles.splice(Number(data.index), 1);
      stripRole(template, removed.key);
    } else if (data.del === 'category') {
      template.categories.splice(Number(data.index), 1);
    } else {
      const list =
        data.category === '' ? template.uncategorizedChannels : template.categories[Number(data.category)].channels;
      list.splice(Number(data.index), 1);
    }
    selection = { type: 'none' };
    changed();
  });

  on('data-move', (data) => {
    const template = ctx.template;
    const index = Number(data.index);
    const direction = Number(data.dir);
    const list =
      data.move === 'role'
        ? template.roles
        : data.move === 'category'
          ? template.categories
          : template.categories[Number(data.category)].channels;

    const target = index + direction;
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];

    if (selection.type === data.move && selection.index === index) selection = { ...selection, index: target };
    changed();
  });

  on('data-tri', (data) => {
    const overwrites = currentOverwrites();
    if (!overwrites) return;
    const [roleKey, permission] = data.tri.split('|');
    cycleOverwrite(overwrites, roleKey, permission);
    changed();
  });

  on('data-delmessage', (data) => {
    currentChannel().messages.splice(Number(data.delmessage), 1);
    changed();
  });

  on('data-addmessage', () => {
    currentChannel().messages.push({ content: 'Nieuw bericht', pin: true });
    changed();
  });

  for (const input of container.querySelectorAll('[data-edit]')) {
    input.onchange = () => {
      const target =
        selection.type === 'role'
          ? ctx.template.roles[selection.index]
          : selection.type === 'category'
            ? ctx.template.categories[selection.index]
            : currentChannel();

      const name = input.dataset.edit;
      if (input.type === 'checkbox') target[name] = input.checked;
      else if (input.type === 'number') target[name] = Number(input.value);
      else if (name === 'tags') {
        target.tags = input.value
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean)
          .map((tagName) => ({ name: tagName, moderated: false }));
      } else if (name === 'type') {
        target.type = input.value;
      } else {
        target[name] = input.value;
      }

      if (name === 'name' && selection.type === 'role') syncRoleKey(target);
      changed();
    };
  }

  for (const input of container.querySelectorAll('[data-perm]')) {
    input.onchange = () => {
      const role = ctx.template.roles[selection.index];
      const permission = input.dataset.perm;
      role.permissions = input.checked
        ? [...role.permissions, permission]
        : role.permissions.filter((name) => name !== permission);
      changed();
    };
  }

  for (const area of container.querySelectorAll('[data-message]')) {
    area.onchange = () => {
      currentChannel().messages[Number(area.dataset.message)].content = area.value;
      ctx.onChange();
    };
  }

  for (const input of container.querySelectorAll('[data-messagepin]')) {
    input.onchange = () => {
      currentChannel().messages[Number(input.dataset.messagepin)].pin = input.checked;
      ctx.onChange();
    };
  }

  const all = container.querySelector('[data-allperms]');
  if (all) {
    all.onchange = () => {
      showAllPermissions = all.checked;
      draw(container);
    };
  }
}

function newChannel() {
  return {
    name: 'nieuw-kanaal',
    type: 'text',
    nsfw: false,
    slowmodeSeconds: 0,
    overwrites: [],
    messages: [],
    tags: [],
  };
}

function uniqueKey(base) {
  const keys = new Set(ctx.template.roles.map((role) => role.key));
  let key = base;
  let index = 2;
  while (keys.has(key)) key = base + '-' + index++;
  return key;
}

/** De key volgt de naam, zolang dat geen botsing geeft. */
function syncRoleKey(role) {
  const wanted = role.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'rol';
  if (wanted === role.key) return;
  if (ctx.template.roles.some((other) => other !== role && other.key === wanted)) return;

  const old = role.key;
  role.key = wanted;
  renameRole(ctx.template, old, wanted);
}

function renameRole(template, from, to) {
  forEachOverwriteList(template, (list) => {
    for (const entry of list) if (entry.role === from) entry.role = to;
  });
  for (const rule of template.automod || []) {
    rule.exemptRoles = (rule.exemptRoles || []).map((key) => (key === from ? to : key));
  }
  for (const emoji of template.emojis || []) {
    emoji.roles = (emoji.roles || []).map((key) => (key === from ? to : key));
  }
  for (const prompt of template.onboarding?.prompts || []) {
    for (const option of prompt.options) {
      option.roles = (option.roles || []).map((key) => (key === from ? to : key));
    }
  }
}

/** Een verwijderde rol mag nergens meer opduiken, anders wordt de template ongeldig. */
function stripRole(template, key) {
  forEachOverwriteList(template, (list) => {
    for (let index = list.length - 1; index >= 0; index--) {
      if (list[index].role === key) list.splice(index, 1);
    }
  });
  for (const rule of template.automod || []) {
    rule.exemptRoles = (rule.exemptRoles || []).filter((role) => role !== key);
  }
  for (const emoji of template.emojis || []) {
    emoji.roles = (emoji.roles || []).filter((role) => role !== key);
  }
  for (const prompt of template.onboarding?.prompts || []) {
    for (const option of prompt.options) {
      option.roles = (option.roles || []).filter((role) => role !== key);
    }
  }
}

function forEachOverwriteList(template, visit) {
  for (const category of template.categories) {
    visit(category.overwrites);
    for (const channel of category.channels) visit(channel.overwrites);
  }
  for (const channel of template.uncategorizedChannels) visit(channel.overwrites);
}
