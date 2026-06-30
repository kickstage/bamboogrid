"""Run a load flow on the authoritative session net.

Solves the retained net in place — so elements and attributes the editor doesn't
model still influence the result. Results are keyed back to the editor by the
stable uuids carried in the diagram_* tables.
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
    LoadFlowSettings,
    LoadResult,
    TrafoResult,
)


def _f(value) -> float | None:
    """A result cell as JSON-safe float (NaN, e.g. an unsupplied bus, -> None)."""
    if value is None:
        return None
    value = float(value)
    return None if math.isnan(value) else value


def _uuid_index(net, table: str) -> list[tuple[str, int]]:
    """(uuid, pandapower index) pairs for a modeled table, from its diagram_*
    layout table, skipping rows the net no longer has."""
    d = net.get(f"diagram_{table}")
    if d is None:
        return []
    present = set(net[table].index)
    return [
        (str(d.at[i, "uuid"]), int(i)) for i in d.index if int(i) in present
    ]


def _use_distributed_slack(net) -> bool:
    """Distributed slack shares balancing across weighted slacks, but it trips on
    degenerate single-node nets and isn't needed when each island has its own
    single reference — only enable it when one connected island holds more than
    one slack generator."""
    if "slack" not in net.gen.columns:
        return False
    slack_gens = [i for i in net.gen.index if bool(net.gen.at[i, "slack"])]
    if len(slack_gens) <= 1:
        return False
    try:
        from pandapower.topology import connected_components, create_nxgraph

        graph = create_nxgraph(net, respect_switches=True)
        bus_island: dict[int, int] = {}
        for island, buses in enumerate(connected_components(graph)):
            for b in buses:
                bus_island[int(b)] = island
    except Exception:  # noqa: BLE001 - topology unavailable -> assume one island
        return True
    counts = Counter(
        bus_island.get(int(net.gen.at[i, "bus"])) for i in slack_gens
    )
    return any(c > 1 for c in counts.values())


# The runpp options the editor exposes, in the order they appear in the UI. Kept
# here so the read/write helpers stay in sync with the settings model.
_SETTING_KEYS = (
    "algorithm",
    "init",
    "tolerance_mva",
    "calculate_voltage_angles",
    "trafo_model",
    "trafo_loading",
    "enforce_q_lims",
    "enforce_p_lims",
    "voltage_depend_loads",
    "consider_line_temperature",
    "line_temperature_degree_celsius",
    "check_connectivity",
)


def get_loadflow_settings(net) -> LoadFlowSettings:
    """Read the session's load-flow settings from the net's ``user_pf_options``,
    falling back to the model defaults (which mirror pandapower's) for anything
    not set."""
    opts = net.get("user_pf_options") or {}
    fields = {k: opts[k] for k in _SETTING_KEYS if k in opts}
    # ``max_iteration`` is "auto" (or absent) unless an explicit integer is stored.
    max_iter = opts.get("max_iteration")
    if isinstance(max_iter, bool) or not isinstance(max_iter, int):
        max_iter = None
    return LoadFlowSettings(max_iteration=max_iter, **fields)


def set_loadflow_settings(net, settings: LoadFlowSettings) -> None:
    """Persist the session's load-flow settings onto the net as pandapower
    ``user_pf_options`` so ``runpp`` picks them up. Preserves any options we don't
    model (e.g. an imported net's own settings) while overwriting the ones we do."""
    opts = dict(net.get("user_pf_options") or {})
    for key in _SETTING_KEYS:
        opts[key] = getattr(settings, key)
    if settings.max_iteration is None:
        opts.pop("max_iteration", None)
    else:
        opts["max_iteration"] = settings.max_iteration
    pp.set_user_pf_options(net, overwrite=True, **opts)


def _apply_line_temperature(net) -> None:
    """When line-temperature correction is enabled, stamp the configured ambient
    temperature onto every line so ``runpp`` has the column it requires. The editor
    models one global temperature, so this overwrites any per-line values."""
    opts = net.get("user_pf_options") or {}
    if not opts.get("consider_line_temperature") or len(net.line) == 0:
        return
    temp = opts.get("line_temperature_degree_celsius", 20.0)
    net.line["temperature_degree_celsius"] = float(temp)


def run_powerflow(net) -> str | None:
    """Run an AC power flow on ``net`` in place. Returns ``None`` on success or a
    human-readable error message (used by both the load-flow and summary APIs)."""
    try:
        _apply_line_temperature(net)
        pp.runpp(net, distributed_slack=_use_distributed_slack(net))
        return None
    except pp.LoadflowNotConverged:
        return "Load flow did not converge."
    except Exception as exc:  # noqa: BLE001 - surface solver errors to the UI
        return f"Solver error: {exc}"


def solve_net(net) -> LoadFlowResult:
    err = run_powerflow(net)
    if err is not None:
        return LoadFlowResult(converged=False, message=err)

    def _gen_like(table: str) -> list[GenResult]:
        res = net[f"res_{table}"]
        return [
            GenResult(
                id=uid,
                p_mw=_f(res.at[idx, "p_mw"]),
                q_mvar=_f(res.at[idx, "q_mvar"]),
            )
            for uid, idx in _uuid_index(net, table)
        ]

    def _load_like(table: str) -> list[LoadResult]:
        res = net[f"res_{table}"]
        return [
            LoadResult(
                id=uid,
                p_mw=_f(res.at[idx, "p_mw"]),
                q_mvar=_f(res.at[idx, "q_mvar"]),
            )
            for uid, idx in _uuid_index(net, table)
        ]

    def _trafo_like(table: str) -> list[TrafoResult]:
        res = net[f"res_{table}"]
        return [
            TrafoResult(
                id=uid,
                loading_percent=_f(res.at[idx, "loading_percent"]),
                p_mw=_f(res.at[idx, "p_hv_mw"]),
                q_mvar=_f(res.at[idx, "q_hv_mvar"]),
            )
            for uid, idx in _uuid_index(net, table)
        ]

    res_bus = [
        BusResult(
            id=uid,
            vm_pu=_f(net.res_bus.at[idx, "vm_pu"]),
            va_degree=_f(net.res_bus.at[idx, "va_degree"]),
        )
        for uid, idx in _uuid_index(net, "bus")
    ]
    res_line = [
        LineResult(
            id=uid,
            loading_percent=_f(net.res_line.at[idx, "loading_percent"]),
            p_mw=_f(net.res_line.at[idx, "p_from_mw"]),
            q_mvar=_f(net.res_line.at[idx, "q_from_mvar"]),
            i_ka=_f(net.res_line.at[idx, "i_ka"]),
        )
        for uid, idx in _uuid_index(net, "line")
    ]

    return LoadFlowResult(
        converged=True,
        res_bus=res_bus,
        res_gen=_gen_like("gen"),
        res_sgen=_gen_like("sgen"),
        res_ext_grid=_gen_like("ext_grid"),
        res_load=_load_like("load"),
        res_shunt=_load_like("shunt"),
        res_xward=_load_like("xward"),
        res_trafo=_trafo_like("trafo"),
        res_trafo3w=_trafo_like("trafo3w"),
        res_line=res_line,
    )
