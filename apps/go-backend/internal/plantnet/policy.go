package plantnet

import (
	"encoding/json"
	"strings"
	"time"
)

// Focus selects which identify credits a scan may spend.
//
//	species — 1 credit. Species only.
//	health  — species, plus diseases when the daily reserve allows it.
//	variety — species, plus varieties when the plant is in the variety catalog.
//	full    — health and variety, each still gated.
//	care    — the default. Species always; diseases when quota allows;
//	          varieties only for crops Pl@ntNet actually models.
const (
	FocusSpecies = "species"
	FocusHealth  = "health"
	FocusVariety = "variety"
	FocusFull    = "full"
	FocusCare    = "care"
)

// Skip reasons returned to clients. They are stable strings.
const (
	SkipNotRequested = "not_requested"
	SkipQuotaReserve = "quota_reserve"
	SkipNotInCatalog = "not_in_catalog"
	SkipFailed       = "failed"
	SkipNoSpecies    = "no_species"
)

// Spend is the decision for the two optional identify calls.
// The species call is always required and is not represented here.
type Spend struct {
	Disease     bool
	Variety     bool
	DiseaseSkip string
	VarietySkip string
}

// NormalizeFocus returns a known focus, or "care" when the value is empty
// or not one of the supported modes.
func NormalizeFocus(focus string) string {
	switch strings.ToLower(strings.TrimSpace(focus)) {
	case FocusSpecies, FocusHealth, FocusVariety, FocusFull, FocusCare:
		return strings.ToLower(strings.TrimSpace(focus))
	default:
		return FocusCare
	}
}

// Plan decides the optional identify calls.
//
// remaining is today's leftover identify credits after the species call
// the caller is about to make, or the last value Pl@ntNet reported.
// known is false until this process has seen a remaining count for the
// current UTC day — the first scan of the day is allowed to try the
// extra call, and the response then teaches us the real balance.
//
// Extra calls are refused once remaining is at or below reserve, so a
// busy day degrades to species-only instead of spending the last credits
// three at a time.
func Plan(focus string, remaining int, known bool, reserve int) Spend {
	if reserve < 0 {
		reserve = 0
	}
	focus = NormalizeFocus(focus)
	wantDisease := focus == FocusHealth || focus == FocusFull || focus == FocusCare
	wantVariety := focus == FocusVariety || focus == FocusFull || focus == FocusCare

	var s Spend
	if !wantDisease {
		s.DiseaseSkip = SkipNotRequested
	} else if known && remaining <= reserve {
		s.DiseaseSkip = SkipQuotaReserve
	} else {
		s.Disease = true
	}
	if !wantVariety {
		s.VarietySkip = SkipNotRequested
	} else if known && remaining <= reserve {
		s.VarietySkip = SkipQuotaReserve
	} else {
		s.Variety = true
	}
	return s
}

// Project is one flora from GET /v2/projects.
type Project struct {
	ID           string `json:"id"`
	Title        string `json:"title"`
	Description  string `json:"description"`
	SpeciesCount int    `json:"speciesCount"`
}

// PickFlora chooses the identification project.
//
// An explicit project wins. Otherwise the first Kew-TDWG flora (id prefix
// "k-") in the list wins — GET /v2/projects?lat=&lon= returns floras
// nearest-first, and identifying inside that flora spends the same single
// credit as "all" with a tighter checklist. With no coordinates, fallback
// (usually "all") lets Pl@ntNet pick.
func PickFlora(explicit string, projects []Project, fallback string) string {
	explicit = strings.TrimSpace(explicit)
	if explicit != "" && explicit != "all" && ValidProject(explicit) {
		return explicit
	}
	for _, p := range projects {
		id := strings.TrimSpace(p.ID)
		if strings.HasPrefix(id, "k-") && ValidProject(id) {
			return id
		}
	}
	if ValidProject(fallback) && fallback != "" {
		return fallback
	}
	return "all"
}

// ValidProject reports whether s is safe to put in a URL path.
func ValidProject(s string) bool {
	if s == "" || len(s) > 64 {
		return false
	}
	for i, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
		case r == '-' && i > 0:
		default:
			return false
		}
	}
	return true
}

// ValidLang is a short language code from GET /v2/languages ("en", "pt-br").
func ValidLang(s string) bool {
	if len(s) < 2 || len(s) > 8 {
		return false
	}
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r == '-':
		default:
			return false
		}
	}
	return true
}

// ValidOrgan is an organ hint Pl@ntNet accepts.
func ValidOrgan(s string) bool {
	switch s {
	case "auto", "leaf", "flower", "fruit", "bark":
		return true
	default:
		return false
	}
}

// RemainingIdentifications reads the counter Pl@ntNet returns on every
// identify response. ok is false when the field is absent.
func RemainingIdentifications(body []byte) (n int, ok bool) {
	var doc struct {
		Remaining *int `json:"remainingIdentificationRequests"`
	}
	if err := json.Unmarshal(body, &doc); err != nil || doc.Remaining == nil {
		return 0, false
	}
	return *doc.Remaining, true
}

// UntilUTCMidnight is how long a per-day cache should live. The identify
// quota resets at 00:00 UTC, so a photo cached until then cannot spend a
// second credit the same day, and is eligible again after the reset.
func UntilUTCMidnight(now time.Time) time.Duration {
	u := now.UTC()
	next := time.Date(u.Year(), u.Month(), u.Day()+1, 0, 0, 0, 0, time.UTC)
	d := next.Sub(u)
	if d < time.Minute {
		return time.Minute
	}
	return d
}

// Binomial returns the genus + species, lowercased, so
// "Ajuga genevensis L." and "Ajuga genevensis" compare equal.
func Binomial(name string) string {
	fields := strings.Fields(strings.ToLower(strings.TrimSpace(name)))
	if len(fields) >= 2 && fields[0] == "×" {
		if len(fields) >= 3 {
			return fields[0] + " " + fields[1] + " " + fields[2]
		}
		return strings.Join(fields, " ")
	}
	if len(fields) >= 2 {
		return fields[0] + " " + fields[1]
	}
	if len(fields) == 1 {
		return fields[0]
	}
	return ""
}
