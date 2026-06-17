import pytest

from app.converter import run_load_flow, validate
from app.ppjson import network_to_pp_json, pp_json_to_network
from app.schema import Bus, Generator, Load, Network, Switch


def two_bus_with_switch(closed: bool) -> Network:
    # Slack generator on b1, load on b2, joined by one bus-bus switch.
    return Network(
        id="n",
        name="sw",
        buses=[Bus(id="b1", vn_kv=0.4), Bus(id="b2", vn_kv=0.4)],
        generators=[Generator(id="g1", bus_id="b1", p_mw=0.0, vm_pu=1.0, slack=True)],
        loads=[Load(id="l1", bus_id="b2", p_mw=0.01)],
        switches=[Switch(id="s1", bus_a="b1", bus_b="b2", closed=closed)],
    )


def test_closed_switch_makes_island_solvable():
    result = run_load_flow(two_bus_with_switch(closed=True))
    assert result.converged, result.message
    # Both buses sit at the slack setpoint (zero-impedance tie).
    assert all(b.vm_pu == pytest.approx(1.0, abs=1e-6) for b in result.res_bus)


def test_open_switch_leaves_load_island_unsupplied():
    # Allowed to build (we don't require a reference). pandapower solves the
    # supplied side and leaves the slack-less island's bus unsupplied (None).
    validate(two_bus_with_switch(closed=False))
    result = run_load_flow(two_bus_with_switch(closed=False))
    by_bus = {b.id: b.vm_pu for b in result.res_bus}
    assert by_bus["b1"] is not None  # the ext_grid side is solved
    assert by_bus["b2"] is None  # the load island has no slack


def test_unwired_switch_is_ignored():
    net = Network(
        id="n",
        buses=[Bus(id="b1", vn_kv=0.4)],
        generators=[Generator(id="g1", bus_id="b1", slack=True)],
        switches=[Switch(id="s1", bus_a="b1", bus_b="")],  # only one end wired
    )
    # Should not raise and should solve (the dangling switch is skipped).
    assert run_load_flow(net).converged


def test_switch_survives_pandapower_json_roundtrip():
    original = two_bus_with_switch(closed=False)
    restored = pp_json_to_network(network_to_pp_json(original))
    assert len(restored.switches) == 1
    sw = restored.switches[0]
    assert sw.id == "s1"
    assert {sw.bus_a, sw.bus_b} == {"b1", "b2"}
    assert sw.closed is False
