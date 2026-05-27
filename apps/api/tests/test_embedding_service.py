from __future__ import annotations

import importlib
from types import SimpleNamespace

import pytest

from apps.api.app.services.embedding_service import EmbeddingService, EmbeddingServiceError

embedding_service_module = importlib.import_module("apps.api.app.services.embedding_service")


def test_embed_texts_uses_default_model(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.delenv("GEMINI_EMBED_MODEL", raising=False)
    service = EmbeddingService()

    captured: dict[str, object] = {}

    class FakeModels:
        def embed_content(
            self, *, model: str, contents: list[str], config: object | None = None
        ) -> object:
            captured["model"] = model
            captured["contents"] = contents
            captured["config"] = config
            return embedding_service_module.genai_types.EmbedContentResponse(
                embeddings=[
                    embedding_service_module.genai_types.ContentEmbedding(values=[0.1, 0.2, 0.3]),
                    embedding_service_module.genai_types.ContentEmbedding(values=[0.4, 0.5, 0.6]),
                ]
            )

    class FakeClient:
        def __init__(self, *, api_key: str, http_options: object | None = None) -> None:
            captured["api_key"] = api_key
            captured["http_options"] = http_options
            self.models = FakeModels()

    monkeypatch.setattr(embedding_service_module.genai, "Client", FakeClient)

    result = service.embed_texts(["alpha", "beta"])

    assert captured["model"] == "models/gemini-embedding-001"
    assert captured["api_key"] == "test-key"
    assert captured["contents"] == ["alpha", "beta"]
    assert result.model == "gemini-embedding-001"
    assert result.dimension == 3
    assert result.vectors == [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]]


