
# MTA Elevator Next-Month Failure Pipeline

Backend machine-learning pipeline for predicting next-month elevator risk in the
NYC subway system using monthly MTA elevator availability records.

The pipeline estimates, for each eligible elevator-month, whether the elevator
will experience a qualifying next-month failure event:

- `Entrapments > 0`, or
- `Unscheduled Outages >= 2`

The final locked model is a Random Forest trained on historical elevator-month
features. It is intended as a risk-ranking and triage aid, not as a deterministic
failure prediction system.

Clustering, map generation, and frontend presentation are intentionally out of
scope for this repository.

## What This Pipeline Does

This project provides a reproducible backend workflow that:

1. validates the fixed historical data snapshot,
2. builds leakage-safe next-month target labels,
3. applies temporal train/validation/frozen-test guardrails,
4. compares baseline, logistic regression, Random Forest, boosted-tree, and TCN
   challenger models,
5. locks a final Session 5 Random Forest model and threshold,
6. evaluates that locked model on later target-known MTA months, and
7. generates latest unlabeled elevator risk scores for the next month.

The most important reproducibility rule is that the frozen-test evaluation is
not rerun during routine Colab or local execution. The final notebook runs only
validation, prospective external evaluation, and latest-score generation.

## Locked Modeling Contract

- Prediction unit: one elevator-month.
- Prediction question: using information available through month `T`, estimate
  whether an elevator will experience a qualifying failure in month `T+1`.
- Primary target: next-month `Entrapments > 0` or
  `Unscheduled Outages >= 2`.
- Frozen final test period: February 1, 2025 through April 1, 2025.
- Final locked model: Random Forest.
- Final feature set: full-history operational features without age fields.
- Locked threshold: selected for approximately 70% recall on the frozen-test
  workflow.
- Primary model-selection metric: PR-AUC.
- Supporting metrics: precision, recall, false negatives, ROC-AUC, Brier score,
  and calibration diagnostics.

See [pipeline-outline.md](pipeline-outline.md) and [decisions.md](decisions.md)
for the full modeling history and guardrails.

## Repository Contents

Committed data and reproducibility inputs:

- `data/raw/df3_availability.csv`  
  Locked development/training snapshot used for model development and the
  frozen-test contract.
- `data/raw/df1_station_master.csv`  
  Small static station metadata / lookup table.
- `data/external/MTA_NYCT_Subway_Elevator_and_Escalator_Availability__Beginning_2015.csv`  
  Reference official MTA export downloaded on June 16, 2026.
- `outputs/metrics/session5_frozen_test_metrics.json`  
  Recorded frozen-test metrics used for comparison without rerunning
  frozen-test evaluation.

Not committed to Git:

- `outputs/models/final_random_forest.joblib`  
  Trained model artifact. Downloaded from GitHub Releases.
- `data/processed/`  
  Generated canonical data from Session 6.
- transient caches such as `__pycache__/`, `.pytest_cache/`, `.DS_Store`, and
  notebook checkpoints.

See [data/README.md](data/README.md) for data provenance and file roles.

## Option 1: Run In Google Colab

This is the recommended reproducibility path.

Open:

[notebooks/colab_runner.ipynb](notebooks/colab_runner.ipynb)

[![Open In Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/jiayili6812/mta-elevator-risk/blob/main/notebooks/colab_runner.ipynb)

The notebook:

1. clones this GitHub repository,
2. creates expected local folders,
3. uses the committed reference data files,
4. downloads `outputs/models/final_random_forest.joblib` from this project’s
   GitHub Release assets,
5. installs core dependencies,
6. runs the test suite,
7. validates the fixed data snapshot,
8. runs Session 6 prospective external evaluation, and
9. runs Session 7 final report and latest-score generation.

The Colab notebook does **not** run `final-evaluate`.

For the full Colab workflow, expected outputs, and instructions for replacing
the included MTA export with newer official data, see
[COLAB_COMPATIBILITY.md](COLAB_COMPATIBILITY.md).

## Option 2: Run Locally From Terminal

Create and activate a Python environment, then install the package:

```bash
python -m pip install -r requirements.txt
python -m pip install -e .
```

Download the trained model artifact from this project’s GitHub Release assets
and place it at:

```text
outputs/models/final_random_forest.joblib
```

Then run the core reproducibility workflow:

```bash
python -m pytest
python -m mta_elevator_pipeline.run_pipeline validate
python -m mta_elevator_pipeline.run_pipeline session6
python -m mta_elevator_pipeline.run_pipeline session7
```

Do not run frozen-test evaluation as part of normal reproduction.

The frozen-test command exists only as a guarded one-time path:

```bash
python -m mta_elevator_pipeline.run_pipeline final-evaluate \
  --acknowledge I_UNDERSTAND_THIS_ACCESSES_THE_FROZEN_TEST_SET
```

## Expected Outputs

Session 6 writes prospective external evaluation outputs:

- `data/processed/session6_latest_canonical_availability.csv`
- `outputs/metrics/session6_prospective_evaluation.md`
- `outputs/metrics/session6_prospective_metrics.json`
- `outputs/predictions/session6_prospective_predictions.csv`

Session 7 writes final backend reporting and latest unlabeled scores:

- `outputs/reports/final_model_card.md`
- `outputs/reports/final_backend_summary.md`
- `outputs/reports/final_metrics_comparison.csv`
- `outputs/reports/frontend_prediction_schema.md`
- `outputs/predictions/latest_unlabeled_risk_scores.csv`
- `outputs/predictions/latest_unlabeled_risk_scores_metadata.json`

With the included June 16, 2026 MTA export, Session 6 evaluates target-known
prediction months from June 1, 2025 through March 1, 2026. Session 7 uses April
1, 2026 feature rows to generate unlabeled May 1, 2026 risk scores.

## Current Performance Summary

On the prospective external evaluation window, the locked Session 5 Random
Forest produced results broadly consistent with the frozen-test result:

- Prospective PR-AUC: `0.653008`
- Prospective ROC-AUC: `0.711994`
- Prospective Brier score: `0.213711`
- Precision at locked threshold: `0.564278`
- Recall at locked threshold: `0.714476`

The model produces many useful high-risk rankings, but it also produces false
positives and false negatives. It should be used for prioritization, review
queues, planning support, and triage rather than automatic operational action.

## Newer MTA Data

To evaluate against a newer official MTA export:

1. Download the latest CSV from the MTA/data.ny.gov source page:
   <https://data.ny.gov/Transportation/MTA-NYCT-Subway-Elevator-and-Escalator-Availabilit/rc78-7x78>
2. Rename the downloaded file so the path is exactly:
   `data/external/MTA_NYCT_Subway_Elevator_and_Escalator_Availability__Beginning_2015.csv`
3. Replace the existing file at that path.
4. Rerun Session 6 and Session 7.

The pipeline currently expects that exact external CSV path.

Newer data should not be used to change the locked model, threshold, target
definition, feature set, or frozen-test result unless a separate retraining
workflow is explicitly created and documented.

## Project Structure

```text
config/                         Configuration files
data/                           Data snapshots, metadata, and provenance notes
notebooks/                      Colab reproducibility notebook
outputs/audits/                 Data and lineage audit outputs
outputs/metrics/                Development, frozen-test, and prospective metrics
outputs/predictions/            Prediction outputs
outputs/reports/                Final backend reports and model card
src/mta_elevator_pipeline/      Pipeline package code
tests/                          Unit and guardrail tests
```

## Notes

Optional TensorFlow and XGBoost dependencies remain outside the core Colab
workflow. The final reproducibility path uses only the core dependencies in
`requirements.txt`.