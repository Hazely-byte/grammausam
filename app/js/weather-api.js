/**
 * SIH26074 - Panchayat Weather
 * Live Weather API Client for Open-Meteo
 * Location: Mainpat Block Center, Surguja (Lat: 22.81, Lon: 83.28)
 */

const OPEN_METEO_API_URL = "https://api.open-meteo.com/v1/forecast?latitude=22.81&longitude=83.28&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m,wind_direction_10m&hourly=temperature_2m,precipitation_probability,weather_code,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max&timezone=Asia/Kolkata&forecast_days=5&elevation=nan";

const CACHE_KEY_DATA = "panchayat_weather_live_data";
const CACHE_KEY_TIME = "panchayat_weather_live_time";

/**
 * WMO Weather Interpretation Codes (WW)
 * Maps Open-Meteo codes to icons, English text, Hindi text, and base sky states
 */
const WMO_CODE_MAP = {
  0: { english: "Clear Sky", hindi: "साफ आसमान", iconDay: "sun", iconNight: "moon", sky: "day" },
  1: { english: "Mainly Clear", hindi: "अधिकांशतः साफ", iconDay: "sun", iconNight: "moon", sky: "day" },
  2: { english: "Partly Cloudy", hindi: "आंशिक रूप से बादल", iconDay: "partly-cloudy", iconNight: "moon-cloud", sky: "day" },
  3: { english: "Overcast", hindi: "घने बादल", iconDay: "partly-cloudy", iconNight: "moon-cloud", sky: "cloudy" },
  45: { english: "Foggy", hindi: "कोहरा", iconDay: "partly-cloudy", iconNight: "moon-cloud", sky: "cloudy" },
  48: { english: "Depositing Rime Fog", hindi: "सघन कोहरा", iconDay: "partly-cloudy", iconNight: "moon-cloud", sky: "cloudy" },
  51: { english: "Light Drizzle", hindi: "हल्की बूंदाबांदी", iconDay: "rain", iconNight: "rain", sky: "rain" },
  53: { english: "Moderate Drizzle", hindi: "बूंदाबांदी", iconDay: "rain", iconNight: "rain", sky: "rain" },
  55: { english: "Dense Drizzle", hindi: "घनी बूंदाबांदी", iconDay: "rain", iconNight: "rain", sky: "rain" },
  56: { english: "Freezing Drizzle", hindi: "शीत बूंदाबांदी", iconDay: "rain", iconNight: "rain", sky: "rain" },
  57: { english: "Heavy Freezing Drizzle", hindi: "भारी शीत बूंदाबांदी", iconDay: "rain", iconNight: "rain", sky: "rain" },
  61: { english: "Slight Rain", hindi: "हल्की बारिश", iconDay: "rain", iconNight: "rain", sky: "rain" },
  63: { english: "Moderate Rain", hindi: "मध्यम बारिश", iconDay: "rain", iconNight: "rain", sky: "rain" },
  65: { english: "Heavy Rain", hindi: "भारी बारिश", iconDay: "rain", iconNight: "rain", sky: "rain" },
  66: { english: "Freezing Rain", hindi: "शीत वर्षा", iconDay: "rain", iconNight: "rain", sky: "rain" },
  67: { english: "Heavy Freezing Rain", hindi: "तेज शीत वर्षा", iconDay: "rain", iconNight: "rain", sky: "rain" },
  71: { english: "Slight Snow", hindi: "हल्की बर्फबारी", iconDay: "partly-cloudy", iconNight: "moon-cloud", sky: "cloudy" },
  73: { english: "Moderate Snow", hindi: "बर्फबारी", iconDay: "partly-cloudy", iconNight: "moon-cloud", sky: "cloudy" },
  75: { english: "Heavy Snow", hindi: "भारी बर्फबारी", iconDay: "partly-cloudy", iconNight: "moon-cloud", sky: "cloudy" },
  77: { english: "Snow Grains", hindi: "बर्फ के कण", iconDay: "partly-cloudy", iconNight: "moon-cloud", sky: "cloudy" },
  80: { english: "Slight Showers", hindi: "हल्की बौछारें", iconDay: "rain", iconNight: "rain", sky: "rain" },
  81: { english: "Moderate Showers", hindi: "मध्यम बौछारें", iconDay: "rain", iconNight: "rain", sky: "rain" },
  82: { english: "Violent Showers", hindi: "तेज मूसलाधार बौछारें", iconDay: "rain", iconNight: "rain", sky: "rain" },
  85: { english: "Snow Showers", hindi: "बर्फ की बौछारें", iconDay: "partly-cloudy", iconNight: "moon-cloud", sky: "cloudy" },
  86: { english: "Heavy Snow Showers", hindi: "भारी बर्फ की बौछारें", iconDay: "partly-cloudy", iconNight: "moon-cloud", sky: "cloudy" },
  95: { english: "Thunderstorm", hindi: "गरज के साथ बारिश", iconDay: "rain", iconNight: "rain", sky: "rain" },
  96: { english: "Thunderstorm with Hail", hindi: "आंधी और ओलावृष्टि", iconDay: "rain", iconNight: "rain", sky: "rain" },
  99: { english: "Severe Thunderstorm with Hail", hindi: "भारी आंधी और ओलावृष्टि", iconDay: "rain", iconNight: "rain", sky: "rain" }
};

