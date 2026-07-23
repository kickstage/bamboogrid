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


def test_shortcircuit_settings_roundtrip_and_undo(client):
    sid = new_session(client)
    build_one_bus(client, sid)

    # Defaults mirror what the short circuit ran with before it was configurable.
    defaults = client.get("/session/shortcircuit-settings", headers=auth(sid)).json()
    assert defaults["fault"] == "3ph"
    assert defaults["case"] == "max"
    assert defaults["ip"] is True

    update = {"fault": "2ph", "case": "min", "ip": False, "ith": True, "tk_s": 2.5}
    res = client.put("/session/shortcircuit-settings", json=update, headers=auth(sid))
    assert res.status_code == 200
    assert res.json()["case"] == "min"

    again = client.get("/session/shortcircuit-settings", headers=auth(sid)).json()
    assert again["fault"] == "2ph"
    assert again["tk_s"] == pytest.approx(2.5)

    # Persisted on the net (user_sc_options) so they round-trip through export.
    assert '"user_sc_options"' in client.get(
        "/session/export", headers=auth(sid)
    ).text


def test_estimation_settings_roundtrip(client):
    sid = new_session(client)
    build_one_bus(client, sid)

    defaults = client.get("/session/estimation-settings", headers=auth(sid)).json()
    assert defaults["algorithm"] == "wls"
    assert defaults["maximum_iterations"] == 50

    update = {
        "algorithm": "wls",
        "init": "results",
        "tolerance": 1e-5,
        "maximum_iterations": 10,
    }
    res = client.put("/session/estimation-settings", json=update, headers=auth(sid))
    assert res.status_code == 200

    again = client.get("/session/estimation-settings", headers=auth(sid)).json()
    assert again["init"] == "results"
    assert again["maximum_iterations"] == 10
    assert '"user_est_options"' in client.get(
        "/session/export", headers=auth(sid)
    ).text


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


def test_shortcircuit_settings_affect_run(client):
    sid = new_session(client)
    _two_bus_grid(client, sid)

    # Turning ip/ith off: the run still succeeds and those columns come back null.
    client.put(
        "/session/shortcircuit-settings",
        json={"fault": "3ph", "case": "max", "ip": False, "ith": False, "tk_s": 1.0},
        headers=auth(sid),
    )
    off = client.post("/session/run-shortcircuit", headers=auth(sid)).json()
    assert off["ok"] is True
    b1_off = next(r for r in off["res_bus"] if r["id"] == "b1")
    assert b1_off["ip_ka"] is None and b1_off["ith_ka"] is None
    assert b1_off["ikss_ka"] > 0

    # The minimum case yields a lower fault current than the maximum case.
    client.put(
        "/session/shortcircuit-settings",
        json={"fault": "3ph", "case": "min", "ip": True, "ith": True, "tk_s": 1.0},
        headers=auth(sid),
    )
    mn = client.post("/session/run-shortcircuit", headers=auth(sid)).json()
    b1_min = next(r for r in mn["res_bus"] if r["id"] == "b1")
    assert b1_min["ip_ka"] is not None
    assert b1_min["ikss_ka"] < b1_off["ikss_ka"]


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


# --- state estimation ------------------------------------------------------


def _measure(mid, meas_type, element_type, element_id, value, std_dev, side=None):
    return {
        "op": "add_measurement",
        "payload": {
            "id": mid,
            "data": {
                "name": "M",
                "meas_type": meas_type,
                "element_type": element_type,
                "element_id": element_id,
                "side": side,
                "value": value,
                "std_dev": std_dev,
            },
        },
    }


