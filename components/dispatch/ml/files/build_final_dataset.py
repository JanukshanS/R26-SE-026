"""
UADO Final Dataset Build — v3
================================
Consolidates: real questionnaire (443) + real OBD (285) + expert DTC
mapping (183 rows, 14/21 classes) + template/distribution-fit
augmentation to reach ~1000 scale with balanced classes.

Schema change: drops `location_name` and `vehicle_model` (high
cardinality relative to N: 20 and 26 unique values respectively,
diffuse/no dominant category -- see cardinality audit). Keeps
`vehicle_make` (9 categories, well-populated).
"""
import numpy as np
import pandas as pd

RNG_SEED = 42
rng = np.random.default_rng(RNG_SEED)
TARGET_N = 50
MAX_SYNTH_MULT = 3.0

DROPPED_FIELDS = ['location_name', 'vehicle_model']
CONTEXT_COLS = ['vehicle_make', 'fuel_type', 'last_fueled', 'recent_rain', 'parked_overnight']
DIAGNOSTIC_COLS = ['Q1_intent','Q2_engine_start','Q2b_running_issue','Q3_sound','Q3b_electrical',
                   'Q4_noise_detail','Q7_overheat_detail','Q8_smoke_color','Q_brake_detail',
                   'Q_gear_detail','Q6_smells','Q5_lights','Q9_recent']
OBD_NUMERIC_COLS = ['battery_voltage_v','battery_temp_c','battery_charge_percent','battery_health_percent',
    'alternator_output_v','engine_temp_c','coolant_temp_c','engine_rpm','oil_pressure_psi',
    'fuel_level_percent','engine_load_percent','ambient_temp_c','brake_fluid_level_psi',
    'brake_pad_wear_mm','brake_temp_c']

# ---- Step 1: load real data, drop high-cardinality fields ----
q_df = pd.read_excel('/mnt/user-data/uploads/questionnaire_dataset_validated.xlsx')
q_df = q_df.drop(columns=DROPPED_FIELDS)
obd_df = pd.read_csv('/mnt/user-data/uploads/obd_dataset.csv')

# ---- Step 2: build DTC compatibility table from the expert mapping ----
dtc_map = pd.read_excel('/mnt/user-data/uploads/OBD_DTC_Technician.xlsx', sheet_name='DTC Cross-Check')
STRONG_LABELS = {'Direct/Strong', 'Strong'}
dtc_by_class = {}
for cls, grp in dtc_map.groupby('Research Class'):
    strong = grp[grp['Mapping Strength'].isin(STRONG_LABELS)]['DTC Code'].tolist()
    all_codes = grp['DTC Code'].tolist()
    # prefer strong-confidence codes; fall back to full set if none are strong
    dtc_by_class[cls] = strong if strong else all_codes

def sample_dtc(cls):
    codes = dtc_by_class.get(cls)
    if not codes:
        return 'NOT_APPLICABLE'
    return rng.choice(codes)

# ---- Step 3: scale questionnaire (template-based) ----
def scale_questionnaire(df, target_n=TARGET_N, max_mult=MAX_SYNTH_MULT):
    context_pool = df[CONTEXT_COLS]
    out_rows, summary = [], []
    for cls, grp in df.groupby('service_type'):
        n_real = len(grp)
        n_synth = min(max(0, target_n - n_real), int(n_real * max_mult))
        for _ in range(n_synth):
            template = grp.sample(1, random_state=rng.integers(1e9)).iloc[0].to_dict()
            context = context_pool.sample(1, random_state=rng.integers(1e9)).iloc[0].to_dict()
            row = {**template, **context, 'service_type': cls,
                   'source': 'synthetic_template', 'expert_status': 'PENDING', 'expert_notes': ''}
            out_rows.append(row)
        summary.append({'service_type': cls, 'real_n': n_real, 'synthetic_n': n_synth, 'final_n': n_real + n_synth})
    real = df.copy(); real['source'] = 'real'; real['expert_status'] = 'VERIFIED'; real['expert_notes'] = ''
    return pd.concat([real, pd.DataFrame(out_rows)], ignore_index=True), pd.DataFrame(summary)

# ---- Step 4: scale OBD (distribution-fit) + attach expert-informed DTC ----
def scale_obd(df, target_n=TARGET_N, max_mult=MAX_SYNTH_MULT):
    out_rows, summary = [], []
    for cls, grp in df.groupby('service_type'):
        n_real = len(grp)
        n_synth = min(max(0, target_n - n_real), int(n_real * max_mult))
        dist = {c: (grp[c].mean(), grp[c].std()) for c in OBD_NUMERIC_COLS}
        for _ in range(n_synth):
            row = {c: round(float(rng.normal(dist[c][0], (dist[c][1] or 0.01) * 0.9)), 3) for c in OBD_NUMERIC_COLS}
            row['service_type'] = cls
            row['detected_dtc'] = sample_dtc(cls)
            row['source'] = 'synthetic_distribution_fit'
            row['expert_status'] = 'PENDING'; row['expert_notes'] = ''
            out_rows.append(row)
        summary.append({'service_type': cls, 'real_n': n_real, 'synthetic_n': n_synth, 'final_n': n_real + n_synth,
                         'dtc_coverage': 'yes' if cls in dtc_by_class else 'no'})
    real = df.copy()
    real['detected_dtc'] = real['service_type'].apply(sample_dtc)  # expert-informed retrofit onto real rows
    real['source'] = 'real_dtc_expert_retrofit'  # NOTE: PIDs are real; DTC label is expert-informed, not device-captured
    real['expert_status'] = 'VERIFIED_PIDS_ONLY'; real['expert_notes'] = ''
    return pd.concat([real, pd.DataFrame(out_rows)], ignore_index=True), pd.DataFrame(summary)

q_scaled, q_summary = scale_questionnaire(q_df)
obd_scaled, obd_summary = scale_obd(obd_df)

q_scaled.to_csv('questionnaire_final_v3.csv', index=False)
obd_scaled.to_csv('obd_final_v3.csv', index=False)
q_summary.to_csv('questionnaire_final_v3_summary.csv', index=False)
obd_summary.to_csv('obd_final_v3_summary.csv', index=False)

print("=== TIER 1 (Questionnaire) — location_name, vehicle_model dropped ===")
print(q_summary.to_string(index=False))
print(f"TOTAL: {q_summary.real_n.sum()} real -> {q_summary.final_n.sum()} final")
print()
print("=== TIER 2 (OBD) — with expert-informed detected_dtc field ===")
print(obd_summary.to_string(index=False))
print(f"TOTAL: {obd_summary.real_n.sum()} real -> {obd_summary.final_n.sum()} final")
print(f"Classes with DTC coverage: {obd_summary[obd_summary.dtc_coverage=='yes'].service_type.tolist()}")
print(f"Classes WITHOUT DTC coverage (detected_dtc=NOT_APPLICABLE): {obd_summary[obd_summary.dtc_coverage=='no'].service_type.tolist()}")
