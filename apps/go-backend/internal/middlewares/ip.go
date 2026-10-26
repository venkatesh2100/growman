package middlewares

import (
	"net"
	"net/http"
	"strings"
)

// ClientIP returns the connecting client IP.
// chi RealIP already rewrites RemoteAddr from trusted proxy headers.
func ClientIP(r *http.Request) string {
	if r == nil {
		return ""
	}
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

// ExactIP is the address Cloud Run (or another reverse proxy) actually
// observed. Proxies append that address to X-Forwarded-For, so the last
// public hop is the client. A caller-supplied CF-Connecting-IP or a forged
// first hop is ignored. Empty when the peer is loopback or private.
func ExactIP(r *http.Request) string {
	if r == nil {
		return ""
	}
	if ip := lastPublicIP(r.Header.Get("X-Forwarded-For")); ip != "" {
		return ip
	}
	if ip := publicIPString(r.RemoteAddr); ip != "" {
		return ip
	}
	return ""
}

func lastPublicIP(xff string) string {
	parts := strings.Split(xff, ",")
	for i := len(parts) - 1; i >= 0; i-- {
		if ip := publicIPString(parts[i]); ip != "" {
			return ip
		}
	}
	return ""
}

func publicIPString(raw string) string {
	ip := parseIP(raw)
	if !isPublicIP(ip) {
		return ""
	}
	return ip.String()
}

func parseIP(raw string) net.IP {
	s := strings.TrimSpace(raw)
	s = strings.Trim(s, `"[]`)
	if host, _, err := net.SplitHostPort(s); err == nil {
		s = host
	}
	return net.ParseIP(strings.TrimSpace(s))
}

// IsPublicIP reports whether raw is a globally routable address a visitor
// can come from. Loopback, private, link-local, and documentation ranges
// are not.
func IsPublicIP(raw string) bool {
	return isPublicIP(parseIP(raw))
}

func isPublicIP(ip net.IP) bool {
	if ip == nil {
		return false
	}
	if v4 := ip.To4(); v4 != nil {
		ip = v4
	}
	if ip.IsPrivate() || ip.IsLoopback() || ip.IsUnspecified() || ip.IsMulticast() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
		return false
	}
	if !ip.IsGlobalUnicast() {
		return false
	}
	v4 := ip.To4()
	if v4 == nil {
		return true
	}
	// TEST-NET ranges are not a visitor.
	switch {
	case v4[0] == 192 && v4[1] == 0 && v4[2] == 2:
		return false
	case v4[0] == 198 && v4[1] == 51 && v4[2] == 100:
		return false
	case v4[0] == 203 && v4[1] == 0 && v4[2] == 113:
		return false
	default:
		return true
	}
}

func stripPort(ip string) string {
	if host, _, err := net.SplitHostPort(ip); err == nil {
		return host
	}
	return ip
}