/**
 * Weather API Client
 */
class WeatherApiClient {
  /**
   * Fetches live forecast from Open-Meteo with localStorage cache fallback
   */
  async fetchForecast() {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 9000);

    try {
      const response = await fetch(OPEN_METEO_API_URL, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }

      const data = await response.json();

      // Cache successful response in localStorage
      const now = new Date();
      try {
        localStorage.setItem(CACHE_KEY_DATA, JSON.stringify(data));
        localStorage.setItem(CACHE_KEY_TIME, now.toISOString());
      } catch (cacheErr) {
        console.warn("Storage quota exceeded or disabled", cacheErr);
      }

      return {
        success: true,
        data: data,
        isCached: false,
        timestamp: now
      };
    } catch (err) {
      clearTimeout(timeoutId);
      console.warn("Live weather fetch failed, attempting cached fallback:", err);

      // Check localStorage for previous response
      const cachedData = localStorage.getItem(CACHE_KEY_DATA);
      const cachedTimeStr = localStorage.getItem(CACHE_KEY_TIME);

      if (cachedData) {
        try {
          const parsed = JSON.parse(cachedData);
          const cachedTime = cachedTimeStr ? new Date(cachedTimeStr) : new Date();
          return {
            success: true,
            data: parsed,
            isCached: true,
            timestamp: cachedTime
          };
        } catch (e) {
          // Corrupted cache
        }
      }

      // No cache available and network failed
      return {
        success: false,
        error: err.message || "Network request failed",
        isCached: false
      };
    }
  }

  /**
   * Maps WMO weather code to text, icon, and sky condition
   */
  getCondition(code, isDay = 1) {
    const item = WMO_CODE_MAP[code] || WMO_CODE_MAP[0];
    const isHindi = (window.I18n && window.I18n.getLanguage() === 'hi');
    const localized = (window.t ? window.t('wmo.' + code) : (isHindi ? item.hindi : item.english));
    return {
      text: localized,
      english: item.english,
      hindi: item.hindi,
      icon: isDay ? item.iconDay : item.iconNight,
      sky: item.sky
    };
  }

  /**
   * Determines sky background condition automatically from live data:
   * 1. Rain for drizzle/rain/thunderstorm codes
   * 2. Night if is_day === 0
   * 3. Cloudy for overcast/fog
   * 4. Otherwise Clear Day
   */
  getSkyStateFromLive(currentData) {
    const code = currentData.weather_code;
    const isDay = currentData.is_day;

    // Check for precipitation first (rain particles & storm sky)
    const isRain = (code >= 51 && code <= 67) ||
                   (code >= 80 && code <= 82) ||
                   (code >= 95 && code <= 99);
    if (isRain) {
      return "rain";
    }

    // Check if night
    if (isDay === 0) {
      return "night";
    }

    // Check overcast / fog
    if ([3, 45, 48].includes(code)) {
      return "cloudy";
    }

    // Default clear daytime
    return "day";
  }

  /**
   * Converts wind degrees (0-360) into compass direction (e.g. NNE, E, SW)
   */
  getWindCompass(deg) {
    if (deg === null || deg === undefined) return "N";
    const sectors = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
    const index = Math.round(deg / 22.5) % 16;
    const sector = sectors[index];
    if (window.t) {
      return window.t('compass.' + sector);
    }
    return sector;
  }

  /**
   * Calculates dew point using Magnus-Tetens approximation
   */
  getDewPoint(tempC, humidity) {
    if (tempC === null || humidity === null) return Math.round(tempC);
    const a = 17.27;
    const b = 237.7;
    const alpha = ((a * tempC) / (b + tempC)) + Math.log(humidity / 100.0);
    return Math.round((b * alpha) / (a - alpha));
  }

  /**
   * Extracts next 12 hours starting from the current hour
   */
  getNext12Hours(hourly, currentIsoTime) {
    const targetHour = currentIsoTime ? currentIsoTime.slice(0, 13) : "";
    let startIdx = -1;

    if (targetHour) {
      startIdx = hourly.time.findIndex(t => t.startsWith(targetHour));
    }
    if (startIdx === -1) {
      startIdx = 0;
    }

    const items = [];
    const count = Math.min(12, hourly.time.length - startIdx);

    for (let i = 0; i < count; i++) {
      const idx = startIdx + i;
      const timeStr = hourly.time[idx];
      const isFirst = (i === 0);

      // Format time label (e.g. "Now", "1 PM", "3 AM")
      let timeLabel = window.t ? window.t('home.now') : "Now";
      if (!isFirst) {
        const d = new Date(timeStr);
        const hours = d.getHours();
        const isHindi = (window.I18n && window.I18n.getLanguage() === 'hi');
        const period = hours >= 12 ? (isHindi ? "अपराह्न" : "PM") : (isHindi ? "पूर्वाह्न" : "AM");
        const h12 = (hours % 12) || 12;
        timeLabel = `${h12} ${period}`;
      }

      const weatherCode = hourly.weather_code[idx];
      const isDay = hourly.is_day ? hourly.is_day[idx] : 1;
      const condition = this.getCondition(weatherCode, isDay);
      const pop = hourly.precipitation_probability ? hourly.precipitation_probability[idx] : 0;
      const temp = Math.round(hourly.temperature_2m[idx]);

      items.push({
        time: timeLabel,
        temp: temp,
        pop: pop,
        icon: condition.icon,
        label: condition.text || condition.english
      });
    }

    return items;
  }
}

