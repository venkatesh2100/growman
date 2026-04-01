package cache

import (
    "context"
    "encoding/json"
    "fmt"
    "log"
    "time"

    "github.com/go-redis/redis/v8"
)

const (
    DefaultTTL = 10 * time.Minute
    
    // Product cache TTLs
    FeaturedProductsTTL = 10 * time.Minute
    AllProductsTTL      = 5 * time.Minute
    ProductDetailTTL    = 15 * time.Minute
    RelatedProductsTTL  = 10 * time.Minute
    
    // Category cache TTLs
    AllCategoriesTTL = 10 * time.Minute
    CategoryDetailTTL = 15 * time.Minute
    
    // Product cache key prefixes
    KeyPrefixFeaturedProducts = "products:featured"
    KeyPrefixAllProducts      = "products:all"
    KeyPrefixProductDetail    = "products:detail:"
    KeyPrefixRelatedProducts  = "products:related:"
    
    // Category cache key prefixes
    KeyPrefixAllCategories = "categories:all"
    KeyPrefixCategoryDetail = "categories:detail:"
)

// Helper provides common caching operations.
type Helper struct {
    Redis *redis.Client
}

// NewHelper creates a new cache helper.
func NewHelper(rdb *redis.Client) *Helper {
    return &Helper{Redis: rdb}
}

// Get retrieves and unmarshals cached data.
func (c *Helper) Get(ctx context.Context, key string, dest interface{}) (bool, error) {
    if c.Redis == nil {
        return false, nil
    }

    cached, err := c.Redis.Get(ctx, key).Result()
    if err == redis.Nil {
        return false, nil // Cache miss
    }
    if err != nil {
        log.Printf("[CACHE] Error getting key %s: %v", key, err)
        return false, err
    }

    if err := json.Unmarshal([]byte(cached), dest); err != nil {
        log.Printf("[CACHE] Error unmarshaling key %s: %v", key, err)
        return false, err
    }

    log.Printf("[CACHE] Cache hit for key: %s", key)
    return true, nil
}

// Set marshals and stores data in cache with TTL.
func (c *Helper) Set(ctx context.Context, key string, value interface{}, ttl time.Duration) error {
    if c.Redis == nil {
        return nil
    }

    data, err := json.Marshal(value)
    if err != nil {
        return fmt.Errorf("failed to marshal data: %w", err)
    }

    if err := c.Redis.Set(ctx, key, data, ttl).Err(); err != nil {
        log.Printf("[CACHE] Error setting key %s: %v", key, err)
        return err
    }

    log.Printf("[CACHE] Cached key: %s (TTL: %v)", key, ttl)
    return nil
}

// Delete removes a key from cache.
func (c *Helper) Delete(ctx context.Context, keys ...string) error {
    if c.Redis == nil {
        return nil
    }

    if err := c.Redis.Del(ctx, keys...).Err(); err != nil {
        log.Printf("[CACHE] Error deleting keys %v: %v", keys, err)
        return err
    }

    log.Printf("[CACHE] Deleted keys: %v", keys)
    return nil
}

// DeletePattern deletes all keys matching a pattern.
func (c *Helper) DeletePattern(ctx context.Context, pattern string) error {
    if c.Redis == nil {
        return nil
    }

    iter := c.Redis.Scan(ctx, 0, pattern, 0).Iterator()
    var keys []string

    for iter.Next(ctx) {
        keys = append(keys, iter.Val())
    }

    if err := iter.Err(); err != nil {
        return err
    }

    if len(keys) > 0 {
        return c.Delete(ctx, keys...)
    }

    return nil
}

// Exists checks if a key exists in cache.
func (c *Helper) Exists(ctx context.Context, key string) (bool, error) {
    if c.Redis == nil {
        return false, nil
    }

    count, err := c.Redis.Exists(ctx, key).Result()
    if err != nil {
        return false, err
    }

    return count > 0, nil
}

// ProductCache provides product-specific caching operations.
type ProductCache struct {
    *Helper
}

// NewProductCache creates a new product cache helper.
func NewProductCache(rdb *redis.Client) *ProductCache {
    return &ProductCache{Helper: NewHelper(rdb)}
}

// GetFeaturedProducts retrieves featured products from cache.
func (pc *ProductCache) GetFeaturedProducts(ctx context.Context, dest interface{}) (bool, error) {
    return pc.Get(ctx, KeyPrefixFeaturedProducts, dest)
}

// SetFeaturedProducts stores featured products in cache.
func (pc *ProductCache) SetFeaturedProducts(ctx context.Context, value interface{}) error {
    return pc.Set(ctx, KeyPrefixFeaturedProducts, value, FeaturedProductsTTL)
}

