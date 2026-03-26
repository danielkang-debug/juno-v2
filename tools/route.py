"""
tools/route.py — Juno v2 Geographic Computation Layer
Time-window TSP, OSRM distance matrix, Haversine fallback, Nominatim geocoding.
No Flask imports. No DB imports.
"""

import math
import sys
import time
import json
import urllib.request
import urllib.parse
from itertools import permutations


# ---------------------------------------------------------------------------
# Distance & Travel Time
# ---------------------------------------------------------------------------

def haversine(lat1, lon1, lat2, lon2):
    """Great-circle distance in km."""
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def travel_minutes(distance_km, avg_speed_kmh=30.0):
    """Estimate travel time in minutes at average urban speed."""
    return max(1, int((distance_km / avg_speed_kmh) * 60))


def time_to_minutes(time_str):
    """Convert 'HH:MM' to minutes since midnight."""
    if not time_str:
        return 0
    parts = time_str.split(":")
    return int(parts[0]) * 60 + int(parts[1])


def minutes_to_time(mins):
    """Convert minutes since midnight to 'HH:MM'."""
    h = int(mins) // 60
    m = int(mins) % 60
    return f"{h:02d}:{m:02d}"


# ---------------------------------------------------------------------------
# OSRM Distance Matrix
# ---------------------------------------------------------------------------

def get_distance_matrix(locations):
    """
    Get travel time matrix between all locations using OSRM table service.

    Args:
        locations: list of (lat, lon) tuples

    Returns:
        2D list of travel times in minutes, or None on failure.
        matrix[i][j] = minutes from location i to location j.
    """
    if len(locations) < 2:
        return None

    coords_str = ";".join(f"{lon},{lat}" for lat, lon in locations)
    url = f"http://router.project-osrm.org/table/v1/driving/{coords_str}"

    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Juno-Midwife-App/2.0"})
        with urllib.request.urlopen(req, timeout=15) as response:
            data = json.loads(response.read())

        if data.get("code") != "Ok" or not data.get("durations"):
            print(f"[osrm-table] Unexpected response: {data.get('code')}", file=sys.stderr)
            return None

        # Convert seconds to minutes
        return [
            [max(1, int(d / 60)) if d is not None else 999 for d in row]
            for row in data["durations"]
        ]

    except Exception as e:
        print(f"[osrm-table] Failed, using haversine fallback: {e}", file=sys.stderr)
        return None


def build_haversine_matrix(locations):
    """Build a fallback distance matrix using haversine distances."""
    n = len(locations)
    matrix = [[0] * n for _ in range(n)]
    for i in range(n):
        for j in range(n):
            if i != j:
                dist = haversine(locations[i][0], locations[i][1],
                                 locations[j][0], locations[j][1])
                matrix[i][j] = travel_minutes(dist)
    return matrix


def fetch_osrm_route(waypoints):
    """Get road-following geometry for map display."""
    if len(waypoints) < 2:
        return None

    coords_str = ";".join(f"{lon},{lat}" for lat, lon in waypoints)
    url = (
        f"http://router.project-osrm.org/route/v1/driving/{coords_str}"
        f"?overview=full&geometries=geojson&steps=false"
    )

    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Juno-Midwife-App/2.0"})
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read())

        if data.get("code") != "Ok" or not data.get("routes"):
            return None

        route = data["routes"][0]
        geometry = [[c[1], c[0]] for c in route["geometry"]["coordinates"]]

        legs = [
            {"distance_km": round(leg["distance"] / 1000, 2),
             "minutes": max(1, int(leg["duration"] / 60))}
            for leg in route.get("legs", [])
        ]

        return {
            "geometry": geometry,
            "legs": legs,
            "total_minutes": max(1, int(route["duration"] / 60)),
            "total_km": round(route["distance"] / 1000, 2),
        }
    except Exception as e:
        print(f"[osrm-route] Failed: {e}", file=sys.stderr)
        return None


# ---------------------------------------------------------------------------
# Time-Window TSP Optimizer
# ---------------------------------------------------------------------------

