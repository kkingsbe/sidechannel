# Historical pre-workspace Dockerfile; use root Compose and api/experiment-worker/analysis-worker Dockerfiles.
FROM node:24.11.1-bookworm-slim@sha256:48abc13a19400ca3985071e287bd405a1d99306770eb81d61202fb6b65cf0b57 AS dependencies
WORKDIR /app/agent
COPY agent/package.json agent/package-lock.json ./
# tsx and the Mastra CLI are runtime dependencies of these entry points.
RUN npm ci --no-audit --no-fund && npm cache clean --force

FROM dependencies AS dashboard-build
WORKDIR /app/dashboard
COPY dashboard/package.json dashboard/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY dashboard/ ./
# Type-only shared contracts are resolved by the frontend type checker.
COPY agent/src/ /app/agent/src/
RUN npm run build

FROM dependencies
WORKDIR /app/agent
COPY --chown=node:node agent/src ./src
COPY --chown=node:node agent/tsconfig.json ./
COPY --from=dashboard-build --chown=node:node /app/dashboard/dist /app/dashboard/dist
RUN chown -R node:node /app
USER node
RUN npm run build -- --studio
ENV MASTRA_TELEMETRY_DISABLED=1
CMD ["npm", "run", "dashboard"]
