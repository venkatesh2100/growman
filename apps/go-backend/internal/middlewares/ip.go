package middlewares

import (
	"net"
	"net/http"
	"strings"
)

// ClientIP returns the connecting client IP.
// chi RealIP already rewrites RemoteAddr from trusted proxy headers.
func ClientIP(r *http.Request) string {
	if ip := strings.TrimSpace(r.Header.Get("CF-Connecting-IP")); ip != "" {
		return stripPort(ip)
	}
	if ip := strings.TrimSpace(r.Header.Get("True-Client-IP")); ip != "" {
		return stripPort(ip)
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil && host != "" {
		return host
	}
	return r.RemoteAddr
}

func stripPort(ip string) string {
	if host, _, err := net.SplitHostPort(ip); err == nil {
		return host
	}
	return ip
}
