package services

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/venkatesh2100/growman/apps/go-backend/internal/middlewares"
	"golang.org/x/sync/singleflight"
)

// NetHint is the slice of a request worth showing to ops. It is copied off
// the request before the handler returns and is never written to the database.
type NetHint struct {
	IP           string
	UserAgent    string
	Language     string
	Platform     string
	Model        string
	SecCHUA      string
	SecFetchMode string
	Referer      string
	ForwardedFor string
	Screen       string
	Viewport     string
	Timezone     string
	Languages    string
	Cores        int
	Touch        int
}

// Capture reads the visitor hints already present on the request. It does
// no I/O. IP is the address the proxy observed, not a client-supplied header.
func Capture(r *http.Request) NetHint {
	if r == nil {
		return NetHint{}
	}
	return NetHint{
		IP:           middlewares.ExactIP(r),
		UserAgent:    r.UserAgent(),
		Language:     headerValue(r, "Accept-Language"),
		Platform:     trimQuotes(headerValue(r, "Sec-CH-UA-Platform")),
		Model:        trimQuotes(headerValue(r, "Sec-CH-UA-Model")),
		SecCHUA:      headerValue(r, "Sec-CH-UA"),
		SecFetchMode: headerValue(r, "Sec-Fetch-Mode"),
		Referer:      headerValue(r, "Referer"),
		ForwardedFor: headerValue(r, "X-Forwarded-For"),
	}
}

func headerValue(r *http.Request, name string) string {
	return strings.TrimSpace(r.Header.Get(name))
}

func trimQuotes(s string) string {
	return strings.Trim(strings.TrimSpace(s), `"`)
}

// botUA matches clients that are not a person browsing the shop. Bare
// "java" and "discord" are omitted so a normal browser is not dropped.
var botUA = regexp.MustCompile(`(?i)(?:\bbot\b|\bcrawler\b|\bspider\b|crawling|facebookexternalhit|linkedinbot|twitterbot|slackbot|slack-imgproxy|discordbot|googlebot|bingbot|duckduckbot|baiduspider|yandexbot|applebot|wget/|curl/|python-requests|python-urllib|python-httpx|aiohttp|java/|go-http-client|axios|node-fetch|okhttp|libwww|zgrab|nmap|nikto|nuclei|sqlmap|masscan|censys|shodan|gptbot|chatgpt-user|claudebot|anthropic-ai|amazonbot|perplexitybot|bytespider|petalbot|semrush|ahrefs|mj12bot|headless|phantomjs|puppeteer|playwright|scrapy|postmanruntime|insomnia|uptimerobot|pingdom|googlehc|kube-probe|datadogagent|newrelic)`)

// AutomatedVisitor reports requests that should never become a visitor
// alert: short or scripted user agents, and calls that did not come from
// a browser fetch. Checked before any Redis, database, or geolocation work.
func AutomatedVisitor(n NetHint) bool {
	ua := strings.TrimSpace(n.UserAgent)
	if len(ua) < 20 || botUA.MatchString(ua) {
		return true
	}
	switch strings.ToLower(n.SecFetchMode) {
	case "cors", "navigate", "same-origin":
	default:
		return true
	}
	return strings.TrimSpace(n.Language) == ""
}

// Place is where an IP sits on the network. Coordinates come from a
// geolocation lookup of that IP, not from the browser.
type Place struct {
	City        string
	Region      string
	Country     string
	CountryCode string
	Postal      string
	Timezone    string
	Lat         float64
	Lng         float64
	HasCoord    bool
	ISP         string
	Org         string
	ASN         int
	Hosting     bool
	Proxy       bool
	VPN         bool
	Tor         bool
}

func (p Place) Label() string {
	locality := strings.Trim(strings.Join([]string{strings.TrimSpace(p.City), strings.TrimSpace(p.Region)}, ", "), ", ")
	if pin := strings.TrimSpace(p.Postal); pin != "" && locality != "" {
		locality += " " + pin
	} else if pin != "" {
		locality = pin
	}
	country := strings.TrimSpace(p.Country)
	if country == "" {
		country = strings.TrimSpace(p.CountryCode)
	}
	return strings.Trim(strings.Join([]string{locality, country}, ", "), ", ")
}

func (p Place) CoordText() string {
	if !p.HasCoord {
		return ""
	}
	return strconv.FormatFloat(p.Lat, 'f', 6, 64) + ", " + strconv.FormatFloat(p.Lng, 'f', 6, 64)
}

func (p Place) MapsLink() string {
	if !p.HasCoord {
		return ""
	}
	return MapsURL(&p.Lat, &p.Lng, "")
}

