import os
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import UUID

from fastapi import APIRouter
from jsonschema import Draft7Validator, FormatChecker
from pydantic import BaseModel, ConfigDict, Field, model_validator

TELEMETRY_ENDPOINT = os.getenv("TELEMETRY_ENDPOINT", "/telemetry/events")
router = APIRouter(prefix="/telemetry", tags=["telemetry"])
logger = logging.getLogger(__name__)

CONTRACT = json.loads(
    (Path(__file__).resolve().parents[3] / "docs/telemetry/event-schemas.json")
    .read_text(encoding="utf-8")
)
validator = Draft7Validator(CONTRACT, format_checker=FormatChecker())


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
        if not validator.is_valid(self.model_dump(mode="json")):
            raise ValueError("Invalid telemetry contract")
        return self


class TelemetryBatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    events: list[TelemetryEvent] = Field(min_length=1, max_length=20)


@router.post("/events")
def receive_events(batch: TelemetryBatch):
    logger.info("Eventos recibidos: %s", len(batch.events))
    for event in batch.events:
        logger.info("Tipo: %s", event.event_type)
    return {"received": len(batch.events)}
