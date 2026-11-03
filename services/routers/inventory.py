from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select, func
from sqlalchemy.exc import IntegrityError

from services.database import get_db
from services.models import Ingredient, IngredientEntry, IngredientExit
from services.schemas import IngredientCreate, IngredientResponse
from services.api.auth.security import get_current_user

router = APIRouter(prefix="/inventory", tags=["inventory"])


def calculate_stock(db: Session, ingredient_id: int):
    entries = db.exec(
        select(func.coalesce(func.sum(IngredientEntry.quantity), 0))
        .where(IngredientEntry.ingredient_id == ingredient_id)
    ).one()

    exits = db.exec(
        select(func.coalesce(func.sum(IngredientExit.quantity), 0))
        .where(IngredientExit.ingredient_id == ingredient_id)
    ).one()

    return float(entries) - float(exits)


def ingredient_response(db: Session, ingredient: Ingredient):
    return IngredientResponse(
        **ingredient.model_dump(),
        current_stock=calculate_stock(db, ingredient.id)
    )


@router.get("/products", response_model=list[IngredientResponse])
def list_products(
    country: Literal["CO", "US"] | None = None,
    db: Session = Depends(get_db),
):
    query = select(Ingredient)
    if country:
        query = query.where(Ingredient.country == country)

    ingredients = db.exec(query).all()

    entries = dict(db.exec(
        select(IngredientEntry.ingredient_id, func.sum(IngredientEntry.quantity))
        .group_by(IngredientEntry.ingredient_id)
    ).all())

    exits = dict(db.exec(
        select(IngredientExit.ingredient_id, func.sum(IngredientExit.quantity))
        .group_by(IngredientExit.ingredient_id)
    ).all())

    return [
        IngredientResponse(
            **item.model_dump(),
            current_stock=float(entries.get(item.id, 0) or 0)
            - float(exits.get(item.id, 0) or 0),
        )
        for item in ingredients
    ]


@router.get("/products/{id}", response_model=IngredientResponse)
def get_product(id: int, db: Session = Depends(get_db)):
    ingredient = db.get(Ingredient, id)

    if ingredient is None:
        raise HTTPException(404, "Ingredient not found")

    return ingredient_response(db, ingredient)


@router.post("/products", response_model=IngredientResponse, status_code=201)
def create_product(
    payload: IngredientCreate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    ingredient = Ingredient(**payload.model_dump())
    db.add(ingredient)

    try:
        db.commit()
        db.refresh(ingredient)
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "SKU already exists")

    return ingredient_response(db, ingredient)

from uuid import NAMESPACE_URL, uuid5
from services.api.auth import storage
from services.schemas import (
    IngredientEntryCreate,
    IngredientExitCreate,
    IngredientEntryResponse,
    IngredientExitResponse,
    OrderResponse,
)


def get_user_uuid(user):
    if user.get("uuid"):
        return str(user["uuid"])

    user_uuid = str(uuid5(
        NAMESPACE_URL,
        f"brasaland-tinydb-user:{user['id']}"
    ))
    storage.update_user(user["id"], {"uuid": user_uuid})
    return user_uuid


def location_stock(db, ingredient_id, location_id):
    entries = db.exec(
        select(func.coalesce(func.sum(IngredientEntry.quantity), 0))
        .where(
            IngredientEntry.ingredient_id == ingredient_id,
            IngredientEntry.location_id == location_id,
        )
    ).one()

    exits = db.exec(
        select(func.coalesce(func.sum(IngredientExit.quantity), 0))
        .where(
            IngredientExit.ingredient_id == ingredient_id,
            IngredientExit.location_id == location_id,
        )
    ).one()

    return float(entries) - float(exits)


@router.post(
    "/orders/inbound",
    response_model=IngredientEntryResponse,
    status_code=201,
)
def create_inbound(
    payload: IngredientEntryCreate,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    ingredient = db.get(Ingredient, payload.ingredient_id)
    if ingredient is None:
        raise HTTPException(404, "Ingredient not found")

    entry = IngredientEntry(
        **payload.model_dump(),
        user_uuid=get_user_uuid(user),
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return IngredientEntryResponse(**entry.model_dump())


@router.post(
    "/orders/outbound",
    response_model=IngredientExitResponse,
    status_code=201,
)
def create_outbound(
    payload: IngredientExitCreate,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    ingredient = db.exec(
        select(Ingredient)
        .where(Ingredient.id == payload.ingredient_id)
        .with_for_update()
    ).one_or_none()

    if ingredient is None:
        raise HTTPException(404, "Ingredient not found")

    available = location_stock(
        db, payload.ingredient_id, payload.location_id
    )

    if payload.quantity > available:
        raise HTTPException(
            400,
            f"Insufficient stock for ingredient '{ingredient.name}'. "
            f"Available: {available}, requested: {payload.quantity}.",
        )

    exit_record = IngredientExit(
        **payload.model_dump(),
        user_uuid=get_user_uuid(user),
    )
    db.add(exit_record)
    db.commit()
    db.refresh(exit_record)
    return IngredientExitResponse(**exit_record.model_dump())


@router.get("/orders", response_model=list[OrderResponse])
def list_orders(db: Session = Depends(get_db)):
    orders = []

    entries = db.exec(
        select(IngredientEntry, Ingredient)
        .join(Ingredient, IngredientEntry.ingredient_id == Ingredient.id)
    ).all()

    for entry, ingredient in entries:
        orders.append(OrderResponse(
            **entry.model_dump(),
            order_type="inbound",
            ingredient_name=ingredient.name,
            sku=ingredient.sku,
        ))

    exits = db.exec(
        select(IngredientExit, Ingredient)
        .join(Ingredient, IngredientExit.ingredient_id == Ingredient.id)
    ).all()

    for exit_record, ingredient in exits:
        orders.append(OrderResponse(
            **exit_record.model_dump(),
            order_type="outbound",
            ingredient_name=ingredient.name,
            sku=ingredient.sku,
        ))

    return sorted(
        orders,
        key=lambda order: order.created_at,
        reverse=True,
    )
