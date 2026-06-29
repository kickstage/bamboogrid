# BambooGrid

A web-based editor for building power networks and running load-flow (power-flow)
calculations with [pandapower](https://pandapower.org).

You drag elements onto a canvas, wire them together, set their parameters, and
run a load flow. Each editing session is backed by a **pandapower network kept on
the server** as the source of truth; the browser holds only a projection of it
(the modeled elements, their layout, and read-only placeholders for elements the
editor doesn't model yet) and edits it through commands. The long-term aim is to
also export to CGMES.

> **Status.** The editor supports **buses**, three source types (**external
> grid**/slack, **generator**, **static generator**), **loads**, bus–bus
> **switches**, and two- and three-winding **transformers** — enough to model
> multi-voltage-level networks and observe voltage drop, transformer loading and
> slack balancing under load. Networks import and export as **pandapower JSON**
> (the file also carries the diagram layout). CGMES export is a planned next step.

## Elements

| Element | pandapower | Role |
| --- | --- | --- |
| Bus bar | `bus` | A node at a nominal voltage (kV); everything attaches to a bus. |
| External grid | `ext_grid` | The slack / voltage reference; holds its bus voltage and balances the network. |
| Generator | `gen` | A PV unit: set its active power and the voltage it holds; reactive power is solved. |
| Static generator | `sgen` | A PQ injection (PV / wind / storage feed-in): set active and reactive power. |
| Load | `load` | Consumes a fixed P and Q. |
| Switch | `switch` (`et="b"`) | Ties two buses; closed = one node, open = separated. |
| Transformer | `trafo` | 2-winding, connects an HV and an LV bus (from a standard type). |
| 3W transformer | `trafo3w` | 3-winding, connects HV / MV / LV buses. |

See [`examples/`](examples/) for a guided tour of these elements — three small,
progressively richer networks you can import and solve.

## Architecture

```
bamboogrid/
  backend/    FastAPI + pandapower: session store, projection, command + load-flow API
  frontend/   Vite + React + TypeScript: React Flow canvas, palette, inspector
```

The **server-side pandapower `net` is the source of truth**, held per session and
persisted in PostgreSQL. The browser never holds the full net: it receives a
projection (modeled elements + layout + read-only foreign elements) and mutates
the authoritative net through commands. Elements and attributes the editor
doesn't model yet are therefore preserved and still influence the solve.

## Prerequisites

- Python 3.10+ (developed on 3.13)
- Node 18+

## Running it

Two processes: the API and the web app. Run each in its own terminal.

### Backend (port 8000)

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -e ".[dev]"
.venv/bin/uvicorn app.main:app --reload
```

- API root: <http://localhost:8000>
- Interactive API docs (Swagger): <http://localhost:8000/docs>

Run the tests:

```bash
cd backend
.venv/bin/pytest
```

### Frontend (port 5173)

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>. The frontend calls the API on its own origin
(relative paths); in dev, Vite proxies `/session`, `/share` and `/health` to
`http://localhost:8000` (see `frontend/vite.config.ts`).

Type-check / production build:

```bash
cd frontend
npm run typecheck   # tsc --noEmit
npm run build       # tsc + vite build
```

## Docker / Kubernetes

The whole app ships as a **single container**: the FastAPI backend serves the
built SPA as static files, so UI and API share one origin on port 8000.

### Local development with Docker Compose (hot reload)

For a one-command local dev environment — the app, with hot reload, plus its
PostgreSQL database — use Compose:

```bash
docker compose up --build
```

Open <http://localhost:8000> — that's the app, served by the **Vite dev server**
(with HMR), which proxies API calls to the backend, so the whole app lives on one
URL just like the production bundle. The backend runs **auto-reloading**
(`uvicorn --reload`) and is also exposed directly on <http://localhost:8001> for
the API / Swagger (<http://localhost:8001/docs>). Both `./frontend` and
`./backend` are bind-mounted, so edits are picked up live, no rebuild. Postgres
state persists in the `pgdata` volume; `docker compose down -v` also drops it.

> This compose file is for local dev only. Production is the single image below,
> deployed via Helm/k8s — not Compose.

### Building the production image

```bash
docker build -t bamboogrid .
docker run --rm -p 8000:8000 -e DATABASE_URL=postgresql://… bamboogrid
```

Open <http://localhost:8000>.

CI publishes the image to **`ghcr.io/kickstage/bamboogrid`**
(nightly via `nightly` tag, and on GitHub release as semver + `latest`).

A Helm chart lives in [`deploy/helm/bamboogrid`](deploy/helm/bamboogrid):

```bash
helm install bamboogrid deploy/helm/bamboogrid \
  --set image.tag=nightly
```

The package is private by default (private repo), so the cluster needs a pull
secret. Create one and reference it via `imagePullSecrets`:

```bash
kubectl create secret docker-registry ghcr-pull \
  --docker-server=ghcr.io \
  --docker-username=<github-user> \
  --docker-password=<PAT with read:packages>

helm install bamboogrid deploy/helm/bamboogrid \
  --set 'imagePullSecrets[0].name=ghcr-pull'
```

## Using the editor

1. **Drag** elements from the left palette (grouped into *Nodes*, *Sources*,
   *Loads*, *Connections*) onto the canvas.
2. **Connect** their handles to buses. A component (generator, static generator,
   external grid, load) wires to one bus; a switch wires each of its two ends to
   a bus; a transformer wires each winding (HV/LV, or HV/MV/LV) to a bus. Each
   handle carries a single wire, and the busbar grows ports as you attach more.
3. **Select** an element and edit its parameters in the right-hand inspector
   (e.g. bus `vn_kv`; generator `p_mw`/`vm_pu`; load `p_mw`/`q_mvar`; external
   grid `vm_pu`; transformer standard type).
4. **Run load flow** — bus voltages (`vm_pu`) are painted onto the buses (tinted
   green/amber/red by how far they are from 1.0 p.u.); generators, sgens and
   external grids show their solved P/Q, and transformers their loading %. A
   failed solve shows a banner and clears stale results. Toggle the **Results**
   switch to show/hide them.
5. **Import / Export** — *Export* downloads the network as a single pandapower
   JSON (a valid pandapower net plus `diagram_*` layout tables); *Import* loads a
   pandapower JSON back — either one we exported, or a plain pandapower net
   (which gets an automatic layout).
6. **Share** — *Share* copies a short link; opening it gives the recipient an
   editable **copy** (a fresh session), so the original is never modified. Your
   work is saved to its server session and restored on reload.

Delete elements or wires with **Backspace/Delete**, or via the inspector's
**Delete element** button / the **×** that appears on a selected wire. Toggle
**dark mode** from the toolbar. Buses can be **resized** horizontally when selected.