def _estimation_grid(client, sid: str) -> None:
    """The textbook 3-bus WLS example: a reference at b1, three lines, and a
    redundant measurement set that is observable and converges."""
    cmds = [
        {"op": "add_bus", "payload": {"id": "b1", "name": "B1", "vn_kv": 1.0, "x": 0, "y": 0, "width": 220}},
        {"op": "add_bus", "payload": {"id": "b2", "name": "B2", "vn_kv": 1.0, "x": 300, "y": 0, "width": 220}},
        {"op": "add_bus", "payload": {"id": "b3", "name": "B3", "vn_kv": 1.0, "x": 600, "y": 0, "width": 220}},
        {"op": "add_element", "payload": {"id": "eg", "kind": "extgrid", "bus_id": "b1", "port": "p0", "x": 0, "y": -100, "data": {"name": "Grid", "vm_pu": 1.0, "va_degree": 0.0}}},
        {"op": "add_line", "payload": {"id": "l12", "from_bus": "b1", "to_bus": "b2", "port_from": "p1", "port_to": "p0", "data": {"name": "L12", "length_km": 1.0, "r_ohm_per_km": 0.01, "x_ohm_per_km": 0.03, "c_nf_per_km": 0.0, "max_i_ka": 1.0, "std_type": ""}}},
        {"op": "add_line", "payload": {"id": "l13", "from_bus": "b1", "to_bus": "b3", "port_from": "p2", "port_to": "p0", "data": {"name": "L13", "length_km": 1.0, "r_ohm_per_km": 0.02, "x_ohm_per_km": 0.05, "c_nf_per_km": 0.0, "max_i_ka": 1.0, "std_type": ""}}},
        {"op": "add_line", "payload": {"id": "l23", "from_bus": "b2", "to_bus": "b3", "port_from": "p1", "port_to": "p1", "data": {"name": "L23", "length_km": 1.0, "r_ohm_per_km": 0.03, "x_ohm_per_km": 0.08, "c_nf_per_km": 0.0, "max_i_ka": 1.0, "std_type": ""}}},
        _measure("m1", "v", "bus", "b1", 1.006, 0.004),
        _measure("m2", "v", "bus", "b2", 0.968, 0.004),
        _measure("m3", "p", "bus", "b2", 0.501, 0.01),
        _measure("m4", "q", "bus", "b2", 0.286, 0.01),
        _measure("m5", "p", "line", "l12", 0.888, 0.008, side="from"),
        _measure("m6", "q", "line", "l12", 0.568, 0.008, side="from"),
        _measure("m7", "p", "line", "l13", 1.173, 0.008, side="from"),
        _measure("m8", "q", "line", "l13", 0.663, 0.008, side="from"),
    ]
    assert client.post("/session/commands", json=cmds, headers=auth(sid)).status_code == 200


def test_run_estimation_reconstructs_voltages(client):
    sid = new_session(client)
    _estimation_grid(client, sid)
    body = client.post("/session/run-estimation", headers=auth(sid)).json()
    assert body["ok"] is True
    by_bus = {r["id"]: r for r in body["res_bus"]}
    assert set(by_bus) == {"b1", "b2", "b3"}
    # The reference bus is held near 1.0 and voltages drop away from it.
    assert 0.99 < by_bus["b1"]["vm_pu"] < 1.01
    assert by_bus["b3"]["vm_pu"] < by_bus["b1"]["vm_pu"]
    # Every measurement gets a normalized residual back for bad-data review.
    assert len(body["residuals"]) == 8
    assert all(r["normalized_residual"] is not None for r in body["residuals"])


def test_estimation_init_from_results_needs_a_load_flow(client):
    sid = new_session(client)
    _estimation_grid(client, sid)
    # Ask the estimator to start from load-flow results without a prior load flow.
    client.put(
        "/session/estimation-settings",
        json={
            "algorithm": "wls",
            "init": "results",
            "tolerance": 1e-6,
            "maximum_iterations": 50,
        },
        headers=auth(sid),
    )
    body = client.post("/session/run-estimation", headers=auth(sid)).json()
    assert body["ok"] is False
    assert "load flow" in body["message"].lower()

    # Running a load flow first populates res_bus, so the estimation then works.
    assert client.post("/session/run-loadflow", headers=auth(sid)).json()["converged"]
    ok = client.post("/session/run-estimation", headers=auth(sid)).json()
    assert ok["ok"] is True


