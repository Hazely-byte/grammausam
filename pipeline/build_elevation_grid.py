#!/usr/bin/env python3
"""
SIH26074 - Elevation Grid Builder for Mainpat Isotherm Zones
Generates a ~1 km resolution digital elevation grid over the Mainpat pilot area
(bounding box of 37 panchayats + 3 km padding) using Open-Meteo Elevation API.
Saves to app/data/elevation_grid.json.
Uses persistent caching in pipeline/cache/elevation_grid_cache.json with 429 backoff.
"""

import json
import math
import sys
import time
from pathlib import Path
import requests

ROOT_DIR = Path(__file__).resolve().parent.parent
PANCHAYATS_JSON_PATH = ROOT_DIR / "app" / "data" / "panchayats.json"
OUTPUT_GRID_PATH = ROOT_DIR / "app" / "data" / "elevation_grid.json"
CACHE_PATH = ROOT_DIR / "pipeline" / "cache" / "elevation_grid_cache.json"

ELEVATION_API_URL = "https://api.open-meteo.com/v1/elevation"
USER_AGENT = "SIH26074-PanchayatWeatherPilot/1.0 (contact: student-project@sih.gov.in)"


def load_cache() -> dict:
    if CACHE_PATH.exists():
        try:
            with open(CACHE_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}


def save_cache(cache: dict):
    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(CACHE_PATH, "w", encoding="utf-8") as f:
        json.dump(cache, f, separators=(",", ":"))


def calculate_grid_bounds_and_points(panchayats: list) -> tuple[dict, int, int, list[tuple[float, float]]]:
    """
    Computes bounding box with 3 km padding and generates ~1 km grid coordinates.
    Returns (bounds_dict, rows, cols, list_of_lat_lon_tuples).
    """
    lats = [p["lat"] for p in panchayats]
    lons = [p["lon"] for p in panchayats]

    min_lat, max_lat = min(lats), max(lats)
    min_lon, max_lon = min(lons), max(lons)
    mid_lat = (min_lat + max_lat) / 2.0

    # 1 degree of latitude is approximately 111.132 km
    deg_lat_per_km = 1.0 / 111.132
    # 1 degree of longitude at mid_lat
    deg_lon_per_km = 1.0 / (111.320 * math.cos(math.radians(mid_lat)))

    padding_km = 3.0
    pad_lat = padding_km * deg_lat_per_km
    pad_lon = padding_km * deg_lon_per_km

    south = round(min_lat - pad_lat, 5)
    north = round(max_lat + pad_lat, 5)
    west = round(min_lon - pad_lon, 5)
    east = round(max_lon + pad_lon, 5)

    lat_span = north - south
    lon_span = east - west

    # Spacing about 1 km
    rows = int(round(lat_span / deg_lat_per_km)) + 1
    cols = int(round(lon_span / deg_lon_per_km)) + 1

    d_lat = lat_span / (rows - 1)
    d_lon = lon_span / (cols - 1)

    points = []
    # Row 0 = North down to South (standard raster coordinate space)
    for r in range(rows):
        lat = round(north - r * d_lat, 5)
        for c in range(cols):
            lon = round(west + c * d_lon, 5)
            points.append((lat, lon))

    bounds = {
        "south": south,
        "west": west,
        "north": north,
        "east": east,
    }

    return bounds, rows, cols, points


