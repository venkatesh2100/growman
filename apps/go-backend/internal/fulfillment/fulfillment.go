// Package fulfillment decides how a Growman order can reach the customer:
// collected at the Hyderabad store, sent via a third-party courier
// (Shiprocket), carried by Growman's own vehicle, or handed to sales as a
// bulk quote. It is pure logic with no DB or HTTP dependency, so every
// pricing and eligibility rule lives in one testable place — see
// internal/docs/05-orders-checkout-payments.md.
//
// The engine answers one question: given a cart, a destination, and a
// Policy, which channels are available, what does each cost, and which one
// should checkout recommend?
package fulfillment

import (
	"math"
	"strings"
)

// SizeClass buckets a plant by how hard it is to move. Courier partners can
// take small and medium pot0s; large plants need Growman's own vehicle, and
// XL stock (mature trees, palms) is quote-only.
type SizeClass string

const (
	SizeSmall  SizeClass = "small"
	SizeMedium SizeClass = "medium"
	SizeLarge  SizeClass = "large"
	SizeXL     SizeClass = "xl"
)

var sizeRank = map[SizeClass]int{SizeSmall: 0, SizeMedium: 1, SizeLarge: 2, SizeXL: 3}

// Rank orders size classes from smallest (0) to largest, for threshold
// comparisons like "courier takes anything up to medium".
func (s SizeClass) Rank() int { return sizeRank[s.Normalize()] }

// Normalize maps free-form or empty input onto a known class. Unknown
// values fall back to small so a mis-tagged product never silently becomes
// quote-only; the cost of being wrong here is a failed courier pickup,
// which ops will notice, rather than a lost order nobody sees.
func (s SizeClass) Normalize() SizeClass {
	switch SizeClass(strings.ToLower(strings.TrimSpace(string(s)))) {
	case SizeMedium:
		return SizeMedium
	case SizeLarge:
		return SizeLarge
	case SizeXL:
		return SizeXL
	default:
		return SizeSmall
	}
}

// Channel is a way of getting plants to a customer.
type Channel string

const (
	ChannelStorePickup Channel = "store_pickup"
	ChannelCourier     Channel = "courier"
	ChannelOwnVehicle  Channel = "own_vehicle"
	ChannelBulkQuote   Channel = "bulk_quote"
)

// Zone is a distance band from the single Hyderabad store. Bands, not exact
// kilometres, drive pricing so fees stay predictable for customers.
type Zone string

const (
	ZoneStoreLocal Zone = "store_local" // walk-in territory
	ZoneNear       Zone = "near"
	ZoneMid        Zone = "mid"
	ZoneFar        Zone = "far"
	ZoneOutside    Zone = "outside" // beyond own-delivery reach
	ZoneUnknown    Zone = "unknown" // no coordinates and an unmapped pincode
)

var zoneRank = map[Zone]int{ZoneStoreLocal: 0, ZoneNear: 1, ZoneMid: 2, ZoneFar: 3, ZoneOutside: 4}

// Rank orders zones from closest to furthest. ZoneUnknown ranks alongside
// ZoneFar: priced conservatively, but still serviceable.
func (z Zone) Rank() int {
	if z == ZoneUnknown {
		return zoneRank[ZoneFar]
	}
	return zoneRank[z]
}

// Deliverable reports whether Growman ships to the zone at all.
func (z Zone) Deliverable() bool { return z != ZoneOutside }

// ParseZone reads a zone name, for config that caps the delivery radius.
func ParseZone(s string) (Zone, bool) {
	z := Zone(strings.ToLower(strings.TrimSpace(s)))
	switch z {
	case ZoneStoreLocal, ZoneNear, ZoneMid, ZoneFar:
		return z, true
	default:
		return "", false
	}
}

// How the distance behind a quote was established. Recorded on the order so
// the accuracy of the fee can be judged later.
const (
	SourceCoordinates = "coordinates"
	SourcePincode     = "pincode"
	// SourcePincodePrefix means only the pincode series was recognised,
	// placing the address in the city but not at a locality.
	SourcePincodePrefix = "pincode_prefix"
	SourceNone          = "none"
)

// Item is one cart line, already resolved to its physical handling
// characteristics. Callers derive SizeClass/Bulky from the product (or its
// selected size) rather than trusting the client.
type Item struct {
	SizeClass SizeClass
	Bulky     bool
	Quantity  int
	UnitPrice float64
}