def test_run_estimation_flags_critical_measurements(client):
    """With exactly enough measurements to be observable and no more, every
    measurement is critical: its error is undetectable and it carries no
    normalized residual."""
    sid = new_session(client)
    cmds = [
        {"op": "add_bus", "payload": {"id": "b1", "name": "B1", "vn_kv": 1.0, "x": 0, "y": 0, "width": 220}},
        {"op": "add_bus", "payload": {"id": "b2", "name": "B2", "vn_kv": 1.0, "x": 300, "y": 0, "width": 220}},
        {"op": "add_element", "payload": {"id": "eg", "kind": "extgrid", "bus_id": "b1", "port": "p0", "x": 0, "y": -100, "data": {"name": "Grid", "vm_pu": 1.0, "va_degree": 0.0}}},
        {"op": "add_line", "payload": {"id": "l12", "from_bus": "b1", "to_bus": "b2", "port_from": "p1", "port_to": "p0", "data": {"name": "L12", "length_km": 1.0, "r_ohm_per_km": 0.01, "x_ohm_per_km": 0.03, "c_nf_per_km": 0.0, "max_i_ka": 1.0, "std_type": ""}}},
        # 3 measurements for 3 states (vm_b1, vm_b2, va_b2): observable, no
        # redundancy -> all critical.
        _measure("m1", "v", "bus", "b1", 1.0, 0.004),
        _measure("m2", "v", "bus", "b2", 0.99, 0.004),
        _measure("m3", "p", "line", "l12", 0.1, 0.008, side="from"),
    ]
    assert client.post("/session/commands", json=cmds, headers=auth(sid)).status_code == 200
    body = client.post("/session/run-estimation", headers=auth(sid)).json()
    assert body["ok"] is True
    assert all(r["is_critical"] for r in body["residuals"])
    # A critical measurement has no meaningful normalized residual and is never
    # flagged as the bad one.
    assert all(r["normalized_residual"] is None for r in body["residuals"])
    assert body["bad_data"] is False


def test_jacobian_after_estimation(client):
    sid = new_session(client)
    _estimation_grid(client, sid)
    body = client.post("/session/jacobian", headers=auth(sid)).json()
    assert body["ok"] is True
    # One row per measurement; columns are the states (bus angles + magnitudes).
    assert len(body["rows"]) == 8
    assert {c["kind"] for c in body["cols"]} == {"angle", "magnitude"}
    # 3 buses, ref at b1: 2 angle states + 3 magnitude states.
    kinds = [c["kind"] for c in body["cols"]]
    assert kinds.count("angle") == 2 and kinds.count("magnitude") == 3
    # A voltage measurement's row touches exactly one state (its own |V|).
    v_rows = [i for i, r in enumerate(body["rows"]) if r["meas_type"] == "v"]
    assert v_rows
    for i in v_rows:
        touched = [e for e in body["entries"] if e["i"] == i]
        assert len(touched) == 1
        assert body["cols"][touched[0]["j"]]["kind"] == "magnitude"
    # Rows link back to the measured element for canvas highlighting.
    assert all(r["ids"] for r in body["rows"])


def test_jacobian_without_estimation_reports_message(client):
    sid = new_session(client)
    build_one_bus(client, sid)  # a bus but no measurements
    body = client.post("/session/jacobian", headers=auth(sid)).json()
    assert body["ok"] is False
    assert "measurement" in body["message"].lower()
    assert body["entries"] == []


def test_measurements_roundtrip_in_view(client):
    sid = new_session(client)
    _estimation_grid(client, sid)
    network = client.get("/session", headers=auth(sid)).json()["network"]
    assert len(network["measurements"]) == 8
    v_on_b1 = [
        m
        for m in network["measurements"]
        if m["element_id"] == "b1" and m["meas_type"] == "v"
    ]
    assert len(v_on_b1) == 1 and v_on_b1[0]["value"] == 1.006


def test_update_and_delete_measurement(client):
    sid = new_session(client)
    _estimation_grid(client, sid)
    client.post(
        "/session/commands",
        json=[{"op": "update_measurement", "payload": {"id": "m1", "patch": {"value": 1.02, "std_dev": 0.005}}}],
        headers=auth(sid),
    )
    client.post(
        "/session/commands",
        json=[{"op": "delete_measurement", "payload": {"id": "m8"}}],
        headers=auth(sid),
    )
    measurements = client.get("/session", headers=auth(sid)).json()["network"]["measurements"]
    assert len(measurements) == 7
    m1 = next(m for m in measurements if m["id"] == "m1")
    assert m1["value"] == 1.02 and m1["std_dev"] == 0.005
    assert all(m["id"] != "m8" for m in measurements)


