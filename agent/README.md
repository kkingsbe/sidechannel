# Legacy harness assets

The runnable backend has moved to the top-level `api/`, `experiment-worker/`, `analysis-worker/`, and `packages/` workspace packages. Use the [current harness setup and operations guide](../docs/harness-operations.md) from the repository root.

`agent/examples/` retains the saved fixture and live-smoke evidence at their existing paths. Existing ignored `agent/.env`, `agent/.env.compose`, and `agent/secrets/` are preserved; environment precedence and Compose cutover are documented in the current guide. Do not delete or move them as incidental cleanup.

`agent/docs/` and the old Docker/Compose files are historical migration references. They do not define the current deployment entry point. `agent/AGENTS.md` is carried to the experiment worker, with the Mastra-specific prerequisite also applied to analysis-worker adapters.
