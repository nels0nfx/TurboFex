const { getJson } = require('../core/http');
const { weatherMessage } = require('../core/lookup');

module.exports = {
  name: 'weather',
  aliases: ['forecast'],
  category: 'lookup',
  needs: [],
  weight: 'light',
  description: 'Weather now and the next 3 days: weather <city>',
  async run({ rest, reply, prefix, isOwner }) {
    if (!rest) return reply(`Write a city after the command.\nExample: ${prefix}weather Lagos`);
    try {
      const geo = await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(rest.slice(0, 80))}&count=1&language=en&format=json`);
      const place = geo.results && geo.results[0];
      if (!place) return reply(`⚠️ I could not find a place called *${rest.slice(0, 40)}*.`);
      const w = await getJson(
        `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=3`
      );
      const name = [place.name, place.admin1, place.country].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(', ');
      return reply(`${weatherMessage(name, w)}\n\n_Data: Open-Meteo_`);
    } catch (err) {
      return reply(`⚠️ I could not get the weather right now.${isOwner ? `\nReason: ${err.message}` : ' Please try again in a moment.'}`);
    }
  },
};
