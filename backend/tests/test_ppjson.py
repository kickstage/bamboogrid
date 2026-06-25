import pandapower as pp

from app.ppjson import network_to_pp_json, pp_json_to_network
from app.schema import Bus, Generator, Load, Network, Point


def sample_network() -> Network:
    return Network(
        id="net-1",
        name="demo",
        buses=[Bus(id="b1", name="Main bus", vn_kv=0.4, x=240, y=160, width=260)],
        generators=[
            Generator(
                id="g1", name="Gen 1", bus_id="b1", p_mw=0.005, vm_pu=1.02,
                slack=True, x=120, y=80,
            )
        ],
        loads=[
            Load(
                id="l1",
                name="Load 1",
                bus_id="b1",
                p_mw=0.01,
                q_mvar=0.0,
                x=240,
                y=260,
                waypoint=Point(x=252, y=210),
            )
        ],
    )


def test_export_is_valid_runnable_pandapower_net():
    raw = network_to_pp_json(sample_network())
    net = pp.from_json_string(raw)
    pp.runpp(net)
    assert bool(net.converged)
    assert "diagram_bus" in net and "diagram_gen" in net


def test_roundtrip_preserves_layout_and_ids():
    original = sample_network()
    restored = pp_json_to_network(network_to_pp_json(original))

    assert restored.name == "demo"
    assert restored.buses[0].width == 260

    gen = restored.generators[0]
    assert gen.id == "g1" and gen.bus_id == "b1"
    assert gen.p_mw == 0.005 and gen.vm_pu == 1.02 and gen.slack is True

    load = restored.loads[0]
    assert load.id == "l1" and load.p_mw == 0.01
    assert (load.waypoint.x, load.waypoint.y) == (252, 210)


def test_slack_generator_fields_roundtrip():
    net = Network(
        id="n",
        buses=[Bus(id="b1", vn_kv=0.4)],
        generators=[
            Generator(id="g1", bus_id="b1", p_mw=0.0, vm_pu=1.0, slack=True, slack_weight=2.5)
        ],
    )
    restored = pp_json_to_network(network_to_pp_json(net))
    gen = restored.generators[0]
    assert gen.slack is True
    assert gen.slack_weight == 2.5


def test_import_plain_pandapower_net_brings_in_gen_sgen_ext_grid():
    net = pp.create_empty_network()
    b = pp.create_bus(net, vn_kv=0.4, name="B")
    pp.create_ext_grid(net, bus=b, vm_pu=1.0)  # foreign net's slack
    pp.create_gen(net, bus=b, p_mw=0.5, vm_pu=1.0)
    pp.create_sgen(net, bus=b, p_mw=0.3, q_mvar=0.1)
    pp.create_load(net, bus=b, p_mw=0.02)

    restored = pp_json_to_network(pp.to_json(net))
    assert len(restored.buses) == 1
    assert len(restored.loads) == 1
    # Each source type maps to its own element; the ext_grid is the slack.
    assert len(restored.generators) == 1
    assert len(restored.ext_grids) == 1
    assert restored.ext_grids[0].vm_pu == 1.0
    assert len(restored.sgens) == 1
    assert restored.sgens[0].p_mw == 0.3 and restored.sgens[0].q_mvar == 0.1
    bus_id = restored.buses[0].id
    assert restored.generators[0].bus_id == bus_id
    assert restored.ext_grids[0].bus_id == bus_id
    assert restored.sgens[0].bus_id == bus_id


def test_import_rejects_networks_over_the_bus_cap():
    import pytest

    from app.ppjson import MAX_IMPORT_BUSES, NetworkTooLargeError

    net = pp.create_empty_network()
    for _ in range(MAX_IMPORT_BUSES + 1):
        pp.create_bus(net, vn_kv=0.4)

    with pytest.raises(NetworkTooLargeError, match=str(MAX_IMPORT_BUSES)):
        pp_json_to_network(pp.to_json(net))


def test_import_allows_networks_at_the_bus_cap():
    net = pp.create_empty_network()
    from app.ppjson import MAX_IMPORT_BUSES

    for _ in range(MAX_IMPORT_BUSES):
        pp.create_bus(net, vn_kv=0.4)

    restored = pp_json_to_network(pp.to_json(net))
    assert len(restored.buses) == MAX_IMPORT_BUSES
