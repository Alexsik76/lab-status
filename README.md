# lab-status

Status page of the home lab. Vue 3 + Vite + TypeScript single-page app, served by
nginx, which also proxies NetBox GraphQL, Proxmox API, and status endpoints, injecting
credentials server-side so they never reach the browser.

The page shows the lab as a tree, machine -> guest -> stack -> container, from four
independent sources:
1. **NetBox inventory**: machines, guests, containers, and services (`POST /netbox/graphql/`);
2. **HTTP service checks**: live endpoint statuses forwarded to `SERVICE_STATUS_URL` (`GET /api/service-status`);
3. **Docker container states**: live Docker container states forwarded to `CONTAINER_STATUS_URL` (`GET /api/container-status`);
4. **Proxmox**: live guest states, node status, and CPU/memory load graphs (`GET /proxmox/api2/json/...`).

The tree appears immediately: the last successfully loaded inventory is cached in the
browser's local storage (with schema versioning), so the page renders instantly on open
and survives NetBox being unreachable. Proxmox refreshes in the background every 30 s
to keep machine metrics and guest states up to date; all sources refresh on manual **Refresh**.
Refreshing never blanks what is on screen: previous data remains visible until new values arrive.

## Layout

| Path | Purpose |
|---|---|
| `src/api/` | NetBox, status-service, and Proxmox API calls, validation, typed errors |
| `src/domain/` | pure logic: normalizing NetBox data, building the tree, state rules |
| `src/composables/` | async state (`useInventory`, `useStatuses`, `useContainerStatuses`, `useProxmox`) combined in `useLab` |
| `src/components/` | render-only components: machine -> guest -> stack -> container, error page, skeleton |
| `src/__fixtures__/` | synthetic responses covering all topology cases, used by the tests |
| `index.html`, `vite.config.ts`, `tsconfig.json` | Vite / TypeScript setup; dev server proxies live in `vite.config.ts` |
| `nginx/default.conf.template` | nginx config template; env variables are substituted at container start |
| `Dockerfile` | stage 1: Node builds the app; stage 2: `nginx:alpine` serves `dist/` |
| `docker-compose.yml` | one service `lab-status`, port `8081:80` |

## Configuration

| Variable | Meaning |
|---|---|
| `NETBOX_URL` | NetBox base URL, e.g. `http://192.0.2.10:8000` (no trailing slash) |
| `NETBOX_TOKEN` | API token of a read-only NetBox user |
| `PROXMOX_URL` | Proxmox VE base URL, e.g. `https://192.0.2.11:8006` (self-signed cert supported) |
| `PROXMOX_TOKEN` | Proxmox API token, e.g. `user@realm!token=uuid` |
| `SERVICE_STATUS_URL` | HTTP endpoint returning live service checks (GET-only upstream) |
| `CONTAINER_STATUS_URL` | HTTP endpoint returning live Docker container states (GET-only upstream) |

The browser calls its own origin:
- `POST /netbox/graphql/` -> `${NETBOX_URL}/graphql/` (with `Authorization: Bearer ${NETBOX_TOKEN}`)
- `GET /proxmox/api2/json/...` -> `${PROXMOX_URL}/...` (with `Authorization: PVEAPIToken=${PROXMOX_TOKEN}`)
- `GET /api/service-status` -> `${SERVICE_STATUS_URL}`
- `GET /api/container-status` -> `${CONTAINER_STATUS_URL}`

In nginx and the Vite dev server, requests are strictly limited to the required endpoints and methods (GET only for Proxmox and status endpoints; POST only for NetBox GraphQL).
The environment variables have no `VITE_` prefix: they are read only by `vite.config.ts` and nginx, never bundled into client assets.

## Local development

```sh
cp .env.example .env.local   # git-ignored; fill in all variables
npm install
npm run dev
```

`npm run build` type-checks (`vue-tsc`) and builds into `dist/`.
`npm test` runs the test suite (Vitest).

## Deployment

Deployed as a container built from this Git repository (the image is built from the `Dockerfile`). Set all six variables in the container or stack environment: `NETBOX_URL`, `NETBOX_TOKEN`, `PROXMOX_URL`, `PROXMOX_TOKEN`, `SERVICE_STATUS_URL`, and `CONTAINER_STATUS_URL`.

> **Warning:** nginx will not start if any of the variables (`NETBOX_URL`, `NETBOX_TOKEN`, `PROXMOX_URL`, `PROXMOX_TOKEN`, `SERVICE_STATUS_URL`, `CONTAINER_STATUS_URL`) is missing, because template variable substitution (`envsubst`) requires all of them to produce a valid configuration.

Example:
- Host: VM host (`192.0.2.30`), container port published on `8081`
- Address: `https://status.example.com` (reverse proxy host)

Locally via Docker Compose:
```sh
docker compose up --build
```
