// Hyderabad-area pin codes used when a shopper does not send GPS.
// Delivery quoting calls these before it decides a zone or refuses the address.
// Centroids are approximate lat/lng. Serviceable pins start with 500, 501, or 502.

const pincodeCentroids = {
  "500001": [17.38, 78.475],
  "500002": [17.3616, 78.4747],
  "500004": [17.395, 78.46],
  "500012": [17.37, 78.49],
  "500013": [17.39, 78.515],
  "500020": [17.41, 78.5],
  "500029": [17.4, 78.483],
  "500036": [17.375, 78.505],
  "500064": [17.356, 78.46],
  "500008": [17.3833, 78.4011],
  "500016": [17.44, 78.46],
  "500018": [17.46, 78.44],
  "500028": [17.395, 78.435],
  "500033": [17.43, 78.407],
  "500034": [17.413, 78.44],
  "500038": [17.437, 78.448],
  "500073": [17.42, 78.42],
  "500089": [17.403, 78.38],
  "500032": [17.44, 78.348],
  "500049": [17.47, 78.32],
  "500081": [17.46, 78.365],
  "500084": [17.47, 78.36],
  "500019": [17.485, 78.405],
  "500048": [17.49, 78.36],
  "500050": [17.495, 78.33],
  "500072": [17.487, 78.39],
  "500085": [17.493, 78.391],
  "500090": [17.53, 78.38],
  "500055": [17.505, 78.51],
  "500003": [17.42, 78.495],
  "500009": [17.51, 78.5],
  "500047": [17.455, 78.53],
  "500062": [17.48, 78.56],
  "500039": [17.4, 78.56],
  "500060": [17.37, 78.53],
  "500068": [17.33, 78.55],
  "500070": [17.36, 78.56],
  "500074": [17.37, 78.57],
  "500058": [17.34, 78.56],
  "500035": [17.32, 78.4],
  "501301": [17.25, 78.41],
  "501218": [17.07, 78.2],
  "502032": [17.53, 78.26],
  "502319": [17.62, 78.08],
};

// 500 is Hyderabad city. 501 and 502 are the wider area we still deliver to.
const cityPrefix = "500";
const servicePrefixes = new Set([cityPrefix, "501", "502"]);

// Checkout uses this when the cart has a pin but no latitude. Returns { lat, lng }, or null if the pin is not in the table.
export function centroidForPincode(pincode) {
  const c = pincodeCentroids[String(pincode ?? "").trim()];
  if (!c) return null;
  return { lat: c[0], lng: c[1] };
}

// True only for a 6-digit pin whose first three digits are 500, 501, or 502.
// Anything else is outside the delivery area and is quoted as outside.
export function serviceablePincode(pincode) {
  const p = String(pincode ?? "").trim();
  return p.length === 6 && servicePrefixes.has(p.slice(0, 3));
}

// True for Hyderabad city pins (500xxx). Quoting treats an unknown city pin as the mid zone.
export function cityPincode(pincode) {
  const p = String(pincode ?? "").trim();
  return p.length === 6 && p.slice(0, 3) === cityPrefix;
}
