/**
 * De klik-editor. Werkt rechtstreeks op het template-object en roept onChange aan
 * zodra er iets verandert; opslaan en valideren blijft aan app.js.
 */

import { CHANNEL_ICONS, emptyState, escapeHtml, icon, kiesUit, zoekUit } from './ui.js';

const CHANNEL_TYPES = ['text', 'voice', 'forum', 'announcement', 'stage'];
const STATES = { 1: '✓', 0: '·', '-1': '✗' };
const STATE_TITLES = { 1: 'toestaan', 0: 'niet ingesteld', '-1': 'weigeren' };

/**
 * Kant-en-klare brokken om aan een template toe te voegen: een categorie met
 * kanalen, en de rollen die de rechten nodig hebben. Eenvoudiger dan losse
 * modulebestanden, want de template blijft een plat leesbaar geheel.
 */
const kanaal = (naam, extra = {}) => ({
  name: naam, type: 'text', nsfw: false, slowmodeSeconds: 0,
  overwrites: [], tags: [], ...extra,
});

const BLOKKEN = {
  welkom: {
    naam: 'Welkomstzone',
    uitleg: 'Welkom, regels en aankondigingen. Iedereen leest mee, niemand post.',
    rollen: [],
    categorie: {
      name: '👋 Welkom',
      overwrites: [{ role: '@everyone', allow: ['ViewChannel', 'ReadMessageHistory'], deny: ['SendMessages'] }],
      channels: [
        kanaal('👋│welkom', { topic: 'Start hier.' }),
        kanaal('✅│regels', { topic: 'De huisregels van deze server.' }),
      ],
    },
  },

  staf: {
    naam: 'Stafzone',
    uitleg: 'Besloten categorie voor je team, met chat, logboek en spraak.',
    rollen: [{ key: 'staf', name: 'Staf', color: '#5865f2', hoist: true, mentionable: true,
      permissions: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'ManageMessages', 'ModerateMembers'] }],
    categorie: {
      name: '🛡️ Staf',
      overwrites: [
        { role: '@everyone', allow: [], deny: ['ViewChannel'] },
        { role: 'staf', allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'], deny: [] },
      ],
      channels: [
        kanaal('🛡️│staf-chat', { topic: 'Intern overleg.' }),
        kanaal('📚│logboek', { topic: 'Automatische logs.' }),
        kanaal('🔒│Staf Voice', { type: 'voice' }),
      ],
    },
  },

  tickets: {
    naam: 'Supportzone',
    uitleg: 'Een forum waar leden een vraag openen, met een besloten logboek ernaast.',
    rollen: [{ key: 'support', name: 'Support', color: '#e67e22', hoist: false, mentionable: true,
      permissions: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'ManageMessages', 'ManageThreads'] }],
    categorie: {
      name: '🎫 Support',
      overwrites: [
        { role: '@everyone', allow: ['ViewChannel', 'ReadMessageHistory'], deny: [] },
        { role: 'support', allow: ['ManageMessages', 'ManageThreads'], deny: [] },
      ],
      channels: [
        kanaal('🎫│vragen', {
          type: 'forum',
          topic: 'Open hier je vraag; het team reageert in je eigen draadje.',
          tags: [{ name: 'Open', moderated: false }, { name: 'Opgelost', moderated: true }],
        }),
        kanaal('📋│support-log', {
          overwrites: [
            { role: '@everyone', allow: [], deny: ['ViewChannel'] },
            { role: 'support', allow: ['ViewChannel'], deny: [] },
          ],
        }),
      ],
    },
  },

  spraak: {
    naam: 'Spraakzone',
    uitleg: 'Een lounge en twee kleinere kamers.',
    rollen: [],
    categorie: {
      name: '🔊 Spraak',
      overwrites: [],
      channels: [
        kanaal('🔊│Lounge', { type: 'voice', userLimit: 0 }),
        kanaal('🎮│Kamer 1', { type: 'voice', userLimit: 5 }),
        kanaal('🎮│Kamer 2', { type: 'voice', userLimit: 5 }),
      ],
    },
  },
};

let ctx = null;
let selection = { type: 'none' };
let showAllPermissions = false;
/** Welke rol de lijstweergave toont. Op een telefoon past geen raster. */
let matrixRole = '@everyone';
/** Zoekterm voor de boom: naam van een rol, kanaal of recht. */
let zoekterm = '';

export function renderEditor(container, context) {
  ctx = context;
  draw(container);
}

export function resetSelection() {
  selection = { type: 'none' };
}

function changed() {
  ctx.onChange();

  // Niet meteen opnieuw tekenen. Een veld meldt zijn wijziging op het moment dat
  // je hem verlaat, en de browser is dan midden in het verplaatsen van de focus:
  // de halve boom vervangen mislukt daar met "the node to be removed is no longer
  // a child of this node", en dan blijft het scherm staan op de oude naam.
  setTimeout(() => draw(ctx.container), 0);
}

function draw(container) {
  ctx.container = container;
  // Op een smal scherm staat de boom en het detail niet naast elkaar maar na
  // elkaar: kies je iets, dan schuift het detail ervoor met een knop terug.
  const detail = selection.type !== 'none' ? ' detail' : '';
  container.innerHTML =
    '<div class="editor' + detail + '"><div class="tree">' + tree() + '</div>' +
    '<div class="props">' + props() + '</div>' +
    '<div class="voorbeeld">' + voorbeeldBinnen() + '</div></div>';
  bind(container);
  bindVoorbeeld(container);
  bindFocus(container);

  // Na het opnieuw tekenen is het zoekveld nieuw; zet de cursor terug zodat
  // je gewoon door kunt typen.
  if (zoekterm) {
    const veld = container.querySelector('#treeZoek');
    if (veld) {
      veld.focus();
      veld.setSelectionRange(veld.value.length, veld.value.length);
    }
  }
}

// --- voorbeeld: hoe de server er straks uitziet ------------------------------

