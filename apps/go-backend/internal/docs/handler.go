// Package docs serves the live API reference (Swagger UI, ReDoc, and the
// raw OpenAPI spec) embedded into the server binary. This is distinct from
// the narrative *.md files that live alongside it in this same directory —
// see 11-api-reference-docs.md for how the two relate.
package docs

import (
	"embed"
	"net/http"

	"github.com/go-chi/chi/v5"
)

//go:embed openapi.yaml index.html redoc.html
var files embed.FS

// Mount registers API documentation endpoints.
//
//	GET /docs             Swagger UI
//	GET /redoc            ReDoc
//	GET /openapi.yaml     OpenAPI 3 spec
//	GET /swagger          redirect to /docs
func Mount(r chi.Router) {
	r.Get("/openapi.yaml", ServeSpec)
	r.Get("/docs/openapi.yaml", ServeSpec)
	r.Get("/docs", ServeUI)
	r.Get("/docs/", ServeUI)
	r.Get("/redoc", ServeRedoc)
	r.Get("/redoc/", ServeRedoc)
	r.Get("/swagger", RedirectDocs)
	r.Get("/swagger/", RedirectDocs)
	r.Get("/swagger-ui", RedirectDocs)
	r.Get("/swagger-ui/", RedirectDocs)
}

// ServeSpec writes the OpenAPI YAML specification.
func ServeSpec(w http.ResponseWriter, r *http.Request) {
	data, err := files.ReadFile("openapi.yaml")
	if err != nil {
		http.Error(w, "openapi spec not found", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/yaml; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

// ServeUI serves the Swagger UI page.
func ServeUI(w http.ResponseWriter, r *http.Request) {
	serveHTML(w, "index.html")
}

// ServeRedoc serves the ReDoc page.
func ServeRedoc(w http.ResponseWriter, r *http.Request) {
	serveHTML(w, "redoc.html")
}

// RedirectDocs redirects /swagger to /docs.
func RedirectDocs(w http.ResponseWriter, r *http.Request) {
	http.Redirect(w, r, "/docs", http.StatusFound)
}

func serveHTML(w http.ResponseWriter, name string) {
	data, err := files.ReadFile(name)
	if err != nil {
		http.Error(w, "docs page not found", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}