def test_deleting_bus_cascades_measurements(client):
    sid = new_session(client)
    _estimation_grid(client, sid)
    # Deleting b2 drops it, the lines touching it, and every measurement on those.
    client.post(
        "/session/commands",
        json=[{"op": "delete", "payload": {"kind": "bus", "id": "b2"}}],
        headers=auth(sid),
    )
    measurements = client.get("/session", headers=auth(sid)).json()["network"]["measurements"]
    # Survivors: b1 voltage (m1), and the l13 flows (m7, m8) — l13 is b1↔b3.
    assert {m["id"] for m in measurements} == {"m1", "m7", "m8"}


def test_se_demo_scenario_runs_estimation(client):
    # The bundled "State estimation demo" opens with a full measurement set and
    # estimates cleanly out of the box.
    res = client.post("/session/scenario/se_demo")
    assert res.status_code == 200
    sid = res.json()["id"]
    network = client.get("/session", headers=auth(sid)).json()["network"]
    assert len(network["measurements"]) == 35
    # Includes measurements on two- and three-winding transformers, not just
    # buses and lines.
    meas_types = {m["element_type"] for m in network["measurements"]}
    assert {"trafo", "trafo3w"} <= meas_types
    # The 3W transformer is metered on all three windings.
    t3w_sides = {
        m["side"] for m in network["measurements"] if m["element_type"] == "trafo3w"
    }
    assert t3w_sides == {"hv", "mv", "lv"}
    body = client.post("/session/run-estimation", headers=auth(sid)).json()
    assert body["ok"] is True
    assert body["bad_data"] is False
    assert len(body["res_bus"]) == 7
    assert all(0.95 < r["vm_pu"] < 1.03 for r in body["res_bus"])


def test_estimation_flags_single_bad_measurement(client):
    # Corrupting one voltage inflates several residuals (smearing), but only the
    # worst one — the corrupted measurement — is flagged bad.
    res = client.post("/session/scenario/se_demo")
    sid = res.json()["id"]
    measurements = client.get("/session", headers=auth(sid)).json()["network"]["measurements"]
    bad = next(m for m in measurements if m["meas_type"] == "v")
    client.post(
        "/session/commands",
        json=[{"op": "update_measurement", "payload": {"id": bad["id"], "patch": {"value": 1.15}}}],
        headers=auth(sid),
    )
    body = client.post("/session/run-estimation", headers=auth(sid)).json()
    assert body["ok"] is True
    assert body["bad_data"] is True
    flagged = [r for r in body["residuals"] if r["is_bad"]]
    assert len(flagged) == 1
    assert flagged[0]["id"] == bad["id"]
    # The flagged one has the largest normalized residual of all.
    worst = max(body["residuals"], key=lambda r: r["normalized_residual"] or 0)
    assert worst["id"] == bad["id"]


def test_disabled_measurement_kept_but_excluded(client):
    # Toggling a measurement off keeps it in the model but drops it from the
    # solve — no need to delete and re-enter it.
    res = client.post("/session/scenario/se_demo")
    sid = res.json()["id"]
    measurements = client.get("/session", headers=auth(sid)).json()["network"]["measurements"]
    total = len(measurements)
    target = measurements[0]["id"]

    client.post(
        "/session/commands",
        json=[{"op": "update_measurement", "payload": {"id": target, "patch": {"enabled": False}}}],
        headers=auth(sid),
    )
    after = client.get("/session", headers=auth(sid)).json()["network"]["measurements"]
    # Still present (not deleted), just flagged off.
    assert len(after) == total
    assert next(m for m in after if m["id"] == target)["enabled"] is False

    body = client.post("/session/run-estimation", headers=auth(sid)).json()
    assert body["ok"] is True
    # The disabled measurement contributes no residual.
    assert len(body["residuals"]) == total - 1
    assert all(r["id"] != target for r in body["residuals"])

    # Re-enabling brings it back into the solve.
    client.post(
        "/session/commands",
        json=[{"op": "update_measurement", "payload": {"id": target, "patch": {"enabled": True}}}],
        headers=auth(sid),
    )
    body = client.post("/session/run-estimation", headers=auth(sid)).json()
    assert len(body["residuals"]) == total


