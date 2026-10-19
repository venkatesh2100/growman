package handlers

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/venkatesh2100/growman/apps/go-backend/internal/plantnet"
	"github.com/venkatesh2100/growman/apps/go-backend/pkg/httpjson"
	"golang.org/x/sync/errgroup"
)

// IdentifyPlant identifies one plant from 1–5 photos.
//
// The free Pl@ntNet plan allows 500 identifications per UTC day, shared by
// species, disease, and variety calls. A scan always spends one credit on
// species. Disease and variety credits are spent only for the requested
// focus, and only while the day's remaining balance is above
// PLANTNET_RESERVE. The same photo is cached until the quota resets, so a
// retry does not spend another credit.
//
// Origin comes from GBIF via the id Pl@ntNet already returned. Care text
// comes from the configured chat model and is cached per species. Neither
// of those spends an identify credit. Pl@ntNet does not return care or origin.
//
// focus=species | health | variety | full | care (default).
// Optional form fields: organs, lang, project, lat, lon, nb-results,
// detailed, related-images, no-reject.
func (h *Handler) IdentifyPlant(w http.ResponseWriter, r *http.Request) {
	if h.Cfg.PlantNetAPIKey == "" {
		httpjson.Error(w, http.StatusServiceUnavailable, "plant identification not configured")
		return
	}
	if err := r.ParseMultipartForm(10 << 20); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) || strings.Contains(err.Error(), "too large") {
			httpjson.Error(w, http.StatusRequestEntityTooLarge, "images must be 10MB or smaller in total")
			return
		}
		httpjson.Error(w, http.StatusBadRequest, "failed to parse multipart form")
		return
	}

	photos, organs, err := readPlantPhotos(r)
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	lang := plantLang(r.FormValue("lang"))
	nb := plantNBResults(r.FormValue("nb-results"))
	focus := plantnet.NormalizeFocus(r.FormValue("focus"))
	detailed := formFlag(r, "detailed")
	related := formFlag(r, "related-images")
	noReject := formFlag(r, "no-reject")

	h.storePlantPhotos(photos)

	now := time.Now()
	if n, ok := h.identifyRemaining(r.Context(), now); ok && n <= 0 {
		httpjson.Error(w, http.StatusTooManyRequests, "Plant identification quota is used up for today. It resets at 00:00 UTC.")
		return
	}

	project := h.resolveFlora(r, lang)
	cacheKey := scanCacheKey(project, lang, focus, nb, detailed, related, noReject, photos, organs)
	if raw, ok := h.plantLoad(r.Context(), cacheKey, now); ok {
		httpjson.Raw(w, http.StatusOK, plantnet.MarkCached(raw))
		return
	}

	v, err, _ := plantMem.flight.Do(cacheKey, func() (any, error) {
		if raw, ok := h.plantLoad(r.Context(), cacheKey, time.Now()); ok {
			return plantnet.MarkCached(raw), nil
		}
		body, ttl, err := h.runScan(r.Context(), scanInput{
			photos:   photos,
			organs:   organs,
			project:  project,
			lang:     lang,
			focus:    focus,
			nb:       nb,
			detailed: detailed,
			related:  related,
			noReject: noReject,
		})
		if err != nil {
			return nil, err
		}
		h.plantSet(r.Context(), cacheKey, body, ttl, time.Now())
		return body, nil
	})
	if err != nil {
		writePlantNetError(w, err)
		return
	}
	httpjson.Raw(w, http.StatusOK, v.([]byte))
}

type scanInput struct {
	photos   []plantnet.Photo
	organs   []string
	project  string
	lang     string
	focus    string
	nb       int
	detailed bool
	related  bool
	noReject bool
}

