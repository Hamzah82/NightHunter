const fs = require('fs');
const axios = require('axios');

/**
 * Jarvis Command - OpenAI Compatible API Integration
 * Usage: .jarvis <your question or message>
 *        Reply to a message/photo with .jarvis
 */

async function jarvisCommand(sock, chatId, message, text) {
    try {
        // Read configuration
        let config;
        try {
            config = JSON.parse(fs.readFileSync('./jarvis.json'));
        } catch (error) {
            await sock.sendMessage(chatId, {
                text: '❌ Error: Configuration file (jarvis.json) not found or invalid.\nPlease set up your API credentials.'
            }, { quoted: message });
            return;
        }

        // Check if API key is configured
        if (!config.api_key || config.api_key === 'your_openai_compatible_api_key_here') {
            await sock.sendMessage(chatId, {
                text: '❌ Error: Please configure your API key in jarvis.json file.\n\nCurrent configuration:\n' + 
                      JSON.stringify(config, null, 2)
            }, { quoted: message });
            return;
        }

        // Get the actual message text
        let userMessage = text.trim();
        
        // If no text provided, check if replying to a message
        if (!userMessage) {
            const quotedMessage = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            if (quotedMessage) {
                // Extract text from quoted message
                userMessage = quotedMessage.conversation?.trim() || 
                             quotedMessage.extendedTextMessage?.text?.trim() ||
                             quotedMessage.imageMessage?.caption?.trim() ||
                             quotedMessage.videoMessage?.caption?.trim() || '';
                
                if (userMessage) {
                    userMessage += '\n\n[Replying to your previous message]';
                } else {
                    await sock.sendMessage(chatId, {
                        text: '⚠️ Please provide a question or reply to a message.\n\nExample: .jarvis What is the capital of France?'
                    }, { quoted: message });
                    return;
                }
            } else {
                await sock.sendMessage(chatId, {
                    text: '⚠️ Please provide a question or reply to a message.\n\nExample: .jarvis What is the capital of France?'
                }, { quoted: message });
                return;
            }
        }

        // Show typing indicator
        await sock.sendPresenceUpdate('composing', chatId);

        // Prepare the request for OpenAI compatible API
        const requestData = {
            model: config.model || 'gpt-4o-mini',
            messages: [
                {
                    role: "system",
                    content: "You are Jarvis, a helpful AI assistant. Provide concise and accurate responses."
                },
                {
                    role: "user",
                    content: userMessage
                }
            ],
            max_tokens: config.max_tokens || 2048,
            temperature: config.temperature || 0.7
        };

        // Call the API
        const response = await axios.post(config.api_url, requestData, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.api_key}`
            },
            timeout: 60000
        });

        // Get the AI response
        const aiResponse = response.data.choices[0].message.content;

        // Send the response
        await sock.sendMessage(chatId, {
            text: `🤖 *Jarvis Response:*\n\n${aiResponse}`,
            contextInfo: {
                forwardingScore: 1,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363161513685998@newsletter',
                    newsletterName: 'Night Hunter MD',
                    serverMessageId: -1
                }
            }
        }, { quoted: message });

    } catch (error) {
        console.error('Jarvis command error:', error);
        
        let errorMessage = '❌ Error processing your request:\n';
        
        if (error.response) {
            // The request was made and the server responded with a status code
            // that falls out of the range of 2xx
            errorMessage += `Server responded with status: ${error.response.status}\n`;
            errorMessage += `Response: ${JSON.stringify(error.response.data, null, 2)}`;
        } else if (error.request) {
            // The request was made but no response was received
            errorMessage += 'No response received from the API. Please check your connection.';
        } else {
            // Something else happened
            errorMessage += error.message || 'Unknown error occurred';
        }

        await sock.sendMessage(chatId, {
            text: errorMessage,
            contextInfo: {
                forwardingScore: 1,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363161513685998@newsletter',
                    newsletterName: 'Night Hunter MD',
                    serverMessageId: -1
                }
            }
        }, { quoted: message });
    }
}

module.exports = jarvisCommand;