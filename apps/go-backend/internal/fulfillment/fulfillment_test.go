package fulfillment

import (
	"encoding/json"
	"strings"
	"testing"
)

// A store fixed at the Hyderabad centre default, so distances in these
// tests are stable regardless of config.
func testPolicy() Policy { return DefaultPolicy() }

func coords(lat, lng float64) Destination { return Destination{Lat: &lat, Lng: &lng} }

func smallCart(qty int, price float64) Cart {
	return Cart{Items: []Item{{SizeClass: SizeSmall, Quantity: qty, UnitPrice: price}}}
}

func optionFor(t *testing.T, q Quote, c Channel) Option {
	t.Helper()
	for _, opt := range q.Options {
		if opt.Channel == c {
			return opt
		}
	}
	t.Fatalf("quote has no option for channel %q", c)
	return Option{}
}

func TestZoneBandsFromDistance(t *testing.T) {
	p := testPolicy()
	cases := []struct {
		name string
		km   float64
		want Zone
	}{
		{"at the store", 0, ZoneStoreLocal},
		{"edge of local", 10, ZoneStoreLocal},
		{"just past local", 10.1, ZoneNear},
		{"near band", 18, ZoneNear},
		{"mid band", 27, ZoneMid},
		{"far band", 44, ZoneFar},
		{"beyond reach", 60, ZoneOutside},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := p.zoneForKm(tc.km); got != tc.want {
				t.Errorf("zoneForKm(%v) = %q, want %q", tc.km, got, tc.want)
			}
		})
	}
}

func TestSmallNearbyOrderRecommendsStoreVisit(t *testing.T) {
	p := testPolicy()
	// Banjara Hills, a few km from the store centre.
	q := p.Quote(smallCart(1, 299), coords(17.4130, 78.4400))

	if q.Zone != ZoneStoreLocal {
		t.Fatalf("zone = %q, want %q", q.Zone, ZoneStoreLocal)
	}
	if q.Recommended != ChannelStorePickup {
		t.Errorf("recommended = %q, want %q", q.Recommended, ChannelStorePickup)
	}
	if !q.StoreVisitSuggested {
		t.Error("StoreVisitSuggested = false, want true for a local customer")
	}
	// The courier stays available — a nudge, not a restriction.
	courier := optionFor(t, q, ChannelCourier)
	if !courier.Available {
		t.Fatalf("courier unavailable for a single small plant: %q", courier.Reason)
	}
	if courier.Fee != 59 {
		t.Errorf("courier fee = %v, want 59 for the local band", courier.Fee)
	}
}

func TestCourierFeeRisesWithDistance(t *testing.T) {
	p := testPolicy()
	cart := smallCart(1, 299)

	// Same cart, progressively further out along a line east of the store.
	local := p.Quote(cart, coords(17.3850, 78.5500))
	mid := p.Quote(cart, coords(17.3850, 78.7500))

	if local.Zone != ZoneStoreLocal {
		t.Fatalf("near zone = %q (%.1f km), want %q", local.Zone, *local.DistanceKm, ZoneStoreLocal)
	}
	if mid.Zone != ZoneMid {
		t.Fatalf("far zone = %q (%.1f km), want %q", mid.Zone, *mid.DistanceKm, ZoneMid)
	}

	localFee, _ := local.Fee(ChannelCourier)
	midFee, ok := mid.Fee(ChannelCourier)
	if !ok {
		t.Fatal("courier unavailable in the mid band, want available")
	}
	if midFee <= localFee {
		t.Errorf("courier fee = %v at %.0f km vs %v locally, want it to rise",
			midFee, *mid.DistanceKm, localFee)
	}
	if mid.StoreVisitSuggested {
		t.Error("StoreVisitSuggested = true, want false for a customer in the mid band")
	}
}

