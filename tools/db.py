"""
tools/db.py — Juno v2 Data Layer
All SQL lives here. No Flask imports.
"""

import sqlite3
import uuid
import json
from datetime import datetime, date, timedelta
from werkzeug.security import generate_password_hash, check_password_hash

import os
DB_PATH = os.environ.get("DB_PATH", "juno.db")


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    with get_conn() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                name TEXT NOT NULL,
                home_address TEXT DEFAULT '',
                home_lat REAL,
                home_lon REAL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS patients (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id),
                name TEXT NOT NULL,
                address TEXT NOT NULL,
                lat REAL,
                lon REAL,
                phone TEXT DEFAULT '',
                gestational_age_weeks INTEGER DEFAULT 0,
                gestational_age_days INTEGER DEFAULT 0,
                due_date TEXT DEFAULT '',
                notes TEXT DEFAULT '',
                status TEXT DEFAULT 'active',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS appointments (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id),
                patient_id TEXT NOT NULL REFERENCES patients(id),
                date TEXT NOT NULL,
                time TEXT NOT NULL,
                visit_type TEXT DEFAULT 'prenatal',
                appointment_kind TEXT DEFAULT 'fixed',
                duration_minutes INTEGER DEFAULT 60,
                window_start TEXT DEFAULT '',
                window_end TEXT DEFAULT '',
                notes TEXT DEFAULT '',
                status TEXT DEFAULT 'scheduled',
                completed_at TEXT DEFAULT '',
                completion_notes TEXT DEFAULT '',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS routes (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id),
                date TEXT NOT NULL,
                ordered_appointment_ids TEXT NOT NULL,
                estimated_travel_minutes INTEGER DEFAULT 0,
                saved_at TEXT NOT NULL,
                UNIQUE(user_id, date)
            );
        """)
        # Migrations for existing databases
        try:
            conn.execute("ALTER TABLE users ADD COLUMN buffer_minutes INTEGER DEFAULT 15")
        except sqlite3.OperationalError:
            pass  # Column already exists


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------

def create_user(email, password, name):
    user_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()
    pw_hash = generate_password_hash(password, method='pbkdf2:sha256')
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO users (id, email, password_hash, name, created_at) VALUES (?, ?, ?, ?, ?)",
            (user_id, email.lower().strip(), pw_hash, name.strip(), now)
        )
    return get_user_by_id(user_id)


def get_user_by_email(email):
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE email = ?", (email.lower().strip(),)
        ).fetchone()
        return dict(row) if row else None


def get_user_by_id(user_id):
    with get_conn() as conn:
        row = conn.execute(
            "SELECT id, email, name, home_address, home_lat, home_lon, buffer_minutes, created_at FROM users WHERE id = ?",
            (user_id,)
        ).fetchone()
        return dict(row) if row else None


def update_user(user_id, data):
    fields = ["name", "home_address", "home_lat", "home_lon", "buffer_minutes"]
    updates = {f: data[f] for f in fields if f in data}
    if not updates:
        return get_user_by_id(user_id)
    with get_conn() as conn:
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        conn.execute(f"UPDATE users SET {set_clause} WHERE id = ?",
                     list(updates.values()) + [user_id])
    return get_user_by_id(user_id)


def verify_password(stored_hash, password):
    return check_password_hash(stored_hash, password)


# ---------------------------------------------------------------------------
# Patients
# ---------------------------------------------------------------------------

def list_patients(user_id, include_discharged=False):
    with get_conn() as conn:
        if include_discharged:
            rows = conn.execute(
                "SELECT * FROM patients WHERE user_id = ? ORDER BY name", (user_id,)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM patients WHERE user_id = ? AND status != 'discharged' ORDER BY name",
                (user_id,)
            ).fetchall()
        return [dict(r) for r in rows]


def get_patient(user_id, patient_id):
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM patients WHERE id = ? AND user_id = ?", (patient_id, user_id)
        ).fetchone()
        return dict(row) if row else None


def create_patient(user_id, data):
    patient_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        conn.execute("""
            INSERT INTO patients (id, user_id, name, address, phone,
                gestational_age_weeks, gestational_age_days,
                due_date, notes, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            patient_id, user_id,
            data.get("name", ""),
            data.get("address", ""),
            data.get("phone", ""),
            int(data.get("gestational_age_weeks", 0)),
            int(data.get("gestational_age_days", 0)),
            data.get("due_date", ""),
            data.get("notes", ""),
            data.get("status", "active"),
            now,
        ))
    return get_patient(user_id, patient_id)