// Cart is the set of lines being quoted.
type Cart struct {
	Items []Item
}

// Subtotal is the value of goods, before any delivery fee.
func (c Cart) Subtotal() float64 {
	var total float64
	for _, it := range c.Items {
		total += it.UnitPrice * float64(it.Quantity)
	}
	return total
}

// Units is the total number of plants, which drives bulk detection — ten
// plants is a different logistics problem than one, whatever they cost.
func (c Cart) Units() int {
	var n int
	for _, it := range c.Items {
		n += it.Quantity
	}
	return n
}

// MaxSizeClass is the largest class in the cart; the hardest item to move
// dictates which channels can take the whole order.
func (c Cart) MaxSizeClass() SizeClass {
	max := SizeSmall
	for _, it := range c.Items {
		if it.SizeClass.Rank() > max.Rank() {
			max = it.SizeClass.Normalize()
		}
	}
	return max
}

// HasBulky reports whether any line is flagged as awkward to courier
// regardless of its size class (wide canopies, ceramic planters, glass).
func (c Cart) HasBulky() bool {
	for _, it := range c.Items {
		if it.Bulky {
			return true
		}
	}
	return false
}

// Destination is where the customer wants the order. Coordinates are
// preferred; the pincode is the fallback when the browser denies
// geolocation.
type Destination struct {
	Lat     *float64
	Lng     *float64
	Pincode string
}

// CourierQuote is the outcome of a live lookup with the courier
// aggregator, supplied by the caller so this package stays free of HTTP.
//
// Checked distinguishes "we asked" from "we didn't or couldn't". An
// unchecked lookup — no credentials, a timeout, an API error — leaves the
// courier available on the static fee bands, because refusing delivery
// because a third-party API was slow would lose real orders.
type CourierQuote struct {
	Checked     bool
	Serviceable bool
	// RateINR is what the courier charges Growman. It never reaches the
	// customer: the price they pay comes from CourierFeeByZone.
	RateINR       float64
	CourierName   string
	EstimatedDays int
}

// Policy holds every tunable number in the model. Defaults come from
// DefaultPolicy and are overridden from config so fees can be changed
// without a code deploy.
type Policy struct {
	StoreLat float64
	StoreLng float64

	// Upper bound of each zone, in kilometres from the store. Anything
	// past FarMaxKm is ZoneOutside.
	StoreLocalMaxKm float64
	NearMaxKm       float64
	MidMaxKm        float64
	FarMaxKm        float64

	// RetailMaxZone is the furthest zone that gets self-serve delivery.
	// Past it, an order is not a retail delivery problem: the customer
	// either collects from the nursery or goes through a wholesale quote,
	// so no courier or vehicle fee is offered at all.
	RetailMaxZone Zone

	CourierProvider     string
	CourierFeeByZone    map[Zone]float64
	CourierMaxSizeClass SizeClass
	CourierMaxUnits     int
	// WeightKgBySizeClass estimates shipping weight per plant, needed to
	// ask the aggregator for a rate. These are potted-plant averages, not
	// measured values; the gap between the estimate-driven rate and what
	// the courier actually bills shows up in the recorded courier cost.
	WeightKgBySizeClass map[SizeClass]float64

	OwnVehicleFeeByZone   map[Zone]float64
	OwnVehicleMinSubtotal float64

	// FreeDeliveryMinSubtotal waives the courier fee above this subtotal.
	// Zero disables the waiver entirely, which is the default: subsidising
	// delivery before the real courier cost and gross margin per order are
	// known is guesswork. Enable it once there is order data.
	FreeDeliveryMinSubtotal float64
	// FreeDeliveryMaxZone is the furthest zone the waiver applies to, so a
	// 45 km delivery is never given away on a small basket.
	FreeDeliveryMaxZone Zone

	// A cart at or past either threshold stops being self-serve checkout
	// and becomes a sales-handled quote.
	BulkMinUnits    int
	BulkMinSubtotal float64
}

