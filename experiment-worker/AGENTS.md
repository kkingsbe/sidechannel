# AGENTS.md

## CRITICAL: Load `mastra` skill first

Load the `mastra` skill BEFORE any Mastra work. Never rely on cached knowledge — APIs change between versions.

## Rules

- Register all agents, tools, workflows, and scorers in `src/mastra/index.ts`
- Use the package `studio` and `build:studio` scripts instead of running `mastra dev` / `mastra build` directly. The ordinary `build` compiles the production worker.

## Resources

- [Mastra Documentation](https://mastra.ai/llms.txt)