func (p Place) NetworkText() string {
	var parts []string
	if isp := strings.TrimSpace(p.ISP); isp != "" {
		parts = append(parts, isp)
	}
	if p.ASN > 0 {
		parts = append(parts, fmt.Sprintf("AS%d", p.ASN))
	}
	if org := strings.TrimSpace(p.Org); org != "" && !strings.EqualFold(org, p.ISP) {
		parts = append(parts, org)
	}
	if p.Hosting {
		parts = append(parts, "datacenter")
	}
	if p.VPN {
		parts = append(parts, "VPN")
	}
	if p.Proxy {
		parts = append(parts, "proxy")
	}
	if p.Tor {
		parts = append(parts, "Tor")
	}
	return strings.Join(parts, " · ")
}

// Datacenter is true for hosting networks, Tor exits, and cloud ASNs.
// A VPN on a residential ISP is still a person and is not flagged here.
func (p Place) Datacenter() bool {
	if p.Hosting || p.Tor {
		return true
	}
	if datacenterASN[p.ASN] {
		return true
	}
	blob := strings.ToLower(p.Org + " " + p.ISP)
	for _, needle := range datacenterNames {
		if needle != "" && strings.Contains(blob, needle) {
			return true
		}
	}
	return false
}

// AllowVisitorAlert is the last gate before a browsing session is posted.
// A visitor alert needs a real coordinate pair and a network that is not
// a datacenter. Lookup failures stay quiet so a dead geolocation service
// cannot turn bots into alerts.
func AllowVisitorAlert(p Place, err error) bool {
	return err == nil && p.HasCoord && !p.Datacenter()
}

var datacenterASN = map[int]bool{
	16509: true, 14618: true, // Amazon
	15169: true, 396982: true, // Google / GCP
	8075: true, 8068: true, // Microsoft / Azure
	14061: true,               // DigitalOcean
	16276: true,               // OVH
	24940: true, 213230: true, // Hetzner
	63949: true,               // Akamai / Linode
	20473: true,               // Choopa / Vultr
	51167: true,               // Contabo
	9009:  true,               // M247
	60068: true, 212238: true, // Datacamp
	36352:  true,              // ColoCrossing
	13335:  true,              // Cloudflare
	132203: true, 45090: true, // Tencent
	45102: true, 37963: true, // Alibaba
	53667:  true, // FranTech
	398101: true, // GoDaddy cloud
	398722: true, // Oracle
}

var datacenterNames = []string{
	"amazon", "aws", "google cloud", "google llc", "microsoft azure", "azure",
	"digitalocean", "hetzner", "ovh sas", "ovhcloud", "linode", "oracle cloud",
	"cloudflare", "vultr", "choopa", "contabo", "datacamp", "m247",
	"colocrossing", "quadranet", "psychz", "leaseweb", "scaleway", "upcloud",
	"alibaba", "tencent cloud", "huawei cloud",
}

// LocationFields is the block appended only to the Discord embed: city,
// Google Maps coordinates, and the network the IP belongs to.
func LocationFields(p Place) []DiscordField {
	var out []DiscordField
	if label := p.Label(); label != "" {
		out = append(out, Field("Location", label, true))
	}
	if p.HasCoord {
		out = append(out,
			Field("Coordinates", p.CoordText(), true),
			Field("Map", p.MapsLink(), false),
		)
	}
	if net := p.NetworkText(); net != "" {
		out = append(out, Field("Network", net, false))
	}
	if tz := strings.TrimSpace(p.Timezone); tz != "" {
		out = append(out, Field("IP timezone", tz, true))
	}
	return out
}

// DeviceText summarises the browser for the Discord embed.
func DeviceText(n NetHint) string {
	browser, osName, kind := parseUA(n.UserAgent)
	if n.Platform != "" {
		osName = n.Platform
	}
	var parts []string
	if browser != "" && osName != "" {
		parts = append(parts, browser+" on "+osName)
	} else if browser != "" {
		parts = append(parts, browser)
	} else if osName != "" {
		parts = append(parts, osName)
	}
	if kind != "" {
		parts = append(parts, kind)
	}
	if model := strings.TrimSpace(n.Model); model != "" && !strings.EqualFold(model, "K") {
		parts = append(parts, model)
	}
	if s := strings.TrimSpace(n.Screen); s != "" {
		parts = append(parts, "screen "+s)
	}
	if s := strings.TrimSpace(n.Viewport); s != "" {
		parts = append(parts, "window "+s)
	}
	lang := strings.TrimSpace(n.Languages)
	if lang == "" {
		lang = strings.TrimSpace(n.Language)
	}
	if lang != "" {
		parts = append(parts, lang)
	}
	if tz := strings.TrimSpace(n.Timezone); tz != "" {
		parts = append(parts, tz)
	}
	if n.Cores > 0 {
		parts = append(parts, fmt.Sprintf("%d cores", n.Cores))
	}
	if n.Touch > 0 {
		parts = append(parts, "touch")
	}
	return strings.Join(parts, " · ")
}