def update_patient(user_id, patient_id, data):
    fields = ["name", "address", "phone", "gestational_age_weeks",
              "gestational_age_days", "due_date", "notes", "status"]
    updates = {f: data[f] for f in fields if f in data}
    with get_conn() as conn:
        if not conn.execute("SELECT id FROM patients WHERE id = ? AND user_id = ?",
                            (patient_id, user_id)).fetchone():
            return None
        if updates:
            set_clause = ", ".join(f"{k} = ?" for k in updates)
            conn.execute(f"UPDATE patients SET {set_clause} WHERE id = ? AND user_id = ?",
                         list(updates.values()) + [patient_id, user_id])
    return get_patient(user_id, patient_id)


def update_patient_coords(patient_id, lat, lon):
    with get_conn() as conn:
        conn.execute("UPDATE patients SET lat = ?, lon = ? WHERE id = ?", (lat, lon, patient_id))


def delete_patient(user_id, patient_id):
    patient = get_patient(user_id, patient_id)
    if not patient:
        return False
    with get_conn() as conn:
        conn.execute(
            "UPDATE patients SET status = 'discharged' WHERE id = ? AND user_id = ?",
            (patient_id, user_id)
        )
    return True


def find_patient_by_name(user_id, name):
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM patients WHERE user_id = ? AND LOWER(name) = LOWER(?) AND status != 'discharged'",
            (user_id, name.strip())
        ).fetchone()
        return dict(row) if row else None


# ---------------------------------------------------------------------------
# Appointments
# ---------------------------------------------------------------------------

def list_appointments_by_date(user_id, date_str):
    with get_conn() as conn:
        rows = conn.execute("""
            SELECT
                a.id, a.patient_id, a.date, a.time, a.visit_type,
                a.appointment_kind, a.duration_minutes, a.window_start, a.window_end,
                a.notes, a.status, a.completed_at, a.completion_notes, a.created_at,
                p.name as patient_name, p.address, p.lat, p.lon, p.phone,
                p.gestational_age_weeks, p.gestational_age_days, p.status as patient_status
            FROM appointments a
            JOIN patients p ON a.patient_id = p.id
            WHERE a.date = ? AND a.status != 'cancelled' AND a.user_id = ?
            ORDER BY a.time ASC
        """, (date_str, user_id)).fetchall()
        return [dict(r) for r in rows]


def list_appointments_by_month(user_id, month_str):
    with get_conn() as conn:
        rows = conn.execute("""
            SELECT a.date, COUNT(*) as count
            FROM appointments a
            WHERE a.date LIKE ? AND a.status != 'cancelled' AND a.user_id = ?
            GROUP BY a.date
        """, (f"{month_str}-%", user_id)).fetchall()
        return [dict(r) for r in rows]


def create_appointment(user_id, data):
    apt_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        if not conn.execute("SELECT id FROM patients WHERE id = ? AND user_id = ?",
                            (data["patient_id"], user_id)).fetchone():
            return None
        conn.execute("""
            INSERT INTO appointments (id, user_id, patient_id, date, time, visit_type,
                appointment_kind, duration_minutes, window_start, window_end,
                notes, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?)
        """, (
            apt_id, user_id,
            data["patient_id"],
            data["date"],
            data["time"],
            data.get("visit_type", "prenatal"),
            data.get("appointment_kind", "fixed"),
            int(data.get("duration_minutes", 60)),
            data.get("window_start", data["time"]),
            data.get("window_end", ""),
            data.get("notes", ""),
            now,
        ))
        row = conn.execute("""
            SELECT a.*, p.name as patient_name, p.address, p.lat, p.lon, p.phone
            FROM appointments a JOIN patients p ON a.patient_id = p.id
            WHERE a.id = ?
        """, (apt_id,)).fetchone()
        return dict(row)