/**
 * Een nagebouwde kanalenlijst naast de editor. Niet omdat het er leuk uitziet,
 * maar omdat een template op papier niets zegt over wat een lid straks ziet:
 * één overwrite verkeerd en het halve serverbeeld klopt niet. Hier zie je het
 * meteen, per rol, zonder uit te rollen.
 *
 * Wat zichtbaar is voor wie, rekent de server uit (dezelfde simulatie als het
 * controlescherm). Dat kost een verzoekje, dus dat gebeurt met vertraging en
 * alleen als er echt iets veranderd is; de lijst zelf staat er meteen.
 */
let bekekenRol = '@everyone';
let simulatie = { sleutel: '', data: null };
let simulatieTimer = null;

const voorbeeldRollen = () => [{ key: '@everyone', name: '@everyone' }, ...ctx.template.roles];

function voorbeeldSleutel() {
  return bekekenRol + '\u0000' + JSON.stringify(ctx.template);
}

/** Vraagt de simulatie op, met rust: pas als je even niets meer wijzigt. */
function vraagSimulatie() {
  if (!ctx.simuleer) return;
  const sleutel = voorbeeldSleutel();
  if (simulatie.sleutel === sleutel) return;

  clearTimeout(simulatieTimer);
  simulatieTimer = setTimeout(async () => {
    const data = await ctx.simuleer(JSON.stringify(ctx.template), bekekenRol).catch(() => null);
    simulatie = { sleutel, data };
    // Alleen deze kolom opnieuw tekenen. De hele editor hertekenen zou de
    // cursor uit het veld halen waar je net in typte.
    tekenVoorbeeld();
  }, 400);
}

function tekenVoorbeeld() {
  const doel = ctx.container?.querySelector('.voorbeeld');
  if (!doel) return;
  doel.innerHTML = voorbeeldBinnen();
  bindVoorbeeld(ctx.container);
}

/** De uitkomst hoort alleen bij deze template en deze rol, anders is hij oud. */
function huidigeSimulatie() {
  return simulatie.sleutel === voorbeeldSleutel() ? simulatie.data : null;
}

function voorbeeldKanaal(kanaal, zicht) {
  const verborgen = zicht && zicht.visible === false;
  return (
    '<div class="dc-kanaal' + (verborgen ? ' weg' : '') + '"' +
    (zicht ? ' title="' + escapeHtml(zicht.reason) + '"' : '') + '>' +
    icon(CHANNEL_ICONS[kanaal.type] || 'hash', 'sm') +
    '<span class="truncate">' + escapeHtml(kanaal.name) + '</span>' +
    (verborgen ? icon('eyeoff', 'sm') : '') +
    '</div>'
  );
}

function voorbeeldBinnen() {
  const template = ctx.template;
  const sim = huidigeSimulatie();
  vraagSimulatie();

  /** De uitkomst per kanaalnaam, zodat de lijst en de simulatie bij elkaar horen. */
  const zichtVan = (categorieNaam, kanaalNaam) => {
    if (!sim) return null;
    const lijst =
      categorieNaam === null
        ? sim.uncategorized
        : (sim.categories.find((categorie) => categorie.name === categorieNaam)?.channels ?? []);
    return lijst.find((kanaal) => kanaal.name === kanaalNaam) ?? null;
  };

  const keuze =
    '<select id="vbRol" title="Bekijk de server door de ogen van deze rol">' +
    voorbeeldRollen()
      .map(
        (rol) =>
          '<option value="' + escapeHtml(rol.key) + '"' + (rol.key === bekekenRol ? ' selected' : '') + '>' +
          escapeHtml(rol.name) + '</option>',
      )
      .join('') +
    '</select>';

  const lijst =
    template.uncategorizedChannels.map((kanaal) => voorbeeldKanaal(kanaal, zichtVan(null, kanaal.name))).join('') +
    template.categories
      .map(
        (categorie) =>
          '<div class="dc-cat">' + escapeHtml(categorie.name) + '</div>' +
          categorie.channels
            .map((kanaal) => voorbeeldKanaal(kanaal, zichtVan(categorie.name, kanaal.name)))
            .join(''),
      )
      .join('');

  const voet = sim
    ? sim.administrator
      ? 'Administrator — ziet sowieso alles.'
      : sim.visibleCount + ' van de ' + sim.totalCount + ' kanalen zichtbaar'
    : 'berekenen…';

  return (
    '<div class="vbkop"><span class="grow">Voorbeeld</span>' + keuze + '</div>' +
    '<div class="dc">' +
    '<div class="dc-server">' + escapeHtml(template.name || 'Server') + '</div>' +
    (lijst || '<div class="dc-leeg">Nog geen kanalen.</div>') +
    '</div>' +
    '<div class="vbvoet">' + escapeHtml(voet) + '</div>'
  );
}

function bindFocus(container) {
  const uit = container?.querySelector('#focusUit');
  if (uit) uit.onclick = () => zetFocus('alles');
}

function bindVoorbeeld(container) {
  const keuze = container?.querySelector('#vbRol');
  if (!keuze) return;
  keuze.onchange = () => {
    bekekenRol = keuze.value;
    tekenVoorbeeld();
  };
}

/** Of een naam of recht op de zoekterm lijkt. */
function raakt(tekst) {
  return String(tekst ?? '').toLowerCase().includes(zoekterm);
}

/** Of een rol, categorie of kanaal bij de zoekterm hoort. */
function roleRaakt(role) {
  return raakt(role.name) || (role.permissions ?? []).some((naam) => raakt(naam));
}

function overwritesRaken(overwrites) {
  return (overwrites ?? []).some(
    (entry) =>
      raakt(entry.role) ||
      [...(entry.allow ?? []), ...(entry.deny ?? [])].some((naam) => raakt(naam)),
  );
}

function channelRaakt(channel) {
  return raakt(channel.name) || raakt(channel.type) || overwritesRaken(channel.overwrites);
}

const esc = escapeHtml;

// --- boom ------------------------------------------------------------------

