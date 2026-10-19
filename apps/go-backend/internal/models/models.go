// Package models defines the GORM models that make up the Postgres schema.
// Every table is reconciled from these structs via AutoMigrate on boot
// (internal/handlers/handler.go) — see internal/docs/10-database-and-migrations.md.
package models

import (
	"database/sql/driver"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"
)

// StringArray is a custom type for PostgreSQL text[] arrays that works with pgx
type StringArray []string

// Value implements the driver.Valuer interface
func (a StringArray) Value() (driver.Value, error) {
	if len(a) == 0 {
		return "{}", nil
	}
	// Escape and quote strings properly for PostgreSQL array format
	quoted := make([]string, len(a))
	for i, s := range a {
		// Escape quotes and backslashes, then wrap in quotes
		escaped := strings.ReplaceAll(s, "\\", "\\\\")
		escaped = strings.ReplaceAll(escaped, "\"", "\\\"")
		quoted[i] = `"` + escaped + `"`
	}
	return "{" + strings.Join(quoted, ",") + "}", nil
}

// Scan implements the sql.Scanner interface
func (a *StringArray) Scan(value any) error {
	if value == nil {
		*a = StringArray{}
		return nil
	}

	var str string
	switch v := value.(type) {
	case []byte:
		str = string(v)
	case string:
		str = v
	default:
		return errors.New("cannot scan into StringArray")
	}

	// Remove curly braces
	str = strings.Trim(str, "{}")
	if str == "" {
		*a = StringArray{}
		return nil
	}

	// Parse PostgreSQL array format
	// This is a simplified parser - handles quoted and unquoted strings
	result := make(StringArray, 0)
	var current strings.Builder
	inQuotes := false
	escapeNext := false

	for i, r := range str {
		if escapeNext {
			current.WriteRune(r)
			escapeNext = false
			continue
		}

		switch r {
		case '\\':
			escapeNext = true
		case '"':
			inQuotes = !inQuotes
		case ',':
			if !inQuotes {
				val := strings.TrimSpace(current.String())
				if val != "" {
					result = append(result, val)
				}
				current.Reset()
			} else {
				current.WriteRune(r)
			}
		default:
			current.WriteRune(r)
		}

		// Handle last element
		if i == len(str)-1 {
			val := strings.TrimSpace(current.String())
			if val != "" {
				result = append(result, val)
			}
		}
	}

	*a = result
	return nil
}

// MarshalJSON implements json.Marshaler
func (a StringArray) MarshalJSON() ([]byte, error) {
	return json.Marshal([]string(a))
}

// UnmarshalJSON implements json.Unmarshaler
func (a *StringArray) UnmarshalJSON(data []byte) error {
	var s []string
	if err := json.Unmarshal(data, &s); err != nil {
		return err
	}
	*a = StringArray(s)
	return nil
}

