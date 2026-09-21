/**
 * Kleine UI-bouwstenen: iconen, meldingen en dialogen. Browserdialogen (alert,
 * confirm, prompt) blokkeren de pagina en zien eruit als een foutmelding uit 2004;
 * dit is dezelfde functionaliteit in de stijl van de rest.
 */

export function icon(name, extra = '') {
  // Versiering, geen inhoud: een schermlezer hoort hier niets voor te zeggen.
  // De tekst ernaast zegt al waar de knop voor is.
  return '<svg class="icon ' + extra + '" aria-hidden="true"><use href="#i-' + name + '"/></svg>';
}

export const CHANNEL_ICONS = {
  text: 'hash',
  voice: 'voice',
  forum: 'forum',
  announcement: 'megaphone',
  stage: 'mic',
};

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

// --- meldingen -------------------------------------------------------------

const ICONS_BY_KIND = { ok: 'check', bad: 'xcircle', info: 'info' };

export function toast(message, kind = 'info', ms = 3600) {
  const host = document.getElementById('toasts');
  const element = document.createElement('div');
  element.className = 'toast ' + kind;
  element.innerHTML = icon(ICONS_BY_KIND[kind] || 'info') + '<span>' + escapeHtml(message) + '</span>';
  host.appendChild(element);

  setTimeout(() => {
    element.classList.add('leaving');
    setTimeout(() => element.remove(), 220);
  }, ms);
}

// --- dialogen --------------------------------------------------------------

/**
 * Eén dialoog voor bevestigen en vragen. Levert `false` bij annuleren, `true` bij
 * bevestigen, of de ingevulde tekst als er om invoer is gevraagd.
 */
export function ask({
  title,
  body = '',
  confirmLabel = 'Doorgaan',
  cancelLabel = 'Annuleren',
  danger = false,
  input = null,
  requireText = null,
}) {
  const dialog = document.getElementById('dialog');

  const inputHtml = input
    ? '<input type="text" id="dialogInput" value="' + escapeHtml(input.value ?? '') +
      '" placeholder="' + escapeHtml(input.placeholder ?? '') + '">'
    : requireText
      ? '<input type="text" id="dialogInput" placeholder="' + escapeHtml(requireText) + '" autocomplete="off">'
      : '';

  dialog.innerHTML =
    '<form method="dialog">' +
    '<div class="dhead"><h3>' + escapeHtml(title) + '</h3></div>' +
    '<div class="dbody">' + escapeHtml(body) + inputHtml + '</div>' +
    '<div class="dfoot">' +
    '<button value="cancel" type="submit">' + escapeHtml(cancelLabel) + '</button>' +
    '<button value="ok" type="submit" class="' + (danger ? 'btn-danger' : 'btn-primary') + '" id="dialogOk">' +
    escapeHtml(confirmLabel) + '</button>' +
    '</div></form>';

  const field = dialog.querySelector('#dialogInput');
  const okButton = dialog.querySelector('#dialogOk');

  if (requireText && field) {
    okButton.disabled = true;
    field.oninput = () => {
      okButton.disabled = field.value.trim() !== requireText;
    };
  }

  dialog.showModal();
  if (field) setTimeout(() => field.select(), 30);
  // Zonder invoerveld staat de focus op Annuleren, want dat is de eerste knop.
  // Bij een gewone vraag is doorgaan wat je bedoelt; bij iets onomkeerbaars
  // laten we hem juist staan waar hij staat.
  else if (!danger) setTimeout(() => okButton.focus(), 30);

  return new Promise((resolve) => {
    dialog.addEventListener(
      'close',
      () => {
        if (dialog.returnValue !== 'ok') return resolve(false);
        resolve(input ? (field?.value.trim() || false) : true);
      },
      { once: true },
    );
  });
}

/**
 * Springen naar iets, door te typen.
 *
 * Hetzelfde idee als kiesUit, maar met een zoekveld ervoor en toetsen eronder:
 * pijltjes om te kiezen, Enter om te gaan. Bedoeld voor een lijst die te lang
 * is om langs te scrollen.
 */
export function zoekUit({ title, items, placeholder = 'Typ om te zoeken…' }) {
  const dialog = document.getElementById('dialog');

  dialog.innerHTML =
    '<form method="dialog" class="palet">' +
    '<div class="dhead"><h3>' + escapeHtml(title) + '</h3></div>' +
    '<div class="dbody"><input type="text" id="paletVeld" autocomplete="off" placeholder="' +
    escapeHtml(placeholder) + '"></div>' +
    '<div class="keuzes" id="paletLijst"></div>' +
    '<div class="dfoot"><button value="cancel" type="submit">Sluiten</button></div>' +
    '</form>';

  const veld = dialog.querySelector('#paletVeld');
  const lijst = dialog.querySelector('#paletLijst');
  let zicht = items;
  let hier = 0;

  const teken = () => {
    lijst.innerHTML = zicht
      .map(
        (item, plek) =>
          '<button value="' + escapeHtml(String(plek)) + '" type="submit" class="keuze' +
          (plek === hier ? ' hier' : '') + '">' +
          '<strong>' + escapeHtml(item.naam) + '</strong>' +
          (item.uitleg ? '<span>' + escapeHtml(item.uitleg) + '</span>' : '') +
          '</button>',
      )
      .join('');
    lijst.querySelector('.hier')?.scrollIntoView({ block: 'nearest' });
  };

  veld.oninput = () => {
    const zoek = veld.value.trim().toLowerCase();
    zicht = zoek
      ? items.filter((item) => (item.naam + ' ' + (item.uitleg ?? '')).toLowerCase().includes(zoek))
      : items;
    hier = 0;
    teken();
  };

  veld.onkeydown = (gebeurtenis) => {
    // Enter in een formulier kiest de eerste knop; wij bedoelen de regel die
    // oplicht, ook als je net met de pijltjes drie regels verder bent.
    if (gebeurtenis.key === 'Enter') {
      gebeurtenis.preventDefault();
      if (zicht.length > 0) dialog.close(String(hier));
      return;
    }
    if (gebeurtenis.key === 'ArrowDown' || gebeurtenis.key === 'ArrowUp') {
      gebeurtenis.preventDefault();
      if (zicht.length === 0) return;
      hier = (hier + (gebeurtenis.key === 'ArrowDown' ? 1 : zicht.length - 1)) % zicht.length;
      teken();
    }
  };

  teken();
  dialog.showModal();
  setTimeout(() => veld.focus(), 30);

  return new Promise((resolve) => {
    dialog.addEventListener(
      'close',
      () => {
        if (dialog.returnValue === 'cancel' || dialog.returnValue === '') return resolve(null);
        // Enter in het zoekveld levert geen knopwaarde op; dan is het de regel
        // die oplicht.
        const plek = dialog.returnValue === 'default' ? hier : Number(dialog.returnValue);
        resolve(zicht[plek] ?? null);
      },
      { once: true },
    );
  });
}

