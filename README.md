# BambooGrid

A web-based editor for building power networks and running load-flow (power-flow)
calculations with [pandapower](https://pandapower.org).

You drag elements (buses, generators, loads) onto a canvas, wire them together,
set their parameters, and run a load flow. The network is the editor's own JSON
document; a pandapower network is built from it on demand to solve. The long-term
aim is to also export to a pandapower DataFrame and to CGMES.

> **Status — iteration 1.** Supports **buses, generators, and loads** only.
> A "generator" is modelled as a pandapower `ext_grid` (slack/reference source),
> so it pins its bus to its voltage setpoint. There are no lines/transformers yet,
> so a network is a single bus (or several independent single-bus islands).
> Connecting buses with lines — which is what makes load flow interesting
> (voltage drop under load) — is the next step.

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

1. **Drag** a Bus, a Generator, and a Load from the left palette onto the canvas.
2. **Connect** the generator's and load's handles to the bus (only
   generator/load → bus is allowed; one bus per component).
3. **Select** an element and edit its parameters in the right-hand inspector
   (bus `vn_kv`; generator `vm_pu`; load `p_mw` / `q_mvar`).
4. **Run load flow** — bus voltages (`vm_pu`) are painted onto the buses; the bus
   tints green/amber/red by how far the voltage is from 1.0 p.u. A failed solve
   shows a banner and clears stale results.
5. **Save / share** — *Export JSON* downloads the network as a portable file;
   *Open JSON* loads one back; *Save to server* persists it via the API.

Delete elements or wires with **Backspace/Delete**, or via the inspector's
**Delete element** button / the **×** that appears on a selected wire. Toggle
**dark mode** from the toolbar. Buses can be **resized** horizontally when selected.
