# node-backend

Production shop API for Growman. The browser and the Expo app talk to this process. Plant answers are delegated to the Python service in `apps/ai`.

`apps/go-backend` is the reference implementation. It is not part of the production deploy, and this change does not modify it. Run one API on port 8080, not both.

The route files, middleware order, and background jobs follow the Go server. Persistence goes through Prisma against the same Postgres tables.

```bash
cd apps/node-backend
cp example.env .env
pnpm install
pnpm start
```

From the repo root: `pnpm --filter node-backend start`.

Read [docs/README.md](./docs/README.md) for architecture, system design, each component, and interview answers. [GUIDE.md](./GUIDE.md) is the short operator view.
