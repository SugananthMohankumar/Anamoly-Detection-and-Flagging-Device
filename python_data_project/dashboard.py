"""
dashboard.py
------------
Modern Admin Dashboard for Anomaly Detection & Sensor Data Exploration.
Layout and style matching dark rounded header with big number KPI cards,
nav pills, filters panel on the left, and white rounded cards with soft shadows.
"""

import os
import glob
import hashlib
import re
import textwrap
import pandas as pd
import numpy as np
import streamlit as st
import plotly.express as px
import plotly.graph_objects as go

# Import our preprocessing pipeline (do not modify)
from preprocess import preprocess_data

# =============================================================================
# PAGE CONFIGURATION
# =============================================================================
st.set_page_config(
    page_title="Anomaly Detector",
    page_icon="🛡️",
    layout="wide",
    initial_sidebar_state="expanded"
)

# =============================================================================
# GLOBAL CSS INJECTION (Rule 1 & 2: Single st.markdown, unsafe_allow_html=True,
# no leading 4-space indentation, no blank lines inside tags)
# =============================================================================
st.markdown(textwrap.dedent("""<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
html, body, [class*="css"] {
font-family: 'Inter', sans-serif !important;
}
#MainMenu, header, footer, .stDeployButton {
display: none !important;
}
.main .block-container {
background: #eef0f5;
padding-top: 1rem !important;
padding-left: 1.5rem !important;
padding-right: 1.5rem !important;
max-width: 100% !important;
}
[data-testid="stSidebar"] {
background: #ffffff !important;
border-right: 1px solid #e2e8f0 !important;
}
[data-testid="stSidebar"] > div:first-child {
padding-top: 1.5rem;
padding-left: 1.2rem;
padding-right: 1.2rem;
}
.sidebar-filters-title {
font-size: 0.85rem;
font-weight: 800;
letter-spacing: 0.08em;
color: #0f172a;
text-transform: uppercase;
margin-bottom: 0.8rem;
}
.dark-header {
background: linear-gradient(135deg, #0b1020 0%, #1a2036 60%, #0f1a30 100%);
border-radius: 24px;
padding: 24px 28px;
margin-bottom: 16px;
box-shadow: 0 8px 32px rgba(11,16,32,0.35);
position: relative;
overflow: hidden;
}
.header-top {
display: flex;
align-items: center;
justify-content: space-between;
margin-bottom: 18px;
gap: 16px;
}
.header-brand {
display: flex;
flex-direction: column;
}
.header-logo-row {
display: flex;
align-items: center;
gap: 10px;
}
.header-logo-icon {
font-size: 1.5rem;
line-height: 1;
}
.header-title {
font-size: 1.35rem;
font-weight: 800;
color: #ffffff;
letter-spacing: -0.01em;
margin: 0;
}
.header-subtitle {
font-size: 0.8rem;
color: #94a3b8;
margin-top: 2px;
}
.header-nav {
display: flex;
gap: 8px;
background: rgba(255,255,255,0.06);
border-radius: 12px;
padding: 6px 8px;
align-items: center;
}
.pill {
padding: 6px 14px;
border-radius: 8px;
font-size: 0.8rem;
font-weight: 600;
color: #94a3b8;
white-space: nowrap;
}
.pill-active {
background: rgba(255,255,255,0.18);
color: #ffffff;
font-weight: 700;
}
.badge-verified {
background: rgba(16,185,129,0.18);
border: 1px solid rgba(16,185,129,0.5);
color: #10b981;
border-radius: 20px;
padding: 6px 14px;
font-size: 0.78rem;
font-weight: 700;
white-space: nowrap;
display: inline-block;
}
.badge-mismatch {
background: rgba(239,68,68,0.18);
border: 1px solid rgba(239,68,68,0.5);
color: #ef4444;
border-radius: 20px;
padding: 6px 14px;
font-size: 0.78rem;
font-weight: 700;
white-space: nowrap;
display: inline-block;
}
.kpi-row {
display: flex;
gap: 14px;
flex-wrap: wrap;
}
.kpi-card {
background: rgba(255,255,255,0.06);
border: 1px solid rgba(255,255,255,0.08);
border-radius: 16px;
padding: 16px 20px;
flex: 1;
min-width: 150px;
display: flex;
align-items: center;
justify-content: space-between;
gap: 12px;
}
.kpi-info {
display: flex;
flex-direction: column;
}
.kpi-label {
font-size: 0.72rem;
font-weight: 600;
color: #94a3b8;
text-transform: uppercase;
letter-spacing: 0.08em;
margin-bottom: 4px;
}
.kpi-value {
font-size: 2.2rem;
font-weight: 800;
color: #ffffff;
line-height: 1;
}
.kpi-icon {
font-size: 1.5rem;
width: 44px;
height: 44px;
border-radius: 12px;
display: flex;
align-items: center;
justify-content: center;
flex-shrink: 0;
}
.kpi-blue { background: rgba(59,130,246,0.22); }
.kpi-green { background: rgba(16,185,129,0.22); }
.kpi-amber { background: rgba(245,158,11,0.22); }
.kpi-red { background: rgba(239,68,68,0.22); }
.main-card {
background: #ffffff;
border-radius: 18px;
padding: 22px 24px;
box-shadow: 0 2px 12px rgba(15,23,42,0.07);
margin-bottom: 20px;
}
.card-title {
font-size: 1.05rem;
font-weight: 700;
color: #0f172a;
margin-bottom: 12px;
display: flex;
align-items: center;
gap: 8px;
}
.info-card-row {
display: flex;
gap: 14px;
margin-bottom: 20px;
flex-wrap: wrap;
}
.info-card {
background: #ffffff;
border-radius: 16px;
padding: 18px 20px;
flex: 1;
min-width: 180px;
box-shadow: 0 2px 10px rgba(15,23,42,0.06);
}
.info-card-icon {
font-size: 1.3rem;
margin-bottom: 8px;
}
.info-card-label {
font-size: 0.68rem;
font-weight: 700;
color: #94a3b8;
text-transform: uppercase;
letter-spacing: 0.08em;
margin-bottom: 4px;
}
.info-card-value {
font-size: 0.9rem;
font-weight: 600;
color: #0f172a;
}
.step-grid {
display: flex;
flex-wrap: wrap;
gap: 12px;
margin-bottom: 20px;
}
.step-card {
background: #ffffff;
border-radius: 14px;
padding: 14px 16px;
flex: 1 1 30%;
min-width: 220px;
box-shadow: 0 2px 8px rgba(15,23,42,0.06);
border-left: 4px solid #cbd5e1;
}
.step-num {
font-size: 0.68rem;
font-weight: 700;
color: #94a3b8;
text-transform: uppercase;
letter-spacing: 0.08em;
}
.step-name {
font-size: 0.9rem;
font-weight: 700;
color: #0f172a;
margin: 4px 0;
}
.step-why {
font-size: 0.76rem;
color: #64748b;
margin-bottom: 8px;
line-height: 1.35;
}
.badge {
display: inline-block;
border-radius: 6px;
padding: 3px 10px;
font-size: 0.72rem;
font-weight: 700;
}
.badge-green { background: #dcfce7; color: #16a34a; }
.badge-amber { background: #fef3c7; color: #d97706; }
.badge-red { background: #fee2e2; color: #dc2626; }
.stDownloadButton > button {
background: linear-gradient(135deg, #10b981, #059669) !important;
color: white !important;
border: none !important;
border-radius: 12px !important;
padding: 12px 28px !important;
font-size: 0.95rem !important;
font-weight: 700 !important;
width: 100% !important;
}
.stDownloadButton > button:hover {
background: linear-gradient(135deg, #059669, #047857) !important;
box-shadow: 0 4px 16px rgba(16,185,129,0.4) !important;
}
div[data-testid="stHorizontalBlock"] .stButton > button {
border-radius: 10px;
font-weight: 600;
font-size: 0.82rem;
padding: 8px 14px;
border: 1px solid #cbd5e1;
background: #ffffff;
color: #475569;
transition: all 0.2s;
}
div[data-testid="stHorizontalBlock"] .stButton > button:hover {
background: #f1f5f9;
color: #0f172a;
border-color: #94a3b8;
}
</style>""").strip(), unsafe_allow_html=True)


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================
def get_base_dirs():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    raw_dir = os.path.join(base_dir, "data", "raw")
    clean_dir = os.path.join(base_dir, "data", "clean")
    os.makedirs(raw_dir, exist_ok=True)
    os.makedirs(clean_dir, exist_ok=True)
    return base_dir, raw_dir, clean_dir


