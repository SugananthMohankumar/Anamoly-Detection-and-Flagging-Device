# Anomaly Detection and Flagging Device - Dashboard

A web dashboard for real-time anomaly detection with ESP32 hardware telemetry, live camera feed with YOLO11 object detection, Gemini Vision AI verification, and Web Audio monitoring.

---

## Prerequisites: Java 11 or Newer

This project uses a zero-dependency Java HTTP server (`DashboardServer.java`) built with Java's standard library (`com.sun.net.httpserver.HttpServer`).

### 1. Check if Java is Installed
Open your terminal (Command Prompt or PowerShell) and run:
```bash
java -version
```

- If you see output like `openjdk version "17.0.x"` or `java version "21.0.x"` (version 11 or newer), Java is ready!
- If you see `java is not recognized`, install Java (JDK 17 or 21 LTS) from [Adoptium / Eclipse Temurin](https://adoptium.net/) or [Oracle Java](https://www.oracle.com/java/technologies/downloads/). Make sure to check the option **"Add to PATH"** during setup.

---

## How to Run the Dashboard

1. Open PowerShell or Command Prompt.
2. Navigate to this project folder:
   ```bash
   cd "c:\Users\SUGANANTH\OneDrive\Desktop\ANAMOLY PROJECT"
   ```
3. Run the Java server with a single command:
   ```bash
   java DashboardServer.java
   ```
   *(No compiling with `javac` or Maven/Gradle needed — Java 11+ directly compiles and runs single-file source code).*

4. Open your browser (Google Chrome or Microsoft Edge recommended for Web Serial support):
   ```
   http://localhost:3000
   ```

---

## Key Features & Controls
- **ESP32 Connection:** Click **"Connect Device"** to pair over USB at 115200 baud.
- **PIR Buzzer Toggle:** Switch `"PIR buzzer: ON/OFF"` next to "Test Buzzer" or in Settings to control whether PIR motion alone beeps the buzzer.
- **Camera AI Feed:** Click **"Start Camera"** to run local YOLO11 ONNX object detection and Layer 2 Gemini Vision weapon verification.
- **Alarm Outputs:** Configure audio routing to ESP32 device buzzer, laptop speakers, or both.
