/**
 * Kleine UI-bouwstenen: iconen, meldingen en dialogen. Browserdialogen (alert,
 * confirm, prompt) blokkeren de pagina en zien eruit als een foutmelding uit 2004;
 * dit is dezelfde functionaliteit in de stijl van de rest.
 */

export function icon(name, extra = '') {
  return '<svg class="icon ' + extra + '"><use href="#i-' + name + '"/></svg>';
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
  const system = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  apply(opgeslagen() || system);

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
