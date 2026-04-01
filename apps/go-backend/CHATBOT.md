# AI Chatbot Integration

The Growman platform includes an AI-powered chatbot that helps users with plant care advice and recommends products from the store.

## Features

- **Plant Care Advice**: Answers questions about watering, lighting, soil, fertilizing, and general plant care
- **Product Recommendations**: Automatically suggests relevant products based on conversation context
- **Conversation History**: Maintains context across multiple messages
- **Fallback Mode**: Works even without AI API key using keyword-based responses

## Setup

### Option 1: Using Google Gemini (Recommended - Free Tier Available)

1. Get Gemini API Key:
   - Visit [Google AI Studio](https://makersuite.google.com/app/apikey)
   - Sign in with your Google account
   - Click "Create API Key"
   - Copy the API key

2. Configure Environment Variables:

```env
# Google Gemini API key for chatbot functionality
GEMINI_API_KEY=your-gemini-api-key-here

# AI Provider: "gemini" (or "openai")
AI_PROVIDER=gemini
```

### Option 2: Using OpenAI

1. Get OpenAI API Key:
   - Sign up at [OpenAI Platform](https://platform.openai.com/)
   - Navigate to [API Keys](https://platform.openai.com/api-keys)
   - Create a new API key
   - Copy the key (starts with `sk-`)

2. Configure Environment Variables:

```env
# OpenAI API key for chatbot functionality
OPENAI_API_KEY=sk-your-actual-api-key-here

# AI Provider: "openai" (or "gemini")
AI_PROVIDER=openai
```

### 3. Restart Backend

After adding the API key, restart your backend server:

```bash
cd apps/go-backend
pnpm dev
```

## How It Works

### Frontend Component

The chatbot appears as a floating button in the bottom-right corner of all pages. Users can:
- Click to open/close the chat window
- Type questions about plants and gardening
- Receive AI-powered responses
- See product recommendations when relevant
- Click on recommended products to view details

### Backend Handler

The `/api/v1/chat` endpoint:
1. Receives user messages and conversation history
2. Builds a system prompt with product context
3. Calls AI API (Gemini or OpenAI based on configuration, or uses fallback if no key)
4. Extracts product recommendations based on keywords
5. Returns AI response with recommended products

### Product Recommendations

The system automatically recommends products when:
- User asks about specific plant care needs (watering, lighting, etc.)
- Keywords match product names, descriptions, or tags
- Conversation context suggests relevant products

If no specific matches, it shows featured products.

## API Endpoint

### POST `/api/v1/chat`

**Request Body:**
```json
{
  "message": "How often should I water my indoor plants?",
  "conversationHistory": [
    {
      "role": "user",
      "content": "Hello"
    },
    {
      "role": "assistant",
      "content": "Hello! How can I help you today?"
    }
  ]
}
```

**Response:**
```json
{
  "response": "Watering frequency depends on the plant type...",
  "recommendedProducts": [
    {
      "id": 1,
      "name": "Moisture Meter",
      "slug": "moisture-meter",
      "price": 299.00,
      "imageUrl": "https://..."
    }
  ]
}
```

## Fallback Mode

If `OPENAI_API_KEY` is not set, the chatbot uses a keyword-based fallback system that:
- Provides basic plant care advice
- Matches common questions to helpful responses
- Still recommends products based on keywords

## Customization

### System Prompt

Edit `buildSystemPrompt()` in `internal/handlers/chat.go` to customize:
- Bot personality
- Product information included
- Response style

### Product Matching

Modify `extractProductRecommendations()` to:
- Change keyword matching logic
- Adjust number of recommendations (currently 3)
- Add custom matching rules

### AI Model

**For Gemini:**
- `gemini-1.5-flash` (default, free tier, fast)
- `gemini-1.5-pro` (more capable, may require paid tier)
- Change in `callGeminiAPI()` function

**For OpenAI:**
- `gpt-3.5-turbo` (default, cheaper)
- `gpt-4` (more accurate, more expensive)
- `gpt-4-turbo` (balanced)
- Change in `callOpenAIAPI()` function

## Cost Considerations

### Gemini API (Recommended)
- **Free Tier**: 15 requests per minute, 1,500 requests per day
- **Paid Tier**: Very affordable, pay-as-you-go pricing
- Gemini 1.5 Flash is free for most use cases
- Each chat message uses approximately 200-500 tokens

### OpenAI API
- GPT-3.5-turbo: ~$0.0015 per 1K tokens
- GPT-4: ~$0.03 per 1K tokens
- Each chat message uses approximately 200-500 tokens, so:
  - 1,000 messages ≈ $0.15-$0.75 (GPT-3.5)
  - 1,000 messages ≈ $3-$7.50 (GPT-4)

**Recommendations:**
- Start with Gemini (free tier available)
- Consider implementing:
  - Rate limiting per user
  - Conversation length limits
  - Caching for common questions

## Troubleshooting

### Chatbot not appearing
- Check that `PlantChatbot` is imported in `app/layout.tsx`
- Verify no console errors in browser

### "Failed to get AI response" error
- **For Gemini**: Verify `GEMINI_API_KEY` is set correctly
- **For OpenAI**: Verify `OPENAI_API_KEY` is set correctly
- Check API key has sufficient credits/quota
- Check network connectivity to the API provider
- Verify `AI_PROVIDER` matches the API key you're using

### No product recommendations
- Ensure products exist in database
- Check product status is "active"
- Verify image URLs are resolving correctly

## Future Enhancements

Potential improvements:
- [ ] Support for Anthropic Claude API
- [ ] Conversation persistence (store in database)
- [ ] Multi-language support
- [ ] Voice input/output
- [ ] Image recognition for plant identification
- [ ] Personalized recommendations based on user history
- [ ] Integration with order history for better recommendations