function tree() {
  const template = ctx.template;

  const roles = template.roles
    .map((role, index) => [role, index])
    .filter(([role]) => !zoekterm || roleRaakt(role))
    .map(([role, index]) => {
      const active = selection.type === 'role' && selection.index === index;
      return (
        '<li class="node' + (active ? ' on' : '') + '" draggable="true" data-sleep="role" data-pick="role" ' +
        'data-index="' + index + '">' +
        '<span class="dot" style="background:' + esc(role.color || 'var(--muted)') + '"></span>' +
        '<span class="grow truncate">' + esc(role.name) + '</span>' +
        '<span class="tools">' +
        moveButtons('role', index, template.roles.length) +
        '<button class="btn-icon" data-dup="role" data-index="' + index + '" title="Dupliceren">' +
        icon('copy', 'sm') + '</button>' +
        '<button class="btn-icon" data-del="role" data-index="' + index + '" title="Verwijderen">' +
        icon('trash', 'sm') + '</button>' +
        '</span></li>'
      );
    })
    .join('');

  const categories = template.categories
    .map((category, categoryIndex) => [category, categoryIndex])
    .filter(
      ([category]) =>
        !zoekterm ||
        raakt(category.name) ||
        overwritesRaken(category.overwrites) ||
        category.channels.some((channel) => channelRaakt(channel)),
    )
    .map(([category, categoryIndex]) => {
      const activeCategory = selection.type === 'category' && selection.index === categoryIndex;
      const channels = category.channels
        .map((channel, channelIndex) => [channel, channelIndex])
        .filter(([channel]) => !zoekterm || raakt(category.name) || channelRaakt(channel))
        .map(([channel, channelIndex]) => {
          const active =
            selection.type === 'channel' &&
            selection.category === categoryIndex &&
            selection.index === channelIndex;
          return (
            '<li class="node' + (active ? ' on' : '') + '" draggable="true" data-sleep="channel" data-pick="channel" data-category="' +
            categoryIndex + '" data-index="' + channelIndex + '">' +
            icon(CHANNEL_ICONS[channel.type] || 'hash', 'sm') +
            '<span class="grow truncate">' + esc(channel.name) + '</span>' +
            '<span class="tools">' +
            moveButtons('channel', channelIndex, category.channels.length, categoryIndex) +
            '<button class="btn-icon" data-dup="channel" data-category="' + categoryIndex + '" data-index="' +
            channelIndex + '" title="Dupliceren">' + icon('copy', 'sm') + '</button>' +
            '<button class="btn-icon" data-del="channel" data-category="' + categoryIndex + '" data-index="' +
            channelIndex + '" title="Verwijderen">' + icon('trash', 'sm') + '</button>' +
            '</span></li>'
          );
        })
        .join('');

      return (
        '<li class="group"><div class="node head' + (activeCategory ? ' on' : '') +
        '" draggable="true" data-sleep="category" data-pick="category" data-index="' + categoryIndex + '">' +
        icon('folder', 'sm') + '<span class="grow truncate"><strong>' + esc(category.name) + '</strong></span>' +
        '<span class="tools">' +
        moveButtons('category', categoryIndex, template.categories.length) +
        '<button class="btn-icon" data-add="channel" data-category="' + categoryIndex +
        '" title="Kanaal toevoegen">' + icon('plus', 'sm') + '</button>' +
        '<button class="btn-icon" data-dup="category" data-index="' + categoryIndex + '" title="Categorie dupliceren">' +
        icon('copy', 'sm') + '</button>' +
        '<button class="btn-icon" data-del="category" data-index="' + categoryIndex + '" title="Verwijderen">' +
        icon('trash', 'sm') + '</button>' +
        '</span></div><ul>' + channels + '</ul></li>'
      );
    })
    .join('');

  const loose = template.uncategorizedChannels
    .map((channel, index) => [channel, index])
    .filter(([channel]) => !zoekterm || channelRaakt(channel))
    .map(([channel, index]) => {
      const active = selection.type === 'channel' && selection.category === null && selection.index === index;
      return (
        '<li class="node' + (active ? ' on' : '') + '" draggable="true" data-sleep="channel" data-pick="channel" data-category="" data-index="' +
        index + '">' + icon(CHANNEL_ICONS[channel.type] || 'hash', 'sm') + '<span class="grow truncate">' +
        esc(channel.name) + '</span><span class="tools">' +
        '<button class="btn-icon" data-dup="channel" data-category="" data-index="' + index +
        '" title="Dupliceren">' + icon('copy', 'sm') + '</button>' +
        '<button class="btn-icon" data-del="channel" data-category="" data-index="' + index +
        '" title="Verwijderen">' + icon('trash', 'sm') + '</button>' +
        '</span></li>'
      );
    })
    .join('');

  const leeg = zoekterm && !roles && !categories && !loose;

  const rollenBlok =
    '<div class="treehead"><h4>Rollen</h4><button class="btn-sm" data-add="role">' + icon('plus', 'sm') +
    'Rol</button></div>' +
    '<p class="hint">Bovenaan staat de hoogste rol.</p>' +
    '<ul>' + (roles || '<li class="hint">' + (zoekterm ? 'geen rol met deze naam of dit recht' : 'nog geen rollen') + '</li>') + '</ul>';

  const kanalenBlok =
    '<div class="treehead"><h4>Kanalen</h4><span class="row" style="gap:4px">' +
    '<button class="btn-sm" data-add="blok">' + icon('copy', 'sm') + 'Blok</button>' +
    '<button class="btn-sm" data-add="category">' + icon('plus', 'sm') + 'Categorie</button></span></div>' +
    '<ul>' + categories + '</ul>' +
    (loose ? '<div class="treehead"><h4>Zonder categorie</h4></div><ul>' + loose + '</ul>' : '');

  /**
   * Rolmenu's: het bericht met knoppen waarmee leden zichzelf een rol geven.
   *
   * Hier staat welke rollen erin zitten en in welk kanaal het komt; de tekst en
   * de opmaak blijven in de JSON. Zo is het wél te zien en aan te passen zonder
   * dat dit scherm een tweede berichteneditor wordt.
   */
  const menus = (template.roleMenus ?? [])
    .map((menu, index) => {
      const opties = (menu.options ?? [])
        .map((optie, plek) => {
          const rol = template.roles.find((kandidaat) => kandidaat.key === optie.role);
          return (
            '<li class="node">' + icon('shield', 'sm') +
            '<span class="grow truncate">' + esc(optie.emoji ? optie.emoji + ' ' : '') +
            esc(optie.label || rol?.name || optie.role) + '</span>' +
            '<span class="tools"><button class="btn-icon" data-del="rolmenuRol" data-menu="' + index +
            '" data-index="' + plek + '" title="Weghalen">' + icon('trash', 'sm') + '</button></span></li>'
          );
        })
        .join('');

      const actief = selection.type === 'rolmenu' && selection.index === index;

      return (
        '<li class="group"><div class="node head' + (actief ? ' on' : '') +
        '" data-pick="rolmenu" data-index="' + index + '">' + icon('shield', 'sm') +
        '<span class="grow truncate"><strong>' + esc(menu.title) + '</strong> ' +
        '<span class="muted">#' + esc(menu.channel) + '</span></span>' +
        '<span class="tools">' +
        '<button class="btn-icon" data-add="rolmenuRol" data-menu="' + index + '" title="Rol toevoegen">' +
        icon('plus', 'sm') + '</button>' +
        '<button class="btn-icon" data-del="rolmenu" data-index="' + index + '" title="Verwijderen">' +
        icon('trash', 'sm') + '</button>' +
        '</span></div><ul>' + (opties || '<li class="hint">nog geen rollen</li>') + '</ul></li>'
      );
    })
    .join('');

  const menuBlok =
    '<div class="treehead"><h4>Rolmenu\u2019s</h4><button class="btn-sm" data-add="rolmenu">' +
    icon('plus', 'sm') + 'Rolmenu</button></div>' +
    '<p class="hint">Een bericht met knoppen waarmee leden zichzelf een rol geven.</p>' +
    '<ul>' + (menus || '<li class="hint">nog geen rolmenu\u2019s</li>') + '</ul>';

  const serverKnop =
    '<ul><li class="node' + (selection.type === 'server' ? ' on' : '') + '" data-pick="server" data-index="0">' +
    icon('server', 'sm') + '<span class="grow truncate">Serverinstellingen</span></li></ul>';

  return (
    focusBalk() +
    '<input type="search" id="treeZoek" class="zoek" placeholder="Zoek rol, kanaal of recht…" ' +
    'value="' + esc(zoekterm) + '" autocomplete="off">' +
    (leeg ? '<p class="hint">Niets gevonden voor \u201c' + esc(zoekterm) + '\u201d.</p>' : '') +
    (zoekterm ? '' : serverKnop) +
    (focus === 'kanalen' ? '' : rollenBlok) +
    (focus === 'rollen' ? '' : kanalenBlok) +
    (zoekterm || focus !== 'alles' ? '' : menuBlok)
  );
}

