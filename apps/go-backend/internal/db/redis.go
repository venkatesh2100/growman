package db

import (
	"context"
	"log"
	"time"

	"github.com/go-redis/redis/v8"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/config"
)

func ConnectRedis(cfg config.Config) *redis.Client {
	if cfg.REDIS_URL == "" {
		return nil
	}

	opt, err := redis.ParseURL(cfg.REDIS_URL)
	if err != nil {
		log.Printf("[REDIS] Failed to parse REDIS_URL: %v (continuing without Redis)", err)
		return nil
	}

	pool := cfg.RedisPoolSize
	if pool <= 0 {
		pool = 20
	}
	opt.PoolSize = pool
	opt.MinIdleConns = 2
	opt.IdleTimeout = 5 * time.Minute
	opt.DialTimeout = 1 * time.Second
	opt.ReadTimeout = 500 * time.Millisecond
	opt.WriteTimeout = 500 * time.Millisecond
	opt.PoolTimeout = 1 * time.Second

	rdb := redis.NewClient(opt)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := rdb.Ping(ctx).Err(); err != nil {
		log.Printf("[REDIS] Failed to connect to Redis: %v (continuing without Redis)", err)
		return nil
	}

	return rdb
}
