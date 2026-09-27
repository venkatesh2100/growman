package fulfillment

import "strings"

// Pincode fallback for customers who decline browser geolocation.
//
// Each entry is the approximate centroid of the pincode's locality, which
// is then measured against the configured store coordinates like any other
// destination. Storing centroids rather than zone labels keeps the table
// independent of where the store is — moving or adding a store changes no
// data here.
//
// These are locality-level approximations, good to a kilometre or two.
// That is deliberate: fees are banded at 10 km, so small errors do not
// change the price, and coordinates from the browser are the primary path
// whenever the customer allows them.
var pincodeCentroids = map[string][2]float64{
	// Core city and old city
	"500001": {17.3800, 78.4750}, // Abids, Afzalgunj
	"500002": {17.3616, 78.4747}, // Charminar, Moghalpura
	"500004": {17.3950, 78.4600}, // Nampally, Bazarghat
	"500012": {17.3700, 78.4900}, // Malakpet Colony
	"500013": {17.3900, 78.5150}, // Amberpet
	"500020": {17.4100, 78.5000}, // Musheerabad
	"500029": {17.4000, 78.4830}, // Himayatnagar
	"500036": {17.3750, 78.5050}, // Malakpet
	"500064": {17.3560, 78.4600}, // Bahadurpura

	// West and central
	"500008": {17.3833, 78.4011}, // Golconda
	"500016": {17.4400, 78.4600}, // Begumpet
	"500018": {17.4600, 78.4400}, // Sanathnagar
	"500028": {17.3950, 78.4350}, // Mehdipatnam
	"500033": {17.4300, 78.4070}, // Jubilee Hills
	"500034": {17.4130, 78.4400}, // Banjara Hills
	"500038": {17.4370, 78.4480}, // Ameerpet
	"500073": {17.4200, 78.4200}, // Yousufguda
	"500089": {17.4030, 78.3800}, // Manikonda

	// IT corridor
	"500032": {17.4400, 78.3480}, // Gachibowli
	"500049": {17.4700, 78.3200}, // Serilingampally, Nallagandla
	"500081": {17.4600, 78.3650}, // Hitech City, Madhapur
	"500084": {17.4700, 78.3600}, // Kondapur

	// North west
	"500019": {17.4850, 78.4050}, // Kukatpally
	"500048": {17.4900, 78.3600}, // Miyapur, Hafeezpet
	"500050": {17.4950, 78.3300}, // Chandanagar
	"500072": {17.4870, 78.3900}, // KPHB
	"500085": {17.4930, 78.3910}, // JNTU
	"500090": {17.5300, 78.3800}, // Bachupally
	"500055": {17.5050, 78.5100}, // Alwal

	// North and Secunderabad
	"500003": {17.4200, 78.4950}, // Kavadiguda
	"500009": {17.5100, 78.5000}, // Bolarum
	"500047": {17.4550, 78.5300}, // Malkajgiri
	"500062": {17.4800, 78.5600}, // Kushaiguda, ECIL

	// East and south east
	"500039": {17.4000, 78.5600}, // Uppal
	"500060": {17.3700, 78.5300}, // Dilsukhnagar, Saroornagar
	"500068": {17.3300, 78.5500}, // LB Nagar
	"500070": {17.3600, 78.5600}, // Nagole
	"500074": {17.3700, 78.5700}, // Nagole, Bandlaguda
	"500058": {17.3400, 78.5600}, // Hastinapuram

	// South and outskirts
	"500035": {17.3200, 78.4000}, // Rajendranagar
	"501301": {17.2500, 78.4100}, // Shamshabad
	"501218": {17.0700, 78.2000}, // Shadnagar
	"502032": {17.5300, 78.2600}, // Patancheru
	"502319": {17.6200, 78.0800}, // Sangareddy
}

// cityPrefix is the pincode series assigned to Hyderabad city proper.
// Every one of them sits inside the metro, so an unmapped 500xxx address
// can safely be assumed within retail delivery range even though its exact
// locality is unknown — without this, the majority of genuine Hyderabad
// customers would fall through to a custom quote purely because their
// locality is missing from the centroid table above.
const cityPrefix = "500"

// servicePrefixes are the pincode series Growman can plausibly reach:
// Hyderabad city plus the surrounding Rangareddy, Medchal and Sangareddy
// districts. A pincode outside these is treated as out of area without
// needing coordinates for it. The 501/502 districts sprawl well past the
// delivery radius, so an unmapped one is left unmeasured rather than
// assumed close.
var servicePrefixes = map[string]bool{cityPrefix: true, "501": true, "502": true}

// CentroidForPincode returns the approximate coordinates of a mapped
// pincode.
func CentroidForPincode(pincode string) (lat, lng float64, ok bool) {
	c, found := pincodeCentroids[strings.TrimSpace(pincode)]
	if !found {
		return 0, 0, false
	}
	return c[0], c[1], true
}

// ServiceablePincode reports whether a pincode is in the broad Hyderabad
// region, used when the exact locality is unmapped.
func ServiceablePincode(pincode string) bool {
	p := strings.TrimSpace(pincode)
	if len(p) != 6 {
		return false
	}
	return servicePrefixes[p[:3]]
}

// CityPincode reports whether a pincode belongs to Hyderabad city itself.
func CityPincode(pincode string) bool {
	p := strings.TrimSpace(pincode)
	return len(p) == 6 && p[:3] == cityPrefix
}