/**
 * Bij een stap uit de rail hoort maar één soort werk. Sta je op "Rollen", dan
 * hoef je de kanalen niet te zien — dat is de helft minder om doorheen te
 * kijken. Eén knop zet alles weer terug, zodat je nooit vastzit.
 */
let focus = 'alles';

export function zetFocus(waarde) {
  focus = waarde || 'alles';
  if (ctx?.container) draw(ctx.container);
}

const FOCUS_TEKST = { rollen: 'Alleen de rollen', kanalen: 'Alleen de kanalen' };

function focusBalk() {
  if (!FOCUS_TEKST[focus]) return '';
  return (
    '<div class="focusbalk">' + icon('eye', 'sm') + '<span class="grow">' + FOCUS_TEKST[focus] + '</span>' +
    '<button class="btn-sm" id="focusUit">Alles tonen</button></div>'
  );
}

/** Wat er op dit moment gesleept wordt. */
let sleept = null;

/** De beschrijving van een knoop in de boom: wat het is en waar het staat. */
function lees(dataset) {
  return {
    soort: dataset.sleep,
    index: Number(dataset.index),
    category: dataset.category === undefined ? null : dataset.category === '' ? null : Number(dataset.category),
    losKanaal: dataset.category === '',
  };
}

/**
 * Mag dit daarheen?
 *
 * Een rol tussen de rollen, een categorie tussen de categorieen, een kanaal
 * tussen de kanalen - ook die van een andere categorie, want juist dát is met
 * pijltjesknoppen geen doen. Een kanaal op een categoriekop laten vallen zet
 * het vooraan in die categorie.
 */
function magHier(van, naar) {
  if (van.soort === 'role') return naar.soort === 'role';
  if (van.soort === 'category') return naar.soort === 'category';
  return naar.soort === 'channel' || naar.soort === 'category';
}

function kanaalLijst(category) {
  return category === null ? ctx.template.uncategorizedChannels : ctx.template.categories[category].channels;
}

function verplaats(van, naar) {
  if (van.soort === 'role' || van.soort === 'category') {
    const lijst = van.soort === 'role' ? ctx.template.roles : ctx.template.categories;
    const [stuk] = lijst.splice(van.index, 1);
    lijst.splice(naar.index, 0, stuk);
    selection = { type: van.soort === 'role' ? 'role' : 'category', index: naar.index };
    return;
  }

  const uit = kanaalLijst(van.category);
  const [kanaal] = uit.splice(van.index, 1);

  // Op een categoriekop: vooraan in die categorie. Op een kanaal: op de plek van
  // dat kanaal, dus sleep je naar beneden dan komt het erachter en naar boven
  // ervoor - zoals je het loslaat.
  const naarCategorie = naar.soort === 'category' ? naar.index : naar.category;
  const plek = naar.soort === 'category' ? 0 : naar.index;

  kanaalLijst(naarCategorie).splice(plek, 0, kanaal);
  selection = { type: 'channel', category: naarCategorie, index: plek };
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
  if (selection.type === 'none') return emptyState('shield', 'Kies links een rol, categorie of kanaal.');

  const terug = '<button class="terug" data-terug>' + icon('up', 'sm') + 'Terug naar de lijst</button>';

  if (selection.type === 'server') return terug + serverProps(ctx.template);
  if (selection.type === 'role') return terug + roleProps(ctx.template.roles[selection.index]);
  if (selection.type === 'category') return terug + categoryProps(ctx.template.categories[selection.index]);
  if (selection.type === 'rolmenu') return terug + rolmenuProps(ctx.template.roleMenus[selection.index]);
  return terug + channelProps(currentChannel());
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
              '<label class="check" title="' + esc(permission.uitleg || permission.label) + '">' +
              '<input type="checkbox" data-perm="' + permission.name + '"' +
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
    rolChip(role) +
    rolWaarschuwing(role) +
    field('Naam', text('name', role.name)) +
    field('Kleur', '<input type="color" data-edit="color" value="' + esc(role.color || '#99aab5') + '">') +
    kleurKeuze(role.color) +
    '<div class="row">' +
    checkbox('hoist', role.hoist, 'Apart tonen in de ledenlijst') +
    checkbox('mentionable', role.mentionable, 'Iedereen mag deze rol pingen') +
    '</div>' +
    '<h4>Rechten</h4>' +
    groups
  );
}

