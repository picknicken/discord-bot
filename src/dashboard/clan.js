import { ask, busy, emptyState, escapeHtml, icon, toast } from './ui.js';

/**
 * Het clanscherm: de tweede tak van dit dashboard.
 *
 * Bij Templates bouw je een server; hier bepaal je wie er binnen welke rol
 * krijgt. De volgorde op het scherm is de volgorde waarin je het instelt:
 * eerst welke clans meetellen, dan per rang een rol, dan wie wie is, en pas
 * onderaan de knop die het echt doet.
 *
 * Voor de demo worden alle dashboardscripts tot één module samengevoegd. Namen
 * die app.js al gebruikt ($, api, state) kunnen hier dus niet nog eens staan —
 * vandaar `el`, `vraag` en `appState`.
 */

let vraag;
let appState;
let gekozen = null;

/** Alles wat de server ons over deze server vertelde. */
let gegevens = null;
/** Het laatste voorbeeld van wat er zou veranderen. */
let plan = null;
/** De laatste zoekresultaten bij WiseOldMan. */
let zoeklijst = null;

const el = (id) => document.getElementById(id);

export function koppelClan(context) {
  vraag = context.api;
  appState = context.state;

  el('clanServer').onchange = (event) => {
    gekozen = event.target.value;
    plan = null;
    zoeklijst = null;
    void laad();
  };
}

/** Wordt aangeroepen zodra het scherm in beeld komt. */
export async function toonClan() {
  vulServers();
  if (!gekozen) return teken();
  if (!gegevens || gegevens.guildId !== gekozen) return laad();
  teken();
}

/** De teller in de zijbalk: hoeveel leden er gekoppeld zijn. */
export function clanTelling() {
  return gegevens?.koppelingen.length ?? 0;
}

function vulServers() {
  const kiezer = el('clanServer');
  const servers = appState.guilds || [];

  kiezer.innerHTML = servers
    .map((guild) => '<option value="' + escapeHtml(guild.id) + '">' + escapeHtml(guild.name) + '</option>')
    .join('');

  if (servers.length > 0 && !servers.some((guild) => guild.id === gekozen)) gekozen = servers[0].id;
  if (gekozen) kiezer.value = gekozen;
  kiezer.disabled = servers.length < 2;
}

async function laad() {
  if (!gekozen) return teken();
  el('clanInhoud').innerHTML = busy('Clangegevens ophalen bij WiseOldMan…');

  try {
    gegevens = await vraag('/clan/' + gekozen, { timeout: 60000 });
    teken();
  } catch (error) {
    el('clanInhoud').innerHTML = '<div class="note bad">' + escapeHtml(error.message) + '</div>';
  }
}

// --- tekenen ---------------------------------------------------------------

function teken() {
  const doel = el('clanInhoud');

  if ((appState.guilds || []).length === 0) {
    doel.innerHTML = emptyState('server', 'De bot zit nog in geen enkele server waar jij beheerder bent.');
    return;
  }
  if (!gegevens) {
    doel.innerHTML = busy('Clangegevens ophalen…');
    return;
  }

  const telling = el('telClan');
  if (telling) telling.textContent = clanTelling() || '';

  doel.innerHTML =
    paneelUitleg() +
    rechtenmelding() +
    paneelClans() +
    paneelExtra() +
    paneelLeden() +
    paneelBijwerken();

  koppelKnoppen();
}

/**
 * Eerst uitleggen wat dit scherm doet. Wie hier voor het eerst komt ziet anders
 * drie panelen met dropdowns en moet zelf maar raden waar het begint.
 */
function paneelUitleg() {
  return (
    '<div class="uitleg">' +
    icon('info', 'lg') +
    '<div><strong>Zo werkt het</strong>' +
    '<ol>' +
    '<li>Kies hieronder welke clans meetellen. Dat zijn <em>groups</em> op ' +
    '<a href="https://wiseoldman.net/groups" target="_blank" rel="noopener">wiseoldman.net</a> — ' +
    'daar houdt je clan zijn ledenlijst met rangen bij.</li>' +
    '<li>Koppel per rang uit die clan een Discord-rol.</li>' +
    '<li>Nieuwe leden krijgen bij binnenkomst een knop <em>Koppel je OSRS-naam</em>. Eén tik, naam ' +
    'invullen, klaar. (Of zelf: <code>/clan koppel</code>.)</li>' +
    '</ol>' +
    '<small class="muted">Staat iemand in geen van de gekozen clans, dan krijgt hij geen rol — zijn naam ' +
    'blijft wel gekoppeld, dus zodra hij lid wordt telt hij vanzelf mee. Clans die je hier niet kiest ' +
    'tellen niet mee.</small>' +
    '</div></div>'
  );
}

