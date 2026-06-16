"""Simple file-per-network persistence under ``backend/data/``.

Deliberately minimal for iteration 1; swap for SQLite later without touching
the API surface.
"""

from __future__ import annotations

from pathlib import Path

from .schema import Network, NetworkSummary

DATA_DIR = Path(__file__).resolve().parent.parent / "data"


def _path(network_id: str) -> Path:
    # network ids are server-generated uuids, so no path-traversal concern.
    return DATA_DIR / f"{network_id}.json"


def save(network: Network) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    _path(network.id).write_text(network.model_dump_json(indent=2))


def load(network_id: str) -> Network | None:
    path = _path(network_id)
    if not path.exists():
        return None
    return Network.model_validate_json(path.read_text())


def delete(network_id: str) -> bool:
    path = _path(network_id)
    if not path.exists():
        return False
    path.unlink()
    return True


def list_all() -> list[NetworkSummary]:
    if not DATA_DIR.exists():
        return []
    summaries: list[NetworkSummary] = []
    for path in sorted(DATA_DIR.glob("*.json")):
        net = Network.model_validate_json(path.read_text())
        summaries.append(NetworkSummary(id=net.id, name=net.name))
    return summaries