def compute_file_sha256(filepath):
    if not os.path.exists(filepath):
        return "File Not Found"
    hasher = hashlib.sha256()
    with open(filepath, 'rb') as f:
        while chunk := f.read(65536):
            hasher.update(chunk)
    return hasher.hexdigest()


def load_raw_files(raw_dir):
    csv_paths = glob.glob(os.path.join(raw_dir, "*.csv"))
    csv_paths.sort(key=os.path.getmtime, reverse=True)
    return csv_paths


def load_hashes(raw_dir):
    hashes = {}
    hashes_path = os.path.join(raw_dir, "hashes.txt")
    if not os.path.exists(hashes_path):
        return hashes
    with open(hashes_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                parts = {p.split(":")[0].strip(): ":".join(p.split(":")[1:]).strip()
                         for p in line.split("|")}
                fname = parts.get("Filename", "").strip()
                sha256 = parts.get("SHA-256", "").strip()
                if fname and sha256:
                    hashes[fname] = sha256
            except Exception:
                pass
    return hashes


def check_sha256_status(selected_names, file_options, raw_dir):
    stored = load_hashes(raw_dir)
    all_ok = True
    for name in selected_names:
        fpath = file_options[name]
        live = compute_file_sha256(fpath)
        expected = stored.get(name, "")
        if not expected or live != expected:
            all_ok = False
            break
    if all_ok and stored:
        return '<span class="badge-verified">✓ Data verified</span>'
    else:
        return '<span class="badge-mismatch">⚠ Fingerprint mismatch</span>'


def chart_layout(fig, height=360):
    fig.update_layout(
        plot_bgcolor="rgba(0,0,0,0)",
        paper_bgcolor="rgba(0,0,0,0)",
        height=height,
        margin=dict(t=20, b=20, l=10, r=10),
        font=dict(family="Inter, sans-serif", size=12, color="#475569"),
        xaxis=dict(gridcolor="#e2e8f0", linecolor="#e2e8f0", tickfont=dict(size=11)),
        yaxis=dict(gridcolor="#e2e8f0", linecolor="#e2e8f0", tickfont=dict(size=11)),
        legend=dict(bgcolor="rgba(0,0,0,0)", font=dict(size=11)),
    )
    return fig


# =============================================================================
# MAIN APP
# =============================================================================
def main():
    base_dir, raw_dir, clean_dir = get_base_dirs()

    if "active_tab" not in st.session_state:
        st.session_state.active_tab = "Data Collection"

    tab_names = ["📁 Data Collection", "🧹 Preprocessing", "📊 Visualization", "💾 Export"]
    tab_keys = ["Data Collection", "Preprocessing", "Visualization", "Export"]

    # -------------------------------------------------------------------------
    # SIDEBAR CONTROLS
    # -------------------------------------------------------------------------
    with st.sidebar:
        st.markdown(textwrap.dedent("""<div class="sidebar-filters-title">Filters</div>""").strip(), unsafe_allow_html=True)

        raw_files = load_raw_files(raw_dir)

        if not raw_files:
            st.warning("No CSV files found in data/raw/.")
            st.info("Run `python collect_data.py COM3` to record data.")
            return

        file_options = {os.path.basename(p): p for p in raw_files}
        st.markdown("**Select file(s):**")
        selected_file_names = []
        for fname in file_options:
            checked = st.checkbox(fname, value=(fname == list(file_options.keys())[0]), key=f"chk_{fname}")
            if checked:
                selected_file_names.append(fname)

        st.markdown("---")
        st.markdown("**Preprocessing Parameters**")

        close_dist_threshold = st.slider(
            "Close-object distance (cm)",
            min_value=10, max_value=200, value=50, step=5,
            help="Objects closer than this distance trigger a Caution or Danger alert."
        )
        median_window = st.slider(
            "Median filter window",
            min_value=3, max_value=15, value=5, step=2,
            help="Number of readings used by the median filter to remove ultrasonic spikes."
        )

        st.markdown("---")
        st.caption("💡 Press Ctrl+C when recording to seal the SHA-256 hash.")

    if not selected_file_names:
        st.warning("Please select at least one file in the sidebar.")
        return

    # -------------------------------------------------------------------------
    # LOAD AND PREPROCESS DATA
    # -------------------------------------------------------------------------
    combined_raw_list = []
    file_metadata_list = []

    for fname in selected_file_names:
        fpath = file_options[fname]
        try:
            df_temp = pd.read_csv(fpath)
            combined_raw_list.append(df_temp)

            f_size_kb = os.path.getsize(fpath) / 1024.0
            row_count = len(df_temp)
            f_hash = compute_file_sha256(fpath)
            first_reading = "N/A"
            last_reading = "N/A"
            duration_mins = 0.0

            if 'timestamp' in df_temp.columns and row_count > 0:
                t_series = pd.to_datetime(df_temp['timestamp'], errors='coerce').dropna()
                if not t_series.empty:
                    first_reading = t_series.min().strftime('%Y-%m-%d %H:%M:%S')
                    last_reading = t_series.max().strftime('%Y-%m-%d %H:%M:%S')
                    duration_mins = round((t_series.max() - t_series.min()).total_seconds() / 60.0, 2)

            file_metadata_list.append({
                "File Name": fname,
                "Rows": row_count,
                "Size (KB)": round(f_size_kb, 1),
                "First Reading": first_reading,
                "Last Reading": last_reading,
                "Duration (min)": duration_mins,
                "SHA-256 Fingerprint": f_hash
            })
        except Exception as e:
            st.error(f"Error loading {fname}: {e}")

    if not combined_raw_list:
        st.error("No valid data loaded from the selected files.")
        return

    raw_combined_df = pd.concat(combined_raw_list, ignore_index=True)

    with st.spinner("Running preprocessing pipeline…"):
        clean_df, report_df = preprocess_data(
            raw_combined_df,
            close_dist_threshold=close_dist_threshold,
            median_window=median_window
        )

    # -------------------------------------------------------------------------
    # ACCURATE KPI METRICS CALCULATION
    # -------------------------------------------------------------------------
    total_readings = len(raw_combined_df)
    clean_rows = len(clean_df)

    # Extract Step 2.5 (Mark impossible distances as NaN: 999, <2cm, >400cm)
    step_25 = report_df[report_df['Step'] == '2.5']
    if not step_25.empty:
        invalid_dist_val = step_25.iloc[0]['Rows / Values Affected']
        try:
            invalid_readings_removed = int(invalid_dist_val)
        except Exception:
            invalid_readings_removed = int(re.findall(r'\d+', str(invalid_dist_val))[0])
    else:
        invalid_readings_removed = int(clean_df['dist_valid'].isna().sum())

    # Extract Step 2.2 (Remove malformed rows)
    step_22 = report_df[report_df['Step'] == '2.2']
    if not step_22.empty:
        malformed_val = step_22.iloc[0]['Rows / Values Affected']
        try:
            malformed_rows_removed = int(malformed_val)
        except Exception:
            malformed_rows_removed = int(re.findall(r'\d+', str(malformed_val))[0])
    else:
        malformed_rows_removed = total_readings - clean_rows

    motion_events = int(clean_df['motion_start'].sum())

    active_key = st.session_state.active_tab
    badge_html = check_sha256_status(selected_file_names, file_options, raw_dir)

    pills_html = "".join([
        f'<div class="pill {"pill-active" if key == active_key else ""}">{label}</div>'
        for key, label in zip(tab_keys, tab_names)
    ])

    # -------------------------------------------------------------------------
    # DARK HEADER RENDERING (dedented, no blank lines, unsafe_allow_html=True)
    # -------------------------------------------------------------------------
    header_html = textwrap.dedent(f"""<div class="dark-header">
<div class="header-top">
<div class="header-brand">
<div class="header-logo-row">
<span class="header-logo-icon">🛡️</span>
<span class="header-title">Anomaly Detector</span>
</div>
<span class="header-subtitle">{active_key}</span>
</div>
<div class="header-nav">
{pills_html}
</div>
<div>{badge_html}</div>
</div>
<div class="kpi-row">
<div class="kpi-card">
<div class="kpi-info">
<span class="kpi-label">Total Readings</span>
<span class="kpi-value">{total_readings:,}</span>
</div>
<div class="kpi-icon kpi-blue">📡</div>
</div>
<div class="kpi-card">
<div class="kpi-info">
<span class="kpi-label">Clean Rows</span>
<span class="kpi-value">{clean_rows:,}</span>
</div>
<div class="kpi-icon kpi-green">✅</div>
</div>
<div class="kpi-card">
<div class="kpi-info">
<span class="kpi-label">Invalid Readings Removed</span>
<span class="kpi-value">{invalid_readings_removed:,}</span>
</div>
<div class="kpi-icon kpi-amber">🗑️</div>
</div>
<div class="kpi-card">
<div class="kpi-info">
<span class="kpi-label">Motion Events</span>
<span class="kpi-value">{motion_events:,}</span>
</div>
<div class="kpi-icon kpi-red">🏃</div>
</div>
</div>
</div>""").strip()

    st.markdown(header_html, unsafe_allow_html=True)

    # -------------------------------------------------------------------------
    # TAB BUTTONS (Functional Streamlit buttons)
    # -------------------------------------------------------------------------
    btn_cols = st.columns(len(tab_keys))
    for col, key, label in zip(btn_cols, tab_keys, tab_names):
        with col:
            if st.button(label, key=f"nav_btn_{key}", use_container_width=True):
                st.session_state.active_tab = key
                st.rerun()

    # =========================================================================
    # TAB 1: DATA COLLECTION
    # =========================================================================
    if active_key == "Data Collection":
        info_cards_html = textwrap.dedent("""<div class="info-card-row">
<div class="info-card">
<div class="info-card-icon">🔌</div>
<div class="info-card-label">Source</div>
<div class="info-card-value">ESP32 — USB Serial (115200 baud)</div>
</div>
<div class="info-card">
<div class="info-card-icon">📡</div>
<div class="info-card-label">Method</div>
<div class="info-card-value">PIR + HC-SR04 ultrasonic, 2 Hz sampling</div>
</div>
<div class="info-card">
<div class="info-card-icon">💾</div>
<div class="info-card-label">Storage</div>
<div class="info-card-value">data/raw/ CSV + SHA-256 fingerprint</div>
</div>
</div>""").strip()
        st.markdown(info_cards_html, unsafe_allow_html=True)

        card1_start = textwrap.dedent("""<div class="main-card">
<div class="card-title">📋 Raw Files Manifest & Cryptographic Fingerprints</div>
</div>""").strip()
        st.markdown(card1_start, unsafe_allow_html=True)
        st.dataframe(pd.DataFrame(file_metadata_list), use_container_width=True)

        card2_start = textwrap.dedent("""<div class="main-card">
<div class="card-title">🔍 First 15 Raw Lines Recorded</div>
</div>""").strip()
        st.markdown(card2_start, unsafe_allow_html=True)
        st.caption("Exact raw data stream as received over the serial port:")
        st.dataframe(raw_combined_df.head(15), use_container_width=True)

    # =========================================================================
    # TAB 2: PREPROCESSING
    # =========================================================================
    elif active_key == "Preprocessing":
        # Notice about malformed rows & invalid distance
        prep_banner_html = textwrap.dedent(f"""<div class="info-card-row">
<div class="info-card">
<div class="info-card-icon">🧹</div>
<div class="info-card-label">Malformed Rows Dropped</div>
<div class="info-card-value">{malformed_rows_removed:,} rows</div>
</div>
<div class="info-card">
<div class="info-card-icon">⚠️</div>
<div class="info-card-label">Impossible Distances (999/out-of-range)</div>
<div class="info-card-value">{invalid_readings_removed:,} readings marked NaN</div>
</div>
<div class="info-card">
<div class="info-card-icon">🎯</div>
<div class="info-card-label">Retained Clean Rows</div>
<div class="info-card-value">{clean_rows:,} / {total_readings:,} ({round(clean_rows/max(1, total_readings)*100, 1)}%)</div>
</div>
</div>""").strip()
        st.markdown(prep_banner_html, unsafe_allow_html=True)

        # 9 Preprocessing steps grid cards
        step_cards_list = []
        for _, row in report_df.iterrows():
            affected_raw = str(row.get("Rows / Values Affected", "0"))
            nums = re.findall(r'\d+', affected_raw)
            affected_n = int(nums[0]) if nums else 0

            if affected_n == 0:
                badge_cls = "badge-green"
                badge_text = "0 rows" if affected_raw == "0" else affected_raw
            elif affected_n <= 20:
                badge_cls = "badge-amber"
                badge_text = affected_raw
            else:
                badge_cls = "badge-red"
                badge_text = affected_raw

            step_name = row.get("Name", "")
            step_num = row.get("Step", "")
            step_why = row.get("Why It Matters", "")[:95]

            card_item = f"""<div class="step-card">
<div class="step-num">Step {step_num}</div>
<div class="step-name">{step_name}</div>
<div class="step-why">{step_why}…</div>
<span class="badge {badge_cls}">{badge_text}</span>
</div>"""
            step_cards_list.append(card_item)

        grid_html = textwrap.dedent(f"""<div class="step-grid">
{"".join(step_cards_list)}
</div>""").strip()
        st.markdown(grid_html, unsafe_allow_html=True)

        chart_card_title = textwrap.dedent("""<div class="main-card">
<div class="card-title">📈 Raw Distance vs. Cleaned Distance (Noise Filtering)</div>
</div>""").strip()
        st.markdown(chart_card_title, unsafe_allow_html=True)
        st.caption(f"Median filter window = {median_window} readings — acoustic spikes and 999 dropouts smoothed out:")

        fig_compare = go.Figure()
        fig_compare.add_trace(go.Scatter(
            x=clean_df['timestamp'], y=clean_df['dist_raw'],
            mode='lines', name='Raw Distance (cm)',
            line=dict(color='#cbd5e1', width=1), opacity=0.7
        ))
        fig_compare.add_trace(go.Scatter(
            x=clean_df['timestamp'], y=clean_df['dist_clean'],
            mode='lines', name=f'Cleaned (window={median_window})',
            line=dict(color='#10b981', width=2.5)
        ))
        fig_compare.add_hline(
            y=close_dist_threshold,
            line_dash="dash", line_color="#ef4444",
            annotation_text=f"Threshold ({close_dist_threshold} cm)",
            annotation_position="bottom right"
        )
        fig_compare.update_layout(
            yaxis_range=[0, min(150, (clean_df['dist_clean'].max() if pd.notna(clean_df['dist_clean'].max()) else 100) + 20)],
            hovermode="x unified"
        )
        chart_layout(fig_compare, height=390)
        st.plotly_chart(fig_compare, use_container_width=True)

    # =========================================================
    # TAB 3: VISUALIZATION
    # =========================================================
    elif active_key == "Visualization":
        col1, col2 = st.columns(2)

        with col1:
            st.markdown(textwrap.dedent("""<div class="main-card">
<div class="card-title">🚨 Breakdown of Alert Levels</div>
</div>""").strip(), unsafe_allow_html=True)

            alert_counts = clean_df['alert_level'].value_counts().reset_index()
            alert_counts.columns = ['Alert Level', 'Count']
            color_map = {'Normal': '#10b981', 'Caution': '#f59e0b', 'Danger': '#ef4444'}

            fig_pie = px.pie(
                alert_counts, names='Alert Level', values='Count',
                color='Alert Level', color_discrete_map=color_map, hole=0.45
            )
            fig_pie.update_traces(textposition='inside', textinfo='percent+label')
            chart_layout(fig_pie, height=340)
            st.plotly_chart(fig_pie, use_container_width=True)

        with col2:
            st.markdown(textwrap.dedent("""<div class="main-card">
<div class="card-title">📏 Histogram of Cleaned Distance (cm)</div>
</div>""").strip(), unsafe_allow_html=True)

            fig_hist = px.histogram(
                clean_df, x='dist_clean', nbins=35,
                color_discrete_sequence=['#8b5cf6'],
                labels={'dist_clean': 'Distance (cm)'}
            )
            fig_hist.add_vline(
                x=close_dist_threshold, line_dash="dash", line_color="#ef4444",
                annotation_text=f"{close_dist_threshold} cm limit"
            )
            fig_hist.update_layout(xaxis_title="Distance (cm)", yaxis_title="Reading Count")
            chart_layout(fig_hist, height=340)
            st.plotly_chart(fig_hist, use_container_width=True)

        st.markdown(textwrap.dedent("""<div class="main-card">
<div class="card-title">🏃 Motion Events Detected per Minute</div>
</div>""").strip(), unsafe_allow_html=True)

        clean_df['minute_bin'] = clean_df['timestamp'].dt.floor('1min')
        motion_per_min = (
            clean_df[clean_df['motion_start'] == True]
            .groupby('minute_bin').size()
            .reset_index(name='Motion Events')
        )
        if motion_per_min.empty:
            st.info("No discrete motion start events detected in the selected time range.")
        else:
            fig_motion = px.bar(
                motion_per_min, x='minute_bin', y='Motion Events',
                color_discrete_sequence=['#f59e0b']
            )
            fig_motion.update_layout(xaxis_title="Time (Minute)", yaxis_title="Debounced Motion Events")
            chart_layout(fig_motion, height=300)
            st.plotly_chart(fig_motion, use_container_width=True)

        st.markdown(textwrap.dedent("""<div class="main-card">
<div class="card-title">📍 Distance Timeline with Motion Events Overlay</div>
</div>""").strip(), unsafe_allow_html=True)

        fig_timeline = go.Figure()
        fig_timeline.add_trace(go.Scatter(
            x=clean_df['timestamp'], y=clean_df['dist_clean'],
            mode='lines', name='Clean Distance (cm)',
            line=dict(color='#3b82f6', width=2)
        ))
        motion_points = clean_df[clean_df['motion_start'] == True]
        if not motion_points.empty:
            fig_timeline.add_trace(go.Scatter(
                x=motion_points['timestamp'], y=motion_points['dist_clean'],
                mode='markers', name='Motion Start (PIR)',
                marker=dict(symbol='triangle-up', size=10, color='#ef4444',
                            line=dict(width=1, color='black'))
            ))
        fig_timeline.update_layout(
            yaxis_range=[0, min(150, (clean_df['dist_clean'].max() if pd.notna(clean_df['dist_clean'].max()) else 100) + 20)],
            hovermode="x unified"
        )
        chart_layout(fig_timeline, height=380)
        st.plotly_chart(fig_timeline, use_container_width=True)

        st.markdown(textwrap.dedent("""<div class="main-card">
<div class="card-title">📋 Summary Statistics of Cleaned Telemetry</div>
</div>""").strip(), unsafe_allow_html=True)
        summary_stats = clean_df[['dist_clean', 'pir']].describe().T
        summary_stats.rename(columns={
            'count': 'Count', 'mean': 'Mean', 'std': 'Std Dev',
            'min': 'Min', '25%': '25th %', '50%': 'Median (50%)',
            '75%': '75th %', 'max': 'Max'
        }, inplace=True)
        st.dataframe(summary_stats.style.format("{:.2f}"), use_container_width=True)

    # =========================================================
    # TAB 4: EXPORT
    # =========================================================
    elif active_key == "Export":
        clean_export_path = os.path.join(clean_dir, "clean_data.csv")
        clean_df.to_csv(clean_export_path, index=False)

        csv_bytes = clean_df.to_csv(index=False).encode('utf-8')
        file_size_kb = round(len(csv_bytes) / 1024, 1)

        export_info_html = textwrap.dedent(f"""<div class="main-card">
<div class="card-title">💾 Export Cleaned Dataset</div>
<p style="color:#64748b; font-size:0.9rem;">
Your fully preprocessed, cleaned, and enriched dataset is ready. This file can be submitted with your college project report or used for further statistical modeling.
</p>
<div class="info-card-row">
<div class="info-card">
<div class="info-card-label">Total Rows</div>
<div class="info-card-value">{len(clean_df):,}</div>
</div>
<div class="info-card">
<div class="info-card-label">Total Columns</div>
<div class="info-card-value">{len(clean_df.columns)}</div>
</div>
<div class="info-card">
<div class="info-card-label">File Size</div>
<div class="info-card-value">{file_size_kb} KB</div>
</div>
</div>
</div>""").strip()
        st.markdown(export_info_html, unsafe_allow_html=True)

        st.success(f"✅ Clean dataset automatically synchronized and saved to: `{clean_export_path}`")

        st.download_button(
            label="⬇️ Download Cleaned CSV File (clean_data.csv)",
            data=csv_bytes,
            file_name="clean_data.csv",
            mime="text/csv",
            help="Click to download the clean CSV to your computer."
        )

        st.markdown(textwrap.dedent("""<div class="main-card">
<div class="card-title">Preview of Cleaned Table (First 20 Rows)</div>
</div>""").strip(), unsafe_allow_html=True)
        st.dataframe(clean_df.head(20), use_container_width=True)


if __name__ == "__main__":
    main()