func (h *Handler) runScan(ctx context.Context, in scanInput) ([]byte, time.Duration, error) {
	client := h.plantClient()
	req := plantnet.IdentifyRequest{
		Project:              in.project,
		Organs:               in.organs,
		Lang:                 in.lang,
		NBResults:            in.nb,
		IncludeRelatedImages: in.related,
		NoReject:             in.noReject,
		Detailed:             in.detailed,
	}
	speciesBody, err := client.IdentifySpecies(ctx, req, in.photos)
	if err != nil {
		h.noteAPIFailure(ctx, err)
		return nil, 0, err
	}
	remaining, known := h.observeRemaining(ctx, speciesBody)
	reserve := h.Cfg.PlantNetReserve
	if reserve < 0 {
		reserve = 0
	}
	spend := plantnet.Plan(in.focus, remaining, known, reserve)
	credits := 1

	hit, hasHit := plantnet.TopSpecies(speciesBody)
	var hitPtr *plantnet.SpeciesHit
	if hasHit {
		hitPtr = &hit
	}

	var (
		origin    *plantnet.Origin
		care      map[string]any
		health    plantnet.HealthResult
		varieties plantnet.VarietyResult
	)
	health.Skipped = spend.DiseaseSkip
	varieties.Skipped = spend.VarietySkip

	g, gctx := errgroup.WithContext(ctx)
	if hasHit {
		g.Go(func() error {
			origin = h.lookupOrigin(gctx, hit.GBIFID)
			care = h.careGuide(gctx, hit, in.lang, origin)
			return nil
		})
	}
	if spend.Disease {
		g.Go(func() error {
			body, callErr := client.IdentifyDiseases(gctx, req, in.photos)
			if callErr != nil {
				logPlantErr(callErr)
				h.noteAPIFailure(gctx, callErr)
				health.Skipped = plantnet.SkipFailed
				return nil
			}
			h.observeRemaining(gctx, body)
			hits := plantnet.HealthHits(body)
			hits = plantnet.ApplyDiseaseLabels(hits, h.diseaseCatalog(gctx, in.lang))
			health = plantnet.HealthResult{SideResult: plantnet.SideResult{Ran: true}, Results: hits}
			return nil
		})
	}
	if err := g.Wait(); err != nil {
		return nil, 0, err
	}
	if health.Ran {
		credits++
	}

	if spend.Variety {
		if !hasHit {
			varieties.Skipped = plantnet.SkipNoSpecies
		} else if n, ok := h.identifyRemaining(ctx, time.Now()); ok && n <= reserve {
			varieties.Skipped = plantnet.SkipQuotaReserve
		} else {
			catalog, catErr := h.varietyCatalog(ctx, in.lang)
			if catErr != nil {
				logPlantErr(catErr)
				varieties.Skipped = plantnet.SkipFailed
			} else if !plantnet.CatalogHasSpecies(catalog, hit.ScientificNameWithoutAuthor) && !plantnet.CatalogHasSpecies(catalog, hit.ScientificName) {
				varieties.Skipped = plantnet.SkipNotInCatalog
			} else {
				body, callErr := client.IdentifyVarieties(ctx, req, in.photos)
				if callErr != nil {
					logPlantErr(callErr)
					h.noteAPIFailure(ctx, callErr)
					varieties.Skipped = plantnet.SkipFailed
				} else {
					h.observeRemaining(ctx, body)
					credits++
					varieties = plantnet.VarietyResult{
						SideResult: plantnet.SideResult{Ran: true},
						Results:    plantnet.VarietyHits(body),
					}
				}
			}
		}
	}

	if origin != nil {
		if text, _ := care["origin"].(string); text != "" {
			origin.Summary = text
			if origin.Source == "gbif" {
				origin.Source = "gbif+guidance"
			}
		}
	} else if text, _ := care["origin"].(string); text != "" {
		origin = &plantnet.Origin{Summary: text, Source: "guidance"}
	}

	var remainingPtr *int
	if n, ok := h.identifyRemaining(ctx, time.Now()); ok {
		remainingPtr = &n
	}
	merged, err := plantnet.Merge(speciesBody, plantnet.Enrichment{
		Flora:     in.project,
		Species:   hitPtr,
		Origin:    origin,
		Care:      care,
		Health:    health,
		Varieties: varieties,
		Quota: plantnet.QuotaReport{
			CreditsUsed: credits,
			Reserve:     reserve,
			Remaining:   remainingPtr,
		},
	})
	if err != nil {
		return nil, 0, err
	}
	return merged, plantnet.UntilUTCMidnight(time.Now()), nil
}

func (h *Handler) observeRemaining(ctx context.Context, body []byte) (int, bool) {
	n, ok := plantnet.RemainingIdentifications(body)
	if !ok {
		return 0, false
	}
	h.noteIdentifyRemaining(ctx, n, time.Now())
	return n, true
}

func (h *Handler) noteAPIFailure(ctx context.Context, err error) {
	var apiErr *plantnet.APIError
	if errors.As(err, &apiErr) && apiErr.Status == http.StatusTooManyRequests {
		h.noteIdentifyRemaining(ctx, 0, time.Now())
	}
}

