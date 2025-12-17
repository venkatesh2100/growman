package db

import (
    "context"
    "log"
    "time"

    "github.com/go-redis/redis/v8"
    "github.com/venkatesh2100/growman/apps/go-backend/internal/config"
)

// ConnectRedis establishes a connection to Redis and returns a client.
func ConnectRedis(cfg config.Config) *redis.Client {
    if cfg.REDIS_URL == "" {
        log.Println("[REDIS] REDIS_URL not set, Redis features will be disabled")
        return nil
    }

    opt, err := redis.ParseURL(cfg.REDIS_URL)
    if err != nil {
        log.Printf("[REDIS] Failed to parse REDIS_URL: %v (continuing without Redis)", err)
        return nil
    }

    rdb := redis.NewClient(opt)

    // Test the connection
    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()

    if err := rdb.Ping(ctx).Err(); err != nil {
        log.Printf("[REDIS] Failed to connect to Redis: %v (continuing without Redis)", err)
        return nil
    }

    log.Println("[REDIS] Successfully connected to Redis")
    return rdb
}