func parseUA(ua string) (browser, osName, kind string) {
	u := strings.ToLower(ua)
	switch {
	case strings.Contains(u, "edg/"):
		browser = "Edge"
	case strings.Contains(u, "opr/") || strings.Contains(u, "opera"):
		browser = "Opera"
	case strings.Contains(u, "samsungbrowser"):
		browser = "Samsung Internet"
	case strings.Contains(u, "firefox/"):
		browser = "Firefox"
	case strings.Contains(u, "chrome/") || strings.Contains(u, "crios/"):
		browser = "Chrome"
	case strings.Contains(u, "safari/") && !strings.Contains(u, "chrome/"):
		browser = "Safari"
	}
	switch {
	case strings.Contains(u, "android"):
		osName = "Android"
	case strings.Contains(u, "iphone") || strings.Contains(u, "ipad"):
		osName = "iOS"
	case strings.Contains(u, "mac os x") || strings.Contains(u, "macintosh"):
		osName = "macOS"
	case strings.Contains(u, "windows"):
		osName = "Windows"
	case strings.Contains(u, "cros"):
		osName = "ChromeOS"
	case strings.Contains(u, "linux"):
		osName = "Linux"
	}
	switch {
	case strings.Contains(u, "ipad") || strings.Contains(u, "tablet"):
		kind = "tablet"
	case strings.Contains(u, "mobile") || strings.Contains(u, "iphone") || strings.Contains(u, "android"):
		kind = "mobile"
	case browser != "" || osName != "":
		kind = "desktop"
	}
	return browser, osName, kind
}

const (
	placeTTL        = 6 * time.Hour
	placeFailTTL    = 10 * time.Minute
	placeCacheMax   = 1024
	visitorClaimTTL = 24 * time.Hour
	visitorClaimMax = 4096
)

type cachedPlace struct {
	place Place
	err   string
	until time.Time
}

var (
	placeMu     sync.Mutex
	placeCache  = map[string]cachedPlace{}
	placeGroup  singleflight.Group
	placeHTTP   = &http.Client{Timeout: 1500 * time.Millisecond, CheckRedirect: refuseRedirect}
	placeFetch  = fetchPlace
	claimMu     sync.Mutex
	visitorSeen = map[string]time.Time{}
)

func refuseRedirect(*http.Request, []*http.Request) error {
	return http.ErrUseLastResponse
}

// SetPlaceFetchForTest replaces the geolocation call. Tests only.
func SetPlaceFetchForTest(fn func(context.Context, string) (Place, error)) func() {
	prev := placeFetch
	placeFetch = fn
	return func() { placeFetch = prev }
}

// ResetVisitorCache clears in-process dedupe and geolocation cache. Tests only.
func ResetVisitorCache() {
	claimMu.Lock()
	visitorSeen = map[string]time.Time{}
	claimMu.Unlock()
	placeMu.Lock()
	placeCache = map[string]cachedPlace{}
	placeMu.Unlock()
}

// ClaimVisitor reserves this IP for one visitor alert. A repeat call inside
// the window is false, so the handler can return before Redis, Postgres, or
// a geolocation request. A full table also returns false: dropping a new
// alert is cheaper than unbounded memory on Cloud Run.
func ClaimVisitor(ip string) bool {
	ip = strings.TrimSpace(ip)
	if ip == "" {
		return false
	}
	now := time.Now()
	claimMu.Lock()
	defer claimMu.Unlock()
	if until, ok := visitorSeen[ip]; ok && now.Before(until) {
		return false
	}
	if len(visitorSeen) >= visitorClaimMax {
		for key, until := range visitorSeen {
			if !now.Before(until) {
				delete(visitorSeen, key)
			}
		}
		if len(visitorSeen) >= visitorClaimMax {
			return false
		}
	}
	visitorSeen[ip] = now.Add(visitorClaimTTL)
	return true
}

