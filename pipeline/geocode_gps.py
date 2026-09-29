#!/usr/bin/env python3
"""
SIH26074 - Panchayat Weather Downscaling Pipeline
Build Pilot Gram Panchayat Points from Official Mainpat GP List

1. Reads 44 official Gram Panchayat names from pipeline/reference/mainpat_gp_list.csv.
2. Calls Google Geocoding API forward geocoding for each:
   address="<GP name>, Mainpat, Surguja, Chhattisgarh, India", components=country:IN,
   bounds box about 30 km around (22.81, 83.28).
   Caches responses in pipeline/cache/forward_geocode_cache.json (only OK or ZERO_RESULTS).
3. Evaluates confidence:
   - HIGH:
     • Result type includes "locality", "sublocality" or "neighborhood"
     • Returned place name closely matches GP name (similarity >= 0.8)
     • Point is within 30 km of block centre
     • Reverse geocode tehsil is "Mainpat"
   - MEDIUM:
     • Passes all HIGH checks (settlement type, name similarity >= 0.8, within 30 km)
     • Tehsil is not Mainpat, but district (administrative_area_level_3) is "Surguja"
     • Distance from block centre is within 25 km
     • Reason: "Tehsil <name> differs from Mainpat block; block and tehsil boundaries differ"
   - LOW / NOT_FOUND:
     • Excludes the 7 other points (tehsil centroids, establishment or hospital results).
4. Double checks every candidate with reverse geocoding (using geocode_cache.json).
5. Fetches elevations from Open-Meteo Elevation API for all HIGH and MEDIUM points (37 points).
6. Outputs:
   - pipeline/output/gp_geocode_report.csv (all 44 names with status, reason, etc.)
   - app/data/panchayats.json (HIGH and MEDIUM points, with confidence field)
   - Preserves pipeline/output/panchayats.csv (OSM reference) untouched.
7. Prints comprehensive summary.
"""

import sys
import os
import json
import csv
import math
import time
import difflib
from pathlib import Path
import requests
from dotenv import load_dotenv

# Ensure UTF-8 stdout/stderr on Windows consoles
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# Paths
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
REF_CSV_PATH = SCRIPT_DIR / "reference" / "mainpat_gp_list.csv"
FWD_CACHE_PATH = SCRIPT_DIR / "cache" / "forward_geocode_cache.json"
REV_CACHE_PATH = SCRIPT_DIR / "cache" / "geocode_cache.json"
REPORT_CSV_PATH = SCRIPT_DIR / "output" / "gp_geocode_report.csv"
JSON_OUTPUT_PATH = PROJECT_ROOT / "app" / "data" / "panchayats.json"

# Load environment variables
load_dotenv(PROJECT_ROOT / ".env", override=True)
load_dotenv(SCRIPT_DIR / ".env", override=True)
load_dotenv()

GEOCODING_API_KEY = (os.getenv("GEOCODING_API_KEY") or os.getenv("GOOGLE_MAPS_API_KEY") or "").strip()

# Block Centre Configuration (Mainpat Block HQ, Surguja, Chhattisgarh)
BLOCK_CENTRE = {
    "name": "Mainpat Block",
    "name_en": "Mainpat Block",
    "name_hi": "मैनपाट ब्लॉक",
    "lat": 22.81,
    "lon": 83.28,
}
MAX_RADIUS_KM = 30.0
MEDIUM_MAX_RADIUS_KM = 25.0

# 30 km bounding box around block centre (22.81, 83.28)
BOUNDS_30KM = "22.5400,82.9900|23.0800,83.5700"

GOOGLE_GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"
ELEVATION_API_URL = "https://api.open-meteo.com/v1/elevation"
USER_AGENT = "SIH26074-PanchayatWeatherPilot/1.0 (contact: student-project@sih.gov.in)"

