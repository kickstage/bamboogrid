"""Extract the measurement Jacobian H (∂h/∂x) from a state estimation.

Mirrors ybus.py: an educational matrix, keyed back to editor identities so the
frontend can render a heatmap linked to the diagram. Where Y-bus shows how buses
are electrically coupled, H shows how each *measurement* depends on the state —
the bus voltage angles and magnitudes the estimator solves for.

Rows are measurements, columns are states. The state vector pandapower solves is
``E = [δ(non-slack buses), |V|(all buses)]``, so the first columns are angles
(every bus except the reference) and the rest are magnitudes. H is a
linearization at the estimated state, and the WLS solver only retains it on a
successful solve — so this is available only after estimation converges.
"""

from __future__ import annotations

from collections import defaultdict

import numpy as np

from .estimation import (
    _estimate,
    disabled_measurement_indices,
    precondition_message,
)
from .schema import JacobianCol, JacobianEntry, JacobianResult, JacobianRow
from .solve import _uuid_index
from .ybus import _bus_labels


def _row_labels(net, pp_meas_indices: list[int]) -> list[JacobianRow]:
    """One JacobianRow per solver measurement row, in solver order. Each carries
    the measured element's editor uuid(s) for canvas highlighting."""
    meas = net.get("measurement")
    # element index -> editor uuid, per element table, so a measurement row can
    # point at the bus/line/transformer it sits on.
    uuid_by_elem: dict[str, dict[int, str]] = {}
    for etype in ("bus", "line", "trafo", "trafo3w"):
        uuid_by_elem[etype] = {idx: uid for uid, idx in _uuid_index(net, etype)}

    rows: list[JacobianRow] = []
    for i in pp_meas_indices:
        r = meas.loc[i]
        etype = str(r["element_type"])
        element = int(r["element"])
        mtype = str(r["measurement_type"])
        side = r["side"]
        side = str(side) if isinstance(side, str) and side else None
        name = (
            str(net[etype].at[element, "name"])
            if etype in net and element in net[etype].index
            else f"{etype} {element}"
        )
        label = f"{mtype.upper()} {name}" + (f" ({side})" if side else "")
        uid = uuid_by_elem.get(etype, {}).get(element)
        rows.append(
            JacobianRow(ids=[uid] if uid else [], label=label, meas_type=mtype)
        )
    return rows


def _col_labels(net, se) -> list[JacobianCol]:
    """One JacobianCol per state, in solver order: the non-slack bus angles first,
    then every bus magnitude. Columns are labeled and linked to editor buses via
    the same ppci→bus mapping ybus.py uses (internal nodes get empty ids)."""
    ep = se.solver.eppci
    non_slack = [int(b) for b in np.asarray(ep.non_slack_buses).ravel()]
    n_bus = int(ep["bus"].shape[0])
    labels = _bus_labels(net)  # pp bus index -> (uuid, name, vn_kv)
    lookups = net.get("_pd2ppc_lookups") or {}

    # ppci row -> the editor buses that map onto it (closed switches fuse several;
    # some rows are pandapower internal nodes with no editor bus).
    bus_lookup = lookups.get("bus")
    members: dict[int, list[int]] = defaultdict(list)
    if bus_lookup is not None:
        for pb in net.bus.index:
            row = int(bus_lookup[int(pb)])
            if 0 <= row < n_bus:
                members[row].append(int(pb))

    # Auxiliary (solver-internal) nodes with no drawn bus. The common one is a
    # 3-winding transformer's star point: pandapower models the 3W trafo as three
    # 2W trafos meeting at a hidden midpoint, which carries its own voltage state.
    # ``aux["trafo3w"][k]`` is the ppci bus for the k-th 3W transformer, so we can
    # name it after that transformer and link the column back to it.
    trafo3w_uuid = {idx: uid for uid, idx in _uuid_index(net, "trafo3w")}
    star: dict[int, tuple[list[str], str]] = {}
    aux3w = (lookups.get("aux") or {}).get("trafo3w")
    if aux3w is not None:
        for k, ppci_bus in enumerate(np.asarray(aux3w).ravel()):
            if k >= len(net.trafo3w.index):
                break
            t_idx = int(net.trafo3w.index[k])
            name = net.trafo3w.at[t_idx, "name"]
            name = str(name) if name is not None and str(name) else f"Trafo3W {t_idx}"
            uid = trafo3w_uuid.get(t_idx)
            star[int(ppci_bus)] = ([uid] if uid else [], f"{name} star point")

    def bus_label(ppci_row: int) -> tuple[list[str], str]:
        pbs = members.get(ppci_row, [])
        if not pbs:
            return star.get(ppci_row, ([], "internal node"))
        ids = [labels[pb][0] for pb in pbs if labels[pb][0]]
        name = " + ".join(labels[pb][1] for pb in pbs)
        return ids, name

    cols: list[JacobianCol] = []
    for ppci_row in non_slack:
        ids, name = bus_label(ppci_row)
        cols.append(JacobianCol(ids=ids, label=f"∠ {name}", kind="angle"))
    for ppci_row in range(n_bus):
        ids, name = bus_label(ppci_row)
        cols.append(JacobianCol(ids=ids, label=f"|V| {name}", kind="magnitude"))
    return cols


def _build_jacobian(net, se) -> JacobianResult:
    h = np.asarray(se.solver.H, dtype=float)
    if h.ndim != 2:
        return JacobianResult(
            ok=False, message="The Jacobian is unavailable for this solve."
        )
    pp_meas_indices = [int(i) for i in np.asarray(se.solver.pp_meas_indices).ravel()]

    rows = _row_labels(net, pp_meas_indices)
    cols = _col_labels(net, se)
    # Guard against any length drift between the solver matrices and our labels.
    n_rows = min(h.shape[0], len(rows))
    n_cols = min(h.shape[1], len(cols))

    # Emit only the non-zero cells: numpy locates them in C, so the Python loop
    # runs once per non-zero rather than over the full (dense) rows×cols grid.
    sub = h[:n_rows, :n_cols]
    rs, cs = np.nonzero(sub)
    vals = sub[rs, cs]
    entries = [
        JacobianEntry(i=int(r), j=int(c), value=float(v))
        for r, c, v in zip(rs.tolist(), cs.tolist(), vals.tolist())
    ]
    return JacobianResult(
        ok=True, rows=rows[:n_rows], cols=cols[:n_cols], entries=entries
    )


def compute_jacobian(net) -> JacobianResult:
    """Run the estimator and return its measurement Jacobian, or an explanatory
    message when estimation can't run or doesn't converge."""
    msg = precondition_message(net)
    if msg:
        return JacobianResult(ok=False, message=msg)

    meas = net.get("measurement")
    disabled = disabled_measurement_indices(net, meas)
    if disabled and len(disabled) == len(meas):
        return JacobianResult(
            ok=False,
            message="Every measurement is turned off. Enable at least one to see "
            "the Jacobian.",
        )

    full_meas = meas.copy()
    if disabled:
        net["measurement"] = meas.drop(disabled)
    try:
        try:
            se, success = _estimate(net)
        except Exception as exc:  # noqa: BLE001 - surface estimator errors to the UI
            return JacobianResult(ok=False, message=f"Estimation error: {exc}")
        # The WLS solver keeps H only on a converged solve.
        if not success or se.solver.H is None:
            return JacobianResult(
                ok=False,
                message="State estimation did not converge, so there is no "
                "Jacobian to show. Check that the network is observable and the "
                "measured values are consistent.",
            )
        return _build_jacobian(net, se)
    finally:
        net["measurement"] = full_meas
