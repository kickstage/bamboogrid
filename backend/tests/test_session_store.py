from app.commands import apply_commands
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
    store.snapshot(session)

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
    store.snapshot(session)

    clone = store.clone(session.id)
    assert clone.id != session.id
    assert "bY" in list(clone.net.diagram_bus["uuid"])
    assert clone.net["name"] == "Source (copy)"