def test_run_estimation_without_measurements_fails(client):
    sid = new_session(client)
    build_one_bus(client, sid)
    body = client.post("/session/run-estimation", headers=auth(sid)).json()
    assert body["ok"] is False
    assert body["message"]
    assert body["res_bus"] == []


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


def test_setting_tap_position_keeps_the_preset(client):
    # tap_pos is an operating setpoint, not part of the std_type definition, so
    # moving the tap is sent as a bare column write and must leave the preset
    # label intact (unlike editing any electrical param, which makes it custom).
    sid = new_session(client)
    _two_bus_trafo(client, sid)
    std_type = _trafo(client, sid)["std_type"]
    assert std_type  # started life as a recognized preset

    patch = {"op": "update", "payload": {"id": "t1", "kind": "trafo2w",
        "patch": {"tap_pos": 2}}}
    assert client.post("/session/commands", json=[patch], headers=auth(sid)).status_code == 200

    t = _trafo(client, sid)
    assert t["std_type"] == std_type  # preset survived
    assert t["params"]["tap_pos"] == pytest.approx(2)


def test_std_types_include_tap_changer(client):
    # The catalog must forward a preset's tap changer so the inspector can show
    # and edit it (the default distribution transformer has a ratio tap changer).
    p = client.get("/std-types/trafo").json()["0.25 MVA 20/0.4 kV"]
    assert p.get("tap_changer_type") == "Ratio"
    assert p.get("tap_side") in ("hv", "lv")
    assert "tap_step_percent" in p


def test_phase_shifter_tap_changer_round_trips_and_solves(client):
    sid = new_session(client)
    _two_bus_trafo(client, sid)
    # A slack source on the HV bus and a load on the LV bus so the net solves.
    grid = [
        {"op": "add_element", "payload": {"id": "g1", "kind": "generator", "bus_id": "b1",
            "port": "p1", "x": -100, "y": 0,
            "data": {"name": "Slack", "p_mw": 0.0, "vm_pu": 1.0, "slack": True, "slack_weight": 1.0}}},
        {"op": "add_element", "payload": {"id": "l1", "kind": "load", "bus_id": "b2",
            "port": "p1", "x": 0, "y": 400,
            "data": {"name": "Load", "p_mw": 0.05, "q_mvar": 0.01}}},
    ]
    assert client.post("/session/commands", json=grid, headers=auth(sid)).status_code == 200

    # Turn the transformer into an ideal phase shifter, tapped off neutral.
    params = _trafo(client, sid)["params"]
    params["tap_changer_type"] = "Ideal"
    params["tap_step_degree"] = 5.0
    params["tap_step_percent"] = 0.0  # an ideal phase shifter is pure angle
    params["tap_pos"] = (params["tap_neutral"] or 0) + 1
    patch = {"op": "update", "payload": {"id": "t1", "kind": "trafo2w",
        "patch": {"std_type": "", "params": params}}}
    assert client.post("/session/commands", json=[patch], headers=auth(sid)).status_code == 200

    t = _trafo(client, sid)
    assert t["params"]["tap_changer_type"] == "Ideal"
    assert t["params"]["tap_step_degree"] == pytest.approx(5.0)

    # It actually solves with the phase shifter active...
    run = client.post("/session/run-loadflow", headers=auth(sid))
    assert run.status_code == 200
    assert run.json()["converged"] is True
    # ...and the tap changer survives an export round-trip.
    assert "Ideal" in client.get("/session/export", headers=auth(sid)).text


def _three_bus_trafo3w(
    client, sid: str, std_type: str = "63/25/38 MVA 110/20/10 kV"
) -> None:
    """110/20/10 kV buses joined by a std_type 3W transformer."""
    cmds = [
        {"op": "add_bus", "payload": {"id": "b1", "name": "HV", "vn_kv": 110.0, "x": 0, "y": 0, "width": 220}},
        {"op": "add_bus", "payload": {"id": "b2", "name": "MV", "vn_kv": 20.0, "x": 0, "y": 200, "width": 220}},
        {"op": "add_bus", "payload": {"id": "b3", "name": "LV", "vn_kv": 10.0, "x": 200, "y": 200, "width": 220}},
        {"op": "add_transformer3w", "payload": {"id": "t1", "hv_bus": "b1", "mv_bus": "b2", "lv_bus": "b3",
            "std_type": std_type, "port_hv": "", "port_mv": "", "port_lv": ""}},
    ]
    assert client.post("/session/commands", json=cmds, headers=auth(sid)).status_code == 200


