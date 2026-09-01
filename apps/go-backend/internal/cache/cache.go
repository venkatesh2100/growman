package cache

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"hash/fnv"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-redis/redis/v8"
	"golang.org/x/sync/singleflight"
)

const (
	DefaultTTL = 10 * time.Minute

	FeaturedProductsTTL = 10 * time.Minute
	AllProductsTTL      = 5 * time.Minute
	ProductDetailTTL    = 30 * time.Minute
	RelatedProductsTTL  = 10 * time.Minute

	AllCategoriesTTL  = 10 * time.Minute
	CategoryDetailTTL = 15 * time.Minute
	CatalogTTL        = 10 * time.Minute
	BrandsTTL         = 15 * time.Minute
	TagsTTL           = 10 * time.Minute

	// L1 keeps hot product/catalog responses in-process (avoids Redis RTT).
	localTTL     = 2 * time.Minute
	localMaxKeys = 4096
	redisGetWait = 120 * time.Millisecond
	redisSetWait = 200 * time.Millisecond

	KeyPrefixFeaturedProducts = "products:featured"
	KeyPrefixAllProducts      = "products:all"
	KeyPrefixProductDetail    = "products:detail:"
	KeyPrefixRelatedProducts  = "products:related:"
	KeyPrefixProductList      = "products:list:"
	KeyPrefixProductSearch    = "products:search:"
	KeyPrefixCatProducts      = "products:cat:"
	KeyPrefixSubcatProducts   = "products:subcat:"

	KeyPrefixAllCategories  = "categories:all"
	KeyPrefixCategoryDetail = "categories:detail:"
	KeyPrefixSubcategories  = "categories:subs:"
	KeyPrefixBrands         = "brands:all"
	KeyPrefixTags           = "tags:all"
	KeyPrefixCatalog        = "catalog:nav"
)

type localItem struct {
	data []byte
	exp  time.Time
}

// Helper provides two-tier caching (process memory + Redis) with stampede protection.
type Helper struct {
	Redis *redis.Client
	sf    singleflight.Group
	mu    sync.RWMutex
	local map[string]localItem
}

// NewHelper creates a new cache helper. Redis may be nil (L1-only).
func NewHelper(rdb *redis.Client) *Helper {
	return &Helper{
		Redis: rdb,
		local: make(map[string]localItem, 64),
	}
}

func (c *Helper) Get(ctx context.Context, key string, dest interface{}) (bool, error) {
	raw, ok := c.GetRaw(ctx, key)
	if !ok {
		return false, nil
	}
	if err := json.Unmarshal(raw, dest); err != nil {
		c.drop(ctx, key)
		return false, err
	}
	return true, nil
}

func (c *Helper) Set(ctx context.Context, key string, value interface{}, ttl time.Duration) error {
	if c == nil {
		return nil
	}
	data, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("failed to marshal data: %w", err)
	}
	return c.SetRaw(ctx, key, data, ttl)
}

func (c *Helper) GetRaw(ctx context.Context, key string) ([]byte, bool) {
	if c == nil {
		return nil, false
	}
	if data, ok := c.getLocal(key); ok {
		return data, true
	}
	if c.Redis == nil {
		return nil, false
	}
	rctx, cancel := context.WithTimeout(ctx, redisGetWait)
	defer cancel()
	cached, err := c.Redis.Get(rctx, key).Bytes()
	if err == redis.Nil || err != nil {
		return nil, false
	}
	c.setLocal(key, cached, localTTL)
	return cached, true
}

func (c *Helper) SetRaw(ctx context.Context, key string, data []byte, ttl time.Duration) error {
	if c == nil || len(data) == 0 {
		return nil
	}
	lttl := localTTL
	if ttl > 0 && ttl < lttl {
		lttl = ttl
	}
	c.setLocal(key, data, lttl)
	if c.Redis == nil {
		return nil
	}
	// Don't block the request on Redis writes — L1 already has the value.
	go func() {
		rctx, cancel := context.WithTimeout(context.Background(), redisSetWait)
		defer cancel()
		_ = c.Redis.Set(rctx, key, data, ttl).Err()
	}()
	return nil
}

// GetOrLoadRaw coalesces concurrent misses for the same key (cache stampede protection).
func (c *Helper) GetOrLoadRaw(ctx context.Context, key string, ttl time.Duration, load func() ([]byte, error)) ([]byte, error) {
	if raw, ok := c.GetRaw(ctx, key); ok {
		return raw, nil
	}
	if c == nil {
		return load()
	}
	v, err, _ := c.sf.Do(key, func() (interface{}, error) {
		if raw, ok := c.GetRaw(ctx, key); ok {
			return raw, nil
		}
		raw, err := load()
		if err != nil {
			return nil, err
		}
		_ = c.SetRaw(ctx, key, raw, ttl)
		return raw, nil
	})
	if err != nil {
		return nil, err
	}
	return v.([]byte), nil
}