def fetch_grid_elevations(points: list[tuple[float, float]], chunk_size: int = 100) -> list[int]:
    """
    Fetches elevation for each grid point from Open-Meteo Elevation API in batches up to 100.
    Uses cache and respectful rate-limiting (1.5s delay, exponential backoff on 429).
    Returns flat list of elevations rounded to whole metres.
    """
    headers = {"User-Agent": USER_AGENT}
    cache = load_cache()
    print(f"Loaded {len(cache)} cached elevations from {CACHE_PATH.name}.")

    # Identify points needing fetching
    needed_points = []
    for pt in points:
        key = f"{pt[0]:.5f},{pt[1]:.5f}"
        if key not in cache:
            needed_points.append(pt)

    print(f"Total grid points: {len(points)}. Points to fetch from API: {len(needed_points)}.")

    if needed_points:
        total_chunks = (len(needed_points) + chunk_size - 1) // chunk_size
        print(f"-> Fetching in {total_chunks} chunks of up to {chunk_size}...")

        for idx in range(0, len(needed_points), chunk_size):
            chunk = needed_points[idx : idx + chunk_size]
            chunk_num = (idx // chunk_size) + 1
            lats_str = ",".join(f"{pt[0]:.5f}" for pt in chunk)
            lons_str = ",".join(f"{pt[1]:.5f}" for pt in chunk)
            url = f"{ELEVATION_API_URL}?latitude={lats_str}&longitude={lons_str}"

            success = False
            for attempt in range(1, 6):
                try:
                    r = requests.get(url, headers=headers, timeout=30)
                    if r.status_code == 429:
                        wait_sec = 6 * attempt
                        print(f"   [429 Rate Limit] Chunk {chunk_num}. Waiting {wait_sec}s before retry...", file=sys.stderr)
                        time.sleep(wait_sec)
                        continue

                    r.raise_for_status()
                    data = r.json()
                    elev_list = data.get("elevation", [])
                    if len(elev_list) != len(chunk):
                        raise ValueError(f"Expected {len(chunk)} elevations, received {len(elev_list)}")

                    for pt, val in zip(chunk, elev_list):
                        key = f"{pt[0]:.5f},{pt[1]:.5f}"
                        cache[key] = int(round(val)) if val is not None else 1000

                    save_cache(cache)
                    success = True
                    print(f"   Chunk {chunk_num}/{total_chunks} fetched ({len(chunk)} points).")
                    break
                except Exception as e:
                    wait_sec = 4 * attempt
                    print(f"   [WARN] Chunk {chunk_num} attempt {attempt} failed ({e}). Retrying in {wait_sec}s...", file=sys.stderr)
                    time.sleep(wait_sec)

            if not success:
                print(f"   [ERROR] Failed chunk {chunk_num} after 5 attempts. Exiting to avoid corrupted data.", file=sys.stderr)
                sys.exit(1)

            # Polite pause between requests to stay well within limits
            time.sleep(1.5)

    # Build full ordered elevation list
    ordered_elevations = []
    for pt in points:
        key = f"{pt[0]:.5f},{pt[1]:.5f}"
        ordered_elevations.append(cache.get(key, 1000))

    return ordered_elevations


def main():
    print("====================================================================")
    print("     SIH26074 - BUILD DIGITAL ELEVATION GRID FOR ISOTHERMS")
    print("====================================================================")

    if not PANCHAYATS_JSON_PATH.exists():
        print(f"[FATAL] Panchayats file not found at: {PANCHAYATS_JSON_PATH}", file=sys.stderr)
        sys.exit(1)

    with open(PANCHAYATS_JSON_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)

    panchayats = data.get("panchayats", [])
    if not panchayats:
        print("[FATAL] No panchayats found in JSON file.", file=sys.stderr)
        sys.exit(1)

    bounds, rows, cols, points = calculate_grid_bounds_and_points(panchayats)
    print(f"Bounding Box with 3 km padding:")
    print(f"  South: {bounds['south']}, North: {bounds['north']} (lat span: {bounds['north'] - bounds['south']:.5f})")
    print(f"  West:  {bounds['west']}, East:  {bounds['east']} (lon span: {bounds['east'] - bounds['west']:.5f})")
    print(f"Grid Dimensions: {rows} rows x {cols} cols = {len(points)} total points (~1 km spacing)\n")

    elevations = fetch_grid_elevations(points, chunk_size=100)

    if len(elevations) != len(points):
        print(f"[FATAL] Elevation count ({len(elevations)}) does not match point count ({len(points)})", file=sys.stderr)
        sys.exit(1)

    min_elev = min(elevations)
    max_elev = max(elevations)

    output_data = {
        "bounds": bounds,
        "rows": rows,
        "cols": cols,
        "elevations": elevations
    }

    OUTPUT_GRID_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_GRID_PATH, "w", encoding="utf-8") as f:
        json.dump(output_data, f, separators=(",", ":"))

    file_size_bytes = OUTPUT_GRID_PATH.stat().st_size
    print("\n--------------------------------------------------------------------")
    print(f"-> SUCCESS: Saved elevation grid to: {OUTPUT_GRID_PATH}")
    print(f"-> Grid Dimensions: {rows} rows x {cols} cols ({len(elevations)} cells)")
    print(f"-> Elevation Range: Min {min_elev} m, Max {max_elev} m (spread: {max_elev - min_elev} m)")
    print(f"-> File Size: {file_size_bytes / 1024:.2f} KB")
    print("--------------------------------------------------------------------")


if __name__ == "__main__":
    main()
