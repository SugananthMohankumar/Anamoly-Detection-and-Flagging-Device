"""
preprocess.py
-------------
Data Preprocessing Pipeline for the Anomaly Detection Project.

This script takes the raw CSV recorded from the ESP32 and runs it through
9 numbered data cleaning and feature engineering steps.

Every step has a clear comment explaining:
  - WHAT was done
  - WHY it was done (crucial for viva and project presentation)

Returns:
  1. cleaned_df : The fully preprocessed and enriched pandas DataFrame
  2. report_df  : A summary table detailing rows/values affected at each step
"""

import pandas as pd
import numpy as np


def preprocess_data(raw_df, close_dist_threshold=50.0, median_window=5):
    """
    Cleans and enriches raw sensor data.

    Parameters:
    -----------
    raw_df : pd.DataFrame
        Raw data containing ['timestamp', 'pir', 'dist_raw', 'raw_line']
    close_dist_threshold : float
        Distance in cm considered 'Close Object' (default: 50.0 cm)
    median_window : int
        Window size for median filter to remove ultrasonic spike noise (default: 5)

    Returns:
    --------
    cleaned_df : pd.DataFrame
        The processed dataset ready for visualization and analysis.
    report_df : pd.DataFrame
        Table documenting the impact of every single processing step.
    """
    report_data = []
    initial_rows = len(raw_df)

    # Work on a clean copy so we don't modify the input in place
    df = raw_df.copy()

    # =========================================================================
    # STEP 2.1: Convert text to proper types (timestamp, numbers)
    # WHAT: Convert 'timestamp' to datetime objects, and 'pir' & 'dist_raw' to numeric.
    # WHY: Raw CSV stores everything as plain text strings. Python cannot do math,
    #      filtering, or time calculations on strings.
    # =========================================================================
    step_num = "2.1"
    step_name = "Convert data types"
    step_why = "Enables math calculations, filtering, and time-series operations."

    df['timestamp'] = pd.to_datetime(df['timestamp'], errors='coerce')
    df['pir'] = pd.to_numeric(df['pir'], errors='coerce')
    df['dist_raw'] = pd.to_numeric(df['dist_raw'], errors='coerce')

    type_conversions = initial_rows
    report_data.append({
        "Step": step_num,
        "Name": step_name,
        "Description": "Converted timestamp to datetime, pir and dist to float",
        "Why It Matters": step_why,
        "Rows / Values Affected": type_conversions
    })

    # =========================================================================
    # STEP 2.2: Remove malformed rows
    # WHAT: Drop rows where timestamp is NaT (not a valid date) or raw_line is completely blank.
    # WHY: Serial transmission sometimes sends incomplete, corrupted lines during
    #      device power-up or baud synchronization.
    # =========================================================================
    step_num = "2.2"
    step_name = "Remove malformed rows"
    step_why = "Prevents corrupt or broken serial transmissions from skewing charts."

    before_count = len(df)
    # A row is malformed if it doesn't have a valid timestamp
    df = df.dropna(subset=['timestamp']).copy()
    dropped_malformed = before_count - len(df)

    report_data.append({
        "Step": step_num,
        "Name": step_name,
        "Description": "Dropped rows missing a valid timestamp",
        "Why It Matters": step_why,
        "Rows / Values Affected": dropped_malformed
    })

    # =========================================================================
    # STEP 2.3: Sort by time and remove duplicate timestamps
    # WHAT: Sort rows chronologically and drop rows with identical timestamps.
    # WHY: Sensor data must flow forward in time. Duplicate timestamps confuse
    #      rate calculations and rolling filters.
    # =========================================================================
    step_num = "2.3"
    step_name = "Sort time & remove duplicates"
    step_why = "Ensures chronological integrity and avoids double-counting events."

    before_count = len(df)
    df = df.sort_values('timestamp').reset_index(drop=True)
    df = df.drop_duplicates(subset=['timestamp'], keep='first').reset_index(drop=True)
    dropped_duplicates = before_count - len(df)

    report_data.append({
        "Step": step_num,
        "Name": step_name,
        "Description": "Sorted chronologically and dropped duplicate timestamps",
        "Why It Matters": step_why,
        "Rows / Values Affected": dropped_duplicates
    })

    # =========================================================================
    # STEP 2.4: Keep only valid PIR values (0 or 1)
    # WHAT: Filter PIR values so only 0 (no motion) or 1 (motion detected) are kept.
    # WHY: A digital PIR sensor has strictly two physical states (HIGH or LOW).
    #      Any other value is digital noise or corrupt serial bits.
    # =========================================================================
    step_num = "2.4"
    step_name = "Validate PIR values (0 or 1)"
    step_why = "A digital PIR sensor physically only outputs 0 or 1. Other values are noise."

    before_count = len(df)
    valid_pir_mask = df['pir'].isin([0, 1])
    invalid_pir_count = len(df) - valid_pir_mask.sum()
    # Replace invalid PIR values with 0 (safe baseline) instead of losing the row
    df.loc[~valid_pir_mask, 'pir'] = np.nan
    # Fill any missing PIR with 0
    df['pir'] = df['pir'].fillna(0).astype(int)

    report_data.append({
        "Step": step_num,
        "Name": step_name,
        "Description": "Enforced PIR as binary 0 or 1 (replaced invalid with 0)",
        "Why It Matters": step_why,
        "Rows / Values Affected": invalid_pir_count
    })

    # =========================================================================
    # STEP 2.5: Mark impossible ultrasonic values as missing (NaN)
    # WHAT: Replace DIST values of 999 (timeout/no echo), < 2 cm (blind spot),
    #       or > 400 cm (HC-SR04 maximum theoretical range) with NaN (missing).
    # WHY: We KEEP the row because the PIR sensor on that same row might still be
    #      valid and recording real human motion! Deleting the row would lose PIR data.
    # =========================================================================
    step_num = "2.5"
    step_name = "Mark impossible distances as NaN"
    step_why = "HC-SR04 cannot physically read <2cm or >400cm. 999 means no echo. Keeping row preserves PIR data."

    impossible_mask = (df['dist_raw'] == 999) | (df['dist_raw'] < 2.0) | (df['dist_raw'] > 400.0) | (df['dist_raw'].isna())
    impossible_count = impossible_mask.sum()

    # Create a new column 'dist_valid' where impossible values are set to NaN
    df['dist_valid'] = df['dist_raw'].copy()
    df.loc[impossible_mask, 'dist_valid'] = np.nan

    report_data.append({
        "Step": step_num,
        "Name": step_name,
        "Description": "Set distance to NaN if == 999, < 2 cm, or > 400 cm (preserved row)",
        "Why It Matters": step_why,
        "Rows / Values Affected": int(impossible_count)
    })

    # =========================================================================
    # STEP 2.6: Median filter with a window of 5 readings
    # WHAT: Apply rolling median filter (window=5) to ultrasonic distance readings.
    # WHY: Ultrasonic sensors occasionally bounce off angled walls, clothing, or
    #      experience acoustic echo flutter. A median filter effectively removes
    #      isolated single-reading spikes without blurring sharp real edges (unlike mean).
    # =========================================================================
    step_num = "2.6"
    step_name = f"Median filter (window={median_window})"
    step_why = "Median removes acoustic echo spikes without blurring sharp physical edges (unlike average)."

    # Apply rolling median with min_periods=1 so we don't create new NaNs at the edges
    df['dist_median'] = df['dist_valid'].rolling(window=median_window, center=True, min_periods=1).median()
    median_applied = len(df)

    report_data.append({
        "Step": step_num,
        "Name": step_name,
        "Description": f"Applied {median_window}-sample rolling median filter to suppress ultrasonic noise",
        "Why It Matters": step_why,
        "Rows / Values Affected": median_applied
    })

    # =========================================================================
    # STEP 2.7: Fill gaps of at most 3 readings by linear interpolation
    # WHAT: Use linear interpolation with limit=3 on the distance data.
    # WHY: If the sensor misses 1, 2, or 3 echo pulses (brief 0.5s to 1.5s glitch),
    #      we can smoothly estimate the distance between the two known points.
    #      Larger gaps (>3) are left as NaN because guessing over long periods is unreliable.
    # =========================================================================
    step_num = "2.7"
    step_name = "Linear interpolation (max gap=3)"
    step_why = "Smoothly recovers short sensor dropouts (1-3 missing echoes) without inventing long fake trends."

    before_nans = df['dist_median'].isna().sum()
    df['dist_clean'] = df['dist_median'].interpolate(method='linear', limit=3, limit_direction='forward')
    after_nans = df['dist_clean'].isna().sum()
    interpolated_points = before_nans - after_nans

    # If all distances were NaN, fill with fallback 100cm so dashboard can always plot
    if df['dist_clean'].isna().all():
        df['dist_clean'] = 100.0

    report_data.append({
        "Step": step_num,
        "Name": step_name,
        "Description": "Filled short gaps (up to 3 consecutive missing samples) via linear interpolation",
        "Why It Matters": step_why,
        "Rows / Values Affected": int(interpolated_points)
    })

    # =========================================================================
    # STEP 2.8: Create new feature columns (close_object, motion_start, alert_level)
    # WHAT:
    #   - close_object: True if dist_clean < threshold (e.g., 50 cm)
    #   - motion_start: True when PIR transitions from 0 -> 1 (rising edge)
    #   - hour & minute: Time breakdown for activity analysis
    #   - alert_level:
    #       * 'Danger' : Both PIR motion == 1 AND close_object == True
    #       * 'Caution': Exactly one of them is True (PIR only or Close only)
    #       * 'Normal' : Neither is True (clear and quiet)
    # WHY: Transforms raw physical measurements into high-level security intelligence.
    # =========================================================================
    step_num = "2.8"
    step_name = "Feature engineering & Alert levels"
    step_why = "Converts raw numbers into actionable security intelligence (Danger, Caution, Normal)."

    df['close_object'] = (df['dist_clean'] < close_dist_threshold).fillna(False)
    
    # Rising edge of PIR motion (0 -> 1)
    df['pir_prev'] = df['pir'].shift(1).fillna(0)
    df['raw_motion_start'] = (df['pir'] == 1) & (df['pir_prev'] == 0)

    # Time breakdown
    df['hour'] = df['timestamp'].dt.hour
    df['minute'] = df['timestamp'].dt.minute

    # Alert level classification
    def determine_alert_level(row):
        is_motion = (row['pir'] == 1)
        is_close = row['close_object']
        if is_motion and is_close:
            return 'Danger'
        elif is_motion or is_close:
            return 'Caution'
        else:
            return 'Normal'

    df['alert_level'] = df.apply(determine_alert_level, axis=1)

    danger_count = (df['alert_level'] == 'Danger').sum()
    caution_count = (df['alert_level'] == 'Caution').sum()
    normal_count = (df['alert_level'] == 'Normal').sum()

    report_data.append({
        "Step": step_num,
        "Name": step_name,
        "Description": f"Classified alerts ({danger_count} Danger, {caution_count} Caution, {normal_count} Normal)",
        "Why It Matters": step_why,
        "Rows / Values Affected": len(df)
    })

    # =========================================================================
    # STEP 2.9: Debounce motion events within 5 seconds of each other
    # WHAT: If PIR motion starts multiple times within 5 seconds of the previous start,
    #       group them so they count as ONE single continuous event.
    # WHY: A human walking across a room causes the PIR sensor to trigger multiple
    #      times in rapid succession. Debouncing prevents artificial inflation of
    #      intrusion counts in presentation statistics.
    # =========================================================================
    step_num = "2.9"
    step_name = "Debounce motion events (5-sec window)"
    step_why = "A person walking creates multiple rapid PIR triggers. Debouncing prevents fake count inflation."

    df['motion_start'] = False
    last_motion_time = None
    debounced_events_count = 0
    raw_motion_events_count = int(df['raw_motion_start'].sum())

    for idx, row in df.iterrows():
        if row['raw_motion_start']:
            current_time = row['timestamp']
            if last_motion_time is None or (current_time - last_motion_time).total_seconds() >= 5.0:
                df.at[idx, 'motion_start'] = True
                last_motion_time = current_time
                debounced_events_count += 1
            else:
                # Within 5 seconds of previous motion start -> suppressed
                pass

    suppressed_count = raw_motion_events_count - debounced_events_count

    report_data.append({
        "Step": step_num,
        "Name": step_name,
        "Description": f"Debounced {raw_motion_events_count} raw triggers into {debounced_events_count} discrete events ({suppressed_count} suppressed)",
        "Why It Matters": step_why,
        "Rows / Values Affected": debounced_events_count
    })

    # Clean up temporary helper columns
    df = df.drop(columns=['pir_prev', 'raw_motion_start'], errors='ignore')

    # Build the report DataFrame
    report_df = pd.DataFrame(report_data)

    return df, report_df