def _trafo3w(client, sid: str) -> dict:
    return client.get("/session", headers=auth(sid)).json()["network"]["transformers3w"][0]


def test_setting_tap_position_keeps_the_preset_3w(client):
    # As for the 2W transformer: tap_pos is an operating setpoint sent as a bare
    # column write, so it must leave the preset label intact.
    sid = new_session(client)
    _three_bus_trafo3w(client, sid)
    std_type = _trafo3w(client, sid)["std_type"]
    assert std_type  # started life as a recognized preset

    patch = {"op": "update", "payload": {"id": "t1", "kind": "trafo3w",
        "patch": {"tap_pos": 2}}}
    assert client.post("/session/commands", json=[patch], headers=auth(sid)).status_code == 200

    t = _trafo3w(client, sid)
    assert t["std_type"] == std_type  # preset survived
    assert t["params"]["tap_pos"] == pytest.approx(2)


def test_std_types_3w_include_tap_changer(client):
    # The catalog must forward a 3W preset's tap changer too (the default
    # 110/20/10 kV transformer has a ratio tap changer on the HV winding).
    p = client.get("/std-types/trafo3w").json()["63/25/38 MVA 110/20/10 kV"]
    assert p.get("tap_changer_type") == "Ratio"
    assert p.get("tap_side") in ("hv", "mv", "lv")
    assert "tap_step_percent" in p


def test_phase_shifter_tap_changer_round_trips_and_solves_3w(client):
    sid = new_session(client)
    _three_bus_trafo3w(client, sid)
    # A slack source on the HV bus and loads on the MV and LV buses so it solves.
    grid = [
        {"op": "add_element", "payload": {"id": "g1", "kind": "generator", "bus_id": "b1",
            "port": "p1", "x": -100, "y": 0,
            "data": {"name": "Slack", "p_mw": 0.0, "vm_pu": 1.0, "slack": True, "slack_weight": 1.0}}},
        {"op": "add_element", "payload": {"id": "l1", "kind": "load", "bus_id": "b2",
            "port": "p1", "x": 0, "y": 400,
            "data": {"name": "MV Load", "p_mw": 5.0, "q_mvar": 1.0}}},
        {"op": "add_element", "payload": {"id": "l2", "kind": "load", "bus_id": "b3",
            "port": "p1", "x": 200, "y": 400,
            "data": {"name": "LV Load", "p_mw": 3.0, "q_mvar": 0.5}}},
    ]
    assert client.post("/session/commands", json=grid, headers=auth(sid)).status_code == 200

    # Turn the transformer into an ideal phase shifter, tapped off neutral.
    params = _trafo3w(client, sid)["params"]
    params["tap_changer_type"] = "Ideal"
    params["tap_step_degree"] = 5.0
    params["tap_step_percent"] = 0.0  # an ideal phase shifter is pure angle
    params["tap_pos"] = (params["tap_neutral"] or 0) + 1
    patch = {"op": "update", "payload": {"id": "t1", "kind": "trafo3w",
        "patch": {"std_type": "", "params": params}}}
    assert client.post("/session/commands", json=[patch], headers=auth(sid)).status_code == 200

    t = _trafo3w(client, sid)
    assert t["params"]["tap_changer_type"] == "Ideal"
    assert t["params"]["tap_step_degree"] == pytest.approx(5.0)

    # It actually solves with the phase shifter active...
    run = client.post("/session/run-loadflow", headers=auth(sid))
    assert run.status_code == 200
    assert run.json()["converged"] is True
    # ...and the tap changer survives an export round-trip.
    assert "Ideal" in client.get("/session/export", headers=auth(sid)).text


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