/**
 * De instellingen van de server zelf: verificatie, meldingen, welk kanaal welke
 * rol speelt. Die stonden alleen in de JSON, terwijl het het eerste is wat je
 * invult als je een server opzet.
 */
const KEUZES = {
  verificationLevel: [
    ['', 'niet instellen'],
    ['none', 'geen — iedereen mag meteen praten'],
    ['low', 'laag — geverifieerd e-mailadres'],
    ['medium', 'midden — account ouder dan 5 minuten'],
    ['high', 'hoog — minstens 10 minuten lid'],
    ['very_high', 'zeer hoog — geverifieerd telefoonnummer'],
  ],
  explicitContentFilter: [
    ['', 'niet instellen'],
    ['disabled', 'uit'],
    ['members_without_roles', 'alleen bij leden zonder rol'],
    ['all_members', 'bij iedereen'],
  ],
  defaultMessageNotifications: [
    ['', 'niet instellen'],
    ['all_messages', 'alle berichten'],
    ['only_mentions', 'alleen vermeldingen'],
  ],
  afkTimeoutSeconds: [
    ['', 'niet instellen'],
    ['60', '1 minuut'],
    ['300', '5 minuten'],
    ['900', '15 minuten'],
    ['1800', '30 minuten'],
    ['3600', '1 uur'],
  ],
};

/**
 * De kleuren die Discord zelf aanbiedt.
 *
 * Een kleurenkiezer geeft je zestien miljoen kleuren, waarvan er precies één de
 * kleur is die iedereen van Discord kent. Deze rij staat ernaast; de kiezer
 * blijft voor als je iets eigens wil.
 */
const DISCORD_KLEUREN = [
  '#1abc9c', '#2ecc71', '#3498db', '#9b59b6', '#e91e63',
  '#f1c40f', '#e67e22', '#e74c3c', '#95a5a6', '#607d8b',
  '#11806a', '#1f8b4c', '#206694', '#71368a', '#ad1457',
  '#c27c0e', '#a84300', '#992d22', '#979c9f', '#546e7a',
  '#99aab5',
];

function kleurKeuze(huidig) {
  const nu = (huidig || '').toLowerCase();
  return (
    '<div class="kleuren">' +
    DISCORD_KLEUREN.map(
      (kleur) =>
        '<button class="kleur' + (kleur === nu ? ' on' : '') + '" data-kleur="' + kleur +
        '" style="background:' + kleur + '" title="' + kleur + '" aria-label="Kleur ' + kleur + '"></button>',
    ).join('') +
    '</div>'
  );
}

function keuzeveld(naam, waarde) {
  return (
    '<select data-guild="' + naam + '">' +
    KEUZES[naam]
      .map(
        ([optie, label]) =>
          '<option value="' + optie + '"' + (String(waarde ?? '') === optie ? ' selected' : '') + '>' +
          esc(label) + '</option>',
      )
      .join('') +
    '</select>'
  );
}

/** Alle kanaalnamen uit de template, want die velden wijzen naar een kanaal. */
function kanaalKeuze(naam, waarde) {
  const namen = [
    ...ctx.template.uncategorizedChannels.map((kanaal) => kanaal.name),
    ...ctx.template.categories.flatMap((categorie) => categorie.channels.map((kanaal) => kanaal.name)),
  ];

  return (
    '<select data-guild="' + naam + '"><option value="">niet instellen</option>' +
    namen
      .map(
        (kanaalnaam) =>
          '<option value="' + esc(kanaalnaam) + '"' + (waarde === kanaalnaam ? ' selected' : '') + '>' +
          esc(kanaalnaam) + '</option>',
      )
      .join('') +
    // Staat er een naam in die niet (meer) bestaat, dan hoor je dat te zien in
    // plaats van dat hij stilletjes op "niet instellen" springt.
    (waarde && !namen.includes(waarde)
      ? '<option value="' + esc(waarde) + '" selected>' + esc(waarde) + ' — bestaat niet in deze template</option>'
      : '') +
    '</select>'
  );
}

/**
 * Het rolmenu zelf: waar het komt te staan, wat erin staat en hoe het eruitziet.
 *
 * De knoppen erin bewerk je per rol - de rol zelf bepaalt wat iemand krijgt, dus
 * hier gaat het alleen nog over wat erop staat.
 */
