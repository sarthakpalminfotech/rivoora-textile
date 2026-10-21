import { useEffect, useState } from 'react';

/**
 * On-screen keyboard handling (Sprint 15), done ONCE for the whole app.
 *
 * On phones / tablets the keyboard covers the bottom of the LAYOUT viewport (it only shrinks the VISUAL viewport),
 * so `position: fixed|sticky` Save / Confirm bars and modal footers vanish behind it. This measures the covered
 * height with the `visualViewport` API and publishes it as the CSS variable `--kb-inset` (px) plus a
 * `data-kb` attribute on <html>. `index.css` lifts every `.kb-bar` and `.kb-modal-*` element by that inset and hides
 * the bottom navigation while the keyboard is open. Where `visualViewport` is missing nothing happens (the browser
 * default stays).
 */

/** Smaller differences are browser chrome (address bar), not a keyboard. */
const KEYBOARD_MIN_PX = 120;

const FIELD_SELECTOR = 'input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]), textarea, [contenteditable=true]';

/** Pixels of the layout viewport covered by the keyboard (0 when closed / unsupported). */
export function readKeyboardInset(): number {
  if (typeof window === 'undefined' || !window.visualViewport) return 0;
  const vv = window.visualViewport;
  const covered = window.innerHeight - vv.height - vv.offsetTop;
  return covered >= KEYBOARD_MIN_PX ? Math.round(covered) : 0;
}

/** Installs the CSS variable / attribute and scrolls the focused field into view. Mount once (App). */
export function useKeyboardInsetVar() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    let timer: number | undefined;

    const revealFocused = () => {
      const el = document.activeElement;
      if (el instanceof HTMLElement && el.matches(FIELD_SELECTOR)) {
        el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
      }
    };

    const update = () => {
      const inset = readKeyboardInset();
      const wasOpen = root.hasAttribute('data-kb');
      root.style.setProperty('--kb-inset', `${inset}px`);
      if (inset > 0) root.setAttribute('data-kb', '');
      else root.removeAttribute('data-kb');
      // Keyboard just opened (or changed size): bring the field above the lifted bar once the layout settled.
      if (inset > 0 && !wasOpen) {
        window.clearTimeout(timer);
        timer = window.setTimeout(revealFocused, 120);
      }
    };

    const onFocusIn = (e: FocusEvent) => {
      const t = e.target;
      if (!(t instanceof HTMLElement) || !t.matches(FIELD_SELECTOR)) return;
      // The keyboard animates in; reveal after it did (and again from `update` if it opens later).
      window.clearTimeout(timer);
      timer = window.setTimeout(revealFocused, 300);
    };

    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      window.clearTimeout(timer);
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      document.removeEventListener('focusin', onFocusIn);
      root.style.removeProperty('--kb-inset');
      root.removeAttribute('data-kb');
    };
  }, []);
}

/** The current keyboard inset in px, for components that need the number (most just use the CSS classes). */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(readKeyboardInset);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setInset(readKeyboardInset());
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);
  return inset;
}
