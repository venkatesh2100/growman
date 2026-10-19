package plantnet

import (
	"encoding/json"
	"sort"
	"strconv"
	"strings"
)

// SpeciesHit is the top identification, flattened for clients that do not
// want to walk Pl@ntNet's results array. bestMatch and results are still
// returned unchanged alongside this.
type SpeciesHit struct {
	ScientificName              string   `json:"scientificName,omitempty"`
	ScientificNameWithoutAuthor string   `json:"scientificNameWithoutAuthor,omitempty"`
	CommonNames                 []string `json:"commonNames,omitempty"`
	Family                      string   `json:"family,omitempty"`
	Genus                       string   `json:"genus,omitempty"`
	Score                       float64  `json:"score,omitempty"`
	GBIFID                      string   `json:"gbifId,omitempty"`
	POWOID                      string   `json:"powoId,omitempty"`
}

// HealthHit is one disease or pest from POST /v2/diseases/identify.
// Name is the EPPO code. Description is the human label when Pl@ntNet
// sends one.
type HealthHit struct {
	Name        string  `json:"name,omitempty"`
	Description string  `json:"description,omitempty"`
	Label       string  `json:"label,omitempty"`
	Score       float64 `json:"score,omitempty"`
}

// VarietyHit is one cultivar under its species.
type VarietyHit struct {
	Name    string  `json:"name"`
	Species string  `json:"species,omitempty"`
	Score   float64 `json:"score,omitempty"`
}

// SideResult is an optional identify call that may have been skipped
// to save the daily credit.
type SideResult struct {
	Ran     bool   `json:"ran"`
	Skipped string `json:"skipped,omitempty"`
}

// HealthResult is the disease/pest scan.
type HealthResult struct {
	SideResult
	Results []HealthHit `json:"results,omitempty"`
}

// VarietyResult is the cultivar scan.
type VarietyResult struct {
	SideResult
	Results []VarietyHit `json:"results,omitempty"`
}

// QuotaReport tells the caller what this response cost. Remaining is the
// identify credits Pl@ntNet reported after the last call in this scan.
type QuotaReport struct {
	CreditsUsed int  `json:"creditsUsed"`
	Cached      bool `json:"cached"`
	Remaining   *int `json:"remaining,omitempty"`
	Reserve     int  `json:"reserve"`
}

// Origin is where the species occurs. NativeCountries come from GBIF,
// which does not spend a Pl@ntNet credit: the identify response already
// includes the GBIF id. Summary may be rewritten by the care guide.
type Origin struct {
	Summary         string   `json:"summary,omitempty"`
	NativeCountries []string `json:"nativeCountries,omitempty"`
	Source          string   `json:"source,omitempty"`
}

// Enrichment is everything added on top of the raw identify JSON.
type Enrichment struct {
	Flora     string         `json:"flora,omitempty"`
	Species   *SpeciesHit    `json:"species,omitempty"`
	Origin    *Origin        `json:"origin,omitempty"`
	Care      map[string]any `json:"care,omitempty"`
	Health    HealthResult   `json:"health"`
	Varieties VarietyResult  `json:"varieties"`
	Quota     QuotaReport    `json:"quota"`
}

// TopSpecies reads the first result of a species-identify payload.
func TopSpecies(body []byte) (SpeciesHit, bool) {
	var doc struct {
		Results []struct {
			Score   float64 `json:"score"`
			Species struct {
				ScientificName              string   `json:"scientificName"`
				ScientificNameWithoutAuthor string   `json:"scientificNameWithoutAuthor"`
				CommonNames                 []string `json:"commonNames"`
				Family                      struct {
					ScientificName string `json:"scientificName"`
				} `json:"family"`
				Genus struct {
					ScientificName string `json:"scientificName"`
				} `json:"genus"`
			} `json:"species"`
			GBIF struct {
				ID flexID `json:"id"`
			} `json:"gbif"`
			POWO struct {
				ID flexID `json:"id"`
			} `json:"powo"`
		} `json:"results"`
	}
	if err := json.Unmarshal(body, &doc); err != nil || len(doc.Results) == 0 {
		return SpeciesHit{}, false
	}
	r := doc.Results[0]
	hit := SpeciesHit{
		ScientificName:              r.Species.ScientificName,
		ScientificNameWithoutAuthor: r.Species.ScientificNameWithoutAuthor,
		CommonNames:                 r.Species.CommonNames,
		Family:                      r.Species.Family.ScientificName,
		Genus:                       r.Species.Genus.ScientificName,
		Score:                       r.Score,
		GBIFID:                      string(r.GBIF.ID),
		POWOID:                      string(r.POWO.ID),
	}
	if hit.ScientificName == "" && hit.ScientificNameWithoutAuthor == "" {
		return SpeciesHit{}, false
	}
	return hit, true
}

// HealthHits reads disease-identify results. Description is preferred
// for display; Name is the EPPO code.
func HealthHits(body []byte) []HealthHit {
	var doc struct {
		Results []HealthHit `json:"results"`
	}
	if err := json.Unmarshal(body, &doc); err != nil {
		return nil
	}
	out := make([]HealthHit, 0, len(doc.Results))
	for _, h := range doc.Results {
		if h.Name == "" && h.Description == "" && h.Label == "" {
			continue
		}
		out = append(out, h)
	}
	return out
}

