# BambooGrid

A web-based editor for building power networks and running load-flow (power-flow)
calculations with [pandapower](https://pandapower.org).

You drag elements onto a canvas, wire them together, set their parameters, and
run a load flow. The network is the editor's own JSON document; a pandapower
network is built from it on demand to solve. The long-term aim is to also export
to a pandapower DataFrame and to CGMES.

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
  backend/    FastAPI + pandapower: schema, JSON→pandapower converter, load-flow API
  frontend/   Vite + React + TypeScript: React Flow canvas, palette, inspector
```

The **editor JSON document is the source of truth.** The backend builds a
pandapower `net` from it only when it needs to solve, and never persists
pandapower's own format as primary. This keeps the door open for a CGMES exporter
later that reads the same JSON.

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

Open <http://localhost:5173>. The frontend talks to the backend at
`http://localhost:8000` (configured in `frontend/src/api.ts`; CORS for the Vite
origin is set in `backend/app/main.py`).

Type-check / production build:

```bash
cd frontend
npm run typecheck   # tsc --noEmit
npm run build       # tsc + vite build
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

Delete elements or wires with **Backspace/Delete**, or via the inspector's
**Delete element** button / the **×** that appears on a selected wire. Toggle
**dark mode** from the toolbar. Buses can be **resized** horizontally when selected.