function rolmenuProps(menu) {
  const kanalen = [
    ...ctx.template.uncategorizedChannels.map((kanaal) => kanaal.name),
    ...ctx.template.categories.flatMap((categorie) => categorie.channels.map((kanaal) => kanaal.name)),
  ];

  const veld = (naam, waarde) =>
    '<input type="text" data-rolmenu="' + naam + '" value="' + esc(waarde ?? '') + '">';

  const kanaalKiezer =
    '<select data-rolmenu="channel">' +
    (kanalen.includes(menu.channel) ? '' : '<option value="' + esc(menu.channel) + '" selected>' +
      esc(menu.channel) + ' (bestaat niet)</option>') +
    kanalen
      .map(
        (naam) =>
          '<option value="' + esc(naam) + '"' + (menu.channel === naam ? ' selected' : '') + '>' + esc(naam) +
          '</option>',
      )
      .join('') +
    '</select>';

  const vormKiezer =
    '<select data-rolmenu="style">' +
    [['buttons', 'Knoppen'], ['menu', 'Keuzemenu']]
      .map(
        ([waarde, label]) =>
          '<option value="' + waarde + '"' + (menu.style === waarde ? ' selected' : '') + '>' + label + '</option>',
      )
      .join('') +
    '</select>';

  const opties = (menu.options ?? [])
    .map((optie, plek) => {
      const rol = ctx.template.roles.find((kandidaat) => kandidaat.key === optie.role);
      const optieVeld = (naam, waarde) =>
        '<input type="text" data-rolmenu-optie="' + naam + '" data-index="' + plek + '" value="' +
        esc(waarde ?? '') + '">';

      return (
        '<div class="menuoptie"><strong>@' + esc(rol?.name ?? optie.role) + '</strong>' +
        field('Op de knop', optieVeld('label', optie.label), 'Leeg = de naam van de rol') +
        field('Emoji', optieVeld('emoji', optie.emoji)) +
        (menu.style === 'menu' ? field('Toelichting', optieVeld('description', optie.description)) : '') +
        '</div>'
      );
    })
    .join('');

  return (
    '<h3>Rolmenu</h3>' +
    '<p class="hint">De bot plaatst dit bericht en houdt het bij. Klikt iemand, dan krijgt hij die rol ' +
    '\u2014 nog een keer klikken haalt hem er weer af.</p>' +
    field('Titel', veld('title', menu.title), 'Hieraan herkent de bot zijn eigen bericht terug') +
    field('Kanaal', kanaalKiezer) +
    field('Tekst erboven', veld('description', menu.description)) +
    field('Vorm', vormKiezer, 'Knoppen tot 25 rollen; een keuzemenu leest prettiger bij veel rollen') +
    (opties || '<p class="hint">Nog geen rollen. Gebruik het plusje in de lijst hiernaast.</p>')
  );
}

function serverProps(template) {
  const guild = template.guild || {};

  return (
    '<h3>Serverinstellingen</h3>' +
    '<p class="hint">Dit geldt voor de server als geheel. Leeg laten betekent: laat staan wat er staat.</p>' +
    field('Naam van de template', text('templateName', template.name)) +
    field('Omschrijving', text('templateDescription', template.description || ''), 'Alleen voor jezelf, in de lijst') +
    '<h4>Veiligheid</h4>' +
    field('Verificatieniveau', keuzeveld('verificationLevel', guild.verificationLevel)) +
    field('Scannen op aanstootgevende media', keuzeveld('explicitContentFilter', guild.explicitContentFilter)) +
    field('Meldingen standaard', keuzeveld('defaultMessageNotifications', guild.defaultMessageNotifications)) +
    '<h4>Kanalen met een rol</h4>' +
    field('Systeemkanaal', kanaalKeuze('systemChannel', guild.systemChannel), 'Waar Discord zelf welkomstberichten plaatst') +
    field('AFK-kanaal', kanaalKeuze('afkChannel', guild.afkChannel), 'Een spraakkanaal') +
    field('AFK na', keuzeveld('afkTimeoutSeconds', guild.afkTimeoutSeconds)) +
    field('Regelskanaal', kanaalKeuze('rulesChannel', guild.rulesChannel), 'Verplicht voor een community-server') +
    field('Updateskanaal', kanaalKeuze('updatesChannel', guild.updatesChannel), 'Waar Discord zijn mededelingen voor beheerders plaatst') +
    '<h4>Community</h4>' +
    '<div class="row">' +
    '<label class="check"><input type="checkbox" data-guild="community"' + (guild.community ? ' checked' : '') +
    '><span>Community-modus aanzetten</span></label></div>' +
    '<p class="hint">Nodig voor forum-, announcement- en stagekanalen en voor onboarding. Vereist een ' +
    'regels- en updateskanaal, en de bot moet Administrator zijn.</p>' +
    field('Serveromschrijving', text('description', guild.description || ''), 'Staat in de serverontdekking')
  );
}

/** Hoe de rol er in Discord uitziet: de naam in zijn eigen kleur. */
function rolChip(role) {
  const kleur = role.color || '#99aab5';
  return (
    '<div class="rolchip"><span class="bol" style="background:' + esc(kleur) + '"></span>' +
    '<span style="color:' + esc(kleur) + '">' + esc(role.name || 'Naamloos') + '</span>' +
    (role.hoist ? '<span class="badge">apart in de ledenlijst</span>' : '') +
    '</div>'
  );
}

/**
 * Rechten die verder reiken dan ze lijken. Administrator is de beruchtste: die
 * zet elke kanaalinstelling opzij, dus een besloten kanaal is dan niet besloten.
 * Dat hoor je te zien terwijl je het aanvinkt, niet pas als iemand meekijkt waar
 * dat niet de bedoeling was.
 */
const ZWAAR = {
  Administrator: 'Deze rol ziet en mag alles, ook in kanalen die je afschermt.',
  ManageGuild: 'Mag de serverinstellingen aanpassen.',
  ManageRoles: 'Mag rollen maken en uitdelen — ook aan zichzelf, tot aan zijn eigen hoogte.',
  ManageChannels: 'Mag kanalen aanmaken en verwijderen.',
  ManageWebhooks: 'Mag webhooks maken; daarmee kan iemand namens de server berichten sturen.',
  BanMembers: 'Mag leden verbannen.',
  KickMembers: 'Mag leden eruit zetten.',
  MentionEveryone: 'Mag @everyone gebruiken.',
};