// Base includes common columns for all tables.
type Base struct {
	ID        uint           `gorm:"primaryKey" json:"id"`
	CreatedAt time.Time      `json:"createdAt"`
	UpdatedAt time.Time      `json:"updatedAt"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

type User struct {
	Base
	Name            string     `json:"name"`
	Email           *string    `gorm:"uniqueIndex" json:"email"`
	Phone           *string    `gorm:"uniqueIndex" json:"phone"`
	PasswordHash    *string    `json:"-"`
	PhoneVerifiedAt *time.Time `json:"phoneVerifiedAt,omitempty"`
	EmailVerified   bool       `gorm:"default:false" json:"emailVerified"`
	Provider        string     `gorm:"default:'local'" json:"provider"` // 'local', 'google', or 'phone'
	Role            string     `json:"role"`
	// Address fields
	AddressLine string   `json:"addressLine,omitempty"`
	City        string   `json:"city,omitempty"`
	State       string   `json:"state,omitempty"`
	Pincode     string   `json:"pincode,omitempty"`
	Country     string   `json:"country,omitempty"`
	Latitude    *float64 `json:"latitude,omitempty"`
	Longitude   *float64 `json:"longitude,omitempty"`
	// ReferralCode is the customer's own invite code. ReferredBy is the
	// account that invited them, set once and never overwritten.
	ReferralCode string   `gorm:"uniqueIndex:idx_users_referral,where:referral_code <> '';size:12" json:"referralCode,omitempty"`
	ReferredBy   *uint    `json:"referredBy,omitempty"`
	Reviews      []Review `json:"reviews"`
}

// StrPtr returns a pointer to s, or nil if s is empty.
func StrPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// EmailOrEmpty returns email string for API responses.
func (u User) EmailOrEmpty() string {
	if u.Email == nil {
		return ""
	}
	return *u.Email
}

// PhoneOrEmpty returns phone string for API responses.
func (u User) PhoneOrEmpty() string {
	if u.Phone == nil {
		return ""
	}
	return *u.Phone
}

// PasswordHashOrEmpty returns password hash or empty.
func (u User) PasswordHashOrEmpty() string {
	if u.PasswordHash == nil {
		return ""
	}
	return *u.PasswordHash
}

type Category struct {
	Base
	Name          string        `json:"name"`
	Slug          string        `gorm:"uniqueIndex" json:"slug"`
	Description   string        `json:"description"`
	Subcategories []Subcategory `json:"subcategories"`
	Products      []Product     `json:"products"`
}

type Subcategory struct {
	Base
	Name        string    `json:"name"`
	Slug        string    `gorm:"index" json:"slug"`
	Description string    `json:"description"`
	CategoryID  uint      `json:"categoryId"`
	Category    Category  `json:"category"`
	Products    []Product `json:"products"`
}

type Brand struct {
	Base
	Name     string    `json:"name"`
	Slug     string    `gorm:"uniqueIndex" json:"slug"`
	Products []Product `json:"products"`
}

type Product struct {
	Base
	Name           string      `json:"name"`
	Slug           string      `gorm:"uniqueIndex" json:"slug"`
	Description    string      `json:"description"`
	ShortDesc      string      `json:"shortDescription"`
	FullDesc       string      `json:"fullDescription"`
	Specifications string      `json:"specifications"`
	TaxInfo        string      `json:"taxInfo"`
	Price          float64     `json:"price"` // price in currency units
	MRP            float64     `json:"mrp"`
	Currency       string      `json:"currency"`
	ImageKey       string      `gorm:"column:image_key" json:"imageKey"` // Storage-agnostic image key (e.g., "products/130239.jpg")
	ImageURL       string      `gorm:"-" json:"imageUrl"`                // Resolved URL (not stored in DB, computed from ImageKey)
	Status         string      `json:"status"`
	Featured       bool        `gorm:"index:idx_products_featured" json:"featured"`
	Tags           StringArray `gorm:"type:text[]" json:"tags"`
	// Stock is the sellable quantity for products without sizes. For a
	// product that has ProductSizes, stock is tracked per size and this
	// field is ignored. Decremented on payment; see handlers/inventory.go.
	Stock int `json:"stock"`
	// TrackInventory off means "always available" — useful for
	// made-to-order or effectively unlimited items like seed packets.
	TrackInventory bool `gorm:"default:true" json:"trackInventory"`
	// LowStockThreshold drives the "only N left" urgency cue on the PDP.
	LowStockThreshold int `gorm:"default:5" json:"lowStockThreshold"`
	// RatingAverage/RatingCount are denormalised from approved reviews so
	// list pages never need a join. Maintained by RecalculateProductRating.
	RatingAverage float64 `gorm:"default:0" json:"ratingAverage"`
	RatingCount   int     `gorm:"default:0" json:"ratingCount"`
	// Tax fields for GST-compliant invoicing. GSTRate is a percentage
	// (e.g. 5 for 5%); when zero the order falls back to DefaultGSTRate.
	HSNCode string  `gorm:"column:hsn_code" json:"hsnCode,omitempty"`
	GSTRate float64 `gorm:"column:gst_rate;default:0" json:"gstRate"`
	// SizeClass and Bulky drive delivery routing (small/medium go by
	// courier, large needs the Growman vehicle, xl is quote-only). These
	// are the product's default; a ProductSize may override them.
	SizeClass     string        `gorm:"default:'small'" json:"sizeClass"`
	Bulky         bool          `gorm:"default:false" json:"bulky"`
	CategoryID    uint          `gorm:"index:idx_products_category" json:"categoryId"`
	Category      Category      `json:"category"`
	SubcategoryID *uint         `gorm:"index:idx_products_subcategory" json:"subcategoryId"`
	Subcategory   *Subcategory  `json:"subcategory"`
	BrandID       *uint         `json:"brandId"`
	Brand         *Brand        `json:"brand"`
	Sizes         []ProductSize `json:"sizes"`
	Attributes    []Attribute   `json:"attributes"`
	Reviews       []Review      `json:"reviews"`
}

type ProductSize struct {
	Base
	Label     string  `json:"label"`
	Price     float64 `json:"price"`
	Stock     int     `json:"stock"`
	ProductID uint    `json:"productId"`
	// Delivery-routing overrides. Nil means "inherit from the product" —
	// a 14-inch pot of the same plant can need the van while the 6-inch
	// ships by courier.
	SizeClass *string     `json:"sizeClass,omitempty"`
	Bulky     *bool       `json:"bulky,omitempty"`
	ImageKeys StringArray `gorm:"type:text[];column:image_keys" json:"imageKeys"` // Storage-agnostic image keys
	Images    StringArray `gorm:"-" json:"images"`                                // Resolved URLs (not stored in DB, computed from ImageKeys)
}

type Attribute struct {
	Base
	Name      string `json:"name"`
	Value     string `json:"value"`
	ProductID uint   `json:"productId"`
}

// Review is a customer's rating of a product. Reviews are moderated:
// only Status == "approved" rows are exposed publicly or counted towards a
// product's RatingAverage.
type Review struct {
	Base
	Rating    int    `json:"rating"` // 1-5
	Title     string `json:"title,omitempty"`
	Comment   string `json:"comment"`
	ProductID uint   `gorm:"uniqueIndex:idx_reviews_user_product" json:"productId"`
	UserID    uint   `gorm:"uniqueIndex:idx_reviews_user_product" json:"userId"`
	User      User   `json:"user"`
	// Status gates public visibility: pending, approved, rejected.
	Status string `gorm:"default:'pending';index:idx_reviews_status" json:"status"`
	// VerifiedPurchase is set when the author has a paid order containing
	// this product. Shown as a badge and weighted higher in sorting.
	VerifiedPurchase bool `gorm:"default:false" json:"verifiedPurchase"`
	// Customer-supplied photos — for plants, the single most useful part
	// of a review, since buyers want to see real delivered size/condition.
	ImageKeys  StringArray `gorm:"type:text[];column:image_keys" json:"imageKeys"`
	Images     StringArray `gorm:"-" json:"images"` // resolved URLs, computed from ImageKeys
	AdminNotes string      `gorm:"type:text" json:"adminNotes,omitempty"`
}

// OrderItem represents a single item in an order
type OrderItem struct {
	Base
	OrderID     uint    `json:"orderId"`
	ProductID   uint    `json:"productId"`
	Product     Product `json:"product"`
	ProductSize *uint   `json:"productSizeId,omitempty"`
	Quantity    int     `json:"quantity"`
	Price       float64 `json:"price"`
	Name        string  `json:"name"`
	ImageKey    string  `gorm:"column:image_key" json:"imageKey"` // Storage-agnostic image key
	ImageURL    string  `gorm:"-" json:"imageUrl"`                // Resolved URL (not stored in DB, computed from ImageKey)
}

// Order represents a customer order
type Order struct {
	Base
	UserID               *uint       `gorm:"index:idx_orders_user" json:"userId,omitempty"`
	User                 *User       `json:"user,omitempty"`
	RazorpayOrderID      string      `gorm:"uniqueIndex" json:"razorpayOrderId"`
	RazorpayPaymentID    string      `json:"razorpayPaymentId,omitempty"`
	PaymentStatus        string      `gorm:"default:'created'" json:"paymentStatus"` // created, paid, failed, refunded, partially_refunded
	Status               string      `gorm:"index:idx_orders_status" json:"status"`  // pending, paid, failed, cancelled (legacy)
	Amount               float64     `json:"amount"`
	Currency             string      `json:"currency"`
	ExpectedDeliveryDate *time.Time  `json:"expectedDeliveryDate,omitempty"`
	Items                []OrderItem `json:"items"`
	// PublicToken is an unguessable handle for looking this order up
	// without authentication, so the post-payment success page works for
	// guests. Order IDs are sequential and must never be used for that.
	// Partial unique index, as for InvoiceNumber: an order created by a
	// path that does not mint a token must not collide with the next such
	// order.
	PublicToken string `gorm:"uniqueIndex:idx_orders_public_token,where:public_token <> '';size:64" json:"publicToken,omitempty"`
	// Customer info
	CustomerName  string `json:"customerName,omitempty"`
	CustomerEmail string `json:"customerEmail,omitempty"`
	CustomerPhone string `json:"customerPhone,omitempty"`
	// ClientIP and UserAgent are captured when the checkout is created so
	// an abandoned checkout can be recognised later. They are ops-only and
	// are omitted from API responses. Erasure clears them with the rest of
	// the contact details.
	ClientIP  string `gorm:"size:64" json:"-"`
	UserAgent string `gorm:"size:512" json:"-"`
	// Address fields
	AddressLine string `json:"addressLine,omitempty"`
	City        string `json:"city,omitempty"`
	State       string `json:"state,omitempty"`
	Pincode     string `json:"pincode,omitempty"`
	// Fulfillment and delivery economics. Amount above is what the
	// customer paid in total; Subtotal and DeliveryFee break that down so
	// margin per order can be measured once CourierCost is filled in by
	// ops. See internal/fulfillment for how these are decided.
	FulfillmentChannel string   `gorm:"index:idx_orders_channel" json:"fulfillmentChannel,omitempty"` // store_pickup, courier, own_vehicle, bulk_quote
	FulfillmentZone    string   `json:"fulfillmentZone,omitempty"`                                    // store_local, near, mid, far, outside, unknown
	Subtotal           float64  `json:"subtotal"`
	DeliveryFee        float64  `json:"deliveryFee"`
	DeliveryFeeWaived  bool     `gorm:"default:false" json:"deliveryFeeWaived"`
	DistanceKm         *float64 `json:"distanceKm,omitempty"`
	DistanceSource     string   `json:"distanceSource,omitempty"` // coordinates, pincode, none
	Latitude           *float64 `json:"latitude,omitempty"`
	Longitude          *float64 `json:"longitude,omitempty"`
	CourierProvider    string   `json:"courierProvider,omitempty"` // aggregator, e.g. Shiprocket
	CourierService     string   `json:"courierService,omitempty"`  // carrier it picked, e.g. Delhivery
	// CourierCost is what the courier charges Growman, captured from the
	// aggregator's rate at checkout. Nil when no live rate was available;
	// the gap between it and DeliveryFee is the delivery subsidy.
	CourierCost *float64 `json:"courierCost,omitempty"`
	// Shipment tracking, populated when the courier shipment is booked
	// through the aggregator (see internal/shiprocket).
	ShipmentID     string     `json:"shipmentId,omitempty"`
	AWBNumber      string     `gorm:"index:idx_orders_awb" json:"awbNumber,omitempty"`
	TrackingURL    string     `json:"trackingUrl,omitempty"`
	ShippedAt      *time.Time `json:"shippedAt,omitempty"`
	DeliveredAt    *time.Time `json:"deliveredAt,omitempty"`
	PickupBookedAt *time.Time `json:"pickupBookedAt,omitempty"`
	// Tax breakdown. TaxableValue + TaxAmount == Subtotal: catalogue
	// prices are GST-inclusive, so tax is extracted rather than added.
	TaxableValue float64 `json:"taxableValue"`
	TaxAmount    float64 `json:"taxAmount"`
	// Invoice identity, assigned once on first invoice generation so the
	// number stays stable across re-downloads.
	// default:null keeps the unique index usable. The column is empty until
	// the order is paid, and Postgres treats '' as an ordinary value that
	// collides with itself — so a plain `uniqueIndex` on a non-null string
	// would reject the *second* order awaiting an invoice number. NULLs do
	// not conflict, and GORM omits a zero value when a default is declared,
	// so unset rows store NULL and read back as "".
	// A *partial* unique index. This column is empty until the order is
	// paid, and Postgres treats '' as an ordinary value that collides with
	// itself, so a plain uniqueIndex would reject the second order awaiting
	// an invoice number. The predicate excludes unassigned rows whether
	// they hold '' or NULL, while still guaranteeing no two orders share a
	// real invoice number.
	InvoiceNumber string     `gorm:"uniqueIndex:idx_orders_invoice_number,where:invoice_number <> '';size:32" json:"invoiceNumber,omitempty"`
	InvoiceDate   *time.Time `json:"invoiceDate,omitempty"`
	// Discount applied from a coupon, if any.
	CouponID      *uint   `json:"couponId,omitempty"`
	CouponCode    string  `json:"couponCode,omitempty"`
	DiscountTotal float64 `json:"discountTotal"`
	// ReviewRequestedAt stops the post-delivery review email being sent
	// more than once per order.
	ReviewRequestedAt *time.Time `json:"-"`
	// Cancellation / refund bookkeeping.
	CancelledAt    *time.Time `json:"cancelledAt,omitempty"`
	CancelReason   string     `json:"cancelReason,omitempty"`
	RefundedAmount float64    `json:"refundedAmount"`
	// InventoryReleased guards the stock-release sweep so an abandoned
	// order's reservation is only ever returned once.
	InventoryReleased bool `gorm:"default:false" json:"-"`
	// Gift presentation. GiftFee is included in Amount. The tax invoice
	// still shows prices; HidePrice only covers the packing note.
	GiftWrap              bool       `json:"giftWrap"`
	GiftNote              string     `gorm:"size:300" json:"giftNote,omitempty"`
	HidePrice             bool       `json:"hidePrice"`
	GiftFee               float64    `json:"giftFee"`
	DeliverySlot          string     `gorm:"size:16" json:"deliverySlot,omitempty"` // morning, evening
	PreferredDeliveryDate *time.Time `json:"preferredDeliveryDate,omitempty"`
	DeliveryRating        *int       `json:"deliveryRating,omitempty"`
	DeliveryFeedback      string     `gorm:"size:500" json:"deliveryFeedback,omitempty"`
	CreditApplied         float64    `json:"creditApplied"`
	// Legacy fields (for backward compatibility)
	ShippingAddress string `json:"shippingAddress,omitempty"`
	BillingAddress  string `json:"billingAddress,omitempty"`
}

// IsCancellable reports whether a customer may still cancel: paid, not yet
// dispatched, and not already cancelled or refunded.
func (o Order) IsCancellable() bool {
	if o.CancelledAt != nil || o.AWBNumber != "" || o.ShippedAt != nil {
		return false
	}
	switch o.Status {
	case "pending", "paid", "confirmed", "processing":
		return true
	}
	return false
}

// DeliverySubsidy is what Growman absorbed on this order's delivery:
// positive when the courier cost more than the customer was charged.
// Returns 0 until the actual courier cost is recorded.
func (o Order) DeliverySubsidy() float64 {
	if o.CourierCost == nil {
		return 0
	}
	return *o.CourierCost - o.DeliveryFee
}

// Payment represents a payment transaction
type Payment struct {
	Base
	OrderID           uint    `json:"orderId"`
	Order             Order   `json:"order"`
	RazorpayOrderID   string  `json:"razorpayOrderId"`
	RazorpayPaymentID string  `gorm:"uniqueIndex" json:"razorpayPaymentId"`
	Amount            float64 `json:"amount"`
	Currency          string  `json:"currency"`
	Status            string  `json:"status"` // created, authorized, captured, failed, refunded
	Method            string  `json:"method,omitempty"`
	Description       string  `json:"description,omitempty"`
}

// Wishlist represents a user's wishlist item
type Wishlist struct {
	Base
	UserID     uint    `gorm:"uniqueIndex:idx_user_product" json:"userId"`
	ProductID  uint    `gorm:"uniqueIndex:idx_user_product" json:"productId"`
	Product    Product `json:"product"`
	PriceAtAdd float64 `json:"priceAtAdd"`
}

// RequestedProduct stores user demand for missing/unavailable products.
type RequestedProduct struct {
	Base
	ProductName    string `gorm:"index;not null" json:"productName"`
	Details        string `gorm:"type:text" json:"details"`
	Status         string `gorm:"default:'pending';index" json:"status"` // pending, reviewed, added, rejected
	Source         string `gorm:"default:'manual';index" json:"source"`  // chatbot_auto, search_page, manual
	RequestedByID  *uint  `json:"requestedById,omitempty"`
	RequesterName  string `json:"requesterName,omitempty"`
	RequesterEmail string `json:"requesterEmail,omitempty"`
	RequesterPhone string `json:"requesterPhone,omitempty"`
	AdminNotes     string `gorm:"type:text" json:"adminNotes,omitempty"`
}

// DoothaWaitlist stores sign-ups for the Dootha Care device waiting list,
// collected by the first-visit popup on the storefront. Phone is the identity
// here: a repeat sign-up from the same number updates the existing row rather
// than adding another, so the list stays one entry per person.
type DoothaWaitlist struct {
	Base
	Name      string `gorm:"not null" json:"name"`
	Phone     string `gorm:"index;not null" json:"phone"`
	Email     string `gorm:"index" json:"email,omitempty"`
	Address   string `gorm:"type:text" json:"address,omitempty"`
	Status    string `gorm:"default:'pending';index" json:"status"`        // pending, contacted, converted
	Source    string `gorm:"default:'homepage_popup';index" json:"source"` // homepage_popup, manual
	UserID    *uint  `gorm:"index" json:"userId,omitempty"`
	IP        string `json:"ip,omitempty"`
	UserAgent string `json:"userAgent,omitempty"`
	// Signups counts how many times this number has submitted the form.
	Signups    int    `gorm:"default:1" json:"signups"`
	AdminNotes string `gorm:"type:text" json:"adminNotes,omitempty"`
}

// OrderSupportRequest stores delivery/support escalations from chat or support forms.
type OrderSupportRequest struct {
	Base
	OrderID          *uint   `gorm:"index" json:"orderId,omitempty"`
	UserID           *uint   `gorm:"index" json:"userId,omitempty"`
	CustomerName     string  `json:"customerName,omitempty"`
	CustomerEmail    string  `json:"customerEmail,omitempty"`
	CustomerPhone    string  `json:"customerPhone,omitempty"`
	IssueType        string  `gorm:"index" json:"issueType"` // delivery_delay, refund, tracking, order_support
	Priority         string  `gorm:"default:'high';index" json:"priority"`
	UserMessage      string  `gorm:"type:text;not null" json:"userMessage"`
	OrderStatus      string  `json:"orderStatus,omitempty"`
	PaymentStatus    string  `json:"paymentStatus,omitempty"`
	OrderAmount      float64 `json:"orderAmount,omitempty"`
	OrderItems       string  `gorm:"type:text" json:"orderItems,omitempty"`
	ExpectedDelivery string  `json:"expectedDelivery,omitempty"`
	Status           string  `gorm:"default:'pending';index" json:"status"` // pending, in_progress, resolved
	Source           string  `gorm:"default:'chatbot';index" json:"source"`
	AdminNotes       string  `gorm:"type:text" json:"adminNotes,omitempty"`
}

// WebhookEvent is the idempotency ledger for inbound provider webhooks.
// Razorpay has at-least-once delivery semantics and does not guarantee
// ordering, so every event is claimed by its provider event ID before any
// side effect runs. The unique index on EventID is what makes the claim
// atomic — a duplicate delivery loses the insert race and is dropped.
type WebhookEvent struct {
	Base
	Provider  string `gorm:"index:idx_webhook_provider;size:32" json:"provider"` // razorpay, shiprocket
	EventID   string `gorm:"uniqueIndex;size:128" json:"eventId"`
	EventType string `gorm:"index;size:64" json:"eventType"`
	// Status: received, processed, failed. Rows left in received/failed
	// are the replay queue for manual reconciliation.
	Status      string     `gorm:"default:'received';index" json:"status"`
	Payload     string     `gorm:"type:text" json:"-"`
	Error       string     `gorm:"type:text" json:"error,omitempty"`
	Attempts    int        `gorm:"default:0" json:"attempts"`
	ProcessedAt *time.Time `json:"processedAt,omitempty"`
}

// Refund records a refund issued against an order. Created when ops (or a
// cancellation) initiates one, then advanced by the provider's
// refund.processed / refund.failed webhooks.
type Refund struct {
	Base
	OrderID uint   `gorm:"index" json:"orderId"`
	Order   *Order `json:"order,omitempty"`
	// default:null for the same reason as Order.InvoiceNumber: this is
	// empty between writing the local refund row and the provider
	// answering, and two pending refunds must not collide on ''.
	// Partial unique index for the same reason as Order.InvoiceNumber: this
	// is empty between writing the local refund row and the provider
	// answering, so two pending refunds must not collide on ''.
	RazorpayRefundID  string  `gorm:"uniqueIndex:idx_refunds_razorpay_refund_id,where:razorpay_refund_id <> '';size:64" json:"razorpayRefundId,omitempty"`
	RazorpayPaymentID string  `gorm:"index;size:64" json:"razorpayPaymentId"`
	Amount            float64 `json:"amount"`
	Currency          string  `gorm:"default:'INR'" json:"currency"`
	// Status: pending, processed, failed.
	Status      string     `gorm:"default:'pending';index" json:"status"`
	Reason      string     `json:"reason,omitempty"` // customer_cancelled, damaged, wrong_item, out_of_stock, other
	Notes       string     `gorm:"type:text" json:"notes,omitempty"`
	InitiatedBy *uint      `json:"initiatedBy,omitempty"` // admin user ID, nil for system
	ProcessedAt *time.Time `json:"processedAt,omitempty"`
	// RestockedInventory guards against returning the same units to stock
	// twice if a refund webhook is replayed.
	RestockedInventory bool `gorm:"default:false" json:"-"`
}

// Coupon is a discount code. Validation and application happen server-side
// inside the fulfillment quote, so the total the customer pays is always
// the server's own arithmetic.
type Coupon struct {
	Base
	Code        string `gorm:"uniqueIndex;size:32" json:"code"`
	Description string `json:"description,omitempty"`
	// Type: percentage, fixed, free_shipping.
	Type  string  `gorm:"size:16" json:"type"`
	Value float64 `json:"value"` // percent for percentage, rupees for fixed, ignored for free_shipping
	// MaxDiscount caps a percentage coupon's rupee value. Zero means no cap.
	MaxDiscount float64 `json:"maxDiscount"`
	MinSubtotal float64 `json:"minSubtotal"`
	// UsageLimit is the global redemption cap; PerUserLimit is per
	// account. Zero means unlimited.
	UsageLimit   int `json:"usageLimit"`
	PerUserLimit int `gorm:"default:1" json:"perUserLimit"`
	UsageCount   int `gorm:"default:0" json:"usageCount"`
	// Scope: empty applies to the whole cart. Otherwise the discount only
	// considers lines in these categories/products.
	CategoryIDs StringArray `gorm:"type:text[]" json:"categoryIds,omitempty"`
	ProductIDs  StringArray `gorm:"type:text[]" json:"productIds,omitempty"`
	// FirstOrderOnly restricts the code to accounts with no paid orders.
	FirstOrderOnly bool       `gorm:"default:false" json:"firstOrderOnly"`
	StartsAt       *time.Time `json:"startsAt,omitempty"`
	ExpiresAt      *time.Time `json:"expiresAt,omitempty"`
	Active         bool       `gorm:"default:true;index" json:"active"`
}

// CouponRedemption records a successful application, enforcing per-user
// limits and giving a per-campaign audit trail.
type CouponRedemption struct {
	Base
	CouponID uint    `gorm:"index:idx_redemption_coupon_user" json:"couponId"`
	UserID   *uint   `gorm:"index:idx_redemption_coupon_user" json:"userId,omitempty"`
	Email    string  `gorm:"index;size:255" json:"email,omitempty"` // guest identity
	OrderID  uint    `gorm:"index" json:"orderId"`
	Amount   float64 `json:"amount"`
}

// Address is a saved shipping address so repeat customers do not retype it.
type Address struct {
	Base
	UserID      uint     `gorm:"index" json:"userId"`
	Label       string   `json:"label,omitempty"` // Home, Office
	Name        string   `json:"name"`
	Phone       string   `json:"phone"`
	AddressLine string   `json:"addressLine"`
	City        string   `json:"city"`
	State       string   `json:"state"`
	Pincode     string   `json:"pincode"`
	Latitude    *float64 `json:"latitude,omitempty"`
	Longitude   *float64 `json:"longitude,omitempty"`
	IsDefault   bool     `gorm:"default:false" json:"isDefault"`
}

// ConsentRecord is the DPDP Act audit trail: what the data principal
// agreed to, when, and against which version of the notice. Withdrawal is
// recorded as a new row with Granted=false rather than by mutating the
// original, so consent history is never lost.
type ConsentRecord struct {
	Base
	UserID *uint  `gorm:"index" json:"userId,omitempty"`
	Email  string `gorm:"index;size:255" json:"email,omitempty"`
	// Purpose: essential, analytics, marketing, personalisation.
	Purpose       string `gorm:"index;size:32" json:"purpose"`
	Granted       bool   `json:"granted"`
	NoticeVersion string `gorm:"size:16" json:"noticeVersion"`
	IP            string `json:"ip,omitempty"`
	UserAgent     string `json:"userAgent,omitempty"`
}

// BackInStockRequest is a notification subscription for an out-of-stock
// item. For a nursery with seasonal availability this doubles as a demand
// signal for what to propagate next.
type BackInStockRequest struct {
	Base
	ProductID     uint       `gorm:"index:idx_bis_product_email" json:"productId"`
	ProductSizeID *uint      `json:"productSizeId,omitempty"`
	Email         string     `gorm:"index:idx_bis_product_email;size:255" json:"email"`
	UserID        *uint      `gorm:"index" json:"userId,omitempty"`
	NotifiedAt    *time.Time `json:"notifiedAt,omitempty"`
}

// OwnedPlant is a plant in a customer's own collection, separate from the
// shop catalog. Reminders and health notes hang off this row.
type OwnedPlant struct {
	Base
	UserID             uint       `gorm:"index:idx_owned_plants_user" json:"userId"`
	Name               string     `gorm:"size:80" json:"name"`
	Location           string     `gorm:"size:80" json:"location,omitempty"`
	Notes              string     `gorm:"size:1000" json:"notes,omitempty"`
	WaterEveryDays     int        `json:"waterEveryDays"`
	FertilizeEveryDays int        `json:"fertilizeEveryDays"`
	WaterNextAt        *time.Time `json:"waterNextAt,omitempty"`
	FertilizeNextAt    *time.Time `json:"fertilizeNextAt,omitempty"`
	WaterReminder      bool       `gorm:"default:true" json:"waterReminder"`
	FertilizeReminder  bool       `gorm:"default:true" json:"fertilizeReminder"`
	PhotoURL           string     `gorm:"size:500" json:"photoUrl,omitempty"`
	ProductID          *uint      `json:"productId,omitempty"`
	ProductSlug        string     `gorm:"size:180" json:"productSlug,omitempty"`
	Room               string     `gorm:"size:40" json:"room,omitempty"`
	MistEveryDays      int        `json:"mistEveryDays"`
	RotateEveryDays    int        `json:"rotateEveryDays"`
	RepotEveryDays     int        `json:"repotEveryDays"`
	PruneEveryDays     int        `json:"pruneEveryDays"`
	MistReminder       bool       `json:"mistReminder"`
	RotateReminder     bool       `json:"rotateReminder"`
	RepotReminder      bool       `json:"repotReminder"`
	PruneReminder      bool       `json:"pruneReminder"`
	MistNextAt         *time.Time `json:"mistNextAt,omitempty"`
	RotateNextAt       *time.Time `json:"rotateNextAt,omitempty"`
	RepotNextAt        *time.Time `json:"repotNextAt,omitempty"`
	PruneNextAt        *time.Time `json:"pruneNextAt,omitempty"`
	SnoozedUntil       *time.Time `json:"snoozedUntil,omitempty"`
}

// PlantHealthLog is one observation of how an owned plant is doing.
type PlantHealthLog struct {
	Base
	OwnedPlantID uint       `gorm:"index" json:"ownedPlantId"`
	UserID       uint       `gorm:"index" json:"userId"`
	Status       string     `gorm:"size:32" json:"status"`
	Notes        string     `gorm:"size:1000" json:"notes,omitempty"`
	PhotoURL     string     `gorm:"size:500" json:"photoUrl,omitempty"`
	RecordedAt   time.Time  `json:"recordedAt"`
	FollowUpAt   *time.Time `json:"followUpAt,omitempty"`
}

// NotificationPreference is the customer's choice of which alerts to receive.
type NotificationPreference struct {
	Base
	UserID         uint       `gorm:"uniqueIndex" json:"userId"`
	OrderUpdates   bool       `gorm:"default:true" json:"orderUpdates"`
	Promotions     bool       `gorm:"default:false" json:"promotions"`
	CareReminders  bool       `gorm:"default:true" json:"careReminders"`
	WeatherAlerts  bool       `gorm:"default:true" json:"weatherAlerts"`
	DoothaAlerts   bool       `gorm:"default:true" json:"doothaAlerts"`
	ReminderHour   int        `gorm:"default:8" json:"reminderHour"`
	QuietStartHour int        `gorm:"default:22" json:"quietStartHour"`
	QuietEndHour   int        `gorm:"default:7" json:"quietEndHour"`
	VacationUntil  *time.Time `json:"vacationUntil,omitempty"`
	PushToken      string     `gorm:"size:255" json:"-"`
}

// AppNotification is an in-app alert, including care reminders that are due.
type AppNotification struct {
	Base
	UserID       uint       `gorm:"index" json:"userId"`
	Kind         string     `gorm:"size:32" json:"kind"`
	Title        string     `gorm:"size:140" json:"title"`
	Body         string     `gorm:"size:500" json:"body"`
	OwnedPlantID *uint      `json:"ownedPlantId,omitempty"`
	OrderID      *uint      `json:"orderId,omitempty"`
	ProductID    *uint      `json:"productId,omitempty"`
	Href         string     `gorm:"size:200" json:"href,omitempty"`
	ReadAt       *time.Time `json:"readAt,omitempty"`
	// DedupeKey stops the same watering day from being inserted twice.
	DedupeKey string `gorm:"uniqueIndex;size:120" json:"-"`
}

// SavedItem is a product held out of the cart, with the size and pot the
// customer had in mind.
type SavedItem struct {
	Base
	UserID        uint    `gorm:"uniqueIndex:idx_saved_user_product" json:"userId"`
	ProductID     uint    `gorm:"uniqueIndex:idx_saved_user_product" json:"productId"`
	Product       Product `json:"product"`
	ProductSizeID *uint   `json:"productSizeId,omitempty"`
	Pot           string  `gorm:"size:80" json:"pot,omitempty"`
	Quantity      int     `gorm:"default:1" json:"quantity"`
}

// StoreCredit is the customer's reward balance in rupees.
type StoreCredit struct {
	Base
	UserID  uint    `gorm:"uniqueIndex" json:"userId"`
	Balance float64 `json:"balance"`
}

// CreditEntry is one change to a store-credit balance.
type CreditEntry struct {
	Base
	UserID  uint    `gorm:"index" json:"userId"`
	Amount  float64 `json:"amount"`
	Reason  string  `gorm:"size:40" json:"reason"`
	OrderID *uint   `json:"orderId,omitempty"`
}

// SavedPaymentMethod stores a label the customer can recognise at checkout.
// Full card numbers are never stored; a card row keeps brand and last four.
type SavedPaymentMethod struct {
	Base
	UserID    uint   `gorm:"index" json:"userId"`
	Kind      string `gorm:"size:16" json:"kind"` // upi, card
	Label     string `gorm:"size:40" json:"label"`
	Detail    string `gorm:"size:80" json:"detail"`
	IsDefault bool   `json:"isDefault"`
}

// RecentView is a product the customer opened, newest first.
type RecentView struct {
	Base
	UserID    uint      `gorm:"uniqueIndex:idx_recent_user_product" json:"userId"`
	ProductID uint      `gorm:"uniqueIndex:idx_recent_user_product" json:"productId"`
	Product   Product   `json:"product"`
	ViewedAt  time.Time `json:"viewedAt"`
}

// CartSnapshot is the last cart the app reported, used for low-stock and
// abandoned-cart alerts.
type CartSnapshot struct {
	Base
	UserID     uint       `gorm:"uniqueIndex" json:"userId"`
	ItemsJSON  string     `gorm:"type:text" json:"-"`
	ItemCount  int        `json:"itemCount"`
	NotifiedAt *time.Time `json:"-"`
}

// ChatTurn is one line of a customer's Dootha conversation.
type ChatTurn struct {
	Base
	UserID  uint   `gorm:"index" json:"userId"`
	Role    string `gorm:"size:16" json:"role"`
	Content string `gorm:"type:text" json:"content"`
}

// QuoteRequest is a bulk quotation the customer can follow: sent, revised, or accepted.
type QuoteRequest struct {
	Base
	UserID     *uint   `gorm:"index" json:"userId,omitempty"`
	EstimateNo string  `gorm:"size:40;index" json:"estimateNo"`
	Name       string  `gorm:"size:100" json:"name"`
	Phone      string  `gorm:"size:20" json:"phone"`
	Email      string  `gorm:"size:160" json:"email,omitempty"`
	Summary    string  `gorm:"size:300" json:"summary"`
	Amount     float64 `json:"amount"`
	Status     string  `gorm:"size:16;default:'sent';index" json:"status"`
}
