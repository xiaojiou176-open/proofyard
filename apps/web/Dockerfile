FROM docker.io/library/node:20-bookworm-slim@sha256:eef3816042c0f522a2ca9655c1947ca6f97c908b0c227aa50e19432646342ab7 AS build
WORKDIR /app
COPY pnpm-lock.yaml package.json tsconfig.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/web apps/web
RUN corepack enable && pnpm install --frozen-lockfile
RUN pnpm --dir apps/web build

FROM docker.io/library/nginx:1.27-alpine@sha256:62223d644fa234c3a1cc785ee14242ec47a77364226f1c811d2f669f96dc2ac8
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
USER nginx
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