/** Een lijst keuzes als dialoog. Levert de gekozen waarde, of false. */
export function kiesUit({ title, body = '', opties }) {
  const dialog = document.getElementById('dialog');

  dialog.innerHTML =
    '<form method="dialog">' +
    '<div class="dhead"><h3>' + escapeHtml(title) + '</h3></div>' +
    (body ? '<div class="dbody">' + escapeHtml(body) + '</div>' : '') +
    '<div class="keuzes">' +
    opties
      .map(
        (optie) =>
          '<button value="' + escapeHtml(optie.waarde) + '" type="submit" class="keuze">' +
          '<strong>' + escapeHtml(optie.naam) + '</strong>' +
          (optie.uitleg ? '<span>' + escapeHtml(optie.uitleg) + '</span>' : '') +
          '</button>',
      )
      .join('') +
    '</div>' +
    '<div class="dfoot"><button value="cancel" type="submit">Annuleren</button></div>' +
    '</form>';

  dialog.showModal();

  return new Promise((resolve) => {
    dialog.addEventListener(
      'close',
      () => resolve(dialog.returnValue && dialog.returnValue !== 'cancel' ? dialog.returnValue : false),
      { once: true },
    );
  });
}

export const busy = (label = 'Bezig…') => '<div class="busy"><span class="spinner"></span>' + escapeHtml(label) + '</div>';

export function emptyState(iconName, message) {
  return '<div class="empty">' + icon(iconName) + '<div>' + escapeHtml(message) + '</div></div>';
}

// --- thema -----------------------------------------------------------------

const THEME_KEY = 'setupbot-theme';

// In een afgeschermde iframe gooit localStorage een fout in plaats van leeg
// terug te geven. Zonder deze omweg stopt het hele script daarop.
const onthoud = (waarde) => {
  try {
    localStorage.setItem(THEME_KEY, waarde);
  } catch {
    // Geen opslag beschikbaar; de keuze geldt dan alleen voor dit bezoek.
  }
};

const opgeslagen = () => {
  try {
    return localStorage.getItem(THEME_KEY);
  } catch {
    return null;
  }
};

export function initTheme(button) {
  // Donker is de standaard: Discord staat donker, en dit scherm hoort daarbij.
  // Wie ooit op de knop drukt, houdt zijn eigen keuze.
  apply(opgeslagen() || 'dark');

  button.onclick = () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    onthoud(next);
    apply(next);
  };

  function apply(theme) {
    document.documentElement.dataset.theme = theme;
    button.innerHTML = icon(theme === 'dark' ? 'sun' : 'moon');
  }
}

/**
 * Laat tekst zien om te kopiëren. Gebruikt als de browser downloaden weigert,
 * bijvoorbeeld in de demo, die in een afgeschermd venster draait.
 */
export function toonTekst({ title, tekst, hint = '' }) {
  const dialog = document.getElementById('dialog');

  dialog.innerHTML =
    '<form method="dialog">' +
    '<div class="dhead"><h3>' + escapeHtml(title) + '</h3></div>' +
    '<div class="dbody">' +
    (hint ? '<p class="hint">' + escapeHtml(hint) + '</p>' : '') +
    '<textarea id="dialogText" readonly spellcheck="false">' + escapeHtml(tekst) + '</textarea>' +
    '</div>' +
    '<div class="dfoot">' +
    '<button value="cancel" type="submit">Sluiten</button>' +
    '<button type="button" class="btn-primary" id="dialogCopy">Kopieer</button>' +
    '</div></form>';

  const field = dialog.querySelector('#dialogText');
  dialog.querySelector('#dialogCopy').onclick = async () => {
    field.select();
    try {
      await navigator.clipboard.writeText(tekst);
      toast('Gekopieerd naar het klembord.', 'ok');
    } catch {
      // In een afgeschermd venster mag het klembord niet; de tekst staat dan
      // geselecteerd zodat kopiëren met de hand nog werkt.
      toast('Kopieer de geselecteerde tekst met Ctrl+C.', 'info');
    }
  };

  dialog.showModal();
  setTimeout(() => field.select(), 30);
}

/** Of de browser een bestand mag aanbieden. Afgeschermde vensters mogen dat niet. */
export function kanDownloaden() {
  try {
    return window.origin !== 'null' && window.self === window.top;
  } catch {
    return false;
  }
}
