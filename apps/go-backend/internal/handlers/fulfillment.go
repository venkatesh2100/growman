package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"net/http"
	"time"

	"github.com/venkatesh2100/growman/apps/go-backend/internal/fulfillment"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/models"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/shiprocket"
	"github.com/venkatesh2100/growman/apps/go-backend/pkg/httpjson"
)

const (
	maxCartLines    = 100
	maxLineQuantity = 1000
)

// DestinationRequest is where the customer wants the order delivered.
// Coordinates come from the browser's geolocation prompt when the customer
// allows it; the pincode is the fallback.
type DestinationRequest struct {
	Latitude  *float64 `json:"latitude"`
	Longitude *float64 `json:"longitude"`
	Pincode   string   `json:"pincode"`
}

func (d DestinationRequest) toFulfillment() fulfillment.Destination {
	dest := fulfillment.Destination{Pincode: d.Pincode}
	// Ignore a half-supplied or nonsensical coordinate pair rather than
	// quoting off it; the pincode fallback is more trustworthy.
	if d.Latitude != nil && d.Longitude != nil &&
		*d.Latitude >= -90 && *d.Latitude <= 90 &&
		*d.Longitude >= -180 && *d.Longitude <= 180 &&
		!(*d.Latitude == 0 && *d.Longitude == 0) {
		dest.Lat, dest.Lng = d.Latitude, d.Longitude
	}
	return dest
}

// FulfillmentQuoteRequest asks how a cart can be delivered and at what cost.
type FulfillmentQuoteRequest struct {
	Items       []OrderItemRequest `json:"items"`
	Destination DestinationRequest `json:"destination"`
}

// pricedLine is a cart line resolved against the database: the trusted
// price and the handling characteristics that decide its delivery channel.
type pricedLine struct {
	Price     float64
	Quantity  int
	SizeClass fulfillment.SizeClass
	Bulky     bool
}

// resolveCart turns client-supplied line items into a fulfillment cart
// using prices and size classes read from the database, so neither the
// delivery fee nor the channel can be influenced by a tampered payload.
// Writes its own HTTP error and returns ok=false on invalid input, matching
// the convention in this package.
func (h *Handler) resolveCart(w http.ResponseWriter, r *http.Request, items []OrderItemRequest) (cart fulfillment.Cart, ok bool) {
	if len(items) == 0 {
		httpjson.Error(w, http.StatusBadRequest, "cart is empty")
		return cart, false
	}
	if len(items) > maxCartLines {
		httpjson.Error(w, http.StatusBadRequest, "too many items in cart")
		return cart, false
	}

	productIDs := make([]uint, 0, len(items))
	sizeIDs := make([]uint, 0, len(items))
	for _, item := range items {
		if item.Quantity < 1 || item.Quantity > maxLineQuantity {
			httpjson.Error(w, http.StatusBadRequest, "invalid item quantity")
			return cart, false
		}
		productIDs = append(productIDs, item.ProductID)
		if item.ProductSizeID != nil {
			sizeIDs = append(sizeIDs, *item.ProductSizeID)
		}
	}

	var products []models.Product
	if err := h.DB.WithContext(r.Context()).
		Select("id, price, size_class, bulky").
		Where("id IN ?", productIDs).Find(&products).Error; err != nil {
		log.Printf("[FULFILLMENT] fetch products: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to price cart")
		return cart, false
	}
	productByID := make(map[uint]models.Product, len(products))
	for _, p := range products {
		productByID[p.ID] = p
	}

	sizeByID := make(map[uint]models.ProductSize, len(sizeIDs))
	if len(sizeIDs) > 0 {
		var sizes []models.ProductSize
		if err := h.DB.WithContext(r.Context()).
			Select("id, product_id, price, size_class, bulky").
			Where("id IN ? AND product_id IN ?", sizeIDs, productIDs).Find(&sizes).Error; err != nil {
			log.Printf("[FULFILLMENT] fetch product sizes: %v", err)
			httpjson.Error(w, http.StatusInternalServerError, "failed to price cart")
			return cart, false
		}
		for _, s := range sizes {
			sizeByID[s.ID] = s
		}
	}

	lines := make([]fulfillment.Item, len(items))
	for i, item := range items {
		product, exists := productByID[item.ProductID]
		if !exists {
			httpjson.Error(w, http.StatusBadRequest, fmt.Sprintf("product with ID %d not found", item.ProductID))
			return cart, false
		}

		line := pricedLine{
			Price:     product.Price,
			Quantity:  item.Quantity,
			SizeClass: fulfillment.SizeClass(product.SizeClass),
			Bulky:     product.Bulky,
		}

		if item.ProductSizeID != nil {
			size, found := sizeByID[*item.ProductSizeID]
			if !found || size.ProductID != item.ProductID {
				httpjson.Error(w, http.StatusBadRequest,
					fmt.Sprintf("product size with ID %d not found for product %d", *item.ProductSizeID, item.ProductID))
				return cart, false
			}
			line.Price = size.Price
			if size.SizeClass != nil {
				line.SizeClass = fulfillment.SizeClass(*size.SizeClass)
			}
			if size.Bulky != nil {
				line.Bulky = *size.Bulky
			}
		}

		lines[i] = fulfillment.Item{
			SizeClass: line.SizeClass,
			Bulky:     line.Bulky,
			Quantity:  line.Quantity,
			UnitPrice: line.Price,
		}
	}

	return fulfillment.Cart{Items: lines}, true
}

