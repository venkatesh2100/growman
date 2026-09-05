# API Reference Docs (Swagger / ReDoc)

This is the one doc in this set that documents *itself*: the
`internal/docs` package (`handler.go`) that lives alongside these markdown
files is a small, separate thing from them — it serves the **live,
machine-readable OpenAPI spec** to API consumers (frontend devs, Postman,
codegen tools), whereas the `.md` files here are **narrative developer
notes** for people reading this repository. Both happen to live in
`internal/docs/` for convenience; they don't interact.

## What it serves

```go
//go:embed openapi.yaml index.html redoc.html
var files embed.FS
```

`docs.Mount(r)` (called from `internal/server/router.go`) registers, at the
router's **top level** (not under `/api/v1`, and with no auth):

| Route | Serves |
|---|---|
| `GET /openapi.yaml`, `/docs/openapi.yaml` | The raw OpenAPI 3 YAML spec (`ServeSpec`) |
| `GET /docs`, `/docs/` | Swagger UI, reading the spec from `/docs/openapi.yaml` (`ServeUI` → `index.html`) |
| `GET /redoc`, `/redoc/` | ReDoc UI (`ServeRedoc` → `redoc.html`) |
| `GET /swagger`, `/swagger/`, `/swagger-ui`, `/swagger-ui/` | `302` redirect to `/docs` (`RedirectDocs`) — legacy/convenience aliases |

Because the three files are `//go:embed`-ed by explicit name (not a glob),
they're compiled directly into the server binary — the docs UI works
identically in every environment without shipping extra static files
alongside the binary, and adding other files to this directory (like these
`.md` files) has no effect on the embed or the build.

`openapi.yaml` (~55KB) is the source of truth for the HTTP contract
(request/response schemas, status codes) as seen from *outside* the
service. It's maintained by hand alongside the handlers — there's no
code-generation step tying it to `internal/handlers/*.go`, so when adding or
changing an endpoint, both the handler and `openapi.yaml` need to be updated
together for the docs to stay accurate.

## Why two documentation systems

- **`openapi.yaml` + Swagger/ReDoc** — the *contract*: exact request/response
  shapes, for anyone integrating against this API (frontend, mobile, QA,
  external partners).
- **This `.md` set** (`README.md` through `10-database-and-migrations.md`) —
  the *implementation*: why things are built the way they are, what's
  cached, what depends on Redis being up, how caching/auth/payment flows
  actually work end-to-end. Useful for anyone modifying the backend itself,
  not just calling it.

`internal/docs/handler_test.go` covers `Mount`/`ServeSpec`/`ServeUI`/
`ServeRedoc`/`RedirectDocs` at a basic "does it return 200 with the right
content type" level.
