package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"strings"

	"github.com/venkatesh2100/growman/apps/go-backend/internal/models"
	"github.com/venkatesh2100/growman/apps/go-backend/pkg/httpjson"
)

type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type ChatRequest struct {
	Message             string        `json:"message"`
	ConversationHistory []ChatMessage `json:"conversationHistory"`
}

type ChatResponse struct {
	Response            string                  `json:"response"`
	RecommendedProducts []ProductRecommendation `json:"recommendedProducts,omitempty"`
}

type ProductRecommendation struct {
	ID       uint    `json:"id"`
	Name     string  `json:"name"`
	Slug     string  `json:"slug"`
	Price    float64 `json:"price"`
	ImageURL string  `json:"imageUrl,omitempty"`
}

type OpenAIRequest struct {
	Model       string        `json:"model"`
	Messages    []ChatMessage `json:"messages"`
	MaxTokens   int           `json:"max_tokens,omitempty"`
	Temperature float64       `json:"temperature,omitempty"`
}

type OpenAIResponse struct {
	Choices []struct {
		Message struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
	Error struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

type GeminiRequest struct {
	Contents         []GeminiContent `json:"contents"`
	GenerationConfig struct {
		Temperature     float64 `json:"temperature,omitempty"`
		MaxOutputTokens int     `json:"maxOutputTokens,omitempty"`
	} `json:"generationConfig,omitempty"`
}

type GeminiContent struct {
	Parts []GeminiPart `json:"parts"`
	Role  string       `json:"role,omitempty"`
}

type GeminiPart struct {
	Text string `json:"text"`
}

type GeminiResponse struct {
	Candidates []struct {
		Content struct {
			Parts []GeminiPart `json:"parts"`
		} `json:"content"`
	} `json:"candidates"`
	Error struct {
		Message string `json:"message"`
		Code    int    `json:"code"`
	} `json:"error,omitempty"`
}

// Chat handles AI chat requests and product recommendations
func (h *Handler) Chat(w http.ResponseWriter, r *http.Request) {
	var req ChatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Message == "" {
		httpjson.Error(w, http.StatusBadRequest, "message is required")
		return
	}

	// Build system prompt with product context
	systemPrompt := h.buildSystemPrompt()

	// Prepare messages for AI
	messages := []ChatMessage{
		{Role: "system", Content: systemPrompt},
	}

	// Add conversation history
	if len(req.ConversationHistory) > 0 {
		// Keep last 10 messages to avoid token limits
		start := 0
		if len(req.ConversationHistory) > 10 {
			start = len(req.ConversationHistory) - 10
		}
		messages = append(messages, req.ConversationHistory[start:]...)
	}

	// Add current message
	messages = append(messages, ChatMessage{
		Role:    "user",
		Content: req.Message,
	})

	// Get AI response (pass system prompt separately for Gemini)
	aiResponse, err := h.callAI(messages, systemPrompt)
	if err != nil {
		log.Printf("[CHAT] Error calling AI: %v", err)
		// Return a more helpful error message
		httpjson.Error(w, http.StatusInternalServerError, fmt.Sprintf("AI service error: %v", err))
		return
	}

	// Ensure we have a response
	if aiResponse == "" {
		log.Printf("[CHAT] Empty AI response received")
		aiResponse = h.getFallbackResponse(req.Message)
	}

	// Extract product recommendations from the conversation
	recommendedProducts := h.extractProductRecommendations(req.Message, aiResponse)
	h.maybeAutoCreateRequestedProduct(req.Message, aiResponse, recommendedProducts)

	// Resolve image URLs for recommended products
	for i := range recommendedProducts {
		if recommendedProducts[i].ImageURL == "" {
			var product models.Product
			if err := h.DB.Select("image_key").Where("id = ?", recommendedProducts[i].ID).First(&product).Error; err == nil {
				recommendedProducts[i].ImageURL = h.ImageService.ResolveImageURL(product.ImageKey)
			}
		}
	}

	response := ChatResponse{
		Response:            aiResponse,
		RecommendedProducts: recommendedProducts,
	}

	httpjson.JSON(w, http.StatusOK, response)
}

// buildSystemPrompt creates a system prompt with product knowledge
func (h *Handler) buildSystemPrompt() string {
	// Get sample products for context
	var sampleProducts []models.Product
	h.DB.Select("name, description, tags, category_id").Limit(20).Find(&sampleProducts)

	productList := ""
	for _, p := range sampleProducts {
		productList += fmt.Sprintf("- %s: %s\n", p.Name, p.Description)
	}

	return fmt.Sprintf(`You are a helpful plant care assistant for an e-commerce store called Growman.

CRITICAL: Your responses MUST be concise and limited to approximately 100 words maximum. Be precise, focused, and direct. Do not exceed 100 words.

Your role is to:
1. Provide expert advice on plant care, growing tips, and gardening
2. Answer questions about plants, soil, watering, lighting, and plant health
3. Recommend products from the store when relevant to the user's needs
4. Be friendly, knowledgeable, and helpful

Keep responses brief, actionable, and to the point. Focus on the most essential information.
For support requests (delivery issues, delays, refunds, escalations), always share Growman support details:
- Email: growman.live@gmail.com
- Website: https://growman.live/

When recommending products, mention specific product names naturally in your response.
The store sells plants, seeds, planters, gardening tools, and accessories.

Available products include (sample):
%s

Always provide practical, actionable advice. If the user asks about a specific plant or gardening need,
suggest relevant products from the store that could help them.`, productList)
}

// callAI calls the AI API (OpenAI, Gemini, or other providers)
func (h *Handler) callAI(messages []ChatMessage, systemPrompt string) (string, error) {
	provider := strings.ToLower(h.Cfg.AIProvider)

	// Log which provider is being used
	log.Printf("[CHAT] Using AI provider: %s", provider)

	switch provider {
	case "gemini":
		if h.Cfg.GeminiAPIKey == "" {
			log.Printf("[CHAT] Gemini API key not configured, using fallback")
			return h.getFallbackResponse(messages[len(messages)-1].Content), nil
		}
		return h.callGeminiAPI(messages, systemPrompt)
	case "openai":
		if h.Cfg.OpenAIAPIKey == "" {
			log.Printf("[CHAT] OpenAI API key not configured, using fallback")
			return h.getFallbackResponse(messages[len(messages)-1].Content), nil
		}
		return h.callOpenAIAPI(messages)
	default:
		// Try to auto-detect based on available API keys
		if h.Cfg.GeminiAPIKey != "" {
			log.Printf("[CHAT] Auto-detected Gemini API key")
			return h.callGeminiAPI(messages, systemPrompt)
		}
		if h.Cfg.OpenAIAPIKey != "" {
			log.Printf("[CHAT] Auto-detected OpenAI API key")
			return h.callOpenAIAPI(messages)
		}
		// Fallback response if no API key is configured
		log.Printf("[CHAT] No API keys configured, using fallback response")
		return h.getFallbackResponse(messages[len(messages)-1].Content), nil
	}
}

// callOpenAIAPI calls the OpenAI API
func (h *Handler) callOpenAIAPI(messages []ChatMessage) (string, error) {
	if h.Cfg.OpenAIAPIKey == "" {
		return h.getFallbackResponse(messages[len(messages)-1].Content), nil
	}

	apiURL := "https://api.openai.com/v1/chat/completions"

	requestBody := OpenAIRequest{
		Model:       "gpt-3.5-turbo",
		Messages:    messages,
		MaxTokens:   500,
		Temperature: 0.5,
	}

	jsonData, err := json.Marshal(requestBody)
	if err != nil {
		return "", fmt.Errorf("failed to marshal request: %w", err)
	}

	req, err := http.NewRequest("POST", apiURL, bytes.NewBuffer(jsonData))
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", h.Cfg.OpenAIAPIKey))

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to make request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		log.Printf("[CHAT] OpenAI API error: %s", string(body))
		return h.getFallbackResponse(messages[len(messages)-1].Content), nil
	}

	var openAIResp OpenAIResponse
	if err := json.Unmarshal(body, &openAIResp); err != nil {
		return "", fmt.Errorf("failed to unmarshal response: %w", err)
	}

	if len(openAIResp.Choices) == 0 {
		return h.getFallbackResponse(messages[len(messages)-1].Content), nil
	}

	return openAIResp.Choices[0].Message.Content, nil
}

// callGeminiAPI calls the Google Gemini API
func (h *Handler) callGeminiAPI(messages []ChatMessage, systemPrompt string) (string, error) {
	if h.Cfg.GeminiAPIKey == "" {
		return h.getFallbackResponse(messages[len(messages)-1].Content), nil
	}

	// Convert messages to Gemini format
	// Gemini uses a different message format - we need to convert from OpenAI format
	geminiContents := make([]GeminiContent, 0, len(messages))

	// Include system prompt in the first user message for Gemini
	firstUserMessage := true

	for _, msg := range messages {
		// Skip system messages in Gemini (we'll include system prompt in first user message)
		if msg.Role == "system" {
			continue
		}

		// Map roles: user -> user, assistant -> model
		role := "user"
		if msg.Role == "assistant" {
			role = "model"
		}

		// Prepend system prompt to first user message
		content := msg.Content
		if firstUserMessage && role == "user" && systemPrompt != "" {
			content = systemPrompt + "\n\n" + content
			firstUserMessage = false
		}

		geminiContents = append(geminiContents, GeminiContent{
			Parts: []GeminiPart{{Text: content}},
			Role:  role,
		})
	}

	// Build request
	requestBody := GeminiRequest{
		Contents: geminiContents,
	}
	requestBody.GenerationConfig.Temperature = 0.4
	requestBody.GenerationConfig.MaxOutputTokens = 800 // Enough for ~100 words with some buffer

	jsonData, err := json.Marshal(requestBody)
	if err != nil {
		return "", fmt.Errorf("failed to marshal request: %w", err)
	}

	// Use Gemini 1.5 Flash (free tier) or Gemini Pro
	model := "gemini-flash-latest"
	apiURL := fmt.Sprintf("https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent", model)

	req, err := http.NewRequest("POST", apiURL, bytes.NewBuffer(jsonData))
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-goog-api-key", h.Cfg.GeminiAPIKey)

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to make request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		log.Printf("[CHAT] Gemini API error (status %d): %s", resp.StatusCode, string(body))
		// Try to parse error response
		var geminiResp GeminiResponse
		if err := json.Unmarshal(body, &geminiResp); err == nil && geminiResp.Error.Message != "" {
			log.Printf("[CHAT] Gemini API error details: %s (code: %d)", geminiResp.Error.Message, geminiResp.Error.Code)
		}
		return h.getFallbackResponse(messages[len(messages)-1].Content), nil
	}

	var geminiResp GeminiResponse
	if err := json.Unmarshal(body, &geminiResp); err != nil {
		log.Printf("[CHAT] Failed to unmarshal Gemini response: %v, body: %s", err, string(body))
		return "", fmt.Errorf("failed to unmarshal response: %w", err)
	}

	// Check for API errors in response
	if geminiResp.Error.Message != "" {
		log.Printf("[CHAT] Gemini API error in response: %s (code: %d)", geminiResp.Error.Message, geminiResp.Error.Code)
		return h.getFallbackResponse(messages[len(messages)-1].Content), nil
	}

	if len(geminiResp.Candidates) == 0 {
		log.Printf("[CHAT] Gemini API returned no candidates")
		return h.getFallbackResponse(messages[len(messages)-1].Content), nil
	}

	if len(geminiResp.Candidates[0].Content.Parts) == 0 {
		log.Printf("[CHAT] Gemini API candidate has no parts")
		return h.getFallbackResponse(messages[len(messages)-1].Content), nil
	}

	responseText := geminiResp.Candidates[0].Content.Parts[0].Text
	if responseText == "" {
		log.Printf("[CHAT] Gemini API returned empty text")
		return h.getFallbackResponse(messages[len(messages)-1].Content), nil
	}

	// Truncate to ~100 words to ensure concise responses
	// responseText = h.truncateToWordLimit(responseText, 100)

	return responseText, nil
}

