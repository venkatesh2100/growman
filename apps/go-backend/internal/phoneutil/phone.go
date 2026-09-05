// Package phoneutil normalizes Indian mobile numbers. Phone rows in the
// database are stored in more than one historical format (10-digit,
// 91-prefixed, +91-prefixed), so every lookup goes through LookupVariants
// rather than assuming one.
package phoneutil

import "strings"

// DigitsOnly strips non-digits.
func DigitsOnly(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// TenDigitIN returns the last 10 digits for Indian mobiles, or "" if invalid.
func TenDigitIN(s string) string {
	d := DigitsOnly(s)
	if strings.HasPrefix(d, "91") && len(d) >= 12 {
		d = d[len(d)-10:]
	}
	if len(d) == 10 && d[0] >= '6' && d[0] <= '9' {
		return d
	}
	return ""
}

// Msg91Format returns digits for MSG91 (no plus), e.g. 919876543210.
func Msg91Format(s string) string {
	ten := TenDigitIN(s)
	if ten == "" {
		return DigitsOnly(s)
	}
	return "91" + ten
}

// LookupVariants returns phone values to try against the users.phone column
// (legacy 10-digit rows and E.164-without-plus 91… rows).
func LookupVariants(s string) []string {
	ten := TenDigitIN(s)
	if ten == "" {
		d := DigitsOnly(s)
		if d == "" {
			return nil
		}
		return []string{d}
	}
	return []string{ten, "91" + ten, "+91" + ten}
}
