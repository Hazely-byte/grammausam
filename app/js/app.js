/**
 * SIH26074 - Panchayat Weather
 * Main Application Bootstrap, Downscaling & View Coordination
 */

// Global state
window.AppState = {
  rawWeather: null,
  downscaledWeather: null,
  selectedPanchayat: null,
  isCached: false,
  timestamp: null
};

document.addEventListener('DOMContentLoaded', async () => {
  // 0. Initialize Internationalization (i18n) Engine
  if (window.I18n) {
    await window.I18n.init();
    window.I18n.translateDOM();
    updateThemeButtonsText();
  }

  // 0.5. Initialize Authentication & Google Identity Services
  if (window.Auth) {
    window.Auth.init();
  }

  // 1. Initialize Sky and Canvas Rain Engine
  if (window.Sky) {
    window.Sky.init();
  }

  // 2. Initialize and Bind Theme Segmented Control on Profile Screen
  if (window.Theme) {
    window.Theme.bindUI(document.getElementById('view-profile'));
  }

  // 3. Initialize Hash-Based Single-Page Router
  if (window.Router) {
    window.Router.init();
  }

  // 4. Initialize Panchayat Manager (Loads 37 Gram Panchayats from JSON)
  if (window.Panchayats) {
    window.AppState.selectedPanchayat = await window.Panchayats.init();
    
    // Subscribe to panchayat selection changes
    window.Panchayats.onSelectionChange((newPanchayat) => {
      window.AppState.selectedPanchayat = newPanchayat;
      if (window.AppState.rawWeather) {
        applyDownscalingAndRender();
      }
      if (window.PanchayatMap && window.PanchayatMap.isInitialized) {
        window.PanchayatMap.updateSelectedPanchayat(newPanchayat);
      }
    });
  }

  // 5. Listen for Language Changes Across the Entire App
  window.addEventListener('languageChanged', () => {
    if (window.I18n) {
      window.I18n.translateDOM();
      updateThemeButtonsText();
    }
    if (window.AppState.rawWeather) {
      applyDownscalingAndRender();
    }
  });

  // 6. Hook Router tab navigation
  window.addEventListener('hashchange', handleRouteNavigation);
  handleRouteNavigation();

  // 7. Fetch live weather from Open-Meteo
  await loadLiveWeather();

  // 8. Register PWA Service Worker (if supported and served via HTTP/HTTPS)
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
});

/**
 * Updates Theme button text in active language
 */
function updateThemeButtonsText() {
  const autoEl = document.getElementById('theme-btn-auto-text');
  const lightEl = document.getElementById('theme-btn-light-text');
  const darkEl = document.getElementById('theme-btn-dark-text');
  if (autoEl && window.t) autoEl.textContent = `📱 ${window.t('profile.theme_auto')}`;
  if (lightEl && window.t) lightEl.textContent = `☀️ ${window.t('profile.theme_light')}`;
  if (darkEl && window.t) darkEl.textContent = `🌙 ${window.t('profile.theme_dark')}`;
}

/**
 * Handles Tab Navigation events (e.g. initializing map when Map tab opens)
 */
function handleRouteNavigation() {
  const hash = (location.hash || '#home').toLowerCase();
  if (hash === '#map') {
    if (window.PanchayatMap && window.Panchayats) {
      setTimeout(() => {
        window.PanchayatMap.initMap(
          window.Panchayats.panchayats,
          window.Panchayats.blockCentre,
          window.AppState.rawWeather
        );
        if (window.PanchayatMap.map) {
          window.PanchayatMap.map.invalidateSize();
          window.PanchayatMap.fitMapToBounds();
        }
      }, 50);
      setTimeout(() => {
        if (window.PanchayatMap && window.PanchayatMap.map) {
          window.PanchayatMap.map.invalidateSize();
          window.PanchayatMap.fitMapToBounds();
        }
      }, 250);
    }
  } else if (hash === '#advice') {
    if (window.AppState.downscaledWeather) {
      renderFullAdviceScreen(window.AppState.downscaledWeather);
    }
  }
}
window.handleRouteNavigation = handleRouteNavigation;

/**
 * Fetches raw block forecast from Open-Meteo (&elevation=nan)
 */
