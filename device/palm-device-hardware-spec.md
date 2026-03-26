# PALM Device — Hardware Specification
Engineering Technical Specification (ETS)

---

## 1. Physical Dimensions
| Component | Measurement |
|----------|-------------|
| Octagonal frame | 240 mm diameter |
| Document rail length | 170 mm |
| Palm sensor circle | 110 mm diameter |
| Thumb sensor pad | 38 mm × 38 mm |
| Rear panel | 65 mm × 90 mm |

---

## 2. Materials
- ABS polymer housing (UL94-V0 rated)
- Tempered biometric glass (Palm sensor)
- Anti-static document rail coating
- Internal aluminum mounting frame

---

## 3. Sensors & Modules

### 3.1 Palm Sensor
- Near-infrared vein pattern scanner
- Capacitive palmprint grid
- 1200 DPI equivalent resolution
- Anti-spoof detection module

### 3.2 Thumb Sensor
- Capacitive fingerprint sensor — 508 DPI
- Liveness detection enabled

### 3.3 Document Scanner
- CMOS linear-scan array
- Dual white/IR illumination
- OCR-ready imaging (300–600 DPI)

### 3.4 Audio Module
- Directional microphone
- Noise suppression DSP
- Speech-to-intent preprocessing

---

## 4. Connectivity
| Interface | Purpose |
|----------|----------|
| USB-C Data | High-speed API transfers |
| USB-C Power | 5V/3A or PoE option |
| BLE 5.0 | Wireless site pairing |
| NFC | Document authentication |

---

## 5. Security
- Secure enclave for biometric hash processing
- AES-256 end-to-end encryption
- Hardware-bound lineage identifiers
- Tamper detection (accelerometer + seal break alerts)

---

## 6. Compliance
- FIPS-201 biometric standards
- ISO/IEC 19794-4 palm/fingerprint formats
- ISO/IEC 19005 document imaging
