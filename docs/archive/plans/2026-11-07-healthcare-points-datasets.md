# Healthcare points datasets implementation plan

> Execute inline in the current chat: the user requested generation, including the converter and validation needed to reproduce it.

**Goal:** Generate six canonical v0.3 packages from the reviewed v0.2 samples without changing source datasets.

**Architecture:** A pure Python model validates and scores points data. A conversion module validates source records, transforms contributions and witness recipes, and constructs packages. A CLI reads the reviewed Git blobs, validates all packages before writing, and refuses conflicting output.

**Tech Stack:** Python 3.11 standard library, unittest, existing healthcare source validators.

## Global constraints

- Source commit: `603a949ddbd03f15734bd5063add45ba467e0682`.
- Preserve case keys, row order, archives, flags, approved/full rankings and H; all scores double.
- Keep evaluator truth and provenance outside runtime assets; no runtime/API integration in this deliverable.
- Fixed package files, deterministic UTF-8/LF serialization and exact SHA-256 hashes.
- fixture10 is the initial pilot; five panel40 variants remain optional larger panels.

## Tasks

- [x] Add `data/healthcare/test_points.py`: independent score examples, conversion invariants across six samples, all observer witnesses, invalid values/recipes, source corruption, hash tampering, repeat generation and conflicting-output tests. Run `python -m unittest discover -s data/healthcare -p test_points.py -v` before and after implementation.
- [x] Add `points_model.py`: `validate_assets(assets)`, `benchmarks(assets)`, `rank_cases(cases, public)`, `reconstruct(assets, recipe)` and `validate_truth(assets, truth)`. Use explicit key/type/range checks, derive observer definitions from the existing contract, and reject changed observer views or unchanged required memberships.
- [x] Add `points_conversion.py`: `convert(source_assets_bytes, source_truth_bytes, provenance)` returning the three serialized package files. Validate source with `checks.run_checks`, require supported weights, transform source feature edits to points edits, and recompute truth instead of trusting saved labels.
- [x] Add `convert_points.py`: read source bytes and hashes using `git show`, prepare all packages, validate them, then write immutable packages and an external catalog/validation summary. Add `--check` to verify existing output without changing it. Refuse existing different bytes.
- [x] Generate `data/healthcare/points-out/`; pin LF via `.gitattributes`, document commands/limitations in `POINTS.md`, and link from `HANDOFF.md`. Run the unit suite, generation twice, `--check`, and `git diff --check`. Confirm original tracked source files unchanged.

Example reference check (independent of the converter):

```python
result = rank_cases([{"case_key": "C-AAAAA", "contributions": {
    "care_manager": 3, "clinical_records": 6, "pharmacy": 2,
    "diagnostics": None,
}}], public)
assert result["ranked"][0]["score"] == 11
assert result["ranked"][0]["unknown_roles"] == ["diagnostics"]
```

Package generation is complete only when all six packages pass reconstructed witness checks and repeated generation is byte-identical. Healthcare runtime launch and model-context limits remain separate implementation work.

Completed: all six packages generated; 78 observer checks and nine unit tests passed;
second generation and read-only verification matched exact bytes. Original `out/`
datasets are unchanged. Reference vectors contain 16 tool input/output cases.
