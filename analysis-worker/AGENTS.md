# Analysis worker instructions

Load the `mastra` skill before changing any Mastra-backed monitor adapter. Provider SDKs belong to this service; shared preparation/domain code must remain provider independent.

The experiment Mastra registry and its registration instructions live in `../experiment-worker/AGENTS.md`. Do not import that runtime from this service.
