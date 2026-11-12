from datetime import datetime, timezone
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine, select

from services.api.auth.security import get_current_user
from services.api.main import app
from services.api.routes.telemetry import TELEMETRY_TABLE
from services.database import get_db
from services.models import Ingredient, IngredientEntry, IngredientExit
from services.price_variance import detect_price_variance


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "")
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    SQLModel.metadata.create_all(engine)
    TELEMETRY_TABLE.create(engine)
    with Session(engine) as session:
        session.add(Ingredient(
            id=1, name="Controlled ingredient", sku="CONTROL-1", unit="kg",
            category="meat", country="CO",
        ))
        session.commit()

        def isolated_db():
            yield session

        app.dependency_overrides[get_db] = isolated_db
        app.dependency_overrides[get_current_user] = lambda: {
            "id": 1, "uuid": str(uuid4())}
        try:
            with TestClient(app) as test_client:
                yield test_client, session
        finally:
            app.dependency_overrides.clear()
    engine.dispose()


def event(event_type="inbound_order_created", **properties):
    common = {
        "location_id": 1, "country": "CO", "product_id": 1,
        "product_category": "meat", "quantity": 2, "unit": "kg", "currency": "COP",
    }
    common.update(properties)
    return {
        "eventId": str(uuid4()), "timestamp": datetime.now(timezone.utc).isoformat(),
        "sessionId": "controlled-session-001", "userId": None,
        "event_type": event_type, "schemaVersion": "1.0.0",
        "requestId": str(uuid4()), "properties": common,
    }


@pytest.mark.parametrize("event_type,properties", [
    ("inbound_order_created", {"inbound_order_id": 1}),
    ("outbound_order_created", {
     "outbound_order_id": 1, "reason": "consumption"}),
    ("stock_waste_registered", {"outbound_order_id": 1, "reason": "expired"}),
    ("stock_threshold_triggered", {
     "outbound_order_id": 1, "threshold_quantity": 9, "previous_stock": 10}),
    ("direct_stock_edit_rejected", {
     "attempted_operation": "direct_set", "rejection_code": "forbidden_direct_update"}),
    ("ingredient_price_variance_detected", {"inbound_order_id": 1, "supplier_key": "a" * 64,
                                            "unit_cost": 120, "baseline_unit_cost": 100, "variance_pct": 20, "threshold_pct": 10}),
])
def test_six_events_return_http_200(client, event_type, properties):
    response = client[0].post(
        "/telemetry/events", json={"events": [event(event_type, **properties)]})
    assert response.status_code == 200
    assert response.json() == {"received": 1, "stored": 1, "rejected": 0}


@pytest.mark.parametrize("change", [
    {"event_type": "unknown_event"}, {"schemaVersion": "2.0.0"},
    {"eventId": "not-a-uuid"}, {"timestamp": "not-a-date"},
    {"userId": "person@example.com"}, {"extra": "forbidden"},
    {"properties": {"email": "person@example.com"}},
    {"properties": {"inbound_order_id": 1}},
])
def test_invalid_envelope_is_rejected(client, change):
    payload = event(inbound_order_id=1)
    payload.update(change)
    response = client[0].post("/telemetry/events", json={"events": [payload]})
    assert response.status_code == 200
    assert response.json() == {"received": 1, "stored": 0, "rejected": 1}
    assert "person@example.com" not in response.text


def test_batch_limits_and_country_currency(client):
    payload = event(inbound_order_id=1)
    for batch in ([], [payload] * 21):
        assert client[0].post("/telemetry/events",
                              json={"events": batch}).status_code == 422
    assert client[0].post("/telemetry/events",
                          json={"events": [payload] * 20}).status_code == 200
    payload["properties"]["currency"] = "USD"
    response = client[0].post("/telemetry/events", json={"events": [payload]})
    assert response.status_code == 200
    assert response.json() == {"received": 1, "stored": 0, "rejected": 1}


@pytest.mark.parametrize("supplier_key", ["PrivateName", "person@example.com"])
def test_supplier_identifier_cannot_carry_names_or_email(client, supplier_key):
    payload = event(inbound_order_id=1, supplier_key=supplier_key)
    response = client[0].post("/telemetry/events", json={"events": [payload]})
    assert response.status_code == 200
    assert response.json() == {"received": 1, "stored": 0, "rejected": 1}


def test_inventory_routes_prices_and_rejection_without_stock_mutation(client):
    http, session = client
    assert http.get("/inventory/products").status_code == 200
    data = {"ingredient_id": 1, "location_id": 1, "quantity": 10,
            "supplier_name": "Controlled supplier", "unit_cost": 100}
    first = http.post("/inventory/orders/inbound", json=data)
    assert first.status_code == 201
    assert first.json()["baseline_unit_cost"] is None
    second = http.post("/inventory/orders/inbound",
                       json={**data, "unit_cost": 120})
    assert second.status_code == 201
    assert second.json()["baseline_unit_cost"] == 100
    assert second.json()["variance_pct"] == 20
    other = http.post("/inventory/orders/inbound",
                      json={**data, "supplier_name": "Other supplier"})
    assert other.json()["baseline_unit_cost"] is None
    stock_path = "/inventory/products/1/locations/1/stock"
    before = http.get(stock_path).json()
    rejected = http.patch(stock_path, json={"current_stock": 999})
    assert rejected.status_code == 403
    assert rejected.json()["detail"] == {
        "code": "forbidden_direct_update", "product_id": 1, "location_id": 1,
        "country": "CO", "product_category": "meat", "unit": "kg",
    }
    assert http.get(stock_path).json() == before
    assert len(session.exec(select(IngredientEntry)).all()) == 3
    assert len(session.exec(select(IngredientExit)).all()) == 0
    outbound = http.post("/inventory/orders/outbound", json={
        "ingredient_id": 1, "location_id": 1, "quantity": 22, "reason": "consumption",
    })
    assert outbound.status_code == 201
    assert outbound.json()["previous_stock"] == 30
    assert outbound.json()["current_stock"] == 8
    assert http.get(stock_path).json()["current_stock"] == 8
    assert http.post("/inventory/orders/outbound", json={
        "ingredient_id": 1, "location_id": 1, "quantity": 9, "reason": "waste",
    }).status_code == 400
    assert http.get(stock_path).json()["current_stock"] == 8


@pytest.mark.parametrize("current,baseline,detected", [(110, 100, False), (111, 100, True), (89, 100, True)])
def test_price_threshold(current, baseline, detected):
    variance, result = detect_price_variance(current, baseline)
    assert variance == current - baseline
    assert result is detected


def test_mixed_batch_partial_storage(client):
    http, session = client

    valid_inbound = event(inbound_order_id=1)
    valid_outbound = event(
        event_type="outbound_order_created",
        outbound_order_id=1,
        reason="consumption",
    )
    invalid = {**valid_inbound, "eventId": "invalid"}

    response = http.post(
        "/telemetry/events",
        json={"events": [valid_inbound, invalid, valid_outbound]},
    )

    assert response.status_code == 200
    assert response.json() == {
        "received": 3,
        "stored": 2,
        "rejected": 1,
    }

    rows = session.execute(TELEMETRY_TABLE.select()).mappings().all()
    assert len(rows) == 2
    assert {row["event_type"] for row in rows} == {
        "inbound_order_created",
        "outbound_order_created",
    }
    assert all(row["tags"]["location_id"] == 1 for row in rows)
