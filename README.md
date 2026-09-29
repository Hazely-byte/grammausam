# GramMausam (SIH26074)

> Hyper-local elevation-downscaled weather forecasts and Kisan advisory for Gram Panchayats.

**GramMausam** is a phone-first, progressive web application (PWA) developed for **SIH26074: Panchayat-Level Weather Forecasts**. Calibrated for the high-altitude plateau of **Mainpat Block**, Surguja District, Chhattisgarh, GramMausam bridges the critical gap between coarse grid-level numerical weather models and localized microclimates experienced by farmers across 37 Gram Panchayats.

---

## 🌾 Core Problem & Methodology

### 1. The Elevation Challenge
Standard meteorological forecast models operate on coarse grids (typically 4–11 km). In plateau and hilly terrains like Mainpat (ranging from ~550 m to over 1,120 m elevation across just 25 km), temperatures vary dramatically from valley floors to tablelands. A single block-level temperature cannot accurately inform planting, irrigation, or harvest decisions.

### 2. Physical Downscaling Formula
GramMausam downscales block-level weather forecasts using the environmental lapse rate:

$$\Delta T = -0.0065 \times (h_{\text{panchayat}} - h_{\text{grid}})$$

$$T_{\text{panchayat}} = T_{\text{block}} + \Delta T$$

- **$h_{\text{grid}}$**: The elevation representing the numerical model's forecast grid cell (fetched dynamically from Open-Meteo's `elevation` field).
- **$h_{\text{panchayat}}$**: The surveyed ground elevation for each Gram Panchayat centroid.
- **Lapse Rate**: $-6.5\,^{\circ}\text{C}$ per $1,000\,\text{m}$ ($-0.0065\,^{\circ}\text{C}/\text{m}$).
- Applied to current temperature, apparent temperature, 12-hour hourly forecasts, and 5-day daily minimum and maximum temperatures.
- Each temperature is displayed alongside a $\pm 1\,^{\circ}\text{C}$ physical uncertainty interval (e.g. `27°C (26–28)`).
- Rain probability, humidity, and wind parameters are preserved from the parent model and explicitly labeled as grid-scale forecasts.

---

## 💻 Tech Stack

