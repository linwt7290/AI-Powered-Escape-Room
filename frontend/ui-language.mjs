import {DEFAULT_LOCALE, LOCALES, translate} from '../shared/i18n.mjs';

const preferenceKey = 'last-protocol-language';
const bindings = new WeakMap();
let current = DEFAULT_LOCALE;

try {
  const stored = localStorage.getItem(preferenceKey);
  if (LOCALES.includes(stored)) current = stored;
} catch {
  // Settings still work for the current session when storage is unavailable.
}

export const locale = () => current;
export const t = message => translate(current, message);

export function localText(element, message) {
  bindings.set(element, message);
  element.dataset.localText = '';
  const localized = t(message);
  if (element.textContent !== localized) element.textContent = localized;
}

// Capture the authored markup once, before rendering game state or player input.
const staticCopy = [];
const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT);
for (let node = walker.nextNode(); node; node = walker.nextNode()) {
  const source = node.data;
  const key = source.trim();
  if (/\p{Script=Han}/u.test(key)) staticCopy.push(() => { node.data = source.replace(key, t(key)); });
}
for (const element of document.querySelectorAll('[aria-label], [placeholder]')) {
  for (const attribute of ['aria-label', 'placeholder']) {
    const key = element.getAttribute(attribute);
    if (key && /\p{Script=Han}/u.test(key)) staticCopy.push(() => element.setAttribute(attribute, t(key)));
  }
}

export function applyLanguage(next = current) {
  if (!LOCALES.includes(next)) return;
  current = next;
  document.documentElement.lang = current;
  try {
    localStorage.setItem(preferenceKey, current);
  } catch {
    // An unavailable browser store has no effect on the active locale.
  }
  for (const update of staticCopy) update();
  for (const element of document.querySelectorAll('[data-local-text]')) localText(element, bindings.get(element));
}