func (c *Helper) Delete(ctx context.Context, keys ...string) error {
	if c == nil || len(keys) == 0 {
		return nil
	}
	c.mu.Lock()
	for _, k := range keys {
		delete(c.local, k)
	}
	c.mu.Unlock()
	if c.Redis == nil {
		return nil
	}
	if err := c.Redis.Unlink(ctx, keys...).Err(); err != nil {
		return err
	}
	return nil
}

func (c *Helper) DeletePattern(ctx context.Context, pattern string) error {
	if c == nil {
		return nil
	}
	c.deleteLocalPattern(pattern)
	if c.Redis == nil {
		return nil
	}

	var cursor uint64
	for {
		keys, next, err := c.Redis.Scan(ctx, cursor, pattern, 200).Result()
		if err != nil {
			return err
		}
		if len(keys) > 0 {
			if err := c.Redis.Unlink(ctx, keys...).Err(); err != nil {
				return err
			}
		}
		cursor = next
		if cursor == 0 {
			break
		}
	}
	return nil
}

func (c *Helper) Exists(ctx context.Context, key string) (bool, error) {
	if _, ok := c.GetRaw(ctx, key); ok {
		return true, nil
	}
	return false, nil
}

func (c *Helper) drop(ctx context.Context, key string) {
	_ = c.Delete(ctx, key)
}

func (c *Helper) getLocal(key string) ([]byte, bool) {
	c.mu.RLock()
	item, ok := c.local[key]
	c.mu.RUnlock()
	if !ok || time.Now().After(item.exp) {
		if ok {
			c.mu.Lock()
			delete(c.local, key)
			c.mu.Unlock()
		}
		return nil, false
	}
	return item.data, true
}

func (c *Helper) setLocal(key string, data []byte, ttl time.Duration) {
	if ttl <= 0 {
		ttl = localTTL
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.local) >= localMaxKeys {
		now := time.Now()
		for k, v := range c.local {
			if now.After(v.exp) {
				delete(c.local, k)
			}
		}
		if len(c.local) >= localMaxKeys {
			// Evict an arbitrary ~12.5% to keep the map bounded.
			n := 0
			limit := localMaxKeys / 8
			for k := range c.local {
				delete(c.local, k)
				n++
				if n >= limit {
					break
				}
			}
		}
	}
	c.local[key] = localItem{data: data, exp: time.Now().Add(ttl)}
}

func (c *Helper) deleteLocalPattern(pattern string) {
	prefix := strings.TrimSuffix(pattern, "*")
	c.mu.Lock()
	defer c.mu.Unlock()
	if prefix == pattern {
		delete(c.local, pattern)
		return
	}
	for k := range c.local {
		if strings.HasPrefix(k, prefix) {
			delete(c.local, k)
		}
	}
}

// ServePublic writes cached JSON with short browser/CDN caching and ETag support.
func ServePublic(w http.ResponseWriter, r *http.Request, raw []byte) {
	etag := etagOf(raw)
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=120, stale-while-revalidate=300")
	w.Header().Set("ETag", etag)
	w.Header().Set("Vary", "Accept-Encoding")
	if noneMatch(r.Header.Get("If-None-Match"), etag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("Content-Length", strconv.Itoa(len(raw)))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(raw)
}

// ServePrivate writes cached JSON that must not be stored by shared caches.
func ServePrivate(w http.ResponseWriter, raw []byte) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("Content-Length", strconv.Itoa(len(raw)))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(raw)
}

func etagOf(b []byte) string {
	h := fnv.New64a()
	_, _ = h.Write(b)
	return `"` + strconv.FormatUint(h.Sum64(), 16) + `"`
}

func noneMatch(header, etag string) bool {
	if header == "" {
		return false
	}
	for _, part := range strings.Split(header, ",") {
		if strings.TrimSpace(part) == etag {
			return true
		}
	}
	return false
}

// HashKey returns a short stable hash for cache keys derived from user input.
func HashKey(s string) string {
	sum := sha1.Sum([]byte(strings.ToLower(strings.TrimSpace(s))))
	return hex.EncodeToString(sum[:8])
}

// ProductCache provides product-specific caching operations.
type ProductCache struct {
	*Helper
}

func NewProductCache(rdb *redis.Client) *ProductCache {
	return &ProductCache{Helper: NewHelper(rdb)}
}

func (pc *ProductCache) GetFeaturedProducts(ctx context.Context, dest interface{}) (bool, error) {
	return pc.Get(ctx, KeyPrefixFeaturedProducts, dest)
}