func (h *Handler) resolveFlora(r *http.Request, lang string) string {
	explicit := strings.TrimSpace(r.FormValue("project"))
	fallback := h.Cfg.PlantNetProject
	if !plantnet.ValidProject(fallback) {
		fallback = "all"
	}
	if explicit != "" && explicit != "all" {
		if plantnet.ValidProject(explicit) {
			return explicit
		}
		return fallback
	}
	lat, lon, ok := parseLatLon(r.FormValue("lat"), r.FormValue("lon"))
	if !ok {
		return fallback
	}
	projects, err := h.projectsNear(r.Context(), lat, lon, lang)
	if err != nil {
		logPlantErr(err)
		return fallback
	}
	return plantnet.PickFlora("", projects, fallback)
}

func (h *Handler) projectsNear(ctx context.Context, lat, lon float64, lang string) ([]plantnet.Project, error) {
	key := fmt.Sprintf("plantnet:projects:%.1f:%.1f:%s", lat, lon, lang)
	now := time.Now()
	if raw, ok := h.plantLoad(ctx, key, now); ok {
		var projects []plantnet.Project
		if json.Unmarshal(raw, &projects) == nil {
			return projects, nil
		}
	}
	q := url.Values{}
	q.Set("lat", strconv.FormatFloat(lat, 'f', 4, 64))
	q.Set("lon", strconv.FormatFloat(lon, 'f', 4, 64))
	if lang != "" {
		q.Set("lang", lang)
	}
	raw, err := h.plantClient().Get(ctx, "/v2/projects", q)
	if err != nil {
		return nil, err
	}
	h.plantSet(ctx, key, raw, 24*time.Hour, now)
	var projects []plantnet.Project
	if err := json.Unmarshal(raw, &projects); err != nil {
		return nil, err
	}
	return projects, nil
}

func (h *Handler) varietyCatalog(ctx context.Context, lang string) ([]byte, error) {
	return h.cachedPlantGet(ctx, "/v2/varieties", langValues(lang), 24*time.Hour)
}

func (h *Handler) diseaseCatalog(ctx context.Context, lang string) []byte {
	raw, err := h.cachedPlantGet(ctx, "/v2/diseases", langValues(lang), 24*time.Hour)
	if err != nil {
		logPlantErr(err)
		return nil
	}
	return raw
}

func langValues(lang string) url.Values {
	q := url.Values{}
	if lang != "" {
		q.Set("lang", lang)
	}
	return q
}

func (h *Handler) cachedPlantGet(ctx context.Context, path string, q url.Values, ttl time.Duration) ([]byte, error) {
	if q == nil {
		q = url.Values{}
	}
	vals := url.Values{}
	for k, vs := range q {
		for _, v := range vs {
			if v != "" {
				vals.Add(k, v)
			}
		}
	}
	key := "plantnet:get:" + path + "?" + vals.Encode()
	now := time.Now()
	if raw, ok := h.plantLoad(ctx, key, now); ok {
		return raw, nil
	}
	raw, err := h.plantClient().Get(ctx, path, vals)
	if err != nil {
		return nil, err
	}
	h.plantSet(ctx, key, raw, ttl, now)
	return raw, nil
}

func (h *Handler) storePlantPhotos(photos []plantnet.Photo) {
	if h.ImageService == nil || len(photos) == 0 {
		return
	}
	saved := append([]plantnet.Photo(nil), photos...)
	go func() {
		ctx := context.Background()
		for i, photo := range saved {
			filename := photo.Filename
			if len(saved) > 1 {
				base := strings.TrimSuffix(filename, filepath.Ext(filename))
				filename = fmt.Sprintf("%s-%d%s", base, i+1, filepath.Ext(photo.Filename))
			}
			imageKey := GenerateImageKey("plants", filename)
			err := h.ImageService.UploadImage(ctx, imageKey, bytes.NewReader(photo.Bytes), photo.ContentType)
			if err != nil {
				log.Printf("[plants] silent cloud storage upload failed for %s: %v", photo.Filename, err)
			}
		}
	}()
}

