#!/usr/bin/env python3
"""
SIH26074 - Panchayat Weather Downscaling Pipeline
Build Pilot Panchayats List for Mainpat Block, Surguja

1. Queries OpenStreetMap Overpass API for village & hamlet nodes within 30 km.
2. Deduplicates points within 1 km (removes multiple nodes for the same settlement).
3. Reverse geocodes every point using Google Geocoding API (language=en and language=hi):
   - Prefers address components: "locality", then "sublocality", then "neighborhood".
   - Never uses administrative area names (like "Mainpat", "Surguja") as village names.
   - Extracts admin_district (administrative_area_level_3) and admin_tehsil (administrative_area_level_4).
   - Sets in_mainpat = true if admin_tehsil == "Mainpat", false if different tehsil, null if none.
   - Caches responses in pipeline/cache/geocode_cache.json ONLY for status "OK" or "ZERO_RESULTS".
   - Never caches REQUEST_DENIED or other errors; halts immediately with the exact Google error message.
   - Preserves OSM name if present and stores Google name for comparison.
   - Sets name_source: "osm", "google_reverse", or "none".
4. Naming & Disambiguation (NO name-based merging):
   - Every point is kept; no points are merged based on names.
   - Unnamed points are named "Area near <nearest point that has a real village name>".
   - If two kept points share a name, disambiguates by adding (1), (2), etc.
5. Hindi names:
   - Sets name_hi_verified = false for every point.
   - If Google returns an English-only name (no Devanagari characters), sets name_hi to "".
6. Fetches elevations from Open-Meteo Elevation API (batched in chunks <= 100 with retry).
7. Exports:
   - ALL points saved to pipeline/output/panchayats.csv (for audit).
   - ONLY in_mainpat == true points saved to app/data/panchayats.json (for app).
"""

import sys
import os
import json
import csv
import math
import time
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
CACHE_FILE = SCRIPT_DIR / "cache" / "geocode_cache.json"
JSON_OUTPUT_PATH = PROJECT_ROOT / "app" / "data" / "panchayats.json"
CSV_OUTPUT_PATH = SCRIPT_DIR / "output" / "panchayats.csv"

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
SEARCH_RADIUS_M = 30000  # 30 km radius to cover the entire Mainpat block

ELEVATION_API_URL = "https://api.open-meteo.com/v1/elevation"
GOOGLE_GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"
USER_AGENT = "SIH26074-PanchayatWeatherPilot/1.0 (contact: student-project@sih.gov.in)"