function rechtenmelding() {
  const meldingen = [];
  if (!gegevens.magRollen) {
    meldingen.push('De bot mist het recht "Rollen beheren" in deze server — hij kan dus geen enkele rol uitdelen.');
  }
  if (gegevens.instellingen.bijnaam && !gegevens.magBijnamen) {
    meldingen.push('Bijnamen gelijktrekken staat aan, maar de bot mist het recht "Bijnamen beheren".');
  }
  if (gegevens.instellingen.welkom && gegevens.ledenIntent === false) {
    meldingen.push(
      'Het welkomstbericht staat aan, maar de bot hoort niemand binnenkomen: zet in het Developer Portal ' +
        'onder Bot → Privileged Gateway Intents de "Server Members Intent" aan en start de bot opnieuw. ' +
        'Met /clan knop kun je ondertussen zelf een knop neerzetten.',
    );
  }
  if (gegevens.demo) {
    meldingen.push('Demomodus: je kunt alles instellen en een voorbeeld bekijken, maar er verandert niets in Discord.');
  }

  return meldingen
    .map((melding) => '<div class="note warn" style="margin-bottom:14px">' + escapeHtml(melding) + '</div>')
    .join('');
}

function paneelClans() {
  const blokken = gegevens.clans.length > 0
    ? gegevens.clans.map(clanBlok).join('')
    : '<div class="empty">' + icon('crown') + '<div>Nog geen clan gekozen. Zoek hieronder je clan op naam.</div></div>';

  return paneel('crown', 'Clans die meetellen', blokken + zoekblok());
}

function clanBlok(clan) {
  const kop =
    '<div class="clankop">' +
    '<div class="grow"><strong>' + escapeHtml(clan.naam || 'clan ' + clan.groupId) + '</strong>' +
    '<small class="muted">' +
    (clan.fout ? 'ledenlijst niet opgehaald' : escapeHtml(clan.aantal + ' leden · ' + clan.rangen.length + ' rangen in gebruik')) +
    ' · <a href="https://wiseoldman.net/groups/' + encodeURIComponent(clan.groupId) + '" target="_blank" rel="noopener">' +
    'groep ' + escapeHtml(String(clan.groupId)) + '</a></small></div>' +
    '<button class="btn-sm" data-vernieuw="' + clan.groupId + '">' + icon('history', 'sm') + 'Vernieuwen</button>' +
    '<button class="btn-sm btn-danger" data-weg="' + clan.groupId + '">' + icon('trash', 'sm') + '</button>' +
    '</div>';

  if (clan.fout) {
    return '<div class="clanblok">' + kop + '<div class="note bad">' + escapeHtml(clan.fout) + '</div></div>';
  }

  const rangen = clan.rangen
    .map(
      (regel) =>
        '<div class="rang">' + escapeHtml(regel.naam) + '</div>' +
        rolKiezer(clan.groupId, regel.rang, clan.rangRollen[regel.rang] ?? '') +
        '<div class="telling">' + escapeHtml(regel.aantal + ' leden') + '</div>',
    )
    .join('');

  return (
    '<div class="clanblok">' + kop +
    '<label class="field"><span>Rol voor iedereen in deze clan, ongeacht rang</span>' +
    rolKiezer(clan.groupId, null, clan.lidRol ?? '') + '</label>' +
    (clan.rangen.length > 0
      ? '<div class="rangen">' + rangen + '</div>' +
        '<div class="row" style="margin-top:10px">' +
        '<button class="btn-sm" data-raad="' + clan.groupId + '">' + icon('zap', 'sm') + 'Invullen op rolnaam</button>' +
        '<button class="btn-sm" data-maak="' + clan.groupId + '">' + icon('plus', 'sm') + 'Ontbrekende rollen aanmaken</button>' +
        '</div>'
      : '<p class="muted" style="font-size:12px">Deze clan gebruikt nog geen rangen op WiseOldMan.</p>') +
    '</div>'
  );
}

