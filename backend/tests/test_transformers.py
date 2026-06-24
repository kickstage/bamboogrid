"""Transformers built from explicit parameters.

The editor normally stores transformers by ``std_type`` name, but nets imported
from pandapower (e.g. case14) define their transformers by raw parameters with a
null std_type. These tests cover capturing those parameters on import so the net
solves, plus the std_type authoring path staying intact.
"""

from pathlib import Path

import pandapower as pp
import pandapower.networks as nw

from app.converter import run_load_flow
from app.ppjson import network_to_pp_json, pp_json_to_network
from app.schema import (
    Bus,
    ExtGrid,
    Load,
    Network,
    Trafo2WParams,
    Transformer2W,
)

EXAMPLES = Path(__file__).resolve().parents[2] / "examples"


def two_voltage_trafo_net() -> Network:
    # Ext-grid slack on a 110 kV bus feeds a load across a 25 MVA 110/20 kV
    # transformer given by explicit parameters (no std_type).
    return Network(
        id="n",
        name="trafo",
        buses=[Bus(id="hv", vn_kv=110.0), Bus(id="lv", vn_kv=20.0)],
        ext_grids=[ExtGrid(id="eg", bus_id="hv", vm_pu=1.0)],
        loads=[Load(id="l1", bus_id="lv", p_mw=10.0, q_mvar=3.0)],
        transformers2w=[
            Transformer2W(
                id="t1",
                name="Main",
                hv_bus="hv",
                lv_bus="lv",
                params=Trafo2WParams(
                    sn_mva=25.0,
                    vn_hv_kv=110.0,
                    vn_lv_kv=20.0,
                    vk_percent=12.0,
                    vkr_percent=0.41,
                    pfe_kw=14.0,
                    i0_percent=0.07,
                ),
            )
        ],
    )


def test_explicit_param_transformer_solves():
    result = run_load_flow(two_voltage_trafo_net())
    assert result.converged, result.message
    by_bus = {b.id: b.vm_pu for b in result.res_bus}
    # Both ends supplied (the transformer carries power to the LV island)...
    assert by_bus["hv"] is not None and by_bus["lv"] is not None
    # ...and the loaded LV side sags below the slack setpoint.
    assert by_bus["lv"] < by_bus["hv"]
    assert len(result.res_trafo) == 1
    assert result.res_trafo[0].loading_percent is not None


def test_explicit_params_survive_roundtrip():
    restored = pp_json_to_network(network_to_pp_json(two_voltage_trafo_net()))
    assert len(restored.transformers2w) == 1
    p = restored.transformers2w[0].params
    assert p is not None
    assert p.sn_mva == 25.0
    assert p.vn_hv_kv == 110.0
    assert p.vn_lv_kv == 20.0
    assert p.vk_percent == 12.0


def test_recognized_std_type_keeps_std_path():
    # A transformer authored by a recognized std_type round-trips as a std_type
    # reference, not captured explicit params.
    net = Network(
        id="n",
        buses=[Bus(id="hv", vn_kv=110.0), Bus(id="lv", vn_kv=20.0)],
        transformers2w=[
            Transformer2W(
                id="t1", hv_bus="hv", lv_bus="lv", std_type="25 MVA 110/20 kV"
            )
        ],
    )
    restored = pp_json_to_network(network_to_pp_json(net))
    t = restored.transformers2w[0]
    assert t.params is None
    assert t.std_type == "25 MVA 110/20 kV"


def test_case14_example_imports_and_solves():
    raw = (EXAMPLES / "IEEE14.pp.json").read_text()
    net = pp_json_to_network(raw)
    # All 5 transformers come in with explicit params (their std_type is null).
    assert len(net.transformers2w) == 5
    assert all(t.params is not None for t in net.transformers2w)

    result = run_load_flow(net)
    assert result.converged, result.message
    vms = [b.vm_pu for b in result.res_bus if b.vm_pu is not None]
    # Every bus is supplied and voltages land in a sane band.
    assert len(vms) == len(net.buses) == 14
    assert all(0.9 < v < 1.12 for v in vms)


def test_trafo3w_explicit_params_import_and_solve():
    # example_multivoltage has a 3-winding transformer with a null std_type.
    raw = pp.to_json(nw.example_multivoltage())
    net = pp_json_to_network(raw)
    assert len(net.transformers3w) == 1
    assert net.transformers3w[0].params is not None
    assert run_load_flow(net).converged