func readPlantPhotos(r *http.Request) ([]plantnet.Photo, []string, error) {
	form := r.MultipartForm
	files := form.File["image"]
	if len(files) == 0 {
		files = form.File["images"]
	}
	if len(files) == 0 {
		return nil, nil, errors.New("at least one image is required")
	}
	if len(files) > 5 {
		return nil, nil, errors.New("maximum 5 images allowed")
	}
	organsIn := r.Form["organs"]
	photos := make([]plantnet.Photo, 0, len(files))
	organs := make([]string, 0, len(files))
	for i, fh := range files {
		f, err := fh.Open()
		if err != nil {
			return nil, nil, errors.New("failed to read image file")
		}
		buf, err := io.ReadAll(io.LimitReader(f, 10<<20))
		f.Close()
		if err != nil {
			return nil, nil, errors.New("failed to read image")
		}
		if len(buf) == 0 {
			return nil, nil, errors.New("image file is empty")
		}
		organ := "auto"
		if i < len(organsIn) && organsIn[i] != "" {
			organ = strings.ToLower(strings.TrimSpace(organsIn[i]))
			if !plantnet.ValidOrgan(organ) {
				return nil, nil, errors.New("organs must be auto, leaf, flower, fruit, or bark")
			}
		}
		name := filepath.Base(fh.Filename)
		if name == "." || name == "/" || name == "" {
			name = "plant.jpg"
		}
		photo, err := normalizePlantPhoto(plantnet.Photo{
			Filename:    name,
			ContentType: fh.Header.Get("Content-Type"),
			Bytes:       buf,
		})
		if err != nil {
			return nil, nil, err
		}
		photos = append(photos, photo)
		organs = append(organs, organ)
	}
	return photos, organs, nil
}

func contentTypeFromExt(ext string) string {
	switch strings.ToLower(ext) {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	default:
		return "image/jpeg"
	}
}

func plantLang(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	if s == "" {
		return "en"
	}
	if plantnet.ValidLang(s) {
		return s
	}
	return "en"
}

func plantNBResults(s string) int {
	n, err := strconv.Atoi(strings.TrimSpace(s))
	if err != nil || n < 1 {
		return 5
	}
	if n > 10 {
		return 10
	}
	return n
}

func formFlag(r *http.Request, name string) bool {
	switch strings.ToLower(strings.TrimSpace(r.FormValue(name))) {
	case "1", "true", "yes":
		return true
	default:
		return false
	}
}

func parseLatLon(latS, lonS string) (float64, float64, bool) {
	if strings.TrimSpace(latS) == "" || strings.TrimSpace(lonS) == "" {
		return 0, 0, false
	}
	lat, err1 := strconv.ParseFloat(latS, 64)
	lon, err2 := strconv.ParseFloat(lonS, 64)
	if err1 != nil || err2 != nil || lat < -90 || lat > 90 || lon < -180 || lon > 180 {
		return 0, 0, false
	}
	return lat, lon, true
}

func scanCacheKey(project, lang, focus string, nb int, detailed, related, noReject bool, photos []plantnet.Photo, organs []string) string {
	sum := sha256.New()
	for i, photo := range photos {
		sum.Write(photo.Bytes)
		sum.Write([]byte{0})
		if i < len(organs) {
			sum.Write([]byte(organs[i]))
		}
	}
	return fmt.Sprintf("plantnet:scan:%s:%s:%s:%d:%t:%t:%t:%s",
		project, lang, focus, nb, detailed, related, noReject, hex.EncodeToString(sum.Sum(nil)))
}

func writePlantNetError(w http.ResponseWriter, err error) {
	var apiErr *plantnet.APIError
	if errors.As(err, &apiErr) {
		switch apiErr.Status {
		case http.StatusNotFound:
			httpjson.Error(w, http.StatusNotFound, "No plant recognized in that photo.")
		case http.StatusBadRequest:
			httpjson.Error(w, http.StatusBadRequest, "That photo could not be used for identification. Use a JPEG or PNG of one plant.")
		case http.StatusTooManyRequests:
			httpjson.Error(w, http.StatusTooManyRequests, "Plant identification quota is used up for today. It resets at 00:00 UTC.")
		default:
			logPlantErr(err)
			httpjson.Error(w, http.StatusBadGateway, plantNetFailureMessage(apiErr.Status))
		}
		return
	}
	logPlantErr(err)
	httpjson.Error(w, http.StatusBadGateway, "Plant identification is unavailable. Try the photo again.")
}

func plantNetFailureMessage(status int) string {
	switch status {
	case http.StatusUnauthorized, http.StatusForbidden:
		return "Plant identification is not configured. Check the Pl@ntNet API key."
	case http.StatusRequestEntityTooLarge:
		return "That photo is too large. Crop it closer and try again."
	case http.StatusUnsupportedMediaType:
		return "That photo could not be used. Use a JPEG or PNG of one plant."
	default:
		if status >= 500 {
			return "Plant identification is busy right now. Try the photo again."
		}
		return "Plant identification failed."
	}
}

func logPlantErr(err error) {
	if err == nil {
		return
	}
	msg := err.Error()
	if i := strings.Index(msg, "api-key="); i >= 0 {
		msg = msg[:i] + "api-key=redacted"
	}
	log.Printf("[plants] %s", msg)
}
