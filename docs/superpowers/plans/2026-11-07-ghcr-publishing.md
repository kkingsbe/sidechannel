> Historical pre-workspace implementation plan. Paths and commands below record the earlier layout; use [current operations](../../harness-operations.md) for workspace commands and deployment.

# GHCR Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the repository's application container in GitHub Actions and publish it to GHCR.

**Architecture:** The four application services share `agent/Dockerfile` and differ by their Compose commands. Build that image once with the repository root as context, publish it as `ghcr.io/<repository>-agent`, and let Compose select a published image through `SIDECHANNEL_IMAGE`. MongoDB and cloudflared retain their upstream images.

**Tech Stack:** GitHub Actions, Docker Buildx, GHCR, Docker Compose.

## Global Constraints

- Preserve unrelated working-tree changes.
- Use the existing Dockerfile, root context, and Linux AMD64 platform.
- Build pull requests without registry login or publishing.
- Publish main pushes, `v*` tags, and manual runs using `GITHUB_TOKEN`.
- Keep `latest` exclusive to main; also emit branch/tag and full commit SHA tags.
- Pin external actions to verified commit SHAs and cache build layers.
- Keep local Compose builds as the default.

## Task 1: Publish the shared application image

**Files:**
- Create: `.github/workflows/docker-publish.yml`
- Modify: `agent/compose.yaml`
- Modify: `agent/.env.compose.example`
- Modify: `agent/README.md`

**Interfaces:** Consume `agent/Dockerfile` with context `.`; produce `ghcr.io/kkingsbe/sidechannel-agent` and the optional `SIDECHANNEL_IMAGE` Compose setting.

- [ ] Add checkout, Buildx setup, conditional GHCR login, Docker metadata, and build/push steps. Grant only `contents: read` and `packages: write`; disable checkout credential persistence. Use GitHub Actions cache with scope `sidechannel-agent`.
- [ ] Change the shared Compose image to `${SIDECHANNEL_IMAGE:-sidechannel-agent:local}` and document the optional variable in `.env.compose.example`.
- [ ] Document triggers, image tags, authentication, and deployment with `docker compose --env-file .env.compose up -d --no-build --pull always --wait` from `agent/`.
- [ ] Validate workflow syntax with actionlint, verify Compose defaults and overrides, and build `docker build --file agent/Dockerfile --tag sidechannel-agent:ghcr-check .` without running or replacing services.
- [ ] Review the diff and report verification results. Remote publication starts once the workflow is committed and pushed.
