import pandapower as pp

from app.ppjson import network_to_pp_json, pp_json_to_network
from app.schema import Bus, Generator, Load, Network, Point


def sample_network() -> Network:
    return Network(
        id="net-1",
        name="demo",
        buses=[Bus(id="b1", name="Main bus", vn_kv=0.4, x=240, y=160, width=260)],
        generators=[
            Generator(id="g1", name="Gen 1", bus_id="b1", vm_pu=1.02, x=240, y=80)
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
    pp.runpp(net)  # must solve as a normal pandapower net
    assert bool(net.converged)
    # diagram tables present but separate from the electrical frames
    assert "diagram_bus" in net and "geo" in net.bus.columns


def test_roundtrip_preserves_layout_and_ids():
    original = sample_network()
    restored = pp_json_to_network(network_to_pp_json(original))

    assert restored.name == "demo"
    assert [b.id for b in restored.buses] == ["b1"]
    assert restored.buses[0].width == 260
    assert restored.buses[0].x == 240 and restored.buses[0].y == 160

    gen = restored.generators[0]
    assert gen.id == "g1" and gen.bus_id == "b1" and gen.vm_pu == 1.02

    load = restored.loads[0]
    assert load.id == "l1" and load.bus_id == "b1" and load.p_mw == 0.01
    assert load.waypoint is not None
    assert (load.waypoint.x, load.waypoint.y) == (252, 210)


def test_import_plain_pandapower_net_without_diagram_tables():
    # A net produced by vanilla pandapower (no diagram_* tables) should still
    # import, with generated ids and default positions.
    net = pp.create_empty_network()
    b = pp.create_bus(net, vn_kv=0.4, name="B")
    pp.create_ext_grid(net, bus=b, vm_pu=1.0)
    pp.create_load(net, bus=b, p_mw=0.02)

    restored = pp_json_to_network(pp.to_json(net))
    assert len(restored.buses) == 1
    assert len(restored.generators) == 1
    assert len(restored.loads) == 1
    assert restored.generators[0].bus_id == restored.buses[0].id
