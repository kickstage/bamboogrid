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


def test_summary_reports_balance_and_counts(client):
    sid = new_session(client)
    build_one_bus(client, sid)
    res = client.post("/session/summary", headers=auth(sid))
    assert res.status_code == 200
    body = res.json()
    assert body["converged"] is True
    assert body["counts"]["buses"] == 1
    assert body["counts"]["loads"] == 1
    assert body["counts"]["islands"] == 1
    # Generation balances the load plus losses.
    assert body["balance"]["load_p_mw"] == pytest.approx(0.01, abs=1e-6)
    assert body["min_voltage"]["label"] == "Bus bar"


def test_summary_diagnostics_resolve_to_elements(client):
    sid = new_session(client)
    # A generator and external grid on the same bus is a textbook diagnostic
    # (multiple voltage-controlling elements), resolvable to that bus.
    cmds = [
        {"op": "add_bus", "payload": {"id": "b1", "name": "Slack bus", "vn_kv": 110, "x": 0, "y": 0, "width": 220}},
        {"op": "add_element", "payload": {"id": "eg", "kind": "extgrid", "bus_id": "b1", "port": "p0", "x": 0, "y": -100, "data": {"name": "Grid", "vm_pu": 1.0, "va_degree": 0.0}}},
        {"op": "add_element", "payload": {"id": "g1", "kind": "generator", "bus_id": "b1", "port": "p1", "x": 0, "y": -160, "data": {"name": "Gen", "p_mw": 1.0, "vm_pu": 1.0, "slack": False, "slack_weight": 1.0}}},
    ]
    assert client.post("/session/commands", json=cmds, headers=auth(sid)).status_code == 200

    diagnostics = client.post("/session/summary", headers=auth(sid)).json()["diagnostics"]
    resolved = {el["id"] for d in diagnostics for el in d["elements"]}
    assert "b1" in resolved
    # A resolved element carries the editor kind and a human label.
    bus_refs = [el for d in diagnostics for el in d["elements"] if el["id"] == "b1"]
    assert bus_refs[0]["kind"] == "bus"
    assert bus_refs[0]["label"] == "Slack bus"


def test_summary_handles_non_convergence(client):
    sid = new_session(client)
    build_one_bus(client, sid, slack=False)  # no voltage reference
    body = client.post("/session/summary", headers=auth(sid)).json()
    assert body["converged"] is False
    # Counts and diagnostics are still reported without a successful solve.
    assert body["counts"]["buses"] == 1
    assert body["balance"] is None


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


def _add_bus(client, sid: str, bus_id: str) -> dict:
    cmds = [
        {
            "op": "add_bus",
            "payload": {"id": bus_id, "name": bus_id, "vn_kv": 0.4, "x": 0, "y": 0, "width": 220},
        }
    ]
    res = client.post("/session/commands", json=cmds, headers=auth(sid))
    assert res.status_code == 200
    return res.json()


def _bus_ids(client, sid: str) -> set[str]:
    view = client.get("/session", headers=auth(sid)).json()
    return {b["id"] for b in view["network"]["buses"]}


def test_undo_redo_reverts_and_replays_commands(client):
    sid = new_session(client)

    first = _add_bus(client, sid, "b1")
    assert first["can_undo"] is True
    assert first["can_redo"] is False
    _add_bus(client, sid, "b2")
    assert _bus_ids(client, sid) == {"b1", "b2"}

    undone = client.post("/session/undo", headers=auth(sid)).json()
    assert {b["id"] for b in undone["network"]["buses"]} == {"b1"}
    assert undone["can_undo"] is True
    assert undone["can_redo"] is True

    redone = client.post("/session/redo", headers=auth(sid)).json()
    assert {b["id"] for b in redone["network"]["buses"]} == {"b1", "b2"}
    assert redone["can_undo"] is True
    assert redone["can_redo"] is False


def test_undo_with_empty_history_is_noop(client):
    sid = new_session(client)
    view = client.post("/session/undo", headers=auth(sid)).json()
    assert view["network"]["buses"] == []
    assert view["can_undo"] is False
    assert view["can_redo"] is False


