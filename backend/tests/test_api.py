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


def test_run_loadflow_drops_disconnected_client(client, monkeypatch):
    """A request whose client hung up (the editor timed out and aborted) is
    refused with 499 before the solve runs, so an abandoned request can't burn a
    CPU core."""
    sid = new_session(client)
    build_one_bus(client, sid)

    async def _always_disconnected(self) -> bool:
        return True

    def _boom(_net):  # the solver must not be reached for a dead client
        raise AssertionError("solve_net ran for a disconnected client")

    monkeypatch.setattr(
        "starlette.requests.Request.is_disconnected", _always_disconnected
    )
    monkeypatch.setattr("app.main.solve_net", _boom)

    run = client.post("/session/run-loadflow", headers=auth(sid))
    assert run.status_code == 499


def test_loadflow_settings_defaults(client):
    sid = new_session(client)
    res = client.get("/session/loadflow-settings", headers=auth(sid))
    assert res.status_code == 200
    s = res.json()
    assert s["algorithm"] == "nr"
    assert s["max_iteration"] is None
    assert s["tolerance_mva"] == pytest.approx(1e-8)
    assert s["calculate_voltage_angles"] is True


def test_loadflow_settings_update_and_roundtrip(client):
    sid = new_session(client)
    build_one_bus(client, sid)

    update = {
        "algorithm": "nr",
        "init": "flat",
        "max_iteration": 25,
        "tolerance_mva": 1e-6,
        "calculate_voltage_angles": True,
        "trafo_model": "pi",
        "trafo_loading": "power",
        "enforce_q_lims": True,
        "enforce_p_lims": False,
        "voltage_depend_loads": False,
        "consider_line_temperature": False,
        "line_temperature_degree_celsius": 20.0,
        "check_connectivity": True,
    }
    res = client.put("/session/loadflow-settings", json=update, headers=auth(sid))
    assert res.status_code == 200
    assert res.json()["max_iteration"] == 25
    assert res.json()["init"] == "flat"

    # Settings persist for the session...
    again = client.get("/session/loadflow-settings", headers=auth(sid)).json()
    assert again["max_iteration"] == 25
    assert again["trafo_model"] == "pi"
    assert again["enforce_q_lims"] is True

    # ...and the load flow still converges with them applied.
    run = client.post("/session/run-loadflow", headers=auth(sid))
    assert run.status_code == 200
    assert run.json()["converged"] is True

    # ...and they round-trip through pandapower export (user_pf_options).
    export = client.get("/session/export", headers=auth(sid))
    assert export.status_code == 200
    assert '"max_iteration": 25' in export.text


def test_loadflow_settings_clearing_max_iteration(client):
    sid = new_session(client)
    client.put(
        "/session/loadflow-settings",
        json={**_default_settings(), "max_iteration": 30},
        headers=auth(sid),
    )
    assert (
        client.get("/session/loadflow-settings", headers=auth(sid)).json()[
            "max_iteration"
        ]
        == 30
    )
    # Setting it back to auto (null) clears it.
    client.put(
        "/session/loadflow-settings",
        json={**_default_settings(), "max_iteration": None},
        headers=auth(sid),
    )
    assert (
        client.get("/session/loadflow-settings", headers=auth(sid)).json()[
            "max_iteration"
        ]
        is None
    )


def test_loadflow_settings_is_not_an_undo_step(client):
    # Settings are a preference carried on the net, not an editable element, so
    # changing them must not add an undo step.
    sid = new_session(client)
    assert client.get("/session", headers=auth(sid)).json()["can_undo"] is False
    client.put(
        "/session/loadflow-settings",
        json={**_default_settings(), "max_iteration": 12},
        headers=auth(sid),
    )
    assert client.get("/session", headers=auth(sid)).json()["can_undo"] is False


def test_loadflow_consider_line_temperature_converges(client):
    # Previously this aborted because no line carried a temperature column; the
    # global setting now stamps one onto every line before solving.
    sid = new_session(client)
    _two_bus_grid(client, sid)
    client.put(
        "/session/loadflow-settings",
        json={
            **_default_settings(),
            "consider_line_temperature": True,
            "line_temperature_degree_celsius": 80.0,
        },
        headers=auth(sid),
    )
    run = client.post("/session/run-loadflow", headers=auth(sid))
    assert run.status_code == 200
    assert run.json()["converged"] is True


