/**
 * SIH26074 - Panchayat Weather
 * Leaflet 1.9.4 + OpenStreetMap Interactive Station Map with Isotherm Contour Lines
 * 
 * Features:
 * - 100% Free & Open-Source (No Google API keys, no billing restrictions)
 * - Standard OpenStreetMap tile layer with full attribution
 * - Seamless automatic dark mode tile filter via CSS
 * - Digital elevation grid (1 km) with 2D Gaussian blur smoothing
 * - Iso-temperature boundary lines at every whole degree (19°, 20°, 21°, 22°, 23°)
 * - NO filled areas or square bounding borders (lines stop naturally at grid bounds)
 * - Filtering of tiny islands (< 1 km across)
 * - Dotted hiking map contour style: dashArray "2 6", lineCap "round", weight 2
 * - One small non-overlapping label per line (e.g. "20°")
 * - 30px compact temperature bubble markers (less overlap)
 * - Mainpat Block Centre as small diamond marker (label only in popup)
 * - Selected panchayat blue pin marker on highest z-index (bubble hidden)
 * - Fractional zoom fitBounds (padding 40px) focused strictly on Mainpat block
 * - Temperature zones toggle control & legend note
 */

// Configure Leaflet default marker icons from CDNJS to ensure images always load
if (typeof L !== 'undefined' && L.Icon && L.Icon.Default) {
  delete L.Icon.Default.prototype._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
    iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
  });
}

class PanchayatMapManager {
  constructor() {
    this.map = null;
    this.tileLayer = null;
    this.markers = new Map(); // id -> { marker, p, roundedTemp, tempColor, isSelected }
    this.blockMarker = null;
    this.legendControl = null;
    this.toggleControl = null;
    this.isInitialized = false;
    this.panchayats = [];
    this.blockCentre = null;
    this.rawWeather = null;
    this.elevationGrid = null;
    this.isothermsGroup = null;
    this.isothermsVisible = true;
    this.minTemp = 18;
    this.maxTemp = 28;
    this.selectedPanchayatId = null;
  }

