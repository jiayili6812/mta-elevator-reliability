"""Final backend reports and latest unlabeled prediction outputs."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import joblib
import pandas as pd

from .config import project_path
from .session6 import LATEST_CANONICAL, LATEST_SOURCE, LOCKED_MODEL, LOCKED_THRESHOLD
from .session6 import _prepare_locked_features, _sha256
from .source_to_canonical import write_canonical_availability
from .targets import TARGET_COLUMN


REPORTS_DIR = Path("outputs/reports")
PREDICTIONS_DIR = Path("outputs/predictions")
LATEST_PREDICTIONS_CSV = PREDICTIONS_DIR / "latest_unlabeled_risk_scores.csv"
LATEST_PREDICTIONS_METADATA = PREDICTIONS_DIR / "latest_unlabeled_risk_scores_metadata.json"
FINAL_MODEL_CARD = REPORTS_DIR / "final_model_card.md"
FINAL_BACKEND_SUMMARY = REPORTS_DIR / "final_backend_summary.md"
FINAL_METRICS_COMPARISON = REPORTS_DIR / "final_metrics_comparison.csv"
FRONTEND_SCHEMA = REPORTS_DIR / "frontend_prediction_schema.md"

MODEL_VERSION = "session5_locked_random_forest_research_v1"
MODEL_TYPE = "Random Forest"
TARGET_DEFINITION = "next-month Entrapments > 0 or Unscheduled Outages >= 2"
FEATURE_SET = "full_history_without_age"
MEDIUM_RISK_CUTOFF = 0.30


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _write_json(value: dict[str, object], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2), encoding="utf-8")


def _load_json(path: str) -> dict[str, object]:
    return json.loads(project_path(path).read_text(encoding="utf-8"))


def _canonical_latest_data() -> tuple[pd.DataFrame, Path]:
    canonical_path = project_path(LATEST_CANONICAL)
    if canonical_path.exists():
        return pd.read_csv(canonical_path), canonical_path
    source_path = project_path(LATEST_SOURCE)
    if not source_path.exists():
        raise FileNotFoundError(f"Latest official source file not found: {source_path}")
    return write_canonical_availability(source_path, canonical_path, overwrite=True), canonical_path


def _risk_tier(probability: float) -> str:
    if probability >= LOCKED_THRESHOLD:
        return "high"
    if probability >= MEDIUM_RISK_CUTOFF:
        return "medium"
    return "low"


def _latest_unlabeled_predictions(config: dict) -> dict[str, object]:
    canonical, canonical_path = _canonical_latest_data()
    source_months = pd.to_datetime(canonical["Month"])
    latest_month = source_months.max()
    target_month = latest_month + pd.DateOffset(months=1)

    featured, features, minimum_history = _prepare_locked_features(config, canonical)
    latest_rows = featured[(featured["Month"] == latest_month) & featured[TARGET_COLUMN].isna()].copy()
    if latest_rows.empty:
        raise RuntimeError(
            f"No eligible unlabeled feature rows found for latest month {latest_month:%Y-%m-%d}."
        )

    model_path = project_path(LOCKED_MODEL)
    if not model_path.exists():
        raise FileNotFoundError(f"Locked model artifact not found: {model_path}")
    model = joblib.load(model_path)
    probabilities = model.predict_proba(latest_rows[features])[:, 1]

    output = pd.DataFrame(
        {
            "equipment_code": latest_rows["Equipment Code"].astype(str).to_numpy(),
            "prediction_month": latest_rows["Month"].dt.strftime("%Y-%m-%d").to_numpy(),
            "predicted_target_month": target_month.strftime("%Y-%m-%d"),
            "risk_probability": probabilities,
            "locked_threshold": LOCKED_THRESHOLD,
            "predicted_failure_flag": (probabilities >= LOCKED_THRESHOLD).astype(int),
            "risk_tier": [_risk_tier(float(value)) for value in probabilities],
            "model_version": MODEL_VERSION,
            "model_type": MODEL_TYPE,
            "target_definition": TARGET_DEFINITION,
            "feature_set": FEATURE_SET,
            "feature_window_status": f"eligible_{minimum_history}_consecutive_month_full_history",
        }
    )
    optional_context = {
        "Station Name": "station_name",
        "Station MRN": "station_mrn",
        "Station Complex Name": "station_complex_name",
        "Station Complex MRN": "station_complex_mrn",
        "Borough": "borough",
    }
    for source_column, output_column in optional_context.items():
        if source_column in latest_rows.columns:
            output[output_column] = latest_rows[source_column].to_numpy()

    output = output.sort_values(
        ["risk_probability", "equipment_code"], ascending=[False, True]
    ).reset_index(drop=True)
    output_path = project_path(LATEST_PREDICTIONS_CSV)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output.to_csv(output_path, index=False)

    counts = output["risk_tier"].value_counts().reindex(["high", "medium", "low"], fill_value=0)
    metadata = {
        "created_at_utc": _utc_now(),
        "status": "latest_unlabeled_predictions_generated_no_evaluation",
        "prediction_month": latest_month.strftime("%Y-%m-%d"),
        "predicted_target_month": target_month.strftime("%Y-%m-%d"),
        "rows": int(len(output)),
        "elevators": int(output["equipment_code"].nunique()),
        "high_risk_rows": int(counts["high"]),
        "medium_risk_rows": int(counts["medium"]),
        "low_risk_rows": int(counts["low"]),
        "locked_threshold": LOCKED_THRESHOLD,
        "medium_display_cutoff": MEDIUM_RISK_CUTOFF,
        "risk_tier_note": "Risk tiers are for communication/display only; the locked decision threshold is unchanged.",
        "evaluated": False,
        "evaluation_reason": (
            f"{target_month:%B %Y} outcomes are unavailable in the latest source "
            f"data ending {latest_month:%B %Y}."
        ),
        "model_path": str(LOCKED_MODEL),
        "model_version": MODEL_VERSION,
        "model_type": MODEL_TYPE,
        "target_definition": TARGET_DEFINITION,
        "feature_set": FEATURE_SET,
        "minimum_consecutive_history_months": minimum_history,
        "canonical_data_path": str(LATEST_CANONICAL),
        "canonical_data_sha256": _sha256(canonical_path),
        "output_path": str(LATEST_PREDICTIONS_CSV),
        "output_schema_path": str(FRONTEND_SCHEMA),
        "guardrails": {
            "used_locked_research_model": True,
            "model_retrained": False,
            "model_retuned": False,
            "threshold_changed": False,
            "frozen_test_rerun": False,
            "fixed_training_snapshot_overwritten": False,
        },
    }
    _write_json(metadata, project_path(LATEST_PREDICTIONS_METADATA))
    return {"predictions": output, "metadata": metadata}


def _metrics_comparison() -> pd.DataFrame:
    development = _load_json("outputs/metrics/final_development_model_decision.json")
    session4 = _load_json("outputs/metrics/session4_development_validation.json")
    frozen = _load_json("outputs/metrics/session5_frozen_test_metrics.json")
    prospective = _load_json("outputs/metrics/session6_prospective_metrics.json")

    dev_operating = development["fold_4_operating_metrics"]
    dev_detail = session4["focused_tuning"]["random_forest"]["selected_result"]["metrics"]["latest_fold"]
    frozen_overall = frozen["overall_metrics"]
    prospective_overall = prospective["overall_metrics"]
    rows = [
        {
            "stage": "development_validation",
            "period": "rolling validation; operating metrics on 2024-11-01 through 2025-01-01",
            "rows": dev_detail["validation_rows"],
            "elevators": dev_detail["validation_equipment"],
            "prevalence": dev_detail["validation_prevalence"],
            "pr_auc": dev_operating["pr_auc"],
            "roc_auc": dev_detail["roc_auc"],
            "brier_score": dev_detail["brier_score"],
            "precision": dev_operating["precision"],
            "recall": dev_operating["recall"],
            "false_positives": dev_operating["false_positives"],
            "false_negatives": dev_operating["false_negatives"],
            "threshold": development["selected_threshold"],
            "notes": "Model and threshold selected from development only; fold-4 metrics use the fixed threshold selected on folds 1-3.",
        },
        {
            "stage": "frozen_test",
            "period": "2025-02-01 through 2025-04-01",
            "rows": frozen["cohort"]["rows"],
            "elevators": frozen["cohort"]["elevators"],
            "prevalence": frozen["cohort"]["prevalence"],
            "pr_auc": frozen_overall["pr_auc"],
            "roc_auc": frozen_overall["roc_auc"],
            "brier_score": frozen_overall["brier_score"],
            "precision": frozen_overall["precision"],
            "recall": frozen_overall["recall"],
            "false_positives": frozen_overall["false_positives"],
            "false_negatives": frozen_overall["false_negatives"],
            "threshold": frozen_overall["threshold"],
            "notes": "One-time final evaluation; not used for tuning.",
        },
        {
            "stage": "prospective_external",
            "period": f"{min(prospective['cohort']['months'])} through {max(prospective['cohort']['months'])}",
            "rows": prospective["cohort"]["rows"],
            "elevators": prospective["cohort"]["elevators"],
            "prevalence": prospective["cohort"]["prevalence"],
            "pr_auc": prospective_overall["pr_auc"],
            "roc_auc": prospective_overall["roc_auc"],
            "brier_score": prospective_overall["brier_score"],
            "precision": prospective_overall["precision"],
            "recall": prospective_overall["recall"],
            "false_positives": prospective_overall["false_positives"],
            "false_negatives": prospective_overall["false_negatives"],
            "threshold": prospective_overall["threshold"],
            "notes": "External target-known later-month evaluation; not used for tuning or retraining.",
        },
    ]
    comparison = pd.DataFrame(rows)
    path = project_path(FINAL_METRICS_COMPARISON)
    path.parent.mkdir(parents=True, exist_ok=True)
    comparison.to_csv(path, index=False)
    return comparison


def _format_float(value: object) -> str:
    return "" if value == "" else f"{float(value):.6f}"


def _markdown_table(frame: pd.DataFrame) -> str:
    lines = [
        "| Stage | Period | Rows | PR-AUC | Precision | Recall | FP | FN |",
        "|---|---|---:|---:|---:|---:|---:|---:|",
    ]
    for row in frame.to_dict("records"):
        lines.append(
            "| {stage} | {period} | {rows} | {pr_auc} | {precision} | {recall} | {fp} | {fn} |".format(
                stage=row["stage"],
                period=row["period"],
                rows=row["rows"],
                pr_auc=_format_float(row["pr_auc"]),
                precision=_format_float(row["precision"]),
                recall=_format_float(row["recall"]),
                fp=row["false_positives"],
                fn=row["false_negatives"],
            )
        )
    return "\n".join(lines)


def _write_reports(comparison: pd.DataFrame, latest: dict[str, object]) -> None:
    development = _load_json("outputs/metrics/final_development_model_decision.json")
    frozen = _load_json("outputs/metrics/session5_frozen_test_metrics.json")
    prospective = _load_json("outputs/metrics/session6_prospective_metrics.json")
    metadata = latest["metadata"]
    table = _markdown_table(comparison)

    model_card = f"""# Final Model Card

