import logging
import os
from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field

router = APIRouter(prefix="/telemetry", tags=["telemetry"])
logger = logging.getLogger(__name__)

TELEMETRY_ENDPOINT = os.getenv(
    "TELEMETRY_ENDPOINT",
    "http://localhost:8000/telemetry/events",
)

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

class TelemetryBatch(BaseModel):
    events: list[TelemetryEvent]

@router.post("/events")
def receive_events(batch: TelemetryBatch):
    logger.info("Eventos recibidos: %s", len(batch.events))
    for event in batch.events:
        logger.info("Tipo: %s", event.event_type)
    return {"received": len(batch.events)}