def _segment_appointments(appointments):
    """
    Split appointments into fixed anchors and flex groups between them.

    Returns list of segments: each segment is a dict with:
        - 'fixed_before': the fixed appointment that ends this segment (or None for first segment)
        - 'fixed_after': the fixed appointment that starts next segment (or None for last segment)
        - 'flex': list of flex appointments in this segment
    """
    fixed = sorted(
        [a for a in appointments if a.get("appointment_kind") == "fixed"],
        key=lambda a: a.get("time", "")
    )
    flex = [a for a in appointments if a.get("appointment_kind") != "fixed"]

    if not fixed:
        return [{"fixed_before": None, "fixed_after": None, "flex": flex}]

    segments = []

    # Segment before first fixed
    before_first = [f for f in flex if f.get("time", "") < fixed[0].get("time", "")]
    remaining_flex = [f for f in flex if f not in before_first]
    segments.append({"fixed_before": None, "fixed_after": fixed[0], "flex": before_first})

    # Segments between consecutive fixed
    for i in range(len(fixed) - 1):
        between = [f for f in remaining_flex
                   if fixed[i].get("time", "") <= f.get("time", "") < fixed[i + 1].get("time", "")]
        remaining_flex = [f for f in remaining_flex if f not in between]
        segments.append({"fixed_before": fixed[i], "fixed_after": fixed[i + 1], "flex": between})

    # Segment after last fixed
    segments.append({"fixed_before": fixed[-1], "fixed_after": None, "flex": remaining_flex})

    return segments


def _score_ordering(ordering, prev_loc_idx, distance_matrix, loc_indices):
    """Score a flex ordering by total travel time using distance matrix."""
    if not ordering:
        return 0
    total = distance_matrix[prev_loc_idx][loc_indices[ordering[0]["id"]]]
    for i in range(1, len(ordering)):
        total += distance_matrix[loc_indices[ordering[i - 1]["id"]]][loc_indices[ordering[i]["id"]]]
    return total


def _check_time_feasibility(ordering, start_time_min, prev_loc_idx, distance_matrix, loc_indices, buffer_minutes=0):
    """
    Check if an ordering is feasible given time windows.
    Returns (feasible, schedule) where schedule is list of {apt, eta_minutes}.
    """
    schedule = []
    current_time = start_time_min
    current_loc = prev_loc_idx

    for apt in ordering:
        apt_idx = loc_indices.get(apt["id"])
        if apt_idx is None:
            continue
        travel = distance_matrix[current_loc][apt_idx]
        eta = current_time + travel

        window_start = time_to_minutes(apt.get("window_start", apt.get("time", "")))
        window_end = time_to_minutes(apt.get("window_end", ""))

        # If we arrive early, wait until window opens
        if eta < window_start:
            eta = window_start

        # If window_end is set and we'd arrive after it closes, infeasible
        if window_end > 0 and eta > window_end:
            return False, []

        duration = int(apt.get("duration_minutes", 60))
        schedule.append({"apt": apt, "eta_minutes": eta})
        current_time = eta + duration + buffer_minutes
        current_loc = apt_idx

    return True, schedule