// courierLookupTTL caches a serviceability answer per pincode and weight
// band. Coverage and rates change on the order of days, while a customer
// editing their cart or address can trigger several quotes a minute.
const courierLookupTTL = 6 * time.Hour

// courierQuote asks the aggregator whether a pincode is serviceable and at
// what cost, going through a short-lived cache.
//
// Every failure path returns an unchecked CourierQuote, which leaves the
// courier available on the static fee bands: a slow or broken third-party
// API must not be able to stop Growman taking orders. Only a definitive
// "no courier covers this pincode" marks the channel unavailable.
func (h *Handler) courierQuote(ctx context.Context, cart fulfillment.Cart, policy fulfillment.Policy, pincode string) fulfillment.CourierQuote {
	if h.Shiprocket == nil || h.Cfg.StorePincode == "" || pincode == "" {
		return fulfillment.CourierQuote{}
	}

	weight := policy.EstimatedWeightKg(cart)
	// Round the weight into 0.5 kg buckets so near-identical carts share a
	// cache entry instead of each costing an API call.
	bucket := math.Ceil(weight*2) / 2
	cacheKey := fmt.Sprintf("courier:serviceability:%s:%s:%.1f", h.Cfg.StorePincode, pincode, bucket)

	if h.Redis != nil {
		if raw, err := h.Redis.Get(ctx, cacheKey).Bytes(); err == nil {
			var cached fulfillment.CourierQuote
			if json.Unmarshal(raw, &cached) == nil {
				return cached
			}
		}
	}

	lookupCtx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()

	rate, err := h.Shiprocket.CheckServiceability(lookupCtx, shiprocket.Shipment{
		PickupPincode:   h.Cfg.StorePincode,
		DeliveryPincode: pincode,
		WeightKg:        bucket,
		DeclaredValue:   cart.Subtotal(),
	})
	if err != nil {
		// A paused or unconfigured client is an expected steady state, not
		// an incident; logging it on every quote would bury real faults.
		if !errors.Is(err, shiprocket.ErrCircuitOpen) && !errors.Is(err, shiprocket.ErrNotConfigured) {
			log.Printf("[COURIER] serviceability lookup for %s failed, falling back to fee bands: %v", pincode, err)
		}
		return fulfillment.CourierQuote{}
	}

	result := fulfillment.CourierQuote{
		Checked:       true,
		Serviceable:   rate.Serviceable,
		RateINR:       rate.RateINR,
		CourierName:   rate.CourierName,
		EstimatedDays: rate.EstimatedDays,
	}
	if h.Redis != nil {
		if raw, err := json.Marshal(result); err == nil {
			h.Redis.Set(ctx, cacheKey, raw, courierLookupTTL)
		}
	}
	return result
}

// quoteCart prices a cart, consulting the aggregator only when a courier
// delivery is actually on the table. A cart of large plants, or an address
// past the retail radius, is already decided by Growman's own rules, and
// paying a third-party round trip to confirm a channel that cannot be
// offered anyway only makes checkout slower.
func (h *Handler) quoteCart(ctx context.Context, cart fulfillment.Cart, policy fulfillment.Policy, dest fulfillment.Destination) fulfillment.Quote {
	quote := policy.QuoteWith(cart, dest, fulfillment.CourierQuote{})
	if opt, found := quote.Option(fulfillment.ChannelCourier); !found || !opt.Available {
		return quote
	}

	courier := h.courierQuote(ctx, cart, policy, dest.Pincode)
	if !courier.Checked {
		// Unchecked is exactly what the first pass already assumed.
		return quote
	}
	return policy.QuoteWith(cart, dest, courier)
}

