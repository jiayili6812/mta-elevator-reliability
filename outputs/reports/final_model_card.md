# Final Model Card

## Model Identity

- Status: frozen evaluated backend research model
- Model version: `session5_locked_random_forest_research_v1`
- Model type: Random Forest
- Target: next-month Entrapments > 0 or Unscheduled Outages >= 2
- Feature set: `full_history_without_age`
- Parameters: `{'n_estimators': 600, 'max_depth': 20, 'min_samples_leaf': 15, 'max_features': 'sqrt', 'class_weight': 'balanced_subsample', 'random_state': 42}`
- Calibration: none
- Locked decision threshold: `0.4433219097353501`

## Evaluation Stages

Development validation selected the target, feature set, model family,
parameters, calibration policy, and threshold. Frozen-test evaluation was the
one-time final holdout evaluation. Prospective external evaluation checked the
unchanged locked model on later target-known months. Latest unlabeled
prediction generation applies the locked model to 2026-09-01
features for 2026-10-01 risk and is not an evaluation.

| Stage | Period | Rows | PR-AUC | Precision | Recall | FP | FN |
|---|---|---:|---:|---:|---:|---:|---:|
| development_validation | rolling validation; operating metrics on 2024-11-01 through 2025-01-01 | 966 | 0.715758 | 0.626223 | 0.706402 | 191 | 133 |
| frozen_test | 2025-02-01 through 2025-04-01 | 974 | 0.648004 | 0.526316 | 0.694087 | 243 | 119 |
| prospective_external | 2025-06-01 through 2026-08-01 | 5191 | 0.652072 | 0.558388 | 0.721728 | 1282 | 625 |

## Latest Unlabeled Prediction Output

- Prediction month: `2026-09-01`
- Predicted target month: `2026-10-01`
- Rows: `357`
- Evaluated: `false`
- Reason not evaluated: October 2026 outcomes are unavailable in the latest source data ending September 2026.

## Appropriate Uses

Use the output as a risk-ranking and triage aid for elevator-months after
complete month-T reporting is available. Treat high-risk rows as candidates for
review, maintenance planning, or additional operational investigation.

## Inappropriate Uses

Do not use the model as a guarantee of failure or safety, a sole basis for
service decisions, a real-time detector, or an estimate for elevators without
the required six-month feature history. Do not use prospective results or the
latest unlabeled scores to retune the frozen research model.

## Limitations

- False positives are expected: a high-risk flag means risk is elevated, not
  that failure is certain.
- False negatives are expected: roughly 30% of positives were missed in frozen
  and prospective evaluation at the locked threshold.
- X-suffixed equipment is excluded from supervised eligibility.
- True zero-history elevator performance is not measured.
- `Time Since Major Improvement` remains excluded because its semantics are
  unresolved.
