const WEATHER_SKY_STATES = {
  day: {
    id: "day",
    name: "Clear Day",
    skyGradient: "linear-gradient(180deg, #1b62a5 0%, #297ec7 35%, #4ea3e3 70%, #7dbef2 100%)",
    rain: false
  },
  night: {
    id: "night",
    name: "Clear Night",
    skyGradient: "linear-gradient(180deg, #070c18 0%, #0e172e 35%, #152445 70%, #1f355f 100%)",
    rain: false
  },
  cloudy: {
    id: "cloudy",
    name: "Cloudy",
    skyGradient: "linear-gradient(180deg, #324350 0%, #465a6b 35%, #5d7488 70%, #7892a7 100%)",
    rain: false
  },
  rain: {
    id: "rain",
    name: "Rain",
    skyGradient: "linear-gradient(180deg, #1a2634 0%, #253749 35%, #344c62 70%, #46637e 100%)",
    rain: true
  }
};

window.WEATHER_SKY_STATES = WEATHER_SKY_STATES;

class RainCanvasEffect {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext('2d') : null;
    this.drops = [];
    this.maxDrops = 60; // Lightweight count for battery efficiency
    this.animId = null;
    this.isActive = false;

    if (this.canvas) {
      this.resize();
      window.addEventListener('resize', () => this.resize());
    }
  }

  resize() {
    if (!this.canvas) return;
    const parent = this.canvas.parentElement;
    const rect = parent ? parent.getBoundingClientRect() : { width: 400, height: 800 };
    this.canvas.width = rect.width;
    this.canvas.height = rect.height;
    this.initDrops();
  }

  initDrops() {
    this.drops = [];
    for (let i = 0; i < this.maxDrops; i++) {
      this.drops.push({
        x: Math.random() * (this.canvas ? this.canvas.width : 400),
        y: Math.random() * (this.canvas ? this.canvas.height : 800),
        length: 12 + Math.random() * 16,
        speed: 14 + Math.random() * 7,
        opacity: 0.15 + Math.random() * 0.4
      });
    }
  }

  start() {
    if (this.isActive || !this.ctx) return;
    this.isActive = true;
    this.canvas.style.opacity = '1';
    this.loop();
  }

  stop() {
    this.isActive = false;
    if (this.canvas) {
      this.canvas.style.opacity = '0';
    }
    if (this.animId) {
      cancelAnimationFrame(this.animId);
      this.animId = null;
    }
    if (this.ctx && this.canvas) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  loop() {
    if (!this.isActive || !this.ctx) return;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    this.ctx.lineWidth = 1.2;
    this.ctx.lineCap = 'round';

    for (let i = 0; i < this.drops.length; i++) {
      const drop = this.drops[i];
      this.ctx.strokeStyle = `rgba(220, 240, 255, ${drop.opacity})`;
      this.ctx.beginPath();
      this.ctx.moveTo(drop.x, drop.y);
      this.ctx.lineTo(drop.x - 2, drop.y + drop.length);
      this.ctx.stroke();

      drop.y += drop.speed;
      drop.x -= 1.2;

      if (drop.y > this.canvas.height) {
        drop.y = -drop.length;
        drop.x = Math.random() * (this.canvas.width + 40);
      }
    }

    this.animId = requestAnimationFrame(() => this.loop());
  }
}

class SkyManager {
  constructor() {
    this.currentState = 'day';
    this.activeDevMode = 'live'; // 'live', 'day', 'night', 'cloudy', 'rain'
    this.isManualOverride = false;
    this.rainCanvas = null;
    this.rainEffect = null;
    this.skyBg = null;
    this.devPanel = null;
  }

  init() {
    this.skyBg = document.getElementById('sky-background');
    this.rainCanvas = document.getElementById('rain-canvas');

    if (this.rainCanvas) {
      this.rainEffect = new RainCanvasEffect(this.rainCanvas);
    }

    // Set initial sky gradient
    this.applyState(this.currentState, false);

    // Initialize developer-only sky control panel if in development environment
    if (this.isDevMode()) {
      this.initDevSkyPanel();
    }
  }

  /**
   * Only enable when running on localhost / 127.0.0.1 or ?dev=1
   */
  isDevMode() {
    try {
      const host = window.location.hostname;
      const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost');
      const params = new URLSearchParams(window.location.search);
      return isLocal || params.get('dev') === '1';
    } catch (e) {
      return false;
    }
  }

  /**
   * Sets sky from live forecast data (unless manual override is active)
   */
  setLiveSky(currentData) {
    if (this.isManualOverride) return;
    if (!window.WeatherApi || !currentData) return;

    const skyState = window.WeatherApi.getSkyStateFromLive(currentData);
    this.applyState(skyState, false);
  }

  /**
   * Applies sky gradient and toggles rain canvas particles
   */
  applyState(stateKey, isManual = false) {
    const states = window.WEATHER_SKY_STATES;
    if (!states || !states[stateKey]) return;

    if (isManual) {
      this.isManualOverride = true;
    }

    const state = states[stateKey];
    this.currentState = stateKey;

    // Smooth sky gradient transition (0.6s)
    if (this.skyBg) {
      this.skyBg.style.background = state.skyGradient;
    }

    // Handle rain particle canvas
    if (state.rain) {
      if (this.rainEffect) this.rainEffect.start();
    } else {
      if (this.rainEffect) this.rainEffect.stop();
    }
  }

