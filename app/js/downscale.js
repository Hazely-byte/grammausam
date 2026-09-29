/**
 * SIH26074 - Panchayat Weather
 * Micro-Grid Elevation Downscaling Engine
 * 
 * Physics:
 * Environmental lapse rate = 6.5°C / 1000m (0.0065°C / m)
 * Formula: T_panchayat = T_block - 0.0065 * (h_panchayat - h_grid)
 * 
 * h_grid is the elevation reported in Open-Meteo forecast JSON response (approx 990m for Mainpat block center).
 * h_panchayat is the actual GPS terrain elevation from SRTM/Open-Meteo elevation database.
 */

class DownscalingEngine {
  constructor() {
    this.LAPSE_RATE = 0.0065; // °C per meter
    this.DEFAULT_GRID_ELEVATION = 990.0; // fallback if missing
  }

  /**
   * Calculates downscaled temperature given block temperature and elevations
   */
  calculateTemperature(tBlock, hPanchayat, hGrid) {
    if (tBlock === undefined || tBlock === null) return tBlock;
    const grid = (hGrid !== undefined && hGrid !== null && !isNaN(hGrid)) ? Number(hGrid) : this.DEFAULT_GRID_ELEVATION;
    const pan = (hPanchayat !== undefined && hPanchayat !== null && !isNaN(hPanchayat)) ? Number(hPanchayat) : grid;
    
    const deltaH = pan - grid;
    const deltaT = -1 * this.LAPSE_RATE * deltaH;
    return tBlock + deltaT;
  }

  /**
   * Generates formatted uncertainty text: "27°C (26–28)"
   */
  formatWithUncertainty(tempCelsius) {
    if (tempCelsius === undefined || tempCelsius === null || isNaN(tempCelsius)) {
      return "--°C";
    }
    const rounded = Math.round(tempCelsius);
    return `${rounded}°C (${rounded - 1}–${rounded + 1})`;
  }

  /**
   * Generates bilingual physical explanation of the temperature delta
   */
  getExplanation(hPanchayat, hGrid, tDiff) {
    const grid = Math.round((hGrid !== undefined && hGrid !== null && !isNaN(hGrid)) ? Number(hGrid) : this.DEFAULT_GRID_ELEVATION);
    const pan = Math.round((hPanchayat !== undefined && hPanchayat !== null && !isNaN(hPanchayat)) ? Number(hPanchayat) : grid);
    const elevDiff = Math.abs(pan - grid);
    const diffAbs = Math.abs(tDiff).toFixed(1);

    let key = "similar";
    if (pan > grid + 15) {
      key = "cooler";
    } else if (pan < grid - 15) {
      key = "warmer";
    }

    const english = (key === "cooler")
      ? `${diffAbs}° cooler than the block forecast because this panchayat is ${elevDiff} m higher than the forecast grid average.`
      : (key === "warmer")
      ? `${diffAbs}° warmer than the block forecast because this panchayat is ${elevDiff} m lower than the forecast grid average.`
      : `Similar temperature to the block forecast as elevation (${pan} m) is near the forecast grid average (${grid} m).`;

    const hindi = (key === "cooler")
      ? `ब्लॉक पूर्वानुमान से ${diffAbs}° ठंडा क्योंकि यह पंचायत पूर्वानुमान ग्रिड औसत से ${elevDiff} मी अधिक ऊंचाई पर है।`
      : (key === "warmer")
      ? `ब्लॉक पूर्वानुमान से ${diffAbs}° गर्म क्योंकि यह पंचायत पूर्वानुमान ग्रिड औसत से ${elevDiff} मी कम ऊंचाई पर है।`
      : `ब्लॉक पूर्वानुमान के लगभग समान तापमान क्योंकि ऊंचाई (${pan} मी) ग्रिड औसत (${grid} मी) के निकट है।`;

    const isHindi = (window.I18n && window.I18n.getLanguage() === 'hi');
    const localized = (window.t ? window.t('downscale.' + key, { diff: diffAbs, elev: elevDiff, pan, grid }) : (isHindi ? hindi : english));

    return {
      direction: key,
      diffAbs: diffAbs,
      elevDiff: elevDiff,
      text: localized,
      english: english,
      hindi: hindi
    };
  }

