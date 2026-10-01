// Pull to refresh: pulling down from the top of any screen syncs and fetches prices. A shortcut
// only: the app refreshes on its own too, so nothing depends on the gesture.
// No spinner (the design allows no looping motion): the pill says what's happening in words,
// and its arrow turns once when letting go would refresh.

import { h, fill } from './dom.js';

/** How far to pull (px of finger travel) before letting go refreshes. */
export const PULL_TO_REFRESH = 72;
// The pill follows the finger at half speed, up to this far down.
const MAX_SHIFT = 56;

/** The pill's words for a pull of distance px: one idea each, no period (they're labels). */
export const pullLabel = (distance, busy = false) => (busy ? 'Refreshing' : distance >= PULL_TO_REFRESH ? 'Release to refresh' : 'Pull to refresh');

function arrow() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'pull-arrow');
  svg.innerHTML = '<path d="M12 5v14M6 13l6 6 6-6"/>';
  return svg;
}

/**
 * Watches scroller for a pull from the top. refresh() is awaited; while it runs, further pulls
 * are ignored. A pull that starts inside an open sheet, or anywhere but the very top, is never one.
 */
export function pullToRefresh(scroller, refresh) {
  const label = h('span', {});
  const pill = h('div', { class: 'pull', role: 'status', 'aria-live': 'polite', hidden: true }, arrow(), label);
  document.body.append(pill);
  let startY = null;
  let distance = 0;
  let busy = false;

  const show = () => {
    const shift = Math.min(distance / 2, MAX_SHIFT);
    pill.hidden = false;
    pill.style.transform = `translate(-50%, ${shift}px)`;
    pill.style.opacity = String(Math.min(1, distance / PULL_TO_REFRESH));
    pill.classList.toggle('ready', distance >= PULL_TO_REFRESH || busy);
    fill(label, pullLabel(distance, busy));
  };
  const hide = () => {
    pill.classList.add('leaving');
    pill.style.opacity = '0';
    pill.style.transform = 'translate(-50%, 0)';
    setTimeout(() => { if (!busy && startY === null) { pill.hidden = true; pill.classList.remove('leaving', 'ready'); } }, 200);
  };

  scroller.addEventListener('touchstart', (e) => {
    if (busy || e.touches.length !== 1 || scroller.scrollTop > 0 || document.querySelector('dialog[open]')) { startY = null; return; }
    startY = e.touches[0].clientY;
    distance = 0;
    pill.classList.remove('leaving');
  }, { passive: true });

  scroller.addEventListener('touchmove', (e) => {
    if (startY === null) return;
    distance = e.touches[0].clientY - startY;
    // Scrolling the page up, or already scrolled down: not a pull.
    if (distance <= 0 || scroller.scrollTop > 0) { distance = 0; pill.hidden = true; return; }
    show();
  }, { passive: true });

  const end = async () => {
    if (startY === null) return;
    startY = null;
    if (distance < PULL_TO_REFRESH) { distance = 0; hide(); return; }
    busy = true;
    distance = PULL_TO_REFRESH;
    show();
    try {
      await refresh();
    } finally {
      busy = false;
      distance = 0;
      hide();
    }
  };
  scroller.addEventListener('touchend', end);
  scroller.addEventListener('touchcancel', () => { startY = null; distance = 0; hide(); });
}
