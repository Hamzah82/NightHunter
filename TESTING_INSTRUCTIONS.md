# Testing Instructions for .jarvis Command

## Manual Test Steps

1. **Test Configuration Loading:**
   - Run: .jarvis without proper configuration
   - Expected: Error message about missing API key
   
2. **Test Basic Query:**
   - With valid config, send: .jarvis Hello, how are you?
   - Expected: AI response greeting back

3. **Test Question Answering:**
   - Send: .jarvis What is 2 + 2?
   - Expected: Correct answer from AI

4. **Test Reply Functionality:**
   - Send any message (e.g., "This is my text")
   - Reply with: .jarvis What did I just say?
   - Expected: AI references your previous message

## Quick Syntax Check

```bash
# Verify jarvis.json is valid JSON
node -e "console.log(JSON.parse(require('fs').readFileSync('./jarvis.json')))"

# Verify commands/jarvis.js can be loaded
node -e "require('./commands/jarvis')"
```

If both commands run without errors, the implementation is correct!