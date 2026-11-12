from datetime import datetime, timezone
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import insert
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, create_engine

from services.api.main import app
from services.api.routes.telemetry import (
    TELEMETRY_TABLE,
    _REPORT_CACHE,
)
from services.database import get_db


def test_report_metrics_and_cache(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "")
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TELEMETRY_TABLE.create(engine)

    def dt(day, hour):
        return datetime(2026, 11, day, hour, tzinfo=timezone.utc)

    rows = [
        {
            "timestamp": dt(10, 9),
            "event_type": "api_latency_recorded",
            "service": "api",
            "level": "info",
            "tags": {
                "route_template": "/inventory",
                "duration_ms": 120,
            },
        },
        {
            "timestamp": dt(10, 11),
            "event_type": "api_request_failed",
            "service": "api",
            "level": "error",
            "tags": {},
        },
        {
            "timestamp": dt(10, 12),
            "event_type": "api_latency_recorded",
            "service": "api",
            "level": "info",
            "tags": {
                "route_template": "/inventory",
                "duration_ms": 80,
            },
        },
        {
            "timestamp": dt(10, 13),
            "event_type": "inbound_order_created",
            "service": "backoffice",
            "level": "info",
            "tags": {},
        },
        {
            "timestamp": dt(11, 0),
            "event_type": "frontend_error_captured",
            "service": "backoffice",
            "level": "error",
            "tags": {},
        },
    ]

    with Session(engine) as session:
        session.execute(insert(TELEMETRY_TABLE), rows)
        session.commit()

        def override_db():
            yield session

        app.dependency_overrides[get_db] = override_db
        _REPORT_CACHE.clear()

        try:
            with TestClient(app) as client:
                params = {
                    "start_date": "2026-11-10T00:00:00Z",
                    "end_date": "2026-11-11T00:00:00Z",
                }

                response = client.get(
                    "/telemetry/report", params=params
                )
                assert response.status_code == 200, response.text

                data = response.json()
                metrics = data["metrics"]

                assert metrics["events_per_day"] == [
                    {"date": "2026-11-10", "event_count": 4}
                ]

                errors = metrics["error_rate_by_service"]
                api = next(
                    item for item in errors
                    if item["service"] == "api"
                )
                assert api["total_events"] == 3
                assert api["error_events"] == 1
                assert api["error_rate"] == 0.3333

                latency = metrics["latency_by_route"]
                assert latency[0]["avg_latency_ms"] == 100
                assert latency[0]["request_count"] == 2

                # La segunda consulta debe usar la cache.
                with patch(
                    "services.api.routes.telemetry.events_per_day",
                    side_effect=AssertionError("Cache no utilizada"),
                ):
                    second = client.get(
                        "/telemetry/report", params=params
                    )
                    assert second.status_code == 200
                    assert second.json() == data

                # Fechas incorrectas deben rechazarse.
                invalid = client.get(
                    "/telemetry/report",
                    params={
                        "start_date": "2026-11-12T00:00:00Z",
                        "end_date": "2026-11-10T00:00:00Z",
                    },
                )
                assert invalid.status_code == 422
        finally:
            app.dependency_overrides.clear()
            _REPORT_CACHE.clear()

    engine.dispose()