def update_appointment(user_id, apt_id, data):
    fields = ["patient_id", "date", "time", "visit_type", "notes", "status",
              "appointment_kind", "duration_minutes", "window_start", "window_end",
              "completed_at", "completion_notes"]
    updates = {f: data[f] for f in fields if f in data}
    with get_conn() as conn:
        if not conn.execute(
            "SELECT id FROM appointments WHERE id = ? AND user_id = ?", (apt_id, user_id)
        ).fetchone():
            return None
        if updates:
            set_clause = ", ".join(f"{k} = ?" for k in updates)
            conn.execute(f"UPDATE appointments SET {set_clause} WHERE id = ?",
                         list(updates.values()) + [apt_id])
        row = conn.execute("""
            SELECT a.*, p.name as patient_name, p.address, p.lat, p.lon, p.phone
            FROM appointments a JOIN patients p ON a.patient_id = p.id
            WHERE a.id = ?
        """, (apt_id,)).fetchone()
        return dict(row)


def cancel_appointment(user_id, apt_id):
    with get_conn() as conn:
        if not conn.execute(
            "SELECT id FROM appointments WHERE id = ? AND user_id = ?", (apt_id, user_id)
        ).fetchone():
            return False
        conn.execute("UPDATE appointments SET status = 'cancelled' WHERE id = ?", (apt_id,))
    return True


def bulk_create_appointments(user_id, items):
    """Create multiple appointments + patients from import data.
    Each item: {patient_name, address, date, time, visit_type?, phone?, notes?, duration_minutes?, appointment_kind?, window_end?}
    Returns {created_patients, created_appointments, errors}."""
    created_patients = 0
    created_appointments = 0
    errors = []

    for i, item in enumerate(items):
        try:
            name = item.get("patient_name", "").strip()
            address = item.get("address", "").strip()
            if not name or not address:
                errors.append({"row": i + 1, "error": "patient_name and address are required"})
                continue

            patient = find_patient_by_name(user_id, name)
            if not patient:
                patient = create_patient(user_id, {
                    "name": name,
                    "address": address,
                    "phone": item.get("phone", ""),
                })
                created_patients += 1

            apt = create_appointment(user_id, {
                "patient_id": patient["id"],
                "date": item["date"],
                "time": item["time"],
                "visit_type": item.get("visit_type", "prenatal"),
                "appointment_kind": item.get("appointment_kind", "fixed"),
                "duration_minutes": int(item.get("duration_minutes", 60)),
                "window_start": item.get("window_start", item["time"]),
                "window_end": item.get("window_end", ""),
                "notes": item.get("notes", ""),
            })
            if apt:
                created_appointments += 1
            else:
                errors.append({"row": i + 1, "error": "Failed to create appointment"})
        except Exception as e:
            errors.append({"row": i + 1, "error": str(e)})

    return {"created_patients": created_patients, "created_appointments": created_appointments, "errors": errors}


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

def get_route(user_id, date_str):
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM routes WHERE date = ? AND user_id = ?", (date_str, user_id)
        ).fetchone()
        if not row:
            return None
        result = dict(row)
        result["ordered_appointment_ids"] = json.loads(result["ordered_appointment_ids"])
        return result