function zoekblok() {
  const resultaten = zoeklijst
    ? zoeklijst.length === 0
      ? '<p class="muted" style="font-size:12px;margin-top:8px">Niets gevonden. Staat je clan wel op WiseOldMan?</p>'
      : '<div class="zoeklijst">' +
        zoeklijst
          .map(
            (groep) =>
              '<div class="wissel"><div class="grow"><strong>' + escapeHtml(groep.naam) + '</strong>' +
              '<small class="muted">' + escapeHtml(groep.aantal + ' leden') +
              (groep.clanChat ? ' · cc ' + escapeHtml(groep.clanChat) : '') + '</small></div>' +
              '<button class="btn-sm" data-toevoegen="' + groep.id + '">' + icon('plus', 'sm') + 'Laat meetellen</button></div>',
          )
          .join('') +
        '</div>'
    : '';

  return (
    '<div class="zoekblok">' +
    '<div class="row">' +
    '<input type="text" id="clanZoek" placeholder="Clan zoeken op naam" style="flex:1;min-width:200px">' +
    '<button id="clanZoekKnop" class="btn-sm">' + icon('eye', 'sm') + 'Zoeken</button>' +
    '</div>' + resultaten + '</div>'
  );
}

function paneelExtra() {
  const vink = (id, aan, label, uitleg) =>
    '<label class="check" style="margin-bottom:8px"><input type="checkbox" id="' + id + '"' + (aan ? ' checked' : '') + '>' +
    '<span>' + escapeHtml(label) + '<br><small class="muted">' + escapeHtml(uitleg) + '</small></span></label>';

  const kanalen = (gegevens.kanalen ?? [])
    .map(
      (kanaal) =>
        '<option value="' + escapeHtml(kanaal.id) + '"' +
        (kanaal.id === gegevens.instellingen.welkomKanaal ? ' selected' : '') + '>#' +
        escapeHtml(kanaal.naam) + '</option>',
    )
    .join('');

  return paneel(
    'server',
    'Verder nog',
    vink('clanWelkom', gegevens.instellingen.welkom, 'Nieuwe leden begroeten met een koppelknop',
      'Discord verraadt niet wie iemand in het spel is; dit vraagt het meteen, met één knop.') +
      '<label class="field" style="margin-left:26px"><span>In welk kanaal</span>' +
      '<select id="clanWelkomKanaal"><option value="">automatisch — het systeemkanaal</option>' +
      kanalen + '</select></label>' +
      '<label class="field"><span>Rol voor gekoppelde leden die in géén van de gekozen clans zitten ' +
      '(leeg laten = geen rol)</span>' +
      rolKiezer('gast', null, gegevens.instellingen.gastRol ?? '') + '</label>' +
      vink('clanBijnaam', gegevens.instellingen.bijnaam, 'Bijnaam gelijktrekken met de OSRS-naam',
        'Handig als je in Discord wilt zien wie wie is in het spel.') +
      vink('clanOpruimen', gegevens.instellingen.opruimen, 'Rollen weer afnemen als ze niet meer kloppen',
        'Alleen de rollen die je hierboven koppelt; andere rollen blijft de bot af.') +
      vink('clanAutomatisch', gegevens.instellingen.automatisch, 'Elk uur vanzelf bijwerken',
        'Rangen veranderen in het spel; zo hoeft niemand daarna een knop te zoeken.') +
      '<div class="row" style="margin-top:6px">' +
      '<button id="clanOpslaan" class="btn-primary">' + icon('save', 'sm') + 'Instellingen opslaan</button>' +
      '<span class="muted" style="font-size:11.5px">Slaat alle clans hierboven in één keer op.</span>' +
      '</div>',
  );
}

