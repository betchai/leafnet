# Dataset Versioning

## Principles

Every trained model must be traceable to the exact data it used. A dataset
version is therefore an immutable snapshot: once referenced by a model version,
it never changes content under the same identifier.

## Layout

```
ml/data/
├── incoming/     # unreviewed drops land here first
├── raw/          # accepted originals (never modified)
├── validated/    # passed validation.py checks
├── rejected/     # failed quality/exclusion review (kept, not deleted)
├── processed/    # preprocessed derivatives
└── versions/     # per-version manifests (v0.1/, v1.0/)
```

Large image files are gitignored; manifests and version metadata are committed.

## What each version records (Dataset table + manifest)

- dataset version id
- total images & images per class
- train/validation/test counts (target: 1600/200/200 of 2000)
- annotation status breakdown
- source registry references ([data-sources.md](data-sources.md))
- changes from previous version
- known issues
- validation status

## Process

1. New data flows through: incoming → validated → annotated → approved.
2. A version is "cut" by generating a manifest
   (`ml/src/data/manifest.py`) listing exactly which approved images belong,
   including their split assignment and grouping keys.
3. The manifest is hashed and recorded on the `Dataset` row.
4. Any change to membership ⇒ new version, documented via
   `changesFromPrevious`.

Version numbering starts at `v0.1`; `v1.0` is reserved for the complete
2,000-image, fully-approved dataset.