  /**
   * Switches sky mode: 'live', 'day', 'night', 'cloudy', 'rain'
   */
  setMode(mode) {
    const validModes = ['live', 'day', 'night', 'cloudy', 'rain'];
    if (!validModes.includes(mode)) return;

    this.activeDevMode = mode;

    if (mode === 'live') {
      // Release manual override so live forecast controls the sky
      this.isManualOverride = false;
      const current = (window.AppState && window.AppState.rawWeather && window.AppState.rawWeather.current)
        ? window.AppState.rawWeather.current
        : null;
      if (current) {
        this.setLiveSky(current);
      } else {
        this.applyState('day', false);
      }
    } else {
      // Force selected sky state until 'live' is chosen again
      this.applyState(mode, true);
    }

    this.updateDevPanelActiveButton();
  }

  /**
   * Initializes floating dev panel OUTSIDE the phone frame and registers shortcuts 1-5
   */
  initDevSkyPanel() {
    if (document.getElementById('dev-sky-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'dev-sky-panel';
    panel.className = 'dev-sky-panel';
    panel.setAttribute('aria-label', 'Developer Sky Toggle');

    panel.innerHTML = `
      <div class="dev-sky-title-bar">
        <span class="dev-sky-title">DEV SKY</span>
        <span class="dev-sky-badge">1–5</span>
      </div>
      <div class="dev-sky-btn-group">
        <button class="dev-sky-btn ${this.activeDevMode === 'live' ? 'active' : ''}" data-sky-mode="live" type="button" title="Live weather (Shortcut: 1)">
          <span class="dev-sky-btn-icon">⚡</span>
          <span class="dev-sky-btn-name">Live</span>
          <kbd class="dev-sky-btn-kbd">1</kbd>
        </button>
        <button class="dev-sky-btn ${this.activeDevMode === 'day' ? 'active' : ''}" data-sky-mode="day" type="button" title="Clear Day (Shortcut: 2)">
          <span class="dev-sky-btn-icon">☀️</span>
          <span class="dev-sky-btn-name">Day</span>
          <kbd class="dev-sky-btn-kbd">2</kbd>
        </button>
        <button class="dev-sky-btn ${this.activeDevMode === 'night' ? 'active' : ''}" data-sky-mode="night" type="button" title="Clear Night (Shortcut: 3)">
          <span class="dev-sky-btn-icon">🌙</span>
          <span class="dev-sky-btn-name">Night</span>
          <kbd class="dev-sky-btn-kbd">3</kbd>
        </button>
        <button class="dev-sky-btn ${this.activeDevMode === 'cloudy' ? 'active' : ''}" data-sky-mode="cloudy" type="button" title="Cloudy / Overcast (Shortcut: 4)">
          <span class="dev-sky-btn-icon">☁️</span>
          <span class="dev-sky-btn-name">Cloudy</span>
          <kbd class="dev-sky-btn-kbd">4</kbd>
        </button>
        <button class="dev-sky-btn ${this.activeDevMode === 'rain' ? 'active' : ''}" data-sky-mode="rain" type="button" title="Rain Animation (Shortcut: 5)">
          <span class="dev-sky-btn-icon">🌧️</span>
          <span class="dev-sky-btn-name">Rain</span>
          <kbd class="dev-sky-btn-kbd">5</kbd>
        </button>
      </div>
    `;

    // Place OUTSIDE the phone frame: on .desktop-canvas (or document.body)
    const desktopCanvas = document.querySelector('.desktop-canvas');
    if (desktopCanvas) {
      desktopCanvas.appendChild(panel);
    } else {
      document.body.appendChild(panel);
    }

    this.devPanel = panel;

    // Bind button click handlers
    panel.querySelectorAll('.dev-sky-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const mode = btn.dataset.skyMode;
        if (mode) {
          this.setMode(mode);
        }
      });
    });

    // Keyboard shortcuts: 1 = Live, 2 = Day, 3 = Night, 4 = Cloudy, 5 = Rain
    window.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || (e.target && e.target.isContentEditable)) return;

      const key = e.key;
      const code = e.code;
      if (key === '1' || code === 'Digit1' || code === 'Numpad1') {
        e.preventDefault();
        this.setMode('live');
      } else if (key === '2' || code === 'Digit2' || code === 'Numpad2') {
        e.preventDefault();
        this.setMode('day');
      } else if (key === '3' || code === 'Digit3' || code === 'Numpad3') {
        e.preventDefault();
        this.setMode('night');
      } else if (key === '4' || code === 'Digit4' || code === 'Numpad4') {
        e.preventDefault();
        this.setMode('cloudy');
      } else if (key === '5' || code === 'Digit5' || code === 'Numpad5') {
        e.preventDefault();
        this.setMode('rain');
      }
    });
  }

  updateDevPanelActiveButton() {
    if (!this.devPanel) return;
    this.devPanel.querySelectorAll('.dev-sky-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.skyMode === this.activeDevMode);
    });
  }

  showToast(message) {
    let toast = document.getElementById('app-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'app-toast';
      toast.className = 'toast-notice';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      toast.classList.remove('show');
    }, 2200);
  }
}

window.Sky = new SkyManager();