## Model Identity

- Status: frozen evaluated backend research model
- Model version: `{MODEL_VERSION}`
- Model type: {MODEL_TYPE}
- Target: {TARGET_DEFINITION}
- Feature set: `{FEATURE_SET}`
- Parameters: `{development['selected_parameters']}`
- Calibration: none
- Locked decision threshold: `{LOCKED_THRESHOLD}`

## Evaluation Stages

Development validation selected the target, feature set, model family,
parameters, calibration policy, and threshold. Frozen-test evaluation was the
one-time final holdout evaluation. Prospective external evaluation checked the
unchanged locked model on later target-known months. Latest unlabeled
prediction generation applies the locked model to {metadata['prediction_month']}
features for {metadata['predicted_target_month']} risk and is not an evaluation.

{table}

## Latest Unlabeled Prediction Output

- Prediction month: `{metadata['prediction_month']}`
- Predicted target month: `{metadata['predicted_target_month']}`
- Rows: `{metadata['rows']}`
- Evaluated: `false`
- Reason not evaluated: {metadata['evaluation_reason']}

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
"""
    project_path(FINAL_MODEL_CARD).write_text(model_card, encoding="utf-8")

    backend_summary = f"""# Final Backend Summary

The backend research pipeline is frozen as an evaluated Random Forest pipeline.
No Session 7 step retuned, retrained, recalibrated, stacked, changed features,
changed the target, changed eligibility, changed the threshold, or reran the
frozen test.