// Past the retail radius an order stops being a delivery problem: the
// customer collects, or it goes through a wholesale quote. Offering a
// courier fee there would be quoting a job Growman does not want.
func TestBeyondRetailRadiusOffersOnlyPickupOrQuote(t *testing.T) {
	p := testPolicy()

	cases := map[string]Destination{
		"beyond 50 km":    coords(17.3850, 79.2000),
		"another city":    coords(16.5000, 80.6500), // Vijayawada
		"unmapped 501xxx": {Pincode: "501999"},      // district series, distance unknown
	}
	for name, dest := range cases {
		t.Run(name, func(t *testing.T) {
			q := p.Quote(smallCart(1, 499), dest)

			if !q.BulkRequired {
				t.Error("BulkRequired = false, want true beyond the retail radius")
			}
			if q.Recommended != ChannelBulkQuote {
				t.Errorf("recommended = %q, want %q", q.Recommended, ChannelBulkQuote)
			}
			for _, c := range []Channel{ChannelCourier, ChannelOwnVehicle} {
				if opt := optionFor(t, q, c); opt.Available {
					t.Errorf("channel %q available beyond the retail radius", c)
				}
			}
			// A store visit is always on the table — whether the drive is
			// worth it is the customer's call.
			if opt := optionFor(t, q, ChannelStorePickup); !opt.Available {
				t.Errorf("store pickup unavailable: %q", opt.Reason)
			}
		})
	}
}

func TestStorePickupIsAlwaysOffered(t *testing.T) {
	p := testPolicy()

	for name, dest := range map[string]Destination{
		"next door":       coords(17.3850, 78.4867),
		"across the city": coords(17.4900, 78.3600),
		"another state":   coords(16.5000, 80.6500),
		"no address":      {},
	} {
		t.Run(name, func(t *testing.T) {
			opt := optionFor(t, p.Quote(smallCart(1, 299), dest), ChannelStorePickup)
			if !opt.Available {
				t.Errorf("store pickup unavailable (%q); it should never be refused", opt.Reason)
			}
			if opt.Fee != 0 {
				t.Errorf("store pickup fee = %v, want 0", opt.Fee)
			}
		})
	}
}

// Home delivery reaches the whole 50 km radius by default.
func TestCourierCoversTheFullFiftyKilometreRadius(t *testing.T) {
	p := testPolicy()

	q := p.Quote(smallCart(1, 299), coords(17.3850, 78.8000)) // ~35 km, far band
	if q.BulkRequired {
		t.Error("BulkRequired = true, want false inside the 50 km radius")
	}
	if fee, ok := q.Fee(ChannelCourier); !ok || fee != 179 {
		t.Errorf("courier fee = %v (available=%v), want the far band 179", fee, ok)
	}
}

func TestRetailRadiusIsConfigurable(t *testing.T) {
	p := testPolicy()
	p.RetailMaxZone = ZoneNear // pull delivery in to 20 km

	q := p.Quote(smallCart(1, 299), coords(17.3850, 78.7500)) // mid band
	if !q.BulkRequired {
		t.Error("BulkRequired = false, want true once the radius is pulled in")
	}
	if opt := optionFor(t, q, ChannelCourier); opt.Available {
		t.Error("courier available beyond the configured radius")
	}
}

func TestLargePlantSkipsCourierForOwnVehicle(t *testing.T) {
	p := testPolicy()
	cart := Cart{Items: []Item{{SizeClass: SizeLarge, Quantity: 1, UnitPrice: 3200}}}
	q := p.Quote(cart, coords(17.4400, 78.3480)) // Gachibowli, ~12 km

	courier := optionFor(t, q, ChannelCourier)
	if courier.Available {
		t.Error("courier available for a large plant, want unavailable")
	}
	if courier.Reason != "plant_too_large" {
		t.Errorf("courier reason = %q, want %q", courier.Reason, "plant_too_large")
	}
	own := optionFor(t, q, ChannelOwnVehicle)
	if !own.Available {
		t.Fatalf("own vehicle unavailable: %q", own.Reason)
	}
	if own.Fee != 399 {
		t.Errorf("own vehicle fee = %v, want 399 for the near band", own.Fee)
	}
	if q.Recommended != ChannelOwnVehicle {
		t.Errorf("recommended = %q, want %q", q.Recommended, ChannelOwnVehicle)
	}
}