// DefaultPolicy is the launch configuration for a single Hyderabad store:
// customers pay the real cost of delivery, store visits are encouraged
// nearby, and anything large or numerous is routed away from the courier.
func DefaultPolicy() Policy {
	return Policy{
		// Approximate Hyderabad centre. Override with the actual store
		// coordinates via STORE_LATITUDE / STORE_LONGITUDE.
		StoreLat: 17.3850,
		StoreLng: 78.4867,

		StoreLocalMaxKm: 10,
		NearMaxKm:       20,
		MidMaxKm:        30,
		FarMaxKm:        50,

		RetailMaxZone: ZoneFar,

		CourierProvider: "Shiprocket",
		CourierFeeByZone: map[Zone]float64{
			ZoneStoreLocal: 59,
			ZoneNear:       99,
			ZoneMid:        129,
			ZoneFar:        179,
		},
		CourierMaxSizeClass: SizeMedium,
		CourierMaxUnits:     8,
		WeightKgBySizeClass: map[SizeClass]float64{
			SizeSmall:  1.5,
			SizeMedium: 4,
			SizeLarge:  12,
			SizeXL:     30,
		},

		OwnVehicleFeeByZone: map[Zone]float64{
			ZoneStoreLocal: 299,
			ZoneNear:       399,
			ZoneMid:        549,
			ZoneFar:        799,
		},
		OwnVehicleMinSubtotal: 2500,

		FreeDeliveryMinSubtotal: 0,
		FreeDeliveryMaxZone:     ZoneNear,

		BulkMinUnits:    10,
		BulkMinSubtotal: 15000,
	}
}

// Option is one channel as offered (or refused) to the customer.
type Option struct {
	Channel   Channel `json:"channel"`
	Available bool    `json:"available"`
	Label     string  `json:"label"`
	Fee       float64 `json:"fee"`
	// FeeWaived marks a fee that the free-delivery threshold zeroed out,
	// distinguishing "free because we're absorbing it" from "no fee
	// applies", which matters when measuring the delivery subsidy.
	FeeWaived bool `json:"feeWaived"`
	// Reason explains an unavailable option, for display and for debugging
	// why an order took the channel it did. Empty when available.
	Reason string `json:"reason,omitempty"`
}

// Quote is the full answer for one cart and destination.
type Quote struct {
	Zone           Zone      `json:"zone"`
	DistanceKm     *float64  `json:"distanceKm"`
	DistanceSource string    `json:"distanceSource"`
	Subtotal       float64   `json:"subtotal"`
	Units          int       `json:"units"`
	MaxSizeClass   SizeClass `json:"maxSizeClass"`

	Options     []Option `json:"options"`
	Recommended Channel  `json:"recommended"`

	// StoreVisitSuggested is set for customers close enough that a visit is
	// the better outcome for both sides: no delivery cost, and a chance to
	// sell more than they came for.
	StoreVisitSuggested bool `json:"storeVisitSuggested"`
	// BulkRequired is set when the cart is too large or valuable for
	// self-serve checkout and must go through a quote.
	BulkRequired bool `json:"bulkRequired"`
	// AmountForFreeDelivery is how much more the customer would need to
	// spend to cross the free-delivery threshold. Zero when the waiver is
	// disabled, already met, or unavailable in this zone.
	AmountForFreeDelivery float64 `json:"amountForFreeDelivery"`
	// EstimatedDeliveryDays is the courier's own estimate, when one was
	// returned. Zero means unknown.
	EstimatedDeliveryDays int `json:"estimatedDeliveryDays,omitempty"`

	// CourierCost and CourierName are Growman's cost side: what the
	// aggregator quoted, and which carrier quoted it. Deliberately not
	// serialised — this is margin information, and the quote is sent to
	// the browser.
	CourierCost *float64 `json:"-"`
	CourierName string   `json:"-"`
}

// EstimatedWeightKg is the cart's shipping weight, from the per-size-class
// estimates in the policy.
func (p Policy) EstimatedWeightKg(cart Cart) float64 {
	var kg float64
	for _, it := range cart.Items {
		kg += p.WeightKgBySizeClass[it.SizeClass.Normalize()] * float64(it.Quantity)
	}
	return round2(kg)
}

// Option returns the quoted option for a channel, or ok=false if the
// channel was not quoted at all.
func (q Quote) Option(c Channel) (opt Option, ok bool) {
	for _, o := range q.Options {
		if o.Channel == c {
			return o, true
		}
	}
	return Option{}, false
}

// Fee returns the fee for a channel in this quote, and whether that channel
// is actually available.
func (q Quote) Fee(c Channel) (fee float64, ok bool) {
	opt, found := q.Option(c)
	if !found {
		return 0, false
	}
	return opt.Fee, opt.Available
}

