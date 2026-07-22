"""Run an IEC 60909 three-phase (max-case) short circuit on the session net.

Mirrors solve.py: the retained net is faulted in place and per-bus results are
keyed back to the editor by the uuids carried in the diagram_* tables. Source
machine data (ext_grid fault level, generator subtransient reactance) is
backfilled with defaults so imported nets — which carry none — still solve.
"""

from __future__ import annotations

import pandas as pd

from .schema import BusScResult, ShortCircuitResult, ShortCircuitSettings
from .solve import _f, _uuid_index


def get_sc_settings(net) -> ShortCircuitSettings:
    """Read the session's short-circuit settings from ``user_sc_options`` (a plain
    dict on the net), falling back to the model defaults for anything not set."""
    opts = net.get("user_sc_options") or {}
    fields = ShortCircuitSettings.model_fields
    return ShortCircuitSettings(**{k: opts[k] for k in fields if k in opts})


def set_sc_settings(net, settings: ShortCircuitSettings) -> None:
    """Persist the session's short-circuit settings onto the net so the next short
    circuit uses them and they round-trip with export and sharing."""
    net["user_sc_options"] = settings.model_dump()

# Defaults matching the schema, used to backfill nets that lack the columns
# (e.g. anything imported from a pandapower JSON without SC data). Min-case columns
# fall back to the max-case values so the minimum case is runnable for nets that
# carry no separate min data; calc_sc still applies the lower voltage factor, so
# minimum currents come out below the maximum case.
_EXT_GRID_DEFAULTS = {
    "s_sc_max_mva": 1000.0,
    "rx_max": 0.1,
    "s_sc_min_mva": 1000.0,
    "rx_min": 0.1,
}
_GEN_DEFAULTS = {"sn_mva": 1.0, "xdss_pu": 0.2, "cos_phi": 0.8}
# Generator R/X for deriving rdss_ohm when absent.
_GEN_RX = 0.1


def _backfill(df: pd.DataFrame, defaults: dict[str, float]) -> None:
    """Ensure each column exists and has no missing values, in place."""
    for col, default in defaults.items():
        if col not in df.columns:
            df[col] = default
        else:
            df[col] = df[col].fillna(default)


def _prepare(net) -> None:
    """Backfill the source machine data calc_sc requires (max case)."""
    if not net.ext_grid.empty:
        _backfill(net.ext_grid, _EXT_GRID_DEFAULTS)
    if not net.gen.empty:
        _backfill(net.gen, _GEN_DEFAULTS)
        if "vn_kv" not in net.gen.columns:
            net.gen["vn_kv"] = float("nan")
        # Rated voltage follows the connected bus; subtransient resistance is
        # derived from xdss when the user/import didn't supply it.
        for i in net.gen.index:
            if pd.isna(net.gen.at[i, "vn_kv"]):
                bus = int(net.gen.at[i, "bus"])
                net.gen.at[i, "vn_kv"] = float(net.bus.at[bus, "vn_kv"])
        if "rdss_ohm" not in net.gen.columns:
            net.gen["rdss_ohm"] = float("nan")
        for i in net.gen.index:
            if pd.isna(net.gen.at[i, "rdss_ohm"]):
                vn = float(net.gen.at[i, "vn_kv"])
                sn = float(net.gen.at[i, "sn_mva"])
                xdss_ohm = float(net.gen.at[i, "xdss_pu"]) * vn * vn / sn
                net.gen.at[i, "rdss_ohm"] = _GEN_RX * xdss_ohm
    # The minimum-case calc corrects line resistance to the conductor's end
    # temperature, which it requires on every line. The editor doesn't model it,
    # so backfill the ambient 20 °C (no correction) for any line that lacks it.
    if not net.line.empty:
        _backfill(net.line, {"endtemp_degree": 20.0})
    # Static generators have no IEC 60909 model here; treat them as
    # non-contributing so they don't force per-sgen SC data (v1).
    if not net.sgen.empty:
        net.sgen["current_source"] = False


def run_shortcircuit(net) -> ShortCircuitResult:
    if net.ext_grid.empty and net.gen.empty:
        return ShortCircuitResult(
            ok=False, message="No short-circuit source (external grid or generator)."
        )
    _prepare(net)
    s = get_sc_settings(net)
    try:
        from pandapower.shortcircuit import calc_sc

        calc_sc(net, fault=s.fault, case=s.case, ip=s.ip, ith=s.ith, tk_s=s.tk_s)
    except Exception as exc:  # noqa: BLE001 - surface SC errors to the UI
        return ShortCircuitResult(ok=False, message=f"Short-circuit error: {exc}")

    res = net.res_bus_sc

    # ip/ith columns are only present when their calculation was requested.
    def _col(idx, col: str):
        return _f(res.at[idx, col]) if col in res.columns else None

    res_bus = [
        BusScResult(
            id=uid,
            ikss_ka=_f(res.at[idx, "ikss_ka"]),
            skss_mw=_f(res.at[idx, "skss_mw"]),
            ip_ka=_col(idx, "ip_ka"),
            ith_ka=_col(idx, "ith_ka"),
        )
        for uid, idx in _uuid_index(net, "bus")
        if idx in res.index
    ]
    return ShortCircuitResult(ok=True, res_bus=res_bus)
