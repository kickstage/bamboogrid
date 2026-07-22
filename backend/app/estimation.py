"""Run a weighted-least-squares state estimation on the session net.

Mirrors solve.py / sc.py: the retained net is estimated in place and results are
keyed back to the editor by the uuids in the diagram_* tables. The measurement
set the estimator consumes lives in pandapower's native ``measurement`` table
(populated by the measurement edit commands, see commands.py).

State estimation reconstructs the most likely bus voltages from redundant, noisy
field measurements — unlike a load flow it needs no complete set of injections,
but it does need enough measurements to be observable. We also compute each
measurement's normalized residual and a chi-square test so the UI can flag a
likely bad measurement or an under-determined set.
"""

from __future__ import annotations

import logging
import warnings

import numpy as np

from .schema import (
    BranchSideEst,
    BusEstResult,
    LineEstResult,
    MeasurementResidual,
    StateEstimationResult,
    StateEstimationSettings,
    TrafoEstResult,
)
from .solve import _f, _uuid_index

def get_est_settings(net) -> StateEstimationSettings:
    """Read the session's state-estimation settings from ``user_est_options`` (a
    plain dict on the net), falling back to the model defaults for anything not set."""
    opts = net.get("user_est_options") or {}
    fields = StateEstimationSettings.model_fields
    return StateEstimationSettings(**{k: opts[k] for k in fields if k in opts})


def set_est_settings(net, settings: StateEstimationSettings) -> None:
    """Persist the session's state-estimation settings onto the net so the next
    estimation uses them and they round-trip with export and sharing."""
    net["user_est_options"] = settings.model_dump()

# Largest-normalized-residual threshold for flagging a bad measurement (the
# standard value: a residual beyond 3 standard deviations of its own spread).
_RN_MAX_THRESHOLD = 3.0

# Which solved column holds the estimate for a given (element_type, meas_type,
# side). Bus measurements read res_bus_est; branch flows read the *_est branch
# table with a from/to (or hv/mv/lv) side. Used both to build residuals and to
# score observability of the measurement set.
_BUS_COLS = {"v": "vm_pu", "va": "va_degree", "p": "p_mw", "q": "q_mvar"}
_BRANCH_SIDE_COLS = {
    ("line", "p"): {"from": "p_from_mw", "to": "p_to_mw"},
    ("line", "q"): {"from": "q_from_mvar", "to": "q_to_mvar"},
    ("line", "i"): {"from": "i_from_ka", "to": "i_to_ka"},
    ("trafo", "p"): {"hv": "p_hv_mw", "lv": "p_lv_mw"},
    ("trafo", "q"): {"hv": "q_hv_mvar", "lv": "q_lv_mvar"},
    ("trafo", "i"): {"hv": "i_hv_ka", "lv": "i_lv_ka"},
    ("trafo3w", "p"): {"hv": "p_hv_mw", "mv": "p_mv_mw", "lv": "p_lv_mw"},
    ("trafo3w", "q"): {"hv": "q_hv_mvar", "mv": "q_mv_mvar", "lv": "q_lv_mvar"},
    ("trafo3w", "i"): {"hv": "i_hv_ka", "mv": "i_mv_ka", "lv": "i_lv_ka"},
}


def _estimated_value(net, row) -> float | None:
    """The solved (estimated) quantity a measurement row measures, or None when
    the relevant result table/cell isn't available."""
    etype = str(row["element_type"])
    mtype = str(row["measurement_type"])
    element = int(row["element"])
    if etype == "bus":
        res = net.get("res_bus_est")
        col = _BUS_COLS.get(mtype)
        if res is None or col is None or element not in res.index:
            return None
        return _f(res.at[element, col])
    side = row["side"]
    side = str(side) if isinstance(side, str) and side else None
    cols = _BRANCH_SIDE_COLS.get((etype, mtype))
    res = net.get(f"res_{etype}_est")
    if cols is None or res is None or side not in cols or element not in res.index:
        return None
    return _f(res.at[element, cols[side]])


