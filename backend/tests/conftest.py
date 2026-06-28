"""Test fixtures for the PostgreSQL-backed session store.

``DATABASE_URL`` must be set before ``app.session`` is imported (the module-level
``store`` connects on import). CI provides it via a Postgres service; locally we
spin up an ephemeral container with testcontainers. Setting it here at conftest
import time guarantees it is in place before any test module imports the app.
"""

import os

import psycopg
import pytest

_container = None
if not os.getenv("DATABASE_URL"):
    from testcontainers.postgres import PostgresContainer

    _container = PostgresContainer("postgres:16-alpine", driver=None)
    _container.start()
    os.environ["DATABASE_URL"] = _container.get_connection_url()


def pytest_unconfigure(config) -> None:
    if _container is not None:
        _container.stop()


@pytest.fixture(autouse=True)
def _clean_db():
    """Each test starts against an empty database."""
    # Importing here ensures the store has created its tables first.
    import app.session  # noqa: F401

    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        conn.execute("TRUNCATE sessions, shares")
    yield
