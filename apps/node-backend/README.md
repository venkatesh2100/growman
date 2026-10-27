# node-backend

Express copy of `apps/go-backend`. It serves the same `/api/v1` routes, reads the same environment variables (`GO_PORT`, `DATABASE_URL`, `JWT_SECRET`, and the rest of `example.env`), and uses the same Postgres tables.

The code uses everyday names (`settings`, `database`, `order`) and a comment before each step, so you can follow the same shop rules without reading the Go files. Start at `cmd/server/main.js` (how the process boots) and `internal/server/router.js` (which URL calls which function).

`apps/go-backend` is unchanged. Run one of the two, not both, on port 8080.

```bash
cd apps/node-backend
cp example.env .env
npm install
npm start
```

From the repo root, `pnpm install` also installs this workspace. Start it with:

```bash
pnpm --filter node-backend start
```

Schema updates run on boot when `AUTO_MIGRATE=true` (the default), matching the Go server. `npm run migrate` runs that step and exits.
