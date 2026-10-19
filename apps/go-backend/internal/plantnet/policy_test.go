package plantnet

import (
	"strings"
	"testing"
	"time"
)

func TestPlanKeepsAReserve(t *testing.T) {
	species := Plan(FocusSpecies, 500, true, 40)
	if species.Disease || species.Variety {
		t.Fatalf("species focus spent extra credits: %+v", species)
	}
	if species.DiseaseSkip != SkipNotRequested || species.VarietySkip != SkipNotRequested {
		t.Fatalf("species skips = %+v", species)
	}

	// Remaining is the balance after the species call. At the reserve,
	// health and variety must not spend another credit.
	held := Plan(FocusCare, 40, true, 40)
	if held.Disease || held.Variety {
		t.Fatalf("care focus spent credits at the reserve: %+v", held)
	}
	if held.DiseaseSkip != SkipQuotaReserve || held.VarietySkip != SkipQuotaReserve {
		t.Fatalf("reserve skips = %+v", held)
	}

	open := Plan(FocusCare, 41, true, 40)
	if !open.Disease || !open.Variety {
		t.Fatalf("care focus should spend while above the reserve: %+v", open)
	}

	// The first observation of the day has no balance yet, so the extra
	// call is allowed and the response teaches us the real number.
	unknown := Plan(FocusHealth, 0, false, 40)
	if !unknown.Disease || unknown.Variety {
		t.Fatalf("health focus with unknown quota = %+v", unknown)
	}

	full := Plan(FocusFull, 100, true, 40)
	if !full.Disease || !full.Variety {
		t.Fatalf("full focus = %+v", full)
	}
	onlyVariety := Plan(FocusVariety, 100, true, 40)
	if onlyVariety.Disease || !onlyVariety.Variety {
		t.Fatalf("variety focus = %+v", onlyVariety)
	}
}

func TestNormalizeFocus(t *testing.T) {
	if NormalizeFocus("") != FocusCare || NormalizeFocus("nope") != FocusCare {
		t.Fatal("empty and unknown focus should be care")
	}
	if NormalizeFocus(" HEALTH ") != FocusHealth {
		t.Fatal("focus should trim and lowercase")
	}
}

func TestPickFloraPrefersNearestKewProject(t *testing.T) {
	projects := []Project{
		{ID: "useful", Title: "Useful plants"},
		{ID: "k-indian-subcontinent", Title: "Indian Subcontinent"},
		{ID: "k-world-flora", Title: "World flora"},
	}
	if got := PickFlora("", projects, "all"); got != "k-indian-subcontinent" {
		t.Fatalf("nearest flora = %q", got)
	}
	if got := PickFlora("weeds", projects, "all"); got != "weeds" {
		t.Fatalf("explicit flora = %q", got)
	}
	if got := PickFlora("all", nil, "k-world-flora"); got != "k-world-flora" {
		t.Fatalf("fallback = %q", got)
	}
	if got := PickFlora("../x", nil, "all"); got != "all" {
		t.Fatalf("rejected explicit project, got %q", got)
	}
	if !ValidProject("k-indian-subcontinent") || ValidProject("legacy/../x") || ValidProject("-bad") {
		t.Fatal("project validation")
	}
}

func TestUntilUTCMidnight(t *testing.T) {
	now := time.Date(2026, 10, 18, 18, 30, 0, 0, time.UTC)
	got := UntilUTCMidnight(now)
	want := 5*time.Hour + 30*time.Minute
	if got != want {
		t.Fatalf("ttl = %s, want %s", got, want)
	}
	late := time.Date(2026, 10, 18, 23, 59, 30, 0, time.UTC)
	if UntilUTCMidnight(late) != time.Minute {
		t.Fatalf("late ttl = %s", UntilUTCMidnight(late))
	}
}

func TestBinomial(t *testing.T) {
	if Binomial("Ajuga genevensis L.") != "ajuga genevensis" {
		t.Fatal(Binomial("Ajuga genevensis L."))
	}
	if Binomial("Ajuga genevensis") != Binomial("Ajuga genevensis L.") {
		t.Fatal("authorship should not affect the binomial")
	}
}

