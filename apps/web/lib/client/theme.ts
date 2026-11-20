/** Theme preference: 'system' follows the OS; otherwise forced via data-theme on <html>. */

export type Theme = 'system' | 'light' | 'dark';

export function readTheme(): Theme {
  try {
    const t = localStorage.getItem('theme');
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'system') {
    delete root.dataset.theme;
    localStorage.removeItem('theme');
  } else {
    root.dataset.theme = theme;
    localStorage.setItem('theme', theme);
  }
}