async function loadLiveWeather() {
  const errorContainer = document.getElementById('home-error-container');
  const lastUpdatedEl = document.getElementById('last-updated-text');
  const cardsToShimmer = [
    document.getElementById('hero-section-card'),
    document.getElementById('hourly-card'),
    document.getElementById('daily-card'),
    document.getElementById('metrics-grid-card')
  ];

  // Start subtle loading shimmer
  cardsToShimmer.forEach(card => card && card.classList.add('shimmer-loading'));
  if (errorContainer) errorContainer.style.display = 'none';
  if (lastUpdatedEl) lastUpdatedEl.textContent = window.t ? window.t('home.updating') : 'Updating forecast...';

  // Request forecast from API client (with localStorage fallback)
  const result = await window.WeatherApi.fetchForecast();

  // Remove loading shimmer
  cardsToShimmer.forEach(card => card && card.classList.remove('shimmer-loading'));

  if (!result.success || !result.data) {
    if (errorContainer) {
      const errTitle = window.t ? window.t('errors.unable_to_load') : 'Unable to Load Weather';
      const errDesc = window.t ? window.t('errors.network_desc') : 'Could not connect to the Open-Meteo forecast service. Please check your internet connection.';
      const retryText = window.t ? window.t('errors.retry') : '🔄 Try Again';
      errorContainer.innerHTML = `
        <div class="error-card">
          <svg class="error-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <h3 class="error-title">${errTitle}</h3>
          <p class="error-desc">${errDesc}</p>
          <button class="retry-btn" onclick="loadLiveWeather()">${retryText}</button>
        </div>
      `;
      errorContainer.style.display = 'block';
    }
    if (lastUpdatedEl) lastUpdatedEl.textContent = window.t ? window.t('home.connection_failed') : 'Connection failed';
    return;
  }

  window.AppState.rawWeather = result.data;
  window.AppState.isCached = result.isCached;
  window.AppState.timestamp = result.timestamp;

  applyDownscalingAndRender();
}

/**
 * Applies micro-grid downscaling for active panchayat and refreshes all UI views
 */
function applyDownscalingAndRender() {
  const raw = window.AppState.rawWeather;
  const panchayat = window.AppState.selectedPanchayat;
  if (!raw || !panchayat) return;

  // Apply adiabatic downscaling
  if (window.Downscaling) {
    window.AppState.downscaledWeather = window.Downscaling.downscaleForecast(raw, panchayat);
  } else {
    window.AppState.downscaledWeather = raw;
  }

  const downscaled = window.AppState.downscaledWeather;
  const isCached = window.AppState.isCached;
  const timestamp = window.AppState.timestamp;

  // 1. Render Home screen
  renderHomeWeather(downscaled, isCached, timestamp);

  // 2. Render "Block vs Your Panchayat" Card
  renderComparisonCard(raw, downscaled, panchayat);

  // 3. Render Agromet Advisories
  renderAdvisories(downscaled, panchayat);

  // 4. Update Header display
  if (window.Panchayats) {
    window.Panchayats.updateHeaderDisplay();
  }

  // 5. Update Map & Isotherms if initialized
  if (window.PanchayatMap && window.PanchayatMap.isInitialized) {
    window.PanchayatMap.updateWeatherData(raw);
  }
}

/**
 * Populates all Home screen elements with downscaled weather data
 */