FORBIDDEN_VILLAGE_NAMES = {
    "mainpat", "surguja", "chhattisgarh", "india", "surguja division",
    "मैनपाट", "सरगुजा", "छत्तीसगढ़", "भारत"
}


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculates great-circle distance between two points in km."""
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = (
        math.sin(dphi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2.0) ** 2
    )
    return 2.0 * R * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))


def clean_string(s: str) -> str:
    """Normalize string for fuzzy comparison: alphanumeric only, lowercased."""
    if not s:
        return ""
    return "".join(c.lower() for c in s if c.isalnum())


def calculate_similarity(s1: str, s2: str) -> float:
    """Computes sequence matcher similarity between normalized strings."""
    c1 = clean_string(s1)
    c2 = clean_string(s2)
    if not c1 or not c2:
        return 0.0
    return difflib.SequenceMatcher(None, c1, c2).ratio()


# ------------------------------------------------------------------------------
# Cache Helpers
# ------------------------------------------------------------------------------

def load_json_cache(filepath: Path) -> dict:
    filepath.parent.mkdir(parents=True, exist_ok=True)
    if filepath.exists():
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}


def save_json_cache(filepath: Path, cache: dict):
    filepath.parent.mkdir(parents=True, exist_ok=True)
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=2)


# ------------------------------------------------------------------------------
# Google Geocoding API Calls
# ------------------------------------------------------------------------------

def forward_geocode(gp_name: str, cache: dict) -> dict | None:
    """
    Calls Google Geocoding forward geocoding for a GP name.
    Only caches status 'OK' or 'ZERO_RESULTS'.
    Halts on 'REQUEST_DENIED'.
    """
    cache_key = f"{gp_name}:forward"
    if cache_key in cache:
        return cache[cache_key]

    if not GEOCODING_API_KEY:
        print("[ERROR] GEOCODING_API_KEY is missing from .env. Please configure it.", file=sys.stderr)
        sys.exit(1)

    params = {
        "address": f"{gp_name}, Mainpat, Surguja, Chhattisgarh, India",
        "components": "country:IN",
        "bounds": BOUNDS_30KM,
        "key": GEOCODING_API_KEY,
    }

    try:
        r = requests.get(GOOGLE_GEOCODE_URL, params=params, timeout=15)
        data = r.json()
        status = data.get("status")

        if status == "REQUEST_DENIED":
            err_msg = data.get("error_message", "Request Denied.")
            print(f"\n[FATAL] Google Geocoding API returned REQUEST_DENIED:", file=sys.stderr)
            print(f"       \"{err_msg}\"", file=sys.stderr)
            sys.exit(1)

        if status in ("OK", "ZERO_RESULTS"):
            cache[cache_key] = data
            return data

        err_msg = data.get("error_message", status)
        print(f"   [WARNING] Google forward geocoding returned {status} for {gp_name}: {err_msg}", file=sys.stderr)
        return None

    except requests.exceptions.RequestException as e:
        print(f"   [WARNING] Network error for {gp_name}: {e}", file=sys.stderr)
        return None


def reverse_geocode(lat: float, lon: float, cache: dict) -> dict | None:
    """
    Calls Google Geocoding reverse geocoding to double check tehsil and district.
    Uses existing reverse cache (REV_CACHE_PATH).
    """
    cache_key = f"{lat:.5f},{lon:.5f}:en"
    if cache_key in cache:
        return cache[cache_key]

    if not GEOCODING_API_KEY:
        print("[ERROR] GEOCODING_API_KEY is missing from .env.", file=sys.stderr)
        sys.exit(1)

    params = {
        "latlng": f"{lat:.5f},{lon:.5f}",
        "language": "en",
        "key": GEOCODING_API_KEY,
    }

    try:
        r = requests.get(GOOGLE_GEOCODE_URL, params=params, timeout=15)
        data = r.json()
        status = data.get("status")

        if status == "REQUEST_DENIED":
            err_msg = data.get("error_message", "Request Denied.")
            print(f"\n[FATAL] Google Geocoding API returned REQUEST_DENIED:", file=sys.stderr)
            print(f"       \"{err_msg}\"", file=sys.stderr)
            sys.exit(1)

        if status in ("OK", "ZERO_RESULTS"):
            cache[cache_key] = data
            return data

        return None
    except requests.exceptions.RequestException:
        return None


def extract_reverse_admin(rev_data: dict | None) -> tuple[str | None, str | None]:
    """
    Extracts administrative_area_level_3 (district) and
    administrative_area_level_4 (tehsil) from reverse geocode results.
    Prioritizes the district associated with the administrative_area_level_4 result,
    or checks whether 'Surguja' is in the district components.
    """
    if not rev_data:
        return None, None
    district, tehsil = None, None
    all_districts = []

    for res in rev_data.get("results", []):
        comps = res.get("address_components", [])
        has_l4 = any("administrative_area_level_4" in c.get("types", []) for c in comps)
        if has_l4 and not tehsil:
            for c in comps:
                if "administrative_area_level_4" in c.get("types", []):
                    tehsil = c.get("long_name", "").strip() or None
                if "administrative_area_level_3" in c.get("types", []):
                    district = c.get("long_name", "").strip() or None

        for c in comps:
            if "administrative_area_level_3" in c.get("types", []):
                val = c.get("long_name", "").strip()
                if val:
                    all_districts.append(val)

    if "Surguja" in all_districts:
        district = "Surguja"
    elif not district and all_districts:
        district = all_districts[0]

    return district, tehsil


# ------------------------------------------------------------------------------
# Open-Meteo Elevation
# ------------------------------------------------------------------------------

def fetch_elevations_for_gps(gps: list, block_lat: float, block_lon: float) -> tuple[dict, float]:
    """
    Fetches elevation for each GP from Open-Meteo Elevation API in batches.
    Returns (dict_of_name_to_elev, block_elevation).
    """
    headers = {"User-Agent": USER_AGENT}
    print(f"-> Fetching elevations from Open-Meteo Elevation API for {len(gps)} app points + Block Centre...")

    # 1. Block centre elevation
    block_elevation = 1077.0
    try:
        url = f"{ELEVATION_API_URL}?latitude={block_lat}&longitude={block_lon}"
        r = requests.get(url, headers=headers, timeout=15)
        if r.status_code == 200:
            elev_data = r.json()
            elev_list = elev_data.get("elevation", [])
            if elev_list and elev_list[0] is not None:
                block_elevation = round(float(elev_list[0]), 1)
    except Exception as e:
        print(f"   [NOTICE] Using default block elevation (1077.0 m): {e}")

    # 2. Points elevation
    elev_map = {}
    if not gps:
        return elev_map, block_elevation

    chunk_size = 100
    for i in range(0, len(gps), chunk_size):
        chunk = gps[i : i + chunk_size]
        lats_str = ",".join(f"{p['lat']:.5f}" for p in chunk)
        lons_str = ",".join(f"{p['lon']:.5f}" for p in chunk)
        url = f"{ELEVATION_API_URL}?latitude={lats_str}&longitude={lons_str}"

        for attempt in range(1, 4):
            try:
                r = requests.get(url, headers=headers, timeout=25)
                r.raise_for_status()
                elev_data = r.json()
                elev_list = elev_data.get("elevation", [])
                for idx, p in enumerate(chunk):
                    if idx < len(elev_list) and elev_list[idx] is not None:
                        elev_map[p["name_en"]] = round(float(elev_list[idx]), 1)
                    else:
                        elev_map[p["name_en"]] = None
                break
            except Exception as e:
                print(f"   [NOTICE] Elevation fetch attempt {attempt} failed ({e}). Retrying in 2s...", file=sys.stderr)
                time.sleep(2)

    return elev_map, block_elevation


# ------------------------------------------------------------------------------
# Main Processing Logic
# ------------------------------------------------------------------------------

def main():
    print("==============================================================================================")
    print("        SIH26074 - PILOT GRAM PANCHAYAT GEOCODING PIPELINE (OFFICIAL NAMES)")
    print("==============================================================================================")

    if not REF_CSV_PATH.exists():
        print(f"[FATAL] Reference CSV not found at: {REF_CSV_PATH}", file=sys.stderr)
        sys.exit(1)

    # 1. Read 44 official GP names
    gp_records = []
    with open(REF_CSV_PATH, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            gp_records.append({
                "gp_name_en": row["gp_name_en"].strip(),
                "gp_name_hi": row.get("gp_name_hi", "").strip(),
                "source_url": row.get("source_url", "").strip(),
            })

    total_gps = len(gp_records)
    print(f"-> Loaded {total_gps} official Gram Panchayat records from {REF_CSV_PATH.name}.")

    fwd_cache = load_json_cache(FWD_CACHE_PATH)
    rev_cache = load_json_cache(REV_CACHE_PATH)
    initial_fwd_len = len(fwd_cache)
    initial_rev_len = len(rev_cache)

    print(f"   Forward geocode cache: {initial_fwd_len} entries.")
    print(f"   Reverse geocode cache: {initial_rev_len} entries.")
    print(f"-> Calling Google Forward Geocoding for all {total_gps} Gram Panchayats...")

    evaluated_records = []

    for i, gp in enumerate(gp_records, start=1):
        name_en = gp["gp_name_en"]
        name_hi = gp["gp_name_hi"]

        fwd_data = forward_geocode(name_en, fwd_cache)

        if not fwd_data or fwd_data.get("status") == "ZERO_RESULTS":
            evaluated_records.append({
                "gp_name_en": name_en,
                "gp_name_hi": name_hi,
                "status": "NOT_FOUND",
                "reason": "Google returned ZERO_RESULTS",
                "lat": None,
                "lon": None,
                "matched_name": None,
                "similarity": 0.0,
                "distance_km": None,
                "formatted_address": None,
                "fwd_types": [],
                "admin_district": None,
                "admin_tehsil": None,
            })
            continue

        results = fwd_data.get("results", [])
        if not results:
            evaluated_records.append({
                "gp_name_en": name_en,
                "gp_name_hi": name_hi,
                "status": "NOT_FOUND",
                "reason": "No result objects returned",
                "lat": None,
                "lon": None,
                "matched_name": None,
                "similarity": 0.0,
                "distance_km": None,
                "formatted_address": None,
                "fwd_types": [],
                "admin_district": None,
                "admin_tehsil": None,
            })
            continue

        res = results[0]
        fwd_types = res.get("types", [])
        formatted_address = res.get("formatted_address", "")
        geometry = res.get("geometry", {})
        loc = geometry.get("location", {})
        lat = loc.get("lat")
        lon = loc.get("lng")

        if lat is None or lon is None:
            evaluated_records.append({
                "gp_name_en": name_en,
                "gp_name_hi": name_hi,
                "status": "NOT_FOUND",
                "reason": "Missing coordinate geometry",
                "lat": None,
                "lon": None,
                "matched_name": None,
                "similarity": 0.0,
                "distance_km": None,
                "formatted_address": formatted_address,
                "fwd_types": fwd_types,
                "admin_district": None,
                "admin_tehsil": None,
            })
            continue

        lat = round(float(lat), 5)
        lon = round(float(lon), 5)
        dist_km = round(haversine_km(BLOCK_CENTRE["lat"], BLOCK_CENTRE["lon"], lat, lon), 2)

        # Extract components & candidate place name
        locality_name = None
        fwd_district = None
        fwd_tehsil = None
        first_comp_name = None

        for idx, comp in enumerate(res.get("address_components", [])):
            c_types = comp.get("types", [])
            c_name = comp.get("long_name", "").strip()
            if idx == 0:
                first_comp_name = c_name
            if ("locality" in c_types or any(t.startswith("sublocality") for t in c_types) or "neighborhood" in c_types):
                if not locality_name:
                    locality_name = c_name
            if "administrative_area_level_3" in c_types:
                fwd_district = c_name
            if "administrative_area_level_4" in c_types:
                fwd_tehsil = c_name

        matched_name = locality_name or first_comp_name or formatted_address.split(",")[0].strip()
        similarity = round(calculate_similarity(name_en, matched_name), 2)

        # ----------------------------------------------------------------------
        # Reverse Geocoding Double Check
        # ----------------------------------------------------------------------
        rev_data = reverse_geocode(lat, lon, rev_cache)
        rev_district, rev_tehsil = extract_reverse_admin(rev_data)

        effective_district = rev_district or fwd_district
        effective_tehsil = rev_tehsil or fwd_tehsil

        # ----------------------------------------------------------------------
        # Step 3 & 4: Evaluate Confidence (HIGH, MEDIUM, LOW)
        # ----------------------------------------------------------------------
        # Base checks
        has_settlement_type = any(
            t in ("locality", "sublocality", "neighborhood") or t.startswith("sublocality_")
            for t in fwd_types
        )
        sim_ok = (similarity >= 0.80)
        within_30km = (dist_km <= MAX_RADIUS_KM)

        is_mainpat_tehsil = (effective_tehsil and effective_tehsil.strip().lower() == "mainpat")
        is_surguja_district = (effective_district and effective_district.strip().lower() == "surguja")

        if has_settlement_type and sim_ok and within_30km:
            if is_mainpat_tehsil:
                status = "HIGH"
                reason = "Meets all settlement, Mainpat tehsil, name match, and distance criteria"
            elif is_surguja_district and dist_km <= MEDIUM_MAX_RADIUS_KM:
                status = "MEDIUM"
                reason = f"Tehsil {effective_tehsil or 'Unknown'} differs from Mainpat block; block and tehsil boundaries differ"
            else:
                status = "LOW"
                reasons = []
                if not is_mainpat_tehsil:
                    reasons.append(f"Tehsil is '{effective_tehsil or 'Unknown'}' (not Mainpat)")
                if not is_surguja_district:
                    reasons.append(f"District is '{effective_district}' (not Surguja)")
                if dist_km > MEDIUM_MAX_RADIUS_KM:
                    reasons.append(f"Distance {dist_km:.1f} km exceeds {MEDIUM_MAX_RADIUS_KM:.0f} km limit for differing tehsil")
                reason = "; ".join(reasons)
        else:
            status = "LOW"
            reasons = []
            if not has_settlement_type:
                type_str = "/".join(fwd_types[:3]) if fwd_types else "unknown"
                reasons.append(f"Result type is non-settlement ({type_str})")
            if not sim_ok:
                reasons.append(f"Name mismatch: '{matched_name}' vs '{name_en}' (sim {similarity:.2f} < 0.80)")
            if not within_30km:
                reasons.append(f"Distance {dist_km:.1f} km exceeds {MAX_RADIUS_KM:.0f} km radius")
            reason = "; ".join(reasons)

        evaluated_records.append({
            "gp_name_en": name_en,
            "gp_name_hi": name_hi,
            "status": status,
            "reason": reason,
            "lat": lat,
            "lon": lon,
            "matched_name": matched_name,
            "similarity": similarity,
            "distance_km": dist_km,
            "formatted_address": formatted_address,
            "fwd_types": fwd_types,
            "admin_district": effective_district,
            "admin_tehsil": effective_tehsil,
        })

    # Save updated caches
    if len(fwd_cache) != initial_fwd_len:
        save_json_cache(FWD_CACHE_PATH, fwd_cache)
        print(f"   Saved updated forward cache ({len(fwd_cache)} entries).")
    if len(rev_cache) != initial_rev_len:
        save_json_cache(REV_CACHE_PATH, rev_cache)
        print(f"   Saved updated reverse cache ({len(rev_cache)} entries).")

    # --------------------------------------------------------------------------
    # Step 5: Fetch Elevations for HIGH & MEDIUM Points
    # --------------------------------------------------------------------------
    app_records = [r for r in evaluated_records if r["status"] in ("HIGH", "MEDIUM")]
    app_for_elev = [{"name_en": r["gp_name_en"], "lat": r["lat"], "lon": r["lon"]} for r in app_records]

    elev_map, block_elev = fetch_elevations_for_gps(app_for_elev, BLOCK_CENTRE["lat"], BLOCK_CENTRE["lon"])

    for r in evaluated_records:
        r["elevation_m"] = elev_map.get(r["gp_name_en"])

    # Sort app records by distance from block centre
    app_records.sort(key=lambda x: x["distance_km"])

    # --------------------------------------------------------------------------
    # Step 6: Write Outputs
    # --------------------------------------------------------------------------
    REPORT_CSV_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(REPORT_CSV_PATH, "w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow([
            "gp_name_en", "gp_name_hi", "status", "reason", "lat", "lon",
            "elevation_m", "matched_name", "similarity", "distance_km", "admin_tehsil", "formatted_address"
        ])
        for r in evaluated_records:
            writer.writerow([
                r["gp_name_en"],
                r["gp_name_hi"],
                r["status"],
                r["reason"],
                r["lat"] if r["lat"] is not None else "",
                r["lon"] if r["lon"] is not None else "",
                r["elevation_m"] if r["elevation_m"] is not None else "",
                r["matched_name"] or "",
                f"{r['similarity']:.2f}" if r["similarity"] is not None else "",
                r["distance_km"] if r["distance_km"] is not None else "",
                r["admin_tehsil"] or "",
                r["formatted_address"] or "",
            ])
    print(f"-> Saved full GP Geocode Report (44 rows) to: {REPORT_CSV_PATH}")

    # Build app/data/panchayats.json with HIGH + MEDIUM records
    app_panchayats = []
    for idx, r in enumerate(app_records, start=1):
        app_panchayats.append({
            "id": f"gp{idx:03d}",
            "name_en": r["gp_name_en"],
            "name_hi": r["gp_name_hi"],
            "name_hi_source": "digitalchhattisgarh.com",
            "lat": r["lat"],
            "lon": r["lon"],
            "elevation_m": r["elevation_m"],
            "distance_km": r["distance_km"],
            "confidence": r["status"],
        })

    app_json_data = {
        "block_centre": {
            "name": BLOCK_CENTRE["name"],
            "name_en": BLOCK_CENTRE["name_en"],
            "name_hi": BLOCK_CENTRE["name_hi"],
            "lat": BLOCK_CENTRE["lat"],
            "lon": BLOCK_CENTRE["lon"],
            "elevation_m": block_elev,
        },
        "total_count": len(app_panchayats),
        "panchayats": app_panchayats,
    }

    JSON_OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(JSON_OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(app_json_data, f, ensure_ascii=False, indent=2)
    print(f"-> Saved verified HIGH + MEDIUM GP dataset ({len(app_panchayats)} places) to: {JSON_OUTPUT_PATH}")

    # --------------------------------------------------------------------------
    # Step 8: Print Detailed Summary
    # --------------------------------------------------------------------------
    high_records = [r for r in evaluated_records if r["status"] == "HIGH"]
    medium_records = [r for r in evaluated_records if r["status"] == "MEDIUM"]
    low_records = [r for r in evaluated_records if r["status"] == "LOW"]
    not_found_records = [r for r in evaluated_records if r["status"] == "NOT_FOUND"]

    print("\n" + "=" * 94)
    print("                    GRAM PANCHAYAT GEOCODING SUMMARY REPORT")
    print("=" * 94)
    print(f"Total Official Gram Panchayats: {total_gps}")
    print(f"  • HIGH confidence           : {len(high_records)}  (Verified in Mainpat tehsil)")
    print(f"  • MEDIUM confidence         : {len(medium_records)}  (Verified in block / differing tehsil)")
    print(f"  • LOW confidence            : {len(low_records)}  (Excluded / unmapped / non-settlement)")
    print(f"  • NOT_FOUND                 : {len(not_found_records)}  (No geocode returned)")

    # Print MEDIUM list
    print("\n" + "-" * 94)
    print(f"MEDIUM CONFIDENCE PANCHAYATS ({len(medium_records)} points):")
    print(f"{'Name':<18} | {'Hindi Name':<16} | {'Elev (m)':<9} | {'Dist (km)':<9} | {'Tehsil'}")
    print("-" * 94)
    medium_records.sort(key=lambda x: x["distance_km"])
    for r in medium_records:
        elev_str = f"{r['elevation_m']:.1f} m" if r['elevation_m'] is not None else "N/A"
        dist_str = f"{r['distance_km']:.2f} km"
        print(f"{r['gp_name_en']:<18} | {r['gp_name_hi']:<16} | {elev_str:<9} | {dist_str:<9} | {r['admin_tehsil']}")

    # Combined HIGH + MEDIUM Elevation statistics
    all_app_elevs = [r["elevation_m"] for r in app_records if r["elevation_m"] is not None]
    if all_app_elevs:
        lowest_val = min(all_app_elevs)
        highest_val = max(all_app_elevs)
        lowest_gp = next(r for r in app_records if r["elevation_m"] == lowest_val)
        highest_gp = next(r for r in app_records if r["elevation_m"] == highest_val)
        spread = round(highest_val - lowest_val, 1)
        above_1000 = sum(1 for e in all_app_elevs if e >= 1000.0)
        below_1000 = sum(1 for e in all_app_elevs if e < 1000.0)

        print("\n" + "-" * 94)
        print(f"ELEVATION PROFILE FOR ALL APP PANCHAYATS ({len(all_app_elevs)} places - HIGH + MEDIUM):")
        print(f"  • Lowest Point              : {lowest_val:.1f} m ({lowest_gp['gp_name_en']} / {lowest_gp['gp_name_hi']}) [{lowest_gp['status']}]")
        print(f"  • Highest Point             : {highest_val:.1f} m ({highest_gp['gp_name_en']} / {highest_gp['gp_name_hi']}) [{highest_gp['status']}]")
        print(f"  • Elevation Spread          : {spread:.1f} m variation across block area")
        print(f"  • Points >= 1000 m          : {above_1000} / {len(all_app_elevs)} ({above_1000 / len(all_app_elevs) * 100:.1f}%)")
        print(f"  • Points < 1000 m           : {below_1000} / {len(all_app_elevs)} ({below_1000 / len(all_app_elevs) * 100:.1f}%)")
    print("=" * 94 + "\n")


if __name__ == "__main__":
    main()
