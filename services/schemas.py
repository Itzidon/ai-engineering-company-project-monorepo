from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class IngredientCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1)
    sku: str = Field(min_length=1)
    unit: Literal["kg", "litro", "unidad"]
    category: Literal[
        "meat", "produce", "sauce",
        "beverage", "packaging", "cleaning"
    ]
    country: Literal["CO", "US"]


class IngredientResponse(IngredientCreate):
    id: int
    current_stock: float


class IngredientEntryCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ingredient_id: int
    quantity: float = Field(gt=0, allow_inf_nan=False)
    supplier_name: str = Field(min_length=1)
    location_id: int = Field(ge=1, le=14)


class IngredientExitCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ingredient_id: int
    quantity: float = Field(gt=0, allow_inf_nan=False)
    reason: Literal["consumption", "waste"]
    location_id: int = Field(ge=1, le=14)


class IngredientEntryResponse(IngredientEntryCreate):
    id: int
    created_at: datetime
    user_uuid: str


class IngredientExitResponse(IngredientExitCreate):
    id: int
    created_at: datetime
    user_uuid: str


class OrderResponse(BaseModel):
    id: int
    order_type: Literal["inbound", "outbound"]
    ingredient_id: int
    ingredient_name: str
    sku: str
    quantity: float
    location_id: int
    created_at: datetime
    user_uuid: str
    supplier_name: str | None = None
    reason: str | None = None
