import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client():
    return TestClient(app)


def one_bus_payload():
    return {
        "id": "x",
        "name": "one-bus",
        "buses": [{"id": "b1", "name": "Bus bar", "vn_kv": 0.4}],
        "generators": [
            {"id": "g1", "bus_id": "b1", "p_mw": 0.0, "vm_pu": 1.0, "slack": True}
        ],
        "loads": [{"id": "l1", "bus_id": "b1", "p_mw": 0.01, "q_mvar": 0.0}],
    }


def test_health(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_run_loadflow_converges(client):
    run = client.post("/run-loadflow", json=one_bus_payload())
    assert run.status_code == 200
    body = run.json()
    assert body["converged"] is True
    assert body["res_bus"][0]["vm_pu"] == pytest.approx(1.0, abs=1e-6)


def test_run_loadflow_non_converging(client):
    payload = one_bus_payload()
    payload["generators"] = []  # no slack reference
    run = client.post("/run-loadflow", json=payload)
    assert run.status_code == 200
    assert run.json()["converged"] is False


def test_export_then_import_roundtrip(client):
    pp_json = client.post("/export/pandapower", json=one_bus_payload()).text
    imported = client.post("/import/pandapower", content=pp_json)
    assert imported.status_code == 200
    body = imported.json()
    assert len(body["buses"]) == 1
    assert len(body["generators"]) == 1
    assert len(body["loads"]) == 1
