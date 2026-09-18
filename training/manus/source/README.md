# sEMG-MANUS Dataset

This repository is the public companion repository for a multimodal dataset of synchronised surface electromyography (sEMG) and finger joint angle recordings captured with a Thalmic Labs Myo armband and a MANUS Quantum Metaglove.

The dataset was created to support research on data-driven hand pose estimation, gesture analysis, and XR musical interaction. The primary methodological description appears in Chapter 8 of my PhD thesis _When XR Meets AI: Design and Machine Learning for Performer-Centred Gestural Control in Extended Reality Musical Instruments_.

The public GitHub repository does **not** include the participant CSV files. Raw data is prepared locally and published separately as a Zenodo dataset record.

## Records

- Dataset DOI: `10.5281/zenodo.19261324`
- Recording application: [`sEMG-manus-manager`](https://github.com/maxgraf96/sEMG-manus-manager)

## What Is Included Here

- publication metadata for GitHub and Zenodo
- dataset documentation and codebook
- data-quality notes for known missing and duplicate trials
- local scripts to build a Zenodo-ready package from the ignored `data/` tree

## Dataset Scope

- Modalities:
  - 8-channel Myo sEMG
  - 10 Myo IMU channels
  - 20 MANUS finger-joint channels
  - 4 wrist quaternion channels
- On-disk CSV schema: 42 columns per sample
- Gesture taxonomy: 22 published gestures
- Participant folders in the full release: 18
- Recommended benchmark cohort: 15 participants (`u_3` to `u_16` and `u_18`)

## Cohort Note

The published Zenodo package contains 18 participant folders for completeness. However, `u_1`, `u_2`, and `u_17` are incomplete and should be excluded from balanced between-user analyses unless a study explicitly models missingness or partial data.

The 15-participant benchmark cohort is therefore:

- `u_3` to `u_16`
- `u_18`

Even within that core cohort, the raw tree contains a small number of trial-count anomalies:

- `u_7/s_1/g_thumbs_up` has 2 recordings instead of 3
- `u_8/s_1/g_tap_middle` has 2 recordings instead of 3
- `u_9/s_2/g_tap_pinky` has 4 recordings instead of 3

The local QC scripts and generated manifest flag these cases explicitly.

## File Layout In The Zenodo Archive

The Zenodo package produced by `./scripts/build_zenodo_package` contains:

- `semg-manus-dataset-v1.zip`
- `README.md`
- `CODEBOOK.md`
- `DATA_QUALITY.md`
- `manifest.csv`
- `checksums.txt`
- `LICENSE-data-CC-BY-4.0.txt`

Inside `semg-manus-dataset-v1.zip`, the raw tree is preserved as:

```text
data/
  u_<participant_id>/
    s_<session_id>/
      g_<gesture_id>/
        recording_<speed>_<dd>_<mm>_<yyyy>_<HH>_<MM>_<SS>.csv
```

## Privacy

This repository is intended to be public. Participant CSV files are excluded from git via `.gitignore`.

At the time this repository was prepared, a local scan found no `name.txt` files in the dataset tree. The packaging workflow also checks for banned gesture folders and reports any direct identifier files it finds by name.

## Local Build

Place the raw dataset under `data/` locally, then run:

```bash
./scripts/build_zenodo_package
```

This generates the ignored local outputs under `build/`, including:

- `build/manifest.csv`
- `build/reports/qc_report.json`
- `build/reports/qc_report.md`
- `build/zenodo-package/`

## Citation

If you use this dataset, cite both the Zenodo dataset record and the companion repository/software release once the DOIs have been assigned.

Suggested citation text:

> Graf, Max, and Mathieu Barthet. sEMG-MANUS dataset and companion repository. Queen Mary University of London. Dataset DOI: `10.5281/zenodo.19261324`.

