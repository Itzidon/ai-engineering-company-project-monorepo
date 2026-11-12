from datetime import datetime
from enum import Enum

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class Role(str, Enum):
    admin = "admin"
    manager = "manager"
    user = "user"


class User(BaseModel):
    id: int
    email: EmailStr
    hashed_password: str
    is_active: bool = True
    role: Role = Role.user
    created_at: datetime


class UserCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr
    password: str = Field(min_length=8)
    name: str | None = None
    phone: str | None = None
    address: str | None = None


class UserUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr | None = None
    role: Role | None = None

    @field_validator("email", "role")
    @classmethod
    def reject_explicit_null(cls, value: EmailStr | Role | None) -> EmailStr | Role:
        if value is None:
            raise ValueError("El campo no puede ser nulo")
        return value


class UserPublic(BaseModel):
    id: int
    email: EmailStr
    is_active: bool
    role: Role
    created_at: datetime


class Profile(BaseModel):
    id: int
    user_id: int
    name: str | None = None
    phone: str | None = None
    address: str | None = None


class ProfileUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    phone: str | None = None
    address: str | None = None
