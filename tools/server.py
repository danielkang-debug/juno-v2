"""
tools/server.py — Juno v2 Flask API Server
Run: python3 tools/server.py
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from flask import Flask, jsonify, request, send_from_directory, session
import tools.db as db
import tools.route as route_module

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

app = Flask(__name__)
app.secret_key = os.environ.get('JUNO_SECRET_KEY', 'dev-secret-key-change-in-production')
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'

_initialized = False


@app.before_request
def ensure_initialized():
    global _initialized
    if not _initialized:
        _initialized = True
        db.init_db()
        print("[juno] Database initialized.")


@app.before_request
def require_auth():
    path = request.path
    if path.startswith('/api/auth/'):
        return
    if not path.startswith('/api/'):
        return
    if 'user_id' not in session:
        return jsonify({'error': 'Authentication required'}), 401


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

@app.route("/api/auth/register", methods=["POST"])
def auth_register():
    data = request.get_json() or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    name = (data.get("name") or "").strip()

    if not email or not password or not name:
        return jsonify({"error": "email, password, and name are required"}), 400
    if len(password) < 8:
        return jsonify({"error": "Password must be at least 8 characters"}), 400
    if db.get_user_by_email(email):
        return jsonify({"error": "An account with this email already exists"}), 409

    user = db.create_user(email, password, name)
    db.seed_mock_data(user['id'])
    session['user_id'] = user['id']
    return jsonify(user), 201


@app.route("/api/auth/login", methods=["POST"])
def auth_login():
    data = request.get_json() or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    user = db.get_user_by_email(email)
    if not user or not db.verify_password(user['password_hash'], password):
        return jsonify({"error": "Invalid email or password"}), 401

    session['user_id'] = user['id']
    return jsonify({
        "id": user['id'], "email": user['email'], "name": user['name'],
        "home_address": user.get('home_address', ''),
        "home_lat": user.get('home_lat'), "home_lon": user.get('home_lon'),
        "created_at": user['created_at']
    })


@app.route("/api/auth/logout", methods=["POST"])
def auth_logout():
    session.clear()
    return jsonify({"ok": True})


@app.route("/api/auth/me", methods=["GET"])
def auth_me():
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({"error": "Not logged in"}), 401
    user = db.get_user_by_id(user_id)
    if not user:
        session.clear()
        return jsonify({"error": "User not found"}), 401
    return jsonify(user)


@app.route("/api/auth/me", methods=["PUT"])
def update_me():
    user_id = session['user_id']
    data = request.get_json() or {}
    user = db.update_user(user_id, data)
    if not user:
        return jsonify({"error": "User not found"}), 404

    # Geocode home address if changed
    if "home_address" in data and data["home_address"]:
        lat, lon = route_module.geocode_address(data["home_address"])
        if lat is not None:
            db.update_user(user_id, {"home_lat": lat, "home_lon": lon})
            user["home_lat"] = lat
            user["home_lon"] = lon

    return jsonify(user)


# ---------------------------------------------------------------------------
# Patients
# ---------------------------------------------------------------------------

@app.route("/api/patients", methods=["GET"])
def get_patients():
    user_id = session['user_id']
    include_discharged = request.args.get("include_discharged") == "true"
    return jsonify(db.list_patients(user_id, include_discharged=include_discharged))


@app.route("/api/patients", methods=["POST"])
def create_patient():
    user_id = session['user_id']
    data = request.get_json() or {}
    if not data.get("name") or not data.get("address"):
        return jsonify({"error": "name and address are required"}), 400

    patient = db.create_patient(user_id, data)
    lat_in = data.get("lat")
    lon_in = data.get("lon")
    if lat_in is not None and lon_in is not None:
        lat, lon = float(lat_in), float(lon_in)
        db.update_patient_coords(patient["id"], lat, lon)
        patient["lat"] = lat
        patient["lon"] = lon
    else:
        lat, lon = route_module.geocode_address(patient["address"])
        if lat is not None:
            db.update_patient_coords(patient["id"], lat, lon)
            patient["lat"] = lat
            patient["lon"] = lon

    return jsonify(patient), 201


@app.route("/api/patients/<patient_id>", methods=["PUT"])
def update_patient(patient_id):
    user_id = session['user_id']
    data = request.get_json() or {}
    existing = db.get_patient(user_id, patient_id)
    if not existing:
        return jsonify({"error": "Patient not found"}), 404

    address_changed = "address" in data and data["address"] != existing["address"]
    patient = db.update_patient(user_id, patient_id, data)

    if address_changed:
        lat_in = data.get("lat")
        lon_in = data.get("lon")
        if lat_in is not None and lon_in is not None:
            lat, lon = float(lat_in), float(lon_in)
        else:
            lat, lon = route_module.geocode_address(patient["address"])
        db.update_patient_coords(patient_id, lat, lon)
        patient["lat"] = lat
        patient["lon"] = lon

    return jsonify(patient)


@app.route("/api/patients/<patient_id>", methods=["DELETE"])
def delete_patient(patient_id):
    user_id = session['user_id']
    if not db.delete_patient(user_id, patient_id):
        return jsonify({"error": "Patient not found"}), 404
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Appointments
# ---------------------------------------------------------------------------

@app.route("/api/appointments", methods=["GET"])
def get_appointments():
    user_id = session['user_id']
    date_str = request.args.get("date")
    month_str = request.args.get("month")

    from_str = request.args.get("from")
    days_str = request.args.get("days")

    if date_str:
        return jsonify(db.list_appointments_by_date(user_id, date_str))
    elif month_str:
        return jsonify(db.list_appointments_by_month(user_id, month_str))
    elif from_str and days_str:
        from datetime import date, timedelta
        try:
            start = date.fromisoformat(from_str)
            days = int(days_str)
        except (ValueError, TypeError):
            return jsonify({"error": "Invalid from or days parameter"}), 400
        all_apts = []
        for i in range(days):
            d = (start + timedelta(days=i)).isoformat()
            all_apts.extend(db.list_appointments_by_date(user_id, d))
        return jsonify(all_apts)
    else:
        return jsonify({"error": "Provide ?date=YYYY-MM-DD, ?month=YYYY-MM, or ?from=YYYY-MM-DD&days=N"}), 400


@app.route("/api/appointments", methods=["POST"])
def create_appointment():
    user_id = session['user_id']
    data = request.get_json() or {}
    for field in ["patient_id", "date", "time"]:
        if not data.get(field):
            return jsonify({"error": f"{field} is required"}), 400

    apt = db.create_appointment(user_id, data)
    if not apt:
        return jsonify({"error": "Patient not found"}), 404
    return jsonify(apt), 201


@app.route("/api/appointments/<apt_id>", methods=["PUT"])
def update_appointment(apt_id):
    user_id = session['user_id']
    data = request.get_json() or {}
    apt = db.update_appointment(user_id, apt_id, data)
    if not apt:
        return jsonify({"error": "Appointment not found"}), 404
    return jsonify(apt)


@app.route("/api/appointments/<apt_id>", methods=["DELETE"])
def cancel_appointment(apt_id):
    user_id = session['user_id']
    if not db.cancel_appointment(user_id, apt_id):
        return jsonify({"error": "Appointment not found"}), 404
    return jsonify({"ok": True})


@app.route("/api/appointments/import", methods=["POST"])
def import_appointments():
    user_id = session['user_id']
    data = request.get_json() or {}
    items = data.get("items", [])
    if not items:
        return jsonify({"error": "items array is required"}), 400

    result = db.bulk_create_appointments(user_id, items)

    # Geocode any new patients that were created
    patients = db.list_patients(user_id)
    for p in patients:
        if p.get("lat") is None and p.get("address"):
            lat, lon = route_module.geocode_address(p["address"])
            if lat is not None:
                db.update_patient_coords(p["id"], lat, lon)

    return jsonify(result), 201


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/api/geocode", methods=["GET"])
def geocode_address():
    address = request.args.get("address", "").strip()
    if not address:
        return jsonify({"error": "address is required"}), 400
    lat, lon = route_module.geocode_address(address)
    if lat is None:
        return jsonify({"error": "Could not geocode address"}), 422
    return jsonify({"lat": lat, "lon": lon, "address": address})


@app.route("/api/routes/optimize", methods=["POST"])
def optimize_route():
    data = request.get_json() or {}
    date_str = data.get("date")
    if not date_str:
        return jsonify({"error": "date is required"}), 400

    user_id = session['user_id']

    # Use user's home location from DB
    user = db.get_user_by_id(user_id)
    start_location = None
    if user and user.get("home_lat") is not None:
        start_location = {
            "lat": user["home_lat"],
            "lon": user["home_lon"],
            "address": user.get("home_address", ""),
        }

    # Allow override from request
    if data.get("start_lat") is not None and data.get("start_lon") is not None:
        start_location = {
            "lat": float(data["start_lat"]),
            "lon": float(data["start_lon"]),
            "address": data.get("start_address", ""),
        }

    start_time = data.get("start_time")  # "HH:MM" or None
    buffer_minutes = int(user.get("buffer_minutes", 15)) if user else 15

    appointments = db.list_appointments_by_date(user_id, date_str)
    result = route_module.optimize_route(
        appointments,
        start_location=start_location,
        start_time=start_time,
        buffer_minutes=buffer_minutes,
    )

    ordered_ids = [a["id"] for a in result["ordered_appointments"]]
    db.save_route(user_id, date_str, ordered_ids, result["total_travel_minutes"])

    result["date"] = date_str
    return jsonify(result)


@app.route("/api/routes/recalculate", methods=["POST"])
def recalculate_route():
    data = request.get_json() or {}
    date_str = data.get("date")
    ordered_ids = data.get("ordered_appointment_ids")
    if not date_str or not ordered_ids:
        return jsonify({"error": "date and ordered_appointment_ids are required"}), 400

    user_id = session['user_id']

    user = db.get_user_by_id(user_id)
    start_location = None
    if user and user.get("home_lat") is not None:
        start_location = {
            "lat": user["home_lat"],
            "lon": user["home_lon"],
            "address": user.get("home_address", ""),
        }

    departure_time = data.get("departure_time", "08:00")
    buffer_minutes = int(user.get("buffer_minutes", 15)) if user else 15

    appointments = db.list_appointments_by_date(user_id, date_str)
    result = route_module.recalculate_route(
        appointments,
        ordered_ids,
        start_location=start_location,
        departure_time=departure_time,
        buffer_minutes=buffer_minutes,
    )

    new_ordered_ids = [a["id"] for a in result["ordered_appointments"]]
    db.save_route(user_id, date_str, new_ordered_ids, result["total_travel_minutes"])

    return jsonify(result)


@app.route("/api/routes/<date_str>", methods=["GET"])
def get_route(date_str):
    user_id = session['user_id']
    saved = db.get_route(user_id, date_str)
    if not saved:
        return jsonify({"error": "No saved route for this date"}), 404
    return jsonify(saved)


# ---------------------------------------------------------------------------
# Static Files
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return send_from_directory(ROOT_DIR, "index.html")


@app.route("/<path:filename>")
def static_files(filename):
    if filename.startswith("tools/"):
        return jsonify({"error": "Not found"}), 404
    response = send_from_directory(ROOT_DIR, filename)
    if filename.endswith(('.js', '.css', '.html')):
        response.headers['Cache-Control'] = 'no-store'
    return response


if __name__ == "__main__":
    app.run(debug=True, port=5003)