# Names of administrative areas that must never be used as village/place names
FORBIDDEN_NAMES = {
    "mainpat", "surguja", "chhattisgarh", "india", "surguja division",
    "मैनपाट", "सरगुजा", "छत्तीसगढ़", "भारत", "सरगुजा संभाग"
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


def contains_devanagari(text: str | None) -> bool:
    """Returns True if the text contains Devanagari script characters."""
    if not text:
        return False
    return any("\u0900" <= char <= "\u097f" for char in text)


def query_overpass_places(lat: float, lon: float, radius_m: int) -> list:
    """
    Queries Overpass API for all village and hamlet nodes within radius.
    Tries multiple mirror endpoints with fallback.
    """
    query = f"""[out:json][timeout:45];
    (
      node["place"="village"](around:{radius_m},{lat},{lon});
      node["place"="hamlet"](around:{radius_m},{lat},{lon});
    );
    out body;"""

    headers = {"User-Agent": USER_AGENT}
    endpoints = [
        "https://lz4.overpass-api.de/api/interpreter",
        "https://overpass-api.de/api/interpreter",
        "https://overpass.kumi.systems/api/interpreter",
        "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    ]

    print(f"-> Querying OpenStreetMap Overpass API for places within {radius_m/1000:.0f} km of ({lat}, {lon})...")

    last_error = None
    for url in endpoints:
        try:
            response = requests.post(url, data={"data": query}, headers=headers, timeout=30)
            if response.status_code == 200:
                data = response.json()
                elements = data.get("elements", [])
                host = url.split("/")[2]
                print(f"   Received {len(elements)} raw place nodes from {host}.")
                return elements
            else:
                last_error = f"HTTP {response.status_code}"
                print(f"   [NOTICE] Endpoint {url.split('/')[2]} returned status {response.status_code}. Trying next mirror...")
        except Exception as e:
            last_error = e
            print(f"   [NOTICE] Endpoint {url.split('/')[2]} error: {e}. Trying next mirror...")

    print(f"   [ERROR] Failed to query Overpass across endpoints: {last_error}", file=sys.stderr)
    sys.exit(1)


def deduplicate_osm_points(elements: list, block_lat: float, block_lon: float) -> list:
    """
    Keeps all real OSM village/hamlet points, removing duplicates within 1 km.
    Preserves OSM names if present.
    """
    raw_points = []
    for elem in elements:
        lat = float(elem.get("lat"))
        lon = float(elem.get("lon"))
        tags = elem.get("tags", {})
        osm_name = tags.get("name", "").strip() or None
        osm_name_en = tags.get("name:en", "").strip() or None
        osm_name_hi = tags.get("name:hi", "").strip() or None
        dist_km = haversine_km(block_lat, block_lon, lat, lon)

        raw_points.append({
            "osm_id": elem.get("id"),
            "osm_type": elem.get("type"),
            "place_type": tags.get("place", "hamlet"),
            "lat": round(lat, 5),
            "lon": round(lon, 5),
            "distance_km": round(dist_km, 2),
            "osm_name": osm_name,
            "osm_name_en": osm_name_en,
            "osm_name_hi": osm_name_hi,
        })

    # Sort by distance from block centre
    raw_points.sort(key=lambda p: p["distance_km"])

    # Deduplicate within 1 km: keep the first point in cluster
    unique_points = []
    merged_count = 0
    for p in raw_points:
        is_dup = False
        for kept in unique_points:
            if haversine_km(p["lat"], p["lon"], kept["lat"], kept["lon"]) < 1.0:
                is_dup = True
                merged_count += 1
                if not kept["osm_name"] and p["osm_name"]:
                    kept["osm_name"] = p["osm_name"]
                    kept["osm_name_en"] = p["osm_name_en"]
                    kept["osm_name_hi"] = p["osm_name_hi"]
                break
        if not is_dup:
            unique_points.append(p)

    print(f"   Deduplicated {len(raw_points)} raw OSM nodes to {len(unique_points)} unique points (within 1 km).")
    return unique_points


# ------------------------------------------------------------------------------
# Google Geocoding & Cache Handling
# ------------------------------------------------------------------------------

def load_geocode_cache() -> dict:
    """Loads cached Google geocoding results, ensuring cache file exists."""
    CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    if CACHE_FILE.exists():
        try:
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}
    save_geocode_cache({})
    return {}


def save_geocode_cache(cache: dict):
    """Saves Google geocoding results to cache file."""
    CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=2)


def fetch_google_geocode(lat: float, lon: float, language: str, cache: dict) -> dict | None:
    """
    Fetches reverse geocoding from Google Geocoding API.
    - Caches ONLY when status is "OK" or "ZERO_RESULTS".
    - Never caches errors.
    - If status is "REQUEST_DENIED", stops immediately with the exact Google error message.
    """
    cache_key = f"{lat:.5f},{lon:.5f}:{language}"
    if cache_key in cache:
        return cache[cache_key]

    if not GEOCODING_API_KEY:
        print("[ERROR] GEOCODING_API_KEY is missing from .env. Please add your key to panchayat-weather/.env.", file=sys.stderr)
        sys.exit(1)

    url = f"{GOOGLE_GEOCODE_URL}?latlng={lat:.5f},{lon:.5f}&key={GEOCODING_API_KEY}&language={language}"
    try:
        r = requests.get(url, timeout=15)
        data = r.json()
        status = data.get("status")

        if status == "REQUEST_DENIED":
            err_msg = data.get("error_message", "Request Denied.")
            print(f"\n[FATAL] Google Geocoding API returned REQUEST_DENIED:", file=sys.stderr)
            print(f"       \"{err_msg}\"", file=sys.stderr)
            print("Please ensure that Billing is enabled on the Google Cloud project and Geocoding API is enabled.", file=sys.stderr)
            sys.exit(1)

        if status in ("OK", "ZERO_RESULTS"):
            cache[cache_key] = data
            return data

        err_msg = data.get("error_message", status)
        print(f"   [WARNING] Google Geocoding API returned {status}: {err_msg}", file=sys.stderr)
        return None

    except requests.exceptions.RequestException as e:
        print(f"   [WARNING] Network error during Google Geocoding request: {e}", file=sys.stderr)
        return None


