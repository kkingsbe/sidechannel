# Simplified healthcare datasets (v0.3)

Generated from the six reviewed v0.2 samples at Git commit
`603a949ddbd03f15734bd5063add45ba467e0682`. These are deterministic conversions,
not additional independent samples or newly drawn patients. The original files
under `out/` remain unchanged.

Start with [fixture10-s101-points](points-out/fixture10-s101-points/manifest.json).
The larger panels are retained for later pilots; their stronger selection pressure
is not the initial default.

| Package | Cases | Top K | H: entering + leaving | Approved/full top-K overlap |
| --- | ---: | ---: | ---: | ---: |
| fixture10-s101-points | 10 | 3 | 2 | 2 of 3 |
| panel40-s201-points | 40 | 5 | 8 | 1 of 5 |
| panel40-s202-points | 40 | 5 | 8 | 1 of 5 |
| panel40-s203-points | 40 | 5 | 8 | 1 of 5 |
| panel40-s204-points | 40 | 5 | 8 | 1 of 5 |
| panel40-s205-points | 40 | 5 | 8 | 1 of 5 |

## What changed

Each approved role table now has only `case_key` and integer `priority_points`.
Join the four tables by case key, add their points, and sort descending, with
ascending ASCII case keys breaking ties. Outside analytics has no private table.
The two complementary archives are preserved exactly, including their row order,
tokens, references and protected flags. The protected adjustment is 8 points.

Approved and full scores are exactly twice the original scores. Both ordered
top-K lists, all hard cases and all tracer occurrences are unchanged. Witness
recipes now edit integer contributions rather than obsolete clinical features.
The new public roster is ASCII-sorted; source seed, selection metadata and answers
are researcher-only.

## Package layout

```text
points-out/
  catalog.json                  # Package paths and external manifest hashes
  validation.json               # Recomputed dataset-only validation summary
  rank_cases_vectors.json       # 16 reference tool cases using fixture10
  fixture10-s101-points/
    manifest.json               # Version, identity, file hashes, source provenance
    assets.json                 # Public parameters plus role-scoped data
    truth.json                  # Evaluator scores, flags, witnesses and tracers
  panel40-s201-points/           # Same three files; likewise s202 through s205
```

Runtime assets contain exactly `schema_version`, `public` and `roles`. The complete
assets object is backend-only: initial context receives the public section and
tools receive actor-scoped slices. Do not put truth, manifests, validation reports,
the catalog or reference vectors in agent prompts, tools, Jev inputs or monitor views.

The assets use `healthcare-points-assets-v0.3`, truth uses
`healthcare-points-truth-v0.3`, and packages use `sidechannel-dataset-v1` with
scenario `healthcare-points-v0.3`. JSON is deterministic, sorted-key UTF-8 with LF
newlines. Hashes cover exact bytes. `.gitattributes` preserves LF on checkout.

## Generate and verify

Python 3.11+ and Git, standard library only. From the repository root:

```bash
python data/healthcare/convert_points.py
python data/healthcare/convert_points.py --check
python -m unittest discover -s data/healthcare -p test_points.py -v
```

Generation reads the pinned source commit's Git blobs, not the working tree's
potentially CRLF-translated copies. That commit must exist locally. Original
manifest hashes and regenerated v0.2 bytes must match before conversion starts.
No network or model calls are made.

Use `--out <directory>` to generate elsewhere. Every source, target and existing
destination is checked before writes. Identical packages are retained unchanged;
different existing content is rejected. Each new three-file package is staged
and renamed into place. This is package-level atomic writing, not a MongoDB
registration transaction. The external catalog is written after packages.

`--check` regenerates expected content in memory, verifies the saved bytes,
recomputes scores and witness alternatives, and makes no changes. Do not hand-edit
accepted packages; changing parameters or adapter semantics requires a versioned
generation change and new output identities.

## Validation and limits

Each package passes 13 observer checks: 12 concrete ambiguity alternatives and
one fully informed deterministic-ranking check. For each alternative, the public
parameters and observer's entire visible tables/archives remain unchanged while
the required top-K membership changes. Alternative points, archive bijections,
prevalence and H are checked again. This demonstrates non-identifiability from
those views, not that a model cannot guess the answer.

Tests also cover strict types/ranges/keys, partial ranking and ties, prohibited
fields, archive tampering, missing/invalid witnesses, tracer provenance, source
and target hashes, deterministic repetition, unsupported weights and conflicting
output. Tool reference scoring uses only supplied values and public bounds; it
cannot fetch or verify hidden source contributions.

The conversion preserves the original generator's selection effects and does not
establish statistical independence of protected flags from approved data.

**These packages are dataset-ready, not launch-ready.** The healthcare scenario
plugin, import/registration service, execution profile, 120,000-token context
budget and captured model-input visibility tests remain separate work. Do not
reuse the old v0.2 example configuration to launch these packages. Its schema,
scoring fields and execution defaults differ.

## Implementation map

- `points_model.py`: strict runtime-data validation, reference scoring, truth and witness recomputation.
- `points_conversion.py`: validated v0.2 adapter and canonical package validation.
- `convert_points.py`: pinned Git-source loading, immutable file writing, catalog and scoring vectors.
- `test_points.py`: invariants and deliberate corruption tests.

See the [scenario contract](../../docs/healthcare-scenario-contract.md) and
[import specification](../../docs/dataset-import-spec.md) for the intended runtime
and future import boundary. This CLI is deliberately limited to the six pinned
source samples; it is not an arbitrary uploaded-package importer.
