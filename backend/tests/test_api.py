import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client():
    return TestClient(app)


def new_session(client) -> str:
    res = client.post("/session")
    assert res.status_code == 200
    return res.json()["id"]


def auth(sid: str) -> dict[str, str]:
    return {"X-Session-Id": sid}


def build_one_bus(client, sid: str, *, slack: bool = True):
    """A single 0.4 kV bus with a small load, optionally a slack generator."""
    cmds = [
        {
            "op": "add_bus",
            "payload": {"id": "b1", "name": "Bus bar", "vn_kv": 0.4, "x": 0, "y": 0, "width": 220},
        },
        {
            "op": "add_element",
            "payload": {
                "id": "l1",
                "kind": "load",
                "bus_id": "b1",
                "port": "p0",
                "x": 0,
                "y": 100,
                "data": {"name": "Load", "p_mw": 0.01, "q_mvar": 0.0},
            },
        },
    ]
    if slack:
        cmds.append(
            {
                "op": "add_element",
                "payload": {
                    "id": "g1",
                    "kind": "generator",
                    "bus_id": "b1",
                    "port": "p1",
                    "x": 0,
                    "y": -100,
                    "data": {
                        "name": "Gen",
                        "p_mw": 0.0,
                        "vm_pu": 1.0,
                        "slack": True,
                        "slack_weight": 1.0,
                    },
                },
            }
        )
    res = client.post("/session/commands", json=cmds, headers=auth(sid))
    assert res.status_code == 200


def test_health(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_create_session_is_empty(client):
    res = client.post("/session")
    assert res.status_code == 200
    body = res.json()
    assert body["view"]["network"]["buses"] == []
    assert body["view"]["foreign"] == []


def test_run_loadflow_converges(client):
    sid = new_session(client)
    build_one_bus(client, sid)
    run = client.post("/session/run-loadflow", headers=auth(sid))
    assert run.status_code == 200
    body = run.json()
    assert body["converged"] is True
    bus = next(r for r in body["res_bus"] if r["id"] == "b1")
    assert bus["vm_pu"] == pytest.approx(1.0, abs=1e-6)


def test_run_loadflow_non_converging(client):
    sid = new_session(client)
    build_one_bus(client, sid, slack=False)  # no voltage reference
    run = client.post("/session/run-loadflow", headers=auth(sid))
    assert run.status_code == 200
    assert run.json()["converged"] is False


def test_view_reflects_commands(client):
    sid = new_session(client)
    build_one_bus(client, sid)
    view = client.get("/session", headers=auth(sid)).json()
    assert len(view["network"]["buses"]) == 1
    assert len(view["network"]["generators"]) == 1
    assert len(view["network"]["loads"]) == 1


def test_export_then_import_roundtrip(client):
    sid = new_session(client)
    build_one_bus(client, sid)
    pp_json = client.get("/session/export", headers=auth(sid)).text

    other = new_session(client)
    imported = client.post("/session/import", content=pp_json, headers=auth(other))
    assert imported.status_code == 200
    network = imported.json()["network"]
    assert len(network["buses"]) == 1
    assert len(network["generators"]) == 1
    assert len(network["loads"]) == 1


def test_missing_session_is_404(client):
    assert client.get("/session", headers=auth("nope")).status_code == 404
    assert (
        client.post("/session/run-loadflow", headers=auth("nope")).status_code == 404
    )


def test_missing_session_header_is_422(client):
    # No X-Session-Id header at all is a request error, not a missing session.
    assert client.get("/session").status_code == 422


def test_share_opens_independent_copy(client):
    sid = new_session(client)
    build_one_bus(client, sid)

    token = client.post("/session/share", headers=auth(sid)).json()["token"]
    assert token
    # A stable token: sharing again returns the same one.
    assert client.post("/session/share", headers=auth(sid)).json()["token"] == token

    opened = client.post(f"/share/{token}")
    assert opened.status_code == 200
    body = opened.json()
    copy_id = body["id"]
    assert copy_id != sid
    assert len(body["view"]["network"]["buses"]) == 1

    # Editing the copy must not touch the source.
    add_bus = [
        {
            "op": "add_bus",
            "payload": {"id": "b2", "name": "B2", "vn_kv": 0.4, "x": 9, "y": 9, "width": 220},
        }
    ]
    assert (
        client.post("/session/commands", json=add_bus, headers=auth(copy_id)).status_code
        == 200
    )
    assert len(client.get("/session", headers=auth(sid)).json()["network"]["buses"]) == 1
    assert (
        len(client.get("/session", headers=auth(copy_id)).json()["network"]["buses"])
        == 2
    )


def test_open_unknown_share_is_404(client):
    assert client.post("/share/does-not-exist").status_code == 404


def test_share_missing_session_is_404(client):
    assert client.post("/session/share", headers=auth("nope")).status_code == 404
