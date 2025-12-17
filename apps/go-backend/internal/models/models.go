package models

import (
	"time"

	"github.com/lib/pq"
	"gorm.io/gorm"
)

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
	Tags           pq.StringArray `gorm:"type:text[]" json:"tags"`
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
	Images    pq.StringArray `gorm:"type:text[]" json:"images"`
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
