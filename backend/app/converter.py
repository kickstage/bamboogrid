"""Convert an editor :class:`Network` document into a pandapower net and run
the load flow.

Validation is structural only: every element must reference an existing bus.
We deliberately do NOT require a slack/reference — a network that won't solve is
a valid thing to draw, and simply comes back as not-converged. Switches (closed)
and transformers merge their buses into one electrical island; an island with no
ext_grid or slack generator stays unsupplied (its bus results come back as None).
"""

from __future__ import annotations

import math
from collections import Counter

import pandapower as pp

from .schema import (
    BusResult,
    GenResult,
    LineResult,
    LoadFlowResult,
    LoadResult,
    Network,
    TrafoResult,
)


class ConversionError(ValueError):
    """Raised when the network document cannot be turned into a valid net."""


DEFAULT_TRAFO_STD = "0.25 MVA 20/0.4 kV"
DEFAULT_TRAFO3W_STD = "63/25/38 MVA 110/20/10 kV"

# Tap-changer fields forwarded verbatim to pandapower's *_from_parameters
# builders. Shared by 2W and 3W params (a None field means "no tap changer").
_TAP_FIELDS = (
    "tap_side",
    "tap_neutral",
    "tap_min",
    "tap_max",
    "tap_step_percent",
    "tap_step_degree",
    "tap_pos",
    "tap_changer_type",
)


def _tap_kwargs(params) -> dict:
    return {k: getattr(params, k) for k in _TAP_FIELDS}


def _is_wired(switch) -> bool:
    """A switch is electrically meaningful only when both ends are connected."""
    return bool(switch.bus_a) and bool(switch.bus_b)


def _island_roots(network: Network) -> dict[str, str]:
    """Union-find over buses: closed switches merge their two buses into one
    island. Returns a map bus_id -> island-root bus_id."""
    parent: dict[str, str] = {b.id: b.id for b in network.buses}

    def find(x: str) -> str:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: str, b: str) -> None:
        if a and b and a in parent and b in parent:
            parent[find(a)] = find(b)

    for sw in network.switches:
        if sw.closed and _is_wired(sw):
            union(sw.bus_a, sw.bus_b)
    # Transformers also connect their buses into one island.
    for t in network.transformers2w:
        union(t.hv_bus, t.lv_bus)
    for t in network.transformers3w:
        union(t.hv_bus, t.mv_bus)
        union(t.mv_bus, t.lv_bus)
    # Lines join their two buses into one island.
    for ln in network.lines:
        union(ln.from_bus, ln.to_bus)

    return {bus_id: find(bus_id) for bus_id in parent}


def validate(network: Network) -> None:
    """Structural checks only. We deliberately do NOT require a slack/reference:
    a net that won't solve is a valid thing to draw and explore — it simply
    comes back as not-converged. Unwired elements (no bus_id) are skipped."""
    bus_ids = {b.id for b in network.buses}

    for kind, items in (
        ("Generator", network.generators),
        ("Static generator", network.sgens),
        ("External grid", network.ext_grids),
        ("Load", network.loads),
        ("Shunt", network.shunts),
    ):
        for el in items:
            if el.bus_id and el.bus_id not in bus_ids:
                raise ConversionError(
                    f"{kind} '{el.name}' references unknown bus '{el.bus_id}'."
                )
    for sw in network.switches:
        for end in (sw.bus_a, sw.bus_b):
            if end and end not in bus_ids:
                raise ConversionError(
                    f"Switch '{sw.name}' references unknown bus '{end}'."
                )
    for t in network.transformers2w:
        for end in (t.hv_bus, t.lv_bus):
            if end and end not in bus_ids:
                raise ConversionError(
                    f"Transformer '{t.name}' references unknown bus '{end}'."
                )
    for t in network.transformers3w:
        for end in (t.hv_bus, t.mv_bus, t.lv_bus):
            if end and end not in bus_ids:
                raise ConversionError(
                    f"Transformer '{t.name}' references unknown bus '{end}'."
                )
    for ln in network.lines:
        for end in (ln.from_bus, ln.to_bus):
            if end and end not in bus_ids:
                raise ConversionError(
                    f"Line '{ln.name}' references unknown bus '{end}'."
                )