def optimize_route(appointments, start_location=None, start_time=None, buffer_minutes=15):
    """
    Time-window aware route optimization.

    Fixed appointments stay at their scheduled time.
    Flex appointments are optimally ordered within segments between fixed appointments.
    Uses OSRM distance matrix for accurate travel times (haversine fallback).

    Args:
        appointments: list of dicts with lat, lon, time, appointment_kind, window_start, window_end, etc.
        start_location: optional {lat, lon, address}
        start_time: optional "HH:MM" string — when the midwife leaves home. If None, backwards-calculate from earliest appointment.
        buffer_minutes: int — minutes of buffer after each appointment (wrap-up, get on bike, park). Default 15.

    Returns:
        {
            ordered_appointments: [...],
            legs: [{from_id, to_id, distance_km, minutes}],
            total_travel_minutes: int,
            etas: {appointment_id: "HH:MM", ...},
            geocoded_count: int,
            skipped_count: int,
            start_location: dict | None,
            road_geometry: [[lat,lon], ...] | None,
            buffer_minutes: int,
            departure_time: "HH:MM"
        }
    """
    geocoded = [a for a in appointments if a.get("lat") is not None and a.get("lon") is not None]
    skipped = [a for a in appointments if a.get("lat") is None or a.get("lon") is None]

    if len(geocoded) < 2:
        ordered = sorted(appointments, key=lambda a: a.get("time", ""))
        etas = {}
        for a in ordered:
            etas[a["id"]] = a.get("time", "")
        return {
            "ordered_appointments": ordered,
            "legs": [],
            "total_travel_minutes": 0,
            "etas": etas,
            "geocoded_count": len(geocoded),
            "skipped_count": len(skipped),
            "start_location": start_location,
            "road_geometry": None,
        }

    # Build location list and index map
    has_home = start_location and start_location.get("lat") is not None
    locations = []
    loc_indices = {}

    if has_home:
        locations.append((start_location["lat"], start_location["lon"]))
        loc_indices["home"] = 0

    for a in geocoded:
        loc_indices[a["id"]] = len(locations)
        locations.append((a["lat"], a["lon"]))

    # Get distance matrix (OSRM preferred, haversine fallback)
    matrix = get_distance_matrix(locations)
    if matrix is None:
        matrix = build_haversine_matrix(locations)

    # Segment appointments
    segments = _segment_appointments(geocoded)

    # Optimize each segment
    ordered_geocoded = []
    etas = {}

    # Track time and location through segments
    if has_home:
        current_loc_idx = loc_indices["home"]
    else:
        first_apt = geocoded[0] if geocoded else None
        current_loc_idx = loc_indices[first_apt["id"]] if first_apt else 0

    # Determine start time
    if start_time:
        current_time = time_to_minutes(start_time)
    else:
        # Legacy fallback: work backwards from earliest appointment
        earliest_time = min(time_to_minutes(a.get("time", "08:00")) for a in geocoded)
        if has_home and geocoded:
            first_travel = matrix[loc_indices["home"]][loc_indices[geocoded[0]["id"]]]
            current_time = earliest_time - first_travel
        else:
            current_time = earliest_time
    departure_time = minutes_to_time(current_time)

    for seg in segments:
        # Add the fixed_before anchor (already placed by previous segment, skip first)
        # Process flex appointments in this segment
        flex = seg["flex"]

        if len(flex) == 0:
            pass
        elif len(flex) == 1:
            apt = flex[0]
            apt_idx = loc_indices.get(apt["id"])
            if apt_idx is not None:
                travel = matrix[current_loc_idx][apt_idx]
                eta = current_time + travel
                window_start = time_to_minutes(apt.get("window_start", apt.get("time", "")))
                if eta < window_start:
                    eta = window_start
                etas[apt["id"]] = minutes_to_time(eta)
                ordered_geocoded.append(apt)
                current_time = eta + int(apt.get("duration_minutes", 60)) + buffer_minutes
                current_loc_idx = apt_idx
        else:
            # Try all permutations (up to 7! = 5040)
            best_ordering = None
            best_score = float("inf")

            max_perms = 5040
            flex_perms = list(permutations(flex))
            if len(flex_perms) > max_perms:
                flex_perms = flex_perms[:max_perms]

            for perm in flex_perms:
                perm_list = list(perm)
                feasible, schedule = _check_time_feasibility(
                    perm_list, current_time, current_loc_idx, matrix, loc_indices, buffer_minutes
                )
                if feasible:
                    score = _score_ordering(perm_list, current_loc_idx, matrix, loc_indices)
                    if score < best_score:
                        best_score = score
                        best_ordering = perm_list

            if best_ordering is None:
                # No feasible ordering found — use travel-time-sorted as fallback
                best_ordering = sorted(flex, key=lambda a: matrix[current_loc_idx][loc_indices.get(a["id"], 0)])

            # Apply the best ordering
            for apt in best_ordering:
                apt_idx = loc_indices.get(apt["id"])
                if apt_idx is None:
                    continue
                travel = matrix[current_loc_idx][apt_idx]
                eta = current_time + travel
                window_start = time_to_minutes(apt.get("window_start", apt.get("time", "")))
                if eta < window_start:
                    eta = window_start
                etas[apt["id"]] = minutes_to_time(eta)
                ordered_geocoded.append(apt)
                current_time = eta + int(apt.get("duration_minutes", 60)) + buffer_minutes
                current_loc_idx = apt_idx

        # Add the fixed_after anchor
        fixed_after = seg["fixed_after"]
        if fixed_after and fixed_after not in ordered_geocoded:
            apt_idx = loc_indices.get(fixed_after["id"])
            if apt_idx is not None:
                fixed_time = time_to_minutes(fixed_after.get("time", ""))
                etas[fixed_after["id"]] = fixed_after.get("time", "")
                ordered_geocoded.append(fixed_after)
                current_time = fixed_time + int(fixed_after.get("duration_minutes", 60)) + buffer_minutes
                current_loc_idx = apt_idx

    return compute_route_details(
        ordered_geocoded, skipped, etas,
        start_location, departure_time, buffer_minutes,
    )