// truncateToWordLimit truncates text to approximately the specified word limit
// It preserves complete sentences and ensures the response doesn't exceed the limit
// func (h *Handler) truncateToWordLimit(text string, wordLimit int) string {
// 	words := strings.Fields(text)
// 	if len(words) <= wordLimit {
// 		return text
// 	}

// 	// Take first wordLimit words
// 	truncatedWords := words[:wordLimit]
// 	truncated := strings.Join(truncatedWords, " ")

// 	// Try to end at a sentence boundary if possible
// 	lastPeriod := strings.LastIndex(truncated, ".")
// 	lastExclamation := strings.LastIndex(truncated, "!")
// 	lastQuestion := strings.LastIndex(truncated, "?")

// 	lastSentenceEnd := -1
// 	if lastPeriod > lastSentenceEnd {
// 		lastSentenceEnd = lastPeriod
// 	}
// 	if lastExclamation > lastSentenceEnd {
// 		lastSentenceEnd = lastExclamation
// 	}
// 	if lastQuestion > lastSentenceEnd {
// 		lastSentenceEnd = lastQuestion
// 	}

// 	// If we found a sentence end within the last 20% of the text, use it
// 	if lastSentenceEnd > len(truncated)*4/5 {
// 		return truncated[:lastSentenceEnd+1]
// 	}

