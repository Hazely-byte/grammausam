/**
 * SIH26074 - Panchayat Weather
 * Panchayat Manager & Selection Bottom Sheet
 * 
 * Handles loading data/panchayats.json, geolocation matching,
 * search filtering (English and Devanagari), and state persistence.
 */

class PanchayatManager {
  constructor() {
    this.panchayats = [];
    this.blockCentre = null;
    this.selectedPanchayat = null;
    this.DEFAULT_GP_NAME = "Pathrai";
    this.STORAGE_KEY = "panchayat_selected_id";
    this.onSelectionChangeCallbacks = [];
    this.isLoaded = false;
  }

  /**
   * Initializes dataset and restores user selection
   */
  async init() {
    try {
      const response = await fetch("data/panchayats.json");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      
      this.blockCentre = data.block_centre;
      this.panchayats = data.panchayats || [];
      this.isLoaded = true;

      // Restore previous selection or default to Pathrai
      const savedId = localStorage.getItem(this.STORAGE_KEY);
      let found = null;
      if (savedId) {
        found = this.panchayats.find(p => p.id === savedId);
      }
      if (!found) {
        found = this.panchayats.find(p => p.name_en.toLowerCase() === this.DEFAULT_GP_NAME.toLowerCase()) || this.panchayats[0];
      }
      this.selectedPanchayat = found;
      this.bindUI();
      return this.selectedPanchayat;
    } catch (e) {
      console.error("Failed to load panchayats.json:", e);
      // Fallback object so app never crashes
      this.selectedPanchayat = {
        id: "gp001",
        name_en: "Pathrai",
        name_hi: "पथराई",
        lat: 22.80862,
        lon: 83.26933,
        elevation_m: 1099.0,
        distance_km: 1.10,
        confidence: "HIGH"
      };
      this.panchayats = [this.selectedPanchayat];
      return this.selectedPanchayat;
    }
  }

  /**
   * Returns list of all loaded panchayats
   */
  getAllPanchayats() {
    return this.panchayats;
  }

  /**
   * Returns currently selected panchayat
   */
  getSelectedPanchayat() {
    return this.selectedPanchayat;
  }

  /**
   * Registers callback invoked whenever active panchayat changes
   */
  onSelectionChange(callback) {
    if (typeof callback === "function") {
      this.onSelectionChangeCallbacks.push(callback);
    }
  }

  /**
   * Sets the active panchayat and notifies subscribers
   */
  selectPanchayat(gpOrId) {
    let target = null;
    if (typeof gpOrId === "string") {
      target = this.panchayats.find(p => p.id === gpOrId || p.name_en.toLowerCase() === gpOrId.toLowerCase());
    } else if (gpOrId && gpOrId.id) {
      target = gpOrId;
    }

    if (!target) return;
    this.selectedPanchayat = target;
    try {
      localStorage.setItem(this.STORAGE_KEY, target.id);
    } catch (err) {}

    // Update UI elements
    this.updateHeaderDisplay();
    this.closeBottomSheet();

    // Trigger registered subscribers
    this.onSelectionChangeCallbacks.forEach(cb => {
      try { cb(this.selectedPanchayat); } catch (e) { console.error(e); }
    });
  }

  /**
   * Updates Header on Home screen with selected panchayat name
   */
  updateHeaderDisplay() {
    const p = this.selectedPanchayat;
    if (!p) return;

    const locTitle = document.querySelector(".location-title");
    const displayName = window.I18n ? window.I18n.getPanchayatName(p) : p.name_en;

    if (locTitle) {
      locTitle.innerHTML = `${displayName} <span class="loc-dropdown-arrow">▼</span>`;
    }

    const subEl = document.getElementById("location-subtitle-text");
    const lastUp = document.getElementById("last-updated-text");
    const lastUpHtml = lastUp ? lastUp.innerHTML : (window.t ? window.t("home.connecting") : "Connecting...");
    const blockName = window.I18n ? window.I18n.getBlockName() : "Mainpat Block";
    const districtName = window.I18n ? window.I18n.getDistrictName() : "Surguja";

    if (subEl) {
      subEl.innerHTML = `${blockName}, ${districtName} • <span id="last-updated-text">${lastUpHtml}</span>`;
    }
  }

