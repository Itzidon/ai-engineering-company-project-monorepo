from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from services.api import database
from services.api.main import app
from scripts.seed_incidents import seed


@pytest.fixture
def client(tmp_path, monkeypatch):
    database.close_db()
    monkeypatch.setenv(
        "SUPPLIERS_DB_PATH",
        str(tmp_path / "incidents.json"),
    )

    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client

    database.close_db()


def example_incident():
    return {
        "title": "Horno averiado",
        "description": "El horno principal no funciona.",
        "category": "equipment_failure",
        "status": "open",
        "origin": "branch",
        "branch": "medellin_centro",
    }


def test_empty_database(client):
    response = client.get("/api/incidents")
    assert response.status_code == 200
    assert response.json() == []

    summary = client.get("/api/incidents/summary")
    assert summary.status_code == 200
    assert summary.json()["total"] == 0


def test_create_and_filter(client):
    response = client.post(
        "/api/incidents",
        json=example_incident(),
    )
    assert response.status_code == 201

    incident = response.json()
    assert incident["id"] > 0
    assert incident["created_at"]
    assert incident["updated_at"]

    filtered = client.get(
        "/api/incidents",
        params={
            "status": "open",
            "origin": "branch",
            "branch": "medellin_centro",
            "category": "equipment_failure",
        },
    )

    assert filtered.status_code == 200
    assert len(filtered.json()) == 1


def test_invalid_data(client):
    data = example_incident()
    del data["title"]

    response = client.post("/api/incidents", json=data)

    assert response.status_code == 400
    assert response.json()["detail"]["field"] == "title"

    data = example_incident()
    data["category"] = "invalid_category"

    response = client.post("/api/incidents", json=data)

    assert response.status_code == 400
    assert response.json()["detail"]["field"] == "category"


def test_status_transitions(client):
    created = client.post(
        "/api/incidents",
        json=example_incident(),
    ).json()

    url = f"/api/incidents/{created['id']}/status"

    assert client.patch(
        url, json={"status": "resolved"}
    ).status_code == 400

    assert client.patch(
        url, json={"status": "in_progress"}
    ).status_code == 200

    assert client.patch(
        url, json={"status": "resolved"}
    ).status_code == 200

    assert client.patch(
        url, json={"status": "discarded"}
    ).status_code == 400

    assert client.get(
        "/api/incidents/999999"
    ).status_code == 404


def test_historical_seed_is_idempotent(client):
    seed()

    first = client.get("/api/incidents/summary").json()

    assert first["total"] == 96
    assert first["by_status"] == {
        "open": 32,
        "resolved": 50,
        "discarded": 14,
    }

    assert first["by_category"] == {
        "customer_complaint": 48,
        "equipment_failure": 17,
        "supply_issue": 22,
        "staff_issue": 9,
    }

    seed()

    second = client.get("/api/incidents/summary").json()
    assert second == first


def test_unexpected_error_is_safe(client, caplog):
    with patch(
        "services.api.routes.incidents.db.list_incidents",
        side_effect=RuntimeError("SECRETO_INTERNO"),
    ):
        response = client.get("/api/incidents")

    assert response.status_code == 500
    assert "SECRETO_INTERNO" not in response.text
    assert "Traceback" not in response.text
    assert "SECRETO_INTERNO" not in caplog.text
    assert "Traceback" not in caplog.text
    assert response.json() == {
        "detail": {
            "code": "internal_error",
            "message": "Se produjo un error interno.",
        }
    }


def test_request_validation_error_does_not_echo_sensitive_input(client):
    response = client.post("/users", json={
        "email": "not-an-email",
        "password": "ClavePrivada123!",
    })

    assert response.status_code == 422
    assert "ClavePrivada123!" not in response.text
    assert "input" not in response.text
    assert response.json()["detail"][0]["loc"] == ["body", "email"]


def test_minimal_incident_and_single_record_summary(client):
    payload = example_incident()
    payload.update(title="X", description="Y")
    del payload["status"]
    response = client.post("/api/incidents", json=payload)
    assert response.status_code == 201
    created = response.json()
    assert created["status"] == "open"
    retrieved = client.get(f"/api/incidents/{created['id']}")
    assert retrieved.status_code == 200
    assert retrieved.json() == created
    summary = client.get("/api/incidents/summary")
    assert summary.status_code == 200
    assert summary.json() == {
        "total": 1, "by_status": {"open": 1},
        "by_category": {"equipment_failure": 1}, "by_origin": {"branch": 1},
        "by_branch": {"medellin_centro": 1},
    }
    assert client.get("/api/incidents",
                      params={"status": "resolved"}).json() == []


@pytest.mark.parametrize("field,value", [
    ("title", ""), ("title", "   "), ("description", ""), ("description", "   "),
    ("origin", "invalid"), ("branch", "invalid"), ("status", "invalid"),
    ("unexpected", "field"),
])
def test_incident_creation_boundaries_and_invalid_values(client, field, value):
    payload = example_incident()
    payload[field] = value
    assert client.post("/api/incidents", json=payload).status_code == 400
    assert client.get("/api/incidents").json() == []


@pytest.mark.parametrize("field", ["status", "origin", "branch", "category"])
def test_incident_invalid_filters(client, field):
    response = client.get("/api/incidents", params={field: "invalid"})
    assert response.status_code == 400
    assert response.json()["detail"]["field"] == field


@pytest.mark.parametrize("identifier,status", [("abc", 400), ("0", 404), ("99999", 404)])
def test_incident_identifier_boundaries(client, identifier, status):
    assert client.get(f"/api/incidents/{identifier}").status_code == status
    assert client.patch(f"/api/incidents/{identifier}/status",
                        json={"status": "in_progress"}).status_code == status


def test_incident_status_noop_invalid_and_terminal_boundaries(client):
    created = client.post("/api/incidents", json=example_incident()).json()
    url = f"/api/incidents/{created['id']}/status"
    for payload in ({}, {"status": "invalid"}, {"status": "open"}):
        assert client.patch(url, json=payload).status_code == 400
    assert client.get(f"/api/incidents/{created['id']}").json() == created
    discarded = client.patch(url, json={"status": "discarded"})
    assert discarded.status_code == 200
    assert discarded.json()["status"] == "discarded"
    assert client.patch(url, json={"status": "open"}).status_code == 400


@pytest.mark.parametrize("method,path,target,payload", [
    ("POST", "/api/incidents", "create_incident", example_incident()),
    ("GET", "/api/incidents/summary", "get_incidents_summary", None),
    ("GET", "/api/incidents/1", "get_incident", None),
    ("PATCH", "/api/incidents/1/status",
     "get_incident", {"status": "in_progress"}),
])
def test_incident_endpoint_internal_failures_are_safe(client, caplog, method, path, target, payload):
    with patch(f"services.api.routes.incidents.db.{target}",
               side_effect=OSError("PRIVATE_DATABASE_PATH")):
        response = client.request(method, path, json=payload)
    assert response.status_code == 500
    assert response.json()["detail"]["code"] == "internal_error"
    assert "PRIVATE_DATABASE_PATH" not in response.text + caplog.text
    assert "Traceback" not in response.text + caplog.text


def test_root_contract_and_unsupported_method(client):
    response = client.get("/")
    assert response.status_code == 200
    assert response.json() == {
        "message": "Brasaland API", "suppliers": "/suppliers",
        "incidents": "/api/incidents", "docs": "/docs",
    }
    assert client.post("/").status_code == 405
    assert client.get("/unknown-route").status_code == 404
