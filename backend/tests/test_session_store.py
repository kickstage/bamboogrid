from app.commands import apply_commands
from app.projection import net_to_view
from app.schema import Command
from app.session import store


def test_session_rehydrates_from_database():
    session = store.create()
    apply_commands(
        session.net,
        [
            Command(
                op="add_bus",
                payload={"id": "bX", "name": "x", "vn_kv": 0.4, "x": 0, "y": 0, "width": 220},
            )
        ],
    )
    store.record(session)

    # Drop the in-memory cache: the session must come back from SQLite.
    store._live.clear()
    rehydrated = store.get(session.id)
    assert rehydrated.id == session.id
    assert "bX" in list(rehydrated.net.diagram_bus["uuid"])


def test_clone_preserves_element_ids_but_new_identity():
    session = store.create(name="Source")
    apply_commands(
        session.net,
        [
            Command(
                op="add_bus",
                payload={"id": "bY", "name": "y", "vn_kv": 0.4, "x": 0, "y": 0, "width": 220},
            )
        ],
    )
    store.record(session)

    clone = store.clone(session.id)
    assert clone.id != session.id
    assert "bY" in list(clone.net.diagram_bus["uuid"])
    assert clone.net["name"] == "Source (copy)"


def test_line_waypoint_persists_across_rehydrate():
    session = store.create()
    apply_commands(
        session.net,
        [
            Command(op="add_bus", payload={"id": "b1", "name": "b1", "vn_kv": 110, "x": 0, "y": 0, "width": 220}),
            Command(op="add_bus", payload={"id": "b2", "name": "b2", "vn_kv": 110, "x": 300, "y": 0, "width": 220}),
            Command(
                op="add_line",
                payload={
                    "id": "l1",
                    "from_bus": "b1",
                    "to_bus": "b2",
                    "port_from": "",
                    "port_to": "",
                    "data": {
                        "name": "Line",
                        "length_km": 1.0,
                        "r_ohm_per_km": 0.1,
                        "x_ohm_per_km": 0.4,
                        "c_nf_per_km": 10.0,
                        "max_i_ka": 0.6,
                    },
                },
            ),
            Command(op="set_layout", payload={"id": "l1", "kind": "line", "waypoint": {"x": 150, "y": 80}}),
        ],
    )
    store.record(session)
    sid = session.id

    store._live.clear()
    again = store.get(sid)
    line = next(ln for ln in net_to_view(again.net).network.lines if ln.id == "l1")
    assert line.waypoint is not None
    assert (line.waypoint.x, line.waypoint.y) == (150.0, 80.0)