function paneelLeden() {
  const koppelingen = gegevens.koppelingen;

  const lijst =
    koppelingen.length === 0
      ? emptyState('server', 'Nog niemand gekoppeld. Leden doen dat zelf met /clan koppel.')
      : koppelingen
          .map(
            (koppeling) =>
              '<div class="wissel">' +
              icon(koppeling.inServer ? 'check' : 'alert') +
              '<div class="grow"><strong>' + escapeHtml(koppeling.rsn) + '</strong>' +
              '<small class="muted">' +
              escapeHtml(koppeling.weergavenaam ? koppeling.weergavenaam : 'niet in deze server') + ' · ' +
              escapeHtml(
                koppeling.gezien.length > 0
                  ? koppeling.gezien.map((plek) => plek.rangNaam + ' in ' + plek.clan).join(', ')
                  : 'clan nog onbekend',
              ) +
              ' · gekoppeld door ' + escapeHtml(koppeling.door || 'onbekend') +
              '</small></div>' +
              '<button class="btn-sm btn-danger" data-ontkoppel="' + escapeHtml(koppeling.discordId) + '">' +
              icon('trash', 'sm') + '</button></div>',
          )
          .join('');

  const ongekoppeld = (plan?.ongekoppeld ?? [])
    .map(
      (regel) =>
        '<details style="margin-top:12px"><summary>' +
        escapeHtml(regel.leden.length + ' leden van ' + regel.clan + ' zonder Discord-koppeling') +
        '</summary><p class="muted" style="font-size:12px;padding:6px 0">' +
        escapeHtml(regel.leden.slice(0, 60).join(', ')) + (regel.leden.length > 60 ? ' …' : '') +
        '</p></details>',
    )
    .join('');

  return paneel(
    'shield',
    'Gekoppelde leden (' + koppelingen.length + ')',
    lijst +
      '<div class="row" style="margin-top:12px">' +
      '<input type="text" id="clanNieuwId" placeholder="Discord-gebruikers-id" style="flex:1;min-width:190px">' +
      '<input type="text" id="clanNieuwRsn" placeholder="OSRS-naam" maxlength="12" style="flex:1;min-width:150px">' +
      '<button id="clanKoppel" class="btn-sm">' + icon('plus', 'sm') + 'Koppelen</button>' +
      '</div>' +
      '<small class="muted">Met de hand koppelen hoeft zelden: leden doen /clan koppel zelf.</small>' +
      ongekoppeld,
  );
}

function paneelBijwerken() {
  return paneel(
    'zap',
    'Rollen bijwerken',
    '<div class="row">' +
      '<button id="clanPreview">' + icon('play', 'sm') + 'Voorbeeld</button>' +
      '<button id="clanToepassen" class="btn-primary">' + icon('zap', 'sm') + 'Rollen bijwerken</button>' +
      '</div><div id="clanUitkomst" style="margin-top:12px">' + (plan ? tekenPlan(plan) : '') + '</div>',
  );
}

function tekenPlan(uitkomst) {
  const waarschuwingen = (uitkomst.waarschuwingen ?? [])
    .map((regel) => '<div class="note warn" style="margin-bottom:8px">' + escapeHtml(regel) + '</div>')
    .join('');

  if (uitkomst.wissels.length === 0) {
    return (
      waarschuwingen +
      '<div class="note ok">Niets te doen — alle ' + escapeHtml(String(uitkomst.ongewijzigd)) +
      ' gekoppelde leden hebben de rol die bij hun rang hoort.</div>'
    );
  }

  const regels = uitkomst.wissels
    .map(
      (wissel) =>
        '<div class="wissel">' +
        icon(wissel.problemen.length > 0 ? 'alert' : wissel.gevonden.length > 0 ? 'check' : 'info') +
        '<div class="grow"><strong>' + escapeHtml(wissel.rsn) + '</strong>' +
        '<small class="muted">' + escapeHtml(wissel.weergavenaam) + ' · ' + escapeHtml(wissel.reden) + '</small>' +
        (wissel.problemen.length > 0
          ? '<small style="color:var(--warn)">' + escapeHtml(wissel.problemen.join('; ')) + '</small>'
          : '') +
        '</div></div>',
    )
    .join('');

  return (
    waarschuwingen +
    '<p class="muted" style="font-size:12px;margin-bottom:6px">' +
    escapeHtml(
      uitkomst.wissels.length + ' leden krijgen een wijziging, ' + uitkomst.ongewijzigd + ' stonden al goed' +
        (uitkomst.vertrokken.length > 0 ? ', ' + uitkomst.vertrokken.length + ' zijn de server uit' : '') + '.',
    ) +
    '</p>' + regels
  );
}

// --- knoppen ---------------------------------------------------------------