function rolWaarschuwing(role) {
  const zwaar = role.permissions.filter((permission) => ZWAAR[permission]);
  if (zwaar.length === 0) return '';

  const administrator = role.permissions.includes('Administrator');
  return (
    '<div class="rolwaarschuwing' + (administrator ? ' fel' : '') + '">' +
    icon('alert', 'sm') +
    '<div><strong>' +
    (administrator ? 'Administrator' : zwaar.length + ' zwaar recht' + (zwaar.length === 1 ? '' : 'en')) +
    '</strong>' +
    '<small>' +
    (administrator
      ? esc(ZWAAR.Administrator) + ' De rest van de rechten hieronder maakt dan niet meer uit.'
      : esc(zwaar.map((permission) => ZWAAR[permission]).join(' '))) +
    '</small></div></div>'
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
    )
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
      return (
        '<tr><th><span class="wat">' + esc(permission.label) + '</span>' +
        (permission.uitleg ? '<span class="waarom">' + esc(permission.uitleg) + '</span>' : '') +
        '</th>' + cells + '</tr>'
      );
    })
    .join('');

  return (
    '<h4>' + esc(title) + '</h4>' +
    (hint ? '<p class="hint">' + esc(hint) + '</p>' : '') +
    '<label class="check"><input type="checkbox" data-allperms' + (showAllPermissions ? ' checked' : '') +
    '><span>alle permissies tonen</span></label>' +
    '<div class="matrixwrap"><table class="matrix">' + header + '<tbody>' + rows + '</tbody></table></div>' +
    rechtenLijst(overwrites, roles, permissions)
  );
}

/**
 * Dezelfde rechten als de matrix, maar per rol onder elkaar. Een raster van
 * 53 regels naast 5 rollen is op een telefoon niet te doen; deze lijst toont
 * één rol tegelijk en past wel.
 */
