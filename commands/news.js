const axios = require('axios');
const cheerio = require('cheerio');

async function fetchFromRss() {
    const { data } = await axios.get('https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en', {
        timeout: 20000,
        headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const $ = cheerio.load(data, { xmlMode: true });
    const items = [];
    $('item').slice(0, 5).each((_, item) => {
        const title = $(item).find('title').first().text().trim();
        const link = $(item).find('link').first().text().trim();
        if (title) items.push(`• *${title}*${link ? `\n${link}` : ''}`);
    });
    return items;
}

module.exports = async function (sock, chatId) {
    try {
        let articles = [];
        const apiKey = process.env.NEWSAPI_KEY;

        if (apiKey) {
            try {
                const response = await axios.get('https://newsapi.org/v2/top-headlines', {
                    params: { country: 'us', pageSize: 5, apiKey },
                    timeout: 20000
                });
                articles = (response.data?.articles || [])
                    .slice(0, 5)
                    .map((article, index) => `${index + 1}. *${article.title}*\n${article.description || ''}`.trim());
            } catch {
                articles = await fetchFromRss();
            }
        } else {
            articles = await fetchFromRss();
        }

        if (!articles.length) throw new Error('No news found');

        await sock.sendMessage(chatId, { text: `📰 *Latest News*:\n\n${articles.join('\n\n')}` });
    } catch (error) {
        console.error('Error fetching news:', error.message);
        await sock.sendMessage(chatId, { text: 'Sorry, I could not fetch news right now.' });
    }
};
