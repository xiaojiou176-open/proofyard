from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from apps.api.app.api.dependencies.security import (
    AutomationSecurityContext,
    require_automation_access,
)
from apps.api.app.services.embedding_service import EmbeddingServiceError, embedding_service

router = APIRouter(prefix="/api/embeddings", tags=["embeddings"])


class EmbeddingBatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    texts: list[str] = Field(min_length=1, max_length=128)
    model: str | None = Field(default=None, min_length=1, max_length=128)


class EmbeddingBatchResponse(BaseModel):
    model: str
    vector_count: int
    dimension: int
    vectors: list[list[float]]


@router.post("/batch", response_model=EmbeddingBatchResponse)
def create_batch_embeddings(
    payload: EmbeddingBatchRequest,
    _security: AutomationSecurityContext = Depends(require_automation_access),
) -> EmbeddingBatchResponse:
    try:
        result = embedding_service.embed_texts(payload.texts, model=payload.model)
    except EmbeddingServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    return EmbeddingBatchResponse(
        model=result.model,
        vector_count=len(result.vectors),
        dimension=result.dimension,
        vectors=result.vectors,
    )
