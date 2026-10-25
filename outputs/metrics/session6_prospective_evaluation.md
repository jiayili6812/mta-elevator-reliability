# Session 6 Prospective External Evaluation

This evaluates the locked Session 5 Random Forest on target-known official
months after `2025-05-01`. No model, feature, threshold, calibration, target,
or eligibility rule was changed.

## Source And Canonical Data

- Latest official source: `/Users/jiali/mta-elevators/mta-elevator-risk-repo/data/external/MTA_NYCT_Subway_Elevator_and_Escalator_Availability__Beginning_2015.csv`
- Source rows: `83776` from `2015-01-01` through `2026-09-01`
- Saved canonical file: `data/processed/session6_latest_canonical_availability.csv`
- Canonical rows: `25309` from `2021-01-01` through `2026-09-01`
- Canonical schema matches locked contract: `True`

## Prospective Cohort

- Prediction months: `2025-06-01, 2025-07-01, 2025-08-01, 2025-09-01, 2025-10-01, 2025-11-01, 2025-12-01, 2026-01-01, 2026-02-01, 2026-03-01, 2026-04-01, 2026-05-01, 2026-06-01, 2026-07-01, 2026-08-01`
- Rows: `5191`
- Elevators: `356`
- Positive rows: `2246`
- Prevalence: `0.432672`

## Locked Model Performance

- PR-AUC: `0.652072`
- ROC-AUC: `0.712059`
- Brier score: `0.213749`
- Precision at `0.4433219097353501`: `0.558388`
- Recall at `0.4433219097353501`: `0.721728`
- Confusion matrix: TN `1663`, FP `1282`, FN `625`, TP `1621`
- Calibration ECE: `0.051149`

## Metrics By Month

| Month | Rows | Elevators | Prevalence | PR-AUC | ROC-AUC | Brier | Precision | Recall | FP | FN |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2025-06-01 | 340 | 340 | 0.402941 | 0.626351 | 0.722016 | 0.211645 | 0.556150 | 0.759124 | 83 | 33 |
| 2025-07-01 | 340 | 340 | 0.373529 | 0.582517 | 0.704373 | 0.214610 | 0.481081 | 0.700787 | 96 | 38 |
| 2025-08-01 | 341 | 341 | 0.422287 | 0.615591 | 0.696983 | 0.216635 | 0.567901 | 0.638889 | 70 | 52 |
| 2025-09-01 | 341 | 341 | 0.463343 | 0.650556 | 0.708134 | 0.215523 | 0.604396 | 0.696203 | 72 | 48 |
| 2025-10-01 | 341 | 341 | 0.451613 | 0.646559 | 0.709251 | 0.215139 | 0.578947 | 0.714286 | 80 | 44 |
| 2025-11-01 | 341 | 341 | 0.466276 | 0.695730 | 0.723201 | 0.210364 | 0.583756 | 0.723270 | 82 | 44 |
| 2025-12-01 | 343 | 343 | 0.489796 | 0.759180 | 0.743333 | 0.203449 | 0.623711 | 0.720238 | 73 | 47 |
| 2026-01-01 | 346 | 346 | 0.485549 | 0.704036 | 0.724886 | 0.209602 | 0.625641 | 0.726190 | 73 | 46 |
| 2026-02-01 | 346 | 346 | 0.427746 | 0.666795 | 0.714544 | 0.214364 | 0.555556 | 0.777027 | 92 | 33 |
| 2026-03-01 | 346 | 346 | 0.393064 | 0.612019 | 0.677416 | 0.225710 | 0.467337 | 0.683824 | 106 | 43 |
| 2026-04-01 | 348 | 348 | 0.410920 | 0.667780 | 0.722309 | 0.209782 | 0.541872 | 0.769231 | 93 | 33 |
| 2026-05-01 | 352 | 352 | 0.443182 | 0.614901 | 0.680730 | 0.224053 | 0.542714 | 0.692308 | 91 | 48 |
| 2026-06-01 | 354 | 354 | 0.460452 | 0.652430 | 0.679424 | 0.222417 | 0.576923 | 0.736196 | 88 | 43 |
| 2026-07-01 | 356 | 356 | 0.426966 | 0.647880 | 0.720266 | 0.212265 | 0.555556 | 0.723684 | 88 | 42 |
| 2026-08-01 | 356 | 356 | 0.373596 | 0.694781 | 0.765703 | 0.200676 | 0.517766 | 0.766917 | 95 | 31 |

## Frozen-Test Comparison

- Frozen-test PR-AUC: `0.648004` versus prospective `0.652072`
- Frozen-test ROC-AUC: `0.716806` versus prospective `0.712059`
- Frozen-test Brier: `0.209976` versus prospective `0.213749`
- Frozen-test precision: `0.526316` versus prospective `0.558388`
- Frozen-test recall: `0.694087` versus prospective `0.721728`

Plain-language assessment: Compared with the saved frozen-test estimate, prospective PR-AUC is higher (0.652072 versus 0.648004); ROC-AUC is lower (0.712059 versus 0.716806); Brier score is higher (0.213749 versus 0.209976); precision is higher (0.558388 versus 0.526316); recall is higher (0.721728 versus 0.694087). Cohort periods and sizes differ; these observations do not change the locked model.

## Guardrails

- Frozen-test evaluation was not rerun.
- The saved Session 5 model artifact was loaded unchanged.
- Feature set: `full_history_without_age`.
- Threshold: `0.4433219097353501` unchanged.
- Calibration: none.
- Prospective results were not used for tuning or retraining.
