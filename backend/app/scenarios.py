"""Curated pandapower example networks, generated on demand (never stored).

The catalog is a small whitelist so the API only ever builds a known network —
never an arbitrary pandapower function named by the client. All are kept under
the import bus cap so they stay responsive on the canvas. Each is built fresh on
request from ``pandapower.networks``; nothing is persisted server-side until the
resulting session is edited.
"""

from __future__ import annotations

from typing import Callable

import pandapower as pp
import pandapower.networks as nw


def _state_estimation_demo():
    """A small mixed-voltage network with a redundant, consistent measurement
    set, ready to run state estimation on out of the box.

    Four 110 kV buses (one an external-grid reference) in a mesh of four lines,
    a 20 kV bus fed through a 110/20 kV two-winding transformer, and a 20 kV +
    10 kV pair fed through a 110/20/10 kV three-winding transformer — loads on
    the HV mesh and on every lower-voltage bus. We solve a power flow once to get
    the true state, then place measurements — bus voltages, load-bus power
    injections, line flows and the transformer winding flows — at their solved
    values (rounded to a realistic precision, so residuals are small but not
    exactly zero). The set is far more than observable, so the WLS estimator
    reconstructs the state cleanly; edit any measured value in the inspector to
    watch its residual grow and the bad-data flag trip."""
    net = pp.create_empty_network(sn_mva=100.0, name="State estimation demo")
    b1 = pp.create_bus(net, 110.0, name="Bus 1")
    b2 = pp.create_bus(net, 110.0, name="Bus 2")
    b3 = pp.create_bus(net, 110.0, name="Bus 3")
    b4 = pp.create_bus(net, 110.0, name="Bus 4")
    b5 = pp.create_bus(net, 20.0, name="Bus 5")  # LV side of the 2W transformer
    b6 = pp.create_bus(net, 20.0, name="Bus 6")  # MV side of the 3W transformer
    b7 = pp.create_bus(net, 10.0, name="Bus 7")  # LV side of the 3W transformer
    pp.create_ext_grid(net, b1, vm_pu=1.02, name="Grid")
    pp.create_load(net, b2, p_mw=40.0, q_mvar=20.0, name="Load 2")
    pp.create_load(net, b3, p_mw=60.0, q_mvar=25.0, name="Load 3")
    pp.create_load(net, b4, p_mw=30.0, q_mvar=10.0, name="Load 4")
    pp.create_load(net, b5, p_mw=25.0, q_mvar=8.0, name="Load 5")
    pp.create_load(net, b6, p_mw=18.0, q_mvar=6.0, name="Load 6")
    pp.create_load(net, b7, p_mw=12.0, q_mvar=4.0, name="Load 7")
    line = dict(r_ohm_per_km=0.06, x_ohm_per_km=0.18, c_nf_per_km=10.0, max_i_ka=1.0)
    pp.create_line_from_parameters(net, b1, b2, 12.0, **line, name="Line 1-2")
    pp.create_line_from_parameters(net, b1, b3, 10.0, **line, name="Line 1-3")
    pp.create_line_from_parameters(net, b2, b3, 8.0, **line, name="Line 2-3")
    pp.create_line_from_parameters(net, b3, b4, 15.0, **line, name="Line 3-4")
    trafo = pp.create_transformer(
        net, hv_bus=b3, lv_bus=b5, std_type="63 MVA 110/20 kV", name="Trafo 3-5"
    )
    trafo3w = pp.create_transformer3w(
        net, hv_bus=b4, mv_bus=b6, lv_bus=b7,
        std_type="63/25/38 MVA 110/20/10 kV", name="Trafo 4-6-7",
    )

    # Solve once for the true state, then seed measurements from it.
    pp.runpp(net)
    for b in net.bus.index:
        pp.create_measurement(
            net, "v", "bus", round(float(net.res_bus.vm_pu.at[b]), 3), 0.004, element=b
        )
    # Power injections at the load buses (the reference bus injection is left
    # unmeasured — it's the quantity the reference balances).
    for b in (b2, b3, b4, b5, b6, b7):
        pp.create_measurement(
            net, "p", "bus", round(float(net.res_bus.p_mw.at[b]), 1), 2.0, element=b
        )
        pp.create_measurement(
            net, "q", "bus", round(float(net.res_bus.q_mvar.at[b]), 1), 2.0, element=b
        )
    for ln in net.line.index:
        pp.create_measurement(
            net, "p", "line",
            round(float(net.res_line.p_from_mw.at[ln]), 1), 2.0, element=ln, side="from",
        )
        pp.create_measurement(
            net, "q", "line",
            round(float(net.res_line.q_from_mvar.at[ln]), 1), 2.0, element=ln, side="from",
        )
    # Two-winding transformer flow, measured on the HV side.
    pp.create_measurement(
        net, "p", "trafo",
        round(float(net.res_trafo.p_hv_mw.at[trafo]), 1), 2.0, element=trafo, side="hv",
    )
    pp.create_measurement(
        net, "q", "trafo",
        round(float(net.res_trafo.q_hv_mvar.at[trafo]), 1), 2.0, element=trafo, side="hv",
    )
    # Three-winding transformer flow, measured on each winding (hv/mv/lv).
    for side in ("hv", "mv", "lv"):
        pp.create_measurement(
            net, "p", "trafo3w",
            round(float(net.res_trafo3w.at[trafo3w, f"p_{side}_mw"]), 1),
            2.0, element=trafo3w, side=side,
        )
        pp.create_measurement(
            net, "q", "trafo3w",
            round(float(net.res_trafo3w.at[trafo3w, f"q_{side}_mvar"]), 1),
            2.0, element=trafo3w, side=side,
        )
    return net


# id -> (label, builder). The standard networks run small → large; the
# state-estimation demo follows them as a specialized example.
_SCENARIOS: dict[str, tuple[str, Callable[[], object]]] = {
    "example_simple": ("Simple example", nw.example_simple),
    "case9": ("IEEE 9-bus", nw.case9),
    "case14": ("IEEE 14-bus", nw.case14),
    "case30": ("IEEE 30-bus", nw.case30),
    "se_demo": ("State estimation demo", _state_estimation_demo),
    "example_multivoltage": ("Multi-voltage (3W transformer)", nw.example_multivoltage),
}


def list_scenarios() -> list[dict[str, str]]:
    """The catalog as ``[{id, label}]`` for the File ▸ Open example menu."""
    return [{"id": sid, "label": label} for sid, (label, _) in _SCENARIOS.items()]


def build_scenario(scenario_id: str):
    """Build a fresh pandapower net for ``scenario_id`` (named by its label), or
    return ``None`` if the id isn't in the whitelist."""
    entry = _SCENARIOS.get(scenario_id)
    if entry is None:
        return None
    label, builder = entry
    net = builder()
    net.name = label
    return net