  /**
   * Applies micro-grid downscaling to the complete Open-Meteo forecast dataset
   * for a specific panchayat. Returns an enriched clone of the dataset.
   */
  downscaleForecast(rawWeather, panchayat) {
    if (!rawWeather) return null;
    
    // Grid elevation from Open-Meteo response
    const hGrid = (rawWeather.elevation !== undefined && rawWeather.elevation !== null && !isNaN(rawWeather.elevation))
      ? Number(rawWeather.elevation)
      : this.DEFAULT_GRID_ELEVATION;

    const hPanchayat = (panchayat && panchayat.elevation_m !== undefined && panchayat.elevation_m !== null)
      ? Number(panchayat.elevation_m)
      : hGrid;

    const currentBlockTemp = rawWeather.current ? rawWeather.current.temperature_2m : null;
    const currentDownscaledTemp = this.calculateTemperature(currentBlockTemp, hPanchayat, hGrid);
    const currentTempDiff = (currentBlockTemp !== null && currentDownscaledTemp !== null)
      ? (currentDownscaledTemp - currentBlockTemp)
      : 0;

    // Deep clone to prevent mutating original cached data
    const downscaled = JSON.parse(JSON.stringify(rawWeather));

    // Downscale current conditions
    if (downscaled.current) {
      downscaled.current.raw_block_temperature_2m = currentBlockTemp;
      downscaled.current.temperature_2m = currentDownscaledTemp;
      
      if (downscaled.current.apparent_temperature !== undefined) {
        downscaled.current.apparent_temperature = this.calculateTemperature(
          rawWeather.current.apparent_temperature,
          hPanchayat,
          hGrid
        );
      }
    }

    // Downscale hourly temperatures
    if (downscaled.hourly && downscaled.hourly.temperature_2m) {
      downscaled.hourly.raw_block_temperature_2m = [...rawWeather.hourly.temperature_2m];
      downscaled.hourly.temperature_2m = rawWeather.hourly.temperature_2m.map(t => 
        this.calculateTemperature(t, hPanchayat, hGrid)
      );
    }

    // Downscale daily max and min temperatures
    if (downscaled.daily) {
      if (downscaled.daily.temperature_2m_max) {
        downscaled.daily.raw_block_temperature_2m_max = [...rawWeather.daily.temperature_2m_max];
        downscaled.daily.temperature_2m_max = rawWeather.daily.temperature_2m_max.map(t =>
          this.calculateTemperature(t, hPanchayat, hGrid)
        );
      }
      if (downscaled.daily.temperature_2m_min) {
        downscaled.daily.raw_block_temperature_2m_min = [...rawWeather.daily.temperature_2m_min];
        downscaled.daily.temperature_2m_min = rawWeather.daily.temperature_2m_min.map(t =>
          this.calculateTemperature(t, hPanchayat, hGrid)
        );
      }
    }

    // Metadata describing the downscaling transformation
    downscaled.downscaling_meta = {
      h_grid: hGrid,
      h_panchayat: hPanchayat,
      elevation_diff_m: Math.round(hPanchayat - hGrid),
      temp_diff_c: currentTempDiff,
      uncertainty_c: 1.0,
      current_formatted_uncertainty: this.formatWithUncertainty(currentDownscaledTemp),
      explanation: this.getExplanation(hPanchayat, hGrid, currentTempDiff),
      attribution: "Downscaled using adiabatic lapse rate (-0.0065°C/m) • Rain, humidity, wind: block forecast",
      attribution_hi: "तापमान का स्थानीय अनुकूलन (-0.0065°C/मी) • बारिश, नमी, हवा: ब्लॉक पूर्वानुमान"
    };

    return downscaled;
  }
}

// Singleton global instance
window.Downscaling = new DownscalingEngine();
