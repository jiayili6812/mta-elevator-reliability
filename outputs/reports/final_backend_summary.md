# Final Backend Summary

The backend research pipeline is frozen as an evaluated Random Forest pipeline.
No Session 7 step retuned, retrained, recalibrated, stacked, changed features,
changed the target, changed eligibility, changed the threshold, or reran the
frozen test.

## Plain-Language Performance

The model catches many next-month qualifying failures: frozen-test recall was
`0.694087` and prospective recall was
`0.721728` at the locked threshold.
It misses some failures: frozen-test false negatives were
`119` over three months, and
prospective false negatives were `625`
over 15 later target-known months.

A false alarm means the elevator was flagged at or above the locked threshold
but did not have the target event next month. It should be interpreted as an
elevated-risk maintenance signal, not as a confirmed future incident.

Appropriate uses are ranking, triage, review queues, and planning support.
Inappropriate uses are automatic punitive decisions, claims that low-risk
elevators are safe, live incident detection, or any deployment retrain presented
as the same evaluated research model.

## Final Outputs

- Model card: `outputs/reports/final_model_card.md`
- Backend summary: `outputs/reports/final_backend_summary.md`
- Metrics comparison: `outputs/reports/final_metrics_comparison.csv`
- Frontend prediction schema: `outputs/reports/frontend_prediction_schema.md`
- Latest predictions: `outputs/predictions/latest_unlabeled_risk_scores.csv`
- Latest prediction metadata: `outputs/predictions/latest_unlabeled_risk_scores_metadata.json`

## Latest Prediction Batch

- Prediction month: `2026-09-01`
- Predicted target month: `2026-10-01`
- Prediction rows: `357`
- High risk: `185`
- Medium risk: `131`
- Low risk: `41`

Risk tiers are for communication/display only. The locked operational decision
threshold remains `0.4433219097353501`.

## Colab Packaging

`notebooks/colab_runner.ipynb` exists and has valid JSON. A live clean Colab CPU
runtime execution remains pending unless run manually outside this local
session.
