const axios = require('axios');
const { fetchBuffer } = require('../lib/myfunc');

// The flux model backing Pollinations barely understands non-English
// prompts (e.g. Indonesian "paus" - whale - renders as an unrelated
// portrait), so translate to English first. Google's unofficial endpoint
// auto-detects the source language and is a no-op for already-English text.
async function translateToEnglish(text) {
    try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=${encodeURIComponent(text)}`;
        const res = await axios.get(url, { timeout: 10000 });
        if (res.data && res.data[0]) {
            return res.data[0].map(seg => seg[0]).join('');
        }
    } catch (err) {
        console.error('imagine translateToEnglish error:', err.message);
    }
    return text;
}

async function imagineCommand(sock, chatId, message) {
    try {
        // Get the prompt from the message
        const prompt = message.message?.conversation?.trim() ||
                      message.message?.extendedTextMessage?.text?.trim() || '';

        // Strip the command word (.imagine/.flux/.dalle all route here - they
        // differ in length, so cut at the first space rather than a fixed
        // offset, which used to chop real prompt text off .flux/.dalle).
        const imagePrompt = prompt.split(' ').slice(1).join(' ').trim();
        
        if (!imagePrompt) {
            await sock.sendMessage(chatId, {
                text: 'Please provide a prompt for the image generation.\nExample: .imagine a beautiful sunset over mountains'
            }, {
                quoted: message
            });
            return;
        }

        // Send processing message
        await sock.sendMessage(chatId, {
            text: '🎨 Generating your image... Please wait.'
        }, {
            quoted: message
        });

        // Enhance the prompt with quality keywords
        const englishPrompt = await translateToEnglish(imagePrompt);
        const enhancedPrompt = enhancePrompt(englishPrompt);

        // Make API request
        const seed = Math.floor(Math.random() * 1000000);
        const response = await axios.get(`https://image.pollinations.ai/prompt/${encodeURIComponent(enhancedPrompt)}?width=1024&height=1024&model=flux&nologo=true&seed=${seed}`, {
            responseType: 'arraybuffer',
            timeout: 60000
        });

        // Convert response to buffer
        const imageBuffer = Buffer.from(response.data);

        // Send the generated image
        await sock.sendMessage(chatId, {
            image: imageBuffer,
            caption: `🎨 Generated image for prompt: "${imagePrompt}"`
        }, {
            quoted: message
        });

    } catch (error) {
        console.error('Error in imagine command:', error);
        await sock.sendMessage(chatId, {
            text: '❌ Failed to generate image. Please try again later.'
        }, {
            quoted: message
        });
    }
}

// Function to enhance the prompt
function enhancePrompt(prompt) {
    // Quality enhancing keywords
    const qualityEnhancers = [
        'high quality',
        'detailed',
        'masterpiece',
        'best quality',
        'ultra realistic',
        '4k',
        'highly detailed',
        'professional photography',
        'cinematic lighting',
        'sharp focus'
    ];

    // Randomly select 3-4 enhancers
    const numEnhancers = Math.floor(Math.random() * 2) + 3; // Random number between 3-4
    const selectedEnhancers = qualityEnhancers
        .sort(() => Math.random() - 0.5)
        .slice(0, numEnhancers);

    // Combine original prompt with enhancers
    return `${prompt}, ${selectedEnhancers.join(', ')}`;
}

module.exports = imagineCommand; 