window.WeatherApi = new WeatherApiClient();

const WEATHER_ICONS = {
  sun: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="weather-icon sun"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>`,
  moon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="weather-icon moon"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`,
  "partly-cloudy": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="weather-icon partly-cloudy"><path d="M12 2v2"></path><path d="m4.93 4.93 1.41 1.41"></path><path d="M20 12h2"></path><path d="m19.07 4.93-1.41 1.41"></path><path d="M15.947 12.65a4 4 0 0 0-5.925-4.128"></path><path d="M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6z"></path></svg>`,
  "moon-cloud": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="weather-icon moon-cloud"><path d="M11 5a5 5 0 0 0-4.5 7.2A5 5 0 0 0 7 22h8a4 4 0 0 0 0-8h-.5A5 5 0 0 0 11 5z"></path></svg>`,
  rain: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="weather-icon rain"><line x1="16" y1="13" x2="16" y2="21"></line><line x1="8" y1="13" x2="8" y2="21"></line><line x1="12" y1="15" x2="12" y2="23"></line><path d="M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25"></path></svg>`,
  "rain-chance": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="weather-icon rain-chance"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"></path></svg>`,
  droplet: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="weather-icon droplet"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"></path></svg>`,
  humidity: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="weather-icon humidity"><path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"></path><path d="M10 13a2 2 0 0 0 2 2"></path></svg>`,
  wind: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="weather-icon wind"><path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2"></path></svg>`,
  elevation: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="weather-icon elevation"><path d="m8 3 4 8 5-5 5 15H2L8 3z"></path></svg>`,
  leaf: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="weather-icon leaf"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"></path><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"></path></svg>`,
  map: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="weather-icon map"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"></polygon><line x1="9" y1="3" x2="9" y2="18"></line><line x1="15" y1="6" x2="15" y2="21"></line></svg>`
};

window.WEATHER_ICONS = WEATHER_ICONS;