function koppelKnoppen() {
  el('clanZoekKnop').onclick = zoekClan;
  el('clanZoek').onkeydown = (event) => {
    if (event.key === 'Enter') zoekClan();
  };
  el('clanOpslaan').onclick = opslaan;
  el('clanKoppel').onclick = koppelLid;
  el('clanPreview').onclick = () => bijwerken(false);
  el('clanToepassen').onclick = () => bijwerken(true);

  const bij = (attribuut, doe) => {
    for (const knop of document.querySelectorAll('[data-' + attribuut + ']')) {
      knop.onclick = () => doe(Number(knop.dataset[attribuut]));
    }
  };

  bij('vernieuw', vernieuwClan);
  bij('weg', haalClanWeg);
  bij('raad', raadRollen);
  bij('maak', maakRollen);
  bij('toevoegen', voegClanToe);

  for (const knop of document.querySelectorAll('[data-ontkoppel]')) {
    knop.onclick = () => ontkoppelLid(knop.dataset.ontkoppel);
  }
}

/** De instellingen zoals ze nú op het scherm staan. */
function uitScherm() {
  return {
    clans: gegevens.clans.map((clan) => {
      const rangRollen = {};
      for (const veld of document.querySelectorAll('[data-clan="' + clan.groupId + '"][data-rang]')) {
        if (veld.value) rangRollen[veld.dataset.rang] = veld.value;
      }

      // Rangen die in de ledenlijst (even) niet voorkomen blijven staan: een
      // clan zonder Sergeant op dit moment is niet hetzelfde als een clan die
      // die rol nooit meer wil.
      const bewaard = { ...clan.rangRollen, ...rangRollen };
      for (const regel of clan.rangen) {
        if (!rangRollen[regel.rang]) delete bewaard[regel.rang];
      }

      return {
        groupId: clan.groupId,
        naam: clan.naam,
        lidRol: el('lidrol-' + clan.groupId)?.value || null,
        rangRollen: bewaard,
      };
    }),
    gastRol: el('lidrol-gast')?.value || null,
    bijnaam: el('clanBijnaam').checked,
    opruimen: el('clanOpruimen').checked,
    automatisch: el('clanAutomatisch').checked,
    welkom: el('clanWelkom').checked,
    welkomKanaal: el('clanWelkomKanaal')?.value || null,
  };
}

async function opslaan() {
  try {
    const uitkomst = await vraag('/clan/' + gekozen, {
      method: 'PUT',
      body: JSON.stringify({ instellingen: uitScherm() }),
    });
    gegevens.instellingen = uitkomst.instellingen;
    toast('Clan-instellingen opgeslagen.', 'ok');
    await laad();
  } catch (error) {
    toast(error.message, 'bad', 6000);
  }
}

async function zoekClan() {
  const naam = el('clanZoek').value.trim();
  if (!naam) return toast('Typ een deel van de clannaam.', 'bad');

  const knop = el('clanZoekKnop');
  knop.disabled = true;
  try {
    zoeklijst = (await vraag('/clan/' + gekozen + '/zoek', {
      method: 'POST',
      body: JSON.stringify({ naam }),
      timeout: 60000,
    })).gevonden;
    teken();
    el('clanZoek').value = naam;
  } catch (error) {
    toast(error.message, 'bad', 7000);
    knop.disabled = false;
  }
}

async function voegClanToe(groupId) {
  try {
    const uitkomst = await vraag('/clan/' + gekozen + '/toevoegen', {
      method: 'POST',
      body: JSON.stringify({ groupId }),
      timeout: 60000,
    });
    gegevens.instellingen = uitkomst.instellingen;
    gegevens.clans = uitkomst.clans;
    zoeklijst = null;
    toast('Deze clan telt nu mee.', 'ok');
    teken();
  } catch (error) {
    toast(error.message, 'bad', 7000);
  }
}

async function haalClanWeg(groupId) {
  const clan = gegevens.clans.find((kandidaat) => kandidaat.groupId === groupId);

  const akkoord = await ask({
    title: 'Clan niet meer laten meetellen',
    body:
      '"' + (clan?.naam ?? groupId) + '" telt dan niet meer mee, met de rolkoppelingen die erbij horen. ' +
      'Rollen die leden al hebben blijven staan tot de eerstvolgende keer bijwerken.',
    confirmLabel: 'Weghalen',
    danger: true,
  });
  if (!akkoord) return;

  try {
    const uitkomst = await vraag('/clan/' + gekozen + '/verwijderen', {
      method: 'POST',
      body: JSON.stringify({ groupId }),
    });
    gegevens.instellingen = uitkomst.instellingen;
    gegevens.clans = uitkomst.clans;
    teken();
  } catch (error) {
    toast(error.message, 'bad', 6000);
  }
}

