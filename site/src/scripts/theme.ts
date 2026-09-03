type Theme = 'light' | 'dark';

function saveTheme(value: Theme) {
  try { localStorage.setItem('dsh-theme', value); } catch { /* ignore storage failures */ }
}

function applySavedTheme() {
  let saved: string | null = null;
  try { saved = localStorage.getItem('dsh-theme'); } catch { /* ignore */ }
  const classes = document.documentElement.classList;
  classes.remove('light', 'dark');
  if (saved === 'light' || saved === 'dark') classes.add(saved);
}

function updateThemeToggle() {
  const toggle = document.getElementById('theme-toggle');
  if (!toggle) return;
  const dark = document.documentElement.classList.contains('dark')
    || (!document.documentElement.classList.contains('light') && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  toggle.textContent = dark ? '☀️' : '🌙';
}

function toggleTheme() {
  const classes = document.documentElement.classList;
  const currentlyDark = classes.contains('dark')
    || (!classes.contains('light') && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  const next: Theme = currentlyDark ? 'light' : 'dark';
  classes.remove('light', 'dark');
  classes.add(next);
  saveTheme(next);
  updateThemeToggle();
}

let initialized = false;

export function initTheme() {
  applySavedTheme();
  updateThemeToggle();
  if (initialized) return;
  initialized = true;
  document.getElementById('theme-toggle')?.addEventListener('click', toggleTheme);
}

if (typeof document !== 'undefined') {
  if (document.readyState !== 'loading') initTheme();
  else document.addEventListener('DOMContentLoaded', initTheme);
}
