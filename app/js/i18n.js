/**
 * SIH26074 - Panchayat Weather
 * Internationalization (i18n) Engine
 * Single-Language (English OR Hindi) Translation System
 */

class I18nManager {
  constructor() {
    this.STORAGE_KEY = 'panchayat_language';
    this.currentLanguage = localStorage.getItem(this.STORAGE_KEY) || 'en';
    this.translations = {
      en: null,
      hi: null
    };
    this.listeners = [];
    this.isLoaded = false;
  }

  async init() {
    try {
      const [enRes, hiRes] = await Promise.all([
        fetch('i18n/en.json'),
        fetch('i18n/hi.json')
      ]);

      if (enRes.ok) this.translations.en = await enRes.json();
      if (hiRes.ok) this.translations.hi = await hiRes.json();
      this.isLoaded = true;
    } catch (e) {
      console.error('Failed to load translations:', e);
    }

    // Apply active language to <html lang="...">
    this.applyHtmlLang();

    // Check if first launch modal is needed
    this.checkFirstLaunch();

    // Bind profile language segmented control
    this.bindProfileControls();
  }

  isFirstLaunch() {
    return localStorage.getItem(this.STORAGE_KEY) === null;
  }

  getLanguage() {
    return this.currentLanguage;
  }

  applyHtmlLang() {
    const lang = this.currentLanguage;
    document.documentElement.setAttribute('lang', lang);
  }

  t(keyPath, params = {}) {
    if (!keyPath) return '';
    const lang = this.currentLanguage;
    const dict = this.translations[lang] || this.translations.en || {};

    const keys = keyPath.split('.');
    let val = dict;
    for (const k of keys) {
      if (val && typeof val === 'object' && k in val) {
        val = val[k];
      } else {
        val = null;
        break;
      }
    }

    // Fallback to English if missing in target lang
    if (val === null || val === undefined) {
      let fallback = this.translations.en || {};
      for (const k of keys) {
        if (fallback && typeof fallback === 'object' && k in fallback) {
          fallback = fallback[k];
        } else {
          fallback = null;
          break;
        }
      }
      val = fallback !== null && fallback !== undefined ? fallback : keyPath;
    }

    if (typeof val !== 'string') {
      return val;
    }

    // Replace {param} placeholders
    return val.replace(/\{(\w+)\}/g, (match, p1) => {
      return params[p1] !== undefined ? params[p1] : match;
    });
  }

  setLanguage(lang) {
    if (lang !== 'en' && lang !== 'hi') return;
    this.currentLanguage = lang;
    localStorage.setItem(this.STORAGE_KEY, lang);
    if (window.Auth && window.Auth.session && window.Auth.session.email) {
      localStorage.setItem(`lang:${window.Auth.session.email}`, lang);
    }
    this.applyHtmlLang();

    // Update all declarative elements with data-i18n attributes
    this.translateDOM();

    // Sync Profile segmented buttons
    this.updateSegmentedUI();

    // Notify registered listeners
    this.listeners.forEach(cb => {
      try { cb(lang); } catch (err) { console.error('i18n callback error:', err); }
    });

    // Dispatch global custom event
    window.dispatchEvent(new CustomEvent('languageChanged', { detail: { lang } }));
  }

  onLanguageChange(callback) {
    if (typeof callback === 'function') {
      this.listeners.push(callback);
    }
  }

  /**
   * Updates all DOM elements marked with data-i18n, data-i18n-placeholder, data-i18n-title
   */
  translateDOM(root = document) {
    root.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.dataset.i18n;
      if (key) {
        el.textContent = this.t(key);
      }
    });

    root.querySelectorAll('[data-i18n-html]').forEach(el => {
      const key = el.dataset.i18nHtml;
      if (key) {
        el.innerHTML = this.t(key);
      }
    });

    root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.dataset.i18nPlaceholder;
      if (key) {
        el.placeholder = this.t(key);
      }
    });

    root.querySelectorAll('[data-i18n-title]').forEach(el => {
      const key = el.dataset.i18nTitle;
      if (key) {
        el.title = this.t(key);
      }
    });
  }

  /**
   * Helper: formats Panchayat name based on selected language
   */
  getPanchayatName(panchayat) {
    if (!panchayat) return '';
    if (this.currentLanguage === 'hi') {
      return panchayat.name_hi || panchayat.name_en;
    }
    return panchayat.name_en;
  }

  /**
   * Helper: formats Block name based on selected language
   */
  getBlockName() {
    return this.currentLanguage === 'hi' ? 'मैनपाट ब्लॉक' : 'Mainpat Block';
  }

  /**
   * Helper: formats District name based on selected language
   */
  getDistrictName() {
    return this.currentLanguage === 'hi' ? 'सरगुजा' : 'Surguja';
  }

  /**
   * Formats time to 12-hour using standard Arabic digits (0-9)
   */
  formatTime(date) {
    if (!date) return '--:--';
    const d = (date instanceof Date) ? date : new Date(date);
    if (isNaN(d.getTime())) return '--:--';

    const hours = d.getHours();
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const h12 = (hours % 12) || 12;

    if (this.currentLanguage === 'hi') {
      const period = hours >= 12 ? 'अपराह्न' : 'पूर्वाह्न';
      return `${h12}:${minutes} ${period}`;
    } else {
      const period = hours >= 12 ? 'PM' : 'AM';
      return `${h12}:${minutes} ${period}`;
    }
  }

  /**
   * Formats weekday name with standard Latin digits constraint
   */
  formatWeekday(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const locale = this.currentLanguage === 'hi' ? 'hi-IN' : 'en-IN';
    return d.toLocaleDateString(locale, { weekday: 'short', numberingSystem: 'latn' });
  }

  /**
   * Checks and displays first-launch modal if language preference is unset
   */
  /**
   * Checks and displays first-launch modal only after sign-in
   */
  checkFirstLaunch() {
    // Only triggered explicitly via AuthManager after sign-in
  }

  showFirstLaunchModal() {
    const modal = document.getElementById('first-launch-modal');
    if (modal) {
      modal.classList.add('visible');
    }
  }

  dismissFirstLaunch(lang) {
    this.setLanguage(lang);
    if (window.Auth && window.Auth.session && window.Auth.session.email) {
      localStorage.setItem(`lang:${window.Auth.session.email}`, lang);
    }
    const modal = document.getElementById('first-launch-modal');
    if (modal) {
      modal.classList.remove('visible');
    }
    if (window.Router) {
      window.Router.navigateTo('home');
    }
  }

  /**
   * Binds Profile tab language segmented control buttons
   */
  bindProfileControls() {
    const buttons = document.querySelectorAll('[data-lang-btn]');
    buttons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const selectedLang = btn.dataset.langBtn;
        this.setLanguage(selectedLang);
      });
    });
    this.updateSegmentedUI();
  }

  updateSegmentedUI() {
    const buttons = document.querySelectorAll('[data-lang-btn]');
    buttons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.langBtn === this.currentLanguage);
    });
  }
}

window.I18n = new I18nManager();
window.t = (key, params) => window.I18n.t(key, params);