async function vernieuwClan(groupId) {
  try {
    const uitkomst = await vraag('/clan/' + gekozen + '/leden', {
      method: 'POST',
      body: JSON.stringify({ groupId }),
      timeout: 60000,
    });
    gegevens.clans = gegevens.clans.map((clan) => (clan.groupId === groupId ? uitkomst.clan : clan));
    toast(uitkomst.clan.aantal + ' leden opgehaald.', 'ok');
    teken();
  } catch (error) {
    toast(error.message, 'bad', 7000);
  }
}

/** De voorzet van de server overnemen: rollen die al zo heten als de rang. */
function raadRollen(groupId) {
  const clan = gegevens.clans.find((kandidaat) => kandidaat.groupId === groupId);
  let ingevuld = 0;

  for (const [rang, rolId] of Object.entries(clan?.voorstel ?? {})) {
    const veld = document.querySelector('[data-clan="' + groupId + '"][data-rang="' + rang + '"]');
    if (!veld || veld.value) continue;
    veld.value = rolId;
    ingevuld += 1;
  }

  toast(
    ingevuld > 0
      ? ingevuld + ' rang(en) ingevuld. Vergeet niet op te slaan.'
      : 'Geen rollen gevonden die net zo heten als een rang van deze clan.',
    ingevuld > 0 ? 'ok' : 'info',
  );
}

async function maakRollen(groupId) {
  const clan = gegevens.clans.find((kandidaat) => kandidaat.groupId === groupId);
  const leeg = (clan?.rangen ?? []).filter(
    (regel) => !document.querySelector('[data-clan="' + groupId + '"][data-rang="' + regel.rang + '"]')?.value,
  );

  if (leeg.length === 0) return toast('Elke rang heeft al een rol.', 'info');

  const akkoord = await ask({
    title: 'Rollen aanmaken',
    body:
      'Dit maakt ' + leeg.length + ' rollen aan in deze server: ' + leeg.map((regel) => regel.naam).join(', ') +
      '. Bestaat er al een rol met die naam, dan wordt die gepakt. Niet-opgeslagen wijzigingen ' +
      'hierboven gaan verloren.',
    confirmLabel: 'Aanmaken',
  });
  if (!akkoord) return;

  try {
    const uitkomst = await vraag('/clan/' + gekozen + '/rollen', {
      method: 'POST',
      body: JSON.stringify({ groupId, rangen: leeg.map((regel) => regel.rang) }),
      timeout: 60000,
    });
    for (const fout of uitkomst.fouten ?? []) toast(fout, 'bad', 6000);
    toast(uitkomst.note ?? uitkomst.gemaakt.length + ' rollen aangemaakt.', 'ok');
    await laad();
  } catch (error) {
    toast(error.message, 'bad', 6000);
  }
}

async function koppelLid() {
  const discordId = el('clanNieuwId').value.trim();
  const rsn = el('clanNieuwRsn').value.trim();
  if (!discordId || !rsn) return toast('Vul allebei de velden in.', 'bad');

  try {
    gegevens.koppelingen = (
      await vraag('/clan/' + gekozen + '/koppel', { method: 'POST', body: JSON.stringify({ discordId, rsn }) })
    ).koppelingen;
    toast('Gekoppeld.', 'ok');
    teken();
  } catch (error) {
    toast(error.message, 'bad', 6000);
  }
}

async function ontkoppelLid(discordId) {
  const koppeling = gegevens.koppelingen.find((kandidaat) => kandidaat.discordId === discordId);

  const akkoord = await ask({
    title: 'Koppeling weghalen',
    body:
      'De koppeling met "' + (koppeling?.rsn ?? discordId) + '" gaat weg. Rollen die dit lid al heeft ' +
      'blijven staan tot de eerstvolgende keer bijwerken.',
    confirmLabel: 'Weghalen',
    danger: true,
  });
  if (!akkoord) return;

  try {
    gegevens.koppelingen = (
      await vraag('/clan/' + gekozen + '/ontkoppel', { method: 'POST', body: JSON.stringify({ discordId }) })
    ).koppelingen;
    teken();
  } catch (error) {
    toast(error.message, 'bad', 6000);
  }
}

