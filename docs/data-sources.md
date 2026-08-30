# Data Sources Registry

> No external data has been downloaded or incorporated yet. Each candidate
> below must have its license verified **before any use**. Provenance is kept
> separate from the LEAFNET research dataset; external datasets are never
> silently merged into the 2,000-image target.

## Candidate datasets (health/disease classification)

### Mulberry Leaf Dataset (Rajshahi, Bangladesh) — Kaggle
- URL: https://www.kaggle.com/datasets/nahiduzzaman13/mulberry-leaf-dataset
- Contents: ~1,091 expert-annotated photos — healthy (440), leaf rust (489),
  leaf spot (162). DSLR, field conditions, Rajshahi sericulture region.
- Provenance: created for Frontiers in Plant Science (2023),
  doi:10.3389/fpls.2023.1175515; annotated by Bangladesh Sericulture
  Development Board experts.
- Coverage vs taxonomy: healthy ✅, leaf_rust ✅, leaf_spot ✅,
  **leaf_blight ❌ absent**.
- Potential role: benchmarking / reference; possibly external test set after
  license review and label-standard comparison. Not automatically merged into
  the research dataset.
- License: ⚠️ TO VERIFY on Kaggle before any use.
- Access date: — (record when accessed)

## Relevant literature establishing class definitions

| Source | Use |
|---|---|
| Arunakumar et al. 2023, "Diversity of fungal pathogens in leaf spot disease of Indian mulberry", PMC10665727 | leaf_spot symptomatology, spot→blight ambiguity |
| Frontiers in Plant Science 2025, "Identification of Pseudocerospora mori… grey leaf spot" | grey leaf spot symptoms |
| Baiyewu et al. 2005, Pak. J. Plant Pathol. — leaf rust of mulberry (*Cerotelium fici*) | rust symptom progression |
| Gonçalves et al. 2022, Plant Disease — C. fici on *M. nigra*, Brazil | pustule morphology |
| Kasuya et al. 2024, Mycoscience — *Gymnosporangium mori* comb. nov. | rust taxonomy |
| Dev Maji 2011 — brown leaf rust epidemiology (*Peridiopsora mori*) | rust severity/epidemiology |
| Soylu et al. 2003, Plant Pathology — *Phloeospora maculans* leaf spot | vein-limited spots |
| Florida DPI Circular 329 (1990) — *Mycosphaerella mori* | necrotic circular spots |
| Texas A&M Plant Disease Handbook — mulberry | bacterial blight, leaf spots, false mildew |
| J-Stage 2014, "Mulberry Diseases and Their Control" | disease overview incl. bacterial blight |

## Distinction to maintain

Some public mulberry datasets classify **variety/cultivar** (e.g. distinguishing
Morus species or cultivars) — that is a DIFFERENT task from health/disease
classification and must not be mixed into this project's labels.

## Required fields per source entry

`source_name · url · license · citation · access_date · usage_restrictions ·
permitted_role (training / validation / external testing / benchmarking / reference only)`
