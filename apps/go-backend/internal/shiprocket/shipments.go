package shiprocket

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Shipment booking
//
// CheckServiceability (client.go) answers "can we ship there and what does
// it cost". The calls here actually create the shipment: register the
// order with Shiprocket, assign an AWB from a courier, and request a
// pickup.
//
// These are write operations against a live logistics account, so unlike
// serviceability they do *not* go through the circuit breaker's
// fail-soft path: a booking that silently does not happen is worse than
// one that returns an error a human can see and retry.

// bookingTimeout is longer than the 4s quote budget: booking happens in a
// background job or an admin action, not inside a customer's checkout.
const bookingTimeout = 25 * time.Second

// OrderRequest is a Shiprocket order creation payload.
type OrderRequest struct {
	OrderID      string // our order ID, as the channel reference
	OrderDate    time.Time
	PickupName   string // nickname of the pickup location in Shiprocket
	CustomerName string
	Phone        string
	Email        string
	AddressLine  string
	City         string
	State        string
	Pincode      string
	Items        []OrderLine
	SubTotal     float64
	WeightKg     float64
	LengthCm     float64
	BreadthCm    float64
	HeightCm     float64
}

// OrderLine is one item on a Shiprocket order.
type OrderLine struct {
	Name     string
	SKU      string
	Quantity int
	Price    float64
	HSN      string
}

// CreatedOrder identifies a Shiprocket order and shipment.
type CreatedOrder struct {
	OrderID    int64
	ShipmentID int64
	Status     string
}

// AWB is an assigned air waybill, which is what the customer tracks.
type AWB struct {
	AWBCode     string
	CourierName string
	ShipmentID  int64
	// TrackingURL is Shiprocket's public tracking page for this AWB.
	TrackingURL string
}

// TrackingStatus is the current state of a shipment.
type TrackingStatus struct {
	AWBCode          string
	Status           string
	StatusCode       int
	CourierName      string
	DeliveredAt      *time.Time
	ExpectedDelivery *time.Time
	Activities       []TrackingActivity
}

// TrackingActivity is one scan event in a shipment's history.
type TrackingActivity struct {
	Date     string `json:"date"`
	Activity string `json:"activity"`
	Location string `json:"location"`
	Status   string `json:"sr-status-label"`
}

// CreateOrder registers an order with Shiprocket, returning its shipment
// ID. Idempotent on our side only in the sense that Shiprocket rejects a
// duplicate channel order ID — callers should treat an existing-order
// error as success and look the shipment up.
func (c *Client) CreateOrder(ctx context.Context, req OrderRequest) (*CreatedOrder, error) {
	if c == nil {
		return nil, ErrNotConfigured
	}

	items := make([]map[string]any, 0, len(req.Items))
	for _, line := range req.Items {
		sku := line.SKU
		if sku == "" {
			sku = "GRW-" + line.Name
		}
		items = append(items, map[string]any{
			"name":          line.Name,
			"sku":           sku,
			"units":         line.Quantity,
			"selling_price": line.Price,
			"hsn":           line.HSN,
		})
	}

	// Shiprocket requires non-zero dimensions and weight. These defaults
	// describe a typical potted-plant parcel; the real values should come
	// from the product's size class where known.
	weight := req.WeightKg
	if weight <= 0 {
		weight = 1.0
	}
	dims := [3]float64{req.LengthCm, req.BreadthCm, req.HeightCm}
	for i, v := range dims {
		if v <= 0 {
			dims[i] = 20
		}
	}

	payload := map[string]any{
		"order_id":              req.OrderID,
		"order_date":            req.OrderDate.Format("2006-01-02 15:04"),
		"pickup_location":       req.PickupName,
		"billing_customer_name": req.CustomerName,
		"billing_last_name":     "",
		"billing_address":       req.AddressLine,
		"billing_city":          req.City,
		"billing_pincode":       req.Pincode,
		"billing_state":         req.State,
		"billing_country":       "India",
		"billing_email":         req.Email,
		"billing_phone":         req.Phone,
		"shipping_is_billing":   true,
		"order_items":           items,
		"payment_method":        "Prepaid",
		"sub_total":             req.SubTotal,
		"length":                dims[0],
		"breadth":               dims[1],
		"height":                dims[2],
		"weight":                weight,
	}

	var out struct {
		OrderID    int64  `json:"order_id"`
		ShipmentID int64  `json:"shipment_id"`
		Status     string `json:"status"`
		// Shiprocket returns validation problems in these shapes.
		Message any `json:"message"`
		Errors  any `json:"errors"`
	}
	if err := c.post(ctx, "/orders/create/adhoc", payload, &out); err != nil {
		return nil, err
	}
	if out.ShipmentID == 0 {
		return nil, fmt.Errorf("shiprocket: order created without a shipment id (message: %v, errors: %v)", out.Message, out.Errors)
	}

	return &CreatedOrder{
		OrderID:    out.OrderID,
		ShipmentID: out.ShipmentID,
		Status:     out.Status,
	}, nil
}