/**
 * Eerst kijken, dan doen. Toepassen vraagt om een bevestiging met het aantal
 * erin: rollen uitdelen is zichtbaar voor de hele server, en dat hoort geen
 * losse klik te zijn.
 */
async function bijwerken(echt) {
  if (gegevens.instellingen.clans.length === 0) return toast('Kies eerst een clan en sla dat op.', 'bad');

  const uitkomst = el('clanUitkomst');
  uitkomst.innerHTML = busy(echt ? 'Rollen bijwerken…' : 'Voorbeeld maken…');

  try {
    if (echt) {
      const voorbeeld = await vraag('/clan/' + gekozen + '/plan', { method: 'POST', body: '{}', timeout: 120000 });
      plan = voorbeeld.plan;

      if (plan.wissels.length === 0) {
        uitkomst.innerHTML = tekenPlan(plan);
        return;
      }

      const akkoord = await ask({
        title: 'Rollen bijwerken',
        body:
          'Dit past de rollen van ' + plan.wissels.length + ' leden aan in ' +
          (gegevens.guildName || 'deze server') + '. Iedereen ziet dat meteen in Discord.',
        confirmLabel: 'Doen',
      });
      if (!akkoord) {
        uitkomst.innerHTML = tekenPlan(plan);
        return;
      }
    }

    const antwoord = await vraag('/clan/' + gekozen + (echt ? '/sync' : '/plan'), {
      method: 'POST',
      body: '{}',
      timeout: 120000,
    });

    plan = antwoord.plan;

    if (!echt) {
      uitkomst.innerHTML = tekenPlan(plan);
      return;
    }

    // Na het bijwerken staat er van alles anders: de laatst geziene rangen, en
    // soms een lid dat er niet meer is. Dus opnieuw ophalen, opnieuw tekenen, en
    // daarna pas de uitkomst eronder — die zou anders meteen weggetekend worden.
    gegevens = await vraag('/clan/' + gekozen, { timeout: 60000 });
    teken();
    el('clanUitkomst').innerHTML = melding(antwoord) + tekenPlan(plan);
  } catch (error) {
    uitkomst.innerHTML = '<div class="note bad">' + escapeHtml(error.message) + '</div>';
  }
}

function melding(antwoord) {
  if (antwoord.note) return '<div class="note warn" style="margin-bottom:10px">' + escapeHtml(antwoord.note) + '</div>';

  const soort = antwoord.mislukt > 0 ? 'warn' : 'ok';
  const fouten = (antwoord.fouten ?? [])
    .slice(0, 8)
    .map((fout) => '<br>• ' + escapeHtml(fout))
    .join('');

  return (
    '<div class="note ' + soort + '" style="margin-bottom:10px">' +
    escapeHtml(antwoord.aangepast + ' leden bijgewerkt') +
    (antwoord.mislukt > 0 ? escapeHtml(', ' + antwoord.mislukt + ' mislukt') : '') +
    '.' + fouten + '</div>'
  );
}

// --- bouwstenen ------------------------------------------------------------

function paneel(iconNaam, titel, inhoud) {
  return (
    '<section class="panel" style="margin-bottom:14px">' +
    '<div class="phead">' + icon(iconNaam) + '<h2 class="grow">' + escapeHtml(titel) + '</h2></div>' +
    '<div class="pbody">' + inhoud + '</div></section>'
  );
}

/**
 * Een rolkeuze. Rangen worden gevonden via data-attributen in plaats van via een
 * id: een rang heet bij WiseOldMan "deputy_owner" of "short_green_guy", en dat
 * soort namen wil je niet in een id hebben staan.
 */
function rolKiezer(groupId, rang, gekozenRol) {
  const opties = gegevens.rollen
    .map(
      (rol) =>
        '<option value="' + escapeHtml(rol.id) + '"' + (rol.id === gekozenRol ? ' selected' : '') + '>' +
        escapeHtml(rol.naam) + (rol.beheerbaar ? '' : ' — bot kan deze niet uitdelen') +
        '</option>',
    )
    .join('');

  const kenmerk = rang === null
    ? ' id="lidrol-' + escapeHtml(String(groupId)) + '"'
    : ' data-clan="' + escapeHtml(String(groupId)) + '" data-rang="' + escapeHtml(rang) + '"';

  return '<select' + kenmerk + '><option value="">— geen rol —</option>' + opties + '</select>';
}
