import pandapower as pp
import pytest

from app.converter import run_load_flow
from app.ppjson import network_to_pp_json, pp_json_to_network
from app.schema import Bus, Generator, Load, Network, Transformer2W, Transformer3W


def test_2w_transformer_connects_voltage_levels_and_solves():
    net = Network(
        id="n",
        buses=[Bus(id="hv", vn_kv=20.0), Bus(id="lv", vn_kv=0.4)],
        generators=[Generator(id="g", bus_id="hv", p_mw=0.0, vm_pu=1.0, slack=True)],
        loads=[Load(id="l", bus_id="lv", p_mw=0.05)],
        transformers2w=[
            Transformer2W(id="t1", hv_bus="hv", lv_bus="lv", std_type="0.25 MVA 20/0.4 kV")
        ],
    )
    result = run_load_flow(net)
    assert result.converged, result.message
    # LV bus is energised through the transformer (near, not exactly, 1.0 p.u.).
    lv = next(b for b in result.res_bus if b.id == "lv")
    assert lv.vm_pu is not None and 0.9 < lv.vm_pu < 1.0


def test_unknown_std_type_falls_back_and_still_builds():
    net = Network(
        id="n",
        buses=[Bus(id="hv", vn_kv=20.0), Bus(id="lv", vn_kv=0.4)],
        generators=[Generator(id="g", bus_id="hv", slack=True)],
        loads=[Load(id="l", bus_id="lv", p_mw=0.01)],
        transformers2w=[
            Transformer2W(id="t1", hv_bus="hv", lv_bus="lv", std_type="nonexistent")
        ],
    )
    assert run_load_flow(net).converged


def test_transformers_roundtrip_pandapower_json():
    original = Network(
        id="n",
        buses=[
            Bus(id="hv", vn_kv=110.0),
            Bus(id="mv", vn_kv=20.0),
            Bus(id="lv", vn_kv=10.0),
        ],
        transformers2w=[
            Transformer2W(id="t2", hv_bus="hv", lv_bus="mv", std_type="40 MVA 110/20 kV",
                          port_hv="p1", port_lv="p2")
        ],
        transformers3w=[
            Transformer3W(id="t3", hv_bus="hv", mv_bus="mv", lv_bus="lv",
                          std_type="63/25/38 MVA 110/20/10 kV")
        ],
    )
    restored = pp_json_to_network(network_to_pp_json(original))
    assert len(restored.transformers2w) == 1
    assert len(restored.transformers3w) == 1
    t2 = restored.transformers2w[0]
    assert (t2.hv_bus, t2.lv_bus) == ("hv", "mv")
    assert t2.std_type == "40 MVA 110/20 kV"
    assert t2.port_hv == "p1" and t2.port_lv == "p2"
    t3 = restored.transformers3w[0]
    assert (t3.hv_bus, t3.mv_bus, t3.lv_bus) == ("hv", "mv", "lv")


def test_import_plain_net_brings_in_transformer():
    net = pp.create_empty_network()
    hv = pp.create_bus(net, vn_kv=20.0)
    lv = pp.create_bus(net, vn_kv=0.4)
    pp.create_transformer(net, hv_bus=hv, lv_bus=lv, std_type="0.25 MVA 20/0.4 kV")
    restored = pp_json_to_network(pp.to_json(net))
    assert len(restored.transformers2w) == 1
    assert restored.transformers2w[0].hv_bus == restored.buses[0].id