function rechtenLijst(overwrites, roles, permissions) {
  if (!roles.some((role) => role.key === matrixRole)) matrixRole = roles[0].key;

  const keuze = roles
    .map(
      (role) =>
        '<button class="rolpil' + (role.key === matrixRole ? ' aan' : '') + '" data-mrol="' +
        esc(role.key) + '">' + esc(role.name) + '</button>',
    )
    .join('');

  const regels = permissions
    .map((permission) => {
      const state = overwriteState(overwrites, matrixRole, permission.name);
      return (
        '<div class="rechtrij">' +
        '<div class="rechttekst"><span class="wat">' + esc(permission.label) + '</span>' +
        (permission.uitleg ? '<span class="waarom">' + esc(permission.uitleg) + '</span>' : '') +
        '</div>' +
        '<button class="tri s' + (state === -1 ? 'neg' : state) + '" data-tri="' +
        esc(matrixRole) + '|' + permission.name + '" title="' + STATE_TITLES[state] + '">' +
        STATES[state] + '</button></div>'
      );
    })
    .join('');

  return (
    '<div class="rechtenlijst">' +
    '<div class="rolpillen">' + keuze + '</div>' +
    '<p class="hint">Tik op het tekentje om te wisselen: erven, mag, mag niet.</p>' +
    regels +
    '</div>'
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

  on('data-terug', () => {
    selection = { type: 'none' };
    draw(container);
  });

  on('data-pick', (data) => {
    selection =
      data.pick === 'channel'
        ? { type: 'channel', category: data.category === '' ? null : Number(data.category), index: Number(data.index) }
        : { type: data.pick, index: Number(data.index) };
    draw(container);
  });

  /**
   * Dupliceren.
   *
   * Vijf rollen die op elkaar lijken maak je niet door twintig vinkjes opnieuw
   * te zetten. De kopie komt er meteen onder te staan en is meteen geselecteerd,
   * zodat je alleen nog de naam hoeft te veranderen.
   */
  on('data-dup', (data) => {
    const template = ctx.template;
    const index = Number(data.index);

    if (data.dup === 'role') {
      const kopie = structuredClone(template.roles[index]);
      kopie.name = kopie.name + ' kopie';
      // De sleutel is waar de rechten in kanalen naar verwijzen; twee rollen met
      // dezelfde sleutel zou betekenen dat je de verkeerde aanpast.
      kopie.key = uniqueKey(slug(kopie.name));
      template.roles.splice(index + 1, 0, kopie);
      selection = { type: 'role', index: index + 1 };
    } else if (data.dup === 'category') {
      const kopie = structuredClone(template.categories[index]);
      kopie.name = kopie.name + ' kopie';
      template.categories.splice(index + 1, 0, kopie);
      selection = { type: 'category', index: index + 1 };
    } else {
      const inCategorie = data.category !== '';
      const lijst = inCategorie
        ? template.categories[Number(data.category)].channels
        : template.uncategorizedChannels;
      const kopie = structuredClone(lijst[index]);
      kopie.name = kanaalNaamVrij(kopie.name + '-kopie', lijst);
      lijst.splice(index + 1, 0, kopie);
      selection = { type: 'channel', category: inCategorie ? Number(data.category) : null, index: index + 1 };
    }

    changed();
  });

  on('data-add', async (data) => {
    const template = ctx.template;

    if (data.add === 'blok') {
      const keuze = await kiesUit({
        title: 'Blok toevoegen',
        body: 'Een categorie met kanalen, en de rollen die de rechten nodig hebben.',
        opties: Object.entries(BLOKKEN).map(([waarde, blok]) => ({ waarde, naam: blok.naam, uitleg: blok.uitleg })),
      });
      if (!keuze) return;

      const blok = BLOKKEN[keuze];
      // Alleen rollen toevoegen die er nog niet zijn; een bestaande "Staf" blijft staan.
      for (const rol of blok.rollen) {
        if (!template.roles.some((bestaand) => bestaand.key === rol.key)) {
          template.roles.push(structuredClone(rol));
        }
      }

      const categorie = structuredClone(blok.categorie);
      while (template.categories.some((bestaand) => bestaand.name === categorie.name)) {
        categorie.name += ' 2';
      }

      template.categories.push(categorie);
      selection = { type: 'category', index: template.categories.length - 1 };
      changed();
      return;
    }

    if (data.add === 'rolmenu' || data.add === 'rolmenuRol') {
      if (!Array.isArray(template.roleMenus)) template.roleMenus = [];

      if (data.add === 'rolmenu') {
        const kanalen = [
          ...template.uncategorizedChannels.map((kanaal) => kanaal.name),
          ...template.categories.flatMap((categorie) => categorie.channels.map((kanaal) => kanaal.name)),
        ];
        if (kanalen.length === 0) return;

        const gekozen = await zoekUit({
          title: 'In welk kanaal komt het rolmenu?',
          items: kanalen.map((naam) => ({ waarde: naam, naam: '#' + naam })),
        });
        if (!gekozen) return;

        template.roleMenus.push({
          channel: gekozen.waarde,
          title: 'Kies je rollen',
          description: '',
          style: 'buttons',
          options: [],
        });
        selection = { type: 'rolmenu', index: template.roleMenus.length - 1 };
        changed();
        return;
      }

      const menu = template.roleMenus[Number(data.menu)];
      const vrij = template.roles.filter((rol) => !menu.options.some((optie) => optie.role === rol.key));
      if (vrij.length === 0) return;

      const rol = await zoekUit({
        title: 'Welke rol komt erbij?',
        items: vrij.map((kandidaat) => ({ waarde: kandidaat.key, naam: '@' + kandidaat.name })),
      });
      if (!rol) return;

      menu.options.push({ role: rol.waarde });
      selection = { type: 'rolmenu', index: Number(data.menu) };
      changed();
      return;
    }

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
    if (data.del === 'rolmenu') {
      template.roleMenus.splice(Number(data.index), 1);
      selection = { type: 'none' };
      changed();
      return;
    }

    if (data.del === 'rolmenuRol') {
      template.roleMenus[Number(data.menu)].options.splice(Number(data.index), 1);
      changed();
      return;
    }

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

  /**
   * Slepen om te ordenen.
   *
   * De pijltjesknoppen blijven staan - op een telefoon werkt slepen niet, en
   * voor één plekje omhoog is een knop sneller. Maar een kanaal van de ene
   * categorie naar de andere is met pijltjes geen doen.
   */
  for (const element of container.querySelectorAll('[data-sleep]')) {
    element.ondragstart = (gebeurtenis) => {
      sleept = lees(element.dataset);
      gebeurtenis.dataTransfer.effectAllowed = 'move';
      // Firefox begint pas te slepen als er iets in het klembord zit.
      gebeurtenis.dataTransfer.setData('text/plain', element.dataset.sleep);
    };

    element.ondragend = () => {
      sleept = null;
      for (const doel of container.querySelectorAll('.sleepdoel')) doel.classList.remove('sleepdoel');
    };

    element.ondragover = (gebeurtenis) => {
      if (!sleept || !magHier(sleept, lees(element.dataset))) return;
      gebeurtenis.preventDefault();
      element.classList.add('sleepdoel');
    };

    element.ondragleave = () => element.classList.remove('sleepdoel');

    element.ondrop = (gebeurtenis) => {
      element.classList.remove('sleepdoel');
      if (!sleept) return;

      const naar = lees(element.dataset);
      if (!magHier(sleept, naar)) return;
      gebeurtenis.preventDefault();
      gebeurtenis.stopPropagation();

      verplaats(sleept, naar);
      sleept = null;
      changed();
    };
  }

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

  on('data-mrol', (data) => {
    matrixRole = data.mrol;
    draw(container);
  });

  on('data-tri', (data) => {
    const overwrites = currentOverwrites();
    if (!overwrites) return;
    const [roleKey, permission] = data.tri.split('|');
    cycleOverwrite(overwrites, roleKey, permission);
    changed();
  });

  for (const veld of container.querySelectorAll('[data-guild]')) {
    veld.onchange = () => {
      const naam = veld.dataset.guild;

      // De naam en omschrijving van de template zelf staan niet onder guild.
      if (naam === 'templateName') ctx.template.name = veld.value;
      else if (naam === 'templateDescription') ctx.template.description = veld.value;
      else if (veld.type === 'checkbox') {
        if (veld.checked) ctx.template.guild.community = true;
        else delete ctx.template.guild.community;
      } else if (veld.value === '') {
        // Leeg is "niet instellen", en dat is iets anders dan een lege waarde
        // naar Discord sturen. Dus het veld verdwijnt uit de template.
        delete ctx.template.guild[naam];
      } else {
        ctx.template.guild[naam] = naam === 'afkTimeoutSeconds' ? Number(veld.value) : veld.value;
      }

      changed();
    };
  }

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

  for (const input of container.querySelectorAll('[data-rolmenu]')) {
    input.onchange = () => {
      ctx.template.roleMenus[selection.index][input.dataset.rolmenu] = input.value;
      changed();
    };
  }

  for (const input of container.querySelectorAll('[data-rolmenu-optie]')) {
    input.onchange = () => {
      const optie = ctx.template.roleMenus[selection.index].options[Number(input.dataset.index)];
      const naam = input.dataset.rolmenuOptie;
      // Leeg betekent "niet opgeven": dan pakt de bot de naam van de rol.
      if (input.value.trim() === '') delete optie[naam];
      else optie[naam] = input.value;
      changed();
    };
  }

  on('data-kleur', (data) => {
    ctx.template.roles[selection.index].color = data.kleur;
    changed();
  });

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

  const zoekveld = container.querySelector('#treeZoek');
  if (zoekveld) {
    zoekveld.oninput = () => {
      zoekterm = zoekveld.value.trim().toLowerCase();
      draw(container);
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
    tags: [],
  };
}

const slug = (naam) => naam.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'rol';

/**
 * Een kanaalnaam die nog niet in dezelfde categorie voorkomt.
 *
 * Twee kanalen met dezelfde naam is precies waar de uitroller over struikelt:
 * hij zoekt op naam en kan er dan maar een bedoelen.
 */
function kanaalNaamVrij(naam, lijst) {
  const namen = new Set(lijst.map((kanaal) => kanaal.name.toLowerCase()));
  let kandidaat = naam;
  let nummer = 2;
  while (namen.has(kandidaat.toLowerCase())) kandidaat = naam + '-' + nummer++;
  return kandidaat;
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
  const wanted = slug(role.name);
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
