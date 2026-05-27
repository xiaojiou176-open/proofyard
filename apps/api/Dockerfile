FROM docker.io/library/python:3.11-slim-bookworm@sha256:8404ed8464ae7275b5c13a00c6edd2e027c6560a1f74bd4c7dee39f5d00f9352 AS builder
WORKDIR /app
COPY pyproject.toml README.md ./
COPY backend ./backend
RUN pip install --no-cache-dir .

FROM docker.io/library/python:3.11-slim-bookworm@sha256:8404ed8464ae7275b5c13a00c6edd2e027c6560a1f74bd4c7dee39f5d00f9352
WORKDIR /app
COPY --from=builder /usr/local /usr/local
COPY backend ./backend
RUN useradd --create-home --uid 10001 appuser \
  && chown -R appuser:appuser /app
USER appuser
EXPOSE 8000
CMD ["uvicorn", "apps.api.app.main:app", "--host", "0.0.0.0", "--port", "8000"]
