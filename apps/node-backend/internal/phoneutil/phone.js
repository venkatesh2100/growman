// Indian mobile numbers as the shop stores and sends them.
// Auth, checkout, and MSG91 callers use these helpers before a lookup or an SMS.
// tenDigitIN returns 10 digits or "". msg91Format returns the provider form. lookupVariants returns the strings to search.

// Drops spaces, plus signs, and dashes so "91 98765-43210" and "+919876543210" can be compared.
export function digitsOnly(s) {
  return String(s ?? "").replace(/\D/g, "");
}

// Returns a 10-digit Indian mobile starting with 6, 7, 8, or 9. Anything else is "".
// Callers treat "" as "this is not a phone we can text or look up".
export function tenDigitIN(s) {
  let d = digitsOnly(s);
  // A country code is present when the digits start with 91 and there are at least 12 of them.
  if (d.startsWith("91") && d.length >= 12) d = d.slice(-10);
  if (d.length === 10 && d[0] >= "6" && d[0] <= "9") return d;
  return "";
}

// MSG91 wants 91 followed by the 10-digit mobile.
// If the number is not a valid Indian mobile, the raw digits are returned so the provider can reject them.
export function msg91Format(s) {
  const ten = tenDigitIN(s);
  if (!ten) return digitsOnly(s);
  return "91" + ten;
}

// Older accounts stored the same phone as 10 digits, 91..., or +91....
// Auth lookup tries all three. An unusable input returns the raw digits, or an empty list.
export function lookupVariants(s) {
  const ten = tenDigitIN(s);
  if (!ten) {
    const d = digitsOnly(s);
    return d ? [d] : [];
  }
  return [ten, "91" + ten, "+91" + ten];
}