# ---------------------------------------------------------------------------
# Route Details (shared by optimize + recalculate)
# ---------------------------------------------------------------------------

def compute_route_details(ordered_geocoded, skipped, etas,
                          start_location=None, departure_time="08:00",
                          buffer_minutes=15):
    """
    Compute legs, distances, road geometry, and ETAs for an already-ordered
    list of appointments. Used by both optimize_route() and recalculate_route().

    Args:
        ordered_geocoded: list of geocoded appointment dicts, in visit order
        skipped: list of appointment dicts that could not be geocoded
        etas: dict mapping appointment_id -> "HH:MM" (pre-computed by optimizer,
              or empty dict if recalculating from scratch)
        start_location: optional {lat, lon, address}
        departure_time: "HH:MM" string
        buffer_minutes: int

    Returns:
        Full route result dict (same shape as optimize_route output).
    """
    has_home = start_location and start_location.get("lat") is not None

    # Build location list and index map
    locations = []
    loc_indices = {}

    if has_home:
        locations.append((start_location["lat"], start_location["lon"]))
        loc_indices["home"] = 0

    for a in ordered_geocoded:
        loc_indices[a["id"]] = len(locations)
        locations.append((a["lat"], a["lon"]))

    # Get distance matrix
    matrix = get_distance_matrix(locations) if len(locations) >= 2 else None
    if matrix is None and len(locations) >= 2:
        matrix = build_haversine_matrix(locations)

    # If no pre-computed ETAs, compute them by walking the ordered list
    if not etas and matrix:
        current_time = time_to_minutes(departure_time)
        current_loc = loc_indices.get("home", loc_indices.get(ordered_geocoded[0]["id"], 0)) if ordered_geocoded else 0

        for apt in ordered_geocoded:
            apt_idx = loc_indices.get(apt["id"])
            if apt_idx is None:
                continue
            travel = matrix[current_loc][apt_idx]
            eta = current_time + travel
            window_start = time_to_minutes(apt.get("window_start", apt.get("time", "")))
            if eta < window_start:
                eta = window_start
            etas[apt["id"]] = minutes_to_time(eta)
            current_time = eta + int(apt.get("duration_minutes", 60)) + buffer_minutes
            current_loc = apt_idx

    # Build legs
    legs = []
    total_minutes = 0

    if matrix:
        prev_loc = loc_indices.get("home") if has_home else None

        for apt in ordered_geocoded:
            apt_idx = loc_indices.get(apt["id"])
            if apt_idx is None:
                continue
            if prev_loc is not None:
                mins = matrix[prev_loc][apt_idx]
                dist = haversine(locations[prev_loc][0], locations[prev_loc][1],
                                 locations[apt_idx][0], locations[apt_idx][1])
                from_id = "home" if prev_loc == loc_indices.get("home") else \
                    [k for k, v in loc_indices.items() if v == prev_loc and k != "home"][0] if prev_loc != loc_indices.get("home") else "home"
                legs.append({
                    "from_id": from_id,
                    "to_id": apt["id"],
                    "distance_km": round(dist, 2),
                    "minutes": mins,
                })
                total_minutes += mins
            prev_loc = apt_idx

        # Return-home leg
        if has_home and ordered_geocoded:
            last_idx = loc_indices[ordered_geocoded[-1]["id"]]
            home_idx = loc_indices["home"]
            mins = matrix[last_idx][home_idx]
            dist = haversine(locations[last_idx][0], locations[last_idx][1],
                             locations[home_idx][0], locations[home_idx][1])
            legs.append({
                "from_id": ordered_geocoded[-1]["id"],
                "to_id": "home",
                "distance_km": round(dist, 2),
                "minutes": mins,
            })
            total_minutes += mins

    # Get road geometry for map display
    osrm_waypoints = []
    if has_home:
        osrm_waypoints.append((start_location["lat"], start_location["lon"]))
    osrm_waypoints.extend([(a["lat"], a["lon"]) for a in ordered_geocoded])
    if has_home:
        osrm_waypoints.append((start_location["lat"], start_location["lon"]))

    road_geometry = None
    if len(osrm_waypoints) >= 2:
        osrm = fetch_osrm_route(osrm_waypoints)
        if osrm:
            road_geometry = osrm["geometry"]
            total_minutes = osrm["total_minutes"]
            for i, leg_data in enumerate(osrm["legs"]):
                if i < len(legs):
                    legs[i]["distance_km"] = leg_data["distance_km"]
                    legs[i]["minutes"] = leg_data["minutes"]

    # Append skipped at end
    skipped_sorted = sorted(skipped, key=lambda a: a.get("time", ""))
    for a in skipped_sorted:
        etas[a["id"]] = a.get("time", "")
    ordered_all = ordered_geocoded + skipped_sorted

    total_distance_km = round(sum(leg["distance_km"] for leg in legs), 1)

    return {
        "ordered_appointments": ordered_all,
        "legs": legs,
        "total_travel_minutes": total_minutes,
        "total_distance_km": total_distance_km,
        "etas": etas,
        "geocoded_count": len(ordered_geocoded),
        "skipped_count": len(skipped),
        "start_location": start_location,
        "road_geometry": road_geometry,
        "buffer_minutes": buffer_minutes,
        "departure_time": departure_time,
    }