  /**
   * Initializes or updates Leaflet map in #leaflet-map-container
   */
  async initMap(panchayats, blockCentre, rawWeather) {
    const container = document.getElementById("leaflet-map-container") || document.getElementById("google-map-container");
    if (!container) return;

    if (typeof L === "undefined") {
      setTimeout(() => this.initMap(panchayats, blockCentre, rawWeather), 100);
      return;
    }

    this.panchayats = panchayats || [];
    this.blockCentre = blockCentre || { lat: 22.81, lon: 83.28, elevation_m: 1077 };
    this.rawWeather = rawWeather;

    // Load elevation grid for isotherms in parallel
    if (!this.elevationGrid) {
      await this.loadElevationGrid();
    }

    // If map already initialized, just update markers, isotherms & size
    if (this.map) {
      this.refreshMarkers();
      this.renderIsotherms();
      setTimeout(() => {
        this.map.invalidateSize();
        this.fitMapToBounds();
      }, 50);
      return;
    }

    container.innerHTML = "";

    // 1. Initialize Leaflet Map with fractional zoom snap to avoid over-zooming out
    const initialCenter = [this.blockCentre.lat, this.blockCentre.lon];
    this.map = L.map(container, {
      center: initialCenter,
      zoom: 11,
      zoomSnap: 0.1,
      zoomDelta: 0.5,
      zoomControl: true,
      attributionControl: true
    });

    // Create custom map pane for isotherms strictly below markers and popups
    // TilePane = 200, isothermsPane = 350, OverlayPane = 400, MarkerPane = 600, PopupPane = 700
    if (!this.map.getPane("isothermsPane")) {
      const pane = this.map.createPane("isothermsPane");
      pane.style.zIndex = "350";
    }

    // 2. Standard OpenStreetMap Tiles
    this.tileLayer = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: 'Leaflet | &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
    }).addTo(this.map);

    // 3. Compute dynamic color scale from current 37 panchayat temperatures
    this.computeTemperatureScale();

    // 4. Create floating frosted-glass map legend with actual min & max
    this.createMapLegend();

    // 5. Create "Temperature zones" toggle button
    this.createZonesToggle();

    // 6. Render Isotherms
    await this.renderIsotherms();

    // 7. Plot Block Centre & 37 Panchayat Markers
    this.plotAllMarkers();

    // 8. Fit bounds tightly to the 37 pilot stations
    this.fitMapToBounds();

    this.isInitialized = true;

    // Invalidate size to ensure proper tile rendering and crisp fit on tab switch
    setTimeout(() => {
      if (this.map) {
        this.map.invalidateSize();
        this.fitMapToBounds();
      }
    }, 60);
    setTimeout(() => {
      if (this.map) {
        this.map.invalidateSize();
        this.fitMapToBounds();
      }
    }, 250);

    // Listen for external panchayat selection changes
    if (window.Panchayats && typeof window.Panchayats.onSelectionChange === "function") {
      window.Panchayats.onSelectionChange((selected) => {
        if (selected) this.updateSelectedPanchayat(selected);
      });
    }

    // Listen for theme change events to re-style tiles and isotherms
    window.addEventListener("themeChanged", () => {
      if (this.map) {
        setTimeout(() => {
          this.map.invalidateSize();
          this.renderIsotherms();
        }, 50);
      }
    });
  }

  /**
   * Loads precomputed elevation grid for Mainpat pilot area
   */
  async loadElevationGrid() {
    try {
      const res = await fetch("data/elevation_grid.json");
      if (res.ok) {
        this.elevationGrid = await res.json();
      }
    } catch (e) {
      console.warn("Could not load data/elevation_grid.json:", e);
    }
  }

  /**
   * Computes min and max downscaled temperatures across the 37 panchayats
   */
  computeTemperatureScale() {
    const raw = this.rawWeather;
    const baseTemp = (raw && raw.current && raw.current.temperature_2m !== undefined) ? raw.current.temperature_2m : 20.0;
    const hGrid = (raw && raw.elevation !== undefined && !isNaN(raw.elevation)) ? raw.elevation : 990.0;

    const temps = this.panchayats.map(p => {
      let t = baseTemp;
      if (window.Downscaling && typeof window.Downscaling.calculateTemperature === "function") {
        t = window.Downscaling.calculateTemperature(baseTemp, p.elevation_m, hGrid);
      } else {
        t = baseTemp - 0.0065 * (p.elevation_m - hGrid);
      }
      return Math.round(t);
    });

    if (temps.length > 0) {
      this.minTemp = Math.min(...temps);
      this.maxTemp = Math.max(...temps);
      if (this.minTemp === this.maxTemp) {
        this.maxTemp = this.minTemp + 1;
      }
    } else {
      this.minTemp = 18;
      this.maxTemp = 28;
    }
  }

  /**
   * Calculates smooth color interpolation from Cool Blue to Warm Orange
   */
  getTempColor(temp) {
    const min = this.minTemp;
    const max = this.maxTemp;
    let t = (temp - min) / (max - min);
    t = Math.max(0, Math.min(1, t));

    if (t < 0.5) {
      const f = t / 0.5;
      const r = Math.round(2 + f * (5 - 2));
      const g = Math.round(132 + f * (150 - 132));
      const b = Math.round(199 + f * (105 - 199));
      return `rgb(${r}, ${g}, ${b})`;
    } else {
      const f = (t - 0.5) / 0.5;
      const r = Math.round(5 + f * (234 - 5));
      const g = Math.round(150 + f * (88 - 150));
      const b = Math.round(105 + f * (12 - 105));
      return `rgb(${r}, ${g}, ${b})`;
    }
  }

  /**
   * Floating frosted-glass map legend
   */
  createMapLegend() {
    if (this.legendControl && this.map) {
      this.map.removeControl(this.legendControl);
    }

    const self = this;
    const legend = L.control({ position: "topright" });

    legend.onAdd = function() {
      const div = L.DomUtil.create("div", "map-legend-card");
      const titleText = window.t ? window.t("map.legend_title") : "Station Temperatures";
      const coolText = window.t ? window.t("map.legend_cool", { temp: self.minTemp }) : `Cool (${self.minTemp}°)`;
      const warmText = window.t ? window.t("map.legend_warm", { temp: self.maxTemp }) : `Warm (${self.maxTemp}°)`;
      const highText = window.t ? window.t("map.legend_high") : "HIGH";
      const medText = window.t ? window.t("map.legend_medium") : "MEDIUM";
      const noteText = window.t ? window.t("map.legend_note") : "Zones estimated from elevation";

      div.innerHTML = `
        <div class="legend-title">${titleText}</div>
        <div class="legend-scale-row">
          <span style="color:#38bdf8; font-weight:700;">${coolText}</span>
          <div class="legend-scale-bar"></div>
          <span style="color:#f97316; font-weight:700;">${warmText}</span>
        </div>
        <div class="legend-conf-row">
          <div class="legend-conf-item">
            <span class="legend-sample solid-border"></span>
            <span>${highText}</span>
          </div>
          <div class="legend-conf-item">
            <span class="legend-sample dashed-border"></span>
            <span>${medText}</span>
          </div>
        </div>
        <div class="legend-note">${noteText}</div>
      `;
      L.DomEvent.disableClickPropagation(div);
      return div;
    };

    legend.addTo(this.map);
    this.legendControl = legend;
  }

  /**
   * Creates the "Temperature zones" toggle button on the map
   */
  createZonesToggle() {
    if (this.toggleControl && this.map) {
      this.map.removeControl(this.toggleControl);
    }

    const self = this;
    const toggle = L.control({ position: "bottomleft" });

    toggle.onAdd = function() {
      const div = L.DomUtil.create("div", "map-toggle-container");
      const toggleText = window.t ? window.t("map.toggle_zones") : "Temperature zones";
      div.innerHTML = `
        <button class="map-zones-toggle ${self.isothermsVisible ? 'active' : ''}" id="btn-toggle-zones" type="button" title="${toggleText}">
          <span class="zones-toggle-icon">🌡️</span>
          <span class="zones-toggle-text">${toggleText}</span>
        </button>
      `;
      L.DomEvent.disableClickPropagation(div);

      const btn = div.querySelector("#btn-toggle-zones");
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        self.toggleIsotherms();
      });
      return div;
    };

    toggle.addTo(this.map);
    this.toggleControl = toggle;
  }

  /**
   * Toggles visibility of isotherm zones
   */
  toggleIsotherms() {
    this.isothermsVisible = !this.isothermsVisible;
    const btn = document.getElementById("btn-toggle-zones");

    if (this.isothermsGroup && this.map) {
      if (this.isothermsVisible) {
        if (!this.map.hasLayer(this.isothermsGroup)) {
          this.map.addLayer(this.isothermsGroup);
        }
        if (btn) btn.classList.add("active");
      } else {
        if (this.map.hasLayer(this.isothermsGroup)) {
          this.map.removeLayer(this.isothermsGroup);
        }
        if (btn) btn.classList.remove("active");
      }
    }
  }

  /**
   * 2D Gaussian blur smoothing for 2D scalar grid
   */
  applyGaussianBlur(values, cols, rows, radius = 2) {
    const kernel = [0.061, 0.242, 0.383, 0.242, 0.061];
    const kRadius = 2;

    // Horizontal pass
    const temp = new Float64Array(cols * rows);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let sum = 0;
        let weightSum = 0;
        for (let k = -kRadius; k <= kRadius; k++) {
          const sc = Math.min(Math.max(c + k, 0), cols - 1);
          const w = kernel[k + kRadius];
          sum += values[r * cols + sc] * w;
          weightSum += w;
        }
        temp[r * cols + c] = sum / weightSum;
      }
    }

    // Vertical pass
    const result = new Float64Array(cols * rows);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let sum = 0;
        let weightSum = 0;
        for (let k = -kRadius; k <= kRadius; k++) {
          const sr = Math.min(Math.max(r + k, 0), rows - 1);
          const w = kernel[k + kRadius];
          sum += temp[sr * cols + c] * w;
          weightSum += w;
        }
        result[r * cols + c] = sum / weightSum;
      }
    }
    return result;
  }

  /**
   * Computes and renders isotherm contour lines using D3.js and Leaflet Polyline:
   * - NO color fill or shaded box
   * - Gaussian blur smoothing on temperature field
   * - Contour lines at every whole degree (19°, 20°, 21°, 22°, 23°)
   * - Outer boundary edges omitted (lines stop where grid ends)
   * - Small closed loops (< 1 km across) filtered out
   * - Dotted style: dashArray "2 6", lineCap round, weight 2
   * - Exactly one small non-overlapping label per line
   */
  async renderIsotherms() {
    if (!this.map) return;
    if (!this.elevationGrid) {
      await this.loadElevationGrid();
    }
    if (!this.elevationGrid || typeof d3 === "undefined" || typeof d3.contours !== "function") {
      return;
    }

    const raw = this.rawWeather;
    const baseTemp = (raw && raw.current && raw.current.temperature_2m !== undefined) ? raw.current.temperature_2m : 20.0;
    const hGrid = (raw && raw.elevation !== undefined && !isNaN(raw.elevation)) ? raw.elevation : 990.0;

    const grid = this.elevationGrid;
    const cols = grid.cols;
    const rows = grid.rows;
    const bounds = grid.bounds;

    // 1. Calculate raw temperature field from elevation lapse rate
    const rawTemps = grid.elevations.map(elev => baseTemp - 0.0065 * (elev - hGrid));

    // 2. Smooth the temperature grid with 2D Gaussian blur (radius 2) for smooth curves
    const smoothedTemps = this.applyGaussianBlur(rawTemps, cols, rows, 2);

    const minT = Math.floor(Math.min(...smoothedTemps));
    const maxT = Math.ceil(Math.max(...smoothedTemps));

    // 3. Lines at every whole degree
    const thresholds = [];
    for (let t = 18; t <= 25; t++) {
      if (t >= minT && t <= maxT) {
        thresholds.push(t);
      }
    }

    // 4. Generate contour geometries via d3.contours
    const contours = d3.contours()
      .size([cols, rows])
      .smooth(true)
      .thresholds(thresholds)(smoothedTemps);

    // Convert grid coordinates [x, y] to [lat, lon]
    const gridToLatLon = (x, y) => {
      const lon = bounds.west + (x / (cols - 1)) * (bounds.east - bounds.west);
      const lat = bounds.north - (y / (rows - 1)) * (bounds.north - bounds.south);
      return [lat, lon];
    };

    // Check if a segment lies along the rectangular outer perimeter of the grid
    const isBoundaryEdge = (p1, p2) => {
      if (p1[0] <= 0.05 && p2[0] <= 0.05) return true; // West edge
      if (p1[0] >= cols - 1.05 && p2[0] >= cols - 1.05) return true; // East edge
      if (p1[1] <= 0.05 && p2[1] <= 0.05) return true; // North edge
      if (p1[1] >= rows - 1.05 && p2[1] >= rows - 1.05) return true; // South edge
      return false;
    };

    // 5. Extract interior contour lines & filter tiny islands (< 1 km across)
    const validLinesByTemp = new Map(); // temp -> Array of Array of [lat, lon]

    contours.forEach(feature => {
      const tempVal = Math.round(feature.value);
      const linesForThisTemp = [];

      feature.coordinates.forEach(polygon => {
        polygon.forEach(ring => {
          let currentSegment = [];

          for (let i = 0; i < ring.length - 1; i++) {
            const p1 = ring[i];
            const p2 = ring[i + 1];

            if (!isBoundaryEdge(p1, p2)) {
              if (currentSegment.length === 0) {
                currentSegment.push({ grid: p1, latlon: gridToLatLon(p1[0], p1[1]) });
              }
              currentSegment.push({ grid: p2, latlon: gridToLatLon(p2[0], p2[1]) });
            } else {
              if (currentSegment.length >= 2) {
                linesForThisTemp.push(currentSegment);
                currentSegment = [];
              }
            }
          }
          if (currentSegment.length >= 2) {
            linesForThisTemp.push(currentSegment);
          }
        });
      });

      // Filter out tiny islands (< 1 km across)
      const filteredLines = [];
      linesForThisTemp.forEach(seg => {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        let arcLengthGrid = 0;

        for (let i = 0; i < seg.length; i++) {
          const gx = seg[i].grid[0];
          const gy = seg[i].grid[1];
          if (gx < minX) minX = gx;
          if (gx > maxX) maxX = gx;
          if (gy < minY) minY = gy;
          if (gy > maxY) maxY = gy;
          if (i > 0) {
            const dx = gx - seg[i - 1].grid[0];
            const dy = gy - seg[i - 1].grid[1];
            arcLengthGrid += Math.sqrt(dx * dx + dy * dy);
          }
        }

        const spanX = maxX - minX;
        const spanY = maxY - minY;
        const spanMax = Math.max(spanX, spanY);

        // Check if closed loop
        const first = seg[0].grid;
        const last = seg[seg.length - 1].grid;
        const isClosed = (Math.abs(first[0] - last[0]) < 0.1 && Math.abs(first[1] - last[1]) < 0.1);

        // Drop tiny closed loops (< 1.2 grid units ~ 1.2 km) or tiny stubs
        if (isClosed && (spanMax < 1.2 || arcLengthGrid < 3.2)) {
          return;
        }
        if (!isClosed && arcLengthGrid < 1.8) {
          return;
        }

        filteredLines.push(seg.map(pt => pt.latlon));
      });

      if (filteredLines.length > 0) {
        validLinesByTemp.set(tempVal, filteredLines);
      }
    });

    // Clear previous isotherm layers
    if (this.isothermsGroup) {
      if (this.map.hasLayer(this.isothermsGroup)) {
        this.map.removeLayer(this.isothermsGroup);
      }
      this.isothermsGroup.clearLayers();
    } else {
      this.isothermsGroup = L.layerGroup();
    }

    const isDark = (document.documentElement.getAttribute("data-theme") === "dark");
    // Style: dark grey in light theme, light grey in dark theme
    const strokeColor = isDark ? "#cbd5e1" : "#475569";

    // 6. Draw clean dotted contour lines (dashArray "2 6", lineCap round, weight 2, opacity 0.8)
    validLinesByTemp.forEach((lines) => {
      lines.forEach(lineLatLngs => {
        const polyline = L.polyline(lineLatLngs, {
          pane: "isothermsPane",
          color: strokeColor,
          weight: 2,
          dashArray: "2 6",
          lineCap: "round",
          opacity: 0.8,
          smoothFactor: 1.0,
          interactive: false
        });
        this.isothermsGroup.addLayer(polyline);
      });
    });

    // 7. Place exactly ONE small label per line, avoiding overlap with markers and other labels
    const obstacleLocations = [];
    this.panchayats.forEach(p => obstacleLocations.push([p.lat, p.lon]));
    if (this.blockCentre) obstacleLocations.push([this.blockCentre.lat, this.blockCentre.lon]);

    const placedLabelLocations = [];

    // Helper to calculate distance squared between two points
    const distSq = (p1, p2) => {
      const dLat = p1[0] - p2[0];
      const dLon = p1[1] - p2[1];
      return dLat * dLat + dLon * dLon;
    };

    validLinesByTemp.forEach((lines, tempVal) => {
      // Pick the most prominent/longest line for this temperature
      const longestLine = [...lines].sort((a, b) => b.length - a.length)[0];
      if (!longestLine || longestLine.length < 4) return;

      let bestPt = null;
      let maxMinDist = -1;

      // Evaluate candidates along the line, skipping points near the edge of the grid
      for (let i = 1; i < longestLine.length - 1; i++) {
        const pt = longestLine[i];
        const lat = pt[0];
        const lon = pt[1];

        // Skip points too close to outer bounding box
        if (lat > bounds.north - 0.015 || lat < bounds.south + 0.015 ||
            lon > bounds.east - 0.015 || lon < bounds.west + 0.015) {
          continue;
        }

        let nearestDist = Infinity;

        // Check distance against all station markers
        for (const obs of obstacleLocations) {
          const d = distSq(pt, obs);
          if (d < nearestDist) nearestDist = d;
        }

        // Check distance against previously placed labels
        for (const lbl of placedLabelLocations) {
          const d = distSq(pt, lbl);
          if (d < nearestDist) nearestDist = d;
        }

        if (nearestDist > maxMinDist) {
          maxMinDist = nearestDist;
          bestPt = pt;
        }
      }

      if (bestPt) {
        placedLabelLocations.push(bestPt);

        const labelIcon = L.divIcon({
          className: "isotherm-label-icon",
          html: `<span class="isotherm-pill">${tempVal}°</span>`,
          iconSize: [24, 15],
          iconAnchor: [12, 7]
        });

        const labelMarker = L.marker(bestPt, {
          pane: "isothermsPane",
          icon: labelIcon,
          interactive: false
        });

        this.isothermsGroup.addLayer(labelMarker);
      }
    });

    // Add to map if visible
    if (this.isothermsVisible) {
      this.isothermsGroup.addTo(this.map);
    }
  }

  /**
   * Plots or re-plots all markers
   */
  plotAllMarkers() {
    this.markers.forEach(item => {
      if (item.marker && this.map) this.map.removeLayer(item.marker);
    });
    this.markers.clear();

    if (this.blockMarker && this.map) {
      this.map.removeLayer(this.blockMarker);
      this.blockMarker = null;
    }

    const raw = this.rawWeather;
    const baseTemp = (raw && raw.current && raw.current.temperature_2m !== undefined) ? raw.current.temperature_2m : 20.0;
    const hGrid = (raw && raw.elevation !== undefined && !isNaN(raw.elevation)) ? raw.elevation : 990.0;

    // 1. Block Centre Marker (Small 12px diamond marker, label shown only in popup to prevent overlap)
    const blockDiamondIcon = L.divIcon({
      className: "custom-div-icon",
      html: `
        <div class="block-centre-diamond" title="Mainpat Block Centre (Click for details)">
          <div class="diamond-shape"></div>
        </div>
      `,
      iconSize: [18, 18],
      iconAnchor: [9, 9],
      popupAnchor: [0, -10]
    });

    const blockTitle = window.t ? window.t("map.block_title") : "Mainpat Block Centre";
    const blockBadge = window.t ? window.t("map.block_badge") : "BLOCK HQ";
    const mForecast = window.t ? window.t("map.block_metric_forecast") : "Block Grid";
    const mMsl = window.t ? window.t("map.block_metric_msl") : "Grid MSL";
    const mCentre = window.t ? window.t("map.block_metric_centre") : "Centre";
    const blockDesc = window.t ? window.t("map.block_desc") : "Raw coarse Open-Meteo forecast point";

    const blockPopupHtml = `
      <div class="map-popup-card">
        <div class="popup-title-row">
          <span class="popup-name-en">${blockTitle}</span>
          <span class="popup-badge" style="background:#f59e0b; color:#ffffff; font-weight:700;">${blockBadge}</span>
        </div>
        <div class="popup-metrics-row">
          <div class="popup-metric"><span class="pm-val">${Math.round(baseTemp)}°C</span><span class="pm-lbl">${mForecast}</span></div>
          <div class="popup-metric"><span class="pm-val">${Math.round(hGrid)}m</span><span class="pm-lbl">${mMsl}</span></div>
          <div class="popup-metric"><span class="pm-val">0 km</span><span class="pm-lbl">${mCentre}</span></div>
        </div>
        <div style="font-size:11px; color:#94a3b8; text-align:center; padding: 2px 0;">
          ${blockDesc}
        </div>
      </div>
    `;

    this.blockMarker = L.marker([this.blockCentre.lat, this.blockCentre.lon], {
      icon: blockDiamondIcon,
      zIndexOffset: 100
    })
      .bindPopup(blockPopupHtml)
      .addTo(this.map);

    // 2. Determine currently selected panchayat
    const selected = (window.Panchayats && typeof window.Panchayats.getSelectedPanchayat === "function")
      ? window.Panchayats.getSelectedPanchayat()
      : null;
    this.selectedPanchayatId = selected ? selected.id : (this.panchayats[0] ? this.panchayats[0].id : "gp001");

    // 3. Add all 37 Panchayats
    this.panchayats.forEach(p => {
      let roundedTemp = Math.round(baseTemp);
      if (window.Downscaling && typeof window.Downscaling.calculateTemperature === "function") {
        roundedTemp = Math.round(window.Downscaling.calculateTemperature(baseTemp, p.elevation_m, hGrid));
      } else {
        roundedTemp = Math.round(baseTemp - 0.0065 * (p.elevation_m - hGrid));
      }

      const tempColor = this.getTempColor(roundedTemp);
      const isSelected = (p.id === this.selectedPanchayatId);

      // Create marker: only blue pin if selected (highest z-index, bubble hidden), 30px bubble if not selected
      const marker = this.createPanchayatMarker(p, roundedTemp, tempColor, isSelected);
      marker.addTo(this.map);

      this.markers.set(p.id, {
        marker,
        p,
        roundedTemp,
        tempColor,
        isSelected
      });
    });
  }

  /**
   * Creates a Leaflet marker: default blue pin if selected, 30px round bubble divIcon otherwise
   */
  createPanchayatMarker(p, roundedTemp, tempColor, isSelected) {
    let icon;
    const displayName = window.I18n ? window.I18n.getPanchayatName(p) : p.name_en;

    if (isSelected) {
      // Default Leaflet blue pin only (temperature bubble hidden to prevent overlap)
      icon = new L.Icon.Default();
    } else {
      // 30px Round temperature bubble divIcon (compact to reduce overlap)
      const isHighConf = (p.confidence === "HIGH");
      const borderClass = isHighConf ? "conf-high" : "conf-medium";

      icon = L.divIcon({
        className: "custom-div-icon",
        html: `
          <div class="panchayat-map-marker ${borderClass}" style="background-color: ${tempColor};" title="${displayName} • ${roundedTemp}°C">
            <span class="marker-temp-text">${roundedTemp}°</span>
          </div>
        `,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
        popupAnchor: [0, -16]
      });
    }

    const confLabel = window.t ? window.t(p.confidence === "HIGH" ? "map.legend_high" : "map.legend_medium") : p.confidence;
    const mForecast = window.t ? window.t("map.panchayat_metric_forecast") : "Forecast";
    const mElev = window.t ? window.t("map.panchayat_metric_elevation") : "Elevation";
    const mHq = window.t ? window.t("map.panchayat_metric_hq") : "From HQ";
    const btnText = window.t ? window.t("map.panchayat_view_forecast") : "View forecast →";

    const popupContent = `
      <div class="map-popup-card">
        <div class="popup-title-row">
          <span class="popup-name-en">${displayName}</span>
          <span class="popup-badge ${p.confidence === 'HIGH' ? 'badge-high' : 'badge-medium'}">${confLabel}</span>
        </div>
        <div class="popup-metrics-row">
          <div class="popup-metric"><span class="pm-val">${roundedTemp}°C</span><span class="pm-lbl">${mForecast}</span></div>
          <div class="popup-metric"><span class="pm-val">${Math.round(p.elevation_m)}m</span><span class="pm-lbl">${mElev}</span></div>
          <div class="popup-metric"><span class="pm-val">${p.distance_km}km</span><span class="pm-lbl">${mHq}</span></div>
        </div>
        <button class="popup-action-btn" onclick="window.PanchayatMap.selectFromMap('${p.id}')">
          ${btnText}
        </button>
      </div>
    `;

    const marker = L.marker([p.lat, p.lon], {
      icon,
      title: `${displayName} (${roundedTemp}°C)`
    }).bindPopup(popupContent);

    // Selected blue pin gets highest z-index so it always renders on top
    marker.setZIndexOffset(isSelected ? 10000 : 0);

    return marker;
  }

  /**
   * Updates weather data and re-renders markers and isotherms
   */
  updateWeatherData(rawWeather) {
    this.rawWeather = rawWeather;
    this.refreshMarkers();
    this.renderIsotherms();
  }

  /**
   * Refreshes markers when weather data changes without re-creating the map
   */
  refreshMarkers() {
    this.computeTemperatureScale();
    this.createMapLegend();
    this.plotAllMarkers();
  }

  /**
   * Updates marker icons when active panchayat selection changes:
   * Moves the default blue pin marker to the newly selected panchayat,
   * restoring the temperature bubble on the previous selection.
   */
  updateSelectedPanchayat(newPanchayat) {
    if (!newPanchayat || !this.map) return;
    const newId = newPanchayat.id;
    if (newId === this.selectedPanchayatId) return;

    const oldId = this.selectedPanchayatId;
    this.selectedPanchayatId = newId;

    // Reset previous selected marker to its 30px temperature bubble (normal z-index)
    if (oldId && this.markers.has(oldId)) {
      const oldItem = this.markers.get(oldId);
      const isHighConf = (oldItem.p.confidence === "HIGH");
      const borderClass = isHighConf ? "conf-high" : "conf-medium";

      const bubbleIcon = L.divIcon({
        className: "custom-div-icon",
        html: `
          <div class="panchayat-map-marker ${borderClass}" style="background-color: ${oldItem.tempColor};" title="${oldItem.p.name_en} • ${oldItem.roundedTemp}°C">
            <span class="marker-temp-text">${oldItem.roundedTemp}°</span>
          </div>
        `,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
        popupAnchor: [0, -16]
      });

      oldItem.marker.setIcon(bubbleIcon);
      oldItem.marker.setZIndexOffset(0);
      oldItem.isSelected = false;
    }

    // Set newly selected marker to default Leaflet blue pin (highest z-index, bubble hidden)
    if (newId && this.markers.has(newId)) {
      const newItem = this.markers.get(newId);
      const bluePinIcon = new L.Icon.Default();

      newItem.marker.setIcon(bluePinIcon);
      newItem.marker.setZIndexOffset(10000);
      newItem.isSelected = true;
    }
  }

  /**
   * Action handler when user clicks "View forecast" in marker popup
   */
  selectFromMap(panchayatId) {
    if (this.map) {
      this.map.closePopup();
    }

    if (window.Panchayats && typeof window.Panchayats.selectPanchayat === "function") {
      window.Panchayats.selectPanchayat(panchayatId);
    }

    window.location.hash = "#home";
    if (window.Router && typeof window.Router.navigateTo === "function") {
      window.Router.navigateTo("home");
    }
  }

  /**
   * Fits all 37 panchayats nicely into view with 40px padding,
   * filling the screen and focusing strictly on the Mainpat block.
   */
  fitMapToBounds() {
    if (!this.map || this.panchayats.length === 0) return;

    const latLngs = this.panchayats.map(p => [p.lat, p.lon]);
    if (this.blockCentre) {
      latLngs.push([this.blockCentre.lat, this.blockCentre.lon]);
    }

    const bounds = L.latLngBounds(latLngs);
    this.map.fitBounds(bounds, {
      padding: [40, 40]
    });
  }
}

window.PanchayatMap = new PanchayatMapManager();

window.addEventListener('languageChanged', () => {
  if (window.PanchayatMap && window.PanchayatMap.isInitialized && window.PanchayatMap.map) {
    window.PanchayatMap.createMapLegend();
    window.PanchayatMap.createZonesToggle();
    window.PanchayatMap.plotAllMarkers();
  }
});

