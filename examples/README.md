# Example networks

These are pandapower JSON files you can load with **Import → pandapower** in the
editor. The three numbered examples are a guided tour: each one introduces a few
element types, building from a single bus up to a full substation. Import one,
press **Run load flow**, and read the solved values on the canvas.

The remaining files (`case9`, `case30`, `cgmes_*`, `example_simple`) are larger
reference networks for stress-testing import and layout.

## The elements at a glance

| Element | pandapower | What it does |
| --- | --- | --- |
| **Bus bar** | `bus` | A node at a fixed nominal voltage (kV). Everything attaches to a bus. |
| **External grid** | `ext_grid` | The **slack / reference**. Holds its bus at a set voltage and *balances* the network — it supplies (or absorbs) whatever power is left over. A solvable network needs at least one reference per island. |
| **Generator** | `gen` | A **PV** unit: you set its active power **and** the voltage it holds at its bus; its reactive power is solved. Not a reference on its own. |
| **Static generator** | `sgen` | A **PQ** injection (rooftop PV, wind, battery feed-in): you set active **and** reactive power; it does not control voltage. |
| **Load** | `load` | Consumes a fixed P and Q. |
| **Switch** | `switch` (`et="b"`) | Ties two buses. **Closed** = one electrical node; **open** = separated. |
| **Transformer** | `trafo` | 2-winding, connects an HV and an LV bus (parameters from a standard type). |
| **3W transformer** | `trafo3w` | 3-winding, connects HV / MV / LV buses. |

A handy way to think about the three "sources": **external grid** sets voltage
*and* balances the network, a **generator** sets voltage but only its scheduled
power, and a **static generator** just injects a fixed amount of power.

---

## 01 — External grid, load, static generator
`01_extgrid_load_sgen.pp.json`

One 20 kV bus connected to the **external grid**, with a 3 MW town **load** and a
1 MW rooftop-PV **static generator**.

- The external grid holds the bus at 1.0 p.u. and supplies the *net* demand:
  **3 MW load − 1 MW PV = 2 MW** imported (Q = 1 MVar).
- Edit the PV's active power and re-run: the imported power moves one-for-one.
  Set the PV above the load and the external grid goes **negative** — the bus now
  exports back to the grid.

**Teaches:** external grid as slack/balancer, load, sgen as fixed injection.

## 02 — Transformer and dispatchable generator
`02_transformer_generator.pp.json`

The external grid feeds a 110 kV bus; a **2-winding transformer** (`25 MVA
110/20 kV`) steps down to a 20 kV bus carrying a 10 MW **load**, a 4 MW **generator**
(a CHP plant), and a 2 MW solar **static generator**.

- The **generator** is a PV node: it pins the 20 kV bus to 1.0 p.u. and injects
  its scheduled 4 MW, while its **reactive power is solved** (~3.2 MVar here) to
  hold that voltage — contrast this with the sgen, whose Q stays fixed at 0.
- Local generation (4 + 2 = 6 MW) covers most of the 10 MW load; the external
  grid imports only the remaining ~4 MW through the transformer.
- The transformer shows its **loading %** — try raising the load to push it up.

**Teaches:** 2-winding transformer + voltage levels, generator (PV) vs static
generator (PQ), local generation reducing grid import.

## 03 — Substation with a 3W transformer and a bus coupler
`03_substation_3w_switch.pp.json`

A 110 kV grid connection feeds a **3-winding transformer** (`63/25/38 MVA
110/20/10 kV`) supplying a 20 kV (MV) and a 10 kV (LV) level. Two MV busbars
(A and B) are joined by a closed **switch** (a bus coupler), with district loads,
a rail-supply load on LV, and a 3 MW wind **static generator** on MV bus A.

- The closed switch makes MV bus A and B a single node — they solve to the
  **same voltage** (~0.982 p.u.). Open it (select the switch, untick *Closed*)
  and bus B becomes its own island with no source → it goes unsupplied.
- The 3W transformer carries power to both the MV and LV levels at once; watch
  its loading and the voltage drop down each winding.

**Teaches:** 3-winding transformer across three voltage levels, bus-coupler
switch (and what "island with no reference" looks like).

---

### Regenerating these files

They are produced by `generate_examples.py`. Run it from the backend so the
`app` package and pandapower are importable:

```bash
cd backend
.venv/bin/python ../examples/generate_examples.py
```

Each is a plain pandapower net (no editor layout tables), so the editor lays it
out automatically on import.