def build_net(network: Network):
    """Build a pandapower net. Returns ``(net, id_maps)`` where ``id_maps`` maps
    editor element ids to pandapower element indices, per element table."""
    validate(network)

    net = pp.create_empty_network(
        name=network.name, f_hz=network.f_hz, sn_mva=network.sn_mva
    )

    bus_index: dict[str, int] = {}
    for bus in network.buses:
        bus_index[bus.id] = pp.create_bus(net, vn_kv=bus.vn_kv, name=bus.name)

    # Generators are pandapower gens: PV by default, or a weighted slack when
    # marked. slack_weight sets the distributed-slack priority.
    gen_index: dict[str, int] = {}
    for gen in network.generators:
        if gen.bus_id not in bus_index:
            continue
        gen_index[gen.id] = pp.create_gen(
            net,
            bus=bus_index[gen.bus_id],
            p_mw=gen.p_mw,
            vm_pu=gen.vm_pu,
            name=gen.name,
            slack=gen.slack,
            slack_weight=gen.slack_weight,
        )

    # Static generators are pandapower sgens: a PQ injection, never a reference.
    sgen_index: dict[str, int] = {}
    for sg in network.sgens:
        if sg.bus_id not in bus_index:
            continue
        sgen_index[sg.id] = pp.create_sgen(
            net,
            bus=bus_index[sg.bus_id],
            p_mw=sg.p_mw,
            q_mvar=sg.q_mvar,
            name=sg.name,
        )

    # External grids are pandapower ext_grids: the slack/voltage reference.
    ext_grid_index: dict[str, int] = {}
    for eg in network.ext_grids:
        if eg.bus_id not in bus_index:
            continue
        ext_grid_index[eg.id] = pp.create_ext_grid(
            net,
            bus=bus_index[eg.bus_id],
            vm_pu=eg.vm_pu,
            va_degree=eg.va_degree,
            name=eg.name,
        )

    load_index: dict[str, int] = {}
    for load in network.loads:
        if load.bus_id not in bus_index:
            continue
        load_index[load.id] = pp.create_load(
            net,
            bus=bus_index[load.bus_id],
            p_mw=load.p_mw,
            q_mvar=load.q_mvar,
            name=load.name,
        )

    # Shunts: a fixed reactive/active device on one bus (capacitor/reactor).
    shunt_index: dict[str, int] = {}
    for sh in network.shunts:
        if sh.bus_id not in bus_index:
            continue
        kwargs = dict(q_mvar=sh.q_mvar, p_mw=sh.p_mw, step=sh.step, name=sh.name)
        if sh.vn_kv is not None:
            kwargs["vn_kv"] = sh.vn_kv
        shunt_index[sh.id] = pp.create_shunt(net, bus=bus_index[sh.bus_id], **kwargs)

    switch_index: dict[str, int] = {}
    for sw in network.switches:
        # Only fully-wired switches are electrically meaningful.
        if not _is_wired(sw):
            continue
        switch_index[sw.id] = pp.create_switch(
            net,
            bus=bus_index[sw.bus_a],
            element=bus_index[sw.bus_b],
            et="b",
            closed=sw.closed,
            name=sw.name,
        )

    # Transformers (only created when fully wired). Explicit ``params`` (captured
    # on import from a net with no recognized std_type) are built verbatim from
    # parameters; otherwise we build from the named std_type, falling back to a
    # default if the requested one isn't in the library.
    trafo_types = set(pp.available_std_types(net, "trafo").index)
    trafo3w_types = set(pp.available_std_types(net, "trafo3w").index)

    trafo_index: dict[str, int] = {}
    for t in network.transformers2w:
        if t.hv_bus not in bus_index or t.lv_bus not in bus_index:
            continue
        if t.params is not None:
            p = t.params
            trafo_index[t.id] = pp.create_transformer_from_parameters(
                net,
                hv_bus=bus_index[t.hv_bus],
                lv_bus=bus_index[t.lv_bus],
                sn_mva=p.sn_mva,
                vn_hv_kv=p.vn_hv_kv,
                vn_lv_kv=p.vn_lv_kv,
                vk_percent=p.vk_percent,
                vkr_percent=p.vkr_percent,
                pfe_kw=p.pfe_kw,
                i0_percent=p.i0_percent,
                shift_degree=p.shift_degree,
                name=t.name,
                **_tap_kwargs(p),
            )
            continue
        std = t.std_type if t.std_type in trafo_types else DEFAULT_TRAFO_STD
        trafo_index[t.id] = pp.create_transformer(
            net,
            hv_bus=bus_index[t.hv_bus],
            lv_bus=bus_index[t.lv_bus],
            std_type=std,
            name=t.name,
        )

    trafo3w_index: dict[str, int] = {}
    for t in network.transformers3w:
        if (
            t.hv_bus not in bus_index
            or t.mv_bus not in bus_index
            or t.lv_bus not in bus_index
        ):
            continue
        if t.params is not None:
            p = t.params
            trafo3w_index[t.id] = pp.create_transformer3w_from_parameters(
                net,
                hv_bus=bus_index[t.hv_bus],
                mv_bus=bus_index[t.mv_bus],
                lv_bus=bus_index[t.lv_bus],
                sn_hv_mva=p.sn_hv_mva,
                sn_mv_mva=p.sn_mv_mva,
                sn_lv_mva=p.sn_lv_mva,
                vn_hv_kv=p.vn_hv_kv,
                vn_mv_kv=p.vn_mv_kv,
                vn_lv_kv=p.vn_lv_kv,
                vk_hv_percent=p.vk_hv_percent,
                vk_mv_percent=p.vk_mv_percent,
                vk_lv_percent=p.vk_lv_percent,
                vkr_hv_percent=p.vkr_hv_percent,
                vkr_mv_percent=p.vkr_mv_percent,
                vkr_lv_percent=p.vkr_lv_percent,
                pfe_kw=p.pfe_kw,
                i0_percent=p.i0_percent,
                shift_mv_degree=p.shift_mv_degree,
                shift_lv_degree=p.shift_lv_degree,
                name=t.name,
                **_tap_kwargs(p),
            )
            continue
        std = t.std_type if t.std_type in trafo3w_types else DEFAULT_TRAFO3W_STD
        trafo3w_index[t.id] = pp.create_transformer3w(
            net,
            hv_bus=bus_index[t.hv_bus],
            mv_bus=bus_index[t.mv_bus],
            lv_bus=bus_index[t.lv_bus],
            std_type=std,
            name=t.name,
        )

    # Lines connect two buses at one voltage. Parameters are stored explicitly,
    # so we always build from parameters (no std_type lookup/fallback).
    line_index: dict[str, int] = {}
    for ln in network.lines:
        if ln.from_bus not in bus_index or ln.to_bus not in bus_index:
            continue
        line_index[ln.id] = pp.create_line_from_parameters(
            net,
            from_bus=bus_index[ln.from_bus],
            to_bus=bus_index[ln.to_bus],
            length_km=ln.length_km,
            r_ohm_per_km=ln.r_ohm_per_km,
            x_ohm_per_km=ln.x_ohm_per_km,
            c_nf_per_km=ln.c_nf_per_km,
            max_i_ka=ln.max_i_ka,
            name=ln.name,
        )

    id_maps = {
        "bus": bus_index,
        "gen": gen_index,
        "sgen": sgen_index,
        "ext_grid": ext_grid_index,
        "load": load_index,
        "shunt": shunt_index,
        "switch": switch_index,
        "trafo": trafo_index,
        "trafo3w": trafo3w_index,
        "line": line_index,
    }
    return net, id_maps


