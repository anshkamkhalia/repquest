(function () {
  const KEY = 'repquest-theme';

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    try {
      sessionStorage.setItem(KEY, theme);
    } catch (e) {}
  }

  try {
    const saved = sessionStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') {
      document.documentElement.dataset.theme = saved;
    }
  } catch (e) {}

  document.addEventListener('DOMContentLoaded', function () {
    const btn = document.getElementById('themeBtn');
    if (!btn) return;
    btn.addEventListener('click', function () {
      const current = document.documentElement.dataset.theme;
      applyTheme(current === 'dark' ? 'light' : 'dark');
    });
  });
})();