// GetAllProducts retrieves all products from cache.
func (pc *ProductCache) GetAllProducts(ctx context.Context, dest interface{}) (bool, error) {
    return pc.Get(ctx, KeyPrefixAllProducts, dest)
}

// SetAllProducts stores all products in cache.
func (pc *ProductCache) SetAllProducts(ctx context.Context, value interface{}) error {
    return pc.Set(ctx, KeyPrefixAllProducts, value, AllProductsTTL)
}

// GetProductDetail retrieves a single product detail from cache.
func (pc *ProductCache) GetProductDetail(ctx context.Context, slug string, dest interface{}) (bool, error) {
    return pc.Get(ctx, KeyPrefixProductDetail+slug, dest)
}

// SetProductDetail stores a single product detail in cache.
func (pc *ProductCache) SetProductDetail(ctx context.Context, slug string, value interface{}) error {
    return pc.Set(ctx, KeyPrefixProductDetail+slug, value, ProductDetailTTL)
}

// GetRelatedProducts retrieves related products from cache.
func (pc *ProductCache) GetRelatedProducts(ctx context.Context, slug string, dest interface{}) (bool, error) {
    return pc.Get(ctx, KeyPrefixRelatedProducts+slug, dest)
}

// SetRelatedProducts stores related products in cache.
func (pc *ProductCache) SetRelatedProducts(ctx context.Context, slug string, value interface{}) error {
    return pc.Set(ctx, KeyPrefixRelatedProducts+slug, value, RelatedProductsTTL)
}

// InvalidateAllProductCaches clears all product-related cache entries.
func (pc *ProductCache) InvalidateAllProductCaches(ctx context.Context) error {
    if pc.Redis == nil {
        return nil
    }
    
    patterns := []string{
        KeyPrefixFeaturedProducts,
        KeyPrefixAllProducts,
        KeyPrefixProductDetail + "*",
        KeyPrefixRelatedProducts + "*",
    }
    
    for _, pattern := range patterns {
        if err := pc.DeletePattern(ctx, pattern); err != nil {
            log.Printf("[CACHE] Error invalidating pattern %s: %v", pattern, err)
        }
    }
    
    log.Println("[CACHE] All product caches invalidated")
    return nil
}

// InvalidateProductDetail invalidates cache for a specific product and related products.
func (pc *ProductCache) InvalidateProductDetail(ctx context.Context, slug string) error {
    keys := []string{
        KeyPrefixProductDetail + slug,
        KeyPrefixRelatedProducts + slug,
        KeyPrefixFeaturedProducts,
        KeyPrefixAllProducts,
    }
    
    return pc.Delete(ctx, keys...)
}

// CategoryCache provides category-specific caching operations.
type CategoryCache struct {
    *Helper
}

// NewCategoryCache creates a new category cache helper.
func NewCategoryCache(rdb *redis.Client) *CategoryCache {
    return &CategoryCache{Helper: NewHelper(rdb)}
}

// GetAllCategories retrieves all categories from cache.
func (cc *CategoryCache) GetAllCategories(ctx context.Context, dest interface{}) (bool, error) {
    return cc.Get(ctx, KeyPrefixAllCategories, dest)
}

// SetAllCategories stores all categories in cache.
func (cc *CategoryCache) SetAllCategories(ctx context.Context, value interface{}) error {
    return cc.Set(ctx, KeyPrefixAllCategories, value, AllCategoriesTTL)
}

// GetCategoryDetail retrieves a single category detail from cache.
func (cc *CategoryCache) GetCategoryDetail(ctx context.Context, slug string, dest interface{}) (bool, error) {
    return cc.Get(ctx, KeyPrefixCategoryDetail+slug, dest)
}

// SetCategoryDetail stores a single category detail in cache.
func (cc *CategoryCache) SetCategoryDetail(ctx context.Context, slug string, value interface{}) error {
    return cc.Set(ctx, KeyPrefixCategoryDetail+slug, value, CategoryDetailTTL)
}

// InvalidateAllCategoryCaches clears all category-related cache entries.
func (cc *CategoryCache) InvalidateAllCategoryCaches(ctx context.Context) error {
    if cc.Redis == nil {
        return nil
    }
    
    patterns := []string{
        KeyPrefixAllCategories,
        KeyPrefixCategoryDetail + "*",
    }
    
    for _, pattern := range patterns {
        if err := cc.DeletePattern(ctx, pattern); err != nil {
            log.Printf("[CACHE] Error invalidating pattern %s: %v", pattern, err)
        }
    }
    
    log.Println("[CACHE] All category caches invalidated")
    return nil
}