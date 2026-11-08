# lab-status

Status page of the home lab. Vue 3 + Vite + TypeScript single-page app, served by
nginx, plus a small FastAPI backend (`backend/`). nginx proxies NetBox GraphQL, the
Proxmox API, and the backend, injecting credentials server-side so they never reach
the browser.

The page shows the lab as a tree, machine -> guest -> stack -> container, from these
independent sources:
1. **NetBox inventory**: machines, guests, containers, and services (`POST /netbox/graphql/`);
2. **HTTP service checks**: run by the backend against the NetBox services (`GET /api/service-status`);
3. **Docker container states**: forwarded to `CONTAINER_STATUS_URL` (`GET /api/container-status`);
4. **Proxmox**: live guest states, node status, and CPU/memory load graphs (`GET /proxmox/api2/json/...`);
5. **Router ARP table**: a live mirror streamed by the backend (`GET /api/arp/stream`, Server-Sent Events).

A second page, `#/arp`, lists the router's ARP table live, each entry matched to the
NetBox object owning its MAC, with three views: unknown (no NetBox match), active, and
disconnected (`failed` / `incomplete`).

The tree appears immediately: the last successfully loaded inventory is cached in the
browser's local storage (with schema versioning), so the page renders instantly on open
and survives NetBox being unreachable. Proxmox refreshes in the background every 30 s;
all sources refresh on manual **Refresh**. Refreshing never blanks what is on screen.

## ARP mirror

The backend talks to the RouterOS API (port 8728) only while at least one page holds
the stream open: the first subscriber opens a session (`/ip/arp/print` for the initial
state, `/ip/arp/listen` for every later change, on one connection); when the last page
closes, the session is closed. There is no polling.

- Presence: `reachable`, `stale`, `delay`, `probe`, `permanent` -> active;
  `failed`, `incomplete` -> disconnected.
- Matching to NetBox is by MAC only (`dcim/mac-addresses`, refreshed every 5 min).
- On the main page, machines and guests whose MAC is in the ARP table take their state
  from it (active -> up, disconnected -> down, or stopped when NetBox/Proxmox say so);
  everything else keeps its previous sources. Containers are not affected (they share
  their host's MAC).

## Layout

| Path | Purpose |
|---|---|
| `src/api/` | NetBox, status-service, and Proxmox API calls, validation, typed errors |
| `src/domain/` | pure logic: normalizing NetBox data, building the tree, state rules, ARP presence |
| `src/composables/` | async state (`useInventory`, `useStatuses`, `useContainerStatuses`, `useProxmox`, `useArp`) combined in `useLab` |
| `src/components/` | render-only components: the tree, the ARP page, error page, skeleton |
| `src/__fixtures__/` | synthetic responses covering all topology cases, used by the tests |
| `backend/app/` | FastAPI: RouterOS API client, ARP hub, NetBox reads, service checks |
| `backend/tests/` | pytest suite |
| `nginx/default.conf.template` | nginx config template; env variables are substituted at container start |
| `Dockerfile` | stage 1: Node builds the app; stage 2: `nginx:alpine` serves `dist/` |
| `backend/Dockerfile` | Python 3.13 + uv, `uvicorn` on port 8000 |
| `docker-compose.yml` | services `web` (`lab-status`, port `8081:80`) and `api` (`lab-status-api`, internal) |

## Configuration

| Variable | Used by | Meaning |
|---|---|---|
| `NETBOX_URL` | web, api | NetBox base URL, e.g. `http://192.0.2.10:8000` (no trailing slash) |
| `NETBOX_TOKEN` | web, api | API token of a read-only NetBox user; the backend needs view rights on devices, virtual machines, services, and MAC addresses |
| `PROXMOX_URL` | web | Proxmox VE base URL, e.g. `https://192.0.2.11:8006` (self-signed cert supported) |
| `PROXMOX_TOKEN` | web | Proxmox API token, e.g. `user@realm!token=uuid` |
| `CONTAINER_STATUS_URL` | web | HTTP endpoint returning live Docker container states (GET-only upstream) |
| `ROUTEROS_HOST` | api | Router address for the API service |
| `ROUTEROS_PORT` | api | API port, default `8728` |
| `ROUTEROS_USER` / `ROUTEROS_PASSWORD` | api | RouterOS user in a group with `read,api` policies |
| `NETBOX_PUBLIC_URL` | api | optional: NetBox UI base URL, for links on the ARP page |
| `SERVICE_CHECK_EXCLUDE` | api | optional: comma-separated check names (`parent/service`) never checked |
| `BACKEND_URL` | dev server | optional: where the backend runs, default `http://127.0.0.1:8000` |

The browser calls its own origin only:
- `POST /netbox/graphql/` -> `${NETBOX_URL}/graphql/` (with `Authorization: Bearer ${NETBOX_TOKEN}`)
- `GET /proxmox/api2/json/...` -> `${PROXMOX_URL}/...` (with `Authorization: PVEAPIToken=${PROXMOX_TOKEN}`)
- `GET /api/service-status`, `GET /api/arp/stream` -> the backend (`http://api:8000`)
- `GET /api/container-status` -> `${CONTAINER_STATUS_URL}`

In nginx and the Vite dev server, requests are strictly limited to the required endpoints and methods.
The environment variables have no `VITE_` prefix: they are never bundled into client assets.

## Local development

```sh
cp .env.example .env.local   # git-ignored; fill in all variables
npm install
(cd backend && uv sync && uv run --env-file ../.env.local uvicorn app.main:app --port 8000) &
npm run dev
```

`npm run build` type-checks (`vue-tsc`) and builds into `dist/`.
`npm test` runs the frontend tests (Vitest); `cd backend && uv run pytest` runs the backend tests.

## Deployment

Deployed as a Docker Compose stack built from this Git repository. Set the variables
above in the stack environment.

> **Warning:** nginx will not start if any of `NETBOX_URL`, `NETBOX_TOKEN`, `PROXMOX_URL`,
> `PROXMOX_TOKEN`, `CONTAINER_STATUS_URL` is missing, because template substitution
> (`envsubst`) requires all of them.

The router must accept API connections from the stack's host: the API service's
`available-from`, the user's `address`, and the router firewall.

Locally:
```sh
docker compose --env-file .env.local up --build
```