// 	// Otherwise, just add ellipsis if we truncated
// 	return truncated + "..."
// }

// getFallbackResponse provides a simple response when AI API is not available
func (h *Handler) getFallbackResponse(userMessage string) string {
	lowerMsg := strings.ToLower(userMessage)

	// Simple keyword-based responses
	if strings.Contains(lowerMsg, "water") || strings.Contains(lowerMsg, "watering") {
		return "Watering frequency depends on the plant type, season, and environment. Most houseplants need watering when the top inch of soil feels dry. Overwatering is a common issue - make sure your pots have drainage holes. Would you like me to recommend some watering tools or moisture meters from our store?"
	}
	if strings.Contains(lowerMsg, "light") || strings.Contains(lowerMsg, "sunlight") {
		return "Light requirements vary by plant. Most indoor plants prefer bright, indirect light. Avoid direct sunlight for most houseplants as it can scorch leaves. Low-light plants like snake plants and pothos can thrive in less light. We have various plants suited for different lighting conditions - would you like recommendations?"
	}
	if strings.Contains(lowerMsg, "soil") || strings.Contains(lowerMsg, "potting") {
		return "Good soil is essential for plant health. Most houseplants prefer well-draining potting mix. You can find quality potting soil and specialized mixes in our store. Different plants have different needs - succulents need sandy, well-draining soil while tropical plants prefer richer mixes."
	}
	if strings.Contains(lowerMsg, "fertilizer") || strings.Contains(lowerMsg, "fertilize") {
		return "Plants benefit from regular fertilization during growing season (spring and summer). Use a balanced fertilizer and follow package instructions. We offer organic and synthetic fertilizers suitable for different plant types."
	}

	return "I'm here to help with plant care questions! I can advise on watering, lighting, soil, fertilizing, and more. I can also recommend products from our store that might help with your gardening needs. What would you like to know?"
}

