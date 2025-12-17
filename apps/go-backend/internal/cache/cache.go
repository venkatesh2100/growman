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