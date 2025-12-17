
// Placeholder Seed.ts for consistency with the monorepo tooling.
// If you need a JS/TS-based seeding step, call the Go API or run
// `go run ./cmd/server` with DATABASE_URL set to populate sample data.
export async function seed() {
  console.log("Go backend seeds are handled in Go (see seed/seed.go)");
}

if (require.main === module) {
  seed();
}
