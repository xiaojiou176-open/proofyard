from __future__ import annotations

import re

from pydantic import BaseModel, Field, field_validator


class RegisterRequest(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=8, max_length=128)

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if "@" not in normalized:
            raise ValueError("email must contain @")
        return normalized

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        if not re.search(r"[A-Z]", value):
            raise ValueError("password must contain an uppercase letter")
        if not re.search(r"[a-z]", value):
            raise ValueError("password must contain a lowercase letter")
        if not re.search(r"[0-9]", value):
            raise ValueError("password must contain a digit")
        if not re.search(r"[^A-Za-z0-9]", value):
            raise ValueError("password must contain a special character")
        return value


class RegisterResponse(BaseModel):
    user_id: str
    email: str


class CsrfResponse(BaseModel):
    csrf_token: str
