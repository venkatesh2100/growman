package seed

import (
	"log"

	"github.com/venkatesh2100/growman/apps/go-backend/internal/models"
	"gorm.io/gorm"
)

// EnsureSampleData seeds a few rows for local development if tables are empty.
func EnsureSampleData(db *gorm.DB) error {
	log.Println("seeding sample data for go-backend...")

	// Users
	sellerEmail := "seller@example.com"
	seller := models.User{Email: &sellerEmail}
	if err := db.FirstOrCreate(&seller, seller).Error; err != nil {
		return err
	}
	db.Model(&seller).Updates(map[string]any{"name": "Seller", "role": "SELLER"})

	buyerEmail := "buyer@example.com"
	buyer := models.User{Email: &buyerEmail}
	if err := db.FirstOrCreate(&buyer, buyer).Error; err != nil {
		return err
	}
	db.Model(&buyer).Updates(map[string]any{"name": "Buyer", "role": "BUYER"})

	adminEmail := "admin@example.com"
	admin := models.User{Email: &adminEmail}
	if err := db.FirstOrCreate(&admin, admin).Error; err != nil {
		return err
	}
	db.Model(&admin).Updates(map[string]any{"name": "Admin", "role": "ADMIN"})

	// Categories
	outdoor := models.Category{Slug: "outdoor-plants"}
	if err := db.FirstOrCreate(&outdoor, outdoor).Error; err != nil {
		return err
	}
	db.Model(&outdoor).Updates(map[string]any{
		"name":        "Outdoor Plants",
		"description": "Plants suited for outdoor spaces",
	})

	indoor := models.Category{Slug: "indoor-plants"}
	if err := db.FirstOrCreate(&indoor, indoor).Error; err != nil {
		return err
	}
	db.Model(&indoor).Updates(map[string]any{
		"name":        "Indoor Plants",
		"description": "Great for low to medium light",
	})

	// Subcategories
	large := models.Subcategory{Slug: "large-plants", CategoryID: outdoor.ID}
	if err := db.FirstOrCreate(&large, large).Error; err != nil {
		return err
	}
	db.Model(&large).Updates(map[string]any{
		"name":        "Large Plants",
		"description": "Tall, statement outdoor plants",
	})

	air := models.Subcategory{Slug: "air-purifying", CategoryID: indoor.ID}
	if err := db.FirstOrCreate(&air, air).Error; err != nil {
		return err
	}
	db.Model(&air).Updates(map[string]any{
		"name":        "Air Purifying",
		"description": "Filters indoor air",
	})

	// Brands
	greenlife := models.Brand{Slug: "greenlife"}
	if err := db.FirstOrCreate(&greenlife, greenlife).Error; err != nil {
		return err
	}
	db.Model(&greenlife).Update("name", "GreenLife")

	plantParadise := models.Brand{Slug: "plant-paradise"}
	if err := db.FirstOrCreate(&plantParadise, plantParadise).Error; err != nil {
		return err
	}
	db.Model(&plantParadise).Update("name", "Plant Paradise")

	flora := models.Brand{Slug: "flora-gardens"}
	if err := db.FirstOrCreate(&flora, flora).Error; err != nil {
		return err
	}
	db.Model(&flora).Update("name", "Flora Gardens")

	// Products
	neem := models.Product{
		Name:           "Neem Plant (Azadirachta indica)",
		Slug:           "neem-plant",
		Description:    "Large medicinal plant with natural pest resistance",
		ShortDesc:      "Large medicinal plant with natural pest resistance",
		FullDesc:       "The Neem plant is known for its medicinal properties and natural pest resistance. This large specimen comes in a 12-inch pot and stands 3-4 feet tall. Ideal for outdoor gardens in warm climates.",
		Specifications: "Height: 3-4 ft | Pot: 12 in | Light: Full sun | Water: Moderate | Care: Easy",
		TaxInfo:        "Inclusive of all taxes",
		Price:          499,
		MRP:            799,
		Currency:       "INR",
		ImageURL:       "https://m.media-amazon.com/images/I/41cUNNALHWL.jpg",
		Status:         "active",
		Featured:       true,
		Tags:           []string{"neem", "outdoor", "large", "medicinal"},
		Stock:          20,
		CategoryID:     outdoor.ID,
		SubcategoryID:  &large.ID,
		BrandID:        &greenlife.ID,
	}
	if err := db.Where("slug = ?", neem.Slug).FirstOrCreate(&neem, neem).Error; err != nil {
		return err
	}

	// Product sizes with images
	sizeData := []models.ProductSize{
		{
			Label:     "Small (1-2 ft)",
			Price:     299,
			Stock:     10,
			ProductID: neem.ID,
			Images:    []string{"https://m.media-amazon.com/images/I/41cUNNALHWL.jpg", "https://m.media-amazon.com/images/I/713i7wgMS2L._SL1000_.jpg"},
		},
		{
			Label:     "Medium (2-3 ft)",
			Price:     499,
			Stock:     15,
			ProductID: neem.ID,
			Images:    []string{"https://www.toothmountainnursery.com/wp-content/uploads/2020/03/Neem.jpg"},
		},
		{
			Label:     "Large (3-4 ft)",
			Price:     799,
			Stock:     5,
			ProductID: neem.ID,
			Images:    []string{"https://m.media-amazon.com/images/I/517SDVgeO2L.jpg"},
		},
	}
	for _, s := range sizeData {
		var existing models.ProductSize
		err := db.Where("product_id = ? AND label = ?", neem.ID, s.Label).First(&existing).Error
		if err == nil {
			db.Model(&existing).Updates(map[string]any{"price": s.Price, "stock": s.Stock, "images": s.Images})
			continue
		}
		if err := db.Create(&s).Error; err != nil {
			return err
		}
	}

	// Attributes
	attrs := []models.Attribute{
		{Name: "Plant Type", Value: "Tree", ProductID: neem.ID},
		{Name: "Growth Rate", Value: "Fast", ProductID: neem.ID},
		{Name: "Flowering", Value: "Seasonal", ProductID: neem.ID},
		{Name: "Air Purifying", Value: "Yes", ProductID: neem.ID},
	}
	for _, a := range attrs {
		var existing models.Attribute
		if err := db.Where("product_id = ? AND name = ?", a.ProductID, a.Name).First(&existing).Error; err == nil {
			db.Model(&existing).Update("value", a.Value)
			continue
		}
		if err := db.Create(&a).Error; err != nil {
			return err
		}
	}

	// Reviews
	reviews := []models.Review{
		{Rating: 5, Comment: "Arrived in perfect condition. Growing well after 2 months.", ProductID: neem.ID, UserID: buyer.ID},
		{Rating: 4, Comment: "Good quality, slight shipping damage but recovered quickly.", ProductID: neem.ID, UserID: buyer.ID},
	}
	for _, r := range reviews {
		var existing models.Review
		if err := db.Where("product_id = ? AND user_id = ? AND rating = ?", r.ProductID, r.UserID, r.Rating).First(&existing).Error; err == nil {
			continue
		}
		if err := db.Create(&r).Error; err != nil {
			return err
		}
	}

	return nil
}