- **Frontend Core**: Vanilla JavaScript (ES6+), HTML5, CSS3 Custom Properties (Design Tokens)
- **Mapping & Spatial Visualization**: [Leaflet 1.9.4](https://leafletjs.com/) with OpenStreetMap cartography and custom dynamic temperature bubbles
- **Isotherm Contour Engine**: [D3.js v7](https://d3js.org/) (`d3-contour`) with 2D Gaussian grid smoothing for whole-degree temperature zone boundaries
- **Forecast Engine**: [Open-Meteo](https://open-meteo.com/) Free Weather API (no API key required)
- **Authentication**: Google Identity Services (GIS) client-side authentication with JWT decoding and language profile persistence
- **Offline & PWA Support**: Service Worker (`sw.js`) with cache-first static shell and network-first forecast caching
- **Geocoding & Grid Pipeline**: Python 3 (`requests`, `haversine`, Google Geocoding API)

---

## 🚀 Getting Started

### Prerequisites
- Python 3.8+ (for local preview server)
- Modern web browser (Chrome, Edge, Safari, Firefox)

### Running Locally
Google OAuth client-side authentication is authorized for `http://localhost:8000`. Run the local server on port 8000:

```bash
# 1. Clone repository and navigate to the app directory
cd panchayat-weather/app

# 2. Start local HTTP server on port 8000
python -m http.server 8000
```

Open your browser and navigate to:
```
http://localhost:8000
```

---

## 📱 Application Architecture & Features

### 1. Authentication & Security
- **Google Sign-In**: Official Google Identity Services button (pill shape, large) rendered on a full-screen frosted glass screen.
- Client-side token validation; user session persists in `localStorage` under `gram_mausam_session`.
- Safe profile card at top of Settings with picture, name, and email.
- Instant logout (`disableAutoSelect` + session wipe) with strict route guards on `#home`, `#map`, `#advice`, `#profile`.

### 2. Single-Language Localization (English / हिन्दी)
- Zero mixed English and Hindi text anywhere in the interface.
- Complete string dictionaries in `app/i18n/en.json` and `app/i18n/hi.json`.
- Dynamic panchayat names: English displays English names; Hindi displays Devanagari names (`Noto Sans Devanagari`).
- Indian locale date and time formatting via standard `Intl.DateTimeFormat`.
- Per-user language preference saved under `lang:<email>`.

### 3. Dynamic Sky & Weather Engine
- Responsive sky background automatically adapting to live condition codes: Clear Day, Clear Night, Overcast, and Rain.
- Real-time HTML5 2D canvas rain particle simulator with fluid vertical motion.
- Developer sky toggle panel (keyboard shortcuts `1`–`5`) available on localhost or with `?dev=1`.

### 4. Interactive Isotherm Map
- Full Leaflet map rendered within a 430px mobile viewport on desktop and full screen on mobile.
- Custom temperature badges for all 37 Gram Panchayats:
  - Solid border: HIGH confidence geocoded panchayats
  - Dashed border: MEDIUM confidence geocoded panchayats
  - Blue pinpoint: currently selected panchayat
  - Distinct radar icon: Block forecast grid reference point
- Smooth whole-degree isotherm contours with clean edge clipping and label placement.
- Automatic dark-mode tile filter (`filter: invert(1) hue-rotate(180deg) brightness(0.95)`).

### 5. Kisan Salah (Agricultural Advisory)
- Rule-based agromet advisories tailored to current microclimate conditions:
  - Heat stress precautions
  - High humidity & fungal disease alerts
  - Pre-monsoon sowing guidance
  - Irrigation and spray planning based on rain probability

---

## 📂 Project Structure

```
panchayat-weather/
├── .env.example             # Template for optional pipeline API keys
├── .gitignore               # Strict exclusion of .env, caches, and build outputs
├── README.md                # System documentation and setup guide
├── app/                     # Production-ready client application
│   ├── index.html           # Unified single-page HTML structure
│   ├── manifest.json        # PWA configuration
│   ├── privacy.html         # Privacy Policy page
│   ├── icon.svg             # Vector app icon
│   ├── sw.js                # Service Worker offline cache manager
│   ├── css/
│   │   ├── tokens.css       # Color palettes, typography, and spacing tokens
│   │   ├── glass.css        # Frosted glass styling, cards, and animations
│   │   └── layout.css       # Mobile viewport column, transitions, navigation
│   ├── data/
│   │   ├── panchayats.json  # 37 Gram Panchayats with elevations & coordinates
│   │   └── elevation_grid.json # 1 km resolution elevation grid for contours
│   ├── i18n/
│   │   ├── en.json          # English translation dictionary
│   │   └── hi.json          # Hindi translation dictionary
│   └── js/
│       ├── config.js        # Public Google OAuth Client ID
│       ├── auth.js          # Google Identity Services client & session manager
│       ├── i18n.js          # Translation helper (t) and language switchers
│       ├── weather-api.js   # Open-Meteo client & localStorage fallback cache
│       ├── downscale.js     # Environmental lapse rate downscaling engine
│       ├── advice.js        # Rule-based Kisan Salah agricultural advisories
│       ├── panchayats.js    # Bottom sheet search and panchayat selector
│       ├── map.js           # Leaflet map, temperature bubbles & D3 contours
│       ├── theme.js         # Auto / Light / Dark theme controller
│       ├── sky.js           # Dynamic sky gradients & rain particle engine
│       ├── router.js        # Hash-based SPA router with auth guards
│       └── app.js           # Application bootstrap & coordinator
└── pipeline/                # Data preparation & validation scripts
    ├── build_elevation_grid.py # Generates 1 km elevation grid from Open-Meteo
    ├── geocode_gps.py       # Forward & reverse geocoder with verification
    └── reference/           # Official Mainpat Gram Panchayat census rosters
```

---

## 🔒 Security & Privacy

- **No Secrets in Client Code**: All client-side requests utilize public APIs or public client IDs (`GOOGLE_CLIENT_ID`).
- **No Client Secrets**: Client secrets are never committed or deployed to client devices.
- **Environment Isolation**: The geocoding API key resides solely in `.env`, strictly ignored by version control.
- **Privacy Policy**: Detailed privacy disclosures available in `app/privacy.html`.

---

## 📜 Attributions

- Weather data provided by [Open-Meteo](https://open-meteo.com/) under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- Cartography data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) under ODbL.