function renderHomeWeather(data, isCached, timestamp) {
  const current = data.current;
  const hourly = data.hourly;
  const daily = data.daily;
  const meta = data.downscaling_meta;

  // 1. Current Temperature & Condition Labels
  const tempEl = document.getElementById('current-temp');
  const uncertaintyEl = document.getElementById('current-temp-uncertainty');
  const condEl = document.getElementById('current-condition');
  const highLowEl = document.getElementById('today-high-low');
  const lastUpdatedEl = document.getElementById('last-updated-text');

  const conditionInfo = window.WeatherApi.getCondition(current.weather_code, current.is_day);

  if (tempEl) tempEl.textContent = `${Math.round(current.temperature_2m)}°`;
  if (uncertaintyEl && meta) {
    uncertaintyEl.textContent = meta.current_formatted_uncertainty;
  }
  if (condEl) condEl.textContent = conditionInfo.text || conditionInfo.english;

  const todayMax = Math.round(daily.temperature_2m_max[0]);
  const todayMin = Math.round(daily.temperature_2m_min[0]);
  if (highLowEl) {
    highLowEl.textContent = window.t
      ? window.t('home.high_low', { high: todayMax, low: todayMin })
      : `H: ${todayMax}° • L: ${todayMin}°`;
  }

  // 12-hour formatted time with normal digits 0-9
  const timeFormatted = window.I18n ? window.I18n.formatTime(timestamp) : formatTime12Hour(timestamp);
  if (lastUpdatedEl) {
    const offlineBadge = window.t ? window.t('home.offline_badge') : 'OFFLINE';
    if (isCached) {
      const updatedStr = window.t ? window.t('home.updated_at', { time: timeFormatted }) : `Updated ${timeFormatted}`;
      lastUpdatedEl.innerHTML = `${updatedStr} <span class="cached-indicator">${offlineBadge}</span>`;
    } else {
      lastUpdatedEl.textContent = window.t ? window.t('home.updated_at', { time: timeFormatted }) : `Updated ${timeFormatted}`;
    }
  }

  // Update sky background according to live condition
  if (window.Sky) {
    window.Sky.setLiveSky(current);
  }

  // 2. Hourly Forecast Strip (Next 12 Hours from Current Hour with downscaled temperatures)
  renderHourlyStrip(hourly, current.time);

  // 3. 5-Day Forecast List with downscaled range bars
  renderDailyList(daily, current.temperature_2m);

  // 4. Small 2x2 Metric Cards (Rain, humidity and wind remain block forecast)
  renderMetricCards(current, daily);
}

/**
 * Renders the "Block vs Your Panchayat" key comparison card
 */
function renderComparisonCard(raw, downscaled, panchayat) {
  const blockTempEl = document.getElementById('comp-block-temp');
  const panTempEl = document.getElementById('comp-panchayat-temp');
  const panNameEl = document.getElementById('comp-panchayat-name');
  const panElevEl = document.getElementById('comp-panchayat-elev');
  const gridElevEl = document.getElementById('comp-grid-elev');
  const diffPill = document.getElementById('comp-diff-pill');
  const elevNote = document.getElementById('comp-elevation-text');
  const expText = document.getElementById('comp-explanation-text');

  const rawTemp = raw && raw.current ? raw.current.temperature_2m : null;
  const downscaledTemp = downscaled && downscaled.current ? downscaled.current.temperature_2m : null;
  const meta = downscaled.downscaling_meta;

  if (blockTempEl && rawTemp !== null) {
    blockTempEl.textContent = `${Math.round(rawTemp)}°`;
  }
  if (panTempEl && downscaledTemp !== null) {
    panTempEl.textContent = `${Math.round(downscaledTemp)}°`;
  }
  if (panNameEl && panchayat) {
    panNameEl.textContent = window.I18n ? window.I18n.getPanchayatName(panchayat) : panchayat.name_en;
  }
  if (panElevEl && panchayat) {
    const formattedElev = Number(panchayat.elevation_m).toLocaleString('en-IN');
    panElevEl.textContent = window.t ? window.t('feature.elevation_label', { elevation: formattedElev }) : `Elevation: ${formattedElev} m`;
  }
  if (gridElevEl && meta) {
    gridElevEl.textContent = window.t ? window.t('feature.grid_msl', { elevation: meta.h_grid }) : `Grid: ${meta.h_grid} m MSL`;
  }

  if (diffPill && meta) {
    const diff = meta.temp_diff_c;
    const diffAbs = Math.abs(diff).toFixed(1);
    if (diff < -0.2) {
      diffPill.textContent = window.t ? window.t('feature.diff_cooler', { diff: diffAbs }) : `-${diffAbs}° cooler`;
      diffPill.style.background = 'rgba(56, 189, 248, 0.25)';
      diffPill.style.color = '#7dd3fc';
      diffPill.style.borderColor = 'rgba(56, 189, 248, 0.6)';
    } else if (diff > 0.2) {
      diffPill.textContent = window.t ? window.t('feature.diff_warmer', { diff: diffAbs }) : `+${diffAbs}° warmer`;
      diffPill.style.background = 'rgba(249, 115, 22, 0.25)';
      diffPill.style.color = '#fdba74';
      diffPill.style.borderColor = 'rgba(249, 115, 22, 0.6)';
    } else {
      diffPill.textContent = window.t ? window.t('feature.diff_same') : `±0° same`;
      diffPill.style.background = 'rgba(255, 255, 255, 0.15)';
      diffPill.style.color = '#ffffff';
      diffPill.style.borderColor = 'rgba(255, 255, 255, 0.3)';
    }
  }

  if (elevNote && meta && panchayat) {
    const deltaH = meta.elevation_diff_m;
    const sign = deltaH > 0 ? `+${deltaH}` : `${deltaH}`;
    elevNote.textContent = window.t
      ? window.t('feature.elevation_vs_grid', { diff: sign, grid: meta.h_grid })
      : `Elevation: ${sign} m vs forecast grid average (${meta.h_grid} m)`;
  }

  if (meta && meta.explanation && expText) {
    expText.textContent = meta.explanation.text || meta.explanation.english;
  }
}