func TestBulkyItemBlocksCourierEvenWhenSmall(t *testing.T) {
	p := testPolicy()
	cart := Cart{Items: []Item{{SizeClass: SizeSmall, Bulky: true, Quantity: 1, UnitPrice: 2900}}}
	q := p.Quote(cart, coords(17.4130, 78.4400))

	courier := optionFor(t, q, ChannelCourier)
	if courier.Available || courier.Reason != "item_too_bulky" {
		t.Errorf("courier = (available=%v, reason=%q), want unavailable/item_too_bulky",
			courier.Available, courier.Reason)
	}
}

func TestLargePlantOnSmallBasketHasNoDeliveryOption(t *testing.T) {
	p := testPolicy()
	// Large enough to need the van, too cheap to justify sending it.
	cart := Cart{Items: []Item{{SizeClass: SizeLarge, Quantity: 1, UnitPrice: 900}}}
	q := p.Quote(cart, coords(17.4130, 78.4400))

	if own := optionFor(t, q, ChannelOwnVehicle); own.Available || own.Reason != "below_minimum_order" {
		t.Errorf("own vehicle = (available=%v, reason=%q), want unavailable/below_minimum_order",
			own.Available, own.Reason)
	}
	// Still collectable from the store, which is the right answer here.
	if q.Recommended != ChannelStorePickup {
		t.Errorf("recommended = %q, want %q", q.Recommended, ChannelStorePickup)
	}
}

func TestBulkThresholdsForceAQuote(t *testing.T) {
	p := testPolicy()
	dest := coords(17.4130, 78.4400)

	cases := []struct {
		name string
		cart Cart
	}{
		{"ten plants", smallCart(10, 299)},
		{"high value basket", smallCart(2, 8000)},
		{"xl stock", Cart{Items: []Item{{SizeClass: SizeXL, Quantity: 1, UnitPrice: 4000}}}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			q := p.Quote(tc.cart, dest)
			if !q.BulkRequired {
				t.Error("BulkRequired = false, want true")
			}
			if q.Recommended != ChannelBulkQuote {
				t.Errorf("recommended = %q, want %q", q.Recommended, ChannelBulkQuote)
			}
			if opt := optionFor(t, q, ChannelCourier); opt.Available {
				t.Error("courier available for a bulk cart")
			}
		})
	}
}

func TestBulkQuoteIsAlwaysOfferable(t *testing.T) {
	p := testPolicy()
	q := p.Quote(smallCart(1, 299), coords(17.4130, 78.4400))

	bulk := optionFor(t, q, ChannelBulkQuote)
	if !bulk.Available {
		t.Error("bulk quote unavailable on a small cart; it should always be offerable")
	}
	if bulk.Reason != "" {
		t.Errorf("bulk reason = %q, want empty when not required", bulk.Reason)
	}
}

func TestCourierUnitCap(t *testing.T) {
	p := testPolicy()
	// Nine units is under the bulk threshold but over the courier cap.
	q := p.Quote(smallCart(9, 199), coords(17.4130, 78.4400))

	if q.BulkRequired {
		t.Fatal("BulkRequired = true for 9 units, want false")
	}
	if opt := optionFor(t, q, ChannelCourier); opt.Available || opt.Reason != "too_many_plants" {
		t.Errorf("courier = (available=%v, reason=%q), want unavailable/too_many_plants",
			opt.Available, opt.Reason)
	}
}

