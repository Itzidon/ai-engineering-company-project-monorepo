
import os
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from jsonschema import Draft7Validator, FormatChecker
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    ValidationError,
    model_validator,
)
from sqlalchemy import (
    JSON,
    Column,
    DateTime,
    MetaData,
    Numeric,
    String,
    Table,
    insert,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Session

from services.database import get_db

TELEMETRY_ENDPOINT = os.getenv(
    "TELEMETRY_ENDPOINT", "/telemetry/events"
)
router = APIRouter(prefix="/telemetry", tags=["telemetry"])
logger = logging.getLogger(__name__)

CONTRACT = json.loads(
    (
        Path(__file__).resolve().parents[3]
        / "docs/telemetry/event-schemas.json"
    ).read_text(encoding="utf-8")
)
validator = Draft7Validator(
    CONTRACT, format_checker=FormatChecker()
)


# Modelo original: se conserva sin modificar.
class TelemetryEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    eventId: UUID
    timestamp: datetime
    sessionId: str | None
    userId: str | None
    event_type: str = Field(
        pattern=r"^[a-z]+(?:_[a-z0-9]+)+$"
    )
    schemaVersion: str
    requestId: UUID
    properties: dict[str, Any]

    @model_validator(mode="after")
    def validate_contract(self):
        if not validator.is_valid(
            self.model_dump(mode="json")
        ):
            raise ValueError("Invalid telemetry contract")
        return self


# Recibimos eventos sin validarlos todos de golpe.
class TelemetryBatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    events: list[Any] = Field(
        min_length=1, max_length=20
    )


# Tabla de Supabase ya creada con SQL.
TELEMETRY_TABLE = Table(
    "telemetry_events",
    MetaData(),
    Column("timestamp", DateTime(timezone=True)),
    Column("service", String),
    Column("event_type", String),
    Column("level", String),
    Column("value", Numeric),
    Column("message", String),
    Column(
        "tags",
        JSON().with_variant(JSONB(), "postgresql"),
    ),
)


def event_to_row(event: TelemetryEvent) -> dict:
    event_type = event.event_type

    if event_type in {
        "frontend_error_captured",
        "api_request_failed",
        "database_query_slow_detected",
    }:
        level = "error"
    elif "failed" in event_type or "rejected" in event_type:
        level = "warn"
    else:
        level = "info"

    service = (
        "api"
        if event_type.startswith(("api_", "database_"))
        else "backoffice"
    )

    quantity = event.properties.get("quantity")
    value = (
        quantity
        if isinstance(quantity, (int, float))
        and not isinstance(quantity, bool)
        else None
    )

    return {
        "timestamp": event.timestamp,
        "service": service,
        "event_type": event_type,
        "level": level,
        "value": value,
        "message": None,
        "tags": event.properties,
    }


@router.post("/events")
def receive_events(
    batch: TelemetryBatch,
    session: Session = Depends(get_db),
):
    received = len(batch.events)
    rejected = 0
    valid_rows = []

    for raw_event in batch.events:
        try:
            event = TelemetryEvent.model_validate(
                raw_event
            )
        except ValidationError:
            rejected += 1
            continue

        valid_rows.append(event_to_row(event))

    stored = 0

    if valid_rows:
        try:
            # Un solo INSERT para todo el lote válido.
            session.execute(
                insert(TELEMETRY_TABLE).values(valid_rows)
            )
            session.commit()
            stored = len(valid_rows)
        except Exception as exc:
            session.rollback()
            logger.exception(
                "Error guardando telemetria"
            )
            raise HTTPException(
                status_code=503,
                detail="No se pudieron guardar los eventos",
            ) from exc

    logger.info(
        "Telemetria: received=%s stored=%s rejected=%s",
        received,
        stored,
        rejected,
    )

    return {
        "received": received,
        "stored": stored,
        "rejected": rejected,
    }


# Reporte tecnico de telemetria
import threading
import time
from datetime import timedelta, timezone

from fastapi import Query

from services.telemetry.analysis import (
    events_per_day,
    error_rate_by_service,
    latency_by_route,
)

_REPORT_CACHE = {}
_REPORT_LOCK = threading.Lock()
_REPORT_TTL = 60


@router.get("/report")
def get_telemetry_report(
    start_date: datetime | None = Query(default=None),
    end_date: datetime | None = Query(default=None),
    session: Session = Depends(get_db),
):
    # Las fechas indicadas deben incluir zona horaria.
    for date_value in (start_date, end_date):
        if date_value is not None and (
            date_value.tzinfo is None
            or date_value.utcoffset() is None
        ):
            raise HTTPException(
                status_code=422,
                detail="Las fechas deben incluir zona horaria UTC",
            )

    now = datetime.now(timezone.utc)
    end = (end_date or now).astimezone(timezone.utc)
    start = (
        start_date.astimezone(timezone.utc)
        if start_date is not None
        else end - timedelta(days=7)
    )

    if start >= end:
        raise HTTPException(
            status_code=422,
            detail="start_date debe ser anterior a end_date",
        )

    key = (
        start_date.isoformat() if start_date else None,
        end_date.isoformat() if end_date else None,
    )

    with _REPORT_LOCK:
        current_time = time.monotonic()
        cached = _REPORT_CACHE.get(key)

        if cached and current_time - cached["created"] < _REPORT_TTL:
            return cached["result"]

        try:
            result = {
                "period": {
                    "from": start.isoformat(),
                    "to": end.isoformat(),
                },
                "metrics": {
                    "events_per_day": events_per_day(
                        session, start, end
                    ),
                    "error_rate_by_service": error_rate_by_service(
                        session, start, end
                    ),
                    "latency_by_route": latency_by_route(
                        session, start, end
                    ),
                },
            }
        except Exception as exc:
            logger.exception("Error al generar reporte tecnico")
            raise HTTPException(
                status_code=503,
                detail="No se pudo generar el reporte",
            ) from exc

        # Eliminar entradas caducadas.
        expired = [
            k for k, item in _REPORT_CACHE.items()
            if current_time - item["created"] >= _REPORT_TTL
        ]
        for k in expired:
            del _REPORT_CACHE[k]

        _REPORT_CACHE[key] = {
            "created": current_time,
            "result": result,
        }

        return result
