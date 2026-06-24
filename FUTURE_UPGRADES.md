# Future upgrades

Planned improvements, with enough context and a sketch of the approach to pick
up later. Newest ideas at the top.

---

## 1. Transformer "Advanced parameters" expander

### Why

Transformers are authored from a named `std_type` (a catalog entry), while
transformers **imported** from a foreign net carry explicit electrical
parameters (`Trafo2WParams` / `Trafo3WParams`). That split exists because
transformer parameters (`vk_percent`, `vkr_percent`, `pfe_kw`, `i0_percent`, …)
are datasheet values most users don't know off-hand, so a library type is the
friendly default. But it leaves two awkward gaps:

- An imported (custom-params) transformer **can't be fine-tuned** in the editor —
  the only action is "replace it with a standard type", which discards the
  imported values.
- The two modes (`std_type` *xor* `params`) require branching in the solver
  (`build_net`) and a slightly confusing inspector ("Custom (imported)").

### What

Make every transformer ultimately described by **parameters**, with `std_type`
demoted to a *preset that fills them*:

1. Inspector shows the `std_type` picker (as now) **plus an "Advanced" expander**
   with editable `NumberInput`s for each parameter (`sn_mva`, `vn_hv_kv`,
   `vn_lv_kv`, `vk_percent`, `vkr_percent`, `pfe_kw`, `i0_percent`,
   `shift_degree`; the 3W analogues for `trafo3w`).
2. Picking a `std_type` **fills** the params from that catalog entry. Editing any
   field marks the transformer "custom" (clears the active `std_type` label).
   This is the same gesture for an imported transformer and a hand-built one —
   the "imported" case just starts pre-filled.
3. The solver always builds from params, so `build_net` loses its
   `if params … else std_type …` branch.

### Files

- `backend/app/converter.py` — build transformers from params unconditionally.
- `backend/app/schema.py` — params become the canonical fields; `std_type`
  optional preset label.
- `frontend/src/inspector/Inspector.tsx` — add the `<Accordion>`/expander with
  the param `NumberInput`s (mirror the line inspector's param fields).
- `frontend/src/types.ts` — `Trafo2WData` / `Trafo3WData` already carry `params`.

### The one piece of new infrastructure

To **fill params when a `std_type` is picked**, the frontend needs that type's
values, which live in pandapower on the backend. Add a small endpoint, e.g.
`GET /std-types/trafo` and `/std-types/trafo3w`, returning each library type's
parameter set (`pp.available_std_types(net, "trafo")`). The inspector calls it
(once, cached) to expand a chosen type into editable params.

### Done when

- Selecting a standard type populates the advanced fields; editing a field keeps
  the change and is preserved through save/run/export.
- An imported transformer's parameters are visible and editable, not just
  replaceable.

---

## 2. Tap-changer (off-nominal ratio) support

### Why

`Trafo2WParams` / `Trafo3WParams` capture the core electrical parameters but
**not the tap changer** (`tap_side`, `tap_pos`, `tap_neutral`, `tap_min`,
`tap_max`, `tap_step_percent`, `tap_step_degree`, `tap_changer_type`). Many real
transformers regulate voltage by tapping, so today:

- An imported net whose transformers use taps (e.g. **IEEE14**, whose three
  135 kV transformers sit at `tap_pos = -1`) converges but solves to **slightly
  different voltages than the source** (~1–2% on the transformer-fed buses).
- This is the open item behind the deferred *faithful transformer round-trip*
  work — adding taps is what closes that gap so the editor reproduces a source
  net's solution exactly.

### What

1. Add the tap fields to `Trafo2WParams` / `Trafo3WParams` (nullable; `None`
   means "no tap changer").
2. Capture them on import in `ppjson.py` (`_trafo2w_params` / `_trafo3w_params`),
   handling `NaN → None` for the optional numeric fields and the string
   `tap_side` / `tap_changer_type`.
3. Pass them through `create_transformer_from_parameters` in `converter.py`.
4. Surface tap controls in the transformer **Advanced expander** (item 1): tap
   side (HV/LV), position, neutral, step %, and min/max range.

### Files

- `backend/app/schema.py` — tap fields on the params models.
- `backend/app/ppjson.py` — capture them (NaN-safe) on import; they already
  round-trip through the standard pandapower `trafo` table on export.
- `backend/app/converter.py` — forward the tap kwargs when building.
- `frontend/src/inspector/Inspector.tsx` — tap UI inside the expander.

### Verify

- Re-import `examples/IEEE14.pp.json`, run load flow, and compare bus voltages
  against `pandapower.networks.case14()` solved directly — they should now match
  to solver tolerance (was ~1–2% off on transformer-fed buses).
- Round-trip (export → re-import) preserves tap settings.

### Note from earlier investigation

When this was first attempted, capturing every visible tap column still left a
small mismatch until `tap_changer_type` (`"Ratio"`) was also carried — that
column defaults differently between a JSON-loaded transformer and one built via
`create_transformer_from_parameters`. Capture it explicitly.