def save_route(user_id, date_str, ordered_ids, travel_minutes):
    route_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        conn.execute("""
            INSERT OR REPLACE INTO routes (id, date, user_id, ordered_appointment_ids, estimated_travel_minutes, saved_at)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (route_id, date_str, user_id, json.dumps(ordered_ids), travel_minutes, now))
    return get_route(user_id, date_str)


# ---------------------------------------------------------------------------
# Seed Data
# ---------------------------------------------------------------------------

def seed_mock_data(user_id):
    # Anchored to 2026-03-28 so demo data stays consistent regardless of run date
    start = date(2026, 3, 28)

    # Set demo home address so route optimization has a starting point
    update_user(user_id, {
        "home_address": "Stargarder Str. 8, 10437 Berlin",
        "home_lat": 52.5471158,
        "home_lon": 13.4160875,
    })

    patients_data = [
        {"name": "Lena Bergmann", "address": "Langhansstraße 61, 13086 Berlin",
         "phone": "+49 30 12345678", "gestational_age_weeks": 38, "gestational_age_days": 2,
         "due_date": (start + timedelta(days=12)).isoformat(), "status": "active",
         "lat": 52.5535426, "lon": 13.4352662},
        {"name": "Maja Hoffmann", "address": "Greifswalder Str. 87-90, 10409 Berlin",
         "phone": "+49 30 98765432", "gestational_age_weeks": 40, "gestational_age_days": 0,
         "due_date": start.isoformat(), "status": "active",
         "lat": 52.5455326, "lon": 13.4444494},
        {"name": "Sophie Richter", "address": "Prenzlauer Allee 207, 10405 Berlin",
         "phone": "+49 30 11223344", "gestational_age_weeks": 35, "gestational_age_days": 5,
         "due_date": (start + timedelta(days=30)).isoformat(), "status": "active",
         "lat": 52.5371215, "lon": 13.4225943},
        {"name": "Clara Neumann", "address": "Kollwitzstraße 47, 10405 Berlin",
         "phone": "+49 30 55667788", "gestational_age_weeks": 0, "gestational_age_days": 0,
         "due_date": (start - timedelta(days=10)).isoformat(), "status": "postpartum",
         "lat": 52.5345261, "lon": 13.4157148},
        {"name": "Anna Vogt", "address": "Kopenhagener Str. 66, 10437 Berlin",
         "phone": "+49 30 33445566", "gestational_age_weeks": 39, "gestational_age_days": 1,
         "due_date": (start + timedelta(days=6)).isoformat(), "status": "active",
         "lat": 52.5488511, "lon": 13.4087306},
        {"name": "Emma Fischer", "address": "Greifenhagener Str. 31, 10437 Berlin",
         "phone": "+49 30 77889900", "gestational_age_weeks": 36, "gestational_age_days": 4,
         "due_date": (start + timedelta(days=23)).isoformat(), "status": "active",
         "lat": 52.5519154, "lon": 13.4191755},
        {"name": "Julia Bauer", "address": "Neumannstraße 9/11, 13189 Berlin",
         "phone": "+49 30 22334455", "gestational_age_weeks": 32, "gestational_age_days": 0,
         "due_date": (start + timedelta(days=56)).isoformat(), "status": "active",
         "lat": 52.5581615, "lon": 13.4241755},
        {"name": "Miriam Koch", "address": "Liselotte-Herrmann-Straße 11, 10407 Berlin",
         "phone": "+49 30 66778899", "gestational_age_weeks": 0, "gestational_age_days": 0,
         "due_date": (start - timedelta(days=3)).isoformat(), "status": "postpartum",
         "lat": 52.5312398, "lon": 13.435277},
        {"name": "Hanna Wolf", "address": "Käthe-Niederkirchner-Straße 4, 10407 Berlin",
         "phone": "+49 30 44556677", "gestational_age_weeks": 28, "gestational_age_days": 3,
         "due_date": (start + timedelta(days=81)).isoformat(), "status": "active",
         "lat": 52.5313646, "lon": 13.429278},
        {"name": "Laura Schäfer", "address": "Roelckestraße 6, 13086 Berlin",
         "phone": "+49 30 99887766", "gestational_age_weeks": 41, "gestational_age_days": 1,
         "due_date": (start - timedelta(days=8)).isoformat(), "status": "active",
         "lat": 52.5504431, "lon": 13.442671},
    ]

    created = []
    for p in patients_data:
        patient = create_patient(user_id, p)
        created.append(patient)

    # day_offset, time, visit_type, kind, patient_idx
    # 14 days (0=Sat 28.03 … 13=Fri 10.04), varying load 1–7 per day
    slots = [
        # Sat 28.03 — 2 appointments
        (0,  "10:00", "prenatal",  "fixed",    1),   # Maja — due today
        (0,  "13:30", "postnatal", "fixed",    7),   # Miriam — 3d postpartum
        # Sun 29.03 — 1 appointment
        (1,  "11:00", "postnatal", "flexible", 3),   # Clara — 11d postpartum
        # Mon 30.03 — 3 appointments
        (2,  "08:30", "prenatal",  "flexible", 4),   # Anna — 39w, due in 6d
        (2,  "11:00", "prenatal",  "fixed",    0),   # Lena
        (2,  "14:30", "prenatal",  "flexible", 2),   # Sophie
        # Tue 31.03 — 5 appointments
        (3,  "08:00", "prenatal",  "flexible", 9),   # Laura — overdue
        (3,  "10:00", "birth",     "fixed",    1),   # Maja — birth visit
        (3,  "12:00", "postnatal", "fixed",    3),   # Clara
        (3,  "14:00", "prenatal",  "flexible", 5),   # Emma
        (3,  "16:00", "prenatal",  "fixed",    6),   # Julia
        # Wed 01.04 — 7 appointments
        (4,  "08:30", "prenatal",  "flexible", 4),   # Anna
        (4,  "09:30", "postnatal", "fixed",    7),   # Miriam
        (4,  "11:00", "prenatal",  "fixed",    0),   # Lena
        (4,  "12:30", "prenatal",  "flexible", 8),   # Hanna
        (4,  "14:00", "prenatal",  "flexible", 2),   # Sophie
        (4,  "15:30", "prenatal",  "fixed",    9),   # Laura
        (4,  "17:00", "postnatal", "flexible", 3),   # Clara
        # Thu 02.04 — 6 appointments
        (5,  "09:00", "prenatal",  "fixed",    5),   # Emma
        (5,  "10:30", "birth",     "fixed",    4),   # Anna — birth visit
        (5,  "12:00", "postnatal", "fixed",    7),   # Miriam
        (5,  "13:30", "prenatal",  "flexible", 6),   # Julia
        (5,  "15:00", "prenatal",  "fixed",    0),   # Lena
        (5,  "16:30", "prenatal",  "flexible", 8),   # Hanna
        # Fri 03.04 — 4 appointments
        (6,  "09:00", "postnatal", "fixed",    4),   # Anna — 1d postnatal
        (6,  "11:00", "prenatal",  "flexible", 2),   # Sophie
        (6,  "13:00", "prenatal",  "fixed",    9),   # Laura
        (6,  "15:30", "prenatal",  "flexible", 6),   # Julia
        # Sat 04.04 — 2 appointments
        (7,  "10:00", "postnatal", "fixed",    4),   # Anna — 2d postnatal
        (7,  "12:00", "postnatal", "flexible", 3),   # Clara
        # Sun 05.04 — 1 appointment
        (8,  "11:00", "postnatal", "fixed",    4),   # Anna — 3d postnatal
        # Mon 06.04 — 4 appointments
        (9,  "08:30", "postnatal", "flexible", 4),   # Anna — 4d postnatal
        (9,  "10:30", "prenatal",  "fixed",    5),   # Emma
        (9,  "13:00", "prenatal",  "flexible", 8),   # Hanna
        (9,  "15:00", "prenatal",  "fixed",    1),   # Maja
        # Tue 07.04 — 5 appointments
        (10, "09:00", "prenatal",  "flexible", 9),   # Laura
        (10, "10:30", "postnatal", "fixed",    7),   # Miriam
        (10, "12:00", "prenatal",  "fixed",    2),   # Sophie
        (10, "14:00", "prenatal",  "flexible", 6),   # Julia
        (10, "16:00", "prenatal",  "fixed",    0),   # Lena
        # Wed 08.04 — 3 appointments
        (11, "09:00", "prenatal",  "flexible", 8),   # Hanna
        (11, "11:30", "prenatal",  "fixed",    5),   # Emma
        (11, "14:00", "postnatal", "flexible", 4),   # Anna — 6d postnatal
        # Thu 09.04 — 4 appointments
        (12, "08:30", "prenatal",  "flexible", 9),   # Laura
        (12, "10:00", "prenatal",  "fixed",    1),   # Maja
        (12, "13:00", "prenatal",  "flexible", 6),   # Julia
        (12, "15:30", "prenatal",  "fixed",    0),   # Lena
        # Fri 10.04 — 2 appointments
        (13, "10:00", "prenatal",  "flexible", 2),   # Sophie
        (13, "13:00", "prenatal",  "fixed",    8),   # Hanna
    ]

    for day_off, time_str, visit_type, kind, patient_idx in slots:
        apt_date = (start + timedelta(days=day_off)).isoformat()
        window_start = time_str
        window_end = ""
        if kind == "flexible":
            h = int(time_str.split(":")[0])
            window_end = f"{h+3:02d}:00"
        create_appointment(user_id, {
            "patient_id": created[patient_idx]["id"],
            "date": apt_date,
            "time": time_str,
            "visit_type": visit_type,
            "appointment_kind": kind,
            "window_start": window_start,
            "window_end": window_end,
        })
