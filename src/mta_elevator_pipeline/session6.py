"""Prospective external evaluation for the locked Session 5 model."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import joblib
import pandas as pd

from .config import project_path
from .eligibility import add_consecutive_history_months, add_eligibility_flags, add_feature_set_eligibility
from .evaluate import calibration_diagnostics, evaluate_probabilities
from .features import build_features, minimum_history_for_feature_set
from .source_to_canonical import CANONICAL_COLUMNS, write_canonical_availability
from .targets import TARGET_COLUMN, build_next_month_target
from .validation import validate_availability_data


LATEST_SOURCE = Path(
    "data/external/MTA_NYCT_Subway_Elevator_and_Escalator_Availability__Beginning_2015.csv"
)
LATEST_CANONICAL = Path("data/processed/session6_latest_canonical_availability.csv")
METRICS_JSON = Path("outputs/metrics/session6_prospective_metrics.json")
EVALUATION_MD = Path("outputs/metrics/session6_prospective_evaluation.md")
PREDICTIONS_CSV = Path("outputs/predictions/session6_prospective_predictions.csv")
LOCKED_MODEL = Path("outputs/models/final_random_forest.joblib")
LOCKED_THRESHOLD = 0.4433219097353501
PROSPECTIVE_AFTER = pd.Timestamp("2025-05-01")


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _source_summary(path: Path) -> dict[str, object]:
    source = pd.read_csv(path)
    months = pd.to_datetime(source["Month"])
    return {
        "path": str(path),
        "sha256": _sha256(path),
        "rows": int(len(source)),
        "columns": list(source.columns),
        "start_month": months.min().strftime("%Y-%m-%d"),
        "end_month": months.max().strftime("%Y-%m-%d"),
        "equipment_rows_by_type": source["Equipment Type"].value_counts(dropna=False).astype(int).to_dict(),
        "equipment_count": int(source["Equipment Code"].nunique()),
        "duplicate_equipment_month_rows": int(source.duplicated(["Equipment Code", "Month"]).sum()),
    }


def _prepare_locked_features(config: dict, canonical: pd.DataFrame) -> tuple[pd.DataFrame, list[str], int]:
    validate_availability_data(canonical)
    prepared = add_eligibility_flags(
        canonical,
        excluded_equipment_code_suffixes=config["eligibility"]["excluded_equipment_code_suffixes"],
        minimum_history_months=config["eligibility"]["minimum_history_months"],
    )
    prepared = add_consecutive_history_months(prepared)
    prepared = prepared[prepared["eligible_for_modeling"]].copy()
    prepared = build_next_month_target(
        prepared,
        unscheduled_threshold=config["target"]["unscheduled_outage_threshold"],
        entrapment_threshold=config["target"]["entrapment_threshold"],
    )
    definition = config["features"]["feature_sets"]["full_history"]
    minimum_history = minimum_history_for_feature_set(
        definition["lag_months"], definition["rolling_windows"]
    )
    featured, features = build_features(
        prepared,
        lag_months=definition["lag_months"],
        rolling_windows=definition["rolling_windows"],
        include_seasonality=False,
        include_age=False,
    )
    eligible = add_feature_set_eligibility(featured, minimum_history)
    return eligible[eligible["eligible_for_feature_set"]].copy(), features, minimum_history


def _month_metrics(predictions: pd.DataFrame) -> dict[str, object]:
    output = {}
    for month, rows in predictions.groupby("prediction_month", sort=True):
        y_true = rows["actual_target"].astype(int).to_numpy()
        probabilities = rows["probability"].to_numpy()
        output[str(month)] = {
            "rows": int(len(rows)),
            "elevators": int(rows["equipment_code"].nunique()),
            "positives": int(y_true.sum()),
            "prevalence": float(y_true.mean()),
            **evaluate_probabilities(y_true, probabilities, LOCKED_THRESHOLD),
            "calibration": calibration_diagnostics(y_true, probabilities),
        }
    return output


def _write_json(value: dict[str, object], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2), encoding="utf-8")


def _evaluation_markdown(report: dict[str, object]) -> str:
    if not report["prospective_data_available"]:
        return f"""# Session 6 Prospective External Evaluation

Status: **no target-known prospective rows available**

The latest official source was transformed successfully, but no eligible
target-known prediction months after `2025-05-01` were available. No locked
model predictions were evaluated.
"""

    overall = report["overall_metrics"]
    months = "\n".join(
        f"| {month} | {metrics['rows']} | {metrics['elevators']} | {metrics['prevalence']:.6f} | {metrics['pr_auc']:.6f} | {metrics['roc_auc']:.6f} | {metrics['brier_score']:.6f} | {metrics['precision']:.6f} | {metrics['recall']:.6f} | {metrics['false_positives']} | {metrics['false_negatives']} |"
        for month, metrics in report["metrics_by_month"].items()
    )
    comparison = report["frozen_test_comparison"]
    return f"""# Session 6 Prospective External Evaluation