func TestRemainingIdentifications(t *testing.T) {
	n, ok := RemainingIdentifications([]byte(`{"remainingIdentificationRequests":498}`))
	if !ok || n != 498 {
		t.Fatalf("remaining = %d ok=%v", n, ok)
	}
	if _, ok := RemainingIdentifications([]byte(`{"bestMatch":"x"}`)); ok {
		t.Fatal("missing counter should not be known")
	}
}

func TestTopSpeciesAndMerge(t *testing.T) {
	raw := []byte(`{
		"bestMatch": "Ajuga genevensis L.",
		"results": [{
			"score": 0.9,
			"species": {
				"scientificNameWithoutAuthor": "Ajuga genevensis",
				"scientificName": "Ajuga genevensis L.",
				"commonNames": ["Blue bugle"],
				"genus": {"scientificName": "Ajuga"},
				"family": {"scientificName": "Lamiaceae"}
			},
			"gbif": {"id": "2927079"},
			"powo": {"id": 444576}
		}]
	}`)
	hit, ok := TopSpecies(raw)
	if !ok || hit.GBIFID != "2927079" || hit.POWOID != "444576" || hit.Family != "Lamiaceae" {
		t.Fatalf("hit = %+v ok=%v", hit, ok)
	}
	merged, err := Merge(raw, Enrichment{
		Species: &hit,
		Flora:   "all",
		Health:  HealthResult{SideResult: SideResult{Skipped: SkipQuotaReserve}},
		Quota:   QuotaReport{CreditsUsed: 1, Reserve: 40},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(merged), `"bestMatch":"Ajuga genevensis L."`) {
		t.Fatalf("bestMatch dropped: %s", merged)
	}
	if !strings.Contains(string(merged), `"gbifId":"2927079"`) {
		t.Fatalf("species summary missing: %s", merged)
	}
	cached := MarkCached(merged)
	if !strings.Contains(string(cached), `"cached":true`) || !strings.Contains(string(cached), `"creditsUsed":0`) {
		t.Fatalf("cached rewrite = %s", cached)
	}
}

func TestHealthAndVarietyParsing(t *testing.T) {
	hits := HealthHits([]byte(`{"results":[{"name":"APHISP","score":0.91,"description":"Aphis sp."},{"score":0.1}]}`))
	if len(hits) != 1 || hits[0].Description != "Aphis sp." {
		t.Fatalf("hits = %+v", hits)
	}
	labeled := ApplyDiseaseLabels([]HealthHit{{Name: "1COCCF"}}, []byte(`[{"name":"1COCCF","label":"Coccidae"}]`))
	if labeled[0].Label != "Coccidae" {
		t.Fatalf("label = %+v", labeled)
	}
	varieties := VarietyHits([]byte(`{"results":[{"species":{"scientificNameWithoutAuthor":"Malus domestica"},"varieties":[{"name":"Gros locard","score":0.4}]}]}`))
	if len(varieties) != 1 || varieties[0].Name != "Gros locard" || varieties[0].Species != "Malus domestica" {
		t.Fatalf("varieties = %+v", varieties)
	}
	catalog := []byte(`[{"name":"Gros locard","species":{"scientificNameWithoutAuthor":"Malus domestica","scientificName":"Malus domestica Borkh."}}]`)
	if !CatalogHasSpecies(catalog, "Malus domestica Borkh.") {
		t.Fatal("catalog should match the binomial")
	}
	if CatalogHasSpecies(catalog, "Epipremnum aureum") {
		t.Fatal("houseplant should not match a crop catalog")
	}
}

func TestNativeCountrySummary(t *testing.T) {
	if got := NativeCountrySummary([]string{"in", "IN", "lk"}); got != "GBIF native records: IN, LK" {
		t.Fatalf("summary = %q", got)
	}
	many := []string{"AA", "BB", "CC", "DD", "EE", "FF", "GG", "HH", "II", "JJ"}
	got := NativeCountrySummary(many)
	if !strings.HasPrefix(got, "GBIF native records in 10 countries") {
		t.Fatalf("summary = %q", got)
	}
}
