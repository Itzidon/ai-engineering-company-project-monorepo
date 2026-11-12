from decimal import Decimal
from datetime import datetime, timezone
from sqlmodel import SQLModel, Field


def utc_now():
    return datetime.now(timezone.utc)


class Ingredient(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str
    sku: str = Field(unique=True, index=True)
    unit: str
    category: str
    country: str


class IngredientEntry(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    ingredient_id: int = Field(foreign_key="ingredient.id")
    quantity: float
    supplier_name: str
    location_id: int
    created_at: datetime = Field(default_factory=utc_now)
    user_uuid: str


class IngredientExit(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    ingredient_id: int = Field(foreign_key="ingredient.id")
    quantity: float
    reason: str
    location_id: int
    created_at: datetime = Field(default_factory=utc_now)
    user_uuid: str


class IngredientPriceRecord(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    ingredient_id: int = Field(foreign_key="ingredient.id")
    location_id: int
    supplier_key: str
    unit_cost: Decimal = Field(
        max_digits=14,
        decimal_places=4,
    )
    currency: str
    created_at: datetime = Field(default_factory=utc_now)