def test_edit_after_undo_truncates_redo_tail(client):
    sid = new_session(client)
    _add_bus(client, sid, "b1")
    _add_bus(client, sid, "b2")

    client.post("/session/undo", headers=auth(sid))  # back to {b1}
    after = _add_bus(client, sid, "b3")  # diverge: drops the redo of b2
    assert after["can_redo"] is False
    assert _bus_ids(client, sid) == {"b1", "b3"}


def test_import_resets_history(client):
    sid = new_session(client)
    build_one_bus(client, sid)
    pp_json = client.get("/session/export", headers=auth(sid)).text

    imported = client.post("/session/import", content=pp_json, headers=auth(sid))
    assert imported.status_code == 200
    # A fresh baseline: the pre-import state is not reachable via undo.
    assert imported.json()["can_undo"] is False


def _two_bus_grid(client, sid: str) -> None:
    """20 kV ext_grid → 1 km line → second bus (a textbook 3-phase SC net)."""
    cmds = [
        {"op": "add_bus", "payload": {"id": "b1", "name": "B1", "vn_kv": 20.0, "x": 0, "y": 0, "width": 220}},
        {"op": "add_bus", "payload": {"id": "b2", "name": "B2", "vn_kv": 20.0, "x": 300, "y": 0, "width": 220}},
        {"op": "add_element", "payload": {"id": "eg", "kind": "extgrid", "bus_id": "b1", "port": "p0", "x": 0, "y": -100, "data": {"name": "Grid", "vm_pu": 1.0, "va_degree": 0.0, "s_sc_max_mva": 1000.0, "rx_max": 0.1}}},
        {"op": "add_line", "payload": {"id": "ln", "from_bus": "b1", "to_bus": "b2", "port_from": "p1", "port_to": "p0", "data": {"name": "Line", "length_km": 1.0, "r_ohm_per_km": 0.1, "x_ohm_per_km": 0.1, "c_nf_per_km": 0.0, "max_i_ka": 1.0, "std_type": ""}}},
    ]
    assert client.post("/session/commands", json=cmds, headers=auth(sid)).status_code == 200


def test_run_shortcircuit_reports_fault_current(client):
    sid = new_session(client)
    _two_bus_grid(client, sid)
    res = client.post("/session/run-shortcircuit", headers=auth(sid))
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    by_bus = {r["id"]: r for r in body["res_bus"]}
    assert by_bus["b1"]["ikss_ka"] > 0
    assert by_bus["b2"]["ikss_ka"] > 0
    # The fault current is highest right at the source bus.
    assert by_bus["b1"]["ikss_ka"] > by_bus["b2"]["ikss_ka"]
    assert by_bus["b1"]["ip_ka"] is not None


def test_run_shortcircuit_without_source_fails(client):
    sid = new_session(client)
    _add_bus(client, sid, "b1")
    body = client.post("/session/run-shortcircuit", headers=auth(sid)).json()
    assert body["ok"] is False
    assert body["message"]
    assert body["res_bus"] == []


def test_run_shortcircuit_with_generator_solves(client):
    sid = new_session(client)
    _two_bus_grid(client, sid)
    # Add a generator on b2 with default SC params: the calc must still solve.
    gen = [
        {"op": "add_element", "payload": {"id": "g1", "kind": "generator", "bus_id": "b2", "port": "p1", "x": 300, "y": -100, "data": {"name": "Gen", "p_mw": 1.0, "vm_pu": 1.0, "slack": False, "slack_weight": 1.0, "sn_mva": 5.0, "xdss_pu": 0.2, "cos_phi": 0.8}}},
    ]
    assert client.post("/session/commands", json=gen, headers=auth(sid)).status_code == 200
    body = client.post("/session/run-shortcircuit", headers=auth(sid)).json()
    assert body["ok"] is True
    assert {r["id"] for r in body["res_bus"]} == {"b1", "b2"}


def test_run_shortcircuit_missing_session_is_404(client):
    assert (
        client.post("/session/run-shortcircuit", headers=auth("nope")).status_code == 404
    )