// ResolveZone works out how far the destination is from the store,
// preferring coordinates from the browser and falling back to the
// pincode-centroid table. An unmapped pincode inside the Hyderabad series
// is serviceable but unmeasured (ZoneUnknown, priced as the furthest
// band); anything else is out of area.
func (p Policy) ResolveZone(d Destination) (km *float64, zone Zone, source string) {
	if d.Lat != nil && d.Lng != nil {
		dist := HaversineKm(p.StoreLat, p.StoreLng, *d.Lat, *d.Lng)
		return &dist, p.zoneForKm(dist), SourceCoordinates
	}
	if lat, lng, ok := CentroidForPincode(d.Pincode); ok {
		dist := HaversineKm(p.StoreLat, p.StoreLng, lat, lng)
		return &dist, p.zoneForKm(dist), SourcePincode
	}
	// An unmapped Hyderabad-city pincode is still inside the metro, so it
	// gets delivery at the mid band rather than being treated as
	// unmeasurable. Priced one band out from the city average, which errs
	// toward charging slightly too much rather than too little.
	if CityPincode(d.Pincode) {
		return nil, ZoneMid, SourcePincodePrefix
	}
	if !ServiceablePincode(d.Pincode) {
		return nil, ZoneOutside, SourceNone
	}
	return nil, ZoneUnknown, SourceNone
}

func (p Policy) zoneForKm(km float64) Zone {
	switch {
	case km <= p.StoreLocalMaxKm:
		return ZoneStoreLocal
	case km <= p.NearMaxKm:
		return ZoneNear
	case km <= p.MidMaxKm:
		return ZoneMid
	case km <= p.FarMaxKm:
		return ZoneFar
	default:
		return ZoneOutside
	}
}

// Quote evaluates every channel without consulting the courier API, so the
// courier is offered on the static fee bands wherever the zone allows it.
func (p Policy) Quote(cart Cart, dest Destination) Quote {
	return p.QuoteWith(cart, dest, CourierQuote{})
}

// QuoteWith evaluates every channel for the cart and picks a
// recommendation, taking a live courier lookup into account when one was
// performed.
func (p Policy) QuoteWith(cart Cart, dest Destination, courierQuote CourierQuote) Quote {
	km, zone, source := p.ResolveZone(dest)

	q := Quote{
		Zone:           zone,
		DistanceKm:     km,
		DistanceSource: source,
		Subtotal:       cart.Subtotal(),
		Units:          cart.Units(),
		MaxSizeClass:   cart.MaxSizeClass(),
	}

	q.BulkRequired = q.Units >= p.BulkMinUnits ||
		q.Subtotal >= p.BulkMinSubtotal ||
		q.MaxSizeClass == SizeXL ||
		!p.withinRetailRange(zone)

	pickup := p.storePickupOption()
	courier := p.courierOption(cart, zone, q.BulkRequired, courierQuote)
	own := p.ownVehicleOption(cart, zone, q.BulkRequired)
	bulk := p.bulkQuoteOption(q.BulkRequired)

	q.Options = []Option{pickup, courier, own, bulk}

	// A bulk cart always goes to sales; otherwise prefer the cheapest
	// sustainable path, which near the store means getting them to visit.
	switch {
	case q.BulkRequired:
		q.Recommended = ChannelBulkQuote
	case zone == ZoneStoreLocal && pickup.Available:
		q.Recommended = ChannelStorePickup
	case courier.Available:
		q.Recommended = ChannelCourier
	case own.Available:
		q.Recommended = ChannelOwnVehicle
	case pickup.Available:
		q.Recommended = ChannelStorePickup
	default:
		q.Recommended = ChannelBulkQuote
	}

	q.StoreVisitSuggested = pickup.Available && zone.Rank() <= ZoneNear.Rank()

	if p.freeDeliveryApplies(zone) && courier.Available && !courier.FeeWaived {
		if gap := p.FreeDeliveryMinSubtotal - q.Subtotal; gap > 0 {
			q.AmountForFreeDelivery = round2(gap)
		}
	}

	if courier.Available && courierQuote.Checked && courierQuote.Serviceable {
		cost := round2(courierQuote.RateINR)
		q.CourierCost = &cost
		q.CourierName = courierQuote.CourierName
		q.EstimatedDeliveryDays = courierQuote.EstimatedDays
	}

	return q
}

