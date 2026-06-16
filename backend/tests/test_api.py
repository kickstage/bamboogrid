import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import storage
from app.main import app


@pytest.fixture(autouse=True)
def temp_data_dir(monkeypatch):
    with tempfile.TemporaryDirectory() as d:
        monkeypatch.setattr(storage, "DATA_DIR", Path(d))
        yield


@pytest.fixture
def client():
    return TestClient(app)


def one_bus_payload():
    return {
        "id": "ignored",
        "name": "one-bus",
        "buses": [{"id": "b1", "name": "Bus", "vn_kv": 0.4}],
        "generators": [{"id": "g1", "bus_id": "b1", "vm_pu": 1.0}],
        "loads": [{"id": "l1", "bus_id": "b1", "p_mw": 0.01, "q_mvar": 0.0}],
    }


def test_create_get_and_run(client):
    created = client.post("/networks", json=one_bus_payload())
    assert created.status_code == 201
    net_id = created.json()["id"]
    assert net_id != "ignored"  # server-assigned

    fetched = client.get(f"/networks/{net_id}")
    assert fetched.status_code == 200
    assert fetched.json()["name"] == "one-bus"

    run = client.post(f"/networks/{net_id}/run-loadflow")
    assert run.status_code == 200
    body = run.json()
    assert body["converged"] is True
    assert body["res_bus"][0]["vm_pu"] == pytest.approx(1.0, abs=1e-6)


def test_run_adhoc_non_converging(client):
    payload = one_bus_payload()
    payload["generators"] = []  # load with no slack reference
    run = client.post("/run-loadflow", json=payload)
    assert run.status_code == 200
    assert run.json()["converged"] is False


def test_get_missing_returns_404(client):
    assert client.get("/networks/nope").status_code == 404
