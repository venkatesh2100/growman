package msg91

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"time"

	"github.com/go-redis/redis/v8"
)

type Throttle struct {
	RDB *redis.Client
}

type BlockReason string

const (
	BlockNone     BlockReason = ""
	BlockCooldown BlockReason = "cooldown"
	BlockDayCap   BlockReason = "daycap"
	BlockIPCap    BlockReason = "ipcap"
)

func envInt(key string, fallback int) int {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil || n <= 0 {
		return fallback
	}
	return n
}

// Allow checks rate limits. isRetry=true (resend with reqId) only enforces cooldown,
// not the daily send cap — so WhatsApp/voice/SMS retries aren't burned by daycap.
func (t *Throttle) Allow(ctx context.Context, phone, ip string, isRetry bool) (ok bool, reason BlockReason, retryAfter time.Duration, err error) {
	if t == nil || t.RDB == nil {
		return false, BlockNone, 0, fmt.Errorf("redis not configured")
	}

	cooldownTTL := time.Duration(envInt("OTP_COOLDOWN_SECONDS", 30)) * time.Second
	dayCap := envInt("OTP_DAY_CAP", 20) // raised from 5 for widget testing
	ipCap := envInt("OTP_IP_HOUR_CAP", 40)

	// Cooldown between sends / retries
	ttl, err := t.RDB.TTL(ctx, "otp:cooldown:"+phone).Result()
	if err != nil && err != redis.Nil {
		return false, BlockNone, 0, err
	}
	if ttl > 0 {
		return false, BlockCooldown, ttl, nil
	}

	if !isRetry {
		// Daily cap only on fresh sends (not channel retries)
		dayCount, err := t.RDB.Incr(ctx, "otp:daycap:"+phone).Result()
		if err != nil {
			return false, BlockNone, 0, err
		}
		if dayCount == 1 {
			t.RDB.Expire(ctx, "otp:daycap:"+phone, 24*time.Hour)
		}
		if int(dayCount) > dayCap {
			// Undo the increment so blocked probes don't dig the hole deeper
			t.RDB.Decr(ctx, "otp:daycap:"+phone)
			dayTTL, _ := t.RDB.TTL(ctx, "otp:daycap:"+phone).Result()
			if dayTTL < 0 {
				dayTTL = time.Hour
			}
			return false, BlockDayCap, dayTTL, nil
		}

		if ip != "" {
			ipCount, err := t.RDB.Incr(ctx, "otp:ipcap:"+ip).Result()
			if err != nil {
				return false, BlockNone, 0, err
			}
			if ipCount == 1 {
				t.RDB.Expire(ctx, "otp:ipcap:"+ip, time.Hour)
			}
			if int(ipCount) > ipCap {
				t.RDB.Decr(ctx, "otp:ipcap:"+ip)
				ipTTL, _ := t.RDB.TTL(ctx, "otp:ipcap:"+ip).Result()
				if ipTTL < 0 {
					ipTTL = time.Minute
				}
				return false, BlockIPCap, ipTTL, nil
			}
		}
	}

	if err := t.RDB.Set(ctx, "otp:cooldown:"+phone, "1", cooldownTTL).Err(); err != nil {
		return false, BlockNone, 0, err
	}
	return true, BlockNone, cooldownTTL, nil
}
