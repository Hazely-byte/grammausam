/**
 * SIH26074 - Panchayat Weather
 * Theme Manager: Supports Auto (system), Light (Frosted Glass), and Dark (Deep Dark)
 */

class ThemeManager {
  constructor() {
    this.STORAGE_KEY = 'panchayat_theme_preference';
    // Default is 'auto' (follows system preference)
    this.themeMode = localStorage.getItem(this.STORAGE_KEY) || 'auto';
    this.systemMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    
    this.init();
  }

  init() {
    // Listen for OS system theme changes when in auto mode
    this.systemMediaQuery.addEventListener('change', () => {
      if (this.themeMode === 'auto') {
        this.applyTheme();
      }
    });

    // Apply saved or default theme
    this.applyTheme();
  }

  /**
   * Resolves the effective theme: 'light' or 'dark'
   */
  getEffectiveTheme() {
    if (this.themeMode === 'auto') {
      return this.systemMediaQuery.matches ? 'dark' : 'light';
    }
    return this.themeMode;
  }

  /**
   * Applies the theme to <html data-theme="..."> and updates <meta name="theme-color">
   */
  applyTheme() {
    const effectiveTheme = this.getEffectiveTheme();
    document.documentElement.setAttribute('data-theme', effectiveTheme);

    // Update <meta name="theme-color"> for browser chrome and PWA title bar
    const metaTag = document.getElementById('theme-color-meta');
    if (metaTag) {
      metaTag.setAttribute('content', effectiveTheme === 'dark' ? '#090e17' : '#1b62a5');
    }

    // Sync segmented control UI buttons
    this.updateSegmentedUI();
  }

  /**
   * Updates user choice: 'auto', 'light', or 'dark'
   */
  setTheme(mode) {
    if (!['auto', 'light', 'dark'].includes(mode)) return;
    this.themeMode = mode;
    localStorage.setItem(this.STORAGE_KEY, mode);
    this.applyTheme();
  }

  getThemeMode() {
    return this.themeMode;
  }

  /**
   * Updates active state of iOS-style segmented control buttons
   */
  updateSegmentedUI() {
    const buttons = document.querySelectorAll('[data-theme-btn]');
    buttons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.themeBtn === this.themeMode);
    });
  }

  /**
   * Binds click events to segmented buttons
   */
  bindUI(container) {
    const root = container || document;
    const buttons = root.querySelectorAll('[data-theme-btn]');
    buttons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        this.setTheme(btn.dataset.themeBtn);
      });
    });
    this.updateSegmentedUI();
  }
}

// Global instance
window.Theme = new ThemeManager();