This evaluates the locked Session 5 Random Forest on target-known official
months after `2025-05-01`. No model, feature, threshold, calibration, target,
or eligibility rule was changed.

## Source And Canonical Data

- Latest official source: `{report['source']['path']}`
- Source rows: `{report['source']['rows']}` from `{report['source']['start_month']}` through `{report['source']['end_month']}`
- Saved canonical file: `{report['canonical']['path']}`
- Canonical rows: `{report['canonical']['rows']}` from `{report['canonical']['start_month']}` through `{report['canonical']['end_month']}`
- Canonical schema matches locked contract: `{report['canonical']['schema_matches_training_contract']}`

## Prospective Cohort

- Prediction months: `{', '.join(report['cohort']['months'])}`
- Rows: `{report['cohort']['rows']}`
- Elevators: `{report['cohort']['elevators']}`
- Positive rows: `{report['cohort']['positives']}`
- Prevalence: `{report['cohort']['prevalence']:.6f}`

## Locked Model Performance

- PR-AUC: `{overall['pr_auc']:.6f}`
- ROC-AUC: `{overall['roc_auc']:.6f}`
- Brier score: `{overall['brier_score']:.6f}`
- Precision at `{overall['threshold']}`: `{overall['precision']:.6f}`
- Recall at `{overall['threshold']}`: `{overall['recall']:.6f}`
- Confusion matrix: TN `{overall['true_negatives']}`, FP `{overall['false_positives']}`, FN `{overall['false_negatives']}`, TP `{overall['true_positives']}`
- Calibration ECE: `{report['calibration']['expected_calibration_error']:.6f}`

## Metrics By Month

| Month | Rows | Elevators | Prevalence | PR-AUC | ROC-AUC | Brier | Precision | Recall | FP | FN |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
{months}

## Frozen-Test Comparison

- Frozen-test PR-AUC: `{comparison['frozen_test']['pr_auc']:.6f}` versus prospective `{overall['pr_auc']:.6f}`
- Frozen-test ROC-AUC: `{comparison['frozen_test']['roc_auc']:.6f}` versus prospective `{overall['roc_auc']:.6f}`
- Frozen-test Brier: `{comparison['frozen_test']['brier_score']:.6f}` versus prospective `{overall['brier_score']:.6f}`
- Frozen-test precision: `{comparison['frozen_test']['precision']:.6f}` versus prospective `{overall['precision']:.6f}`
- Frozen-test recall: `{comparison['frozen_test']['recall']:.6f}` versus prospective `{overall['recall']:.6f}`

Plain-language assessment: {comparison['assessment']}

## Guardrails

