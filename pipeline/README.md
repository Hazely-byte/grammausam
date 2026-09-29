# Panchayat Weather Downscaling Pipeline

This directory contains Python scripts for data preparation, downscaling, and microclimate modeling for **SIH26074: Panchayat-Level Weather Forecasts**.

> **Note:** These are OpenStreetMap village points used as a prototype stand-in for Gram Panchayats. They will later be matched to official LGD (Local Government Directory) Gram Panchayat names.

---

## 🚀 How to Run on Windows CMD

1. Open **Command Prompt (`cmd.exe`)** or PowerShell.
2. Navigate to the `pipeline` directory:
   ```cmd
   cd "c:\Users\Owner\Documents\weather app\panchayat-weather\pipeline"
   ```
3. Install required dependencies:
   ```cmd
   pip install -r requirements.txt
   ```
4. Execute the panchayats builder script:
   ```cmd
   python build_panchayats.py
   ```

---

## 📂 Scripts & Outputs

- **`build_panchayats.py`**:
  - Queries OpenStreetMap Overpass API for all village and hamlet nodes within 20 km of Mainpat Block centre (`lat: 22.81, lon: 83.28`).
  - Filters out nameless nodes and deduplicates nearby entries (same name within 1 km).
  - Fetches elevation from the Open-Meteo Elevation API (batched in chunks of up to 100).
  - Calculates distance in km from block centre and assigns unique IDs (`p001`, `p002`, ...).
  
- **Generated Output Files**:
  - `../app/data/panchayats.json`: Structured JSON containing block centre elevation and all panchayats for the web application.
  - `output/panchayats.csv`: CSV export with UTF-8 BOM encoding for inspection in Microsoft Excel.
