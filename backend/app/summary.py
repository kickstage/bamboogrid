"""Compute a post-solve overview of the authoritative session net.

Runs the same power flow as the load-flow API (results land on ``net.res_*``),
then derives system totals, voltage/loading extremes and element counts, and
runs pandapower's own ``diagnostic`` on a copy so its checks never mutate the
session net.
"""

from __future__ import annotations

import copy
import math

import pandapower as pp

from .projection import net_to_view
from .schema import (
    Counts,
    Diagnostic,
    DiagnosticElement,
    Extreme,
    NetworkSummary,
    PowerBalance,
)
from .solve import run_powerflow

# pandapower diagnostic checks treated as errors; everything else is a warning.
_ERROR_CHECKS = {
    "no_ext_grid",
    "disconnected_elements",
    "wrong_reference_system",
    "invalid_values",
    "overload",
    "wrong_switch_configuration",
}

# pandapower element table -> editor element kind (modeled tables only).
_TABLE_KIND = {
    "bus": "bus",
    "gen": "generator",
    "sgen": "sgen",
    "ext_grid": "extgrid",
    "load": "load",
    "shunt": "shunt",
    "switch": "switch",
    "trafo": "trafo2w",
    "trafo3w": "trafo3w",
    "line": "line",
}

# Plural / aliased keys pandapower's diagnostic uses for element-index lists,
# mapped to their table (e.g. {"lines": [...]}, "buses_with_gens..." : [...]).
_KEY_ALIASES = {
    "buses": "bus",
    "lines": "line",
    "trafos": "trafo",
    "trafos3w": "trafo3w",
    "loads": "load",
    "gens": "gen",
    "sgens": "sgen",
    "switches": "switch",
    "shunts": "shunt",
    "ext_grids": "ext_grid",
}


def _table_for_key(key: str) -> str | None:
    """The element table a diagnostic dict key addresses, if any — by exact name,
    known alias, or alias prefix (e.g. ``buses_with_gens_and_ext_grids``)."""
    if key in _TABLE_KIND:
        return key
    if key in _KEY_ALIASES:
        return _KEY_ALIASES[key]
    for alias, table in _KEY_ALIASES.items():
        if key.startswith(alias + "_"):
            return table
    return None


def _resolve_element(net, table: str, index: int) -> DiagnosticElement | None:
    kind = _TABLE_KIND.get(table)
    diag = net.get(f"diagram_{table}")
    if kind and diag is not None and index in diag.index:
        return DiagnosticElement(
            id=str(diag.at[index, "uuid"]), kind=kind, label=_name(net, table, index)
        )
    # An unmodeled (foreign) element: id matches ForeignElement ("table:index").
    frame = net.get(table)
    if frame is not None and hasattr(frame, "index") and index in frame.index:
        return DiagnosticElement(
            id=f"{table}:{index}", kind="foreign", label=_name(net, table, index)
        )
    return None


def _diagnostic_elements(net, value) -> list[DiagnosticElement]:
    """Walk a diagnostic's (heterogeneous) value, mapping every ``table -> index``
    reference it carries to a selectable editor element."""
    out: list[DiagnosticElement] = []
    seen: set[str] = set()

    def add(table: str, index) -> None:
        if isinstance(index, bool) or not isinstance(index, int):
            return
        el = _resolve_element(net, table, int(index))
        if el is not None and el.id not in seen:
            seen.add(el.id)
            out.append(el)

    def visit(node, table: str | None) -> None:
        if isinstance(node, dict):
            for k, v in node.items():
                visit(v, _table_for_key(k) if isinstance(k, str) else table)
        elif isinstance(node, (list, tuple, set)):
            for item in node:
                visit(item, table)
        elif table is not None:
            add(table, node)

    visit(value, None)
    return out


def _sum(series) -> float:
    total = float(series.sum()) if len(series) else 0.0
    return 0.0 if math.isnan(total) else total


def _name(net, table: str, idx) -> str:
    try:
        name = net[table].at[idx, "name"]
    except Exception:  # noqa: BLE001
        name = None
    if name is None or (isinstance(name, float) and math.isnan(name)):
        return f"{table} {idx}"
    return str(name)


