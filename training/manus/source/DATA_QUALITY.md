# Data Quality Notes

## Summary

These notes describe known structural and trial-count issues in the published sEMG-MANUS dataset.

## Published Counts

- Participant folders: 18
- Published gesture taxonomy: 22 gestures
- Total CSV files after cleanup: 3108
- Recommended benchmark cohort CSV files: 2969
- Ideal benchmark cohort total under the nominal protocol: 2970
- Net difference for the benchmark cohort: `-1` recording

## Incomplete Participants

These participant folders are published for completeness but should be excluded from balanced between-user analyses unless partial-data handling is part of the study design.

- `u_1`: 57 CSV files across `s_1` and `s_2`
- `u_2`: 16 CSV files in `s_1`
- `u_17`: 66 CSV files in `s_1`

## Core Cohort Trial-Count Anomalies

The 15-participant benchmark cohort is almost complete but contains three explicit trial-count anomalies:

- `u_7/s_1/g_thumbs_up` has 2 recordings instead of 3
- `u_8/s_1/g_tap_middle` has 2 recordings instead of 3
- `u_9/s_2/g_tap_pinky` has 4 recordings instead of 3

Across the full benchmark cohort, these deviations sum to one net missing trial.

## Privacy Check

The repository preparation step scanned for `name.txt` files and found none in the current dataset tree. Since participant CSV files are not committed to git, privacy-sensitive checks should still be rerun locally before each release build.

## Recommended Analysis Practice

- Use the manifest to filter to `core_cohort == true` for benchmark-style studies.
- Use `anomaly_flag == false` if you need only nominal 3-trial conditions.
- Keep the full deposit when archival completeness matters more than balance.