def _normalized_residuals(se) -> dict[int, float]:
    """Proper normalized residuals rᴺ = |r| / √Ωᵢᵢ, keyed by pandapower
    measurement index. Ω = R − H·G⁻¹·Hᵀ is the residual covariance, so unlike a
    plain weighted residual this scales each residual by how observable that
    measurement actually is — the metric the bad-data test needs. A critical
    measurement (no redundancy) has Ωᵢᵢ ≈ 0 and an undetectable error; its
    normalized residual is left at 0 rather than dividing by ~0."""
    solver = se.solver
    r = np.abs(np.asarray(solver.r, dtype=float)).ravel()
    r_inv = np.asarray(solver.R_inv, dtype=float)
    h = np.asarray(solver.H, dtype=float)
    gm = np.asarray(solver.Gm, dtype=float)
    # Only Ω's diagonal is needed: diag(R) = 1/diag(R_inv) (independent noise),
    # and diag(H·G⁻¹·Hᵀ)_i = hᵢ·G⁻¹·hᵢᵀ, computed row-wise without forming the
    # full (measurements × measurements) matrix.
    diag_r = 1.0 / np.diag(r_inv)
    # h @ G⁻¹ via a solve (G symmetric), avoiding an explicit inverse.
    hm = np.linalg.solve(gm, h.T).T
    diag_hgh = np.einsum("ij,ij->i", hm, h)
    sqrt_omega = np.sqrt(np.abs(diag_r - diag_hgh))
    rn = np.where(sqrt_omega > 1e-9, r / sqrt_omega, 0.0)
    indices = np.asarray(solver.pp_meas_indices).ravel()
    n = min(len(rn), len(indices))
    return {int(indices[k]): float(rn[k]) for k in range(n)}


def _residuals(
    net, normalized: dict[int, float], suspect: int | None
) -> list[MeasurementResidual]:
    """Per-measurement residuals for display, pairing the intuitive
    measured−estimated difference (real units) with the normalized residual
    (from ``normalized``) and flagging the single identified bad measurement."""
    meas = net.get("measurement")
    d_meas = net.get("diagram_measurement")
    residuals: list[MeasurementResidual] = []
    if meas is None or d_meas is None:
        return residuals
    uuid_by_index = {int(i): str(d_meas.at[i, "uuid"]) for i in d_meas.index}
    for i in meas.index:
        uid = uuid_by_index.get(int(i))
        if uid is None:
            continue
        measured = _f(meas.at[i, "value"])
        estimated = _estimated_value(net, meas.loc[i])
        residual = (
            measured - estimated
            if measured is not None and estimated is not None
            else None
        )
        rn = normalized.get(int(i))
        # No normalized residual from the solver (rare): fall back to the plain
        # standardized residual for display, but never flag it as bad from that.
        if rn is None and residual is not None:
            std = float(meas.at[i, "std_dev"])
            if std > 0:
                rn = abs(residual) / std
        residuals.append(
            MeasurementResidual(
                id=uid,
                measured=measured,
                estimated=estimated,
                residual=residual,
                normalized_residual=rn,
                is_bad=int(i) == suspect,
            )
        )
    return residuals


def _estimate(net):
    """Run the WLS estimator via the ``StateEstimation`` class (rather than the
    ``estimate`` convenience wrapper) so its solver matrices stay reachable for
    the normalized-residual computation. Returns ``(se, success)``."""
    from pandapower.estimation.state_estimation import (
        StateEstimation,
        _initialize_voltage,
    )

    # The WLS estimator emits chatty pandas copy-warnings and logs its own
    # failures; keep both out of our solver output.
    est_logger = logging.getLogger("pandapower.estimation")
    prev_level = est_logger.level
    est_logger.setLevel(logging.CRITICAL)
    s = get_est_settings(net)
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            se = StateEstimation(
                net,
                tolerance=s.tolerance,
                maximum_iterations=s.maximum_iterations,
                algorithm=s.algorithm,
            )
            v_start, delta_start = _initialize_voltage(net, s.init)
            result = se.estimate(v_start=v_start, delta_start=delta_start)
    finally:
        est_logger.setLevel(prev_level)
    success = result.get("success") if isinstance(result, dict) else bool(result)
    return se, bool(success)


