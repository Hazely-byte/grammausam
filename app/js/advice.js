/**
 * SIH26074 - Panchayat Weather
 * Agromet Advisory System (Kisan Salah / किसान सलाह)
 * 
 * Generates rule-based bilingual advisory for Surguja farmers based on downscaled
 * panchayat forecasts for the next 3 days (72 hours).
 */

class AgrometAdvisoryEngine {
  /**
   * Evaluates all agricultural weather advisory rules against the downscaled forecast
   */
  generateAdvisory(forecast) {
    if (!forecast || !forecast.current || !forecast.hourly || !forecast.daily) {
      return [this.getDefaultAdvice()];
    }

    const current = forecast.current;
    const hourly = forecast.hourly;
    const daily = forecast.daily;
    const advisories = [];

    // 1. Check max rain probability within 24 hours
    let maxPop24h = 0;
    if (hourly.precipitation_probability && hourly.precipitation_probability.length > 0) {
      const slice24 = hourly.precipitation_probability.slice(0, 24);
      maxPop24h = Math.max(...slice24);
    } else if (daily.precipitation_probability_max && daily.precipitation_probability_max.length > 0) {
      maxPop24h = daily.precipitation_probability_max[0] || 0;
    }

    const isHi = (window.I18n && window.I18n.getLanguage() === 'hi');

    if (maxPop24h >= 60) {
      const title_en = "Do Not Spray Pesticides or Fertiliser";
      const title_hi = "कीटनाशक या खाद का छिड़काव न करें";
      const reason_en = `${maxPop24h}% rain probability in next 24 hours`;
      const reason_hi = `अगले 24 घंटे में ${maxPop24h}% बारिश की संभावना`;
      const english = "Rain probability is 60% or higher within the next 24 hours. Rain will wash away applied chemicals into drainage, wasting inputs. Postpone spraying until skies clear.";
      const hindi = "अगले 24 घंटों में 60% या अधिक बारिश का अनुमान है। बारिश से दवा धुल जाएगी और लागत बेकार होगी। मौसम साफ होने तक छिड़काव टालें।";

      advisories.push({
        id: "spray_rain",
        priority: 1,
        severity: "warning",
        icon: "🌧️",
        title: (window.t ? window.t("advisory.spray_rain.title") : (isHi ? title_hi : title_en)),
        reason: (window.t ? window.t("advisory.spray_rain.reason", { pop: maxPop24h }) : (isHi ? reason_hi : reason_en)),
        text: (window.t ? window.t("advisory.spray_rain.text") : (isHi ? hindi : english)),
        title_en,
        title_hi,
        english,
        hindi
      });
    }

    // 2. Check 2-day total rainfall
    let rainSum2Days = 0;
    if (daily.precipitation_sum && daily.precipitation_sum.length >= 2) {
      rainSum2Days = (Number(daily.precipitation_sum[0] || 0) + Number(daily.precipitation_sum[1] || 0));
    }
    rainSum2Days = Math.round(rainSum2Days * 10) / 10;

    if (rainSum2Days >= 10.0) {
      const title_en = "Skip Field Irrigation";
      const title_hi = "खेत में सिंचाई रोकें";
      const reason_en = `${rainSum2Days} mm total rainfall expected over next 2 days`;
      const reason_hi = `अगले 2 दिनों में कुल ${rainSum2Days} मिमी वर्षा का अनुमान`;
      const english = `Substantial precipitation (${rainSum2Days} mm) is forecast over the next 48 hours. Withhold canal or tubewell irrigation to prevent root waterlogging and soil nutrient leaching.`;
      const hindi = `अगले 48 घंटों में पर्याप्त वर्षा (${rainSum2Days} मिमी) का अनुमान है। जलभराव और पोषक तत्वों के रिसाव को रोकने के लिए खेत में पानी न लगाएं।`;

      advisories.push({
        id: "skip_irrigation",
        priority: 2,
        severity: "info",
        icon: "💧",
        title: (window.t ? window.t("advisory.skip_irrigation.title") : (isHi ? title_hi : title_en)),
        reason: (window.t ? window.t("advisory.skip_irrigation.reason", { rain: rainSum2Days }) : (isHi ? reason_hi : reason_en)),
        text: (window.t ? window.t("advisory.skip_irrigation.text", { rain: rainSum2Days }) : (isHi ? hindi : english)),
        title_en,
        title_hi,
        english,
        hindi
      });
    }

    // 3. Check high wind speed (>= 30 km/h)
    let maxWindNext24h = current.wind_speed_10m || 0;
    if (hourly.wind_speed_10m && hourly.wind_speed_10m.length > 0) {
      const windSlice = hourly.wind_speed_10m.slice(0, 24);
      maxWindNext24h = Math.max(...windSlice);
    }
    const windSpeedRound = Math.round(maxWindNext24h);

    if (windSpeedRound >= 30) {
      const title_en = "High Wind Alert: Avoid Chemical Spraying";
      const title_hi = "तेज हवा: छिड़काव से बचें";
      const reason_en = `Wind gusts reaching ${windSpeedRound} km/h`;
      const reason_hi = `हवा की गति ${windSpeedRound} किमी/घंटा तक पहुंचने का अनुमान`;
      const english = `Strong winds above 30 km/h cause severe droplet drift, reducing pesticide efficacy and endangering adjacent crops. Carry out foliar applications only during early morning calm hours.`;
      const hindi = `30 किमी/घंटे से तेज हवाओं के कारण दवा हवा में उड़कर नष्ट हो जाती है। छिड़काव केवल सुबह के शांत समय में ही करें।`;

      advisories.push({
        id: "high_wind",
        priority: 3,
        severity: "warning",
        icon: "💨",
        title: (window.t ? window.t("advisory.high_wind.title") : (isHi ? title_hi : title_en)),
        reason: (window.t ? window.t("advisory.high_wind.reason", { speed: windSpeedRound }) : (isHi ? reason_hi : reason_en)),
        text: (window.t ? window.t("advisory.high_wind.text", { speed: windSpeedRound }) : (isHi ? hindi : english)),
        title_en,
        title_hi,
        english,
        hindi
      });
    }

    // 4. Check downscaled max temperature >= 38°C in next 3 days
    let maxTemp3Days = -999;
    if (daily.temperature_2m_max && daily.temperature_2m_max.length > 0) {
      const slice3d = daily.temperature_2m_max.slice(0, 3);
      maxTemp3Days = Math.max(...slice3d);
    }
    const maxTempRound = Math.round(maxTemp3Days);

    if (maxTempRound >= 38) {
      const title_en = "Heat Stress Alert: Evening Irrigation Needed";
      const title_hi = "गर्मी का प्रकोप: शाम को सिंचाई करें";
      const reason_en = `Maximum temperature hitting ${maxTempRound}°C`;
      const reason_hi = `अधिकतम तापमान ${maxTempRound}°C तक पहुंचने का अनुमान`;
      const english = `Extreme heat condition (${maxTempRound}°C) can cause flower drop and stunted vegetative growth. Irrigate crops during evening hours to maintain rhizosphere moisture, and shade young saplings.`;
      const hindi = `अत्यधिक गर्मी (${maxTempRound}°C) से फसलों में फूल झड़ने का खतरा रहता है। जमीन में नमी बनाए रखने के लिए शाम को सिंचाई करें और नए पौधों को छाया दें।`;

      advisories.push({
        id: "heat_stress",
        priority: 4,
        severity: "danger",
        icon: "☀️",
        title: (window.t ? window.t("advisory.heat_stress.title") : (isHi ? title_hi : title_en)),
        reason: (window.t ? window.t("advisory.heat_stress.reason", { temp: maxTempRound }) : (isHi ? reason_hi : reason_en)),
        text: (window.t ? window.t("advisory.heat_stress.text", { temp: maxTempRound }) : (isHi ? hindi : english)),
        title_en,
        title_hi,
        english,
        hindi
      });
    }

    // 5. Check downscaled min temperature <= 4°C in next 3 days
    let minTemp3Days = 999;
    if (daily.temperature_2m_min && daily.temperature_2m_min.length > 0) {
      const slice3d = daily.temperature_2m_min.slice(0, 3);
      minTemp3Days = Math.min(...slice3d);
    }
    const minTempRound = Math.round(minTemp3Days);

    if (minTempRound <= 4) {
      const title_en = "Frost Warning";
      const title_hi = "पाला पड़ने की चेतावनी";
      const reason_en = `Night temperature falling to ${minTempRound}°C`;
      const reason_hi = `रात का तापमान गिरकर ${minTempRound}°C तक होने का अनुमान`;
      const english = `Near-freezing nighttime minimum (${minTempRound}°C) creates severe frost risk for winter crops like potato, tomato, and mustard. Provide light evening irrigation and cover delicate nursery beds with straw or polythene.`;
      const hindi = `रात में अत्यधिक ठंड (${minTempRound}°C) से आलू, टमाटर और सरसों की फसल में पाला लगने का खतरा है। शाम को हल्की सिंचाई करें तथा क्यारियों को पुआल से ढकें।`;

      advisories.push({
        id: "frost_risk",
        priority: 5,
        severity: "danger",
        icon: "❄️",
        title: (window.t ? window.t("advisory.frost_risk.title") : (isHi ? title_hi : title_en)),
        reason: (window.t ? window.t("advisory.frost_risk.reason", { temp: minTempRound }) : (isHi ? reason_hi : reason_en)),
        text: (window.t ? window.t("advisory.frost_risk.text", { temp: minTempRound }) : (isHi ? hindi : english)),
        title_en,
        title_hi,
        english,
        hindi
      });
    }

    // 6. If no adverse conditions triggered, show favorable conditions card
    if (advisories.length === 0) {
      advisories.push(this.getDefaultAdvice());
    }

    // Sort by priority (most urgent first)
    advisories.sort((a, b) => a.priority - b.priority);
    return advisories;
  }