def recalculate_route(appointments, ordered_ids, start_location=None,
                      departure_time="08:00", buffer_minutes=15):
    """
    Recalculate ETAs, legs, and geometry for a manually reordered appointment list.

    Args:
        appointments: all appointment dicts for the day
        ordered_ids: list of appointment IDs in the desired visit order
        start_location: optional {lat, lon, address}
        departure_time: "HH:MM"
        buffer_minutes: int

    Returns:
        Same shape as optimize_route() output.
    """
    apt_map = {a["id"]: a for a in appointments}
    geocoded = []
    for aid in ordered_ids:
        apt = apt_map.pop(aid, None)
        if apt and apt.get("lat") is not None and apt.get("lon") is not None:
            geocoded.append(apt)

    # Any remaining appointments not in ordered_ids (shouldn't happen, but safe)
    for apt in apt_map.values():
        if apt.get("lat") is not None and apt.get("lon") is not None:
            geocoded.append(apt)

    skipped = [a for a in appointments if a.get("lat") is None or a.get("lon") is None]

    # ETAs will be computed fresh by compute_route_details
    return compute_route_details(
        geocoded, skipped, {},
        start_location, departure_time, buffer_minutes,
    )


# ---------------------------------------------------------------------------
# Geocoding
# ---------------------------------------------------------------------------

def geocode_address(address):
    """Geocode via Nominatim. Rate limited to 1 req/sec. Returns (lat, lon) or (None, None)."""
    try:
        params = urllib.parse.urlencode({"q": address, "format": "json", "limit": 1})
        url = f"https://nominatim.openstreetmap.org/search?{params}"
        req = urllib.request.Request(url, headers={"User-Agent": "Juno-Midwife-App/2.0"})
        with urllib.request.urlopen(req, timeout=10) as response:
            results = json.loads(response.read())
        if results:
            return float(results[0]["lat"]), float(results[0]["lon"])
        print(f"[geocode] No results for: {address}", file=sys.stderr)
        return None, None
    except Exception as e:
        print(f"[geocode] Error for '{address}': {e}", file=sys.stderr)
        return None, None
    finally:
        time.sleep(1.0)
