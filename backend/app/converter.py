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

import pandapower as pp

from .schema import (
    BusResult,
    LoadFlowResult,
    LoadResult,
    Network,
)


class ConversionError(ValueError):
    """Raised when the network document cannot be turned into a valid net."""


def validate(network: Network) -> None:
    bus_ids = {b.id for b in network.buses}

    for gen in network.generators:
        if gen.bus_id not in bus_ids:
            raise ConversionError(
                f"Generator '{gen.name}' references unknown bus '{gen.bus_id}'."
            )
    for load in network.loads:
        if load.bus_id not in bus_ids:
            raise ConversionError(
                f"Load '{load.name}' references unknown bus '{load.bus_id}'."
            )

    # Each island (a single bus, since there are no lines yet) that carries a
    # load needs a generator/slack on it for the load flow to have a reference.
    buses_with_gen = {g.bus_id for g in network.generators}
    for load in network.loads:
        if load.bus_id not in buses_with_gen:
            raise ConversionError(
                f"Bus hosting load '{load.name}' has no generator (slack); "
                "the load flow has no voltage reference."
            )


def build_net(network: Network):
    """Build a pandapower net. Returns ``(net, id_maps)`` where ``id_maps`` maps
    editor element ids to pandapower element indices, per element table."""
    validate(network)

    net = pp.create_empty_network(name=network.name)

    bus_index: dict[str, int] = {}
    for bus in network.buses:
        bus_index[bus.id] = pp.create_bus(net, vn_kv=bus.vn_kv, name=bus.name)

    gen_index: dict[str, int] = {}
    for gen in network.generators:
        # Mapped to an external grid (slack) for iteration 1.
        gen_index[gen.id] = pp.create_ext_grid(
            net, bus=bus_index[gen.bus_id], vm_pu=gen.vm_pu, name=gen.name
        )

    load_index: dict[str, int] = {}
    for load in network.loads:
        load_index[load.id] = pp.create_load(
            net,
            bus=bus_index[load.bus_id],
            p_mw=load.p_mw,
            q_mvar=load.q_mvar,
            name=load.name,
        )

    id_maps = {"bus": bus_index, "ext_grid": gen_index, "load": load_index}
    return net, id_maps


def run_load_flow(network: Network) -> LoadFlowResult:
    try:
        net, id_maps = build_net(network)
    except ConversionError as exc:
        return LoadFlowResult(converged=False, message=str(exc))

    try:
        pp.runpp(net)
    except pp.LoadflowNotConverged:
        return LoadFlowResult(
            converged=False, message="Load flow did not converge."
        )
    except Exception as exc:  # noqa: BLE001 - surface solver errors to the UI
        return LoadFlowResult(converged=False, message=f"Solver error: {exc}")

    res_bus = [
        BusResult(
            id=bus_id,
            vm_pu=float(net.res_bus.at[idx, "vm_pu"]),
            va_degree=float(net.res_bus.at[idx, "va_degree"]),
        )
        for bus_id, idx in id_maps["bus"].items()
    ]
    res_load = [
        LoadResult(
            id=load_id,
            p_mw=float(net.res_load.at[idx, "p_mw"]),
            q_mvar=float(net.res_load.at[idx, "q_mvar"]),
        )
        for load_id, idx in id_maps["load"].items()
    ]

    return LoadFlowResult(converged=True, res_bus=res_bus, res_load=res_load)