// LookupPlace resolves a public IP to a city and coordinates. Results are
// cached in memory so a repeat alert does not call out again. The lookup
// runs only after the caller has decided a Discord post is worth sending.
func LookupPlace(ctx context.Context, ip string) (Place, error) {
	parsed := net.ParseIP(strings.TrimSpace(ip))
	if parsed == nil || !middlewares.IsPublicIP(parsed.String()) {
		return Place{}, fmt.Errorf("ip is not a public address")
	}
	ip = parsed.String()
	if place, ok, err := cachedPlaceOf(ip); ok {
		if err != nil {
			return Place{}, err
		}
		return place, nil
	}
	v, err, _ := placeGroup.Do(ip, func() (any, error) {
		if place, ok, cachedErr := cachedPlaceOf(ip); ok {
			return place, cachedErr
		}
		place, fetchErr := placeFetch(ctx, ip)
		rememberPlace(ip, place, fetchErr)
		return place, fetchErr
	})
	if err != nil {
		return Place{}, err
	}
	place, _ := v.(Place)
	return place, nil
}

func cachedPlaceOf(ip string) (Place, bool, error) {
	placeMu.Lock()
	defer placeMu.Unlock()
	row, ok := placeCache[ip]
	if !ok || time.Now().After(row.until) {
		return Place{}, false, nil
	}
	if row.err != "" {
		return Place{}, true, fmt.Errorf("%s", row.err)
	}
	return row.place, true, nil
}

func rememberPlace(ip string, place Place, err error) {
	row := cachedPlace{place: place, until: time.Now().Add(placeTTL)}
	if err != nil {
		row = cachedPlace{err: "lookup failed", until: time.Now().Add(placeFailTTL)}
	}
	placeMu.Lock()
	defer placeMu.Unlock()
	if len(placeCache) >= placeCacheMax {
		now := time.Now()
		for key, cached := range placeCache {
			if now.After(cached.until) {
				delete(placeCache, key)
			}
		}
		if len(placeCache) >= placeCacheMax {
			return
		}
	}
	placeCache[ip] = row
}

func fetchPlace(ctx context.Context, ip string) (Place, error) {
	endpoint := (&url.URL{Scheme: "https", Host: "ipwho.is", Path: "/" + ip}).String()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return Place{}, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "Growman/1.0")
	resp, err := placeHTTP.Do(req)
	if err != nil {
		return Place{}, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<15))
	if err != nil {
		return Place{}, err
	}
	if resp.StatusCode != http.StatusOK {
		return Place{}, fmt.Errorf("ip location status %d", resp.StatusCode)
	}
	var raw ipWho
	if err := json.Unmarshal(body, &raw); err != nil {
		return Place{}, err
	}
	if !raw.Success {
		return Place{}, fmt.Errorf("ip location unavailable")
	}
	place := Place{
		City:        strings.TrimSpace(raw.City),
		Region:      strings.TrimSpace(raw.Region),
		Country:     strings.TrimSpace(raw.Country),
		CountryCode: strings.TrimSpace(raw.CountryCode),
		Postal:      strings.TrimSpace(raw.Postal),
		Timezone:    strings.TrimSpace(raw.Timezone.ID),
		Lat:         raw.Latitude,
		Lng:         raw.Longitude,
		ISP:         strings.TrimSpace(raw.Connection.ISP),
		Org:         strings.TrimSpace(raw.Connection.Org),
		ASN:         int(raw.Connection.ASN),
		Hosting:     raw.Security.Hosting,
		Proxy:       raw.Security.Proxy,
		VPN:         raw.Security.VPN,
		Tor:         raw.Security.Tor,
	}
	if place.Lat != 0 || place.Lng != 0 {
		place.HasCoord = true
	}
	return place, nil
}

type ipWho struct {
	Success     bool    `json:"success"`
	City        string  `json:"city"`
	Region      string  `json:"region"`
	Country     string  `json:"country"`
	CountryCode string  `json:"country_code"`
	Postal      string  `json:"postal"`
	Latitude    float64 `json:"latitude"`
	Longitude   float64 `json:"longitude"`
	Timezone    struct {
		ID string `json:"id"`
	} `json:"timezone"`
	Connection struct {
		ASN flexInt `json:"asn"`
		Org string  `json:"org"`
		ISP string  `json:"isp"`
	} `json:"connection"`
	Security struct {
		Hosting bool `json:"hosting"`
		Proxy   bool `json:"proxy"`
		VPN     bool `json:"vpn"`
		Tor     bool `json:"tor"`
	} `json:"security"`
}

type flexInt int

func (n *flexInt) UnmarshalJSON(b []byte) error {
	s := strings.Trim(string(b), `"`)
	if s == "" || s == "null" {
		return nil
	}
	v, err := strconv.Atoi(s)
	if err != nil {
		return err
	}
	*n = flexInt(v)
	return nil
}
