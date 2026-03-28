# Appointment Form UX Improvements

**Date:** 2026-03-28
**Status:** Approved
**Scope:** `js/views/appointment-form.js`, `js/views/today.js`

---

## Problem

Two UX issues with the appointment creation flow:

1. **Hidden entry point.** The "+" icon to add an appointment is a small, low-contrast icon that is easy to miss.
2. **Confusing form structure.** The Add Appointment form has two fields with "type" in the name ("Type" and "Visit type"), and the Fixed/Flex toggle appears *after* the time field — even though it determines what the time field means. The "Flex" label and "Flexible until" field label are also not self-explanatory.

---

## Design

### 1. Entry point — inline add row

Replace the bare "+" icon in the appointments header with a dashed "＋ Add appointment" row at the bottom of the appointment list.

- The row is always visible on the day view (even when the list is empty)
- Tapping it opens the Add Appointment sheet, same as before
- The import icon (upload arrow) stays next to the appointment count in the header — only the "+" is removed
- The dashed style (matching the existing Flex badge aesthetic) signals "placeholder / add here" without adding visual weight

### 2. Form field order

Both Add and Edit forms use this sequence:

| # | Field | Notes |
|---|-------|-------|
| 1 | **Mother** | Dropdown; "+ Add new mother" option expands inline fields |
| 2 | **Date** | Full-width date picker (not side-by-side with time) |
| 3 | **Scheduling** | Toggle: "Fixed time" / "Time window" |
| 4 | **Time field(s)** | Conditional — see below |
| 5 | **Visit** | Dropdown: Prenatal / Postnatal / Birth |
| 6 | **Duration** | Dropdown: 15 min → 2 hr |
| 7 | **Notes** | Optional textarea, present in both Add and Edit |

**Scheduling → Time field behavior:**

- **Fixed time** selected → single "Time" picker (existing behavior)
- **Time window** selected → two side-by-side pickers: "Earliest" and "Latest"
  - Replaces the current "Time" + hidden "Flexible until" pattern
  - "Earliest" maps to `window_start` / `time`; "Latest" maps to `window_end`

### 3. Label changes

| Old label | New label | Reason |
|-----------|-----------|--------|
| Type | Scheduling | Removes collision with "Visit type" |
| Fixed | Fixed time | More self-explanatory |
| Flex | Time window | Clearer intent; matches "Earliest"/"Latest" framing |
| Visit type | Visit | Shorter; no longer collides with "Scheduling" |
| Flexible until | Latest | Replaced by the two-field pattern above |

### 4. Notes field in Add form

The Notes textarea (currently only in Edit) is added to the Add form. It is optional and placed last so it does not interrupt the required fields.

---

## Files Affected

| File | Change |
|------|--------|
| `js/views/today.js` | Remove "+" icon button; add dashed "Add appointment" row at bottom of appointment list |
| `js/views/appointment-form.js` | Reorder fields; update labels; move Date to full-width; add Scheduling toggle logic; replace "Time + Flexible until" with "Earliest + Latest" for flex; add Notes to Add form |

No backend changes required — field names and API payload structure are unchanged. Only labels and UI ordering change.

---

## Out of Scope

- Changing the Edit form's patient name display (read-only field, intentional)
- Any changes to the route optimization logic
- Multi-appointment bulk entry
