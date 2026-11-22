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
   represents the application's health), sent as `services` events of `GET /api/stream`. Only `http`/`https`
   services are ever links; `rtsp`/`webrtc` services are not clickable (their port may still
   be shown). The service flagged `check` is the one shown on the node's tile. When an
   enabled Nginx Proxy Manager proxy host forwards to the checked `ip:port`, the entry also
   carries its `public_url` (`https://<first domain>` with a certificate, else `http://`):
   the tile then links to the domain and shows the direct address as a secondary link
   (proxy hosts are read on the inventory cycle; an NPM failure keeps the last known links and
   never fails the checks);
3. **Docker container states**: followed by the backend through Portainer's Docker events and sent
   as `containers` events of `GET /api/stream`;
4. **Proxmox**: live guest states, node status, and CPU/memory load graphs, polled by the backend
   and sent as `proxmox` / `metrics` events of `GET /api/stream`;
5. **Router ARP table**: a live mirror streamed by the backend as `arp` events of `GET /api/stream`;
6. **Router CAPsMAN (Wi-Fi)**: wireless networks, access points and clients, polled by the backend
   and sent as `wifi` events of `GET /api/stream` (shown on the Topology page);
7. **Home Assistant (Zigbee)**: the Zigbee2MQTT devices, read over the WebSocket API, sent as
   `zigbee` events of `GET /api/stream` (shown on the Topology page).

