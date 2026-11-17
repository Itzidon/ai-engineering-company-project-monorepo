"""Metricas tecnicas de Brasaland con Pandas."""

import pandas as pd
from sqlalchemy import (
    JSON, Column, DateTime, MetaData, String, Table, select
)

EVENTS = Table(
    "telemetry_events",
    MetaData(),
    Column("timestamp", DateTime(timezone=True)),
    Column("event_type", String),
    Column("level", String),
    Column("service", String),
    Column("tags", JSON),
)


def load_events(session, start_date, end_date, columns, event_types=None):
    """Carga solo las columnas y eventos necesarios en el periodo."""
    query = select(*columns).where(
        EVENTS.c.timestamp >= start_date,
        EVENTS.c.timestamp < end_date,
    )
    if event_types is not None:
        query = query.where(EVENTS.c.event_type.in_(event_types))

    rows = session.execute(query).mappings().all()
    df = pd.DataFrame(
        [dict(row) for row in rows],
        columns=[col.key for col in columns],
    )

    if not df.empty:
        df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
        df["date"] = df["timestamp"].dt.date

    return df


def events_per_day(session, start_date, end_date):
    """Cuantos eventos registra el sistema cada dia."""
    df = load_events(
        session, start_date, end_date,
        [EVENTS.c.timestamp, EVENTS.c.event_type],
    )
    if df.empty:
        return []

    result = df.groupby("date", as_index=False).agg(
        event_count=("event_type", "count")
    )
    result["date"] = result["date"].astype(str)
    return result.sort_values("date").to_dict(orient="records")


def error_rate_by_service(session, start_date, end_date):
    """Proporcion diaria de errores por servicio."""
    df = load_events(
        session, start_date, end_date,
        [
            EVENTS.c.timestamp,
            EVENTS.c.event_type,
            EVENTS.c.service,
            EVENTS.c.level,
        ],
    )
    if df.empty:
        return []

    df["is_error"] = df["level"].eq("error")
    df = df.dropna(subset=["service"])

    result = df.groupby(["date", "service"], as_index=False).agg(
        total_events=("event_type", "count"),
        error_events=("is_error", "sum"),
        error_rate=("is_error", "mean"),
    )
    result["date"] = result["date"].astype(str)
    result["error_rate"] = result["error_rate"].round(4)
    return result.sort_values(["date", "service"]).to_dict(orient="records")


def latency_by_route(session, start_date, end_date):
    """Latencia media diaria de las peticiones API por ruta."""
    df = load_events(
        session, start_date, end_date,
        [
            EVENTS.c.timestamp,
            EVENTS.c.event_type,
            EVENTS.c.tags,
        ],
        event_types=["api_latency_recorded"],
    )
    if df.empty:
        return []

    df["route_template"] = df["tags"].map(
        lambda tags: tags.get("route_template")
        if isinstance(tags, dict) else None
    )
    df["duration_ms"] = pd.to_numeric(
        df["tags"].map(
            lambda tags: tags.get("duration_ms")
            if isinstance(tags, dict) else None
        ),
        errors="coerce",
    )
    df = df.dropna(subset=["route_template", "duration_ms"])

    if df.empty:
        return []

    result = df.groupby(
        ["date", "route_template"], as_index=False
    ).agg(
        request_count=("event_type", "count"),
        avg_latency_ms=("duration_ms", "mean"),
    )
    result["date"] = result["date"].astype(str)
    result["avg_latency_ms"] = result["avg_latency_ms"].round(2)
    return result.sort_values(
        ["date", "route_template"]
    ).to_dict(orient="records")
