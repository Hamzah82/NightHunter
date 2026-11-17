const axios = require('axios');
const settings = require('../settings');

async function gifCommand(sock, chatId, query) {
    if (!query) {
        await sock.sendMessage(chatId, { text: 'Please provide a search term for the GIF.' });
        return;
    }

    const apiKey = process.env.GIPHY_API_KEY || settings.giphyApiKey;
    if (!apiKey) {
        await sock.sendMessage(chatId, { text: 'GIF feature is not configured. Set GIPHY_API_KEY in the environment.' });
        return;
    }

    try {
        const response = await axios.get('https://api.giphy.com/v1/gifs/search', {
            params: { api_key: apiKey, q: query, limit: 1, rating: 'g' },
            timeout: 20000
        });

        const gifUrl = response.data?.data?.[0]?.images?.downsized_medium?.url;

        if (gifUrl) {
            await sock.sendMessage(chatId, { video: { url: gifUrl }, caption: `Here is your GIF for "${query}"` });
        } else {
            await sock.sendMessage(chatId, { text: 'No GIFs found for your search term.' });
        }
    } catch (error) {
        console.error('Error fetching GIF:', error.message);
        await sock.sendMessage(chatId, { text: 'Failed to fetch GIF. Please try again later.' });
    }
}

module.exports = gifCommand;