def extract_admin_areas(geocode_data: dict | None) -> tuple[str | None, str | None]:
    """
    Extracts admin_district (administrative_area_level_3) and
    admin_tehsil (administrative_area_level_4) from Google results.
    """
    if not geocode_data:
        return None, None

    results = geocode_data.get("results", [])
    district = None
    tehsil = None

    for res in results:
        for comp in res.get("address_components", []):
            types = comp.get("types", [])
            if "administrative_area_level_3" in types and not district:
                district = comp.get("long_name", "").strip() or None
            if "administrative_area_level_4" in types and not tehsil:
                tehsil = comp.get("long_name", "").strip() or None

    return district, tehsil


def extract_village_name(geocode_data: dict | None) -> str | None:
    """
    Extracts village/place name from Google results.
    Preference order:
    1. locality
    2. sublocality (or sublocality_level_1, sublocality_level_2, etc.)
    3. neighborhood

    STRICT: Never returns administrative area names (like 'Mainpat', 'Surguja').
    """
    if not geocode_data:
        return None

    results = geocode_data.get("results", [])
    if not results:
        return None

    # Priority 1: locality
    for res in results:
        for comp in res.get("address_components", []):
            types = comp.get("types", [])
            if "locality" in types:
                val = comp.get("long_name", "").strip()
                if val and val.lower() not in FORBIDDEN_NAMES:
                    return val

    # Priority 2: sublocality
    for res in results:
        for comp in res.get("address_components", []):
            types = comp.get("types", [])
            if any(t.startswith("sublocality") for t in types):
                val = comp.get("long_name", "").strip()
                if val and val.lower() not in FORBIDDEN_NAMES:
                    return val

    # Priority 3: neighborhood
    for res in results:
        for comp in res.get("address_components", []):
            types = comp.get("types", [])
            if "neighborhood" in types:
                val = comp.get("long_name", "").strip()
                if val and val.lower() not in FORBIDDEN_NAMES:
                    return val

    return None