/**
 * Generates and populates Agromet advisories on Home and Advice views
 */
function renderAdvisories(downscaled, panchayat) {
  if (!window.Agromet) return;
  const advisories = window.Agromet.generateAdvisory(downscaled);

  // 1. Home Screen Farm Advice Card (Top Advice)
  const top = advisories[0] || window.Agromet.getDefaultAdvice();
  const homeTitle = document.getElementById('home-advice-title');
  const homeText = document.getElementById('home-advice-text');

  if (homeTitle) homeTitle.textContent = `${top.icon} ${top.title}`;
  if (homeText) homeText.textContent = `"${top.text}"`;

  // 2. Render Full Advice Screen if container exists
  renderFullAdviceScreen(downscaled);
}

function renderFullAdviceScreen(downscaled) {
  const container = document.getElementById('advice-list');
  const subtitle = document.getElementById('advice-header-subtitle');
  if (!container || !window.Agromet) return;

  const panchayat = window.AppState.selectedPanchayat;
  if (subtitle && panchayat) {
    const panName = window.I18n ? window.I18n.getPanchayatName(panchayat) : panchayat.name_en;
    subtitle.textContent = window.t
      ? window.t('advice_screen.subtitle', { panchayat: panName })
      : `3-Day Agromet Advisory for ${panName} • Mainpat Block`;
  }

  const advisories = window.Agromet.generateAdvisory(downscaled);

  container.innerHTML = advisories.map(adv => `
    <section class="weather-card advisory-card advice-card severity-${adv.severity}">
      <div class="advice-badge-row">
        <div class="advice-icon-wrap">${adv.icon}</div>
        <span class="advice-reason-pill">📊 ${adv.reason}</span>
      </div>
      <h3 class="advice-title-en">${adv.title}</h3>
      <p class="advice-text">${adv.text}</p>
    </section>
  `).join('');
}

/**
 * Renders next 12 hours with downscaled temperatures in hourly strip
 */
function renderHourlyStrip(hourly, currentIsoTime) {
  const hourlyTrack = document.getElementById('hourly-track');
  if (!hourlyTrack || !window.WeatherApi) return;

  const items = window.WeatherApi.getNext12Hours(hourly, currentIsoTime);

  hourlyTrack.innerHTML = items.map(item => `
    <div class="hourly-item">
      <span class="hourly-time">${item.time}</span>
      <div class="hourly-icon-wrap">
        ${window.WEATHER_ICONS[item.icon] || window.WEATHER_ICONS['partly-cloudy']}
      </div>
      <span class="hourly-pop">
        ${item.pop >= 15 ? `<span class="hourly-pop-badge">${item.pop}%</span>` : ''}
      </span>
      <span class="hourly-temp">${item.temp}°</span>
    </div>
  `).join('');
}

/**
 * Renders 5-day forecast list with downscaled min/max and range bars
 */