func TestFreeDeliveryDisabledByDefault(t *testing.T) {
	p := testPolicy()
	q := p.Quote(smallCart(1, 5000), coords(17.4130, 78.4400))

	courier := optionFor(t, q, ChannelCourier)
	if courier.FeeWaived || courier.Fee == 0 {
		t.Error("courier fee waived while the free-delivery threshold is disabled")
	}
	if q.AmountForFreeDelivery != 0 {
		t.Errorf("AmountForFreeDelivery = %v, want 0 when the waiver is off", q.AmountForFreeDelivery)
	}
}

func TestFreeDeliveryWhenEnabled(t *testing.T) {
	p := testPolicy()
	p.FreeDeliveryMinSubtotal = 999

	t.Run("threshold met", func(t *testing.T) {
		q := p.Quote(smallCart(1, 1200), coords(17.4130, 78.4400))
		courier := optionFor(t, q, ChannelCourier)
		if !courier.FeeWaived || courier.Fee != 0 {
			t.Errorf("courier = (fee=%v, waived=%v), want 0/true", courier.Fee, courier.FeeWaived)
		}
		if courier.Label != "FREE Delivery" {
			t.Errorf("label = %q, want %q", courier.Label, "FREE Delivery")
		}
		if q.AmountForFreeDelivery != 0 {
			t.Errorf("AmountForFreeDelivery = %v, want 0 once met", q.AmountForFreeDelivery)
		}
	})

	t.Run("threshold not met reports the gap", func(t *testing.T) {
		q := p.Quote(smallCart(1, 700), coords(17.4130, 78.4400))
		if q.AmountForFreeDelivery != 299 {
			t.Errorf("AmountForFreeDelivery = %v, want 299", q.AmountForFreeDelivery)
		}
		if opt := optionFor(t, q, ChannelCourier); opt.FeeWaived {
			t.Error("fee waived below the threshold")
		}
	})

	t.Run("not waived beyond the near band", func(t *testing.T) {
		q := p.Quote(smallCart(1, 1200), coords(17.3850, 78.7500)) // mid band
		courier := optionFor(t, q, ChannelCourier)
		if !courier.Available {
			t.Fatalf("courier unavailable in the mid band: %q", courier.Reason)
		}
		if courier.FeeWaived {
			t.Error("fee waived in the mid band, want charged")
		}
		if q.AmountForFreeDelivery != 0 {
			t.Errorf("AmountForFreeDelivery = %v, want 0 where the waiver does not apply",
				q.AmountForFreeDelivery)
		}
	})
}

func TestPincodeFallbackWhenGeolocationDeclined(t *testing.T) {
	p := testPolicy()

	t.Run("mapped pincode", func(t *testing.T) {
		q := p.Quote(smallCart(1, 299), Destination{Pincode: "500081"}) // Hitech City
		if q.DistanceSource != SourcePincode {
			t.Errorf("distance source = %q, want %q", q.DistanceSource, SourcePincode)
		}
		if q.DistanceKm == nil {
			t.Fatal("DistanceKm = nil, want a distance derived from the centroid")
		}
		if q.Zone != ZoneNear {
			t.Errorf("zone = %q (%.1f km), want %q", q.Zone, *q.DistanceKm, ZoneNear)
		}
		if fee, ok := q.Fee(ChannelCourier); !ok || fee != 99 {
			t.Errorf("courier fee = %v (available=%v), want the near-band 99", fee, ok)
		}
	})

	t.Run("unmapped Hyderabad city pincode still gets delivery", func(t *testing.T) {
		// Only ~45 localities are mapped, but every 500xxx pincode is in
		// the metro, so a missing locality must not cost a real Hyderabad
		// customer their delivery option.
		q := p.Quote(smallCart(1, 299), Destination{Pincode: "500111"})
		if q.DistanceSource != SourcePincodePrefix {
			t.Errorf("distance source = %q, want %q", q.DistanceSource, SourcePincodePrefix)
		}
		if q.Zone != ZoneMid {
			t.Fatalf("zone = %q, want %q", q.Zone, ZoneMid)
		}
		courier := optionFor(t, q, ChannelCourier)
		if !courier.Available {
			t.Fatalf("courier unavailable for a Hyderabad pincode: %q", courier.Reason)
		}
		if courier.Fee != 129 {
			t.Errorf("courier fee = %v, want the mid band 129", courier.Fee)
		}
	})

	t.Run("unmapped district pincode is left unmeasured", func(t *testing.T) {
		// 501/502 sprawl well past 50 km, so an unmapped one cannot be
		// assumed close; the risk of underpricing sits with Growman.
		q := p.Quote(smallCart(1, 299), Destination{Pincode: "501999"})
		if q.Zone != ZoneUnknown {
			t.Fatalf("zone = %q, want %q", q.Zone, ZoneUnknown)
		}
		if courier := optionFor(t, q, ChannelCourier); courier.Available {
			t.Error("courier available for an address of unknown distance")
		}
		if q.Recommended != ChannelBulkQuote {
			t.Errorf("recommended = %q, want %q", q.Recommended, ChannelBulkQuote)
		}
	})

	t.Run("pincode outside the region", func(t *testing.T) {
		q := p.Quote(smallCart(1, 299), Destination{Pincode: "560001"}) // Bengaluru
		if q.Zone != ZoneOutside {
			t.Errorf("zone = %q, want %q", q.Zone, ZoneOutside)
		}
		if q.Recommended != ChannelBulkQuote {
			t.Errorf("recommended = %q, want %q", q.Recommended, ChannelBulkQuote)
		}
	})
}

