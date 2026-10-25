# Frontend Prediction Schema

Source file: `outputs/predictions/latest_unlabeled_risk_scores.csv`

Each row is one eligible elevator scored using complete data through
`prediction_month` to estimate risk for `predicted_target_month`.

| Column | Type | Description |
|---|---|---|
| `equipment_code` | string | Elevator equipment identifier. |
| `prediction_month` | date string | Month whose completed features were used. |
| `predicted_target_month` | date string | Next month being predicted. |
| `risk_probability` | float | Locked model probability estimate. |
| `locked_threshold` | float | Decision threshold, always `0.4433219097353501` for this model. |
| `predicted_failure_flag` | integer | `1` when `risk_probability >= locked_threshold`, else `0`. |
| `risk_tier` | string | Display tier: `high`, `medium`, or `low`. |
| `model_version` | string | Frozen research model identifier. |
| `model_type` | string | Model family. |
| `target_definition` | string | Positive-class definition. |
| `feature_set` | string | Locked feature-set name. |
| `feature_window_status` | string | Confirms row has the required full-history feature window. |
| `station_name` | string | Optional source context when available. |
| `station_mrn` | string/integer | Optional source context when available. |
| `station_complex_name` | string | Optional source context when available. |
| `station_complex_mrn` | string/integer | Optional source context when available. |
| `borough` | string | Optional source context when available. |

Risk tiers are display labels only:

- `high`: probability >= `0.4433219097353501`
- `medium`: probability >= `0.30` and < `0.4433219097353501`
- `low`: probability < `0.30`

The operational decision threshold is not changed by these tiers.
October 2026 outcomes are unavailable in the latest source data ending September 2026. This file must not be treated as evaluated
performance data. The map's frontend handoff separately applies its public
display cutoffs (high >= 0.65, medium >= the locked threshold, low below it).
