ARG NODE_IMAGE=docker.io/library/node:20-bookworm-slim@sha256:eef3816042c0f522a2ca9655c1947ca6f97c908b0c227aa50e19432646342ab7
ARG PYTHON_IMAGE=docker.io/library/python:3.11-slim-bookworm@sha256:8404ed8464ae7275b5c13a00c6edd2e027c6560a1f74bd4c7dee39f5d00f9352

FROM ${PYTHON_IMAGE} AS python-runtime

FROM ${NODE_IMAGE}

ARG PYTHON_VERSION=3.11.15
ARG PNPM_VERSION=10.22.0
ARG UV_VERSION=0.8.15
ARG PLAYWRIGHT_VERSION=1.58.2
ARG ACTIONLINT_VERSION=1.7.11
ARG GITLEAKS_VERSION=8.24.2
ARG K6_VERSION=0.49.0
ARG SEMGREP_VERSION=1.118.0
ARG TARGETPLATFORM=linux/amd64

ENV DEBIAN_FRONTEND=noninteractive
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PNPM_HOME=/usr/local/share/pnpm
ENV PATH=/root/.local/bin:/usr/local/share/pnpm:${PATH}

COPY --from=python-runtime /usr/local /usr/local

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git jq procps unzip xz-utils \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g "corepack@0.31.0" \
  && corepack enable \
  && corepack prepare "pnpm@${PNPM_VERSION}" --activate

RUN mkdir -p /tmp/uv-install \
  && curl -LsSf "https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-x86_64-unknown-linux-gnu.tar.gz" \
    | tar -xz -C /tmp/uv-install \
  && install -m 0755 /tmp/uv-install/uv-x86_64-unknown-linux-gnu/uv /usr/local/bin/uv \
  && install -m 0755 /tmp/uv-install/uv-x86_64-unknown-linux-gnu/uvx /usr/local/bin/uvx \
  && rm -rf /tmp/uv-install \
  && python3 --version \
  && uv --version

RUN curl -fsSL "https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/actionlint_${ACTIONLINT_VERSION}_linux_amd64.tar.gz" \
    | tar -xz -C /usr/local/bin actionlint \
  && curl -fsSL "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz" \
    | tar -xz -C /usr/local/bin gitleaks \
  && curl -LsSf "https://github.com/grafana/k6/releases/download/v${K6_VERSION}/k6-v${K6_VERSION}-linux-amd64.tar.gz" \
    | tar -xz -C /tmp \
  && install -m 0755 "/tmp/k6-v${K6_VERSION}-linux-amd64/k6" /usr/local/bin/k6 \
  && rm -rf "/tmp/k6-v${K6_VERSION}-linux-amd64" \
  && python3 -m pip install --no-cache-dir "semgrep==${SEMGREP_VERSION}"

RUN mkdir -p /workspace "${PLAYWRIGHT_BROWSERS_PATH}" \
  && chmod 777 /workspace "${PLAYWRIGHT_BROWSERS_PATH}"

WORKDIR /workspace

RUN npm install -g "playwright@${PLAYWRIGHT_VERSION}" \
  && playwright install --with-deps chromium