def _default_settings() -> dict:
    return {
        "algorithm": "nr",
        "init": "auto",
        "max_iteration": None,
        "tolerance_mva": 1e-8,
        "calculate_voltage_angles": True,
        "trafo_model": "t",
        "trafo_loading": "current",
        "enforce_q_lims": False,
        "enforce_p_lims": False,
        "voltage_depend_loads": False,
        "consider_line_temperature": False,
        "line_temperature_degree_celsius": 20.0,
        "check_connectivity": True,
    }


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


def test_import_rejects_oversized_body(client):
    from app.ppjson import MAX_IMPORT_BYTES

    sid = new_session(client)
    oversized = b"[0" + b",0" * (MAX_IMPORT_BYTES // 2) + b"]"
    res = client.post("/session/import", content=oversized, headers=auth(sid))
    assert res.status_code == 413
    assert "too large" in res.json()["detail"].lower()


def test_import_rejects_valid_json_that_is_not_a_net(client):
    # Valid JSON, but a bare list — pandapower parses it without error, so the
    # endpoint must type-check rather than blow up on net.bus (was a 500).
    sid = new_session(client)
    res = client.post("/session/import", content=b"[1, 2, 3]", headers=auth(sid))
    assert res.status_code == 400
    assert "not a pandapower network" in res.json()["detail"].lower()


def test_import_rejects_non_utf8_body(client):
    # A non-UTF-8 body used to escape as an unhandled 500 (decode outside the try).
    sid = new_session(client)
    res = client.post("/session/import", content=b"\xff\xfe\xff", headers=auth(sid))
    assert res.status_code == 400


def test_import_rejects_code_execution_gadget(client):
    # pp.from_json_string is a deserializer; a crafted object would run
    # os.system("...") DURING parsing. The endpoint must reject it (400) before
    # the loader ever sees it — and, crucially, nothing must execute.
    import os as _os

    marker = "/tmp/bamboogrid_rce_marker"
    if _os.path.exists(marker):
        _os.remove(marker)
    sid = new_session(client)
    gadget = f'{{"_module": "os", "_class": "system", "_object": "touch {marker}"}}'
    res = client.post("/session/import", content=gadget, headers=auth(sid))
    assert res.status_code == 400
    assert "disallowed object reference" in res.json()["detail"].lower()
    assert not _os.path.exists(marker), "the gadget executed — RCE not blocked!"


def test_import_rejects_gadget_hidden_in_valid_net(client):
    # A payload buried inside otherwise-valid-looking JSON must still be caught.
    sid = new_session(client)
    hidden = (
        '{"bus": [{"ok": 1}, '
        '{"x": {"_module": "builtins", "_class": "eval", "_object": "1+1"}}]}'
    )
    res = client.post("/session/import", content=hidden, headers=auth(sid))
    assert res.status_code == 400


def test_import_enforces_bus_limit(client):
    # A net over MAX_IMPORT_BUSES is refused with 413 and a message that names the
    # actual and allowed counts; a net at the limit is accepted.
    import pandapower as pp

    from app.ppjson import MAX_IMPORT_BUSES

    over = pp.create_empty_network()
    for _ in range(MAX_IMPORT_BUSES + 1):
        pp.create_bus(over, vn_kv=0.4)
    sid = new_session(client)
    res = client.post("/session/import", content=pp.to_json(over), headers=auth(sid))
    assert res.status_code == 413
    detail = res.json()["detail"]
    assert str(MAX_IMPORT_BUSES + 1) in detail
    assert str(MAX_IMPORT_BUSES) in detail

    at_limit = pp.create_empty_network()
    for _ in range(MAX_IMPORT_BUSES):
        pp.create_bus(at_limit, vn_kv=0.4)
    ok = client.post(
        "/session/import", content=pp.to_json(at_limit), headers=auth(sid)
    )
    assert ok.status_code == 200
    assert len(ok.json()["network"]["buses"]) == MAX_IMPORT_BUSES


def test_building_enforces_bus_limit(client):
    # The same cap applies when buses are added interactively, not just on import.
    # The over-limit batch is rejected (400) and must not mutate the net.
    from app.ppjson import MAX_IMPORT_BUSES

    sid = new_session(client)

    def add_buses(n: int):
        cmds = [
            {
                "op": "add_bus",
                "payload": {"id": f"b{i}", "name": f"B{i}", "vn_kv": 0.4,
                            "x": 0, "y": i, "width": 220},
            }
            for i in range(n)
        ]
        return client.post("/session/commands", json=cmds, headers=auth(sid))

    # A batch that exactly fills the limit is fine.
    assert add_buses(MAX_IMPORT_BUSES).status_code == 200
    # One more bus is refused, with a message that names the limit...
    over = add_buses(1)
    assert over.status_code == 400
    assert str(MAX_IMPORT_BUSES) in over.json()["detail"]
    # ...and the rejected command left the net untouched.
    view = client.get("/session", headers=auth(sid)).json()
    assert len(view["network"]["buses"]) == MAX_IMPORT_BUSES


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


def test_scenarios_list_includes_known_cases(client):
    body = client.get("/scenarios").json()
    ids = {s["id"] for s in body}
    assert {"case9", "case14"} <= ids
    assert all(s["label"] for s in body)


def test_open_scenario_builds_session(client):
    res = client.post("/session/scenario/case9")
    assert res.status_code == 200
    network = res.json()["view"]["network"]
    assert len(network["buses"]) == 9
    assert network["name"] == "IEEE 9-bus"


def test_open_unknown_scenario_is_404(client):
    assert client.post("/session/scenario/not-a-case").status_code == 404


def test_multivoltage_xwards_are_modeled_not_foreign(client):
    res = client.post("/session/scenario/example_multivoltage")
    assert res.status_code == 200
    view = res.json()["view"]
    # The example's two xwards are now first-class elements, not foreign rows.
    assert len(view["network"]["xwards"]) == 2
    assert all(f["table"] != "xward" for f in view["foreign"])
    w = view["network"]["xwards"][0]
    assert w["bus_id"] and w["x_ohm"] > 0


def test_xward_create_edit_delete_and_solve(client):
    sid = new_session(client)
    build_one_bus(client, sid)  # 0.4 kV bus with a slack gen + small load
    # Create an xward wired to the bus.
    add = {
        "op": "add_element",
        "payload": {
            "id": "w1",
            "kind": "xward",
            "bus_id": "b1",
            "port": "p2",
            "x": 120,
            "y": 100,
            "data": {
                "name": "Equiv",
                "ps_mw": 0.02,
                "qs_mvar": 0.0,
                "pz_mw": 0.0,
                "qz_mvar": 0.0,
                "r_ohm": 0.0,
                "x_ohm": 1.0,
                "vm_pu": 1.0,
            },
        },
    }
    assert client.post("/session/commands", json=[add], headers=auth(sid)).status_code == 200
    xwards = client.get("/session", headers=auth(sid)).json()["network"]["xwards"]
    assert [w["id"] for w in xwards] == ["w1"]
    assert xwards[0]["ps_mw"] == pytest.approx(0.02)

    # Edit a field.
    client.post(
        "/session/commands",
        json=[{"op": "update", "payload": {"id": "w1", "kind": "xward", "patch": {"ps_mw": 0.05}}}],
        headers=auth(sid),
    )
    w = client.get("/session", headers=auth(sid)).json()["network"]["xwards"][0]
    assert w["ps_mw"] == pytest.approx(0.05)

    # It solves and reports a result keyed to its uuid.
    run = client.post("/session/run-loadflow", headers=auth(sid)).json()
    assert run["converged"] is True
    assert any(r["id"] == "w1" and r["p_mw"] is not None for r in run["res_xward"])

    # Delete it.
    client.post(
        "/session/commands",
        json=[{"op": "delete", "payload": {"id": "w1", "kind": "xward"}}],
        headers=auth(sid),
    )
    assert client.get("/session", headers=auth(sid)).json()["network"]["xwards"] == []


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