def _two_bus_svc_grid(client, sid: str) -> None:
    """Two 110 kV buses tied by a line, an ext-grid slack on b1 and a load on b2
    that sags b2's voltage — the setup an SVC on b2 can visibly regulate."""
    cmds = [
        {"op": "add_bus", "payload": {"id": "b1", "name": "Slack", "vn_kv": 110.0, "x": 0, "y": 0, "width": 220}},
        {"op": "add_bus", "payload": {"id": "b2", "name": "Load bus", "vn_kv": 110.0, "x": 0, "y": 300, "width": 220}},
        {"op": "add_element", "payload": {"id": "eg", "kind": "extgrid", "bus_id": "b1", "port": "p0",
            "x": 0, "y": -100, "data": {"name": "Grid", "vm_pu": 1.0, "va_degree": 0.0}}},
        {"op": "add_line", "payload": {"id": "ln", "from_bus": "b1", "to_bus": "b2", "port_from": "p1", "port_to": "p0",
            "data": {"name": "Line", "length_km": 50.0, "r_ohm_per_km": 0.1, "x_ohm_per_km": 0.3,
                     "c_nf_per_km": 10.0, "max_i_ka": 0.5, "std_type": ""}}},
        {"op": "add_element", "payload": {"id": "l1", "kind": "load", "bus_id": "b2", "port": "p1",
            "x": 0, "y": 400, "data": {"name": "Load", "p_mw": 20.0, "q_mvar": 8.0}}},
    ]
    assert client.post("/session/commands", json=cmds, headers=auth(sid)).status_code == 200


def test_svc_create_edit_delete_and_regulates(client):
    sid = new_session(client)
    _two_bus_svc_grid(client, sid)
    # Without support, b2 sags below 1.0.
    base = client.post("/session/run-loadflow", headers=auth(sid)).json()
    b2_sag = next(r["vm_pu"] for r in base["res_bus"] if r["id"] == "b2")
    assert b2_sag < 0.99

    # Add an SVC on b2, set to hold 1.0 p.u.
    add = {"op": "add_element", "payload": {"id": "s1", "kind": "svc", "bus_id": "b2", "port": "p2",
        "x": 150, "y": 300, "data": {"name": "SVC", "set_vm_pu": 1.0, "x_l_ohm": 1.0,
            "x_cvar_ohm": -10.0, "thyristor_firing_angle_degree": 145.0,
            "min_angle_degree": 90.0, "max_angle_degree": 180.0, "controllable": True}}}
    assert client.post("/session/commands", json=[add], headers=auth(sid)).status_code == 200
    view = client.get("/session", headers=auth(sid)).json()
    svcs = view["network"]["svcs"]
    assert [v["id"] for v in svcs] == ["s1"]
    assert svcs[0]["set_vm_pu"] == pytest.approx(1.0)
    # It's a modeled element, not surfaced as a foreign passthrough.
    assert view["foreign"] == []

    # It regulates b2 back up to (near) the setpoint and reports a result.
    run = client.post("/session/run-loadflow", headers=auth(sid)).json()
    assert run["converged"] is True
    b2_reg = next(r["vm_pu"] for r in run["res_bus"] if r["id"] == "b2")
    assert b2_reg == pytest.approx(1.0, abs=1e-3)
    res = next(r for r in run["res_svc"] if r["id"] == "s1")
    assert res["q_mvar"] is not None and res["vm_pu"] == pytest.approx(1.0, abs=1e-3)

    # Edit the setpoint; it holds the new value.
    client.post("/session/commands", json=[{"op": "update", "payload": {"id": "s1", "kind": "svc",
        "patch": {"set_vm_pu": 1.02}}}], headers=auth(sid))
    assert client.get("/session", headers=auth(sid)).json()["network"]["svcs"][0]["set_vm_pu"] == pytest.approx(1.02)
    run2 = client.post("/session/run-loadflow", headers=auth(sid)).json()
    b2_reg2 = next(r["vm_pu"] for r in run2["res_bus"] if r["id"] == "b2")
    assert b2_reg2 == pytest.approx(1.02, abs=1e-3)

    # It survives an export round-trip.
    assert '"svc"' in client.get("/session/export", headers=auth(sid)).text

    # Delete it.
    client.post("/session/commands", json=[{"op": "delete", "payload": {"id": "s1", "kind": "svc"}}], headers=auth(sid))
    assert client.get("/session", headers=auth(sid)).json()["network"]["svcs"] == []


