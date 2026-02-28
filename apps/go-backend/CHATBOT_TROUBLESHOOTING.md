# Chatbot Troubleshooting Guide

## Common Errors and Solutions

### "I'm sorry, I encountered an error. Please try again later."

This error can occur for several reasons:

#### 1. **Missing or Invalid API Key**

**Symptoms:**
- Error message appears immediately
- Check backend logs for "API key not configured"

**Solution:**
1. Verify your `.env` file has the correct API key:
   ```env
   GEMINI_API_KEY=your-actual-api-key-here
   AI_PROVIDER=gemini
   ```

2. Get a new API key:
   - Visit https://makersuite.google.com/app/apikey
   - Create a new API key
   - Copy and paste it into your `.env` file

3. Restart your backend server:
   ```bash
   cd apps/go-backend
   pnpm dev
   ```

#### 2. **Invalid API Key Format**

**Symptoms:**
- Error in backend logs: "Gemini API error (status 400)"
- Error message: "API key not valid"

**Solution:**
- Ensure the API key doesn't have extra spaces or quotes
- Remove any `"` or `'` around the key in `.env`
- The key should be a long string without spaces

#### 3. **API Quota Exceeded**

**Symptoms:**
- Error in backend logs: "Gemini API error (status 429)"
- Error message about rate limits

**Solution:**
- Check your Google Cloud Console for quota limits
- Wait a few minutes and try again
- Consider upgrading your API quota if needed

#### 4. **Network/Connection Issues**

**Symptoms:**
- Error: "failed to make request"
- Timeout errors

**Solution:**
- Check your internet connection
- Verify firewall isn't blocking requests to `generativelanguage.googleapis.com`
- Try again after a few seconds

#### 5. **Backend Not Running**

**Symptoms:**
- Error: "Failed to fetch" or network error
- No response from server

**Solution:**
1. Check if backend is running:
   ```bash
   cd apps/go-backend
   pnpm dev
   ```

2. Verify backend is accessible:
   ```bash
   curl http://localhost:8080/healthz
   ```

3. Check backend logs for errors

## Debugging Steps

### 1. Check Backend Logs

Look for log messages starting with `[CHAT]`:
```bash
# If running with pnpm dev, logs appear in terminal
# Look for messages like:
[CHAT] Using AI provider: gemini
[CHAT] Gemini API error (status 400): ...
```

### 2. Test API Key Directly

Test your Gemini API key with curl:
```bash
curl "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent" \
  -H 'Content-Type: application/json' \
  -H 'X-goog-api-key: YOUR_API_KEY' \
  -X POST \
  -d '{
    "contents": [{
      "parts": [{"text": "Hello"}]
    }]
  }'
```

If this fails, your API key is invalid.

### 3. Check Environment Variables

Verify your `.env` file is being loaded:
```bash
cd apps/go-backend
# Check if variables are loaded
grep GEMINI_API_KEY .env
```

### 4. Test Fallback Mode

If API key is not set, the chatbot should use fallback mode:
- Try asking: "How do I water plants?"
- You should get a keyword-based response
- This confirms the backend is working

## Common Error Messages

### "AI service error: failed to make request"
- **Cause**: Network issue or API endpoint unreachable
- **Fix**: Check internet connection, verify API endpoint URL

### "failed to unmarshal response"
- **Cause**: API returned unexpected format
- **Fix**: Check backend logs for full error, may indicate API changes

### "Gemini API returned no candidates"
- **Cause**: API request succeeded but no response generated
- **Fix**: Check if request content is valid, try simpler message

### "No API keys configured"
- **Cause**: Neither GEMINI_API_KEY nor OPENAI_API_KEY is set
- **Fix**: Add API key to `.env` file

## Testing the Chatbot

### 1. Test with Simple Message
```
User: "Hello"
Expected: Greeting response
```

### 2. Test Plant Care Question
```
User: "How often should I water my plants?"
Expected: Advice about watering + product recommendations
```

### 3. Check Browser Console
- Open browser DevTools (F12)
- Go to Console tab
- Look for error messages
- Check Network tab for failed requests

## Getting Help

If issues persist:

1. **Check Backend Logs**: Look for `[CHAT]` prefixed messages
2. **Check Browser Console**: Look for JavaScript errors
3. **Verify API Key**: Test with curl command above
4. **Check Network**: Ensure backend is accessible
5. **Try Fallback Mode**: Remove API key to test basic functionality

## Quick Fixes

### Reset Everything
```bash
# Stop backend
# Remove API key from .env (to test fallback)
# Restart backend
cd apps/go-backend
pnpm dev
```

### Use Fallback Mode
If API keeps failing, you can use fallback mode:
1. Remove or comment out `GEMINI_API_KEY` in `.env`
2. Restart backend
3. Chatbot will use keyword-based responses

### Switch to OpenAI
If Gemini doesn't work, try OpenAI:
```env
OPENAI_API_KEY=sk-your-key-here
AI_PROVIDER=openai
```