def test_embed_texts_uses_env_model(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setenv("GEMINI_EMBED_MODEL", "models/gemini-embedding-001")
    service = EmbeddingService()

    captured: dict[str, object] = {}

    class FakeModels:
        def embed_content(
            self, *, model: str, contents: list[str], config: object | None = None
        ) -> object:
            captured["model"] = model
            captured["contents"] = contents
            return embedding_service_module.genai_types.EmbedContentResponse(
                embeddings=[
                    embedding_service_module.genai_types.ContentEmbedding(values=[0.1, 0.2])
                ]
            )

    class FakeClient:
        def __init__(self, *, api_key: str, http_options: object | None = None) -> None:
            captured["api_key"] = api_key
            self.models = FakeModels()

    monkeypatch.setattr(embedding_service_module.genai, "Client", FakeClient)

    result = service.embed_texts(["hello world"])
    assert captured["model"] == "models/gemini-embedding-001"
    assert captured["contents"] == ["hello world"]
    assert captured["api_key"] == "test-key"
    assert result.model == "gemini-embedding-001"
    assert result.dimension == 2


def test_embed_texts_ignores_legacy_embed_alias(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.delenv("GEMINI_EMBED_MODEL", raising=False)
    monkeypatch.setenv("GEMINI_EMBEDDING_MODEL", "models/text-embedding-3-small")
    service = EmbeddingService()

    captured: dict[str, object] = {}

    class FakeModels:
        def embed_content(
            self, *, model: str, contents: list[str], config: object | None = None
        ) -> object:
            captured["model"] = model
            return embedding_service_module.genai_types.EmbedContentResponse(
                embeddings=[
                    embedding_service_module.genai_types.ContentEmbedding(values=[0.1, 0.2])
                ]
            )

    class FakeClient:
        def __init__(self, *, api_key: str, http_options: object | None = None) -> None:
            self.models = FakeModels()

    monkeypatch.setattr(embedding_service_module.genai, "Client", FakeClient)
    service.embed_texts(["hello world"])

    assert captured["model"] == "models/gemini-embedding-001"


def test_embed_texts_rejects_non_gemini_model(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    service = EmbeddingService()

    with pytest.raises(EmbeddingServiceError) as exc:
        service.embed_texts(["hello"], model="text-embedding-3-small")

    assert exc.value.status_code == 422
    assert "only Gemini embedding models are supported" in str(exc.value)


def test_embed_texts_requires_gemini_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "")
    service = EmbeddingService()

    with pytest.raises(EmbeddingServiceError) as exc:
        service.embed_texts(["hello"])

    assert exc.value.status_code == 503
    assert "gemini api key not configured" in str(exc.value)


def test_embed_texts_maps_sdk_error_to_502(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    service = EmbeddingService()

    class FakeModels:
        def embed_content(
            self, *, model: str, contents: list[str], config: object | None = None
        ) -> object:
            raise embedding_service_module.genai_errors.ClientError(
                400,
                {"error": {"message": "bad request"}},
            )

    class FakeClient:
        def __init__(self, *, api_key: str, http_options: object | None = None) -> None:
            self.models = FakeModels()

    monkeypatch.setattr(embedding_service_module.genai, "Client", FakeClient)

    with pytest.raises(EmbeddingServiceError) as exc:
        service.embed_texts(["hello"])

    assert exc.value.status_code == 502


def test_normalize_texts_rejects_empty_list() -> None:
    service = EmbeddingService()

    with pytest.raises(EmbeddingServiceError) as exc:
        service._normalize_texts([])

    assert exc.value.status_code == 422
    assert "at least one item" in str(exc.value)


def test_normalize_texts_rejects_batch_over_limit() -> None:
    service = EmbeddingService()
    oversized = ["x"] * (embedding_service_module._MAX_BATCH_SIZE + 1)

    with pytest.raises(EmbeddingServiceError) as exc:
        service._normalize_texts(oversized)

    assert exc.value.status_code == 422
    assert "batch size exceeds" in str(exc.value)


def test_normalize_texts_rejects_blank_item() -> None:
    service = EmbeddingService()

    with pytest.raises(EmbeddingServiceError) as exc:
        service._normalize_texts(["ok", "   "])

    assert exc.value.status_code == 422
    assert "texts[1] must be a non-empty string" in str(exc.value)


def test_normalize_texts_success() -> None:
    service = EmbeddingService()
    normalized = service._normalize_texts(["  alpha ", "beta  "])
    assert normalized == ["alpha", "beta"]


def test_resolve_model_prefers_argument_over_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GEMINI_EMBED_MODEL", "gemini-embedding-999")
    service = EmbeddingService()

    resolved = service._resolve_model("models/gemini-embedding-001")

    assert resolved == "gemini-embedding-001"


def test_resolve_model_uses_env_fallback_and_strips_prefix(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GEMINI_EMBED_MODEL", "models/gemini-embedding-001")
    service = EmbeddingService()

    resolved = service._resolve_model(None)

    assert resolved == "gemini-embedding-001"


def test_resolve_model_rejects_non_gemini(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GEMINI_EMBED_MODEL", "models/text-embedding-3-small")
    service = EmbeddingService()

    with pytest.raises(EmbeddingServiceError) as exc:
        service._resolve_model(None)

    assert exc.value.status_code == 422
    assert "only Gemini embedding models are supported" in str(exc.value)


def test_embed_batch_enforces_timeout_floor(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RECON_ENGINE_TIMEOUT_SECONDS", "1")
    service = EmbeddingService()
    captured: dict[str, object] = {}

    class FakeHttpOptions:
        def __init__(self, *, timeout: int) -> None:
            self.timeout = timeout

    class FakeModels:
        def embed_content(self, *, model: str, contents: list[str]) -> dict[str, object]:
            captured["model"] = model
            captured["contents"] = contents
            return {"embeddings": [{"values": [0.1]}]}

    class FakeClient:
        def __init__(self, *, api_key: str, http_options: FakeHttpOptions) -> None:
            captured["api_key"] = api_key
            captured["timeout"] = http_options.timeout
            self.models = FakeModels()

    monkeypatch.setattr(embedding_service_module.genai_types, "HttpOptions", FakeHttpOptions)
    monkeypatch.setattr(embedding_service_module.genai, "Client", FakeClient)

    payload = service._embed_batch("gemini-embedding-001", ["hello"], "test-key")

    assert captured["api_key"] == "test-key"
    assert captured["timeout"] == 5000
    assert captured["model"] == "models/gemini-embedding-001"
    assert captured["contents"] == ["hello"]
    assert payload == {"embeddings": [{"values": [0.1]}]}


@pytest.mark.parametrize(
    ("sdk_message", "fallback", "expected_detail"),
    [
        ("from-message", "ignored-fallback", "from-message"),
        (None, "from-fallback", "from-fallback"),
    ],
)
def test_embed_batch_maps_api_error_message_variants(
    monkeypatch: pytest.MonkeyPatch,
    sdk_message: str | None,
    fallback: str,
    expected_detail: str,
) -> None:
    service = EmbeddingService()

    class FakeAPIError(Exception):
        def __init__(self, *, status: int, message: str | None, raw: str) -> None:
            super().__init__(raw)
            self.status = status
            self.message = message

    class FakeModels:
        def embed_content(self, *, model: str, contents: list[str]) -> object:
            raise FakeAPIError(status=429, message=sdk_message, raw=fallback)

    class FakeClient:
        def __init__(self, *, api_key: str, http_options: object) -> None:
            self.models = FakeModels()

    monkeypatch.setattr(embedding_service_module.genai_errors, "APIError", FakeAPIError)
    monkeypatch.setattr(embedding_service_module.genai, "Client", FakeClient)

    with pytest.raises(EmbeddingServiceError) as exc:
        service._embed_batch("gemini-embedding-001", ["hello"], "test-key")

    assert exc.value.status_code == 502
    assert "status 429" in str(exc.value)
    assert expected_detail in str(exc.value)


@pytest.mark.parametrize("exc_type", [ValueError, OSError, TypeError])
def test_embed_batch_maps_runtime_exceptions_to_502(
    monkeypatch: pytest.MonkeyPatch, exc_type: type[Exception]
) -> None:
    service = EmbeddingService()

    class FakeClient:
        def __init__(self, *, api_key: str, http_options: object) -> None:
            raise exc_type("boom")

    monkeypatch.setattr(embedding_service_module.genai, "Client", FakeClient)

    with pytest.raises(EmbeddingServiceError) as exc:
        service._embed_batch("gemini-embedding-001", ["hello"], "test-key")

    assert exc.value.status_code == 502
    assert "boom" in str(exc.value)


def test_parse_vectors_supports_dict_and_object_payload() -> None:
    service = EmbeddingService()

    dict_payload = {"embeddings": [{"values": [1, 2]}, {"values": [3, 4]}]}
    object_payload = SimpleNamespace(
        embeddings=[SimpleNamespace(values=[5, 6]), SimpleNamespace(values=[7, 8])]
    )

    assert service._parse_vectors(dict_payload) == [[1.0, 2.0], [3.0, 4.0]]
    assert service._parse_vectors(object_payload) == [[5.0, 6.0], [7.0, 8.0]]


@pytest.mark.parametrize("payload", [{}, SimpleNamespace()])
def test_parse_vectors_rejects_missing_embeddings(payload: object) -> None:
    service = EmbeddingService()

    with pytest.raises(EmbeddingServiceError) as exc:
        service._parse_vectors(payload)

    assert exc.value.status_code == 502
    assert "missing vectors" in str(exc.value)


def test_parse_vectors_rejects_empty_embedding_item() -> None:
    service = EmbeddingService()

    with pytest.raises(EmbeddingServiceError) as exc:
        service._parse_vectors({"embeddings": [{"values": []}]})

    assert exc.value.status_code == 502
    assert "is empty" in str(exc.value)


def test_parse_vectors_rejects_inconsistent_dimensions() -> None:
    service = EmbeddingService()

    with pytest.raises(EmbeddingServiceError) as exc:
        service._parse_vectors({"embeddings": [{"values": [1, 2]}, {"values": [3]}]})

    assert exc.value.status_code == 502
    assert "inconsistent dimensions" in str(exc.value)


def test_extract_values_supports_direct_values() -> None:
    service = EmbeddingService()
    values = service._extract_values({"values": [1, "2.5"]})
    assert values == [1.0, 2.5]


def test_extract_values_supports_nested_embedding_values() -> None:
    service = EmbeddingService()
    values = service._extract_values({"embedding": {"values": [3, 4]}})
    assert values == [3.0, 4.0]


def test_extract_values_rejects_missing_values() -> None:
    service = EmbeddingService()

    with pytest.raises(EmbeddingServiceError) as exc:
        service._extract_values({"embedding": {}})

    assert exc.value.status_code == 502
    assert "values are missing" in str(exc.value)


def test_extract_values_rejects_non_numeric_values() -> None:
    service = EmbeddingService()

    with pytest.raises(EmbeddingServiceError) as exc:
        service._extract_values({"values": [1, "not-a-number"]})

    assert exc.value.status_code == 502
    assert "must be numeric" in str(exc.value)


def test_extract_values_rejects_non_finite_values() -> None:
    service = EmbeddingService()

    with pytest.raises(EmbeddingServiceError) as exc:
        service._extract_values({"values": [1, float("nan")]})

    assert exc.value.status_code == 502
    assert "must be finite" in str(exc.value)


def test_embed_texts_rejects_vector_count_mismatch(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    service = EmbeddingService()

    monkeypatch.setattr(
        service,
        "_embed_batch",
        lambda model, texts, api_key: {"embeddings": [{"values": [0.1, 0.2]}]},
    )

    with pytest.raises(EmbeddingServiceError) as exc:
        service.embed_texts(["alpha", "beta"])

    assert exc.value.status_code == 502
    assert "vector count mismatch" in str(exc.value)