// extractProductRecommendations searches for products based on the conversation
func (h *Handler) extractProductRecommendations(userMessage, aiResponse string) []ProductRecommendation {
	lowerMsg := strings.ToLower(userMessage + " " + aiResponse)
	var products []models.Product

	// Search for relevant products based on keywords
	query := h.DB.Model(&models.Product{}).Where("status = ?", "active")

	// Keyword matching
	keywords := []string{"plant", "seed", "planter", "pot", "soil", "fertilizer", "tool", "watering", "garden"}
	var matchedProducts []models.Product

	for _, keyword := range keywords {
		if strings.Contains(lowerMsg, keyword) {
			var results []models.Product
			query.Where("name ILIKE ? OR description ILIKE ? OR tags::text ILIKE ?",
				"%"+keyword+"%", "%"+keyword+"%", "%"+keyword+"%").
				Limit(3).
				Find(&results)
			matchedProducts = append(matchedProducts, results...)
		}
	}

	// If no matches, get featured products
	if len(matchedProducts) == 0 {
		h.DB.Where("featured = ? AND status = ?", true, "active").
			Limit(3).
			Find(&products)
	} else {
		// Deduplicate
		productMap := make(map[uint]bool)
		for _, p := range matchedProducts {
			if !productMap[p.ID] && len(products) < 3 {
				products = append(products, p)
				productMap[p.ID] = true
			}
		}
	}

	// Convert to recommendations
	recommendations := make([]ProductRecommendation, 0, len(products))
	for _, p := range products {
		if len(recommendations) >= 3 {
			break
		}
		recommendations = append(recommendations, ProductRecommendation{
			ID:       p.ID,
			Name:     p.Name,
			Slug:     p.Slug,
			Price:    p.Price,
			ImageURL: h.ImageService.ResolveImageURL(p.ImageKey),
		})
	}

	return recommendations
}

