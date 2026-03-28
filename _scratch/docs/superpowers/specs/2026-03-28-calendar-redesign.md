# Calendar Redesign: Month Indicators + Timeline Day View

**Date:** 2026-03-28
**Status:** Approved
**Scope:** `js/views/calendar.js`, `js/views/today.js`, `tools/db.py`

---

## Problem

Two gaps in the current calendar experience:

1. **Month view feels empty.** Day cells only show the day number. When a day has appointments, a single small dot appears — but it gives no sense of how many visits or what kind they are.

2. **Day view is a plain list.** Tapping a day in the calendar leads to `today.js`, which renders a vertical list of appointment cards. There's no sense of time — two fixed appointments at 8 AM and 4 PM look identical to two back-to-back appointments at noon.

---

## Design

### 1. Month view — type dots

Replace the single dot per day with one dot per appointment, colored by visit type, capped at 4 displayed. If a day has more than 4, show 3 dots + a "+N" overflow label.

**Dot colors (stone palette):**
- `prenatal` → `bg-stone-400` (light)
- `postnatal` → `bg-stone-600` (medium)
- `birth` → `bg-stone-900` (dark)
- On today's cell (dark background): all dots use `bg-white/60`

**Dot ordering:** prenatal first, then postnatal, then birth — consistent across all days.

**API change required:** `list_appointments_by_month` in `tools/db.py` currently returns `{date, count}`. Change it to return `{date, count, prenatal, postnatal, birth}` using conditional aggregation in SQL:

```sql
SELECT
  a.date,
  COUNT(*) as count,
  SUM(CASE WHEN a.visit_type = 'prenatal'  THEN 1 ELSE 0 END) as prenatal,
  SUM(CASE WHEN a.visit_type = 'postnatal' THEN 1 ELSE 0 END) as postnatal,
  SUM(CASE WHEN a.visit_type = 'birth'     THEN 1 ELSE 0 END) as birth
FROM appointments a
WHERE a.date LIKE ? AND a.status != 'cancelled' AND a.user_id = ?
GROUP BY a.date
```

No changes needed to the Flask route or `api.js` — the extra fields pass through as-is.

**Calendar.js changes:**
- `renderGrid`: update `countMap` to store the full object `{count, prenatal, postnatal, birth}` keyed by date
- Replace the single-dot span with a flex row of dots built from the type counts

---

### 2. Day view — timeline replaces the list

The timeline view replaces the appointment list in `today.js` entirely. All existing logic (state management, API calls, route optimization, driver mode, import) stays unchanged. Only the rendering of appointments changes.

#### Layout

Two-column CSS grid:

```
[ 44px time column ] [ flex appointment column ]
```

The time column is a fixed-width left rail showing hour labels (e.g. "8 AM", "9 AM"). The appointment column holds a positioned stacking context where blocks are placed by `top` and `height` in pixels.

**Pixel scale:** 64px per hour. This makes minute math clean: `px = minutes / 60 * 64`.

**Time range:** Dynamic. Start = 1 hour before the earliest appointment (or 7 AM, whichever is earlier). End = 1 hour after the latest appointment end time (or 7 PM, whichever is later). This keeps the view focused without wasting space.

**Hour lines:** Thin `border-top: 1px solid #f5f5f4` grid lines in the appointment column, one per hour, rendered as stacked `div` elements (same approach as current mockup).

#### Appointment blocks

Each appointment is rendered as an absolutely-positioned block inside the appointment column.

**Fixed appointments:**
- `top` = offset of `time` from day start
- `height` = `duration_minutes / 60 * 64`
- Style: `background: #1c1917; color: #fff; border-radius: 6px`

**Flex appointments (before optimization):**
- `top` = offset of `window_start` from day start
- `height` = `(window_end - window_start) in minutes / 60 * 64` — spans the entire allowed window
- Style: `background: rgba(168,162,158,0.1); border: 1.5px dashed #a8a29e; color: #44403c`
- Text pinned to top: patient name + "flex HH:MM–HH:MM · type · duration"

**Flex appointments (after optimization):**
- Once the route is optimized, each flex appointment receives an assigned ETA from the route result
- After optimization: treat the flex block like a fixed block — `top` = ETA offset, `height` = duration — visually collapsing the window to the scheduled slot
- Style remains dashed to signal it was originally flexible

#### Overlap handling

When two appointment blocks overlap in time, split the appointment column width equally and place them side by side. Use a simple sweep-line approach: sort blocks by start time, track active blocks, assign column index (0, 1, …), set `left` and `right` accordingly.

#### Current time line

A red `2px` horizontal rule with a leading dot, positioned at the current time offset. Only shown when the current date matches the viewed date. Redraws every minute via `setInterval`.

#### Preserved functionality

All existing `today.js` behavior that lives outside the appointment list rendering is kept unchanged:
- Optimize route button (stays in the footer)
- Driver mode button (stays in the footer)
- Import appointments (icon in header)
- Date navigation arrows (prev/next day)
- "Plan today" from dashboard still routes to `#today`

The "Add appointment" dashed row (from the approved appointment-form-ux spec) should still appear — placed below the timeline's last hour row, always reachable by scrolling.

---

## Files to Modify

| File | Change |
|------|--------|
| `tools/db.py` | `list_appointments_by_month`: add conditional aggregation for visit type counts |
| `js/views/calendar.js` | `renderGrid`: replace single-dot with multi-dot row from type counts |
| `js/views/today.js` | Replace appointment list rendering with two-column timeline |

No changes to `js/api.js`, `js/router.js`, `js/state.js`, or any Flask routes.

---

## Verification

1. **Month dots:** Open calendar, confirm days with appointments show the right number and shade of dots. Check a day with prenatal + birth (should show light + dark dots, no medium). Check today's cell (dark bg) — dots should be white/translucent. Check a day with >4 appointments shows 3 dots + "+N".

2. **Timeline — unoptimized:** Tap a day with a mix of fixed and flex appointments. Confirm fixed blocks appear at their exact time with correct height. Confirm flex blocks span window_start to window_end. Confirm no block overlaps the time label column.

3. **Timeline — optimized:** Tap today, press "Optimize route". Confirm flex blocks collapse to their assigned ETA and duration, remaining dashed. Confirm fixed blocks don't move.

4. **Overlap:** Create two appointments with overlapping times on the same day. Confirm they render side by side.

5. **Driver mode:** From the timeline day view, confirm the driver mode button still works.

6. **Navigation:** Confirm prev/next arrows move between days. Confirm tapping a calendar cell lands on the correct date in the timeline.
