# BambooGrid

A web-based editor for building power networks and running power-system studies —
load flow, short circuit and state estimation — with
[pandapower](https://pandapower.org).

You drag elements onto a canvas, wire them together, set their parameters, and
run a study. Each editing session is backed by a **pandapower network kept on
the server** as the source of truth; the browser holds only a projection of it
(the modeled elements, their layout, and read-only placeholders for elements the
editor doesn't model yet) and edits it through commands. The long-term aim is to
also export to CGMES.

> **Status.** The editor supports **buses**, three source types (**external
> grid**/slack, **generator**, **static generator**), **loads**, **shunts** and
> an **SVC** (a FACTS dynamic voltage regulator), **lines**, bus–bus
> **switches**, two- and three-winding **transformers** with tap changers, and
> two advanced elements (an **xward** network equivalent and a series
> **impedance**) — enough to model multi-voltage-level networks and observe
> voltage drop, transformer loading, dynamic voltage support and slack balancing
> under load. Three studies run on that model: **load flow**, an **IEC 60909
> short circuit**, and a weighted-least-squares **state estimation** (from
> measurements you place on buses, lines and transformers, with bad-data
> detection). Companion analysis tools show the **network summary**, the
> **admittance matrix (Ybus)** and the **measurement Jacobian (H)**. Networks
> import and export as **pandapower JSON** (the file also carries the diagram
> layout). CGMES export is a planned next step.

## Elements

| Element | pandapower | Role |
| --- | --- | --- |
| Bus bar | `bus` | A node at a nominal voltage (kV); everything attaches to a bus. |
| External grid | `ext_grid` | The slack / voltage reference; holds its bus voltage and balances the network. |
| Generator | `gen` | A PV unit: set its active power and the voltage it holds; reactive power is solved. |
| Static generator | `sgen` | A PQ injection (PV / wind / storage feed-in): set active and reactive power. |
| Load | `load` | Consumes a fixed P and Q. |
| Shunt | `shunt` | A fixed shunt element (e.g. capacitor/reactor) at a bus. |
| SVC | `svc` | A FACTS static var compensator: a shunt device that dynamically holds a target voltage at its bus. |
| Switch | `switch` (`et="b"`) | Ties two buses; closed = one node, open = separated. |
| Line | `line` | Connects two buses at the same voltage; drawn by wiring one bus directly to another. |
| Transformer | `trafo` | 2-winding, connects an HV and an LV bus (from a standard type). |
| 3W transformer | `trafo3w` | 3-winding, connects HV / MV / LV buses. |
| XWard | `xward` | Reduced equivalent of an external network, attached to a bus. |
| Impedance | `impedance` | A raw per-unit series branch between two buses. |

See [`examples/`](examples/) for a guided tour of these elements — three small,
progressively richer networks you can import and solve.

## Studies

Pick a study from the toolbar, then **Run** it. Results paint straight onto the
canvas; toggle the **Results** switch to show or hide them. A failed solve shows
a banner and clears any stale results. Solver options for the active study
(algorithm, tolerance, iterations, …) live under **Study ▸ Study settings**.

| Study | What it does |
| --- | --- |
| **Load flow** | Solves bus voltages and branch flows. Paints each bus with its voltage (`vm_pu`, tinted green/amber/red by distance from 1.0 p.u.); sources show their solved P/Q and transformers their loading %. |
| **Short circuit** | An **IEC 60909** fault calculation (3-phase, max) reporting fault levels per bus. |
| **State estimation** | A **weighted-least-squares** estimate of the network state from the **measurements** you place on the grid — the most likely voltages given redundant, noisy readings. Reports each measurement's residual and **normalized residual**, flags a likely **bad measurement**, and marks **critical** (non-redundant) measurements whose error can't be detected. |

### Measurements

State estimation runs on measurements kept in pandapower's native `measurement`
table. Select a bus, line or transformer and add measurements in the inspector:
voltage `v`, angle `va`, and active/reactive power `p`/`q` on buses; `p`/`q` and
current `i` on branch ends (from/to, or hv/mv/lv). Each carries a value and a
standard deviation (its weight), and can be toggled off to exclude it from a run
without deleting it. The **State estimation demo** under *File ▸ Open example* is
a ready-made, fully measured network to try it on.

### Analysis tools

Under the **Study** menu, alongside the runs:

- **Network summary** — element counts, extreme values and solve diagnostics.
- **Admittance matrix (Ybus)** — the network's nodal admittance matrix as a
  heatmap; hovering a cell spotlights the buses it couples on the diagram.
- **Measurement Jacobian (H)** — ∂(measurement)/∂(state) at the estimated state,
  as a heatmap (available once a state estimation has been run). A searchable
  **Focus** field narrows it to one bus and the states its measurements reach.

## Architecture

```
bamboogrid/
  backend/    FastAPI + pandapower: session store, projection, command + study API
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

## Docker

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

> This compose file is for local dev only. Production is the single image below —
> not Compose.

### Building the production image

```bash
docker build -t bamboogrid .
docker run --rm -p 8000:8000 -e DATABASE_URL=postgresql://… bamboogrid
```

Open <http://localhost:8000>.

The container needs a reachable PostgreSQL database via `DATABASE_URL`; sessions
are stored there.

## Using the editor

1. **Drag** elements from the left palette (grouped into *Nodes*, *Sources*,
   *Loads*, *Connections*, and *Advanced*) onto the canvas.
2. **Connect** their handles to buses. A component (generator, static generator,
   external grid, load, shunt, SVC) wires to one bus; a switch or an impedance wires
   each of its two ends to a bus; a transformer wires each winding (HV/LV, or
   HV/MV/LV) to a bus. Wiring one bus directly to another draws a **line**
   between them. Each handle carries a single wire, and the busbar grows ports as
   you attach more.
3. **Select** an element and edit its parameters in the right-hand inspector
   (e.g. bus `vn_kv`; generator `p_mw`/`vm_pu`; load `p_mw`/`q_mvar`; external
   grid `vm_pu`; transformer standard type). Buses, lines and transformers also
   take **measurements** here, which feed state estimation (see *Studies*).
4. **Run a study** — pick **Load flow**, **Short circuit** or **State
   estimation** from the toolbar and press **Run**; results paint onto the canvas
   (see [Studies](#studies) for what each computes). Solver options live under
   **Study ▸ Study settings**; the same menu opens the network summary,
   admittance matrix and measurement Jacobian. A failed solve shows a banner and
   clears stale results. Toggle the **Results** switch to show/hide them.
5. **Import / Export** — *Export* downloads the network as a single pandapower
   JSON (a valid pandapower net plus `diagram_*` layout tables); *Import* loads a
   pandapower JSON back — either one we exported, or a plain pandapower net
   (which gets an automatic layout). Imports are capped (currently 100 buses and
   16 MB) and screened for unsafe content before loading.
6. **Share** — *Share* copies a short link; opening it gives the recipient an
   editable **copy** (a fresh session), so the original is never modified. Your
   work is saved to its server session and restored on reload.

Delete elements or wires with **Backspace/Delete**, or via the inspector's
**Delete element** button / the **×** that appears on a selected wire. Toggle
**dark mode** from the toolbar. Buses can be **resized** horizontally when selected.
