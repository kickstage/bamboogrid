"""Curated pandapower example networks, generated on demand (never stored).

The catalog is a small whitelist so the API only ever builds a known network —
never an arbitrary pandapower function named by the client. All are kept under
the import bus cap so they stay responsive on the canvas. Each is built fresh on
request from ``pandapower.networks``; nothing is persisted server-side until the
resulting session is edited.
"""

from __future__ import annotations

from typing import Callable

import pandapower.networks as nw

# id -> (label, builder), ordered small → large.
_SCENARIOS: dict[str, tuple[str, Callable[[], object]]] = {
    "example_simple": ("Simple example", nw.example_simple),
    "case9": ("IEEE 9-bus", nw.case9),
    "case14": ("IEEE 14-bus", nw.case14),
    "case30": ("IEEE 30-bus", nw.case30),
    "example_multivoltage": ("Multi-voltage (3W transformer)", nw.example_multivoltage),
}


def list_scenarios() -> list[dict[str, str]]:
    """The catalog as ``[{id, label}]`` for the File ▸ Open example menu."""
    return [{"id": sid, "label": label} for sid, (label, _) in _SCENARIOS.items()]


def build_scenario(scenario_id: str):
    """Build a fresh pandapower net for ``scenario_id`` (named by its label), or
    return ``None`` if the id isn't in the whitelist."""
    entry = _SCENARIOS.get(scenario_id)
    if entry is None:
        return None
    label, builder = entry
    net = builder()
    net.name = label
    return net
