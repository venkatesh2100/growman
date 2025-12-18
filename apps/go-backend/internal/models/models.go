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
	Name         string   `json:"name"`
	Email        string   `gorm:"uniqueIndex" json:"email"`
	PasswordHash string   `json:"-"`
	Role         string   `json:"role"`
	Reviews      []Review `json:"reviews"`
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
	ImageURL       string         `json:"imageUrl"`
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
	Label     string         `json:"label"`
	Price     float64        `json:"price"`
	Stock     int            `json:"stock"`
	ProductID uint           `json:"productId"`
	Images    StringArray    `gorm:"type:text[]" json:"images"`
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
