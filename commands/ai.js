const axios = require('axios');

// davidcyriltech's API is prone to intermittent 500s/timeouts under load but
// works reliably when retried - not a dead endpoint, just flaky.
async function getWithRetry(url, attempts = 3) {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
        try {
            return await axios.get(url, { timeout: 20000 });
        } catch (err) {
            lastErr = err;
            if (i < attempts - 1) await new Promise(r => setTimeout(r, 1500));
        }
    }
    throw lastErr;
}

async function aiCommand(sock, chatId, message) {
    try {
        const text = message.message?.conversation || message.message?.extendedTextMessage?.text;
        
        if (!text) {
            return await sock.sendMessage(chatId, { 
                text: "Please provide a question after .gpt or .gemini\n\nExample: .gpt write a basic html code"
            }, {
                quoted: message
            });
        }

        // Get the command and query
        const parts = text.split(' ');
        const command = parts[0].toLowerCase();
        const query = parts.slice(1).join(' ').trim();

        if (!query) {
            return await sock.sendMessage(chatId, { 
                text: "Please provide a question after .gpt or .gemini"
            }, {quoted:message});
        }

        try {
            // Show processing message
            await sock.sendMessage(chatId, {
                react: { text: '🤖', key: message.key }
            });

            if (command === '.gpt') {
                const response = await getWithRetry(`https://apis.davidcyriltech.my.id/ai/chatgpt?prompt=${encodeURIComponent(query)}`);
                const answer = response.data?.data?.choices?.[0]?.message?.content;

                if (response.data?.success && answer) {
                    await sock.sendMessage(chatId, {
                        text: answer
                    }, {
                        quoted: message
                    });
                } else {
                    throw new Error('Invalid response from API');
                }
            } else if (command === '.gemini') {
                const apis = [
                    `https://apis.davidcyriltech.my.id/ai/gemini?text=${encodeURIComponent(query)}`,
                    `https://apis.davidcyriltech.my.id/ai/gpt3?text=${encodeURIComponent(query)}`
                ];

                for (const api of apis) {
                    try {
                        const response = await getWithRetry(api);
                        const answer = response.data?.message;

                        if (response.data?.success && answer) {
                            await sock.sendMessage(chatId, {
                                text: answer
                            }, {
                                quoted: message
                            });
                            return;
                        }
                    } catch (e) {
                        continue;
                    }
                }
                throw new Error('All Gemini APIs failed');
            }
        } catch (error) {
            console.error('API Error:', error);
            await sock.sendMessage(chatId, {
                text: "❌ Failed to get response. Please try again later.",
                contextInfo: {
                    mentionedJid: [message.key.participant || message.key.remoteJid],
                    quotedMessage: message.message
                }
            }, {
                quoted: message
            });
        }
    } catch (error) {
        console.error('AI Command Error:', error);
        await sock.sendMessage(chatId, {
            text: "❌ An error occurred. Please try again later.",
            contextInfo: {
                mentionedJid: [message.key.participant || message.key.remoteJid],
                quotedMessage: message.message
            }
        }, {
            quoted: message
        });
    }
}

module.exports = aiCommand; 