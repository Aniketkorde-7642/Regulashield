from __future__ import annotations

import os
import tempfile
from pathlib import Path

TEST_DIRECTORY = tempfile.TemporaryDirectory(prefix="regula-shield-tests-")
TEST_ROOT = Path(TEST_DIRECTORY.name)
os.environ["DATABASE_URL"] = f"sqlite:///{(TEST_ROOT / 'test.db').as_posix()}"
os.environ["STORAGE_DIR"] = str(TEST_ROOT / "uploads")
os.environ["SECRET_KEY"] = "test-only-secret-key-with-sufficient-length"
os.environ["ADMIN_PASSWORD"] = "test-admin-password"
os.environ["OFFICER_PASSWORD"] = "test-officer-password"
os.environ["REGULATORY_PASSWORD"] = "test-regulatory-password"
os.environ["INSTITUTION_PASSWORD"] = "test-institution-password"
os.environ["COMPLIANCE_ADMIN_PASSWORD"] = "test-compliance-password"

import pytest
from fastapi.testclient import TestClient

from app.db import Base, SessionLocal, engine
from app.main import app
from app.services.security import bootstrap_users


@pytest.fixture()
def client():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        bootstrap_users(db)
    with TestClient(app) as test_client:
        yield test_client
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


@pytest.fixture()
def auth_headers(client: TestClient) -> dict[str, str]:
    response = client.post(
        "/api/auth/login",
        json={"username": "officer", "password": "test-officer-password"},
    )
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['access_token']}"}