def test_open_unknown_share_is_404(client):
    assert client.post("/share/does-not-exist").status_code == 404


def test_share_missing_session_is_404(client):
    assert client.post("/session/share", headers=auth("nope")).status_code == 404


# --- transformer params / std-types ----------------------------------------


def _two_bus_trafo(client, sid: str, std_type: str = "0.25 MVA 20/0.4 kV") -> None:
    """A 20 kV bus and a 0.4 kV bus joined by a std_type 2W transformer."""
    cmds = [
        {"op": "add_bus", "payload": {"id": "b1", "name": "HV", "vn_kv": 20.0, "x": 0, "y": 0, "width": 220}},
        {"op": "add_bus", "payload": {"id": "b2", "name": "LV", "vn_kv": 0.4, "x": 0, "y": 200, "width": 220}},
        {"op": "add_transformer", "payload": {"id": "t1", "hv_bus": "b1", "lv_bus": "b2", "std_type": std_type, "port_hv": "", "port_lv": ""}},
    ]
    assert client.post("/session/commands", json=cmds, headers=auth(sid)).status_code == 200


def _trafo(client, sid: str) -> dict:
    return client.get("/session", headers=auth(sid)).json()["network"]["transformers2w"][0]


def test_std_types_endpoint_returns_param_sets(client):
    types = client.get("/std-types/trafo")
    assert types.status_code == 200
    body = types.json()
    assert "0.25 MVA 20/0.4 kV" in body
    assert body["0.25 MVA 20/0.4 kV"]["sn_mva"] == pytest.approx(0.25)
    assert "vk_percent" in body["0.25 MVA 20/0.4 kV"]
    assert client.get("/std-types/trafo3w").status_code == 200
    assert client.get("/std-types/nope").status_code == 404


def test_std_type_transformer_projects_params(client):
    sid = new_session(client)
    _two_bus_trafo(client, sid)
    t = _trafo(client, sid)
    # The std_type label is kept AND the explicit params are always projected.
    assert t["std_type"] == "0.25 MVA 20/0.4 kV"
    assert t["params"] is not None
    assert t["params"]["sn_mva"] == pytest.approx(0.25)


def test_editing_a_param_makes_transformer_custom(client):
    sid = new_session(client)
    _two_bus_trafo(client, sid)
    params = _trafo(client, sid)["params"]
    params["vk_percent"] = 9.9
    patch = {"op": "update", "payload": {"id": "t1", "kind": "trafo2w", "patch": {"std_type": "", "params": params}}}
    assert client.post("/session/commands", json=[patch], headers=auth(sid)).status_code == 200
    t = _trafo(client, sid)
    assert t["std_type"] == ""  # dropped the preset label → custom
    assert t["params"]["vk_percent"] == pytest.approx(9.9)
    # The edit is preserved through a load flow (it's the solver's source of truth).
    run = client.post("/session/run-loadflow", headers=auth(sid))
    assert run.status_code == 200
    assert _trafo(client, sid)["params"]["vk_percent"] == pytest.approx(9.9)


def test_picking_std_type_refills_params(client):
    sid = new_session(client)
    _two_bus_trafo(client, sid)
    # Become custom first.
    params = _trafo(client, sid)["params"]
    params["vk_percent"] = 9.9
    client.post("/session/commands", json=[{"op": "update", "payload": {"id": "t1", "kind": "trafo2w", "patch": {"std_type": "", "params": params}}}], headers=auth(sid))
    # Picking a named type refills the params from the catalog and restores the label.
    client.post("/session/commands", json=[{"op": "update", "payload": {"id": "t1", "kind": "trafo2w", "patch": {"std_type": "0.4 MVA 20/0.4 kV"}}}], headers=auth(sid))
    t = _trafo(client, sid)
    assert t["std_type"] == "0.4 MVA 20/0.4 kV"
    assert t["params"]["sn_mva"] == pytest.approx(0.4)
    assert t["params"]["vk_percent"] != pytest.approx(9.9)