func TestCourierServiceabilityGate(t *testing.T) {
	p := testPolicy()
	cart := smallCart(1, 299)
	dest := coords(17.4130, 78.4400)

	t.Run("courier confirms it cannot service the pincode", func(t *testing.T) {
		q := p.QuoteWith(cart, dest, CourierQuote{Checked: true, Serviceable: false})

		courier := optionFor(t, q, ChannelCourier)
		if courier.Available || courier.Reason != "courier_not_serviceable" {
			t.Errorf("courier = (available=%v, reason=%q), want unavailable/courier_not_serviceable",
				courier.Available, courier.Reason)
		}
		if q.CourierCost != nil {
			t.Error("CourierCost recorded for an unserviceable pincode")
		}
	})

	t.Run("lookup skipped or failed still offers the courier", func(t *testing.T) {
		// Checked=false is what a timeout, an API error, or missing
		// credentials produces. Losing the order would be worse.
		q := p.QuoteWith(cart, dest, CourierQuote{})

		if courier := optionFor(t, q, ChannelCourier); !courier.Available {
			t.Errorf("courier unavailable when the lookup did not happen: %q", courier.Reason)
		}
		if q.CourierCost != nil {
			t.Error("CourierCost recorded without a successful lookup")
		}
	})

	t.Run("successful lookup records cost without changing the price", func(t *testing.T) {
		q := p.QuoteWith(cart, dest, CourierQuote{
			Checked: true, Serviceable: true, RateINR: 86.2,
			CourierName: "Ekart", EstimatedDays: 3,
		})

		courier := optionFor(t, q, ChannelCourier)
		if !courier.Available {
			t.Fatalf("courier unavailable: %q", courier.Reason)
		}
		// The customer pays the zone band, never the aggregator's rate.
		if courier.Fee != 59 {
			t.Errorf("courier fee = %v, want the local band 59", courier.Fee)
		}
		if q.CourierCost == nil || *q.CourierCost != 86.2 {
			t.Errorf("CourierCost = %v, want 86.2", q.CourierCost)
		}
		if q.CourierName != "Ekart" {
			t.Errorf("CourierName = %q, want %q", q.CourierName, "Ekart")
		}
		if q.EstimatedDeliveryDays != 3 {
			t.Errorf("EstimatedDeliveryDays = %v, want 3", q.EstimatedDeliveryDays)
		}
	})

	t.Run("no cost recorded when the courier is not the chosen route", func(t *testing.T) {
		// A large plant cannot go by courier, so a stale rate must not be
		// attached to the order.
		big := Cart{Items: []Item{{SizeClass: SizeLarge, Quantity: 1, UnitPrice: 3200}}}
		q := p.QuoteWith(big, dest, CourierQuote{Checked: true, Serviceable: true, RateINR: 86.2})

		if q.CourierCost != nil {
			t.Errorf("CourierCost = %v, want nil when the courier is unavailable", *q.CourierCost)
		}
	})
}

