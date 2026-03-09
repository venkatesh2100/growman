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
func (a *StringArray) Scan(value interface{}) error {
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
	Name          string   `json:"name"`
	Email         string   `gorm:"uniqueIndex" json:"email"`
	Phone         string   `gorm:"uniqueIndex" json:"phone"`
	PasswordHash  string   `json:"-"`
	EmailVerified bool     `gorm:"default:false" json:"emailVerified"`
	Provider      string   `gorm:"default:'local'" json:"provider"` // 'local' or 'google'
	Role          string   `json:"role"`
	// Address fields
	AddressLine   string   `json:"addressLine,omitempty"`
	City          string   `json:"city,omitempty"`
	State         string   `json:"state,omitempty"`
	Pincode       string   `json:"pincode,omitempty"`
	Country       string   `json:"country,omitempty"`
	Latitude      *float64 `json:"latitude,omitempty"`
	Longitude     *float64 `json:"longitude,omitempty"`
	Reviews       []Review `json:"reviews"`
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
	Name           string         `json:"name"`
	Slug           string         `gorm:"uniqueIndex" json:"slug"`
	Description    string         `json:"description"`
	ShortDesc      string         `json:"shortDescription"`
	FullDesc       string         `json:"fullDescription"`
	Specifications string         `json:"specifications"`
	TaxInfo        string         `json:"taxInfo"`
	Price          float64        `json:"price"` // price in currency units
	MRP            float64        `json:"mrp"`
	Currency       string         `json:"currency"`
	ImageKey       string         `gorm:"column:image_key" json:"imageKey"` // Storage-agnostic image key (e.g., "products/130239.jpg")
	ImageURL       string         `gorm:"-" json:"imageUrl"` // Resolved URL (not stored in DB, computed from ImageKey)
	Status         string         `json:"status"`
	Featured       bool           `json:"featured"`
	Tags           StringArray    `gorm:"type:text[]" json:"tags"`
	Stock          int            `json:"stock"`
	CategoryID     uint           `json:"categoryId"`
	Category       Category       `json:"category"`
	SubcategoryID  *uint          `json:"subcategoryId"`
	Subcategory    *Subcategory   `json:"subcategory"`
	BrandID        *uint          `json:"brandId"`
	Brand          *Brand         `json:"brand"`
	Sizes          []ProductSize  `json:"sizes"`
	Attributes     []Attribute    `json:"attributes"`
	Reviews        []Review       `json:"reviews"`
}

type ProductSize struct {
	Base
	Label      string         `json:"label"`
	Price      float64        `json:"price"`
	Stock      int            `json:"stock"`
	ProductID  uint           `json:"productId"`
	ImageKeys  StringArray    `gorm:"type:text[];column:image_keys" json:"imageKeys"` // Storage-agnostic image keys
	Images     StringArray    `gorm:"-" json:"images"` // Resolved URLs (not stored in DB, computed from ImageKeys)
}

type Attribute struct {
	Base
	Name      string `json:"name"`
	Value     string `json:"value"`
	ProductID uint   `json:"productId"`
}

type Review struct {
	Base
	Rating    int    `json:"rating"`
	Comment   string `json:"comment"`
	ProductID uint   `json:"productId"`
	UserID    uint   `json:"userId"`
	User      User   `json:"user"`
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
	ImageURL    string  `gorm:"-" json:"imageUrl"` // Resolved URL (not stored in DB, computed from ImageKey)
}

// Order represents a customer order
type Order struct {
	Base
	UserID          *uint       `json:"userId,omitempty"`
	User            *User       `json:"user,omitempty"`
	RazorpayOrderID string      `gorm:"uniqueIndex" json:"razorpayOrderId"`
	RazorpayPaymentID string    `json:"razorpayPaymentId,omitempty"`
	PaymentStatus   string      `gorm:"default:'created'" json:"paymentStatus"` // created, paid, failed
	Status          string      `json:"status"` // pending, paid, failed, cancelled (legacy)
	Amount          float64     `json:"amount"`
	Currency        string      `json:"currency"`
	Items           []OrderItem `json:"items"`
	// Customer info
	CustomerName    string      `json:"customerName,omitempty"`
	CustomerEmail   string      `json:"customerEmail,omitempty"`
	CustomerPhone   string      `json:"customerPhone,omitempty"`
	// Address fields
	AddressLine     string      `json:"addressLine,omitempty"`
	City            string      `json:"city,omitempty"`
	State           string      `json:"state,omitempty"`
	Pincode         string      `json:"pincode,omitempty"`
	// Legacy fields (for backward compatibility)
	ShippingAddress string      `json:"shippingAddress,omitempty"`
	BillingAddress  string      `json:"billingAddress,omitempty"`
}

// Payment represents a payment transaction
type Payment struct {
	Base
	OrderID         uint    `json:"orderId"`
	Order           Order   `json:"order"`
	RazorpayOrderID string  `json:"razorpayOrderId"`
	RazorpayPaymentID string `gorm:"uniqueIndex" json:"razorpayPaymentId"`
	Amount          float64 `json:"amount"`
	Currency        string  `json:"currency"`
	Status          string  `json:"status"` // created, authorized, captured, failed, refunded
	Method          string  `json:"method,omitempty"`
	Description     string  `json:"description,omitempty"`
}

// Wishlist represents a user's wishlist item
type Wishlist struct {
	Base
	UserID    uint    `gorm:"uniqueIndex:idx_user_product" json:"userId"`
	ProductID uint    `gorm:"uniqueIndex:idx_user_product" json:"productId"`
	Product   Product `json:"product"`
}