def test_deleting_a_bus_cascades_its_svc(client):
    # pandapower's drop_buses cascade doesn't cover FACTS tables, so a bus delete
    # used to orphan the SVC (pointing at a removed bus) and crash projection.
    sid = new_session(client)
    cmds = [
        {"op": "add_bus", "payload": {"id": "b1", "name": "Bus", "vn_kv": 110.0, "x": 0, "y": 0, "width": 220}},
        {"op": "add_element", "payload": {"id": "s1", "kind": "svc", "bus_id": "b1", "port": "p0",
            "x": 150, "y": 0, "data": {"name": "SVC", "set_vm_pu": 1.0, "x_l_ohm": 1.0,
                "x_cvar_ohm": -10.0, "thyristor_firing_angle_degree": 145.0,
                "min_angle_degree": 90.0, "max_angle_degree": 180.0, "controllable": True}}},
    ]
    assert client.post("/session/commands", json=cmds, headers=auth(sid)).status_code == 200
    assert len(client.get("/session", headers=auth(sid)).json()["network"]["svcs"]) == 1

    # Delete the bus the SVC hangs on — the SVC must go with it, and the session
    # must still project (no 500).
    r = client.post("/session/commands", json=[{"op": "delete", "payload": {"id": "b1", "kind": "bus"}}], headers=auth(sid))
    assert r.status_code == 200
    view = client.get("/session", headers=auth(sid))
    assert view.status_code == 200
    net = view.json()["network"]
    assert net["buses"] == [] and net["svcs"] == []


def test_regulating_svc_on_fixed_voltage_bus_gives_clear_error(client):
    # A controllable SVC on the ext-grid (slack) bus collides with the fixed slack
    # voltage; pandapower's FACTS solver then dies with an opaque scipy error. We
    # catch it up front with a clear, actionable message instead.
    sid = new_session(client)
    cmds = [
        {"op": "add_bus", "payload": {"id": "hv", "name": "HV", "vn_kv": 110.0, "x": 0, "y": 0, "width": 220}},
        {"op": "add_bus", "payload": {"id": "lv", "name": "LV", "vn_kv": 20.0, "x": 0, "y": 300, "width": 220}},
        {"op": "add_element", "payload": {"id": "eg", "kind": "extgrid", "bus_id": "hv", "port": "p0",
            "x": 0, "y": -100, "data": {"name": "Grid", "vm_pu": 1.0, "va_degree": 0.0}}},
        {"op": "add_transformer", "payload": {"id": "t1", "hv_bus": "hv", "lv_bus": "lv",
            "std_type": "63 MVA 110/20 kV", "port_hv": "p1", "port_lv": "p0"}},
        {"op": "add_element", "payload": {"id": "l1", "kind": "load", "bus_id": "lv", "port": "p1",
            "x": 0, "y": 400, "data": {"name": "Load", "p_mw": 30.0, "q_mvar": 10.0}}},
        {"op": "add_element", "payload": {"id": "s1", "kind": "svc", "bus_id": "hv", "port": "p2",
            "x": 150, "y": 0, "data": {"name": "HV SVC", "set_vm_pu": 1.0, "x_l_ohm": 1.0,
                "x_cvar_ohm": -10.0, "thyristor_firing_angle_degree": 145.0,
                "min_angle_degree": 90.0, "max_angle_degree": 180.0, "controllable": True}}},
    ]
    assert client.post("/session/commands", json=cmds, headers=auth(sid)).status_code == 200

    run = client.post("/session/run-loadflow", headers=auth(sid)).json()
    assert run["converged"] is False
    msg = run["message"]
    assert "HV SVC" in msg and "Regulate voltage" in msg
    # The opaque solver error must not leak through.
    assert "index and data arrays" not in msg

    # Turning off regulation makes it a plain susceptance, which solves fine.
    client.post("/session/commands", json=[{"op": "update", "payload": {"id": "s1", "kind": "svc",
        "patch": {"controllable": False}}}], headers=auth(sid))
    assert client.post("/session/run-loadflow", headers=auth(sid)).json()["converged"] is True


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
