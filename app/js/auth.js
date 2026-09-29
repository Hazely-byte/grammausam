/**
 * SIH26074 - GramMausam
 * Google Identity Services (GIS) Client-Side Authentication Manager
 */

class AuthManager {
  constructor() {
    this.session = null;
    this.gsiInitialized = false;
  }

  init() {
    // 1. Check existing session in localStorage
    this.checkSession();

    // 2. Bind logout button in Profile screen
    const logoutBtn = document.getElementById('btn-logout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.logout();
      });
    }

    // 3. Initialize Google Identity Services
    this.initGsi();
  }

  /**
   * Reads and validates session from localStorage
   */
  checkSession() {
    try {
      const raw = localStorage.getItem('gram_mausam_session');
      if (raw) {
        const data = JSON.parse(raw);
        if (data && data.exp && Date.now() < data.exp) {
          this.session = data;
          this.updateProfileUI();
          this.hideLoginScreen();
          return true;
        }
      }
    } catch (e) {
      console.warn("Invalid stored session:", e);
    }

    // No valid session
    this.session = null;
    localStorage.removeItem('gram_mausam_session');
    this.showLoginScreen();
    return false;
  }

  /**
   * Returns true if user has a valid active session
   */
  isAuthenticated() {
    return Boolean(this.session && this.session.exp && Date.now() < this.session.exp);
  }

  /**
   * Initializes Google Identity Services client
   */
  initGsi() {
    if (typeof google !== 'undefined' && google.accounts && google.accounts.id) {
      this.setupGsiClient();
    } else {
      let attempts = 0;
      const interval = setInterval(() => {
        attempts++;
        if (typeof google !== 'undefined' && google.accounts && google.accounts.id) {
          clearInterval(interval);
          this.setupGsiClient();
        } else if (attempts > 30) {
          clearInterval(interval);
        }
      }, 150);
    }
  }

  setupGsiClient() {
    if (this.gsiInitialized || typeof google === 'undefined' || !google.accounts || !google.accounts.id) return;
    const clientId = window.GOOGLE_CLIENT_ID || "635013705196-42hgfeakmh1onm15t8sbjdf1uoi2ah0v.apps.googleusercontent.com";
    if (!clientId) return;

    try {
      google.accounts.id.initialize({
        client_id: clientId,
        callback: (resp) => this.handleCredentialResponse(resp),
        auto_select: false,
        cancel_on_tap_outside: true
      });
      this.gsiInitialized = true;
      this.renderGoogleButton();
    } catch (e) {
      console.warn("Error initializing Google Identity Services:", e);
    }
  }

  renderGoogleButton() {
    const container = document.getElementById('google-btn-container');
    if (!container || !this.gsiInitialized || typeof google === 'undefined' || !google.accounts || !google.accounts.id) return;

    container.innerHTML = '';
    try {
      google.accounts.id.renderButton(container, {
        theme: 'outline',
        size: 'large',
        shape: 'pill',
        width: 280,
        text: 'signin_with'
      });
    } catch (e) {
      console.warn("Error rendering Google button:", e);
    }
  }

  /**
   * Decodes JWT token payload into JSON
   */
  parseJwt(token) {
    try {
      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split('')
          .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      );
      return JSON.parse(jsonPayload);
    } catch (e) {
      console.warn("Error parsing token:", e);
      return {};
    }
  }

  /**
   * Callback invoked by Google Identity Services on successful sign-in
   */
  handleCredentialResponse(response) {
    if (!response || !response.credential) return;

    const payload = this.parseJwt(response.credential);
    const expMs = payload.exp ? (payload.exp * 1000) : (Date.now() + 3600 * 1000);

    this.session = {
      token: response.credential,
      name: payload.name || 'User',
      email: payload.email || '',
      picture: payload.picture || '',
      exp: expMs
    };

    localStorage.setItem('gram_mausam_session', JSON.stringify(this.session));
    this.updateProfileUI();

    // Check user-specific language preference
    const userLangKey = `lang:${this.session.email}`;
    const userLang = localStorage.getItem(userLangKey);

    if (!userLang) {
      // First time this email is signing in: show language picker
      this.hideLoginScreen();
      if (window.I18n) {
        window.I18n.showFirstLaunchModal();
      }
    } else {
      // Returning user: restore their preferred language & go to app
      if (window.I18n) {
        window.I18n.setLanguage(userLang);
      }
      this.hideLoginScreen();
      if (window.Router) {
        window.Router.navigateTo('home');
      }
    }
  }

  /**
   * Updates user card in Profile settings
   */
  updateProfileUI() {
    if (!this.session) return;
    const avatarEl = document.getElementById('profile-user-avatar');
    const nameEl = document.getElementById('profile-user-name');
    const emailEl = document.getElementById('profile-user-email');

    if (avatarEl) {
      avatarEl.src = this.session.picture || 'icon.svg';
    }
    if (nameEl) {
      nameEl.textContent = this.session.name || 'User';
    }
    if (emailEl) {
      emailEl.textContent = this.session.email || '';
    }
  }

  showLoginScreen() {
    const screen = document.getElementById('login-screen');
    if (screen) {
      screen.classList.add('visible');
      this.renderGoogleButton();
    }
  }

  hideLoginScreen() {
    const screen = document.getElementById('login-screen');
    if (screen) {
      screen.classList.remove('visible');
    }
  }

  /**
   * Logs out the user, disables auto-select, and forces the login screen
   */
  logout() {
    if (typeof google !== 'undefined' && google.accounts && google.accounts.id) {
      try {
        google.accounts.id.disableAutoSelect();
      } catch (e) {}
    }

    this.session = null;
    localStorage.removeItem('gram_mausam_session');

    // Reset hash
    window.location.hash = '';

    // Show login screen immediately
    this.showLoginScreen();

    // Prevent back navigation from exposing app screens
    if (window.Router) {
      window.Router.navigateTo('home');
    }
  }
}

window.Auth = new AuthManager();