def reverse_geocode_and_classify(points: list) -> list:
    """
    Reverse geocodes all points with Google Geocoding API:
    - Extracts admin_district and admin_tehsil
    - Sets in_mainpat (True / False / None)
    - Extracts village name (locality/sublocality/neighborhood, not admin names)
    - Extracts Hindi name (with Devanagari validation)
    - Labels unnamed points as 'Area near <nearest point with real village name>'
    - Disambiguates duplicate names by adding (1), (2) without merging
    """
    cache = load_geocode_cache()
    initial_cache_size = len(cache)

    print(f"-> Reverse geocoding {len(points)} points with Google Geocoding API...")
    print(f"   Cache currently contains {initial_cache_size} entries.")

    for i, p in enumerate(points, start=1):
        lat, lon = p["lat"], p["lon"]

        # 1. Fetch English geocode
        data_en = fetch_google_geocode(lat, lon, "en", cache)
        google_en = extract_village_name(data_en)
        district, tehsil = extract_admin_areas(data_en)

        # 2. Fetch Hindi geocode
        data_hi = fetch_google_geocode(lat, lon, "hi", cache)
        google_hi_raw = extract_village_name(data_hi)
        # Check if Hindi name contains Devanagari characters
        google_hi = google_hi_raw if contains_devanagari(google_hi_raw) else ""

        p["admin_district"] = district
        p["admin_tehsil"] = tehsil
        if tehsil:
            p["in_mainpat"] = (tehsil.strip().lower() == "mainpat")
        else:
            p["in_mainpat"] = None

        p["google_name"] = google_en
        p["google_name_hi"] = google_hi
        p["name_hi_verified"] = False

        # Check OSM name
        osm_name = p.get("osm_name")
        if osm_name and osm_name.strip().lower() in FORBIDDEN_NAMES:
            osm_name = None

        if osm_name:
            p["name"] = osm_name
            p["name_en"] = p.get("osm_name_en") or google_en or osm_name
            # Verify Hindi name for OSM
            osm_hi = p.get("osm_name_hi") or google_hi
            p["name_hi"] = osm_hi if contains_devanagari(osm_hi) else ""
            p["name_source"] = "osm"
        elif google_en:
            p["name"] = google_en
            p["name_en"] = google_en
            p["name_hi"] = google_hi
            p["name_source"] = "google_reverse"
        else:
            p["name"] = None
            p["name_en"] = None
            p["name_hi"] = ""
            p["name_source"] = "none"

        # Rate-limiting pause
        if len(cache) > initial_cache_size and i % 5 == 0:
            time.sleep(0.05)

    if len(cache) != initial_cache_size:
        save_geocode_cache(cache)
        print(f"   Saved updated geocode cache ({len(cache)} entries).")

    # Name unnamed points as 'Area near <nearest point that has a real village name>'
    named_points = [p for p in points if p["name_source"] in ("osm", "google_reverse") and p["name"]]
    print(f"   Identified {len(named_points)} points with real village names.")

    for p in points:
        if p["name_source"] == "none" or not p["name"]:
            if named_points:
                nearest = min(
                    named_points,
                    key=lambda np: haversine_km(p["lat"], p["lon"], np["lat"], np["lon"])
                )
                ref_en = nearest["name_en"] or nearest["name"]
                ref_hi = nearest.get("name_hi") or ""
            else:
                ref_en = BLOCK_CENTRE["name_en"]
                ref_hi = BLOCK_CENTRE["name_hi"]

            p["name"] = f"Area near {ref_en}"
            p["name_en"] = f"Area near {ref_en}"
            p["name_hi"] = f"{ref_hi} के पास क्षेत्र" if ref_hi else f"{ref_en} के पास क्षेत्र"
            p["name_source"] = "none"

    # Disambiguate duplicate names: NO merging! Keep every point, add (1), (2)
    name_groups = {}
    for p in points:
        key = p["name"].strip().lower()
        name_groups.setdefault(key, []).append(p)

    for key, group in name_groups.items():
        if len(group) > 1:
            group.sort(key=lambda x: x["distance_km"])
            base_name = group[0]["name"]
            base_name_en = group[0]["name_en"]
            base_name_hi = group[0]["name_hi"]
            for idx, pt in enumerate(group, start=1):
                pt["name"] = f"{base_name} ({idx})"
                pt["name_en"] = f"{base_name_en} ({idx})"
                if base_name_hi:
                    pt["name_hi"] = f"{base_name_hi} ({idx})"

    points.sort(key=lambda p: p["distance_km"])
    return points


def fetch_elevations(places: list, block_lat: float, block_lon: float) -> tuple:
    """
    Fetches elevation for each place from Open-Meteo Elevation API (batched in chunks up to 100),
    as well as for the block centre. Includes retries and backoff.
    """
    headers = {"User-Agent": USER_AGENT}
    print(f"-> Fetching elevation from Open-Meteo Elevation API for {len(places)} places + Block Centre...")

    # 1. Fetch Block Centre elevation
    block_elevation = None
    for attempt in range(1, 4):
        try:
            url = f"{ELEVATION_API_URL}?latitude={block_lat}&longitude={block_lon}"
            r = requests.get(url, headers=headers, timeout=15)
            r.raise_for_status()
            elev_data = r.json()
            elev_list = elev_data.get("elevation", [])
            if elev_list and elev_list[0] is not None:
                block_elevation = round(float(elev_list[0]), 1)
                break
        except Exception as e:
            if attempt == 3:
                print(f"   [WARNING] Failed to fetch block centre elevation: {e}. Using raw grid reference.", file=sys.stderr)
                block_elevation = 990.0
            time.sleep(1.5)

    # 2. Batch places in chunks of up to 100
    chunk_size = 100
    for i in range(0, len(places), chunk_size):
        chunk = places[i : i + chunk_size]
        lats_str = ",".join(f"{p['lat']:.5f}" for p in chunk)
        lons_str = ",".join(f"{p['lon']:.5f}" for p in chunk)
        url = f"{ELEVATION_API_URL}?latitude={lats_str}&longitude={lons_str}"

        success = False
        for attempt in range(1, 4):
            try:
                r = requests.get(url, headers=headers, timeout=25)
                r.raise_for_status()
                elev_data = r.json()
                elev_list = elev_data.get("elevation", [])
                for j, p in enumerate(chunk):
                    if j < len(elev_list) and elev_list[j] is not None:
                        p["elevation_m"] = round(float(elev_list[j]), 1)
                    else:
                        p["elevation_m"] = None
                success = True
                break
            except Exception as e:
                print(f"   [NOTICE] Open-Meteo elevation attempt {attempt} failed ({e}). Retrying in 2s...", file=sys.stderr)
                time.sleep(2)

        if not success:
            print(f"   [WARNING] Could not fetch elevations from Open-Meteo after 3 attempts. Setting fallback.", file=sys.stderr)
            for p in chunk:
                p["elevation_m"] = p.get("elevation_m") or 990.0

    print("   Successfully fetched all elevation records.")
    return places, block_elevation


