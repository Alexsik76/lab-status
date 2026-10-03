# lab-status

Status page of the home lab. Vue 3 + Vite + TypeScript single-page app, served by
nginx, which also proxies one NetBox endpoint (GraphQL) and injects the API token
server-side so it never reaches the browser.

The page shows the lab as a tree, machine -> guest -> stack -> container, from two
independent sources: the inventory from NetBox and the live service statuses from an
n8n webhook. The tree appears as soon as the inventory arrives; statuses fill in when
they arrive. There is no polling: data loads on open and on **Refresh**.

## Layout

| Path | Purpose |
|---|---|
| `src/api/` | NetBox and status-service calls, response validation, typed errors |
| `src/domain/` | pure logic: normalizing NetBox data, building the tree, state rules |
| `src/composables/` | async state (`useInventory`, `useStatuses`) combined in `useLab` |
| `src/components/` | render-only components: machine -> guest -> stack -> container, error page, skeleton |
| `src/__fixtures__/` | responses captured from the real endpoints, used by the tests |
| `index.html`, `vite.config.ts`, `tsconfig.json` | Vite / TypeScript setup; the dev server proxy lives in `vite.config.ts` |
| `nginx/default.conf.template` | nginx config template; env variables are substituted at container start |
| `Dockerfile` | stage 1: Node builds the app; stage 2: `nginx:alpine` serves `dist/` |
| `docker-compose.yml` | one service `lab-status`, port `8081:80` |
| `Home Lab Status Dashboard/` | design files for a later stage; not part of the build or image |

## Configuration

| Variable | Meaning |
|---|---|
| `NETBOX_URL` | NetBox base URL, e.g. `http://10.10.70.95:8000` (no trailing slash) |
| `NETBOX_TOKEN` | API token of a read-only NetBox user |
| `VITE_STATUS_URL` | optional, build-time: n8n status endpoint; defaults to `https://n8n.lab.vn.ua/webhook/service-status`. Not a secret: it is bundled and called by the browser directly (CORS is enabled on n8n) |

`VITE_STATUS_URL` is also read from `.env.local` by the dev server, and from the
Portainer stack environment as a Docker build argument.

The browser calls `POST /netbox/graphql/`; nginx (or the Vite dev server) forwards it
to `${NETBOX_URL}/graphql/` with `Authorization: Bearer ${NETBOX_TOKEN}`. In nginx only
POST is allowed and nothing else from NetBox is proxied. The variables deliberately
have no `VITE_` prefix: they are read only by `vite.config.ts` and nginx, never bundled.

## Local development

```sh
cp .env.example .env.local   # git-ignored; fill in NETBOX_URL and NETBOX_TOKEN
npm install
npm run dev
```

`npm run build` type-checks (`vue-tsc`) and builds into `dist/`. `npm test` runs the unit tests (Vitest).

## Deployment

Deployed as a Portainer stack built from this Git repository (the image is built
from the `Dockerfile`; no relative path volumes are needed). Set `NETBOX_URL` and
`NETBOX_TOKEN` in the stack's environment variables.

- Host: VM `treehouse` (`10.10.70.97`), container port published on `8081`
- Address: `https://status.lab.vn.ua` (proxy host in Nginx Proxy Manager)

Locally: `NETBOX_URL=... NETBOX_TOKEN=... docker compose up --build`

## Updating

1. `git push`
2. In Portainer, open the stack and use **Pull and redeploy** with
   **Re-build image** enabled