## Plain-Language Performance

The model catches many next-month qualifying failures: frozen-test recall was
`{frozen['overall_metrics']['recall']:.6f}` and prospective recall was
`{prospective['overall_metrics']['recall']:.6f}` at the locked threshold.
It misses some failures: frozen-test false negatives were
`{frozen['overall_metrics']['false_negatives']}` over three months, and
prospective false negatives were `{prospective['overall_metrics']['false_negatives']}`
over {len(prospective['cohort']['months'])} later target-known months.

A false alarm means the elevator was flagged at or above the locked threshold
but did not have the target event next month. It should be interpreted as an
elevated-risk maintenance signal, not as a confirmed future incident.

Appropriate uses are ranking, triage, review queues, and planning support.
Inappropriate uses are automatic punitive decisions, claims that low-risk
elevators are safe, live incident detection, or any deployment retrain presented
as the same evaluated research model.

## Final Outputs

- Model card: `{FINAL_MODEL_CARD}`
- Backend summary: `{FINAL_BACKEND_SUMMARY}`
- Metrics comparison: `{FINAL_METRICS_COMPARISON}`
- Frontend prediction schema: `{FRONTEND_SCHEMA}`
- Latest predictions: `{LATEST_PREDICTIONS_CSV}`
- Latest prediction metadata: `{LATEST_PREDICTIONS_METADATA}`

