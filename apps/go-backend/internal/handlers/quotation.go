package handlers

import (
	"fmt"
	"log"
	"net/http"
	"net/mail"
	"regexp"
	"strings"
	"time"

	appauth "github.com/venkatesh2100/growman/apps/go-backend/internal/auth"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/middlewares"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/models"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/phoneutil"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/services"
	"github.com/venkatesh2100/growman/apps/go-backend/pkg/httpjson"
	"gorm.io/gorm"
)

const (
	maxQuotationLines    = 200
	maxQuotationQuantity = 100000
	quotationUnit        = "Nos"
)

var (
	pincodePattern = regexp.MustCompile(`^[1-9][0-9]{5}$`)
	gstinPattern   = regexp.MustCompile(`^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$`)
	istZone        = loadIST()
)

func loadIST() *time.Location {
	if loc, err := time.LoadLocation("Asia/Kolkata"); err == nil {
		return loc
	}
	return time.FixedZone("IST", 5*3600+1800)
}

type quotationItemRequest struct {
	ProductID uint `json:"productId"`
	SizeID    uint `json:"sizeId"`
	Quantity  int  `json:"quantity"`
}

type quotationCustomItemRequest struct {
	Name     string `json:"name"`
	Size     string `json:"size"`
	Quantity int    `json:"quantity"`
}

// quotationClientRequest is optional browser context reported by the web app.
type quotationClientRequest struct {
	Timezone  string `json:"timezone"`
	Language  string `json:"language"`
	Languages string `json:"languages"`
	Screen    string `json:"screen"`
	Viewport  string `json:"viewport"`
	Platform  string `json:"platform"`
	Page      string `json:"page"`
	Referrer  string `json:"referrer"`
	LocalTime string `json:"localTime"`
}

type quotationServicesRequest struct {
	Delivery   bool `json:"delivery"`
	Loading    bool `json:"loading"`
	Plantation bool `json:"plantation"`
}

type createQuotationRequest struct {
	Name        string                       `json:"name"`
	Company     string                       `json:"company"`
	Phone       string                       `json:"phone"`
	Email       string                       `json:"email"`
	GSTIN       string                       `json:"gstin"`
	Address     string                       `json:"address"`
	City        string                       `json:"city"`
	State       string                       `json:"state"`
	Pincode     string                       `json:"pincode"`
	RequiredBy  string                       `json:"requiredBy"`
	Notes       string                       `json:"notes"`
	Services    quotationServicesRequest     `json:"services"`
	Items       []quotationItemRequest       `json:"items"`
	CustomItems []quotationCustomItemRequest `json:"customItems"`
	Client      quotationClientRequest       `json:"client"`
	// Website is a honeypot: real browsers leave the hidden field empty.
	Website string `json:"website"`
}

func clip(s string, max int) string {
	s = strings.TrimSpace(s)
	if r := []rune(s); len(r) > max {
		return string(r[:max])
	}
	return s
}

func oneLine(s string, max int) string {
	return clip(strings.Join(strings.Fields(s), " "), max)
}

// nextEstimateNo returns e.g. "GMQ-2609-0042". The counter resets monthly and
// falls back to a time-based suffix when Redis is unavailable.
func (h *Handler) nextEstimateNo(r *http.Request, now time.Time) string {
	prefix := "GMQ-" + now.Format("0601")
	if h.Redis != nil {
		key := "quotation:seq:" + now.Format("200601")
		if n, err := h.Redis.Incr(r.Context(), key).Result(); err == nil {
			if n == 1 {
				h.Redis.Expire(r.Context(), key, 40*24*time.Hour)
			}
			return fmt.Sprintf("%s-%04d", prefix, n)
		}
	}
	return fmt.Sprintf("%s-%s", prefix, now.Format("021504"))
}

