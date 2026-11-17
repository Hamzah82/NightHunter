const axios = require('axios');

async function fetchFromWttr(city) {
    const { data } = await axios.get(`https://wttr.in/${encodeURIComponent(city)}?format=j1`, {
        timeout: 20000,
        headers: { 'User-Agent': 'curl/8.0' }
    });
    const current = data?.current_condition?.[0];
    if (!current) throw new Error('No weather data');
    const description = current.weatherDesc?.[0]?.value || 'Unknown';
    return `Weather in ${city}: ${description}. Temperature: ${current.temp_C}°C (feels like ${current.FeelsLikeC}°C). Humidity: ${current.humidity}%. Wind: ${current.windspeedKmph} km/h.`;
}

const WMO_CODES = {
    0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
    45: 'Fog', 48: 'Depositing rime fog',
    51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle',
    56: 'Light freezing drizzle', 57: 'Dense freezing drizzle',
    61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',
    66: 'Light freezing rain', 67: 'Heavy freezing rain',
    71: 'Slight snow', 73: 'Moderate snow', 75: 'Heavy snow',
    77: 'Snow grains',
    80: 'Slight rain showers', 81: 'Moderate rain showers', 82: 'Violent rain showers',
    85: 'Slight snow showers', 86: 'Heavy snow showers',
    95: 'Thunderstorm', 96: 'Thunderstorm with slight hail', 99: 'Thunderstorm with heavy hail'
};

async function fetchFromOpenMeteo(city) {
    const geo = await axios.get('https://geocoding-api.open-meteo.com/v1/search', {
        params: { name: city, count: 1, language: 'en', format: 'json' },
        timeout: 20000
    });
    const location = geo.data?.results?.[0];
    if (!location) throw new Error('City not found');

    const forecast = await axios.get('https://api.open-meteo.com/v1/forecast', {
        params: {
            latitude: location.latitude,
            longitude: location.longitude,
            current: 'temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,weather_code',
            timezone: 'auto'
        },
        timeout: 20000
    });
    const current = forecast.data?.current;
    if (!current) throw new Error('No weather data');

    const description = WMO_CODES[current.weather_code] || 'Unknown';
    const label = location.country ? `${location.name}, ${location.country}` : location.name;
    return `Weather in ${label}: ${description}. Temperature: ${current.temperature_2m}°C (feels like ${current.apparent_temperature}°C). Humidity: ${current.relative_humidity_2m}%. Wind: ${current.wind_speed_10m} km/h.`;
}

async function fetchKeylessWeather(city) {
    try {
        return await fetchFromOpenMeteo(city);
    } catch (error) {
        console.warn('Open-Meteo failed, trying wttr.in:', error.message);
        return fetchFromWttr(city);
    }
}

module.exports = async function (sock, chatId, message, city) {
    try {
        if (!city) {
            await sock.sendMessage(chatId, { text: 'Please specify a city, e.g., .weather London' }, { quoted: message });
            return;
        }

        const apiKey = process.env.OPENWEATHER_API_KEY;
        let text;

        if (apiKey) {
            try {
                const response = await axios.get('https://api.openweathermap.org/data/2.5/weather', {
                    params: { q: city, appid: apiKey, units: 'metric' },
                    timeout: 20000
                });
                const weather = response.data;
                text = `Weather in ${weather.name}: ${weather.weather?.[0]?.description || 'Unknown'}. Temperature: ${weather.main?.temp}°C. Humidity: ${weather.main?.humidity}%. Wind: ${weather.wind?.speed} m/s.`;
            } catch {
                text = await fetchKeylessWeather(city);
            }
        } else {
            text = await fetchKeylessWeather(city);
        }

        await sock.sendMessage(chatId, { text }, { quoted: message });
    } catch (error) {
        console.error('Error fetching weather:', error.message);
        await sock.sendMessage(chatId, { text: 'Sorry, I could not fetch the weather right now.' }, { quoted: message });
    }
};