  getDefaultAdvice() {
    const isHi = (window.I18n && window.I18n.getLanguage() === 'hi');
    const title_en = "Good Conditions for Normal Field Work";
    const title_hi = "खेत में कार्य के लिए अनुकूल मौसम";
    const reason_en = "Moderate temperatures, low wind & steady conditions";
    const reason_hi = "सामान्य तापमान, हल्की हवा और स्थिर मौसम";
    const english = "Weather parameters remain favorable over the next 3 days. Proceed with scheduled weeding, fertilizer dressing, intercultural operations, and crop harvesting.";
    const hindi = "अगले 3 दिनों तक मौसम शांत और अनुकूल रहेगा। खेत की जुताई, निराई-गुड़ाई, खाद प्रयोग और फसल कटाई का कार्य सुचारू रूप से करें।";

    return {
      id: "favorable_weather",
      priority: 99,
      severity: "success",
      icon: "🌱",
      title: (window.t ? window.t("advisory.favorable_weather.title") : (isHi ? title_hi : title_en)),
      reason: (window.t ? window.t("advisory.favorable_weather.reason") : (isHi ? reason_hi : reason_en)),
      text: (window.t ? window.t("advisory.favorable_weather.text") : (isHi ? hindi : english)),
      title_en,
      title_hi,
      english,
      hindi
    };
  }
}

window.Agromet = new AgrometAdvisoryEngine();