def main():
    JSON_OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    CSV_OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)

    block_lat = BLOCK_CENTRE["lat"]
    block_lon = BLOCK_CENTRE["lon"]

    # Step 1: Query Overpass API for raw OSM points within 30 km
    raw_nodes = query_overpass_places(block_lat, block_lon, SEARCH_RADIUS_M)

    # Step 2: Keep all real OSM village/hamlet points, deduplicating within 1 km
    points = deduplicate_osm_points(raw_nodes, block_lat, block_lon)
    if not points:
        print("[ERROR] No valid OSM points found in pilot area. Exiting.", file=sys.stderr)
        sys.exit(1)

    # Step 3: Reverse geocode with Google Geocoding API (with caching)
    points = reverse_geocode_and_classify(points)

    # Step 4: Fetch elevations from Open-Meteo for ALL points (batched <= 100)
    points, block_elevation = fetch_elevations(places=points, block_lat=block_lat, block_lon=block_lon)

    # Step 5: Assign sequential IDs (p001, p002, ...)
    for idx, p in enumerate(points, start=1):
        p["id"] = f"p{idx:03d}"

    # Step 6: Filter for in_mainpat == True points for the web app
    mainpat_points = [p for p in points if p.get("in_mainpat") is True]

    # Re-index mainpat_points for clean app IDs
    app_panchayats = []
    for idx, p in enumerate(mainpat_points, start=1):
        app_entry = dict(p)
        app_entry["id"] = f"p{idx:03d}"
        app_panchayats.append(app_entry)

    output_json_data = {
        "block_centre": {
            "name": BLOCK_CENTRE["name"],
            "name_en": BLOCK_CENTRE["name_en"],
            "name_hi": BLOCK_CENTRE["name_hi"],
            "lat": block_lat,
            "lon": block_lon,
            "elevation_m": block_elevation,
        },
        "total_count": len(app_panchayats),
        "panchayats": app_panchayats,
    }

    # Save ONLY in_mainpat == True points to app/data/panchayats.json
    with open(JSON_OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output_json_data, f, ensure_ascii=False, indent=2)
    print(f"-> Saved JSON ({len(app_panchayats)} Mainpat places) to: {JSON_OUTPUT_PATH}")

    # Save ALL points to pipeline/output/panchayats.csv (with UTF-8 BOM)
    fieldnames = [
        "id", "name", "name_en", "name_hi", "name_hi_verified", "name_source",
        "in_mainpat", "admin_tehsil", "admin_district", "lat", "lon", "elevation_m", "distance_km"
    ]
    with open(CSV_OUTPUT_PATH, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for p in points:
            in_mp_str = "true" if p["in_mainpat"] is True else ("false" if p["in_mainpat"] is False else "")
            writer.writerow({
                "id": p["id"],
                "name": p["name"],
                "name_en": p["name_en"] or "",
                "name_hi": p["name_hi"] or "",
                "name_hi_verified": p.get("name_hi_verified", False),
                "name_source": p["name_source"],
                "in_mainpat": in_mp_str,
                "admin_tehsil": p.get("admin_tehsil") or "",
                "admin_district": p.get("admin_district") or "",
                "lat": p["lat"],
                "lon": p["lon"],
                "elevation_m": p["elevation_m"] if p["elevation_m"] is not None else "",
                "distance_km": p["distance_km"],
            })
    print(f"-> Saved CSV (ALL {len(points)} places) to: {CSV_OUTPUT_PATH}")

    # Step 7: Terminal Summary & Breakdown
    count_in_mainpat_true = sum(1 for p in points if p.get("in_mainpat") is True)
    count_in_mainpat_false = sum(1 for p in points if p.get("in_mainpat") is False)
    count_in_mainpat_null = sum(1 for p in points if p.get("in_mainpat") is None)

    # Excluded points list
    excluded_points = [p for p in points if p.get("in_mainpat") is not True]

    # Metrics for in_mainpat == True
    valid_mainpat_elev = [p for p in mainpat_points if p["elevation_m"] is not None]
    if valid_mainpat_elev:
        lowest_place = min(valid_mainpat_elev, key=lambda p: p["elevation_m"])
        highest_place = max(valid_mainpat_elev, key=lambda p: p["elevation_m"])
        above_1000m_count = sum(1 for p in valid_mainpat_elev if p["elevation_m"] >= 1000.0)
    else:
        lowest_place = highest_place = None
        above_1000m_count = 0

    print("\n" + "=" * 94)
    print("               MAINPAT BLOCK (TEHSIL) PILOT PANCHAYATS SUMMARY")
    print("=" * 94)
    print(f"Block Centre          : {BLOCK_CENTRE['name']} (Lat: {block_lat}, Lon: {block_lon})")
    print(f"Block Centre Elevation: {block_elevation} m")
    print(f"Total Points Found    : {len(points)} (within 30 km radius, deduplicated at 1 km)")
    print(f"\nArea Filter (in_mainpat):")
    print(f"  • in_mainpat = true  : {count_in_mainpat_true}  (Included in app dataset)")
    print(f"  • in_mainpat = false : {count_in_mainpat_false} (Excluded: neighboring tehsils)")
    print(f"  • in_mainpat = null  : {count_in_mainpat_null}  (Excluded: no tehsil in geocode)")

    if lowest_place and highest_place:
        spread = highest_place['elevation_m'] - lowest_place['elevation_m']
        pct_1000 = (above_1000m_count / len(valid_mainpat_elev)) * 100
        print(f"\nMainpat Elevation Profile:")
        print(f"  • Lowest Place       : {lowest_place['elevation_m']} m ({lowest_place['name_en']}) [{lowest_place['id']}] - {lowest_place['name_source']}")
        print(f"  • Highest Place      : {highest_place['elevation_m']} m ({highest_place['name_en']}) [{highest_place['id']}] - {highest_place['name_source']}")
        print(f"  • Elevation Spread   : {spread:.1f} m difference inside Mainpat")
        print(f"  • Points >= 1000 m   : {above_1000m_count} / {len(valid_mainpat_elev)} ({pct_1000:.1f}% on the high plateau)")

    print(f"\nFull List of Mainpat Block Places (in_mainpat = true, {len(mainpat_points)} points):")
    print(f"{'ID':<6} | {'English / Main Name':<34} | {'Hindi Name':<28} | {'Elev (m)':<8} | {'Dist':<8} | {'Source'}")
    print("-" * 102)
    for p in mainpat_points:
        name_str = p['name_en'] or p['name']
        name_hi_str = p.get('name_hi') or '-'
        elev_str = f"{p['elevation_m']} m" if p['elevation_m'] is not None else "N/A"
        dist_str = f"{p['distance_km']} km"
        print(f"{p['id']:<6} | {name_str[:34]:<34} | {name_hi_str[:28]:<28} | {elev_str:<8} | {dist_str:<8} | {p['name_source']}")

    print(f"\nExcluded Places Outside Mainpat Tehsil ({len(excluded_points)} points):")
    print(f"{'ID':<6} | {'Place Name':<36} | {'Admin Tehsil':<20} | {'Dist':<8} | {'Elev (m)'}")
    print("-" * 84)
    for p in excluded_points:
        name_str = p['name_en'] or p['name']
        tehsil_str = p.get('admin_tehsil') or 'None'
        elev_str = f"{p['elevation_m']} m" if p['elevation_m'] is not None else "N/A"
        dist_str = f"{p['distance_km']} km"
        print(f"{p['id']:<6} | {name_str[:36]:<36} | {tehsil_str[:20]:<20} | {dist_str:<8} | {elev_str}")
    print("=" * 94 + "\n")


if __name__ == "__main__":
    main()