## Latest Prediction Batch

- Prediction month: `{metadata['prediction_month']}`
- Predicted target month: `{metadata['predicted_target_month']}`
- Prediction rows: `{metadata['rows']}`
- High risk: `{metadata['high_risk_rows']}`
- Medium risk: `{metadata['medium_risk_rows']}`
- Low risk: `{metadata['low_risk_rows']}`

Risk tiers are for communication/display only. The locked operational decision
threshold remains `{LOCKED_THRESHOLD}`.

## Colab Packaging

`notebooks/colab_runner.ipynb` exists and has valid JSON. A live clean Colab CPU
runtime execution remains pending unless run manually outside this local
session.
"""
    project_path(FINAL_BACKEND_SUMMARY).write_text(backend_summary, encoding="utf-8")

    schema = f"""# Frontend Prediction Schema

Source file: `{LATEST_PREDICTIONS_CSV}`

Each row is one eligible elevator scored using complete data through
`prediction_month` to estimate risk for `predicted_target_month`.

| Column | Type | Description |
|---|---|---|
| `equipment_code` | string | Elevator equipment identifier. |
| `prediction_month` | date string | Month whose completed features were used. |
| `predicted_target_month` | date string | Next month being predicted. |
| `risk_probability` | float | Locked model probability estimate. |
| `locked_threshold` | float | Decision threshold, always `{LOCKED_THRESHOLD}` for this model. |
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

- `high`: probability >= `{LOCKED_THRESHOLD}`
- `medium`: probability >= `0.30` and < `{LOCKED_THRESHOLD}`
- `low`: probability < `0.30`

The operational decision threshold is not changed by these tiers.
{metadata['evaluation_reason']} This file must not be treated as evaluated
performance data. The map's frontend handoff separately applies its public
display cutoffs (high >= 0.65, medium >= the locked threshold, low below it).
"""
    project_path(FRONTEND_SCHEMA).write_text(schema, encoding="utf-8")


def _validate_colab_notebook() -> bool:
    path = project_path("notebooks/colab_runner.ipynb")
    json.loads(path.read_text(encoding="utf-8"))
    return True


def run_session7_final_backend_reporting(config: dict) -> dict[str, object]:
    latest = _latest_unlabeled_predictions(config)
    comparison = _metrics_comparison()
    project_path(REPORTS_DIR).mkdir(parents=True, exist_ok=True)
    _write_reports(comparison, latest)
    colab_json_valid = _validate_colab_notebook()
    report = {
        "status": "completed",
        "backend_research_pipeline_frozen": True,
        "created_at_utc": _utc_now(),
        "latest_predictions": latest["metadata"],
        "reports": {
            "final_model_card": str(FINAL_MODEL_CARD),
            "final_backend_summary": str(FINAL_BACKEND_SUMMARY),
            "final_metrics_comparison": str(FINAL_METRICS_COMPARISON),
            "frontend_prediction_schema": str(FRONTEND_SCHEMA),
        },
        "colab": {
            "notebook_exists": project_path("notebooks/colab_runner.ipynb").exists(),
            "notebook_valid_json": colab_json_valid,
            "clean_runtime_execution_status": "pending",
        },
        "guardrails": {
            "frozen_test_rerun": False,
            "model_retrained": False,
            "model_retuned": False,
            "calibration_changed": False,
            "threshold_changed": False,
            "prospective_results_used_for_model_improvement": False,
            "fixed_training_snapshot_overwritten": False,
        },
    }
    return report
