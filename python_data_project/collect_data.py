"""
collect_data.py
---------------
Step 1: Record real-time sensor data from ESP32 over the USB Serial Port.

How it works:
1. Opens the serial port (e.g., COM3) at 115200 baud.
2. ESP32 sends a line every 0.5 seconds: PIR:<0 or 1>,DIST:<distance in cm>
3. Each line is saved with a precise timestamp to a new raw CSV file.
4. When stopped with Ctrl + C, calculates the SHA-256 cryptographic hash of the file
   and saves it into 'hashes.txt'. This guarantees the raw data was never altered or tampered with.
"""

import sys
import os
import time
import datetime
import hashlib
import re

# Try importing serial (pyserial). If not installed, give a beginner-friendly error message.
try:
    import serial
except ImportError:
    print("[ERROR] 'pyserial' library is not installed.")
    print("Please install it by running: pip install pyserial")
    sys.exit(1)


def parse_esp32_line(raw_text):
    """
    Tries to find 'PIR:<number>' and 'DIST:<number>' in the raw string.
    If the line is corrupted or incomplete, returns (None, None).
    """
    raw_text = raw_text.strip()
    
    # Regular expression to look for PIR:0 or PIR:1 and DIST:number
    pir_match = re.search(r'PIR\s*:\s*(\d+)', raw_text, re.IGNORECASE)
    dist_match = re.search(r'DIST\s*:\s*(\d+(?:\.\d+)?)', raw_text, re.IGNORECASE)

    pir_val = pir_match.group(1) if pir_match else ""
    dist_val = dist_match.group(1) if dist_match else ""

    return pir_val, dist_val


def compute_file_sha256(filepath):
    """
    Computes the SHA-256 hash of a file.
    SHA-256 is like a unique digital fingerprint. If even one character is changed,
    the fingerprint changes completely.
    """
    hasher = hashlib.sha256()
    with open(filepath, 'rb') as f:
        # Read in 64 KB chunks to be memory-efficient
        while chunk := f.read(65536):
            hasher.update(chunk)
    return hasher.hexdigest()


def main():
    # -------------------------------------------------------------
    # 1. Check command line arguments for the port name
    # -------------------------------------------------------------
    if len(sys.argv) < 2:
        print("\n[USAGE]")
        print("Please provide your ESP32 serial port name, for example:")
        print("    py collect_data.py COM3")
        print("or")
        print("    python collect_data.py COM3\n")
        sys.exit(1)

    port_name = sys.argv[1].strip()

    # -------------------------------------------------------------
    # 2. Ensure the output directory 'data/raw' exists
    # -------------------------------------------------------------
    base_dir = os.path.dirname(os.path.abspath(__file__))
    raw_dir = os.path.join(base_dir, "data", "raw")
    os.makedirs(raw_dir, exist_ok=True)

    # -------------------------------------------------------------
    # 3. Create a unique filename based on the current date and time
    # -------------------------------------------------------------
    now_str = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"raw_data_{now_str}.csv"
    filepath = os.path.join(raw_dir, filename)

    print("=" * 60)
    print(" ANOMALY DETECTION - ESP32 DATA RECORDER ")
    print("=" * 60)
    print(f"Connecting to port : {port_name}")
    print(f"Baud rate          : 115200")
    print(f"Saving data to     : {filepath}")
    print("Press Ctrl + C anytime to stop recording.\n")

    # -------------------------------------------------------------
    # 4. Open the Serial Port
    # -------------------------------------------------------------
    try:
        ser = serial.Serial(port=port_name, baudrate=115200, timeout=1.0)
        # Flush any old leftover data in the buffer
        ser.reset_input_buffer()
        time.sleep(1.0)  # Give ESP32 a second to stabilize after opening connection
    except serial.SerialException as e:
        print(f"\n[ERROR] Could not open port {port_name}: {e}")
        print("Tips for troubleshooting:")
        print("1. Make sure ESP32 USB cable is firmly connected.")
        print("2. Close the Arduino Serial Monitor and browser dashboard so port isn't busy.")
        print("3. Check Device Manager to verify the correct COM port.\n")
        sys.exit(1)

    # -------------------------------------------------------------
    # 5. Open the CSV file and write the header row
    # -------------------------------------------------------------
    csv_file = open(filepath, "w", encoding="utf-8", newline="")
    # Header format: timestamp, pir, dist_raw, raw_line
    csv_file.write("timestamp,pir,dist_raw,raw_line\n")
    csv_file.flush()

    line_count = 0

    # -------------------------------------------------------------
    # 6. Reading loop
    # -------------------------------------------------------------
    try:
        while True:
            # Read one line ending with newline '\n'
            raw_bytes = ser.readline()
            if not raw_bytes:
                continue  # Timeout with no data, keep waiting

            # Decode bytes into a readable string (ignore decode errors gracefully)
            raw_line = raw_bytes.decode('utf-8', errors='replace').strip()

            if not raw_line:
                continue

            # Capture the exact reception timestamp (ISO 8601 format)
            timestamp = datetime.datetime.now().isoformat()

            # Parse PIR and DIST from the line
            pir_val, dist_val = parse_esp32_line(raw_line)

            # Clean raw_line of quotes or commas to avoid breaking CSV format
            escaped_raw = '"' + raw_line.replace('"', '""') + '"'

            # Write to CSV: timestamp, pir, dist_raw, raw_line
            csv_file.write(f"{timestamp},{pir_val},{dist_val},{escaped_raw}\n")
            csv_file.flush()

            line_count += 1

            # Print feedback every 20 lines recorded
            if line_count % 20 == 0:
                print(f"[STATUS] {line_count} lines recorded... (Last line: {raw_line})")

    except KeyboardInterrupt:
        # User pressed Ctrl + C to stop
        print("\n\n[STOPPING] Recording stopped by user (Ctrl + C).")

    finally:
        # Always close serial port and file cleanly
        try:
            ser.close()
        except Exception:
            pass

        csv_file.close()

    # -------------------------------------------------------------
    # 7. Calculate SHA-256 cryptographic hash and record in hashes.txt
    # -------------------------------------------------------------
    if os.path.exists(filepath) and os.path.getsize(filepath) > 0:
        file_hash = compute_file_sha256(filepath)
        hashes_file_path = os.path.join(raw_dir, "hashes.txt")

        # Append to hashes.txt
        with open(hashes_file_path, "a", encoding="utf-8") as hf:
            hf.write(f"Filename: {filename} | Rows: {line_count} | SHA-256: {file_hash}\n")

        print("=" * 60)
        print(" RECORDING COMPLETE ")
        print("=" * 60)
        print(f"File Saved   : {filename}")
        print(f"Total Rows   : {line_count}")
        print(f"SHA-256 Hash : {file_hash}")
        print(f"Verification : Appended to {hashes_file_path}")
        print("Integrity check saved! This proves the raw data was never modified.")
        print("=" * 60)
    else:
        print("[NOTICE] No data was recorded.")


if __name__ == "__main__":
    main()
