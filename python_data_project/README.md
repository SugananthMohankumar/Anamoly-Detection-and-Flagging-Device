# 🛡️ Anomaly Detection & Sensor Analytics (Python Project)

College Project: **"Anomaly Detection and Flagging Device"**  
A complete data exploration, digital signal processing, and interactive visualization dashboard built with **Python**, **pandas**, **numpy**, **Plotly**, **Streamlit**, and **pyserial**.

---

> ⚠️ **IMPORTANT NOTE ABOUT THE SAMPLE FILE:**  
> The file `data/raw/raw_data_SAMPLE_for_testing.csv` contains synthetic (fake) test data created **ONLY** so you can immediately run and test the dashboard on your computer.  
> **Before your college submission or presentation, DELETE this sample file.**  
> Your real project data must be recorded live from the ESP32 using `collect_data.py`.

---

## 📁 Project Structure

```text
python_data_project/
├── data/
│   ├── raw/                  <-- Raw CSV recordings directly from ESP32 & hashes.txt
│   │   ├── raw_data_SAMPLE_for_testing.csv
│   │   └── hashes.txt
│   └── clean/                <-- Cleaned, debounced, and enriched CSV output
│       └── clean_data.csv
├── collect_data.py           <-- Reads ESP32 serial port & computes cryptographic SHA-256
├── preprocess.py             <-- 9-step cleaning, median filter & alert classifier pipeline
├── dashboard.py              <-- 4-tab interactive Streamlit web dashboard
├── requirements.txt          <-- Python dependencies
└── README.md                 <-- Beginner guide & presentation viva Q&A
```

---

## 🚀 1. How to Install & Set Up (For Beginners)

1. Open your terminal (**Command Prompt** or **PowerShell**).
2. Navigate to this project folder:
   ```bash
   cd "c:\Users\SUGANANTH\OneDrive\Desktop\ANAMOLY PROJECT\python_data_project"
   ```
3. Install the required Python packages:
   ```bash
   pip install -r requirements.txt
   ```
   *(If `pip` is not recognized, use `py -m pip install -r requirements.txt`)*

---

## 🔌 2. How to Record Real Data from the ESP32

> ⚠️ **CRITICAL PRE-RECORDING STEP:**  
> Before recording with Python, you **MUST close**:
> 1. The **Arduino IDE Serial Monitor** (if open)
> 2. The **Web Dashboard browser tab** (disconnect device)  
> *Why?* Windows only allows **one application** to use a COM port at a time. If another program is holding the port, `collect_data.py` will give an `Access Denied` error.

### How to Run Data Collection:
Find your ESP32 COM port in Windows Device Manager (e.g., `COM3`, `COM4`, etc.) and run:
```bash
python collect_data.py COM3
```
*(On Windows, you can also run `py collect_data.py COM3`)*

The script will save every line to `data/raw/raw_data_<timestamp>.csv`.  
Every 20 lines, it will print a progress message in your terminal.

### When Done:
Press **`Ctrl + C`** in the terminal to stop recording.  
The script automatically calculates the **SHA-256 cryptographic hash** of the file and appends it to `data/raw/hashes.txt`.

> ⚠️ **WARNING:** Never open or re-save the raw CSV files in Microsoft Excel!  
> Excel automatically reformats dates and trims decimal zeroes, which will alter the file bytes and invalidate the SHA-256 cryptographic hash fingerprint.

---

## 🏃 3. What to Do While Recording (Recommended 25-Minute Test Protocol)

For a solid academic submission, follow this 5-stage test protocol:

| Time Interval | Physical Action / Scenario | Purpose of Test |
| :--- | :--- | :--- |
| **0 to 5 mins** | **Empty Room (No Motion):** Leave room empty and still. | Establishes the clean sensor baseline (PIR = 0, DIST constant). |
| **5 to 10 mins** | **Walking Around:** Walk normally back and forth 2-3 meters away. | Tests PIR motion detection transitions (0 &rarr; 1). |
| **10 to 15 mins** | **Stationary Objects:** Place an object (box/chair) at 20 cm, 50 cm, and 100 cm for ~1.5 min each. | Tests distance thresholding and hysteresis behavior. |
| **15 to 20 mins** | **Waving & Moving at Close Range:** Wave hand within 30-40 cm of both sensors. | Tests combined **Danger Alert** (PIR = 1 AND DIST < 50 cm). |
| **20 to 25 mins** | **Idle Recovery:** Step away and let system return to rest. | Tests system auto-recovery back to Normal state. |

