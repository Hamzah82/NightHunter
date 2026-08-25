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
        if (!config.api_key || !config.api_url || 
            config.api_key.includes('your_') || 
            config.api_key === '' ||
            config.api_url.includes('your-')) {
            await sock.sendMessage(chatId, {
                text: '❌ **Configuration Required**\n\nPlease set up your API credentials in `jarvis.json`:\n\n' +
                      '- Replace `"api_key"` with your real API key (from OpenRouter, Groq, etc.)\n' +
                      '- Replace `"api_url"` with your actual API endpoint URL\n\n' +
                      '*Example configuration for OpenRouter:*' +
                      '```json\n{\n  "api_key": "sk-or-v1-xxxxxxxx..."\n  "api_url": "https://openrouter.ai/api/v1/chat/completions"\n}\n```\n\n📚 See JARVIS_SETUP_GUIDE.md for detailed instructions.\n\nCurrent settings:\n' +
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
        
        let errorMessage = '❌ Error processing your request:\n\n';
        
        if (error.response) {
            // Server returned error
            const statusCode = error.response.status;
            
            if (statusCode === 401 || statusCode === 403) {
                errorMessage += `⚠️ **Authentication Failed**\n`;
                errorMessage += `\nThe API rejected your credentials.\n`;
                errorMessage += `\nPlease check your \`jarvis.json\` file:\n`;
                errorMessage += `- Ensure \`api_key\` is correctly set\n`;
                errorMessage += `- Verify you're using the right API endpoint`;
            } else if (statusCode === 500) {
                errorMessage += `🔧 **Server Error**\n`;
                errorMessage += `\nAPI server responded with status 500.\n`;
                errorMessage += `\nPossible causes:\n`;
                errorMessage += `- Invalid API endpoint URL\n`;
                errorMessage += `- Malformed request data\n`;
                errorMessage += `- API service temporarily unavailable\n`;
                
                // Check if it's a JSON parsing error from response
                try {
                    const responseData = error.response.data;
                    if (typeof responseData === 'string' && 
                        (responseData.includes('<html') || responseData.includes('<!DOCTYPE'))) {
                        errorMessage += `\n⚠️ Note: Received HTML instead of JSON response.\n`;
                        errorMessage += `This usually means the API URL is incorrect or not pointing to an OpenAI-compatible endpoint.`;
                    }
                } catch (e) {
                    // ignore
                }
            } else if (statusCode === 429) {
                errorMessage += `📊 **Rate Limited**\n`;
                errorMessage += `\nToo many requests. Please wait before trying again.`;
            } else {
                errorMessage += `Status: ${statusCode}\n`;
                try {
                    if (error.response.data && typeof error.response.data === 'object') {
                        errorMessage += `\nDetails: ${JSON.stringify(error.response.data, null, 2)}`;
                    } else {
                        errorMessage += `\nResponse: ${error.response.data}`;
                    }
                } catch (e) {
                    errorMessage += `\nUnable to parse error response`;
                }
            }
        } else if (error.request) {
            errorMessage += `🌐 **No Response**\n`;
            errorMessage += `\nCould not reach the API server.\n`;
            errorMessage += `\nCheck:\n`;
            errorMessage += `- Your internet connection\n`;
            errorMessage += `- API server is online\n`;
            errorMessage += `- Firewall/VPN settings`;
        } else if (error.code === 'ECONNREFUSED') {
            errorMessage += `🔌 **Connection Refused**\n`;
            errorMessage += `\nThe API server refused the connection.\n`;
            errorMessage += `\nVerify that:\n`;
            errorMessage += `- The API_URL in \`jarvis.json\` is correct\n`;
            errorMessage += `- The port number (if specified) is correct\n`;
        } else {
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