def _counts(net) -> Counts:
    return Counts(
        buses=len(net.bus),
        lines=len(net.line),
        transformers=len(net.trafo) + len(net.trafo3w),
        loads=len(net.load),
        generators=len(net.gen) + len(net.sgen) + len(net.ext_grid),
        switches=len(net.switch),
        shunts=len(net.shunt),
        foreign=len(net_to_view(net).foreign),
        **_topology(net),
    )


def _topology(net) -> dict[str, int]:
    islands = 0
    try:
        from pandapower.topology import connected_components, create_nxgraph

        graph = create_nxgraph(net, respect_switches=True)
        islands = sum(1 for _ in connected_components(graph))
    except Exception:  # noqa: BLE001 - topology unavailable
        islands = 0
    unsupplied = 0
    if "res_bus" in net and len(net.res_bus):
        in_service = net.bus.index[net.bus["in_service"]]
        for idx in in_service:
            if idx in net.res_bus.index and math.isnan(net.res_bus.at[idx, "vm_pu"]):
                unsupplied += 1
    return {"islands": islands, "unsupplied_buses": unsupplied}


def _extreme_voltage(net, *, lowest: bool) -> Extreme | None:
    vm = net.res_bus["vm_pu"].dropna()
    if vm.empty:
        return None
    idx = vm.idxmin() if lowest else vm.idxmax()
    return Extreme(value=float(vm.at[idx]), label=_name(net, "bus", idx))


def _max_loading(net, table: str) -> Extreme | None:
    res = net.get(f"res_{table}")
    if res is None or "loading_percent" not in res.columns:
        return None
    loading = res["loading_percent"].dropna()
    if loading.empty:
        return None
    idx = loading.idxmax()
    return Extreme(value=float(loading.at[idx]), label=_name(net, table, idx))


def _balance(net) -> PowerBalance:
    gen_p = _sum(net.res_ext_grid["p_mw"]) + _sum(net.res_gen["p_mw"]) + _sum(
        net.res_sgen["p_mw"]
    )
    gen_q = _sum(net.res_ext_grid["q_mvar"]) + _sum(net.res_gen["q_mvar"]) + _sum(
        net.res_sgen["q_mvar"]
    )
    load_p = _sum(net.res_load["p_mw"])
    load_q = _sum(net.res_load["q_mvar"])
    return PowerBalance(
        gen_p_mw=gen_p,
        gen_q_mvar=gen_q,
        load_p_mw=load_p,
        load_q_mvar=load_q,
        loss_p_mw=gen_p - load_p,
        loss_q_mvar=gen_q - load_q,
    )


def _diagnostics(net) -> list[Diagnostic]:
    try:
        result = pp.diagnostic(copy.deepcopy(net), report_style=None)
    except Exception as exc:  # noqa: BLE001 - never let diagnostics break the summary
        return [Diagnostic(check="Diagnostic failed", detail=str(exc), severity="info")]
    findings: list[Diagnostic] = []
    for check, value in (result or {}).items():
        if not value:
            continue
        detail = str(value)
        if len(detail) > 240:
            detail = detail[:237] + "..."
        findings.append(
            Diagnostic(
                check=check.replace("_", " ").capitalize(),
                detail=detail,
                severity="error" if check in _ERROR_CHECKS else "warning",
                elements=_diagnostic_elements(net, value),
            )
        )
    return findings


def network_summary(net) -> NetworkSummary:
    err = run_powerflow(net)
    counts = _counts(net)
    diagnostics = _diagnostics(net)
    if err is not None:
        return NetworkSummary(
            converged=False, message=err, counts=counts, diagnostics=diagnostics
        )
    return NetworkSummary(
        converged=True,
        counts=counts,
        diagnostics=diagnostics,
        balance=_balance(net),
        min_voltage=_extreme_voltage(net, lowest=True),
        max_voltage=_extreme_voltage(net, lowest=False),
        max_line_loading=_max_loading(net, "line"),
        max_trafo_loading=_max_loading(net, "trafo"),
    )