def run_load_flow(network: Network) -> LoadFlowResult:
    try:
        net, id_maps = build_net(network)
    except ConversionError as exc:
        return LoadFlowResult(converged=False, message=str(exc))

    # Distributed slack shares balancing across weighted slacks, but it trips on
    # degenerate single-node nets and isn't needed when each island has its own
    # single reference — only enable it when an island holds more than one slack.
    roots = _island_roots(network)
    slack_buses = [
        g.bus_id for g in network.generators if g.slack and g.bus_id in roots
    ]
    counts = Counter(roots[b] for b in slack_buses)
    distributed = any(c > 1 for c in counts.values())
    try:
        pp.runpp(net, distributed_slack=distributed)
    except pp.LoadflowNotConverged:
        return LoadFlowResult(
            converged=False, message="Load flow did not converge."
        )
    except Exception as exc:  # noqa: BLE001 - surface solver errors to the UI
        return LoadFlowResult(converged=False, message=f"Solver error: {exc}")

    # Unsupplied buses (e.g. an island with no slack) come back as NaN, which is
    # not valid JSON — map those to None.
    def _f(value) -> float | None:
        value = float(value)
        return None if math.isnan(value) else value

    res_bus = [
        BusResult(
            id=bus_id,
            vm_pu=_f(net.res_bus.at[idx, "vm_pu"]),
            va_degree=_f(net.res_bus.at[idx, "va_degree"]),
        )
        for bus_id, idx in id_maps["bus"].items()
    ]
    res_gen = [
        GenResult(
            id=gen_id,
            p_mw=_f(net.res_gen.at[idx, "p_mw"]),
            q_mvar=_f(net.res_gen.at[idx, "q_mvar"]),
        )
        for gen_id, idx in id_maps["gen"].items()
    ]
    res_sgen = [
        GenResult(
            id=sgen_id,
            p_mw=_f(net.res_sgen.at[idx, "p_mw"]),
            q_mvar=_f(net.res_sgen.at[idx, "q_mvar"]),
        )
        for sgen_id, idx in id_maps["sgen"].items()
    ]
    res_ext_grid = [
        GenResult(
            id=eg_id,
            p_mw=_f(net.res_ext_grid.at[idx, "p_mw"]),
            q_mvar=_f(net.res_ext_grid.at[idx, "q_mvar"]),
        )
        for eg_id, idx in id_maps["ext_grid"].items()
    ]
    res_load = [
        LoadResult(
            id=load_id,
            p_mw=_f(net.res_load.at[idx, "p_mw"]),
            q_mvar=_f(net.res_load.at[idx, "q_mvar"]),
        )
        for load_id, idx in id_maps["load"].items()
    ]
    res_trafo = [
        TrafoResult(
            id=tid,
            loading_percent=_f(net.res_trafo.at[idx, "loading_percent"]),
            p_mw=_f(net.res_trafo.at[idx, "p_hv_mw"]),
        )
        for tid, idx in id_maps["trafo"].items()
    ]
    res_trafo3w = [
        TrafoResult(
            id=tid,
            loading_percent=_f(net.res_trafo3w.at[idx, "loading_percent"]),
            p_mw=_f(net.res_trafo3w.at[idx, "p_hv_mw"]),
        )
        for tid, idx in id_maps["trafo3w"].items()
    ]
    res_line = [
        LineResult(
            id=lid,
            loading_percent=_f(net.res_line.at[idx, "loading_percent"]),
            p_mw=_f(net.res_line.at[idx, "p_from_mw"]),
        )
        for lid, idx in id_maps["line"].items()
    ]

    return LoadFlowResult(
        converged=True,
        res_bus=res_bus,
        res_gen=res_gen,
        res_sgen=res_sgen,
        res_ext_grid=res_ext_grid,
        res_load=res_load,
        res_trafo=res_trafo,
        res_trafo3w=res_trafo3w,
        res_line=res_line,
    )
