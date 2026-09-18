# Codebook

## Overview

This codebook describes the published on-disk format of the sEMG-MANUS dataset. The published release consists of raw CSV recordings organized by participant, session, and gesture.

The public benchmark taxonomy contains 22 gestures.

## Recommended Usage

- Use the full deposit if you need archival completeness.
- Use the 15-participant core cohort for balanced between-user work:
  - `u_3` to `u_16`
  - `u_18`
- Treat `u_1`, `u_2`, and `u_17` as incomplete participants.

## Folder Structure

```text
data/
  u_<participant_id>/
    s_<session_id>/
      g_<gesture_id>/
        recording_<speed>_<timestamp>.csv
```

Components:

- `u_<participant_id>`: participant folder, for example `u_8`
- `s_<session_id>`: session folder, for example `s_2`
- `g_<gesture_id>`: gesture folder, for example `g_flexext_fist`
- `recording_<speed>_<timestamp>.csv`: one recording at `slow`, `medium`, or `fast`

## Recording Protocol

The publication docs follow the thesis protocol, while keeping the raw files untouched.

- Participants:
  - 18 participant folders are published
  - 15 participants form the recommended benchmark cohort
  - all participants are right-handed in the thesis cohort description
- Sessions:
  - the benchmark protocol targeted 3 sessions per participant
  - `u_1`, `u_2`, and `u_17` are incomplete
- Speeds:
  - `slow`
  - `medium`
  - `fast`

Task intent from the thesis:

- General gestures were intended as 10-second recordings.
- XRMI tap and pinch gestures were open-ended note-target trials.
- `g_melody` is the open-ended XR musical interaction condition.

Observed raw-file row counts vary across recordings, so downstream processing should use the actual file contents rather than assuming a fixed number of samples per trial.

## Gesture Taxonomy

Published gesture labels use the on-disk `pinky` naming convention.

### General Gestures (13)

- `g_flexext_fist`
- `g_flexext_thumb`
- `g_flexext_index`
- `g_flexext_middle`
- `g_flexext_ring`
- `g_flexext_pinky`
- `g_finger_tap_surface`
- `g_thumbs_up`
- `g_point_index`
- `g_ab_add_all`
- `g_ab_add_thumb_index`
- `g_ab_add_index_middle`
- `g_ab_add_middle_ring`

### XRMI Gestures (9)

- `g_tap_thumb`
- `g_tap_index`
- `g_tap_middle`
- `g_tap_ring`
- `g_tap_pinky`
- `g_pinched_tap_thumb_index`
- `g_pinched_tap_index_middle`
- `g_pinched_tap_middle_ring`
- `g_melody`

## CSV Schema

Each CSV file contains one header row followed by sample rows. The header is written with a leading `#` in the raw files.

### Column Groups

- 8 EMG channels
- 10 Myo IMU channels
- 20 finger-joint channels
- 4 wrist quaternion channels

### Full Column Order

1. `emg_0`
2. `emg_1`
3. `emg_2`
4. `emg_3`
5. `emg_4`
6. `emg_5`
7. `emg_6`
8. `emg_7`
9. `imu_quat_w`
10. `imu_quat_x`
11. `imu_quat_y`
12. `imu_quat_z`
13. `imu_acc_x`
14. `imu_acc_y`
15. `imu_acc_z`
16. `imu_gyro_x`
17. `imu_gyro_y`
18. `imu_gyro_z`
19. `thumb_spread`
20. `thumb_mcp`
21. `thumb_pip`
22. `thumb_dip`
23. `index_spread`
24. `index_mcp`
25. `index_pip`
26. `index_dip`
27. `middle_spread`
28. `middle_mcp`
29. `middle_pip`
30. `middle_dip`
31. `ring_spread`
32. `ring_mcp`
33. `ring_pip`
34. `ring_dip`
35. `pinky_spread`
36. `pinky_mcp`
37. `pinky_pip`
38. `pinky_dip`
39. `wrist_quat_x`
40. `wrist_quat_y`
41. `wrist_quat_z`
42. `wrist_quat_w`

## Data Semantics

- EMG:
  - 8 Myo armband channels
  - stored in the raw format produced by the recording application
- IMU:
  - Myo quaternion, acceleration, and gyroscope channels
  - stored in device-exported numeric form
- Finger-joint channels:
  - 20 MANUS glove kinematic channels
  - described in the thesis as joint-angle data
- Wrist quaternion:
  - 4 orientation channels

Where exact unit scaling is device-specific, treat the raw CSV values as authoritative and refer to the original hardware/software stack for calibration-specific interpretation.

## Manifest Fields

The Zenodo staging process generates `manifest.csv` with these columns:

- `relative_path`
- `sha256`
- `size_bytes`
- `user_id`
- `session_id`
- `gesture_id`
- `speed`
- `row_count`
- `core_cohort`
- `incomplete_participant`
- `anomaly_flag`
- `notes`

## Known Limitations

- `u_1`, `u_2`, and `u_17` are incomplete.
- The core cohort has one net missing trial relative to the ideal `15 × 3 sessions × 22 gestures × 3 speeds = 2970` recordings.
- Known trial-count anomalies in the core cohort:
  - `u_7/s_1/g_thumbs_up`: 2 recordings
  - `u_8/s_1/g_tap_middle`: 2 recordings
  - `u_9/s_2/g_tap_pinky`: 4 recordings
- Session-to-session variability is expected in both sEMG and glove data.
- The dataset contains right-handed participants only.