A second page, `#/topology`, draws the physical network from NetBox cabling (see
[Topology](#topology)).

A third page, `#/arp`, lists the router's ARP table live, each entry matched to the
NetBox object owning its MAC, with three views: unknown (no NetBox match), active, and
disconnected (`failed` / `incomplete`).

The tree appears immediately: the last successfully loaded inventory is cached in the
browser's local storage (with schema versioning), so the page renders instantly on open
and survives NetBox being unreachable. Refreshing never blanks what is on screen.

The page makes exactly two kinds of requests besides its static files: the stream
(`GET /api/stream`) and, on the Refresh button, `POST /api/refresh`.

**Refresh block.** The right end of the header is one button, as tall as the Hosts | Topology | ARP
switch (`--header-control-height`) and styled like it: a binary clock on top and the local time
of the last inventory update (HH:MM:SS) below. The clock is the age in whole seconds of the
NetBox inventory (`updatedAt` of the `inventory` source, the data Refresh re-reads), counting
up, one diamond per bit (one inline SVG; half-diagonal 3 px, centres 7 px apart), most
significant left. The bit count is the smallest that holds the inventory period (`periodS`: 9
bits for 300 s); past 511 s every bit stays lit. Lit bits change colour with the fraction of
the period elapsed, linearly in RGB: green `rgb(52,211,84)` at 0, yellow `rgb(245,204,30)` at
half, orange-red `rgb(240,78,38)` at the end and after; any source in state `error` makes them
orange-red. It ticks once per second from real time and stops while the stream is paused for
a hidden tab. A click anywhere on the block sends `POST /api/refresh` (the backend re-reads
NetBox, NPM, Proxmox and the container lists and re-runs every service check; answered 202);
the clock returns to zero when the new `updatedAt` arrives. The tooltip starts with the full
date and time of the inventory, then lists every source: its age for polling sources, `live`
or the connection state for `arp` and `containers`, and the error, if any. Its label for
assistive technology is "Refresh, data N s old, updated HH:MM:SS".

## Event stream

The page holds one Server-Sent Events connection, `GET /api/stream`; the SSE `event:`
field names the source of each message (`arp`, `inventory`, `services`, `proxmox`, `metrics`, `containers`, `wifi`, `zigbee`). The backend runs its sources
only while at least one page is connected: the first subscriber starts them, and when the
last one leaves they keep running for `STREAM_GRACE_S` seconds (default 10) and stop only
if nobody reconnected, so a page reload reuses the running sessions. A new subscriber, and
a client that fell too far behind, first receives each source's current state.
`GET /api/health` reports the subscriber count and each source's state.

Polling sources (`inventory`, `proxmox`, `metrics`, `wifi`; `containers` and `services` alike) publish two kinds of events: `{"type": "data", "data": ...}`
only when the data changed, and `{"type": "status", "state", "error", "updatedAt", "periodS"}`
whenever the state, the error or the time of the last successful fetch (`updatedAt`, ISO 8601
UTC) changes. A failed poll keeps the last data and reports the error; polling goes on (`wifi`
alone publishes an empty snapshot instead, so the page never shows stale wireless clients).
`state` describes the published data: `error` means the last poll produced none, while
`live` with a non-null `error` means it succeeded only in part.

| Source | Upstream | Period | `data` |
|---|---|---|---|
| `inventory` | NetBox: the page's GraphQL query and REST services, virtual machines, devices, MAC addresses, cables, interfaces, VLANs; NPM proxy hosts; all concurrently, each data set once | 300 s (`INVENTORY_PERIOD_S`) | the GraphQL `data` object unchanged, plus the key `topology` (below) |
| `proxmox` | `cluster/resources` | 15 s (`PROXMOX_PERIOD_S`) | the Proxmox `data` array unchanged |
| `metrics` | `nodes/<node>/rrddata?timeframe=hour&cf=AVERAGE` for every node of the latest cluster resources, concurrently | 60 s (`PROXMOX_METRICS_PERIOD_S`), and at once when the node set changes | `{node: points}`; a node that fails gets `[]` |
| `wifi` | RouterOS API: `print` of six legacy CAPsMAN menus on one short session (see [Wi-Fi source](#wi-fi-source)) | 15 s, and at once when the NetBox MAC directory or device names change | `{networks, aps, radios, clients}` |
| `zigbee` | Home Assistant: one short WebSocket connection (see [Zigbee source](#zigbee-source)) | 60 s, and at once when the coordinator's NetBox device changes | `{coordinator, devices}` |

The `inventory` cycle is the backend's only NetBox (and NPM) read: the service checks take
their targets and public URLs from it, and the ARP mirror its MAC directory (a changed
directory re-sends the ARP snapshot). A part that fails keeps its previous value; if only the
page's inventory failed the status is `error`, otherwise `live` with the failure in `error`
(parts in the order inventory, targets, MAC directory, topology, NPM). A failed topology read
is named `Topology: <message>`, so the page can tell that only the cabling is stale; the last
topology is kept and still published.

The `topology` key of the `inventory` data (`null` until NetBox cabling was first read):

```
{ "vlans":  [{ "vid", "name" }],
  "ports":  [{ "id", "deviceId", "name", "order", "type", "speedKbps", "mode", "untagged", "tagged": [vid], "mgmtOnly" }],
  "cables": [{ "id", "type", "a": portId, "b": portId }] }
```

Only connected cables with a single interface on each end are kept, and none that touches a
device with status `inventory` (reserve hardware, hidden on the Hosts page too). Only ports
that terminate a kept cable are listed; `order` is the interface's index in NetBox's natural
order within its device. Ids are strings, like the GraphQL ids.

`POST /api/refresh` runs every polling source at once, reconciles the container lists and
starts a full round of service checks.

The `services` source checks every target (SERVICE_CHECK_EXCLUDE applied; at most 16 at a
time, each with a 3 s timeout and one retry; any answer below HTTP 500 is up) in a full round
every 180 s (`SERVICES_PERIOD_S`), when the inventory cycle brings a different target list,
and on refresh. Between rounds, events re-check only the affected targets and the merged list
is published (only when something changed):

| Event | Targets | Action |
|---|---|---|
| ARP: the target's address becomes `failed` / `incomplete` | the host's (by the address in the URL) | down at once, error `Host does not answer ARP`, no check |
| ARP: the address is removed while active | the host's | one check now (the router also drops idle hosts) |
| ARP: the address becomes active after being absent or failed | the host's | checks after 5, 15, 30 and 60 s |
| Container: a known container stops (any state but `running`) | the services of its NetBox container | down at once, error `Container is not running` |
| Container: it runs again | the same | checks after 5, 15 and 30 s |

ARP noise (`reachable` <-> `stale` and the like) and `permanent` entries cause nothing; the
full round covers them. A container entry maps to its NetBox container as on the page: the
Docker VM whose `alias` is the entry name; with several, the one whose host VM is named like
the environment. A newer event of the same host or container replaces its pending checks.
The backend still answers `GET /api/service-status` with the source's latest list (after a
round when there is none younger than the period); nginx no longer exposes it, so it is
reachable only inside the stack network.

The `containers` source follows every Portainer Docker environment that is up: it lists the
containers, then holds the environment's Docker event stream open (`type=container` only,
uncompressed). Events that cannot change the state or the status text, such as health checks'
`exec_*`, are dropped by the backend rather than by a server-side filter: Portainer buffers the
proxied stream until enough bytes accumulate, and a filtered, quiet stream leaves the last
events of a burst stuck. Each kept event re-reads that one container through the list endpoint
filtered by id (only the list endpoint gives the status text, e.g. `Up 4 days (healthy)`); an
empty answer removes it (`destroy`). The same container is re-read again 3 s and 15 s after
its last event, in case a later event is still delayed. Every 300 s (`CONTAINERS_PERIOD_S`), and on refresh, all environments are
re-listed, which corrects missed events. Its events have the same shape as the polling
sources'; `data` is `[{"env", "name", "state", "status"}]` sorted by environment and name
(`env` is the Portainer environment name), `periodS` the re-list period. An environment that
fails keeps its entries and reconnects after 2 s, doubling to 60 s; it is reported as
`"<env>: <error>"` in `error` (several joined by `; `), with `state` staying `live` while
another environment is live. `GET /api/health` lists each environment's state, error,
`updatedAt` and container count.

A tab hidden for longer than 10 s closes the stream and reopens it when shown again; the
data on screen stays until fresh events replace it.
If the server answers the stream request with an HTTP error (e.g. 502 while the backend
restarts), the browser gives up on it; the page then reopens it itself after 2 s, doubling
the delay up to 30 s. In the backend, a source that crashes is restarted after 2 s while
pages are connected.

## Topology

`#/topology` is a physical network diagram: devices are cards, the ports of routers, switches
and access points are jacks, cables are orthogonal lines. Nothing is placed by hand; the page
lays the graph out with [elkjs](https://github.com/kieler/elkjs). Guests, containers and
services are not drawn: the Hosts page shows them. The page and elkjs load as a separate
chunk on the first visit.

**Data.** The backend reads `dcim/cables/`, `dcim/interfaces/` and `ipam/vlans/` on the
inventory cycle (devices come from the same cycle's `dcim/devices/`) and publishes the compact
`topology` structure inside the `inventory` payload (see [Event stream](#event-stream)). The
NetBox fields that drive the picture:

| NetBox field | Effect |
|---|---|
| cable `status` = `connected`, both ends interfaces | the cable is drawn |
| device `status` = `inventory` | the device and its cables are left out |
| device `status` = `offline` | the card is dimmed |
| device role slug `router` | root of the diagram (top) |
| device role slug `router`, `switch`, `access-point` | ports drawn as a jack row in NetBox order |
| device role slug `server` | a Hosts machine: summary line, link to its tile |
| interface `mode` (`tagged`, `tagged-all`) or `tagged_vlans` | trunk cable (light, with a dark core) |
| interface `untagged_vlan` | access cable in the VLAN's colour |
| interface `speed`, else the nominal speed of its `type` | line width (10G / 2.5G / 1G / 100M) and a speed tag on everything but 1G |

A cable is a trunk when either end is tagged, otherwise an access cable in the untagged VLAN
of either end, otherwise grey ("no VLAN data"). A VLAN is never guessed from addresses. A cable
takes the lower speed of its two ends. VLAN colours are tokens `--color-vlan-<vid>` in
`tokens.css` for vids 1, 10, 20 … 100 and 61; any other vid gets a colour derived from its
number (hue stepped by the golden angle, one of three lightness levels), stable and different
for every vid. The legend lists only what the diagram shows.

**Layout.** Root: the device with role `router` (a part of the network the router does not
reach starts from its own switch-like device, else the device with most cables). A BFS over
the cables gives every device a depth; each cable runs from the shallower device (port on its
SOUTH side) to the deeper one (NORTH side). ELK `layered`, direction `DOWN`, orthogonal edge
routing, node placement `BRANDES_KOEPF`, node spacing 20. No post-compaction: it pulls every
card up on its own and breaks the rows into stairs; without it the cards of a row are
top-aligned (next to a group they may sit lower, since ELK pads the group's rectangle).
Switch-like devices keep their port order (`FIXED_ORDER`, pitch 42 px, card width
max(330, ports x 42 + 40)); one with at most one SOUTH port (an access point, a single-uplink
switch) is as wide as an ordinary card (190 px). Other devices fix only the side
(`FIXED_SIDE`). Port names longer than the pitch are cut, the full name is in the tooltip. The
layout runs again only when devices, ports, cables, card rows or groups change, not on status
or metrics events (a machine gaining or losing Proxmox metrics adds or drops its load row).

**Groups.** Some devices are laid out together inside one dashed rectangle, defined by a list
(`GROUP_DEFINITIONS` in `src/domain/topology.ts`; a new group is one entry), tried in order,
a device belonging to at most one group, at least two members per group:

| Group | Rule |
|---|---|
| Cameras | role `camera`, every cable to one and the same device; one group per such upstream device |
| Proxmox nodes | platform `Proxmox VE`, wherever they are cabled |

In ELK a group is a parent node with its members as children (`elk.hierarchyHandling:
INCLUDE_CHILDREN` on the root, padding top 28 / sides and bottom 12); the cables stay declared
at the root, and member positions are converted back to absolute coordinates. The rectangle is
drawn under the cables and cards; its label (name, member count, and the VLAN when all the
members' cables are access cables of one VLAN) sits on a small page-coloured chip above the
cables, at the bottom-left corner and centred on the bottom border, away from the top edge
where the cables enter the group. Border and label take that VLAN's colour, else a neutral one. Member cards keep their
links, focus and highlight; offline members stay dimmed.

**Jacks.** The ports of switch-like devices are drawn by interface type as inline SVG
(`TopologyJack.vue`): copper (`*base-t`, `*base-tx`) as an RJ45 port seen from the front:
housing, cavity with the latch notch and five contact pins (30 x 22), the SFP family (`*-sfp`, `*-sfpp`, `*-sfp28`, `*-qsfp*`, `*base-x-*`) as a cage with
its opening (36 x 18), anything else as a plain rectangle (24 x 12); each is centred on the
card edge, its notch or opening towards the cable, coloured like its cable. The jack band
inside the card (half the tallest jack, a gap and the port name) is part of the card height.
Cables are an SVG layer under absolutely positioned HTML cards; the diagram is scaled to the
page width, never above 1 and not below 0.6 (it scrolls horizontally then).

**Cards.** A stack of single-line rows of fixed height: icon and name, model (else role),
primary IP. The state sits beside the name: as the full badge on cards wide enough for it
next to a 16-character name (`FULL_BADGE_MIN_WIDTH`, i.e. switches with a jack row), and as a
coloured dot elsewhere (the word in its tooltip and for screen readers), so the name of an
ordinary 190 px card stays readable. Hosts machines show their state there and add a row with guest and
container counts and, when Proxmox reports them, a row with current CPU / memory. Other
devices show the router's ARP presence (online / unreachable) beside the name when the router
knows one of their MACs. The
height given to ELK is computed from the same rows (`cardLines`, `CARD_LINE_HEIGHT`), so a card
never overflows its box.

**Hover trace.** Pointing at a card (mouse or pen; a tap only follows the link) or focusing it
from the keyboard traces that device, one hop: its cables are drawn on top at full opacity with
a soft glow in their own colour, the devices at their other ends get the same brighter border
as the pointed card, the jacks at both ends glow and their port names stand out, and the speed
tags of those cables stay. Everything else is toned down, not hidden: other cables to 25 %,
other cards, the untraced jacks of a traced card, other speed tags and the group frames and
labels to 45 %. Leaving or blurring the card restores the view; the transitions (150 ms) are
off with `prefers-reduced-motion`. The neighbours come from the pure `traceOf(graph, deviceId)`
in `src/domain/topology.ts`; the page keeps one traced device id.

**Wi-Fi in the diagram.** Wireless devices are part of the diagram, fed by the `wifi` event
(`src/domain/wifiGraph.ts`):
- every radio of an access point on the diagram (one per AP x SSID) is a `radio` port on its
  card, SOUTH after the copper ports, labelled `<SSID> · <channel>` on two lines; a disabled or
  down radio keeps its port, dimmed, labelled `· off` / `· down`, without lines;
- a client whose NetBox device is already on the diagram gets a NORTH `radio` port (`wlan`) on
  its card; any other client becomes a card of its own (name, address row, one `wlan` port),
  linking to Hosts exactly when its device is a Hosts machine;
- one Wi-Fi edge per client, from the access point's radio port to the client's port, coloured
  by the network's VLAN, no speed tag;
- the Wi-Fi-only clients of one radio, from two on, are packed into a frame (dashed, VLAN
  colour, label chip "<SSID> · <channel> · <count>" on the bottom border): their compact cards
  (name, address, a Wi-Fi glyph, no port) in a grid of at most two columns by name, computed by
  the page; ELK gets the frame as one node of that size, and one Wi-Fi line runs from the radio
  port to the frame's top edge. A single client keeps its own card and line; a wired device on
  Wi-Fi is never moved into a frame. Pointing at the access point lights the frame and its
  members, pointing at a member lights its access point and the frame's line.

Wi-Fi client cards are 150 wide (wired cards 190). An access point's radio ports add to its
width by the port pitch, but do not make it a 330-wide jack-row card (that minimum is for two
or more copper / SFP ports).

Radio ports are a pill-shaped housing with a Wi-Fi glyph (same box as RJ45). Wi-Fi lines go
through ELK with the cables; each straight segment of the route is drawn as a run of quadratic
half-waves (amplitude 3.4, half-wavelength 7, stroke 1.5; a segment shorter than one half-wave
stays straight), and where ELK merged the routes of one radio port a small dot marks the branch.

Stability: the layout is fed a *plan*, the radios plus every client seen since the page was
opened, each on the radio it was laid out on (`useWifiPlan`). A client that disconnects keeps
its place until reload (card dimmed, line removed, no relayout; a frame's line goes only when
none of its members is connected). A client joining or leaving a frame resizes it: structural. A new client, a client on
another radio, or a change in the radios is a structural change and lays the diagram out again,
but at most once every 10 s (changes in between are collected and applied together). Channels,
signal, radio states, names and addresses never cause a relayout.

**Wi-Fi grid.** Under the diagram, collapsed by default behind its "Wi-Fi" title (click to open;
remembered in local storage): a grid built without ELK, access points as columns (in the order
of their cards, then by name), networks (SSID + band) as rows tinted in the VLAN colour with
the SSID, band and "VLAN <id> <name>" at their head; a cell is empty, "radio disabled", or the
channel in MHz (marked "down") with client chips (tooltip: MAC, IP, signal, uptime; a Hosts
machine links to its tile) or "no clients".

**Layers.** Next to the legend, one button per layer (`LAYERS` in `src/presentation/layers.ts`;
a new layer is one entry), each cycling shown -> grey -> hidden, remembered in local storage
(default: all shown). Grey is 20 % opacity and greyscale.
- Wired: cables, copper jacks and wired-only devices. While it is grey, cards with a radio port
  (access points, wired devices also on Wi-Fi, Wi-Fi clients) stay fully visible, only their
  copper jacks fade; hidden keeps the drawing's space but draws none of it.
- Wi-Fi: radio ports (also a wired device's `wlan` port), Wi-Fi lines and Wi-Fi client cards.
  Hidden takes them out of the layout: the diagram returns to its wired-only size.
- Zigbee: the coordinator's port, the bead line and the Zigbee frame; hidden takes them out of
  the layout.

**Wi-Fi cameras.** A device of a grouped role (Cameras) that is on the diagram only as a Wi-Fi
client becomes a regular member of that group's frame: a card like the other members, its radio
port on the top edge (no label, so the card keeps their size) and its own wavy line from the
access point; never in a Wi-Fi client frame. The group label keeps its VLAN only while every
member's link (cable or Wi-Fi) is an access link of that VLAN. With the Wi-Fi layer hidden the
camera leaves the diagram and the member count follows.

**Zigbee.** The coordinator (the NetBox device with a service named `zigbee-socket`) gets one
SOUTH `zigbee` port, a hexagonal housing with a zigzag in `--color-zigbee`, labelled "Zigbee".
All Zigbee devices sit in one frame "Zigbee · <count>" in that colour (compact cards like Wi-Fi
clients, two columns, by name: name, then area or model; unavailable ones dimmed; not links),
and one line of round beads (3.4 wide, 8 apart) runs from the port to the frame's top edge. The
real mesh routes are not shown (the frame's label says so in its title). Without the coordinator
on the diagram the frame is shown without a line. Stability as for Wi-Fi: a device that
disappears stays dimmed until reload, new devices or another coordinator lay out again at most
once per 10 s, availability never does. The trace runs coordinator <-> frame and members.

The hover trace treats Wi-Fi lines like cables: pointing at an access point emphasises its
wireless clients and their lines, pointing at a client its access point. The legend shows the
wavy Wi-Fi line and the radio port while the Wi-Fi layer is not hidden, and the beads and the
coordinator port while the Zigbee layer is not hidden.

**Navigation.** A Hosts machine's card links to `#/?focus=<deviceId>`; a machine tile on the
Hosts page has a "Show on topology" button (only when the device is on the diagram) to
`#/topology?focus=<deviceId>`. On arrival the target is scrolled into view, centred, and
pulses in the accent colour for 1.6 s (a static outline with `prefers-reduced-motion`), then
the `focus` parameter is removed with `history.replaceState`, so reload and Back do not replay
it. An unknown id is ignored. The focus wins over the page's restored scroll position.

## Wi-Fi source

The `wifi` source (`backend/app/wifi.py`) uses the router connection settings of the ARP mirror
(`ROUTEROS_*`, no new variables) and reads, on one session per cycle, `/caps-man/interface`,
`/caps-man/configuration`, `/caps-man/datapath`, `/caps-man/remote-cap`, `/caps-man/radio` and
`/caps-man/registration-table` (the legacy CAPsMAN). `/caps-man/security` is never read, and no
passphrase or security profile is copied into the event. Its `data`:

```
{ "networks": [{ "ssid", "band": "2.4" | "5" | null, "vlan" }],
  "aps":      [{ "id", "name", "deviceId" }],
  "radios":   [{ "apId", "ssid", "band", "channel", "state": "running" | "disabled" | "down" }],
  "clients":  [{ "apId", "ssid", "band", "mac", "name", "deviceId", "ip", "signal", "uptime" }] }
```

- One radio entry per CAPsMAN interface; a slave (virtual) interface belongs to its master's
  radio (same access point, channel and band, its own SSID). `channel` is the frequency in MHz;
  `band` comes from it, or for a disabled radio from the configuration / channel profile name.
  `state`: `disabled` (the interface or its master); `running` when CAPsMAN reports the
  interface broadcasting (`current-state` `running-ap` and the like, a slave without its own
  taking its master's), whatever the `running` flag says (it is off on an AP with no clients),
  or when the flag is set; else `down`.
- SSID -> VLAN: configuration -> datapath -> `vlan-id` (an inline `datapath.vlan-id` wins).
- Access point -> NetBox device: a CAP base / radio / interface MAC in the NetBox MAC directory,
  else a NetBox device named like the CAP identity, else none (`name` = identity).
- Client `name`: the NetBox object owning its MAC, else the DHCP lease comment, else the lease
  host name (both from the ARP mirror), else the MAC; `ip` from the lease / ARP table, else the
  CAP's `last-ip`; `signal` in dBm; `uptime` as RouterOS shows it, without fractions of a second.
- If the menus are absent or the read fails, the source publishes an empty snapshot and a
  status error starting with `Wi-Fi: `; nothing else depends on it.

## Zigbee source

The `zigbee` source (`backend/app/zigbee.py`) reads Home Assistant, read-only, through the
WebSocket API, which a non-admin user may use (`POST /api/template` is admin-only). Once per
cycle it opens one connection to `{HA_URL}/api/websocket` (`ws://` or `wss://` after the scheme
of `HA_URL`), authenticates with the token, sends `config/device_registry/list`,
`config/entity_registry/list`, `config/area_registry/list` and `get_states`, and closes it. No
service is called, nothing is subscribed to, no registry is changed. It keeps the Zigbee2MQTT
bridge (manufacturer `Zigbee2MQTT`) and every device whose `via_device_id` is the bridge. Its
`data`:

```
{ "coordinator": { "deviceId": string | null, "version": string | null },
  "devices":     [{ "id", "name", "manufacturer", "model", "area", "available" }] }
```

`name` is the user's name, else the device name; `area` is the name of the device's area;
`available` is true when at least one of the device's entities has a state other than
`unavailable`; `version` is the bridge's software version when
exposed; `coordinator.deviceId` is the NetBox device with a service named `zigbee-socket` (from
the inventory cycle), else null. Errors start with `Zigbee: `; the token is only sent in the
`auth` message and never appears in a message, log line or event (the WebSocket library's frame
log is kept above DEBUG for this reason). Without `HA_URL` and
`HA_TOKEN` the source is off: its status says so and the data is empty.

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
| `src/api/` | validation of the stream payloads (inventory, service checks, container list), the refresh request, typed errors |
| `src/domain/` | pure logic: normalizing NetBox data, building the tree, state rules, ARP presence, the topology graph |
| `src/composables/` | the shared stream (`useEventStream`) and one reader per source (`useInventory`, `useStatuses`, `useContainerStatuses`, `useProxmox`, `useArp`, `useSourceStatuses`), combined in `useLab`; the ELK layout (`useTopologyLayout`) and the focus jump (`useFocusTarget`) |
| `src/components/` | render-only components: the tree, the Topology page (cards, cables, legend), the ARP page, the refresh clock, error page, skeleton |
| `src/presentation/` | display helpers: layout, links, platform icons, hardware text, the clock's bits and colours, routes, the topology's ELK input and drawing |
| `src/__fixtures__/` | synthetic responses covering all topology cases, used by the tests |
| `backend/app/` | FastAPI: stream hub and polling base, ARP mirror, inventory cycle (NetBox, NPM), Proxmox, Portainer container states, service checks |
| `backend/tests/` | pytest suite |
| `nginx/default.conf.template` | nginx config: the page and the backend's endpoints; it needs no variables |
| `Dockerfile` | stage 1: Node builds the app; stage 2: `nginx:alpine` serves `dist/` |
| `backend/Dockerfile` | Python 3.13 + uv, `uvicorn` on port 8000 |
| `docker-compose.yml` | services `web` (`lab-status`, port `8081:80`) and `api` (`lab-status-api`, internal) |

## Configuration

| Variable | Used by | Meaning |
|---|---|---|
| `NETBOX_URL` | api | NetBox base URL, e.g. `http://192.0.2.10:8000` (no trailing slash) |
| `NETBOX_TOKEN` | api | API token of a read-only NetBox user (GraphQL and REST); it needs view rights on devices, virtual machines, services, IP addresses, MAC addresses, cables, interfaces, and VLANs |
| `INVENTORY_PERIOD_S` | api | optional: period of the NetBox / NPM cycle, default `300` |
| `ROUTEROS_HOST` | api | Router address for the API service |
| `ROUTEROS_PORT` | api | API port, default `8728` |
| `ROUTEROS_USER` / `ROUTEROS_PASSWORD` | api | RouterOS user in a group with `read,api` policies (ARP mirror and the CAPsMAN menus of the Wi-Fi source; `sensitive` is not needed) |
| `PROXMOX_URL` | api | Proxmox VE base URL, e.g. `https://192.0.2.11:8006` (TLS is not verified: self-signed certificates work) |
| `PROXMOX_TOKEN` | api | Proxmox API token, e.g. `user@realm!token=uuid`; Proxmox data is off unless both are set |
| `PROXMOX_PERIOD_S` / `PROXMOX_METRICS_PERIOD_S` | api | optional: polling periods, default `15` / `60` |
| `NETBOX_PUBLIC_URL` | api | optional: NetBox UI base URL, for links on the ARP page |
| `SERVICE_CHECK_EXCLUDE` | api | optional: comma-separated check names (`parent/service`) never checked |
| `SERVICES_PERIOD_S` | api | optional: period of the full round of service checks, default `180` |
| `NPM_URL` | api | optional: direct Nginx Proxy Manager admin/API base URL, e.g. `http://192.0.2.15:81` |
| `NPM_IDENTITY` / `NPM_SECRET` | api | optional: NPM user (e-mail) and password; the user needs view rights on proxy hosts. Public links are off unless all three NPM variables are set |
| `PORTAINER_URL` | api | Portainer base URL, direct, e.g. `https://192.0.2.20:9443` (TLS is not verified: self-signed certificates work) |
| `PORTAINER_TOKEN` | api | API key (`X-API-Key`) of a Portainer user with read-only access to the Docker environments; container states are off unless both are set |
| `CONTAINERS_PERIOD_S` | api | optional: period of the full container re-list, default `300` |
| `HA_URL` | api | optional: Home Assistant base URL, e.g. `http://192.0.2.30:8123` |
| `HA_TOKEN` | api | optional: Home Assistant long-lived access token (a non-admin user is enough), used for read-only WebSocket registry reads; the `zigbee` source is off unless both are set |
| `STREAM_GRACE_S` | api | optional: seconds the stream sources keep running after the last page disconnected, default `10` |
| `BACKEND_URL` | dev server | optional: where the backend runs, default `http://127.0.0.1:8000` |

The browser calls its own origin only:
- `GET /api/stream`, `POST /api/refresh` -> the backend (`http://api:8000`)

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

The public address is served by a reverse proxy in front of host port `8081` (e.g.
`https://status.example.com` -> `http://192.0.2.20:8081`). It must not buffer
`/api/stream` (Server-Sent Events); nginx sends `X-Accel-Buffering: no` for it.

The router must accept API connections from the stack's host: the API service's
`available-from`, the user's `address`, and the router firewall.

Locally:
```sh
docker compose --env-file .env.local up --build
```