// GenerateAWB assigns a courier and air waybill to a shipment. Passing
// courierID 0 lets Shiprocket pick per the account's priority rules,
// which is usually what you want.
func (c *Client) GenerateAWB(ctx context.Context, shipmentID int64, courierID int) (*AWB, error) {
	if c == nil {
		return nil, ErrNotConfigured
	}

	payload := map[string]any{"shipment_id": shipmentID}
	if courierID > 0 {
		payload["courier_id"] = courierID
	}

	var out struct {
		AWBAssignStatus int `json:"awb_assign_status"`
		Response        struct {
			Data struct {
				AWBCode     string `json:"awb_code"`
				CourierName string `json:"courier_name"`
				ShipmentID  int64  `json:"shipment_id"`
			} `json:"data"`
		} `json:"response"`
		Message any `json:"message"`
	}
	if err := c.post(ctx, "/courier/assign/awb", payload, &out); err != nil {
		return nil, err
	}

	code := out.Response.Data.AWBCode
	if code == "" {
		return nil, fmt.Errorf("shiprocket: no AWB assigned (message: %v)", out.Message)
	}

	return &AWB{
		AWBCode:     code,
		CourierName: out.Response.Data.CourierName,
		ShipmentID:  shipmentID,
		TrackingURL: "https://shiprocket.co/tracking/" + code,
	}, nil
}

// RequestPickup asks the courier to collect the shipment.
func (c *Client) RequestPickup(ctx context.Context, shipmentID int64) error {
	if c == nil {
		return ErrNotConfigured
	}
	var out struct {
		PickupStatus int `json:"pickup_status"`
		Response     any `json:"response"`
	}
	return c.post(ctx, "/courier/generate/pickup", map[string]any{
		"shipment_id": []int64{shipmentID},
	}, &out)
}

// Track returns a shipment's current status and scan history.
func (c *Client) Track(ctx context.Context, awbCode string) (*TrackingStatus, error) {
	if c == nil {
		return nil, ErrNotConfigured
	}
	token, err := c.authToken(ctx)
	if err != nil {
		return nil, err
	}

	var out struct {
		TrackingData struct {
			TrackStatus    int `json:"track_status"`
			ShipmentStatus any `json:"shipment_status"`
			ShipmentTrack  []struct {
				AWBCode       string `json:"awb_code"`
				CurrentStatus string `json:"current_status"`
				CourierName   string `json:"courier_name"`
				DeliveredDate string `json:"delivered_date"`
				EDD           string `json:"edd"`
			} `json:"shipment_track"`
			ShipmentTrackActivities []TrackingActivity `json:"shipment_track_activities"`
		} `json:"tracking_data"`
	}
	if err := c.get(ctx, token, "/courier/track/awb/"+awbCode, &out); err != nil {
		return nil, err
	}
	if len(out.TrackingData.ShipmentTrack) == 0 {
		return nil, errors.New("shiprocket: no tracking data for AWB " + awbCode)
	}

	track := out.TrackingData.ShipmentTrack[0]
	status := &TrackingStatus{
		AWBCode:     track.AWBCode,
		Status:      track.CurrentStatus,
		CourierName: track.CourierName,
		Activities:  out.TrackingData.ShipmentTrackActivities,
	}
	if code, ok := out.TrackingData.ShipmentStatus.(float64); ok {
		status.StatusCode = int(code)
	}
	if t, err := time.Parse("2006-01-02 15:04:05", track.DeliveredDate); err == nil {
		status.DeliveredAt = &t
	}
	if t, err := time.Parse("2006-01-02", track.EDD); err == nil {
		status.ExpectedDelivery = &t
	}
	return status, nil
}

// post issues an authenticated JSON POST. Unlike get it does not reset the
// breaker on failure: a booking error is usually a validation problem with
// one order, not a dead integration, and pausing all bookings over it
// would be the wrong response.
func (c *Client) post(ctx context.Context, path string, payload any, out any) error {
	ctx, cancel := context.WithTimeout(ctx, bookingTimeout)
	defer cancel()

	token, err := c.authToken(ctx)
	if err != nil {
		return err
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	// Booking needs a longer budget than the shared quote client allows.
	client := &http.Client{Timeout: bookingTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("shiprocket: request: %w", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode == http.StatusUnauthorized {
		c.mu.Lock()
		c.token, c.staticToken = "", ""
		c.mu.Unlock()
		return fmt.Errorf("shiprocket: unauthorized: %s", snippet(raw))
	}
	// Shiprocket uses 200 for success and 422 for validation problems, and
	// the body explains which field is at fault — worth surfacing verbatim.
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return fmt.Errorf("shiprocket: %s returned %d: %s", path, resp.StatusCode, snippet(raw))
	}
	if out == nil {
		return nil
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("shiprocket: decode %s response: %w", path, err)
	}
	return nil
}

// IsDelivered maps a Shiprocket status string to a terminal delivered
// state. Their status vocabulary is broad and inconsistently cased, so
// matching is deliberately loose.
func IsDelivered(status string) bool {
	switch normalizeStatus(status) {
	case "delivered", "rto delivered":
		return true
	}
	return false
}

// IsShipped reports whether a shipment has left the warehouse.
func IsShipped(status string) bool {
	switch normalizeStatus(status) {
	case "shipped", "in transit", "out for delivery", "picked up", "reached destination hub":
		return true
	}
	return IsDelivered(status)
}

func normalizeStatus(status string) string {
	return strings.ToLower(strings.TrimSpace(status))
}

// ParseShipmentID is a convenience for the string IDs Shiprocket echoes
// back in webhook payloads.
func ParseShipmentID(raw string) (int64, error) {
	return strconv.ParseInt(strings.TrimSpace(raw), 10, 64)
}
