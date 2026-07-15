"""Extract the bus admittance matrix (Y-bus) from the retained net.

pandapower never exposes a Y-bus of its own — it builds the case matrices on
``net._ppc`` when solving. We run the power flow to populate them, then rebuild
the full Y-bus with ``makeYbus`` and relabel its rows with editor bus
names/uuids so the frontend can render an educational heatmap linked to the
diagram.

We recompute with ``makeYbus`` rather than reading ``_ppc["internal"]["Ybus"]``
because pandapower collapses that solved-internal matrix to 0x0 for a lone slack
bus; ``makeYbus`` yields the honest NxN (including a 1x1 self-admittance) for
every network size.
"""

from __future__ import annotations

from pandapower.pypower.makeYbus import makeYbus

from .schema import YbusBus, YbusEntry, YbusResult
from .solve import _uuid_index, run_powerflow


def _bus_labels(net) -> dict[int, tuple[str | None, str, float]]:
    """pandapower bus index -> (editor uuid, display name, vn_kv)."""
    uuid_by_idx = {idx: uid for uid, idx in _uuid_index(net, "bus")}
    out: dict[int, tuple[str | None, str, float]] = {}
    for i in net.bus.index:
        name = net.bus.at[i, "name"]
        name = str(name) if name is not None and str(name) else f"Bus {int(i)}"
        out[int(i)] = (
            uuid_by_idx.get(int(i)),
            name,
            float(net.bus.at[i, "vn_kv"]),
        )
    return out


def compute_ybus(net) -> YbusResult:
    """Solve ``net`` and return its admittance matrix as labeled sparse triplets.

    The Y-bus depends only on topology and impedances, so it is returned even
    when the power flow does not converge (``converged`` then reports the solver
    message). Rows are ordered by pandapower's internal ppc index."""
    if len(net.bus) == 0:
        return YbusResult(
            converged=False,
            message="Add at least one bus to see its admittance matrix.",
            sn_mva=float(net.get("sn_mva") or 1.0),
        )

    err = run_powerflow(net)
    converged = err is None

    ppc = net.get("_ppc")
    lookups = net.get("_pd2ppc_lookups") or {}
    bus_lookup = lookups.get("bus")

    if ppc is None or ppc.get("bus") is None or bus_lookup is None:
        return YbusResult(
            converged=converged,
            message=err or "Admittance matrix unavailable.",
            sn_mva=float(net.get("sn_mva") or 1.0),
        )

    ybus, _, _ = makeYbus(ppc["baseMVA"], ppc["bus"], ppc["branch"])
    n = int(ybus.shape[0])
    labels = _bus_labels(net)

    # Group real buses by the ppc row they map to (closed bus-bus switches fuse
    # several buses onto one row). Rows with no real bus are pandapower's
    # internal nodes (e.g. a 3W transformer star point).
    rows: list[list[tuple[str | None, str, float]]] = [[] for _ in range(n)]
    represented = 0
    for i in net.bus.index:
        if "in_service" in net.bus.columns and not bool(net.bus.at[i, "in_service"]):
            continue
        row = int(bus_lookup[int(i)])
        if 0 <= row < n:
            rows[row].append(labels[int(i)])
            represented += 1

    buses: list[YbusBus] = []
    for members in rows:
        if members:
            buses.append(
                YbusBus(
                    ids=[uid for uid, _, _ in members if uid],
                    label=" + ".join(name for _, name, _ in members),
                    vn_kv=members[0][2],
                )
            )
        else:
            buses.append(YbusBus(ids=[], label="Internal node", vn_kv=None))

    coo = ybus.tocoo()
    entries = [
        YbusEntry(i=int(r), j=int(c), g=float(v.real), b=float(v.imag))
        for r, c, v in zip(coo.row, coo.col, coo.data)
    ]

    # A single branchless bus still has a valid 1x1 self-admittance (zero, or its
    # shunt admittance), so it renders like any other size. Only a truly empty
    # network has nothing to show.
    message = err or ""
    if not buses:
        message = "Add at least one bus to see its admittance matrix."

    return YbusResult(
        converged=converged,
        message=message,
        buses=buses,
        entries=entries,
        sn_mva=float(net.get("sn_mva") or 1.0),
        omitted_buses=int(len(net.bus)) - represented,
    )
