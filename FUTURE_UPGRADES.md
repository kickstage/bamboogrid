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