func TestCourierCostIsNotSerialisedToTheClient(t *testing.T) {
	p := testPolicy()
	q := p.QuoteWith(smallCart(1, 299), coords(17.4130, 78.4400), CourierQuote{
		Checked: true, Serviceable: true, RateINR: 86.2, CourierName: "Ekart",
	})

	raw, err := json.Marshal(q)
	if err != nil {
		t.Fatalf("marshal quote: %v", err)
	}
	// Growman's cost and carrier choice are margin information; the quote
	// is sent to the browser.
	for _, leak := range []string{"86.2", "Ekart", "courierCost", "CourierCost"} {
		if strings.Contains(string(raw), leak) {
			t.Errorf("serialised quote leaks %q: %s", leak, raw)
		}
	}
}

func TestEstimatedWeightKg(t *testing.T) {
	p := testPolicy()
	cart := Cart{Items: []Item{
		{SizeClass: SizeSmall, Quantity: 2},  // 1.5 each
		{SizeClass: SizeMedium, Quantity: 1}, // 4
		{SizeClass: "", Quantity: 1},         // untagged, counted as small
	}}

	if got, want := p.EstimatedWeightKg(cart), 8.5; got != want {
		t.Errorf("EstimatedWeightKg() = %v, want %v", got, want)
	}
	if got := p.EstimatedWeightKg(Cart{}); got != 0 {
		t.Errorf("EstimatedWeightKg(empty) = %v, want 0", got)
	}
}

func TestCartAggregates(t *testing.T) {
	cart := Cart{Items: []Item{
		{SizeClass: SizeSmall, Quantity: 2, UnitPrice: 299},
		{SizeClass: SizeLarge, Quantity: 1, UnitPrice: 1500, Bulky: true},
		{SizeClass: "", Quantity: 3, UnitPrice: 100}, // untagged, treated as small
	}}

	if got, want := cart.Subtotal(), 2398.0; got != want {
		t.Errorf("Subtotal() = %v, want %v", got, want)
	}
	if got, want := cart.Units(), 6; got != want {
		t.Errorf("Units() = %v, want %v", got, want)
	}
	if got := cart.MaxSizeClass(); got != SizeLarge {
		t.Errorf("MaxSizeClass() = %q, want %q", got, SizeLarge)
	}
	if !cart.HasBulky() {
		t.Error("HasBulky() = false, want true")
	}
}

func TestSizeClassNormalize(t *testing.T) {
	cases := map[SizeClass]SizeClass{
		"":         SizeSmall,
		"Small":    SizeSmall,
		" MEDIUM":  SizeMedium,
		"large":    SizeLarge,
		"XL":       SizeXL,
		"gigantic": SizeSmall, // unknown values do not silently become quote-only
	}
	for in, want := range cases {
		if got := in.Normalize(); got != want {
			t.Errorf("SizeClass(%q).Normalize() = %q, want %q", in, got, want)
		}
	}
}

func TestHaversineKm(t *testing.T) {
	// Store centre to Hitech City is roughly 11 km as the crow flies.
	got := HaversineKm(17.3850, 78.4867, 17.4600, 78.3650)
	if got < 13 || got > 16 {
		t.Errorf("HaversineKm() = %.2f km, want roughly 14 km", got)
	}
	if d := HaversineKm(17.3850, 78.4867, 17.3850, 78.4867); d != 0 {
		t.Errorf("distance to itself = %v, want 0", d)
	}
}
