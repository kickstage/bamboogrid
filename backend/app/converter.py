"""Convert an editor :class:`Network` document into a pandapower net and run
the load flow.

Validation rules for iteration 1:
  * every generator/load must reference an existing bus;
  * every electrically-connected island must contain at least one generator
    (the slack), otherwise the load flow has no voltage reference. With no
    lines yet, each bus is its own island, so the rule simplifies to: every
    bus that carries a load needs a generator on it. We enforce the general
    "at least one generator overall on a bus that has load" pragmatically by
    requiring each load's bus to also host a generator.
"""

from __future__ import annotations

import math
from collections import Counter

import pandapower as pp

from .schema import (
    BusResult,
    LoadFlowResult,
    LoadResult,
    Network,
)


class ConversionError(ValueError):
    """Raised when the network document cannot be turned into a valid net."""


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

    for sw in network.switches:
        if sw.closed and _is_wired(sw) and sw.bus_a in parent and sw.bus_b in parent:
            parent[find(sw.bus_a)] = find(sw.bus_b)

    return {bus_id: find(bus_id) for bus_id in parent}


def validate(network: Network) -> None:
    """Structural checks only. We deliberately do NOT require a slack/reference:
    a net that won't solve is a valid thing to draw and explore — it simply
    comes back as not-converged. Unwired elements (no bus_id) are skipped."""
    bus_ids = {b.id for b in network.buses}

    for kind, items in (
        ("Generator", network.generators),
        ("Load", network.loads),
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


def build_net(network: Network):
    """Build a pandapower net. Returns ``(net, id_maps)`` where ``id_maps`` maps
    editor element ids to pandapower element indices, per element table."""
    validate(network)

    net = pp.create_empty_network(name=network.name)

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

    id_maps = {
        "bus": bus_index,
        "gen": gen_index,
        "load": load_index,
        "switch": switch_index,
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
    res_load = [
        LoadResult(
            id=load_id,
            p_mw=_f(net.res_load.at[idx, "p_mw"]),
            q_mvar=_f(net.res_load.at[idx, "q_mvar"]),
        )
        for load_id, idx in id_maps["load"].items()
    ]

    return LoadFlowResult(converged=True, res_bus=res_bus, res_load=res_load)
