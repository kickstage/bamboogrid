import json

import pandapower as pp

from app.autolayout import geo_layout
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


def test_world_geo_seeds_initial_layout():
    # A net that arrives with native geo (and no diagram tables) is laid out from
    # it rather than the graph layout, mapping the y-up geo space to a y-down
    # canvas (the highest bus sits topmost). Geo itself is left untouched.
    net = pp.create_empty_network()
    b = [pp.create_bus(net, vn_kv=20.0) for _ in range(3)]
    world = {b[0]: (1.0, 2.0), b[1]: (4.0, 0.5), b[2]: (2.5, 5.0)}
    for bus, (x, y) in world.items():
        net.bus.at[bus, "geo"] = json.dumps({"coordinates": [x, y], "type": "Point"})

    ensure_diagram_tables(net)

    ys = {bus: net["diagram_bus"].at[bus, "y"] for bus in b}
    assert ys[b[2]] < ys[b[0]] < ys[b[1]]
    # The source geo column is never rewritten.
    assert json.loads(net.bus.at[b[0], "geo"])["coordinates"] == [1.0, 2.0]


def test_partial_geo_falls_back_to_auto_layout():
    # Geo on only some buses is treated as no geo (graph layout instead).
    net = pp.create_empty_network()
    b = [pp.create_bus(net, vn_kv=20.0) for _ in range(2)]
    net.bus.at[b[0], "geo"] = json.dumps({"coordinates": [1.0, 1.0], "type": "Point"})
    assert geo_layout(net) is None