// QuoteFulfillment returns the delivery options for a cart and destination:
// which of store pickup, courier, own vehicle and bulk quote are available,
// what each costs, and which one checkout should present first. Read-only
// and safe to call on every address or cart change.
func (h *Handler) QuoteFulfillment(w http.ResponseWriter, r *http.Request) {
	var req FulfillmentQuoteRequest
	if !httpjson.Decode(w, r, &req) {
		return
	}

	cart, ok := h.resolveCart(w, r, req.Items)
	if !ok {
		return
	}

	policy := h.Cfg.FulfillmentPolicy()
	quote := h.quoteCart(r.Context(), cart, policy, req.Destination.toFulfillment())

	httpjson.JSON(w, http.StatusOK, map[string]any{
		"quote":           quote,
		"courierProvider": policy.CourierProvider,
	})
}

// orderFulfillment is the delivery decision recorded against an order.
type orderFulfillment struct {
	Channel         string
	Zone            string
	Subtotal        float64
	Fee             float64
	FeeWaived       bool
	DistanceKm      *float64
	DistanceSource  string
	CourierProvider string
	CourierService  string
	CourierCost     *float64
}

// amountTolerance absorbs rounding differences between the client's
// arithmetic and the server's, in rupees.
const amountTolerance = 1.0

// resolveOrderFulfillment re-runs the delivery quote at order creation and
// checks that the customer's chosen channel is still available and that the
// amount they are about to pay is subtotal plus the fee we would charge.
// Quoting and paying are separate requests, so the cart or address may have
// changed in between; re-deriving here is what stops a client from
// selecting a channel it is not entitled to or paying a fee it invented.
//
// A request without a channel is a client predating these rules: the order
// is accepted with the amount as its subtotal and no channel recorded.
func (h *Handler) resolveOrderFulfillment(w http.ResponseWriter, r *http.Request, req *CreateCheckoutOrderRequest) (orderFulfillment, bool) {
	if req.FulfillmentChannel == "" {
		log.Printf("[FULFILLMENT] order created without a channel; recording amount as subtotal")
		return orderFulfillment{Subtotal: req.Amount}, true
	}

	channel := fulfillment.Channel(req.FulfillmentChannel)
	if !payableChannels[channel] {
		if channel == fulfillment.ChannelBulkQuote {
			httpjson.Error(w, http.StatusBadRequest, "bulk orders are quoted by sales, not paid at checkout")
			return orderFulfillment{}, false
		}
		httpjson.Error(w, http.StatusBadRequest, "unknown fulfillment channel")
		return orderFulfillment{}, false
	}

	cart, ok := h.resolveCart(w, r, req.Items)
	if !ok {
		return orderFulfillment{}, false
	}

	policy := h.Cfg.FulfillmentPolicy()
	quote := h.quoteCart(r.Context(), cart, policy, DestinationRequest{
		Latitude:  req.Latitude,
		Longitude: req.Longitude,
		Pincode:   req.Customer.Pincode,
	}.toFulfillment())

	opt, found := quote.Option(channel)
	if !found || !opt.Available {
		httpjson.JSON(w, http.StatusConflict, map[string]any{
			"error":  "channel_unavailable",
			"reason": opt.Reason,
			"quote":  quote,
		})
		return orderFulfillment{}, false
	}

	expected := quote.Subtotal + opt.Fee
	if math.Abs(req.Amount-expected) > amountTolerance {
		httpjson.JSON(w, http.StatusConflict, map[string]any{
			"error":          "amount_mismatch",
			"expectedAmount": expected,
			"quote":          quote,
		})
		return orderFulfillment{}, false
	}
	// Charge the server's figure, not the client's, now that they agree to
	// within rounding.
	req.Amount = expected

	result := orderFulfillment{
		Channel:        string(channel),
		Zone:           string(quote.Zone),
		Subtotal:       quote.Subtotal,
		Fee:            opt.Fee,
		FeeWaived:      opt.FeeWaived,
		DistanceKm:     quote.DistanceKm,
		DistanceSource: quote.DistanceSource,
	}
	if channel == fulfillment.ChannelCourier {
		result.CourierProvider = policy.CourierProvider
		// Record what the aggregator quoted as the order's cost, so the
		// subsidy against DeliveryFee is known without ops keying it in.
		result.CourierService = quote.CourierName
		result.CourierCost = quote.CourierCost
	}
	return result, true
}
