import { ask, busy, emptyState, escapeHtml, icon, toast } from './ui.js';

/**
 * Het clanscherm: de tweede tak van dit dashboard.
 *
 * Bij Templates bouw je een server; hier bepaal je wie er binnen welke rol
 * krijgt. Dat is bewust een eigen scherm en een eigen bestand: het praat met
 * RuneScape in plaats van met een JSON-bestand, en het enige wat het met de
 * rest deelt is de server waar het over gaat.
 *
 * De volgorde op het scherm is de volgorde waarin je het instelt: eerst welke
 * clan, dan welke rol bij welke rang, dan wie wie is, en pas onderaan de knop
 * die het echt doet.
 */

let vraag;
let appState;
let gekozen = null;

/** Alles wat de server ons over deze clan vertelde. */
let gegevens = null;
/** De laatst opgehaalde ledenlijst bij Jagex. */
let ledenlijst = null;
/** Het laatste voorbeeld van wat er zou veranderen. */
let plan = null;

/**
 * Voor de demo worden alle dashboardscripts tot één module samengevoegd. Namen
 * die app.js al gebruikt ($, api, state) kunnen hier dus niet nog eens staan —
 * vandaar `el`, `vraag` en `appState`.
 */
const el = (id) => document.getElementById(id);

export function koppelClan(context) {
  vraag = context.api;
  appState = context.state;

  el('clanServer').onchange = (event) => {
    gekozen = event.target.value;
    ledenlijst = null;
    plan = null;
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
  el('clanInhoud').innerHTML = busy('Clangegevens ophalen…');

  try {
    gegevens = await vraag('/clan/' + gekozen);
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
    rechtenmelding() +
    paneelClan() +
    paneelRangen() +
    paneelExtra() +
    paneelLeden() +
    paneelBijwerken();

  koppelKnoppen();
}

function rechtenmelding() {
  const meldingen = [];
  if (!gegevens.magRollen) {
    meldingen.push('De bot mist het recht "Rollen beheren" in deze server — hij kan dus geen enkele rol uitdelen.');
  }
  if (gegevens.instellingen.bijnaam && !gegevens.magBijnamen) {
    meldingen.push('Bijnamen gelijktrekken staat aan, maar de bot mist het recht "Bijnamen beheren".');
  }
  if (gegevens.demo) {
    meldingen.push('Demomodus: je kunt alles instellen en een voorbeeld bekijken, maar er verandert niets in Discord.');
  }

  return meldingen
    .map((melding) => '<div class="note warn" style="margin-bottom:14px">' + escapeHtml(melding) + '</div>')
    .join('');
}

function paneelClan() {
  const lijst = ledenlijst
    ? '<div class="note ok" style="margin-top:10px">' +
      escapeHtml(
        ledenlijst.leden.length +
          ' leden in "' + ledenlijst.clan + '"' +
          (ledenlijst.uitCache ? ' (uit het geheugen van een paar minuten geleden)' : ''),
      ) +
      '</div>'
    : '';

  return paneel(
    'crown',
    'Welke clan',
    '<label class="field"><span>Clannaam, precies zoals hij in RuneScape heet</span>' +
      '<input type="text" id="clanNaam" maxlength="64" placeholder="bijvoorbeeld: Bloody Mayhem" value="' +
      escapeHtml(gegevens.instellingen.clan) + '"></label>' +
      '<div class="row">' +
      '<button id="clanHaal" class="btn-sm">' + icon('download', 'sm') + 'Ledenlijst ophalen</button>' +
      '<span class="muted" style="font-size:11.5px">Jagex werkt die lijst eens per dag bij.</span>' +
      '</div>' +
      lijst,
  );
}

function paneelRangen() {
  const perRang = new Map((ledenlijst?.perRang ?? []).map((regel) => [regel.rang, regel.aantal]));

  const rijen = gegevens.rangen
    .map(
      (rang) =>
        '<div class="rang">' + escapeHtml(rang) + '</div>' +
        rolKiezer(rangId(rang), gegevens.instellingen.rangRollen[rang] ?? '', rang) +
        '<div class="telling">' + (perRang.has(rang) ? escapeHtml(perRang.get(rang) + ' leden') : '') + '</div>',
    )
    .join('');

  return paneel(
    'shield',
    'Rang naar rol',
    '<p class="muted" style="font-size:12px;margin-bottom:10px">Staat er bij een rang geen rol, dan zakt ' +
      'iemand door naar de eerstvolgende lagere rang die er wél een heeft. Je hoeft dus niet alle twaalf in te vullen.</p>' +
      '<div class="rangen">' + rijen + '</div>' +
      '<div class="row" style="margin-top:12px">' +
      '<button id="clanRaad" class="btn-sm">' + icon('zap', 'sm') + 'Invullen op rolnaam</button>' +
      '<button id="clanMaakRollen" class="btn-sm">' + icon('plus', 'sm') + 'Ontbrekende rollen aanmaken</button>' +
      '</div>',
  );
}

function paneelExtra() {
  const vink = (id, aan, label, uitleg) =>
    '<label class="check" style="margin-bottom:8px"><input type="checkbox" id="' + id + '"' + (aan ? ' checked' : '') + '>' +
    '<span>' + escapeHtml(label) + '<br><small class="muted">' + escapeHtml(uitleg) + '</small></span></label>';

  return paneel(
    'server',
    'Verder nog',
    '<label class="field"><span>Rol voor iedereen in de clan, bovenop de rangrol</span>' +
      rolKiezer('clanLidRol', gegevens.instellingen.lidRol ?? '', 'lidrol') + '</label>' +
      '<label class="field"><span>Rol voor gekoppelde leden die niet in de clan zitten</span>' +
      rolKiezer('clanGastRol', gegevens.instellingen.gastRol ?? '', 'gastrol') + '</label>' +
      vink('clanBijnaam', gegevens.instellingen.bijnaam, 'Bijnaam gelijktrekken met de RuneScape-naam',
        'Handig als je in Discord wilt zien wie wie is in het spel.') +
      vink('clanOpruimen', gegevens.instellingen.opruimen, 'Rollen weer afnemen als ze niet meer kloppen',
        'Alleen de rollen hierboven; andere rollen blijft de bot af.') +
      vink('clanAutomatisch', gegevens.instellingen.automatisch, 'Elk uur vanzelf bijwerken',
        'Promoties gebeuren in het spel; zo hoeft niemand daarna een knop te zoeken.') +
      '<div class="row" style="margin-top:6px">' +
      '<button id="clanOpslaan" class="btn-primary">' + icon('save', 'sm') + 'Instellingen opslaan</button>' +
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
              escapeHtml(koppeling.weergavenaam ? koppeling.weergavenaam : 'niet in deze server') +
              ' · ' + escapeHtml(koppeling.rang ?? 'rang nog onbekend') +
              ' · gekoppeld door ' + escapeHtml(koppeling.door || 'onbekend') +
              '</small></div>' +
              '<button class="btn-sm btn-danger" data-ontkoppel="' + escapeHtml(koppeling.discordId) + '">' +
              icon('trash', 'sm') + '</button></div>',
          )
          .join('');

  const ongekoppeld = plan?.ongekoppeld?.length
    ? '<details style="margin-top:12px"><summary>' +
      escapeHtml(plan.ongekoppeld.length + ' clanleden zonder Discord-koppeling') +
      '</summary><p class="muted" style="font-size:12px;padding:6px 0">' +
      escapeHtml(plan.ongekoppeld.slice(0, 60).map((lid) => lid.naam).join(', ')) +
      (plan.ongekoppeld.length > 60 ? ' …' : '') +
      '</p></details>'
    : '';

  return paneel(
    'shield',
    'Gekoppelde leden (' + koppelingen.length + ')',
    lijst +
      '<div class="row" style="margin-top:12px">' +
      '<input type="text" id="clanNieuwId" placeholder="Discord-gebruikers-id" style="flex:1;min-width:190px">' +
      '<input type="text" id="clanNieuwRsn" placeholder="RuneScape-naam" maxlength="12" style="flex:1;min-width:150px">' +
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
        icon(wissel.problemen.length > 0 ? 'alert' : wissel.inClan ? 'check' : 'info') +
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
  el('clanHaal').onclick = haalLeden;
  el('clanRaad').onclick = raadRollen;
  el('clanMaakRollen').onclick = maakRollen;
  el('clanOpslaan').onclick = opslaan;
  el('clanKoppel').onclick = koppelLid;
  el('clanPreview').onclick = () => bijwerken(false);
  el('clanToepassen').onclick = () => bijwerken(true);

  for (const knop of document.querySelectorAll('[data-ontkoppel]')) {
    knop.onclick = () => ontkoppelLid(knop.dataset.ontkoppel);
  }
}

/** De instellingen zoals ze nú op het scherm staan. */
function uitScherm() {
  const rangRollen = {};
  for (const rang of gegevens.rangen) {
    const waarde = el(rangId(rang))?.value;
    if (waarde) rangRollen[rang] = waarde;
  }

  return {
    clan: el('clanNaam').value.trim(),
    rangRollen,
    lidRol: el('clanLidRol').value || null,
    gastRol: el('clanGastRol').value || null,
    bijnaam: el('clanBijnaam').checked,
    opruimen: el('clanOpruimen').checked,
    automatisch: el('clanAutomatisch').checked,
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
    teken();
  } catch (error) {
    toast(error.message, 'bad', 6000);
  }
}

async function haalLeden() {
  const clan = el('clanNaam').value.trim();
  if (!clan) return toast('Vul eerst een clannaam in.', 'bad');

  const knop = el('clanHaal');
  knop.disabled = true;
  try {
    ledenlijst = await vraag('/clan/' + gekozen + '/leden', {
      method: 'POST',
      body: JSON.stringify({ clan, vers: true }),
      timeout: 60000,
    });
    toast(ledenlijst.leden.length + ' clanleden opgehaald.', 'ok');
    teken();
  } catch (error) {
    toast(error.message, 'bad', 7000);
    knop.disabled = false;
  }
}

/** De voorzet van de server overnemen: rollen die al zo heten als de rang. */
function raadRollen() {
  const voorstel = gegevens.voorstel ?? {};
  let ingevuld = 0;

  for (const [rang, rolId] of Object.entries(voorstel)) {
    const veld = el(rangId(rang));
    if (!veld || veld.value) continue;
    veld.value = rolId;
    ingevuld += 1;
  }

  toast(
    ingevuld > 0
      ? ingevuld + ' rang(en) ingevuld. Vergeet niet op te slaan.'
      : 'Geen rollen gevonden die net zo heten als een clanrang.',
    ingevuld > 0 ? 'ok' : 'info',
  );
}

async function maakRollen() {
  const leeg = gegevens.rangen.filter((rang) => !el(rangId(rang))?.value);
  if (leeg.length === 0) return toast('Elke rang heeft al een rol.', 'info');

  const akkoord = await ask({
    title: 'Rollen aanmaken',
    body:
      'Dit maakt ' + leeg.length + ' rollen aan in deze server: ' + leeg.join(', ') +
      '. Bestaat er al een rol met die naam, dan wordt die gepakt. Niet-opgeslagen wijzigingen ' +
      'hierboven gaan verloren.',
    confirmLabel: 'Aanmaken',
  });
  if (!akkoord) return;

  try {
    const uitkomst = await vraag('/clan/' + gekozen + '/rollen', {
      method: 'POST',
      body: JSON.stringify({ rangen: leeg }),
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
  if (!gegevens.instellingen.clan) return toast('Stel eerst een clan in en sla dat op.', 'bad');

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
    gegevens = await vraag('/clan/' + gekozen);
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

/** "Deputy Owner" wordt "rang-Deputy-Owner": een id mag geen spatie bevatten. */
function rangId(rang) {
  return 'rang-' + rang.replace(/\s+/g, '-');
}

function paneel(iconNaam, titel, inhoud) {
  return (
    '<section class="panel" style="margin-bottom:14px">' +
    '<div class="phead">' + icon(iconNaam) + '<h2 class="grow">' + escapeHtml(titel) + '</h2></div>' +
    '<div class="pbody">' + inhoud + '</div></section>'
  );
}

function rolKiezer(id, gekozenRol, label) {
  const opties = gegevens.rollen
    .map(
      (rol) =>
        '<option value="' + escapeHtml(rol.id) + '"' + (rol.id === gekozenRol ? ' selected' : '') + '>' +
        escapeHtml(rol.naam) + (rol.beheerbaar ? '' : ' — bot kan deze niet uitdelen') +
        '</option>',
    )
    .join('');

  return (
    '<select id="' + escapeHtml(id) + '" title="' + escapeHtml(label) + '">' +
    '<option value="">— geen rol —</option>' + opties + '</select>'
  );
}