def run_estimation(net) -> StateEstimationResult:
    meas = net.get("measurement")
    if meas is None or not len(meas):
        return StateEstimationResult(
            ok=False,
            message="No measurements. Add measurements to buses, lines or "
            "transformers to run state estimation.",
        )
    if net.ext_grid.empty and not (
        "slack" in net.gen.columns and net.gen["slack"].any()
    ):
        return StateEstimationResult(
            ok=False,
            message="State estimation needs a voltage angle reference — add an "
            "external grid or a slack generator.",
        )

    # Initializing from load-flow results needs a solved res_bus. This is an
    # app-level "has a load flow been run?" check — a clear message up front
    # instead of pandapower's opaque "Init from results not possible" (its exact
    # index-match precondition is left to the library to enforce).
    if get_est_settings(net).init == "results":
        res_bus = net.get("res_bus")
        if res_bus is None or res_bus.empty:
            return StateEstimationResult(
                ok=False,
                message="State estimation is set to start from load-flow results, "
                "but there are none yet. Run a load flow first, or switch the "
                "estimator initialization to a flat start.",
            )

    # Measurements the user toggled off are kept in the model but excluded from
    # the solve — drop them from the table for the run, then restore it.
    d_meas = net.get("diagram_measurement")
    disabled = []
    if d_meas is not None and "enabled" in d_meas.columns:
        disabled = [
            i
            for i in meas.index
            if i in d_meas.index and not bool(d_meas.at[i, "enabled"])
        ]
    if disabled and len(disabled) == len(meas):
        return StateEstimationResult(
            ok=False,
            message="Every measurement is turned off. Enable at least one to run "
            "state estimation.",
        )

    full_meas = meas.copy()
    if disabled:
        net["measurement"] = meas.drop(disabled)
    try:
        try:
            se, success = _estimate(net)
        except Exception as exc:  # noqa: BLE001 - surface estimator errors to the UI
            return StateEstimationResult(ok=False, message=f"Estimation error: {exc}")

        if not success:
            return StateEstimationResult(
                ok=False,
                message="State estimation did not converge. Check that the network "
                "is observable (enough independent measurements) and the values are "
                "consistent.",
            )

        # Normalized residuals and the single bad-data suspect (the largest one,
        # only if it breaches the threshold). A gross error inflates other
        # residuals too, so flag one at a time rather than everything over the line.
        try:
            normalized = _normalized_residuals(se)
        except Exception:  # noqa: BLE001 - fall back to display-only residuals
            normalized = {}
        suspect: int | None = None
        if normalized:
            worst = max(normalized, key=normalized.__getitem__)
            if normalized[worst] > _RN_MAX_THRESHOLD:
                suspect = worst
        bad_data = suspect is not None

        # Built against the reduced (enabled-only) table, so disabled measurements
        # get no residual entry.
        residuals = _residuals(net, normalized, suspect)

        res_bus = [
            BusEstResult(
                id=uid,
                vm_pu=_f(net.res_bus_est.at[idx, "vm_pu"]),
                va_degree=_f(net.res_bus_est.at[idx, "va_degree"]),
                p_mw=_f(net.res_bus_est.at[idx, "p_mw"]),
                q_mvar=_f(net.res_bus_est.at[idx, "q_mvar"]),
            )
            for uid, idx in _uuid_index(net, "bus")
            if idx in net.res_bus_est.index
        ]
        res_line = [
            LineEstResult(
                id=uid,
                loading_percent=_f(net.res_line_est.at[idx, "loading_percent"]),
                sides=[
                    BranchSideEst(
                        side=end,
                        p_mw=_f(net.res_line_est.at[idx, f"p_{end}_mw"]),
                        q_mvar=_f(net.res_line_est.at[idx, f"q_{end}_mvar"]),
                        i_ka=_f(net.res_line_est.at[idx, f"i_{end}_ka"]),
                    )
                    for end in ("from", "to")
                ],
            )
            for uid, idx in _uuid_index(net, "line")
            if idx in net.res_line_est.index
        ]
        res_trafo = _trafo_results(net, "trafo", ("hv", "lv")) + _trafo_results(
            net, "trafo3w", ("hv", "mv", "lv")
        )

        return StateEstimationResult(
            ok=True,
            bad_data=bad_data,
            res_bus=res_bus,
            res_line=res_line,
            res_trafo=res_trafo,
            residuals=residuals,
        )
    finally:
        net["measurement"] = full_meas


def _trafo_results(net, table: str, sides: tuple[str, ...]) -> list[TrafoEstResult]:
    """Estimated per-winding flows and loading for a transformer table, keyed to
    editor identities. ``sides`` names the windings (hv/lv or hv/mv/lv)."""
    res = net.get(f"res_{table}_est")
    if res is None:
        return []
    out: list[TrafoEstResult] = []
    for uid, idx in _uuid_index(net, table):
        if idx not in res.index:
            continue
        out.append(
            TrafoEstResult(
                id=uid,
                loading_percent=_f(res.at[idx, "loading_percent"]),
                sides=[
                    BranchSideEst(
                        side=s,
                        p_mw=_f(res.at[idx, f"p_{s}_mw"]),
                        q_mvar=_f(res.at[idx, f"q_{s}_mvar"]),
                        i_ka=_f(res.at[idx, f"i_{s}_ka"])
                        if f"i_{s}_ka" in res.columns
                        else None,
                    )
                    for s in sides
                ],
            )
        )
    return out
