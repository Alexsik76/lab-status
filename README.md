# lab-status

Status page of the home lab. Vue 3 + Vite + TypeScript single-page app, served by
nginx, plus a small FastAPI backend (`backend/`). The backend alone talks to NetBox, Nginx
Proxy Manager, Proxmox and the router, so no credential reaches the browser; nginx serves
the page and proxies the backend.

The page shows the lab as a tree, machine -> guest -> stack -> container, from these
independent sources:
1. **NetBox inventory**: machines, guests, containers, and services, read by the backend and sent
   as `inventory` events of `GET /api/stream`;
2. **HTTP service checks**: run by the backend against the NetBox services that have the
   custom field `check` set and an `http`/`https` `scheme` (one per parent: the service that
   represents the application's health; `GET /api/service-status`). Only `http`/`https`
   services are ever links; `rtsp`/`webrtc` services are not clickable (their port may still
   be shown). The service flagged `check` is the one shown on the node's tile. When an
   enabled Nginx Proxy Manager proxy host forwards to the checked `ip:port`, the entry also
   carries its `public_url` (`https://<first domain>` with a certificate, else `http://`):
   the tile then links to the domain and shows the direct address as a secondary link
   (proxy hosts are read on the inventory cycle; an NPM failure keeps the last known links and
   never fails the checks);
3. **Docker container states**: forwarded to `CONTAINER_STATUS_URL` (`GET /api/container-status`);
4. **Proxmox**: live guest states, node status, and CPU/memory load graphs, polled by the backend
   and sent as `proxmox` / `metrics` events of `GET /api/stream`;
5. **Router ARP table**: a live mirror streamed by the backend as `arp` events of `GET /api/stream`.

A second page, `#/arp`, lists the router's ARP table live, each entry matched to the
NetBox object owning its MAC, with three views: unknown (no NetBox match), active, and
disconnected (`failed` / `incomplete`).

The tree appears immediately: the last successfully loaded inventory is cached in the
browser's local storage (with schema versioning), so the page renders instantly on open
and survives NetBox being unreachable. Manual **Refresh** asks the backend to re-read NetBox,
NPM and Proxmox at once (`POST /api/refresh`, answered 202; the results arrive over the
stream) and re-polls statuses and container states. Refreshing never blanks what is on screen.

## Event stream

The page holds one Server-Sent Events connection, `GET /api/stream`; the SSE `event:`
field names the source of each message (`arp`, `inventory`, `proxmox`, `metrics`). The backend runs its sources
only while at least one page is connected: the first subscriber starts them, and when the
last one leaves they keep running for `STREAM_GRACE_S` seconds (default 10) and stop only
if nobody reconnected, so a page reload reuses the running sessions. A new subscriber, and
a client that fell too far behind, first receives each source's current state.
`GET /api/health` reports the subscriber count and each source's state.

Polling sources (`inventory`, `proxmox`, `metrics`) publish two kinds of events: `{"type": "data", "data": ...}`
only when the data changed, and `{"type": "status", "state", "error", "updatedAt", "periodS"}`
whenever the state, the error or the time of the last successful fetch (`updatedAt`, ISO 8601
UTC) changes. A failed poll keeps the last data and reports the error; polling goes on.
`state` describes the published data: `error` means the last poll produced none, while
`live` with a non-null `error` means it succeeded only in part.

| Source | Upstream | Period | `data` |
|---|---|---|---|
| `inventory` | NetBox: the page's GraphQL query and REST services, virtual machines, devices, MAC addresses; NPM proxy hosts; all concurrently, each data set once | 300 s (`INVENTORY_PERIOD_S`) | the GraphQL `data` object unchanged |
| `proxmox` | `cluster/resources` | 15 s (`PROXMOX_PERIOD_S`) | the Proxmox `data` array unchanged |
| `metrics` | `nodes/<node>/rrddata?timeframe=hour&cf=AVERAGE` for every node of the latest cluster resources, concurrently | 60 s (`PROXMOX_METRICS_PERIOD_S`), and at once when the node set changes | `{node: points}`; a node that fails gets `[]` |

The `inventory` cycle is the backend's only NetBox (and NPM) read: the service checks take
their targets and public URLs from it, and the ARP mirror its MAC directory (a changed
directory re-sends the ARP snapshot). A part that fails keeps its previous value; if only the
page's inventory failed the status is `error`, otherwise `live` with the failure in `error`.
`GET /api/service-status` works without a subscriber: it runs a cycle first when none ran
within the period. `POST /api/refresh` runs every polling source at once.

A tab hidden for longer than 10 s closes the stream and reopens it when shown again; the
data on screen stays until fresh events replace it.
If the server answers the stream request with an HTTP error (e.g. 502 while the backend
restarts), the browser gives up on it; the page then reopens it itself after 2 s, doubling
the delay up to 30 s. In the backend, a source that crashes is restarted after 2 s while
pages are connected.

## ARP mirror

The `arp` source talks to the RouterOS API (port 8728) only while the stream is active:
it opens one session (`/ip/arp/print` for the initial state, `/ip/arp/listen` for every
later change, on one connection) and closes it when the hub stops it. There is no polling.
Its events are `status`, `snapshot`, `upsert` and `remove`.

- Presence: `reachable`, `stale`, `delay`, `probe`, `permanent` -> active;
  `failed`, `incomplete` -> disconnected.
- Matching to NetBox is by MAC only (`dcim/mac-addresses`, read on the inventory cycle).
- On the main page, machines and guests whose MAC is in the ARP table take their state
  from it (active -> up, disconnected -> down, or stopped when NetBox/Proxmox say so);
  everything else keeps its previous sources. Containers are not affected (they share
  their host's MAC).

## Layout

| Path | Purpose |
|---|---|
| `src/api/` | status-service and container status API calls, inventory validation, refresh request, typed errors |
| `src/domain/` | pure logic: normalizing NetBox data, building the tree, state rules, ARP presence |
| `src/composables/` | async state (`useInventory`, `useStatuses`, `useContainerStatuses`, `useProxmox`, `useArp`) combined in `useLab` |
| `src/components/` | render-only components: the tree, the ARP page, error page, skeleton |
| `src/__fixtures__/` | synthetic responses covering all topology cases, used by the tests |
| `backend/app/` | FastAPI: stream hub and polling base, ARP mirror, inventory cycle (NetBox, NPM), Proxmox, service checks |
| `backend/tests/` | pytest suite |
| `nginx/default.conf.template` | nginx config template; env variables are substituted at container start |
| `Dockerfile` | stage 1: Node builds the app; stage 2: `nginx:alpine` serves `dist/` |
| `backend/Dockerfile` | Python 3.13 + uv, `uvicorn` on port 8000 |
| `docker-compose.yml` | services `web` (`lab-status`, port `8081:80`) and `api` (`lab-status-api`, internal) |

## Configuration

| Variable | Used by | Meaning |
|---|---|---|
| `NETBOX_URL` | api | NetBox base URL, e.g. `http://192.0.2.10:8000` (no trailing slash) |
| `NETBOX_TOKEN` | api | API token of a read-only NetBox user (GraphQL and REST); it needs view rights on devices, virtual machines, services, IP addresses, and MAC addresses |
| `INVENTORY_PERIOD_S` | api | optional: period of the NetBox / NPM cycle, default `300` |
| `CONTAINER_STATUS_URL` | web | HTTP endpoint returning live Docker container states (GET-only upstream) |
| `ROUTEROS_HOST` | api | Router address for the API service |
| `ROUTEROS_PORT` | api | API port, default `8728` |
| `ROUTEROS_USER` / `ROUTEROS_PASSWORD` | api | RouterOS user in a group with `read,api` policies |
| `PROXMOX_URL` | api | Proxmox VE base URL, e.g. `https://192.0.2.11:8006` (TLS is not verified: self-signed certificates work) |
| `PROXMOX_TOKEN` | api | Proxmox API token, e.g. `user@realm!token=uuid`; Proxmox data is off unless both are set |
| `PROXMOX_PERIOD_S` / `PROXMOX_METRICS_PERIOD_S` | api | optional: polling periods, default `15` / `60` |
| `NETBOX_PUBLIC_URL` | api | optional: NetBox UI base URL, for links on the ARP page |
| `SERVICE_CHECK_EXCLUDE` | api | optional: comma-separated check names (`parent/service`) never checked |
| `NPM_URL` | api | optional: direct Nginx Proxy Manager admin/API base URL, e.g. `http://192.0.2.15:81` |
| `NPM_IDENTITY` / `NPM_SECRET` | api | optional: NPM user (e-mail) and password; the user needs view rights on proxy hosts. Public links are off unless all three NPM variables are set |
| `STREAM_GRACE_S` | api | optional: seconds the stream sources keep running after the last page disconnected, default `10` |
| `BACKEND_URL` | dev server | optional: where the backend runs, default `http://127.0.0.1:8000` |

The browser calls its own origin only:
- `GET /api/stream`, `GET /api/service-status`, `POST /api/refresh` -> the backend (`http://api:8000`)
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

Production runs as a **Portainer Git stack** (Docker Compose) built from this repository:

| Setting | Value |
|---|---|
| Repository / reference | this repository, `refs/heads/main` |
| Compose file | `docker-compose.yml` |
| Images | built on the Docker host at deploy time (`build:`), nothing is pulled from a registry |
| Environment | the variables from [Configuration](#configuration), set in the stack (not in the repository) |
| Exposed port | `web` on host port `8081`; `api` is reachable only inside the stack network |
| Automatic updates | off: a push to `main` changes nothing until the stack is redeployed |

Flow:
1. Merge into `main` and push.
2. Redeploy the stack: in Portainer **Pull and redeploy** (re-pull the repository and rebuild),
   or via the API:
   ```
   PUT /api/stacks/<id>/git/redeploy?endpointId=<endpointId>
   {"repositoryReferenceName": "refs/heads/main", "env": [...], "pullImage": true, "prune": false}
   ```
   The API call replaces the stack environment with `env`: send the stack's current `Env` back unchanged.
3. Verify: containers `lab-status` and `lab-status-api` are running without restarts, the
   stack's deployed commit (`GitConfig.ConfigHash`) equals the merge commit, and the page loads
   with data.

> **Warning:** nginx will not start if `CONTAINER_STATUS_URL` is missing, because template
> substitution (`envsubst`) requires it.

The public address is served by a reverse proxy in front of host port `8081` (e.g.
`https://status.example.com` -> `http://192.0.2.20:8081`). It must not buffer
`/api/stream` (Server-Sent Events); nginx sends `X-Accel-Buffering: no` for it.

The router must accept API connections from the stack's host: the API service's
`available-from`, the user's `address`, and the router firewall.

Locally:
```sh
docker compose --env-file .env.local up --build
```