func quotationUserID(h *Handler, r *http.Request) string {
	auth := r.Header.Get("Authorization")
	if !strings.HasPrefix(auth, "Bearer ") {
		return ""
	}
	claims, err := appauth.ParseToken(h.Cfg.JWTSecret, strings.TrimPrefix(auth, "Bearer "))
	if err != nil || claims == nil {
		return ""
	}
	return fmt.Sprintf("%d", claims.UserID)
}

func yesNo(v bool) string {
	if v {
		return "Yes"
	}
	return "No"
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// describeUserAgent gives a short "Browser on OS" summary of a User-Agent.
func describeUserAgent(ua string) string {
	os := ""
	switch {
	case strings.Contains(ua, "Android"):
		os = "Android"
	case strings.Contains(ua, "iPhone"):
		os = "iPhone"
	case strings.Contains(ua, "iPad"):
		os = "iPad"
	case strings.Contains(ua, "Windows"):
		os = "Windows"
	case strings.Contains(ua, "Mac OS X"), strings.Contains(ua, "Macintosh"):
		os = "macOS"
	case strings.Contains(ua, "CrOS"):
		os = "ChromeOS"
	case strings.Contains(ua, "Linux"):
		os = "Linux"
	}
	browser := ""
	switch {
	case strings.Contains(ua, "Edg/"):
		browser = "Edge"
	case strings.Contains(ua, "OPR/"), strings.Contains(ua, "Opera"):
		browser = "Opera"
	case strings.Contains(ua, "SamsungBrowser"):
		browser = "Samsung Internet"
	case strings.Contains(ua, "Firefox/"), strings.Contains(ua, "FxiOS"):
		browser = "Firefox"
	case strings.Contains(ua, "Chrome/"), strings.Contains(ua, "CriOS"):
		browser = "Chrome"
	case strings.Contains(ua, "Safari/"):
		browser = "Safari"
	}
	device := "Desktop"
	if strings.Contains(ua, "Mobile") || os == "Android" || os == "iPhone" {
		device = "Mobile"
	}
	if os == "iPad" || (os == "Android" && !strings.Contains(ua, "Mobile")) {
		device = "Tablet"
	}
	switch {
	case browser != "" && os != "":
		return fmt.Sprintf("%s on %s (%s)", browser, os, device)
	case os != "":
		return fmt.Sprintf("%s (%s)", os, device)
	default:
		return browser
	}
}

// addQuotationDetails collects everything the store may need to follow up:
// the enquiry, the signed-in account, network/location and device details.
func (h *Handler) addQuotationDetails(r *http.Request, meta *services.QuotationMeta, q services.Quotation, req createQuotationRequest) {
	rq := q.Requester
	requested := 0
	for _, l := range q.Lines {
		if l.Requested {
			requested++
		}
	}
	meta.AddSection("Requester",
		services.QuotationDetail{Label: "Name", Value: rq.Name},
		services.QuotationDetail{Label: "Company", Value: rq.Company},
		services.QuotationDetail{Label: "Mobile", Value: "+91 " + rq.Phone},
		services.QuotationDetail{Label: "Email", Value: rq.Email},
		services.QuotationDetail{Label: "Address", Value: rq.Address},
		services.QuotationDetail{Label: "City", Value: rq.City},
		services.QuotationDetail{Label: "State", Value: rq.State},
		services.QuotationDetail{Label: "Pincode", Value: rq.Pincode},
		services.QuotationDetail{Label: "GSTIN", Value: rq.GSTIN},
		services.QuotationDetail{Label: "Required by", Value: rq.RequiredBy},
		services.QuotationDetail{Label: "Notes", Value: rq.Notes},
	)
	meta.AddSection("Enquiry",
		services.QuotationDetail{Label: "Estimate No.", Value: q.EstimateNo},
		services.QuotationDetail{Label: "Submitted (IST)", Value: meta.Submitted.Format("Mon, 02 Jan 2006 03:04:05 PM")},
		services.QuotationDetail{Label: "Line items", Value: fmt.Sprintf("%d (%d catalog, %d requested)", len(q.Lines), len(q.Lines)-requested, requested)},
		services.QuotationDetail{Label: "Total units", Value: services.FormatQuantity(q.TotalUnits)},
		services.QuotationDetail{Label: "Estimated total", Value: services.FormatRupees(q.Total)},
		services.QuotationDetail{Label: "Delivery", Value: yesNo(req.Services.Delivery)},
		services.QuotationDetail{Label: "Loading", Value: yesNo(req.Services.Loading)},
		services.QuotationDetail{Label: "Plantation", Value: yesNo(req.Services.Plantation)},
	)

	if meta.UserID != "" {
		var u models.User
		account := []services.QuotationDetail{{Label: "User ID", Value: meta.UserID}}
		if err := h.db(r.Context()).First(&u, meta.UserID).Error; err == nil {
			addr := strings.Trim(strings.Join([]string{u.AddressLine, u.City, u.State, u.Pincode, u.Country}, ", "), ", ")
			addr = strings.ReplaceAll(addr, ", , ", ", ")
			verified := ""
			if u.PhoneVerifiedAt != nil {
				verified = "Phone verified " + u.PhoneVerifiedAt.In(istZone).Format("02-01-2006")
			}
			if u.EmailVerified {
				verified = strings.TrimPrefix(verified+", email verified", ", ")
			}
			account = append(account,
				services.QuotationDetail{Label: "Name", Value: u.Name},
				services.QuotationDetail{Label: "Email", Value: deref(u.Email)},
				services.QuotationDetail{Label: "Phone", Value: deref(u.Phone)},
				services.QuotationDetail{Label: "Sign-in method", Value: u.Provider},
				services.QuotationDetail{Label: "Verified", Value: verified},
				services.QuotationDetail{Label: "Saved address", Value: addr},
				services.QuotationDetail{Label: "Member since", Value: u.CreatedAt.In(istZone).Format("02-01-2006")},
			)
			if u.Latitude != nil && u.Longitude != nil {
				account = append(account, services.QuotationDetail{Label: "Saved location", Value: fmt.Sprintf("%.5f, %.5f", *u.Latitude, *u.Longitude)})
			}
		}
		meta.AddSection("Account (signed in)", account...)
	} else {
		meta.AddSection("Account", services.QuotationDetail{Label: "Signed in", Value: "No (guest)"})
	}

	hdr := func(name string) string { return oneLine(r.Header.Get(name), 200) }
	location := strings.Trim(strings.Join([]string{hdr("CF-IPCity"), hdr("CF-Region"), hdr("CF-IPCountry")}, ", "), ", ")
	location = strings.ReplaceAll(location, ", , ", ", ")
	coords := ""
	if lat, lon := hdr("CF-IPLatitude"), hdr("CF-IPLongitude"); lat != "" && lon != "" {
		coords = lat + ", " + lon
	}
	meta.AddSection("Network",
		services.QuotationDetail{Label: "IP address", Value: meta.IP},
		services.QuotationDetail{Label: "Forwarded for", Value: hdr("X-Forwarded-For")},
		services.QuotationDetail{Label: "IP location", Value: location},
		services.QuotationDetail{Label: "IP postal code", Value: hdr("CF-Postal-Code")},
		services.QuotationDetail{Label: "IP coordinates", Value: coords},
		services.QuotationDetail{Label: "IP timezone", Value: hdr("CF-Timezone")},
		services.QuotationDetail{Label: "Cloudflare ray", Value: hdr("CF-Ray")},
		services.QuotationDetail{Label: "Origin", Value: hdr("Origin")},
		services.QuotationDetail{Label: "Referer", Value: hdr("Referer")},
	)

	c := req.Client
	platform := hdr("Sec-CH-UA-Platform")
	if platform == "" {
		platform = oneLine(c.Platform, 60)
	}
	meta.AddSection("Device",
		services.QuotationDetail{Label: "Device", Value: describeUserAgent(meta.UserAgent)},
		services.QuotationDetail{Label: "Platform", Value: strings.Trim(platform, `"`)},
		services.QuotationDetail{Label: "Screen", Value: oneLine(c.Screen, 40)},
		services.QuotationDetail{Label: "Window", Value: oneLine(c.Viewport, 40)},
		services.QuotationDetail{Label: "Language", Value: firstNonEmpty(oneLine(c.Languages, 120), hdr("Accept-Language"))},
		services.QuotationDetail{Label: "Device timezone", Value: oneLine(c.Timezone, 60)},
		services.QuotationDetail{Label: "Device time", Value: oneLine(c.LocalTime, 60)},
		services.QuotationDetail{Label: "Page", Value: oneLine(c.Page, 300)},
		services.QuotationDetail{Label: "Came from", Value: oneLine(c.Referrer, 300)},
		services.QuotationDetail{Label: "User agent", Value: meta.UserAgent},
	)
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

// CreateQuotation prices a bulk enquiry from the catalog (client prices are
// never trusted), emails the formatted quotation to the store inbox and
// returns it so the buyer can print a copy.
func (h *Handler) CreateQuotation(w http.ResponseWriter, r *http.Request) {
	var req createQuotationRequest
	if !httpjson.Decode(w, r, &req) {
		return
	}
	if strings.TrimSpace(req.Website) != "" {
		httpjson.Error(w, http.StatusBadRequest, "invalid request")
		return
	}

	requester := services.QuotationRequester{
		Name:       oneLine(req.Name, 100),
		Company:    oneLine(req.Company, 120),
		Phone:      phoneutil.TenDigitIN(req.Phone),
		Email:      oneLine(req.Email, 160),
		GSTIN:      strings.ToUpper(oneLine(req.GSTIN, 15)),
		Address:    oneLine(req.Address, 300),
		City:       oneLine(req.City, 80),
		State:      oneLine(req.State, 60),
		Pincode:    oneLine(req.Pincode, 6),
		RequiredBy: oneLine(req.RequiredBy, 40),
		Notes:      clip(req.Notes, 1500),
	}

	switch {
	case len([]rune(requester.Name)) < 2:
		httpjson.Error(w, http.StatusBadRequest, "Please enter your name.")
		return
	case requester.Phone == "":
		httpjson.Error(w, http.StatusBadRequest, "Please enter a valid 10-digit mobile number.")
		return
	case len([]rune(requester.Address)) < 5:
		httpjson.Error(w, http.StatusBadRequest, "Please enter the delivery address.")
		return
	case requester.Pincode != "" && !pincodePattern.MatchString(requester.Pincode):
		httpjson.Error(w, http.StatusBadRequest, "Please enter a valid 6-digit pincode.")
		return
	case requester.GSTIN != "" && !gstinPattern.MatchString(requester.GSTIN):
		httpjson.Error(w, http.StatusBadRequest, "Please enter a valid 15-character GSTIN, or leave it blank.")
		return
	}
	if requester.Email != "" {
		addr, err := mail.ParseAddress(requester.Email)
		if err != nil || !strings.Contains(addr.Address, ".") {
			httpjson.Error(w, http.StatusBadRequest, "Please enter a valid email address.")
			return
		}
		requester.Email = addr.Address
	}

	// Merge duplicate lines so the same size never appears twice.
	type lineKey struct{ product, size uint }
	quantities := map[lineKey]int{}
	var order []lineKey
	for _, it := range req.Items {
		if it.ProductID == 0 || it.Quantity <= 0 {
			continue
		}
		k := lineKey{it.ProductID, it.SizeID}
		if _, seen := quantities[k]; !seen {
			order = append(order, k)
		}
		quantities[k] = min(quantities[k]+it.Quantity, maxQuotationQuantity)
	}
	var custom []services.QuotationLine
	for _, it := range req.CustomItems {
		name := oneLine(it.Name, 120)
		if len([]rune(name)) < 2 || it.Quantity <= 0 {
			continue
		}
		custom = append(custom, services.QuotationLine{
			Name:      name,
			Size:      oneLine(it.Size, 40),
			Quantity:  min(it.Quantity, maxQuotationQuantity),
			Unit:      quotationUnit,
			Requested: true,
		})
	}

	if len(order)+len(custom) == 0 {
		httpjson.Error(w, http.StatusBadRequest, "Add at least one plant with a quantity.")
		return
	}
	if len(order)+len(custom) > maxQuotationLines {
		httpjson.Error(w, http.StatusBadRequest, fmt.Sprintf("A quotation can include up to %d plants.", maxQuotationLines))
		return
	}

	var products []models.Product
	if len(order) > 0 {
		ids := make([]uint, 0, len(order))
		for _, k := range order {
			ids = append(ids, k.product)
		}
		err := h.db(r.Context()).
			Select("id", "name", "price").
			Preload("Sizes", func(db *gorm.DB) *gorm.DB {
				return db.Select("id", "label", "price", "product_id").Order("id")
			}).
			Where("id IN ?", ids).
			Find(&products).Error
		if err != nil {
			log.Printf("[QUOTATION] product lookup failed: %v", err)
			httpjson.Error(w, http.StatusInternalServerError, "Could not prepare the quotation. Please try again.")
			return
		}
	}
	byID := make(map[uint]models.Product, len(products))
	for _, p := range products {
		byID[p.ID] = p
	}

	lines := make([]services.QuotationLine, 0, len(order))
	for _, k := range order {
		p, ok := byID[k.product]
		if !ok {
			continue
		}
		line := services.QuotationLine{
			ItemCode: services.QuotationItemCode(p.ID, k.size),
			Name:     p.Name,
			Quantity: quantities[k],
			Unit:     quotationUnit,
			Rate:     p.Price,
		}
		if k.size != 0 {
			found := false
			for _, s := range p.Sizes {
				if s.ID == k.size {
					line.Size = s.Label
					line.Rate = s.Price
					found = true
					break
				}
			}
			if !found {
				continue
			}
		}
		lines = append(lines, line)
	}
	lines = append(lines, custom...)
	if len(lines) == 0 {
		httpjson.Error(w, http.StatusBadRequest, "The selected plants are no longer available. Please refresh and try again.")
		return
	}

	now := time.Now().In(istZone)
	place := strings.Trim(strings.Join([]string{requester.City, requester.State}, ", "), ", ")
	if place == "" {
		place = requester.Address
	}
	q := services.Quotation{
		EstimateNo:    h.nextEstimateNo(r, now),
		Date:          now.Format("02-01-2006"),
		PlaceOfSupply: place,
		Requester:     requester,
		Lines:         lines,
		Charges: []services.QuotationCharge{
			{Label: "Freight Charges", Requested: req.Services.Delivery},
			{Label: "Loading & Unloading", Requested: req.Services.Loading},
			{Label: "Plantation Labour Charges", Requested: req.Services.Plantation},
		},
	}
	q.Finalize()

	to := strings.TrimSpace(h.Cfg.QuotationEmail)
	if to == "" || h.Cfg.SMTPEmail == "" || h.Cfg.SMTPPassword == "" {
		log.Printf("[QUOTATION] email not configured; enquiry %s from %s not sent", q.EstimateNo, requester.Phone)
		httpjson.Error(w, http.StatusServiceUnavailable, "Quotation email is unavailable right now. Please call the store.")
		return
	}
	meta := services.QuotationMeta{
		UserID:    quotationUserID(h, r),
		IP:        middlewares.ClientIP(r),
		UserAgent: oneLine(r.UserAgent(), 300),
		Submitted: now,
	}
	h.addQuotationDetails(r, &meta, q, req)
	if err := h.emailService().SendQuotationEnquiry(to, q, meta); err != nil {
		log.Printf("[QUOTATION] email failed for %s: %v", q.EstimateNo, err)
		httpjson.Error(w, http.StatusBadGateway, "We couldn't send your quotation. Please try again or call the store.")
		return
	}

	httpjson.JSON(w, http.StatusCreated, q)
}