// withinRetailRange reports whether self-serve delivery is offered to the
// zone at all.
//
// ZoneUnknown is excluded whatever the cap: it is the absence of a
// distance, not a far one, and quoting a retail fee for an address that
// might be 20 km or 200 km away is a bet Growman would lose. Those go to a
// custom quote instead.
func (p Policy) withinRetailRange(zone Zone) bool {
	if zone == ZoneUnknown || !zone.Deliverable() {
		return false
	}
	return zone.Rank() <= p.RetailMaxZone.Rank()
}

// storePickupOption is always available. Whether a drive is worth making is
// the customer's call, not something to decide for them from a pincode.
func (p Policy) storePickupOption() Option {
	return Option{
		Channel:   ChannelStorePickup,
		Label:     "Visit Store",
		Available: true,
		Fee:       0,
	}
}

func (p Policy) courierOption(cart Cart, zone Zone, bulkRequired bool, courierQuote CourierQuote) Option {
	opt := Option{Channel: ChannelCourier, Label: "Home Delivery"}
	fee := p.CourierFeeByZone[zone]
	if zone == ZoneUnknown {
		fee = p.CourierFeeByZone[ZoneFar]
	}

	switch {
	case bulkRequired:
		opt.Reason = "bulk_order"
	case !p.withinRetailRange(zone):
		opt.Reason = "outside_delivery_radius"
	// Only a definitive "no courier covers this pincode" blocks delivery.
	// A skipped or failed lookup leaves Checked false and falls through.
	case courierQuote.Checked && !courierQuote.Serviceable:
		opt.Reason = "courier_not_serviceable"
	case cart.HasBulky():
		opt.Reason = "item_too_bulky"
	case cart.MaxSizeClass().Rank() > p.CourierMaxSizeClass.Rank():
		opt.Reason = "plant_too_large"
	case cart.Units() > p.CourierMaxUnits:
		opt.Reason = "too_many_plants"
	default:
		opt.Available = true
		opt.Fee = round2(fee)
		if p.freeDeliveryApplies(zone) && cart.Subtotal() >= p.FreeDeliveryMinSubtotal {
			opt.Fee = 0
			opt.FeeWaived = true
			opt.Label = "FREE Delivery"
		}
	}
	return opt
}

func (p Policy) ownVehicleOption(cart Cart, zone Zone, bulkRequired bool) Option {
	opt := Option{Channel: ChannelOwnVehicle, Label: "Growman Delivery"}
	switch {
	case bulkRequired:
		opt.Reason = "bulk_order"
	case !p.withinRetailRange(zone):
		opt.Reason = "outside_delivery_radius"
	case cart.Subtotal() < p.OwnVehicleMinSubtotal:
		// Sending the van out for a small basket loses money on every trip.
		opt.Reason = "below_minimum_order"
	default:
		fee := p.OwnVehicleFeeByZone[zone]
		if zone == ZoneUnknown {
			fee = p.OwnVehicleFeeByZone[ZoneFar]
		}
		opt.Available = true
		opt.Fee = round2(fee)
	}
	return opt
}

func (p Policy) bulkQuoteOption(bulkRequired bool) Option {
	// Always offered: a customer with nine plants in the cart who knows
	// they want fifty should be able to switch tracks.
	return Option{
		Channel:   ChannelBulkQuote,
		Label:     "Get Bulk Quote",
		Available: true,
		Reason: func() string {
			if bulkRequired {
				return "quote_required"
			}
			return ""
		}(),
	}
}

func (p Policy) freeDeliveryApplies(zone Zone) bool {
	return p.FreeDeliveryMinSubtotal > 0 &&
		zone.Deliverable() &&
		zone.Rank() <= p.FreeDeliveryMaxZone.Rank()
}

// HaversineKm returns the great-circle distance in kilometres. Road
// distance is longer, which is why fees are banded rather than per-km.
func HaversineKm(lat1, lng1, lat2, lng2 float64) float64 {
	const earthRadiusKm = 6371.0
	dLat := radians(lat2 - lat1)
	dLng := radians(lng2 - lng1)
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(radians(lat1))*math.Cos(radians(lat2))*math.Sin(dLng/2)*math.Sin(dLng/2)
	return earthRadiusKm * 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}

func radians(deg float64) float64 { return deg * math.Pi / 180 }

func round2(v float64) float64 { return math.Round(v*100) / 100 }
