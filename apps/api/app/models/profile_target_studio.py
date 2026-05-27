from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

ConfigStudioKind = Literal["profile", "target"]
ConfigStudioFieldType = Literal["integer", "number", "boolean", "string", "enum"]


class ConfigStudioField(BaseModel):
    path: str
    label: str
    group: str
    field_type: ConfigStudioFieldType
    value: Any = None
    description: str | None = None
    min_value: float | int | None = None
    max_value: float | int | None = None
    enum_values: list[str] = Field(default_factory=list)


class ConfigStudioReadonlyField(BaseModel):
    path: str
    label: str
    value: Any = None


class ConfigStudioDocument(BaseModel):
    kind: ConfigStudioKind
    config_name: str
    file_path: str
    editable_fields: list[ConfigStudioField] = Field(default_factory=list)
    readonly_fields: list[ConfigStudioReadonlyField] = Field(default_factory=list)
    validation_summary: list[str] = Field(default_factory=list)


class ProfileTargetStudioResponse(BaseModel):
    trusted_mode: bool = True
    profile_options: list[str] = Field(default_factory=list)
    target_options: list[str] = Field(default_factory=list)
    selected_profile: str
    selected_target: str
    profile: ConfigStudioDocument
    target: ConfigStudioDocument


class ConfigStudioSaveRequest(BaseModel):
    updates: dict[str, Any] = Field(default_factory=dict)


class ConfigStudioSaveResponse(BaseModel):
    document: ConfigStudioDocument
    saved: bool = True
    audit: list[str] = Field(default_factory=list)