  /**
   * Binds click events for Location Header, Bottom Sheet, Search & Geolocation
   */
  bindUI() {
    const trigger = document.getElementById("location-trigger");
    if (trigger) {
      trigger.style.cursor = "pointer";
      trigger.addEventListener("click", (e) => {
        // Prevent interfering with developer triple tap on temperature
        e.preventDefault();
        this.openBottomSheet();
      });
    }

    // Close button & backdrop
    const sheetCloseBtn = document.getElementById("sheet-close-btn");
    const backdrop = document.getElementById("sheet-backdrop");
    if (sheetCloseBtn) sheetCloseBtn.addEventListener("click", () => this.closeBottomSheet());
    if (backdrop) backdrop.addEventListener("click", () => this.closeBottomSheet());

    // Search filter
    const searchInput = document.getElementById("panchayat-search-input");
    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        this.renderPanchayatList(e.target.value);
      });
    }

    // Geolocation button
    const geoBtn = document.getElementById("use-geolocation-btn");
    if (geoBtn) {
      geoBtn.addEventListener("click", (e) => {
        e.preventDefault();
        this.useCurrentLocation();
      });
    }

    // Listen to language changes
    window.addEventListener("languageChanged", () => {
      this.updateHeaderDisplay();
      const searchVal = searchInput ? searchInput.value : "";
      this.renderPanchayatList(searchVal);
    });

    this.updateHeaderDisplay();
  }

  openBottomSheet() {
    const sheet = document.getElementById("panchayat-sheet");
    const backdrop = document.getElementById("sheet-backdrop");
    const searchInput = document.getElementById("panchayat-search-input");

    if (searchInput) searchInput.value = "";
    this.renderPanchayatList("");

    if (backdrop) backdrop.classList.add("visible");
    if (sheet) sheet.classList.add("open");

    setTimeout(() => {
      if (searchInput) searchInput.focus();
    }, 200);
  }

  closeBottomSheet() {
    const sheet = document.getElementById("panchayat-sheet");
    const backdrop = document.getElementById("sheet-backdrop");
    if (sheet) sheet.classList.remove("open");
    if (backdrop) backdrop.classList.remove("visible");
  }

  /**
   * Renders filtered list of panchayats inside bottom sheet in single language
   */
  renderPanchayatList(query = "") {
    const listEl = document.getElementById("panchayat-list");
    if (!listEl) return;

    const q = (query || "").trim().toLowerCase();
    const filtered = this.panchayats.filter(p => {
      if (!q) return true;
      const matchEn = p.name_en.toLowerCase().includes(q);
      const matchHi = (p.name_hi || "").includes(q);
      return matchEn || matchHi;
    });

    if (filtered.length === 0) {
      const noResText = window.t ? window.t("sheet.no_results", { query }) : `No Gram Panchayat found matching "${query}".`;
      const trySearchText = window.t ? window.t("sheet.try_search") : "Try searching another name";
      listEl.innerHTML = `
        <div class="empty-search-state">
          <p>${noResText}</p>
          <span style="font-size: 12px; color: var(--text-muted);">${trySearchText}</span>
        </div>
      `;
      return;
    }

    listEl.innerHTML = filtered.map(p => {
      const isSelected = (this.selectedPanchayat && this.selectedPanchayat.id === p.id);
      const confClass = p.confidence === "HIGH" ? "badge-high" : "badge-medium";
      const confLabel = p.confidence === "HIGH"
        ? (window.t ? window.t("sheet.high_conf") : "HIGH")
        : (window.t ? window.t("sheet.medium_conf") : "MEDIUM");
      const elevFormatted = Number(p.elevation_m).toLocaleString("en-IN");
      const displayName = window.I18n ? window.I18n.getPanchayatName(p) : p.name_en;

      const elevText = window.t ? window.t("sheet.elevation_msl", { elevation: elevFormatted }) : `⛰️ ${elevFormatted} m MSL`;
      const distText = window.t ? window.t("sheet.distance_from_hq", { distance: p.distance_km }) : `📍 ${p.distance_km} km from block HQ`;

      return `
        <div class="panchayat-item ${isSelected ? 'selected' : ''}" data-gp-id="${p.id}">
          <div class="gp-item-left">
            <div class="gp-names-row">
              <span class="gp-name-en">${displayName}</span>
              <span class="conf-badge ${confClass}">${confLabel}</span>
            </div>
            <div class="gp-meta-row">
              <span class="gp-elev">⛰️ ${elevText}</span>
              <span class="gp-dist">📍 ${distText}</span>
            </div>
          </div>
          <div class="gp-item-right">
            ${isSelected ? '<span class="selected-checkmark">✓</span>' : ''}
          </div>
        </div>
      `;
    }).join("");

    // Bind item click
    listEl.querySelectorAll(".panchayat-item").forEach(item => {
      item.addEventListener("click", () => {
        const id = item.dataset.gpId;
        this.selectPanchayat(id);
      });
    });
  }

  /**
   * Browser Geolocation API nearest picker
   */
  useCurrentLocation() {
    if (!navigator.geolocation) {
      this.showToast(window.t ? window.t("toasts.geo_unsupported") : "Geolocation is not supported by your browser.");
      return;
    }

    const geoBtn = document.getElementById("use-geolocation-btn");
    const originalText = geoBtn ? geoBtn.innerHTML : "";
    const findingText = window.t ? window.t("sheet.finding_location") : "Finding nearest panchayat...";
    if (geoBtn) geoBtn.innerHTML = `<span>⏳ ${findingText}</span>`;

    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (geoBtn) geoBtn.innerHTML = originalText;
        const userLat = position.coords.latitude;
        const userLon = position.coords.longitude;

        let nearest = null;
        let minDistance = Infinity;

        this.panchayats.forEach(p => {
          const d = this.haversine(userLat, userLon, p.lat, p.lon);
          if (d < minDistance) {
            minDistance = d;
            nearest = p;
          }
        });

        if (nearest) {
          const nearestName = window.I18n ? window.I18n.getPanchayatName(nearest) : nearest.name_en;
          if (minDistance > 30.0) {
            this.showToast(window.t ? window.t("toasts.geo_outside") : "You are outside the pilot area (Mainpat block). Showing the nearest panchayat.");
          } else {
            const distFormatted = minDistance.toFixed(1);
            this.showToast(window.t ? window.t("toasts.geo_nearest", { name: nearestName, distance: distFormatted }) : `Found nearest: ${nearestName} (${distFormatted} km away)`);
          }
          this.selectPanchayat(nearest);
        }
      },
      (error) => {
        if (geoBtn) geoBtn.innerHTML = originalText;
        let msg = window.t ? window.t("toasts.geo_error") : "Could not access location.";
        if (error.code === error.PERMISSION_DENIED) {
          msg = window.t ? window.t("toasts.geo_denied") : "Location permission denied. Please select from the list.";
        }
        this.showToast(msg);
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  }

  haversine(lat1, lon1, lat2, lon2) {
    const R = 6371.0;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  showToast(message) {
    if (window.Sky && window.Sky.showToast) {
      window.Sky.showToast(message);
    } else {
      let toast = document.getElementById("app-toast");
      if (!toast) {
        toast = document.createElement("div");
        toast.id = "app-toast";
        toast.className = "toast-notice";
        document.body.appendChild(toast);
      }
      toast.textContent = message;
      toast.classList.add("show");
      setTimeout(() => toast.classList.remove("show"), 2600);
    }
  }
}

window.Panchayats = new PanchayatManager();