func (pc *ProductCache) SetFeaturedProducts(ctx context.Context, value interface{}) error {
	return pc.Set(ctx, KeyPrefixFeaturedProducts, value, FeaturedProductsTTL)
}

func (pc *ProductCache) GetAllProducts(ctx context.Context, dest interface{}) (bool, error) {
	return pc.Get(ctx, KeyPrefixAllProducts, dest)
}

func (pc *ProductCache) SetAllProducts(ctx context.Context, value interface{}) error {
	return pc.Set(ctx, KeyPrefixAllProducts, value, AllProductsTTL)
}

func (pc *ProductCache) GetProductDetail(ctx context.Context, slug string, dest interface{}) (bool, error) {
	return pc.Get(ctx, KeyPrefixProductDetail+slug, dest)
}

func (pc *ProductCache) SetProductDetail(ctx context.Context, slug string, value interface{}) error {
	return pc.Set(ctx, KeyPrefixProductDetail+slug, value, ProductDetailTTL)
}

func (pc *ProductCache) GetRelatedProducts(ctx context.Context, slug string, dest interface{}) (bool, error) {
	return pc.Get(ctx, KeyPrefixRelatedProducts+slug, dest)
}

func (pc *ProductCache) SetRelatedProducts(ctx context.Context, slug string, value interface{}) error {
	return pc.Set(ctx, KeyPrefixRelatedProducts+slug, value, RelatedProductsTTL)
}

func (pc *ProductCache) InvalidateAllProductCaches(ctx context.Context) error {
	if pc == nil {
		return nil
	}
	patterns := []string{
		KeyPrefixFeaturedProducts + "*",
		KeyPrefixAllProducts + "*",
		KeyPrefixProductDetail + "*",
		KeyPrefixRelatedProducts + "*",
		KeyPrefixProductList + "*",
		KeyPrefixProductSearch + "*",
		KeyPrefixCatProducts + "*",
		KeyPrefixSubcatProducts + "*",
		"products:*",
		KeyPrefixTags,
		KeyPrefixCatalog,
	}
	for _, pattern := range patterns {
		if err := pc.DeletePattern(ctx, pattern); err != nil {
		}
	}
	return nil
}

func (pc *ProductCache) InvalidateProductDetail(ctx context.Context, slug string) error {
	_ = pc.Delete(ctx,
		KeyPrefixProductDetail+slug,
		KeyPrefixRelatedProducts+slug,
		KeyPrefixFeaturedProducts,
		KeyPrefixAllProducts,
		KeyPrefixTags,
		KeyPrefixCatalog,
	)
	_ = pc.DeletePattern(ctx, KeyPrefixProductList+"*")
	_ = pc.DeletePattern(ctx, "products:featured*")
	_ = pc.DeletePattern(ctx, KeyPrefixProductSearch+"*")
	_ = pc.DeletePattern(ctx, KeyPrefixCatProducts+"*")
	_ = pc.DeletePattern(ctx, KeyPrefixSubcatProducts+"*")
	return nil
}

// CategoryCache provides category-specific caching operations.
type CategoryCache struct {
	*Helper
}

func NewCategoryCache(rdb *redis.Client) *CategoryCache {
	return &CategoryCache{Helper: NewHelper(rdb)}
}

func (cc *CategoryCache) GetAllCategories(ctx context.Context, dest interface{}) (bool, error) {
	return cc.Get(ctx, KeyPrefixAllCategories, dest)
}

func (cc *CategoryCache) SetAllCategories(ctx context.Context, value interface{}) error {
	return cc.Set(ctx, KeyPrefixAllCategories, value, AllCategoriesTTL)
}

func (cc *CategoryCache) GetCategoryDetail(ctx context.Context, slug string, dest interface{}) (bool, error) {
	return cc.Get(ctx, KeyPrefixCategoryDetail+slug, dest)
}

func (cc *CategoryCache) SetCategoryDetail(ctx context.Context, slug string, value interface{}) error {
	return cc.Set(ctx, KeyPrefixCategoryDetail+slug, value, CategoryDetailTTL)
}

func (cc *CategoryCache) InvalidateAllCategoryCaches(ctx context.Context) error {
	if cc == nil {
		return nil
	}
	patterns := []string{
		KeyPrefixAllCategories,
		KeyPrefixCategoryDetail + "*",
		KeyPrefixSubcategories + "*",
		KeyPrefixCatalog,
		KeyPrefixCatProducts + "*",
		KeyPrefixSubcatProducts + "*",
	}
	for _, pattern := range patterns {
		if err := cc.DeletePattern(ctx, pattern); err != nil {
		}
	}
	return nil
}