// ApplyDiseaseLabels fills Label from the GET /v2/diseases catalog when
// the identify result did not include a human description. Matching is
// by EPPO code (the catalog's "name").
func ApplyDiseaseLabels(hits []HealthHit, catalog []byte) []HealthHit {
	if len(hits) == 0 || len(catalog) == 0 {
		return hits
	}
	var rows []struct {
		Label string `json:"label"`
		Name  string `json:"name"`
	}
	if err := json.Unmarshal(catalog, &rows); err != nil {
		return hits
	}
	labels := make(map[string]string, len(rows))
	for _, row := range rows {
		if row.Name != "" && row.Label != "" {
			labels[row.Name] = row.Label
		}
	}
	for i := range hits {
		if hits[i].Description == "" && hits[i].Label == "" {
			hits[i].Label = labels[hits[i].Name]
		}
	}
	return hits
}

// VarietyHits reads variety-identify results. Pl@ntNet groups cultivars
// under each species.
func VarietyHits(body []byte) []VarietyHit {
	var doc struct {
		Results []struct {
			Species struct {
				ScientificName              string `json:"scientificName"`
				ScientificNameWithoutAuthor string `json:"scientificNameWithoutAuthor"`
			} `json:"species"`
			Varieties []struct {
				Name  string  `json:"name"`
				Score float64 `json:"score"`
			} `json:"varieties"`
		} `json:"results"`
	}
	if err := json.Unmarshal(body, &doc); err != nil {
		return nil
	}
	var out []VarietyHit
	for _, r := range doc.Results {
		species := r.Species.ScientificNameWithoutAuthor
		if species == "" {
			species = r.Species.ScientificName
		}
		for _, v := range r.Varieties {
			if strings.TrimSpace(v.Name) == "" {
				continue
			}
			out = append(out, VarietyHit{Name: v.Name, Species: species, Score: v.Score})
		}
	}
	return out
}

// CatalogHasSpecies reports whether a varieties-catalog payload mentions
// this binomial. Variety identification is only useful for that short
// crop list, so a miss skips the credit.
func CatalogHasSpecies(catalog []byte, binomial string) bool {
	want := Binomial(binomial)
	if want == "" || len(catalog) == 0 {
		return false
	}
	var rows []struct {
		Species json.RawMessage `json:"species"`
		Name    string          `json:"name"`
	}
	if err := json.Unmarshal(catalog, &rows); err != nil {
		return false
	}
	for _, row := range rows {
		if speciesMatches(row.Species, want) {
			return true
		}
	}
	return false
}

func speciesMatches(raw json.RawMessage, want string) bool {
	if len(raw) == 0 {
		return false
	}
	var name string
	if err := json.Unmarshal(raw, &name); err == nil {
		return Binomial(name) == want
	}
	var obj struct {
		ScientificName              string `json:"scientificName"`
		ScientificNameWithoutAuthor string `json:"scientificNameWithoutAuthor"`
	}
	if err := json.Unmarshal(raw, &obj); err != nil {
		return false
	}
	return Binomial(obj.ScientificNameWithoutAuthor) == want || Binomial(obj.ScientificName) == want
}

// Merge attaches enrichment fields onto a species-identify payload.
// bestMatch, results, and the rest of Pl@ntNet's object stay in place
// so existing clients keep working.
func Merge(speciesBody []byte, extra Enrichment) ([]byte, error) {
	var doc map[string]any
	if err := json.Unmarshal(speciesBody, &doc); err != nil {
		return nil, err
	}
	if extra.Flora != "" {
		doc["flora"] = extra.Flora
	}
	if extra.Species != nil {
		doc["species"] = extra.Species
	}
	if extra.Origin != nil {
		doc["origin"] = extra.Origin
	}
	if len(extra.Care) > 0 {
		doc["care"] = extra.Care
	}
	doc["health"] = extra.Health
	doc["varieties"] = extra.Varieties
	doc["quota"] = extra.Quota
	return json.Marshal(doc)
}

// MarkCached rewrites a stored scan so a replay reports that it spent
// nothing. The original remaining count is left as last reported.
func MarkCached(body []byte) []byte {
	var doc map[string]any
	if err := json.Unmarshal(body, &doc); err != nil {
		return body
	}
	q, _ := doc["quota"].(map[string]any)
	if q == nil {
		q = map[string]any{}
	}
	q["cached"] = true
	q["creditsUsed"] = 0
	doc["quota"] = q
	out, err := json.Marshal(doc)
	if err != nil {
		return body
	}
	return out
}

// NativeCountrySummary formats a GBIF native-country list.
// CleanCountryCodes keeps unique uppercase ISO codes, sorted.
func CleanCountryCodes(codes []string) []string {
	return uniqueCodes(codes)
}

func NativeCountrySummary(codes []string) string {
	codes = uniqueCodes(codes)
	if len(codes) == 0 {
		return ""
	}
	if len(codes) > 8 {
		return "GBIF native records in " + strconv.Itoa(len(codes)) + " countries, including " + strings.Join(codes[:8], ", ")
	}
	return "GBIF native records: " + strings.Join(codes, ", ")
}

func uniqueCodes(codes []string) []string {
	seen := map[string]struct{}{}
	var out []string
	for _, c := range codes {
		c = strings.ToUpper(strings.TrimSpace(c))
		if len(c) != 2 {
			continue
		}
		if _, ok := seen[c]; ok {
			continue
		}
		seen[c] = struct{}{}
		out = append(out, c)
	}
	sort.Strings(out)
	return out
}

// flexID accepts the string or number ids Pl@ntNet uses for GBIF and POWO.
type flexID string

func (f *flexID) UnmarshalJSON(b []byte) error {
	b = bytesTrim(b)
	if len(b) == 0 || string(b) == "null" {
		return nil
	}
	if b[0] == '"' {
		var s string
		if err := json.Unmarshal(b, &s); err != nil {
			return err
		}
		*f = flexID(s)
		return nil
	}
	*f = flexID(b)
	return nil
}

func bytesTrim(b []byte) []byte {
	return []byte(strings.TrimSpace(string(b)))
}
