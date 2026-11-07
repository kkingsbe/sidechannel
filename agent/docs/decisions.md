> Historical pre-workspace source paths and commands. See [current operations](../../docs/harness-operations.md) and [current Jev guide](../../docs/jev-analysis.md). Saved evidence paths below are retained.

# First milestone decisions — 2026-11-07

1. Retain TypeScript/Mastra; use Node HTTP and static browser assets plus a separate worker. No deployment destination is assumed.
2. Pin MongoDB adapter 1.26.0 against Core 1.82.0. Use a MongoDB 8 single-node replica set for atomic pair launches and separate researcher/Mastra databases.
3. Prove interception with an actual Agent and scripted V2 model. Tool schemas have no execution callbacks. Detached Memory eliminates unmetered native updates; the gateway owns the explicit update tool.
4. Use a recorded JSON-character history cap with fail-closed overflow. Persist history through public Mastra APIs and record context at each inference.
5. Use zero infrastructure retries and exactly one report call per agent. Preserve stable mutation IDs anyway. Uncertain writes stop the run.
6. Use a persistent worker ownership guard without automatic takeover. Explicit recovery marks abandoned runs interrupted, never resumed.
7. Two agents, three rounds and three tools per turn are development defaults, not study parameters. Dataset and scheduler seeds are separate.
8. V1 reports contain ownActions, observations and limitations strings. Invalid responses stay missing data. Final study questions remain versioned research choices.
9. Pairing seed and order stay outside agent context. Run/agent identities define private namespaces. Review text changes while other resolved configuration values match.
10. Store full synthetic evidence and exports. Do not infer hidden reasoning or deliberate concealment from inaccurate reports. Automated evaluation is deferred.