---

## 📊 4. How to Run the Web Dashboard

To launch the interactive analytics dashboard, run:
```bash
streamlit run dashboard.py
```
Your default web browser will automatically open to `http://localhost:8501`.

### Dashboard Features (4 Tabs):
1. **Data Collection:** View raw file metadata, timestamps, total rows, and the SHA-256 cryptographic fingerprint.
2. **Preprocessing:** View the step-by-step cleaning report table and an interactive chart comparing noisy raw distance vs. median-filtered clean distance.
3. **Visualization:**
   - Donut pie chart of alert classifications (**Normal**, **Caution**, **Danger**).
   - Histogram of cleaned distance distribution.
   - Bar chart of debounced motion events per minute.
   - Interactive distance timeline with motion trigger markers.
   - Descriptive statistical summary table.
4. **Export:** Export and download the cleaned, debounced CSV dataset (`clean_data.csv`).

---

## 🎓 5. Questions I May Be Asked in the Presentation (Viva Q&A)

Here are clear, simple answers to common questions professors and examiners ask:

### Q1: How was the raw sensor data collected?
> **Answer:**  
> An ESP32 microcontroller connected to our computer via USB serial port (`115200` baud) reads an HC-SR501 PIR sensor and an HC-SR04 ultrasonic distance sensor. Every 0.5 seconds (2 Hz), it sends a formatted ASCII line: `PIR:<0 or 1>,DIST:<value>`. Our Python script `collect_data.py` reads these lines using `pyserial`, attaches an ISO-8601 millisecond timestamp, and appends them to a raw CSV file.

---

### Q2: How do you prove the raw data is genuine and not fabricated or edited?
> **Answer:**  
> Immediately when data collection is stopped with `Ctrl + C`, the script computes a **SHA-256 cryptographic hash** of the raw CSV and writes the file name, row count, and hash into `data/raw/hashes.txt`. If anyone alters even a single comma or digit in the CSV, the SHA-256 hash completely changes, which provides an immutable audit trail.

---

### Q3: Why do you use a **Median Filter** instead of a standard **Average (Mean)** for distance?
> **Answer:**  
> Ultrasonic sensors frequently produce sudden, extreme single-sample spikes (e.g., sound beam bouncing off soft clothing or angled surfaces resulting in 999 or false 5 cm readings).  
> - An **average (mean)** is heavily skewed by extreme outliers: the average of [80, 80, 999, 80, 80] is **263.8 cm**, which is completely wrong and would ruin our security threshold!
> - The **median** simply picks the middle sorted value: the median of [80, 80, 80, 80, 999] is **80 cm**. It completely ignores the spike while preserving sharp, real physical edges.

---

### Q4: Why are impossible readings like `999` or `< 2 cm` marked as missing (NaN) instead of deleting the entire row?
> **Answer:**  
> Because each row contains data from **two independent sensors**: PIR motion and Ultrasonic distance. If an ultrasonic pulse times out (`999`), the PIR sensor on that exact same row might still be detecting a legitimate human intruder (`PIR = 1`). Deleting the entire row would destroy valid motion detection telemetry. By marking only distance as `NaN`, we preserve the motion timeline and smoothly interpolate short distance gaps.

---

### Q5: What is **Debouncing** and why is it applied to motion events?
> **Answer:**  
> When a human walks across a room, their swinging arms and body heat cause the PIR sensor to trigger repeatedly 5 to 10 times in just a few seconds. If we counted each trigger as a separate incident, our statistics would falsely claim dozens of intruders entered the building. Our 5-second debounce algorithm groups rapid successive triggers into **one continuous human presence event**.

---

### Q6: How are Alert Levels determined?
> **Answer:**  
> - **Normal:** PIR = 0 (no motion) and Distance &ge; 50 cm.
> - **Caution:** Exactly one sensor is triggered (either motion detected with no close object, OR a close object detected without motion).
> - **Danger:** Both sensors triggered simultaneously (PIR = 1 AND Distance < 50 cm), indicating an active human intruder in close proximity.
