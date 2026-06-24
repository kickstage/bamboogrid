import pytest

from app.converter import run_load_flow, validate
from app.ppjson import network_to_pp_json, pp_json_to_network
from app.schema import Bus, ExtGrid, Line, Load, Network


def two_bus_with_line() -> Network:
    # Ext-grid slack on b1 feeds a load on b2 through one line (same voltage).
    return Network(
        id="n",
        name="ln",
        buses=[Bus(id="b1", vn_kv=20.0), Bus(id="b2", vn_kv=20.0)],
        ext_grids=[ExtGrid(id="eg", bus_id="b1", vm_pu=1.0)],
        loads=[Load(id="l1", bus_id="b2", p_mw=2.0, q_mvar=0.5)],
        lines=[
            Line(
                id="ln1",
                name="Feeder",
                from_bus="b1",
                to_bus="b2",
                length_km=5.0,
                r_ohm_per_km=0.2,
                x_ohm_per_km=0.3,
                c_nf_per_km=10.0,
                max_i_ka=0.4,
            )
        ],
    )


def test_line_connects_and_solves():
    result = run_load_flow(two_bus_with_line())
    assert result.converged, result.message
    by_bus = {b.id: b.vm_pu for b in result.res_bus}
    # Both buses are supplied (the line carries power to the load island)...
    assert by_bus["b1"] is not None and by_bus["b2"] is not None
    # ...and the loaded far end sags below the slack setpoint.
    assert by_bus["b2"] < by_bus["b1"]
    assert len(result.res_line) == 1
    assert result.res_line[0].loading_percent is not None


def test_line_unsupplied_without_it():
    # Drop the line: b2's load island has no reference and comes back unsupplied.
    net = two_bus_with_line()
    net.lines = []
    result = run_load_flow(net)
    by_bus = {b.id: b.vm_pu for b in result.res_bus}
    assert by_bus["b1"] is not None
    assert by_bus["b2"] is None


def test_unwired_line_is_ignored():
    net = Network(
        id="n",
        buses=[Bus(id="b1", vn_kv=20.0)],
        ext_grids=[ExtGrid(id="eg", bus_id="b1", vm_pu=1.0)],
        lines=[Line(id="ln1", from_bus="b1", to_bus="")],  # only one end wired
    )
    assert run_load_flow(net).converged


def test_line_references_unknown_bus_rejected():
    net = two_bus_with_line()
    net.lines[0].to_bus = "ghost"
    with pytest.raises(Exception):
        validate(net)


def test_line_survives_pandapower_json_roundtrip():
    original = two_bus_with_line()
    restored = pp_json_to_network(network_to_pp_json(original))
    assert len(restored.lines) == 1
    ln = restored.lines[0]
    assert {ln.from_bus, ln.to_bus} == {"b1", "b2"}
    assert ln.length_km == pytest.approx(5.0)
    assert ln.r_ohm_per_km == pytest.approx(0.2)
    assert ln.max_i_ka == pytest.approx(0.4)


def test_frequency_and_base_survive_roundtrip():
    original = two_bus_with_line()
    original.f_hz = 60.0
    original.sn_mva = 100.0
    restored = pp_json_to_network(network_to_pp_json(original))
    assert restored.f_hz == pytest.approx(60.0)
    assert restored.sn_mva == pytest.approx(100.0)
