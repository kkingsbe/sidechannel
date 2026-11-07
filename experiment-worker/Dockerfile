FROM node:24.11.1-bookworm-slim@sha256:48abc13a19400ca3985071e287bd405a1d99306770eb81d61202fb6b65cf0b57 AS manifests
WORKDIR /app
COPY package.json package-lock.json ./
COPY api/package.json ./api/package.json
COPY experiment-worker/package.json ./experiment-worker/package.json
COPY analysis-worker/package.json ./analysis-worker/package.json
COPY dashboard/package.json ./dashboard/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/domain/package.json ./packages/domain/package.json
COPY packages/persistence/package.json ./packages/persistence/package.json
COPY tests/integration/package.json ./tests/integration/package.json

FROM manifests AS build
RUN npm ci --no-audit --no-fund
ENV NX_DAEMON=false
COPY nx.json tsconfig.base.json eslint.config.mjs ./
COPY scripts/ ./scripts/
COPY tests/integration/ ./tests/integration/
COPY packages/ ./packages/
COPY api/ ./api/
COPY experiment-worker/ ./experiment-worker/
COPY analysis-worker/ ./analysis-worker/
COPY dashboard/ ./dashboard/
RUN npm exec -- nx run @sidechannel/experiment-worker:build

# Resolve each service's production dependency graph independently.
FROM manifests AS runtime-dependencies
RUN npm ci --omit=dev --workspace=@sidechannel/experiment-worker --include-workspace-root=false --no-audit --no-fund && npm cache clean --force

FROM node:24.11.1-bookworm-slim@sha256:48abc13a19400ca3985071e287bd405a1d99306770eb81d61202fb6b65cf0b57 AS runtime
WORKDIR /app/experiment-worker
ENV NODE_ENV=production MASTRA_TELEMETRY_DISABLED=1
COPY --from=runtime-dependencies --chown=node:node /app/node_modules /app/node_modules
COPY --from=build --chown=node:node /app/experiment-worker/package.json ./package.json
COPY --from=build --chown=node:node /app/experiment-worker/dist ./dist
COPY --from=build --chown=node:node /app/packages/contracts/package.json /app/packages/contracts/package.json
COPY --from=build --chown=node:node /app/packages/contracts/dist /app/packages/contracts/dist
COPY --from=build --chown=node:node /app/packages/domain/package.json /app/packages/domain/package.json
COPY --from=build --chown=node:node /app/packages/domain/dist /app/packages/domain/dist
COPY --from=build --chown=node:node /app/packages/persistence/package.json /app/packages/persistence/package.json
COPY --from=build --chown=node:node /app/packages/persistence/dist /app/packages/persistence/dist
USER node
CMD ["node", "dist/main.js"]

# Optional Studio has its own Mastra build, separate from production worker output.
FROM build AS studio-build
RUN npm run build:studio --workspace=@sidechannel/experiment-worker

FROM runtime AS studio
COPY --from=studio-build --chown=node:node /app/experiment-worker/.mastra/output ./.mastra/output
CMD ["node", ".mastra/output/index.mjs"]

FROM runtime AS production
