# 🔧 How to Configure .jarvis Command

## ⚠️ IMPORTANT: You Need Valid API Credentials!

The error you're seeing means you're using placeholder values. You must configure real API credentials in `jarvis.json`.

---

## Step 1: Get an API Key and URL

### Option A: OpenRouter (Recommended - Free tier available)
1. Go to https://openrouter.ai
2. Sign up for free account
3. Create API key
4. Use settings:
   ```json
   {
     "api_key": "your_openrouter_api_key_here",
     "api_url": "https://openrouter.ai/api/v1/chat/completions",
     "model": "gpt-4o-mini",
     "max_tokens": 2048,
     "temperature": 0.7
   }
   ```

### Option B: Groq (Free - Fast inference)
1. Go to https://groq.com
2. Sign up for free API key
3. Use settings:
   ```json
   {
     "api_key": "your_groq_api_key_here",
     "api_url": "https://api.groq.com/openai/v1/chat/completions",
     "model": "llama3-70b-8192",
     "max_tokens": 2048,
     "temperature": 0.7
   }
   ```

### Option C: Together AI (Free tier)
1. Go to https://together.ai
2. Sign up for API key
3. Use settings:
   ```json
   {
     "api_key": "your_together_api_key_here",
     "api_url": "https://api.together.xyz/v1/chat/completions",
     "model": "meta-llama/Llama-3-8b-chat-hf",
     "max_tokens": 2048,
     "temperature": 0.7
   }
   ```

### Option D: HuggingFace Inference API
1. Go to https://huggingface.co/settings/tokens
2. Create API token
3. Use settings:
   ```json
   {
     "api_key": "hf_your_huggingface_token_here",
     "api_url": "https://api-inference.huggingface.co/models/meta-llama/Meta-Llama-3-8B-Instruct/v1/chat/completions",
     "model": "meta-llama/Meta-Llama-3-8B-Instruct",
     "max_tokens": 2048,
     "temperature": 0.7
   }
   ```

---

## Step 2: Edit jarvis.json

1. Open `jarvis.json` file
2. Replace the empty strings with your actual credentials:

```json
{
  "api_key": "sk-or-v1-xxxxxxxxxxxxxxxxxxxxxxxxxxxxx",  // Your API key here
  "api_url": "https://openrouter.ai/api/v1/chat/completions",
  "model": "gpt-4o-mini",
  "max_tokens": 2048,
  "temperature": 0.7
}
```

**⚠️ NEVER commit your real API key to GitHub!** Add it to `.gitignore`:
```bash
echo "jarvis.json" >> .gitignore
```

Then re-add jarvis.json without the sensitive data:
```bash
git rm --cached jarvis.json
echo "See JARVIS_CONFIG.md for setup instructions" > jarvis.json.example
```

---

## Step 3: Restart the Bot

After updating `jarvis.json`, restart your bot:

```bash
npm start
```

---

## Testing

Once configured, test with:

```bash
.jarvis Hello, who are you?
```

You should get a response from the AI! ✅

---

## Troubleshooting

### Error 500 / "invalid character"
- ❌ Still using placeholder values
- ✅ Solution: Replace with real API credentials (see above)

### Error 401 / Authentication Failed
- ❌ Invalid or expired API key
- ✅ Solution: Regenerate API key from provider

### Error 429 / Rate Limited
- ❌ Too many requests
- ✅ Solution: Wait or upgrade plan

### No Response / Connection Timeout
- ❌ Wrong API URL or offline service
- ✅ Solution: Verify API URL is correct for your provider

---

## Supported AI Providers

Any OpenAI-compatible API should work! Popular options:
- ✅ OpenRouter (multi-model, free tier)
- ✅ Groq (fast, free)
- ✅ Together AI (free tier)
- ✅ HuggingFace
- ✅ Azure OpenAI
- ✅ DeepSeek
- ✅ Anyscale
- ✅ And many more...

Just ensure they support:
- Standard OpenAI chat completion format
- `/v1/chat/completions` endpoint (or adjust api_url accordingly)
