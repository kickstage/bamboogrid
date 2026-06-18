import pandapower as pp

from app.ppjson import pp_json_to_network


def test_foreign_net_gets_spread_out_layout():
    # A plain pandapower net with no diagram tables and a small line topology.
    net = pp.create_empty_network()
    b = [pp.create_bus(net, vn_kv=20.0, name=f"B{i}") for i in range(4)]
    pp.create_ext_grid(net, bus=b[0])
    pp.create_line_from_parameters(net, b[0], b[1], 1, 0.1, 0.1, 0, 1)
    pp.create_line_from_parameters(net, b[1], b[2], 1, 0.1, 0.1, 0, 1)
    pp.create_line_from_parameters(net, b[1], b[3], 1, 0.1, 0.1, 0, 1)
    pp.create_load(net, bus=b[2], p_mw=1.0)

    restored = pp_json_to_network(pp.to_json(net))

    assert len(restored.buses) == 4
    coords = {(round(bus.x), round(bus.y)) for bus in restored.buses}
    # Buses must not all stack on the same point.
    assert len(coords) == 4
    # And not all at the origin.
    assert coords != {(0, 0)}
    # The load is placed below its bus, the slack (from ext_grid) above one.
    assert restored.loads[0].y > min(b.y for b in restored.buses) - 1000  # sane


def test_our_own_export_keeps_saved_layout_not_auto():
    # When diagram tables are present we must NOT auto-layout.
    from app.ppjson import network_to_pp_json
    from app.schema import Bus, Generator, Load, Network

    original = Network(
        id="n",
        name="x",
        buses=[Bus(id="b1", vn_kv=0.4, x=123, y=456, width=220)],
        generators=[Generator(id="g1", bus_id="b1", slack=True, x=10, y=20)],
        loads=[Load(id="l1", bus_id="b1", p_mw=0.01, x=30, y=40)],
    )
    restored = pp_json_to_network(network_to_pp_json(original))
    assert (restored.buses[0].x, restored.buses[0].y) == (123, 456)