function renderDailyList(daily, currentTemp) {
  const dailyList = document.getElementById('daily-list');
  if (!dailyList || !window.WeatherApi) return;

  const globalMin = Math.floor(Math.min(...daily.temperature_2m_min));
  const globalMax = Math.ceil(Math.max(...daily.temperature_2m_max));
  const range = (globalMax - globalMin) || 1;

  dailyList.innerHTML = daily.time.map((dateStr, idx) => {
    const isToday = (idx === 0);
    let dayName = window.t ? window.t('home.today') : "Today";
    if (!isToday) {
      dayName = window.I18n ? window.I18n.formatWeekday(dateStr) : dateStr;
    }

    const code = daily.weather_code[idx];
    const condition = window.WeatherApi.getCondition(code, 1);
    const min = Math.round(daily.temperature_2m_min[idx]);
    const max = Math.round(daily.temperature_2m_max[idx]);

    const leftPct = Math.max(0, Math.min(100, ((min - globalMin) / range) * 100));
    const widthPct = Math.max(8, Math.min(100 - leftPct, ((max - min) / range) * 100));

    // Current temperature indicator for "Today"
    let dotHtml = '';
    if (isToday) {
      const dotPct = Math.min(100, Math.max(0, ((currentTemp - min) / ((max - min) || 1)) * 100));
      const dotLeft = leftPct + (widthPct * dotPct / 100);
      dotHtml = `<div class="range-bar-dot" style="left: ${dotLeft}%;"></div>`;
    }

    return `
      <div class="daily-row">
        <span class="daily-day">${dayName}</span>
        <div class="daily-icon-cell">
          ${window.WEATHER_ICONS[condition.icon] || window.WEATHER_ICONS['partly-cloudy']}
        </div>
        <span class="daily-temp-min">${min}°</span>
        <div class="range-bar-track">
          <div class="range-bar-fill" style="left: ${leftPct}%; width: ${widthPct}%;"></div>
          ${dotHtml}
        </div>
        <span class="daily-temp-max">${max}°</span>
      </div>
    `;
  }).join('');
}

/**
 * Renders small 2x2 metric cards (Rain, humidity, wind remain block forecast)
 */
function renderMetricCards(current, daily) {
  // Humidity
  const humVal = document.getElementById('metric-humidity-val');
  const humSub = document.getElementById('metric-humidity-sub');
  if (humVal) humVal.textContent = `${current.relative_humidity_2m}%`;
  if (humSub) {
    const dewPoint = window.WeatherApi.getDewPoint(current.temperature_2m, current.relative_humidity_2m);
    humSub.textContent = window.t ? window.t('metrics.dew_point', { temp: dewPoint }) : `Dew point ${dewPoint}° • Block forecast`;
  }

  // Wind
  const windVal = document.getElementById('metric-wind-val');
  const windSub = document.getElementById('metric-wind-sub');
  const windSpeed = Math.round(current.wind_speed_10m);
  const compass = window.WeatherApi.getWindCompass(current.wind_direction_10m);
  const kmhUnit = window.t ? window.t('metrics.kmh') : 'km/h';
  if (windVal) windVal.innerHTML = `${windSpeed} <span style="font-size:16px;">${kmhUnit}</span>`;
  if (windSub) windSub.textContent = window.t ? window.t('metrics.wind_station', { compass }) : `${compass} • Block weather station`;

  // Chance of rain
  const rainVal = document.getElementById('metric-rain-val');
  const rainSub = document.getElementById('metric-rain-sub');
  const maxRainProb = daily.precipitation_probability_max ? daily.precipitation_probability_max[0] : 0;
  if (rainVal) rainVal.textContent = `${maxRainProb}%`;
  if (rainSub) rainSub.textContent = window.t ? window.t('metrics.rain_sub') : `Today's max probability`;

  // Rainfall (mm)
  const precipVal = document.getElementById('metric-precip-val');
  const precipSub = document.getElementById('metric-precip-sub');
  const mmUnit = window.t ? window.t('metrics.mm') : 'mm';
  const totalPrecip = (daily.precipitation_sum && daily.precipitation_sum[0] !== undefined)
    ? Number(daily.precipitation_sum[0]).toFixed(1)
    : Number(current.precipitation || 0).toFixed(1);
  if (precipVal) precipVal.innerHTML = `${totalPrecip} <span style="font-size:16px;">${mmUnit}</span>`;
  if (precipSub) precipSub.textContent = window.t ? window.t('metrics.rainfall_sub') : `Today's precipitation sum`;
}

/**
 * Formats date to 12-hour time (e.g. "2:45 PM")
 */
function formatTime12Hour(date) {
  if (!date) return '--:--';
  const d = (date instanceof Date) ? date : new Date(date);
  if (isNaN(d.getTime())) return '--:--';
  const hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const period = hours >= 12 ? 'PM' : 'AM';
  const h12 = (hours % 12) || 12;
  return `${h12}:${minutes} ${period}`;
}

window.loadLiveWeather = loadLiveWeather;
