import pandapower as pp

from app.ppjson import ensure_diagram_tables, net_to_network


def test_foreign_net_gets_spread_out_layout():
    # A plain pandapower net with no diagram tables and a small line topology.
    net = pp.create_empty_network()
    b = [pp.create_bus(net, vn_kv=20.0, name=f"B{i}") for i in range(4)]
    pp.create_ext_grid(net, bus=b[0])
    pp.create_line_from_parameters(net, b[0], b[1], 1, 0.1, 0.1, 0, 1)
    pp.create_line_from_parameters(net, b[1], b[2], 1, 0.1, 0.1, 0, 1)
    pp.create_line_from_parameters(net, b[1], b[3], 1, 0.1, 0.1, 0, 1)
    pp.create_load(net, bus=b[2], p_mw=1.0)

    restored = net_to_network(net)

    assert len(restored.buses) == 4
    coords = {(round(bus.x), round(bus.y)) for bus in restored.buses}
    # Buses must not all stack on the same point, nor all at the origin.
    assert len(coords) == 4
    assert coords != {(0, 0)}


def test_existing_layout_is_kept_not_auto():
    # When a diagram_bus table is present, its coordinates win over auto-layout.
    net = pp.create_empty_network()
    bus = pp.create_bus(net, vn_kv=0.4, name="B")
    pp.create_ext_grid(net, bus=bus)
    ensure_diagram_tables(net)
    net["diagram_bus"].loc[bus, ["x", "y"]] = (123.0, 456.0)

    restored = net_to_network(net)
    assert (restored.buses[0].x, restored.buses[0].y) == (123.0, 456.0)