func (h *Handler) maybeAutoCreateRequestedProduct(userMessage, aiResponse string, recommendations []ProductRecommendation) {
	lower := strings.ToLower(strings.TrimSpace(userMessage + " " + aiResponse))
	if lower == "" {
		return
	}

	requestSignals := []string{
		"exact product",
		"request to add",
		"add it to",
		"add this product",
		"cannot find",
		"not available",
		"out of stock",
	}

	hasSignal := false
	for _, signal := range requestSignals {
		if strings.Contains(lower, signal) {
			hasSignal = true
			break
		}
	}

	// Only auto-create when user intent is explicit and no strong recommendation exists.
	if !hasSignal || len(recommendations) > 0 {
		return
	}

	name := extractRequestedProductName(userMessage)
	if name == "" {
		name = strings.TrimSpace(userMessage)
		if len(name) > 120 {
			name = name[:120]
		}
	}

	details := strings.TrimSpace(userMessage)
	if details == "" {
		details = "Requested from chatbot conversation"
	}

	record := models.RequestedProduct{
		ProductName: name,
		Details:     details,
		Status:      "pending",
		Source:      "chatbot_auto",
	}

	if err := h.DB.Create(&record).Error; err != nil {
		log.Printf("[CHAT] Failed to auto-create requested product: %v", err)
	}
}

func extractRequestedProductName(message string) string {
	trimmed := strings.TrimSpace(message)
	if trimmed == "" {
		return ""
	}

	quoted := regexp.MustCompile(`"([^"]+)"`)
	matches := quoted.FindStringSubmatch(trimmed)
	if len(matches) > 1 {
		return strings.TrimSpace(matches[1])
	}

	patterns := []string{
		"looking for",
		"need",
		"want",
		"find",
	}

	lower := strings.ToLower(trimmed)
	for _, p := range patterns {
		idx := strings.Index(lower, p)
		if idx >= 0 {
			candidate := strings.TrimSpace(trimmed[idx+len(p):])
			candidate = strings.Trim(candidate, " .,:;!?")
			if candidate != "" {
				if len(candidate) > 120 {
					return candidate[:120]
				}
				return candidate
			}
		}
	}

	if len(trimmed) > 120 {
		return trimmed[:120]
	}
	return trimmed
}
