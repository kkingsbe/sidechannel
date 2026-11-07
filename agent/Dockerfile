FROM node:24.11.1-bookworm-slim@sha256:48abc13a19400ca3985071e287bd405a1d99306770eb81d61202fb6b65cf0b57

WORKDIR /app
COPY package.json package-lock.json ./
# tsx and the Mastra CLI are runtime dependencies of these entry points.
RUN npm ci --no-audit --no-fund && npm cache clean --force
COPY --chown=node:node src ./src
COPY --chown=node:node tsconfig.json ./
RUN chown node:node /app
USER node
RUN npm run build -- --studio
ENV MASTRA_TELEMETRY_DISABLED=1
CMD ["npm", "run", "dashboard"]
