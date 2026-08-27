package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	appauth "github.com/venkatesh2100/growman/apps/go-backend/internal/auth"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/models"
	"github.com/venkatesh2100/growman/apps/go-backend/pkg/httpjson"
	"gorm.io/gorm"
)

type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type ChatRequest struct {
	Message             string        `json:"message"`
	ConversationHistory []ChatMessage `json:"conversationHistory"`
	Token               string        `json:"token,omitempty"` // fallback when Authorization header is missing
}

type ChatResponse struct {
	Response            string                  `json:"response"`
	RecommendedProducts []ProductRecommendation `json:"recommendedProducts,omitempty"`
	Orders              []OrderChatCard         `json:"orders,omitempty"`
}

type OrderChatCard struct {
	ID                   uint    `json:"id"`
	Status               string  `json:"status"`
	Amount               float64 `json:"amount"`
	CreatedAt            string  `json:"createdAt"`
	ExpectedDeliveryDate string  `json:"expectedDeliveryDate,omitempty"`
	ItemCount            int     `json:"itemCount"`
	ItemPreview          string  `json:"itemPreview"`
	ImageURL             string  `json:"imageUrl,omitempty"`
}

type accountChatResult struct {
	ok       bool
	text     string
	products []ProductRecommendation
	orders   []OrderChatCard
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
	SystemInstruction *GeminiContent  `json:"systemInstruction,omitempty"`
	Contents          []GeminiContent `json:"contents"`
	GenerationConfig  struct {
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

	claims, loggedIn := h.optionalClaimsFromRequest(r, req.Token)

	// Order delivery/support escalation — create priority ticket for admin
	if detectOrderSupportIntent(req.Message) {
		var claimsPtr *appauth.Claims
		if loggedIn {
			claimsPtr = claims
		}
		result := h.handleOrderSupportChat(req.Message, claimsPtr, loggedIn)
		httpjson.JSON(w, http.StatusOK, ChatResponse{
			Response:            result.text,
			RecommendedProducts: result.products,
			Orders:              result.orders,
		})
		return
	}

	// Orders / wishlist — answer from the user's account when logged in
	if intent := detectAccountIntent(req.Message); intent != "" {
		if !loggedIn {
			log.Printf("[CHAT] Account intent %q but no valid Authorization token", intent)
			httpjson.JSON(w, http.StatusOK, ChatResponse{
				Response: "Please **log in** to view your orders or wishlist. Open **Account**, sign in, then ask me again — e.g. \"show my orders\" or \"what's in my wishlist\".",
			})
			return
		}
		if result := h.handleAccountChatIntent(intent, req.Message, claims.UserID); result.ok {
			httpjson.JSON(w, http.StatusOK, ChatResponse{
				Response:            result.text,
				RecommendedProducts: result.products,
				Orders:              result.orders,
			})
			return
		}
	}
	// Logged-in users asking vaguely about orders still get account data, not generic AI support text
	if loggedIn && detectLooseOrderIntent(req.Message) != "" {
		intent := detectLooseOrderIntent(req.Message)
		if result := h.handleAccountChatIntent(intent, req.Message, claims.UserID); result.ok {
			httpjson.JSON(w, http.StatusOK, ChatResponse{
				Response:            result.text,
				RecommendedProducts: result.products,
				Orders:              result.orders,
			})
			return
		}
	}

	// Build context from products relevant to this question (single DB query)
	relevantProducts := h.findRelevantProducts(req.Message, 6)
	systemPrompt := h.buildSystemPrompt(req.Message, relevantProducts)

	// Prepare messages for AI
	messages := []ChatMessage{
		{Role: "system", Content: systemPrompt},
	}

	// Add conversation history (last 6 turns — enough context, fewer tokens)
	if len(req.ConversationHistory) > 0 {
		start := 0
		if len(req.ConversationHistory) > 6 {
			start = len(req.ConversationHistory) - 6
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

	// Match products to the user's question (reuse search; augment from AI reply)
	recommendedProducts := h.extractProductRecommendations(req.Message, aiResponse, relevantProducts)
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

func (h *Handler) optionalClaimsFromRequest(r *http.Request, bodyToken string) (*appauth.Claims, bool) {
	candidates := []string{}

	if header := r.Header.Get("Authorization"); header != "" {
		parts := strings.SplitN(header, " ", 2)
		if len(parts) == 2 && strings.EqualFold(parts[0], "Bearer") {
			candidates = append(candidates, parts[1])
		}
	}

	bodyToken = strings.TrimSpace(bodyToken)
	if bodyToken != "" {
		candidates = append(candidates, bodyToken)
	}

	for _, raw := range candidates {
		claims, err := appauth.ParseToken(h.Cfg.JWTSecret, raw)
		if err == nil && claims != nil {
			return claims, true
		}
	}
	return nil, false
}

// detectAccountIntent returns "orders", "order_status", "wishlist", or "".
func detectAccountIntent(msg string) string {
	lower := strings.ToLower(strings.TrimSpace(msg))
	if isPlantCareOrderPhrase(lower) {
		return ""
	}

	for _, term := range []string{
		"wishlist", "wish list", "saved items", "saved plants",
		"favourites", "favorites", "heart list", "liked items",
	} {
		if strings.Contains(lower, term) {
			return "wishlist"
		}
	}

	// Short direct asks: "orders", "my orders", "order?"
	if orderShortPhrasePattern.MatchString(lower) {
		if extractOrderIDFromMessage(msg) != nil {
			return "order_status"
		}
		return "orders"
	}

	for _, term := range []string{
		"my order", "my orders", "order status", "order history",
		"track order", "track my order", "where is my order",
		"delivery status", "order delivery", "recent orders", "past orders",
		"my purchase", "my purchases", "shipment status", "order update",
		"for orders", "for my order", "about orders", "about my order",
		"regarding order", "regarding my order", "with my order",
		"order refund", "refund my order", "cancel order", "cancel my order",
		"track package", "track shipment", "track delivery",
		"where is my package", "where is my delivery",
		"order delay", "delayed order", "late order",
		"order problem", "order issue", "wrong order", "growman orders",
		"order details", "order info", "order number", "order tracking",
	} {
		if strings.Contains(lower, term) {
			if extractOrderIDFromMessage(msg) != nil {
				return "order_status"
			}
			return "orders"
		}
	}

	if orderForAboutPattern.MatchString(lower) {
		if extractOrderIDFromMessage(msg) != nil {
			return "order_status"
		}
		return "orders"
	}

	if extractOrderIDFromMessage(msg) != nil &&
		(strings.Contains(lower, "order") || strings.Contains(lower, "track") || strings.Contains(lower, "status")) {
		return "order_status"
	}

	if orderListIntentPattern.MatchString(lower) {
		return "orders"
	}

	if orderSupportKeywordPattern.MatchString(lower) &&
		(strings.Contains(lower, "order") || strings.Contains(lower, "my ")) {
		if extractOrderIDFromMessage(msg) != nil {
			return "order_status"
		}
		return "orders"
	}

	return ""
}

// detectLooseOrderIntent catches brief order-related asks from logged-in users.
func detectLooseOrderIntent(msg string) string {
	lower := strings.ToLower(strings.TrimSpace(msg))
	if isPlantCareOrderPhrase(lower) {
		return ""
	}
	if !regexp.MustCompile(`(?i)\b(orders?|delivery|refund|tracking|shipment|parcel)\b`).MatchString(lower) {
		return ""
	}
	if len(lower) > 80 {
		return ""
	}
	if extractOrderIDFromMessage(msg) != nil {
		return "order_status"
	}
	return "orders"
}

func isPlantCareOrderPhrase(lower string) bool {
	if strings.Contains(lower, "in order to") {
		return true
	}
	if strings.Contains(lower, "order of") &&
		(strings.Contains(lower, "water") || strings.Contains(lower, "fertil") || strings.Contains(lower, "repot")) {
		return true
	}
	return false
}

var (
	orderShortPhrasePattern   = regexp.MustCompile(`(?i)^(?:show\s+|list\s+|view\s+|check\s+|see\s+|get\s+)?(?:my\s+)?orders?[\s!.?]*$`)
	orderForAboutPattern      = regexp.MustCompile(`(?i)\b(for|about|regarding|with)\s+(my\s+)?orders?\b`)
	orderListIntentPattern    = regexp.MustCompile(`(?i)\b(list|show|view|check|see|get|tell\s+me)\b.{0,30}\b(?:my\s+)?orders?\b`)
	orderSupportKeywordPattern = regexp.MustCompile(`(?i)\b(refund|tracking|tracked|delivery|delivered|shipped|shipment)\b`)
)

var orderIDPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)order\s*(?:#|no\.?|number|id)?\s*(\d{1,10})`),
	regexp.MustCompile(`(?i)#\s*(\d{1,10})\b`),
}

func extractOrderIDFromMessage(msg string) *uint {
	for _, re := range orderIDPatterns {
		if m := re.FindStringSubmatch(msg); len(m) > 1 {
			id, err := strconv.ParseUint(m[1], 10, 32)
			if err == nil && id > 0 {
				uid := uint(id)
				return &uid
			}
		}
	}
	return nil
}

func (h *Handler) handleAccountChatIntent(intent, userMessage string, userID uint) accountChatResult {
	switch intent {
	case "wishlist":
		text, products, ok := h.buildWishlistChatResponse(userID)
		return accountChatResult{ok: ok, text: text, products: products}
	case "order_status":
		orderID := extractOrderIDFromMessage(userMessage)
		if orderID == nil {
			return h.buildOrdersChatResponse(userID)
		}
		return h.buildSingleOrderChatResponse(userID, *orderID)
	case "orders":
		return h.buildOrdersChatResponse(userID)
	default:
		return accountChatResult{}
	}
}

func (h *Handler) userOrdersQuery(userID uint) *gorm.DB {
	q := h.DB.Model(&models.Order{})
	var user models.User
	if err := h.DB.Select("email", "phone").First(&user, userID).Error; err != nil {
		return q.Where("user_id = ?", userID)
	}
	email := strings.ToLower(strings.TrimSpace(user.EmailOrEmpty()))
	phone := strings.TrimSpace(user.PhoneOrEmpty())
	switch {
	case email != "" && phone != "":
		return q.Where("user_id = ? OR LOWER(customer_email) = ? OR customer_phone = ?", userID, email, phone)
	case email != "":
		return q.Where("user_id = ? OR LOWER(customer_email) = ?", userID, email)
	case phone != "":
		return q.Where("user_id = ? OR customer_phone = ?", userID, phone)
	default:
		return q.Where("user_id = ?", userID)
	}
}

func isVisibleOrder(o models.Order) bool {
	payment := strings.ToLower(strings.TrimSpace(o.PaymentStatus))
	status := strings.ToLower(strings.TrimSpace(o.Status))

	if payment == "created" || (status == "pending" && (payment == "" || payment == "created")) {
		return false
	}
	if payment == "failed" || status == "failed" || status == "cancelled" {
		return false
	}
	return payment == "paid" ||
		status == "paid" ||
		status == "confirmed" ||
		status == "shipped" ||
		status == "out_for_delivery" ||
		status == "delivered"
}

func (h *Handler) orderToChatCard(o models.Order) OrderChatCard {
	h.ResolveOrderItemImageURLsSlice(o.Items)
	card := OrderChatCard{
		ID:        o.ID,
		Status:    displayOrderStatus(o),
		Amount:    o.Amount,
		CreatedAt: o.CreatedAt.Format("2 Jan 2006"),
		ItemCount: len(o.Items),
	}
	if o.ExpectedDeliveryDate != nil {
		card.ExpectedDeliveryDate = o.ExpectedDeliveryDate.Format("2 Jan 2006")
	}
	if len(o.Items) > 0 {
		card.ItemPreview = formatOrderItems(o.Items)
		card.ImageURL = o.Items[0].ImageURL
	}
	return card
}

func displayOrderStatus(o models.Order) string {
	status := strings.ToLower(strings.TrimSpace(o.Status))
	payment := strings.ToLower(strings.TrimSpace(o.PaymentStatus))
	switch {
	case status == "out_for_delivery":
		return "Out for delivery"
	case status == "shipped":
		return "Shipped"
	case status == "delivered":
		return "Delivered"
	case status == "confirmed":
		return "Confirmed"
	case payment == "paid" || status == "paid":
		return "Confirmed"
	default:
		return humanOrderStatus(o.Status)
	}
}

func (h *Handler) buildOrdersChatResponse(userID uint) accountChatResult {
	var all []models.Order
	if err := h.userOrdersQuery(userID).Preload("Items").
		Order("created_at DESC").
		Limit(40).
		Find(&all).Error; err != nil {
		log.Printf("[CHAT] Error fetching orders for user %d: %v", userID, err)
		return accountChatResult{
			ok:   true,
			text: "Sorry, I couldn't load your orders right now. Try again or email **growman.live@gmail.com**.",
		}
	}

	visible := make([]models.Order, 0, 2)
	for _, o := range all {
		if !isVisibleOrder(o) {
			continue
		}
		visible = append(visible, o)
		if len(visible) >= 2 {
			break
		}
	}

	if len(visible) == 0 {
		return accountChatResult{
			ok: true,
			text: "You don't have any **active paid orders** right now. Unpaid checkouts are hidden — complete payment in **Shop**, or ask **\"status of order #123\"** for a specific order.",
		}
	}

	cards := make([]OrderChatCard, 0, len(visible))
	for _, o := range visible {
		cards = append(cards, h.orderToChatCard(o))
	}

	text := "Here are your **2 most recent active orders**:"
	if len(cards) == 1 {
		text = "Here is your **most recent active order**:"
	}

	return accountChatResult{ok: true, text: text, orders: cards}
}

func (h *Handler) buildSingleOrderChatResponse(userID, orderID uint) accountChatResult {
	var order models.Order
	if err := h.userOrdersQuery(userID).Preload("Items").
		Where("id = ?", orderID).
		First(&order).Error; err != nil {
		return accountChatResult{
			ok: true,
			text: fmt.Sprintf(
				"**Order #%d** was not found on your account. Double-check the number or email **growman.live@gmail.com**.",
				orderID,
			),
		}
	}

	card := h.orderToChatCard(order)
	text := fmt.Sprintf("**Order #%d** — %s", order.ID, card.Status)
	if !isVisibleOrder(order) {
		text = fmt.Sprintf("**Order #%d** — payment is still **pending**. Complete checkout to confirm this order.", order.ID)
	}

	return accountChatResult{ok: true, text: text, orders: []OrderChatCard{card}}
}

func (h *Handler) buildWishlistChatResponse(userID uint) (string, []ProductRecommendation, bool) {
	var items []models.Wishlist
	if err := h.DB.Preload("Product").
		Where("user_id = ?", userID).
		Order("created_at DESC").
		Limit(20).
		Find(&items).Error; err != nil {
		log.Printf("[CHAT] Error fetching wishlist for user %d: %v", userID, err)
		return "Sorry, I couldn't load your wishlist right now. Try again from **Account → Wishlist**.", nil, true
	}

	if len(items) == 0 {
		return "Your **wishlist is empty**. Tap the heart on any product to save it for later.", nil, true
	}

	var b strings.Builder
	fmt.Fprintf(&b, "**Your wishlist** (%d items):\n\n", len(items))
	recommendations := make([]ProductRecommendation, 0, min(3, len(items)))

	for i, item := range items {
		p := item.Product
		fmt.Fprintf(&b, "- **%s** — ₹%.0f\n", p.Name, p.Price)
		if i < 3 {
			recommendations = append(recommendations, ProductRecommendation{
				ID:       p.ID,
				Name:     p.Name,
				Slug:     p.Slug,
				Price:    p.Price,
				ImageURL: h.ImageService.ResolveImageURL(p.ImageKey),
			})
		}
	}
	if len(items) > 3 {
		b.WriteString("\n_Tap a product card below or open **Account → Wishlist** to see all._")
	}
	return b.String(), recommendations, true
}

func formatOrderSummary(o models.Order) string {
	var b strings.Builder
	fmt.Fprintf(&b, "- **Order #%d** — ₹%.0f · **%s**", o.ID, o.Amount, humanOrderStatus(o.Status))
	if o.PaymentStatus != "" && !strings.EqualFold(o.PaymentStatus, o.Status) {
		fmt.Fprintf(&b, " · payment: %s", humanOrderStatus(o.PaymentStatus))
	}
	if o.ExpectedDeliveryDate != nil {
		fmt.Fprintf(&b, " · ETA %s", o.ExpectedDeliveryDate.Format("2 Jan"))
	}
	if len(o.Items) > 0 {
		b.WriteString("\n  ")
		b.WriteString(formatOrderItems(o.Items))
	}
	return b.String()
}

func formatOrderItems(items []models.OrderItem) string {
	parts := make([]string, 0, len(items))
	for _, item := range items {
		name := item.Name
		if name == "" {
			name = "Item"
		}
		if item.Quantity > 1 {
			parts = append(parts, fmt.Sprintf("%s × %d", name, item.Quantity))
		} else {
			parts = append(parts, name)
		}
	}
	return strings.Join(parts, ", ")
}

func humanOrderStatus(status string) string {
	s := strings.TrimSpace(strings.ToLower(status))
	if s == "" {
		return "pending"
	}
	s = strings.ReplaceAll(s, "_", " ")
	return strings.Title(s)
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// buildSystemPrompt creates a focused prompt using products matched to the user's question.
func (h *Handler) buildSystemPrompt(userMessage string, products []models.Product) string {
	productList := ""
	for _, p := range products {
		desc := p.ShortDesc
		if desc == "" {
			desc = p.Description
		}
		if len(desc) > 90 {
			desc = desc[:90] + "…"
		}
		line := fmt.Sprintf("- %s (₹%.0f): %s", p.Name, p.Price, desc)
		if len(p.Tags) > 0 {
			line += fmt.Sprintf(" [tags: %s]", strings.Join(p.Tags, ", "))
		}
		productList += line + "\n"
	}
	if productList == "" {
		productList = "(No catalog match — give care advice only; suggest browsing growman.live shop.)\n"
	}

	focus := detectQuestionFocus(userMessage)
	summary := truncateText(strings.TrimSpace(userMessage), 180)

	return fmt.Sprintf(`You are Dootha, Growman's plant care assistant for Indian homes and gardens.

Answer the user's question directly. Do not give generic plant lectures.

Response format:
1. One direct answer (1–2 sentences) addressing: %s
2. Then 2–4 bullet points with specific, actionable care tips only if relevant
3. Mention ONE Growman product by exact name only when it clearly helps — from the catalog below

Constraints:
- Max 110 words total
- Use markdown: **bold** for labels, bullet lists for steps
- Indian context: monsoon humidity, AC dryness, balcony/indoor light, ₹ prices
- Do NOT guess order status, tracking, or wishlist — those come from the user's account when logged in
- Only for unresolved refund/delivery disputes (after checking orders): email growman.live@gmail.com or https://growman.live/
- Stay on topic; do not repeat the question

User question: "%s"

Catalog matches for this question:
%s`, focus, summary, productList)
}

var chatStopWords = map[string]bool{
	"the": true, "a": true, "an": true, "is": true, "are": true, "was": true, "be": true,
	"how": true, "what": true, "when": true, "where": true, "why": true, "can": true,
	"do": true, "does": true, "did": true, "my": true, "i": true, "me": true, "for": true,
	"to": true, "and": true, "or": true, "with": true, "about": true, "please": true,
	"help": true, "tell": true, "this": true, "that": true, "have": true, "has": true,
	"plant": true, "plants": true, "growman": true, "dootha": true, "need": true, "want": true,
}

func extractSearchTerms(text string) []string {
	lower := strings.ToLower(text)
	parts := regexp.MustCompile(`[^a-z0-9]+`).Split(lower, -1)
	seen := make(map[string]bool)
	terms := make([]string, 0, 8)
	for _, p := range parts {
		if len(p) < 3 || chatStopWords[p] || seen[p] {
			continue
		}
		seen[p] = true
		terms = append(terms, p)
		if len(terms) >= 6 {
			break
		}
	}
	return terms
}

func detectQuestionFocus(msg string) string {
	lower := strings.ToLower(msg)
	switch {
	case strings.Contains(lower, "water") || strings.Contains(lower, "watering"):
		return "watering frequency, drainage, and over/under-watering signs"
	case strings.Contains(lower, "light") || strings.Contains(lower, "sun") || strings.Contains(lower, "shade"):
		return "light needs and best placement (indoor/outdoor)"
	case strings.Contains(lower, "soil") || strings.Contains(lower, "pot") || strings.Contains(lower, "repot"):
		return "soil mix, pot size, and repotting timing"
	case strings.Contains(lower, "fertil") || strings.Contains(lower, "nutrient"):
		return "fertilizer type, schedule, and dosage"
	case strings.Contains(lower, "yellow") || strings.Contains(lower, "brown") || strings.Contains(lower, "dying") || strings.Contains(lower, "wilting"):
		return "likely causes and immediate fixes for the symptoms described"
	case strings.Contains(lower, "pest") || strings.Contains(lower, "bug") || strings.Contains(lower, "mealy") || strings.Contains(lower, "fungus"):
		return "pest/disease identification and treatment steps"
	case strings.Contains(lower, "gift") || strings.Contains(lower, "office") || strings.Contains(lower, "beginner") || strings.Contains(lower, "low maintenance"):
		return "suitable plant recommendations for their situation"
	default:
		return "their specific plant or gardening question"
	}
}

func truncateText(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max] + "…"
}

// findRelevantProducts searches the catalog using terms from the user's message.
func (h *Handler) findRelevantProducts(userMessage string, limit int) []models.Product {
	terms := extractSearchTerms(userMessage)
	fields := "id, name, slug, price, image_key, short_desc, description, tags"

	if len(terms) == 0 {
		var featured []models.Product
		h.DB.Select(fields).Where("featured = ? AND status = ?", true, "active").Limit(limit).Find(&featured)
		return featured
	}

	var conditions []string
	var args []any
	for _, term := range terms {
		pattern := "%" + term + "%"
		conditions = append(conditions, "(name ILIKE ? OR short_desc ILIKE ? OR description ILIKE ? OR tags::text ILIKE ?)")
		args = append(args, pattern, pattern, pattern, pattern)
	}

	var products []models.Product
	h.DB.Select(fields).
		Where("status = ?", "active").
		Where(strings.Join(conditions, " OR "), args...).
		Limit(limit).
		Find(&products)

	if len(products) == 0 {
		h.DB.Select(fields).Where("featured = ? AND status = ?", true, "active").Limit(limit).Find(&products)
	}
	return products
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
		MaxTokens:   280,
		Temperature: 0.35,
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

	client := &http.Client{Timeout: 25 * time.Second}
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

	geminiContents := make([]GeminiContent, 0, len(messages))
	for _, msg := range messages {
		if msg.Role == "system" {
			continue
		}
		role := "user"
		if msg.Role == "assistant" {
			role = "model"
		}
		geminiContents = append(geminiContents, GeminiContent{
			Parts: []GeminiPart{{Text: msg.Content}},
			Role:  role,
		})
	}

	requestBody := GeminiRequest{
		Contents: geminiContents,
	}
	if systemPrompt != "" {
		requestBody.SystemInstruction = &GeminiContent{
			Parts: []GeminiPart{{Text: systemPrompt}},
		}
	}
	requestBody.GenerationConfig.Temperature = 0.35
	requestBody.GenerationConfig.MaxOutputTokens = 350

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

	client := &http.Client{Timeout: 25 * time.Second}
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

// getFallbackResponse provides targeted responses when the AI API is unavailable.
func (h *Handler) getFallbackResponse(userMessage string) string {
	lowerMsg := strings.ToLower(userMessage)

	switch {
	case strings.Contains(lowerMsg, "water") || strings.Contains(lowerMsg, "watering"):
		return "**Watering:** Check the top 2 cm of soil — water only when dry. Most indoor plants need watering every 5–10 days in summer, less in monsoon/winter. Ensure drainage holes; empty the saucer after watering."
	case strings.Contains(lowerMsg, "light") || strings.Contains(lowerMsg, "sunlight") || strings.Contains(lowerMsg, "sun"):
		return "**Light:** Bright indirect light suits most houseplants. South/east windows work well in India; avoid harsh midday sun on delicate leaves. Low-light picks: pothos, snake plant, zz plant."
	case strings.Contains(lowerMsg, "yellow") || strings.Contains(lowerMsg, "brown") || strings.Contains(lowerMsg, "dying"):
		return "**Leaf problems:** Yellow leaves often mean overwatering or poor drainage; brown tips suggest low humidity or salt buildup. Trim damaged leaves, adjust watering, and improve airflow."
	case strings.Contains(lowerMsg, "soil") || strings.Contains(lowerMsg, "potting") || strings.Contains(lowerMsg, "repot"):
		return "**Soil & pots:** Use well-draining potting mix — not garden soil. Repot when roots circle the pot or water runs straight through. Go one pot size up with drainage holes."
	case strings.Contains(lowerMsg, "fertilizer") || strings.Contains(lowerMsg, "fertilize"):
		return "**Feeding:** Fertilize monthly in spring/summer with diluted balanced liquid feed; pause in winter. Over-fertilizing burns roots — always follow label dilution."
	case strings.Contains(lowerMsg, "pest") || strings.Contains(lowerMsg, "bug") || strings.Contains(lowerMsg, "mealy"):
		return "**Pests:** Isolate affected plants. Wipe mealybugs with alcohol swabs; spray neem oil for aphids/mites. Repeat weekly until clear; improve airflow to prevent recurrence."
	case strings.Contains(lowerMsg, "gift") || strings.Contains(lowerMsg, "office") || strings.Contains(lowerMsg, "beginner"):
		return "**Easy picks:** For gifts or beginners try pothos, snake plant, or money plant — low maintenance and tolerate indoor Indian conditions. Browse gift-tagged plants on Growman."
	default:
		return "Ask me about **watering**, **light**, **soil**, **pests**, or **plant picks** for your space. I can suggest matching products from Growman too."
	}
}

// extractProductRecommendations returns catalog products relevant to the user's question.
func (h *Handler) extractProductRecommendations(userMessage, aiResponse string, preloaded []models.Product) []ProductRecommendation {
	products := preloaded
	if len(products) == 0 {
		products = h.findRelevantProducts(userMessage, 5)
	}

	// Boost products whose names appear in the AI reply
	lowerAI := strings.ToLower(aiResponse)
	productMap := make(map[uint]models.Product, len(products)+3)
	ordered := make([]uint, 0, 3)

	addProduct := func(p models.Product) {
		if _, ok := productMap[p.ID]; ok {
			return
		}
		productMap[p.ID] = p
		ordered = append(ordered, p.ID)
	}

	for _, p := range products {
		addProduct(p)
	}

	for _, p := range products {
		if strings.Contains(lowerAI, strings.ToLower(p.Name)) {
			addProduct(p)
		}
	}

	if len(ordered) < 3 {
		for _, term := range extractSearchTerms(aiResponse) {
			if len(ordered) >= 3 {
				break
			}
			var extra []models.Product
			pattern := "%" + term + "%"
			h.DB.Select("id, name, slug, price, image_key").
				Where("status = ? AND (name ILIKE ? OR tags::text ILIKE ?)", "active", pattern, pattern).
				Limit(2).
				Find(&extra)
			for _, p := range extra {
				addProduct(p)
				if len(ordered) >= 3 {
					break
				}
			}
		}
	}

	recommendations := make([]ProductRecommendation, 0, 3)
	for _, id := range ordered {
		if len(recommendations) >= 3 {
			break
		}
		p := productMap[id]
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
