# Jarvis Command - AI Assistant Integration

## Overview
The .jarvis command integrates an OpenAI-compatible API with your WhatsApp bot, allowing you to ask questions and get intelligent responses powered by AI.

## Configuration

### Step 1: Edit jarvis.json
Open the jarvis.json file and configure your API credentials:

{
  "api_key": "your_actual_api_key_here",
  "api_url": "https://your-api-url.com/v1/chat/completions",
  "model": "gpt-4o-mini",
  "max_tokens": 2048,
  "temperature": 0.7
}

**Configuration Options:**
- api_key: Your API authentication key (required)
- api_url: The endpoint URL for the compatible API
- model: The AI model to use (e.g., gpt-4o-mini, claude-3, etc.)
- max_tokens: Maximum response length in tokens
- temperature: Response creativity (0.0 to 1.0, higher = more creative)

### Step 2: Restart the Bot
After updating the configuration, restart your bot to load the new settings.

## Usage

### Basic Usage
.jarvis What is the capital of France?

### Reply to Messages
You can also reply to any message or photo with .jarvis:

1. Send a message or photo
2. Reply to it with .jarvis followed by your question
3. The AI will respond to your query about that content

### Examples

**Simple Questions:**
.jarvis Who invented the telephone?
.jarvis What's the weather like today in Jakarta?
.jarvis Explain quantum physics in simple terms

**Complex Queries:**
.jarvis Write a poem about artificial intelligence
.jarvis Create a business plan for a coffee shop
.jarvis Help me solve this math problem: 2x + 5 = 15

## Features

+ Intelligent Responses: Get accurate answers to your questions
+ Flexible Input: Use text queries or reply to existing messages
+ Customizable: Adjust API parameters in jarvis.json
+ Error Handling: Graceful error messages if API fails
+ Context Aware: Can reference previously sent content

## Troubleshooting

### Error: "Configuration file not found"
- Make sure jarvis.json exists in the root directory
- Check that the JSON syntax is valid

### Error: "API key not configured"
- Edit jarvis.json and replace the placeholder API key with your actual key

### No Response from AI
- Check your internet connection
- Verify the API URL is correct
- Ensure your API key has sufficient credits/quota