- Frozen-test evaluation was not rerun.
- The saved Session 5 model artifact was loaded unchanged.
- Feature set: `full_history_without_age`.
- Threshold: `{LOCKED_THRESHOLD}` unchanged.
- Calibration: none.
- Prospective results were not used for tuning or retraining.
"""


def run_session6_prospective_evaluation(config: dict) -> dict[str, object]:
    source_path = project_path(LATEST_SOURCE)
    if not source_path.exists():
        raise FileNotFoundError(f"Latest official source file not found: {source_path}")
    model_path = project_path(LOCKED_MODEL)
    if not model_path.exists():
        raise FileNotFoundError(f"Locked model artifact not found: {model_path}")

    canonical_path = project_path(LATEST_CANONICAL)
    canonical = write_canonical_availability(source_path, canonical_path, overwrite=True)
    canonical_months = pd.to_datetime(canonical["Month"])
    canonical_summary = {
        "path": str(LATEST_CANONICAL),
        "sha256": _sha256(canonical_path),
        "rows": int(len(canonical)),
        "columns": list(canonical.columns),
        "start_month": canonical_months.min().strftime("%Y-%m-%d"),
        "end_month": canonical_months.max().strftime("%Y-%m-%d"),
        "equipment_count": int(canonical["Equipment Code"].nunique()),
        "schema_matches_training_contract": list(canonical.columns) == CANONICAL_COLUMNS,
    }

    featured, features, minimum_history = _prepare_locked_features(config, canonical)
    prospective = featured[
        featured[TARGET_COLUMN].notna() & (featured["Month"] > PROSPECTIVE_AFTER)
    ].copy()
    report: dict[str, object] = {
        "status": "completed",
        "created_at_utc": _utc_now(),
        "source": _source_summary(source_path),
        "canonical": canonical_summary,
        "locked_model_path": str(LOCKED_MODEL),
        "locked_threshold": LOCKED_THRESHOLD,
        "feature_set": "full_history_without_age",
        "minimum_consecutive_history_months": minimum_history,
        "features": features,
        "prospective_after_prediction_month": PROSPECTIVE_AFTER.strftime("%Y-%m-%d"),
        "prospective_data_available": bool(not prospective.empty),
    }
    if prospective.empty:
        empty = pd.DataFrame(
            columns=[
                "equipment_code",
                "prediction_month",
                "probability",
                "thresholded_prediction",
                "actual_target",
            ]
        )
        PREDICTIONS_CSV.parent.mkdir(parents=True, exist_ok=True)
        empty.to_csv(project_path(PREDICTIONS_CSV), index=False)
        report["cohort"] = {"rows": 0, "elevators": 0, "months": []}
        _write_json(report, project_path(METRICS_JSON))
        project_path(EVALUATION_MD).parent.mkdir(parents=True, exist_ok=True)
        project_path(EVALUATION_MD).write_text(_evaluation_markdown(report), encoding="utf-8")
        return report

    model = joblib.load(model_path)
    probabilities = model.predict_proba(prospective[features])[:, 1]
    y_true = prospective[TARGET_COLUMN].astype(int).to_numpy()
    predictions = pd.DataFrame(
        {
            "equipment_code": prospective["Equipment Code"].astype(str).to_numpy(),
            "prediction_month": prospective["Month"].dt.strftime("%Y-%m-%d").to_numpy(),
            "probability": probabilities,
            "thresholded_prediction": (probabilities >= LOCKED_THRESHOLD).astype(int),
            "actual_target": y_true,
        }
    )
    predictions_path = project_path(PREDICTIONS_CSV)
    predictions_path.parent.mkdir(parents=True, exist_ok=True)
    predictions.to_csv(predictions_path, index=False)

    overall = evaluate_probabilities(y_true, probabilities, LOCKED_THRESHOLD)
    frozen = json.loads(project_path("outputs/metrics/session5_frozen_test_metrics.json").read_text(encoding="utf-8"))
    frozen_overall = frozen["overall_metrics"]
    assessment = (
        "Compared with the saved frozen-test estimate, prospective "
        + "; ".join(
            f"{name} is {'higher' if overall[key] > frozen_overall[key] else 'lower' if overall[key] < frozen_overall[key] else 'unchanged'} "
            f"({overall[key]:.6f} versus {frozen_overall[key]:.6f})"
            for key, name in [('pr_auc', 'PR-AUC'), ('roc_auc', 'ROC-AUC'),
                              ('brier_score', 'Brier score'), ('precision', 'precision'),
                              ('recall', 'recall')]
        )
        + ". Cohort periods and sizes differ; these observations do not change the locked model."
    )
    report.update(
        {
            "cohort": {
                "rows": int(len(prospective)),
                "elevators": int(prospective["Equipment Code"].nunique()),
                "months": sorted(predictions["prediction_month"].unique().tolist()),
                "positives": int(y_true.sum()),
                "negatives": int(len(y_true) - y_true.sum()),
                "prevalence": float(y_true.mean()),
                "rows_by_month": predictions.groupby("prediction_month").size().astype(int).to_dict(),
                "elevators_by_month": predictions.groupby("prediction_month")["equipment_code"].nunique().astype(int).to_dict(),
            },
            "overall_metrics": overall,
            "calibration": calibration_diagnostics(y_true, probabilities),
            "metrics_by_month": _month_metrics(predictions),
            "frozen_test_comparison": {
                "frozen_test": {
                    "pr_auc": frozen_overall["pr_auc"],
                    "roc_auc": frozen_overall["roc_auc"],
                    "brier_score": frozen_overall["brier_score"],
                    "precision": frozen_overall["precision"],
                    "recall": frozen_overall["recall"],
                    "false_positives": frozen_overall["false_positives"],
                    "false_negatives": frozen_overall["false_negatives"],
                },
                "assessment": assessment,
            },
            "guardrails": {
                "frozen_test_not_rerun": True,
                "locked_model_loaded_unchanged": True,
                "no_tuning_or_retraining": True,
                "fixed_training_snapshot_overwritten": False,
            },
        }
    )
    _write_json(report, project_path(METRICS_JSON))
    project_path(EVALUATION_MD).parent.mkdir(parents=True, exist_ok=True)
    project_path(EVALUATION_MD).write_text(_evaluation_markdown(report), encoding="utf-8")
    return report
