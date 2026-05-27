from __future__ import annotations

import importlib
import os

from fastapi.testclient import TestClient
import pytest

import apps.api.app.api.embeddings as embeddings_api
import apps.api.app.core.access_control as access_control
import apps.api.app.core.observability as observability
from apps.api.app.services.embedding_service import EmbeddingBatchResult, EmbeddingServiceError

observability.os = os
app = importlib.import_module("apps.api.app.main").app

client = TestClient(
    app, headers={"x-automation-token": "test-token", "x-automation-client-id": "pytest-embeddings"}
)


@pytest.fixture(autouse=True)
def _setup_access(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AUTOMATION_API_TOKEN", "test-token")
    access_control.reset_for_tests()


def test_batch_embeddings_returns_vectors(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_embed_texts(texts: list[str], model: str | None = None) -> EmbeddingBatchResult:
        assert texts == ["alpha", "beta"]
        assert model is None
        return EmbeddingBatchResult(
            model="gemini-embedding-001",
            dimension=3,
            vectors=[[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]],
        )

    monkeypatch.setattr(embeddings_api.embedding_service, "embed_texts", fake_embed_texts)

    response = client.post("/api/embeddings/batch", json={"texts": ["alpha", "beta"]})

    assert response.status_code == 200
    payload = response.json()
    assert payload["model"] == "gemini-embedding-001"
    assert payload["vector_count"] == 2
    assert payload["dimension"] == 3
    assert payload["vectors"] == [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]]


def test_batch_embeddings_maps_service_error(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_embed_texts(texts: list[str], model: str | None = None) -> EmbeddingBatchResult:
        raise EmbeddingServiceError("gemini api key not configured", status_code=503)

    monkeypatch.setattr(embeddings_api.embedding_service, "embed_texts", fake_embed_texts)

    response = client.post("/api/embeddings/batch", json={"texts": ["hello"]})

    assert response.status_code == 503
    assert response.json()["detail"] == "gemini api key not configured"


def test_batch_embeddings_requires_token() -> None:
    raw_client = TestClient(app)
    response = raw_client.post("/api/embeddings/batch", json={"texts": ["hello"]})

    assert response.status_code == 401
    assert response.json()["detail"] == "invalid automation token"
