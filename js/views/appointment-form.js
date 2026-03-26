/**
 * views/appointment-form.js — Add & Edit appointment bottom sheets
 */

import { api } from '../api.js';
import { state } from '../state.js';
import { escapeHtml, showBottomSheet, closeBottomSheet, showToast } from '../ui.js';

// ---------------------------------------------------------------------------
// Add Appointment
// ---------------------------------------------------------------------------

export async function showAddAppointment(onSaved) {
    let patients = [];
    try {
        patients = await api.getPatients();
    } catch (e) {}

    const patientOptions = patients.map(p =>
        `<option value="${p.id}">${escapeHtml(p.name)}</option>`
    ).join('');

    showBottomSheet(`
        <div class="px-4 pb-6">
            <h2 class="text-base font-semibold mb-4">Add Appointment</h2>
            <form id="add-apt-form" class="space-y-3">
                <div>
                    <label class="block text-sm font-medium mb-1">Mother</label>
                    <select id="apt-patient" required class="w-full h-10 px-3 rounded-lg border border-stone-200 text-sm">
                        <option value="">Select a mother...</option>
                        ${patientOptions}
                        <option value="__new">+ Add new mother</option>
                    </select>
                </div>
                <div id="new-patient-fields" class="hidden space-y-3">
                    <input id="new-patient-name" type="text" placeholder="Mother's name"
                        class="w-full h-10 px-3 rounded-lg border border-stone-200 text-sm" />
                    <input id="new-patient-address" type="text" placeholder="Address"
                        class="w-full h-10 px-3 rounded-lg border border-stone-200 text-sm" />
                    <input id="new-patient-phone" type="tel" placeholder="Phone (optional)"
                        class="w-full h-10 px-3 rounded-lg border border-stone-200 text-sm" />
                </div>
                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block text-sm font-medium mb-1">Date</label>
                        <input id="apt-date" type="date" value="${state.selectedDate}" required
                            class="w-full h-10 px-3 rounded-lg border border-stone-200 text-sm" />
                    </div>
                    <div>
                        <label class="block text-sm font-medium mb-1">Time</label>
                        <input id="apt-time" type="time" value="09:00" required
                            class="w-full h-10 px-3 rounded-lg border border-stone-200 text-sm" />
                    </div>
                </div>
                <div>
                    <label class="block text-sm font-medium mb-1">Type</label>
                    <div class="flex gap-2">
                        <label class="flex-1">
                            <input type="radio" name="apt-kind" value="fixed" checked class="hidden peer" />
                            <div class="h-10 flex items-center justify-center rounded-lg border border-stone-200 text-sm peer-checked:bg-stone-900 peer-checked:text-white peer-checked:border-stone-900 cursor-pointer">Fixed</div>
                        </label>
                        <label class="flex-1">
                            <input type="radio" name="apt-kind" value="flexible" class="hidden peer" />
                            <div class="h-10 flex items-center justify-center rounded-lg border border-stone-200 text-sm peer-checked:bg-stone-900 peer-checked:text-white peer-checked:border-stone-900 cursor-pointer">Flex</div>
                        </label>
                    </div>
                </div>
                <div id="window-end-field" class="hidden">
                    <label class="block text-sm font-medium mb-1">Flexible until</label>
                    <input id="apt-window-end" type="time" value="13:00"
                        class="w-full h-10 px-3 rounded-lg border border-stone-200 text-sm" />
                </div>
                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block text-sm font-medium mb-1">Visit type</label>
                        <select id="apt-visit-type" class="w-full h-10 px-3 rounded-lg border border-stone-200 text-sm">
                            <option value="prenatal">Prenatal</option>
                            <option value="postnatal">Postnatal</option>
                            <option value="birth">Birth</option>
                        </select>
                    </div>
                    <div>
                        <label class="block text-sm font-medium mb-1">Duration</label>
                        <select id="apt-duration" class="w-full h-10 px-3 rounded-lg border border-stone-200 text-sm">
                            <option value="15">15 min</option>
                            <option value="30">30 min</option>
                            <option value="45">45 min</option>
                            <option value="60" selected>1 hr</option>
                            <option value="90">1.5 hr</option>
                            <option value="120">2 hr</option>
                        </select>
                    </div>
                </div>
                <button type="submit" id="apt-submit"
                    class="w-full h-11 bg-stone-900 text-white rounded-lg font-medium hover:bg-stone-800 mt-2">
                    Add Appointment
                </button>
            </form>
        </div>
    `);

    // Toggle new patient fields
    document.getElementById('apt-patient').addEventListener('change', (e) => {
        document.getElementById('new-patient-fields').classList.toggle('hidden', e.target.value !== '__new');
    });

    // Toggle window end field
    document.querySelectorAll('input[name="apt-kind"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            document.getElementById('window-end-field').classList.toggle('hidden', e.target.value !== 'flexible');
        });
    });

    // Submit
    document.getElementById('add-apt-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('apt-submit');
        btn.disabled = true;
        btn.textContent = 'Saving...';

        try {
            let patientId = document.getElementById('apt-patient').value;

            if (patientId === '__new') {
                const name = document.getElementById('new-patient-name').value.trim();
                const address = document.getElementById('new-patient-address').value.trim();
                const phone = document.getElementById('new-patient-phone').value.trim();
                if (!name || !address) { showToast('Name and address are required'); return; }
                const patient = await api.createPatient({ name, address, phone });
                patientId = patient.id;
            }

            const kind = document.querySelector('input[name="apt-kind"]:checked').value;
            const time = document.getElementById('apt-time').value;

            await api.createAppointment({
                patient_id: patientId,
                date: document.getElementById('apt-date').value,
                time: time,
                visit_type: document.getElementById('apt-visit-type').value,
                duration_minutes: parseInt(document.getElementById('apt-duration').value),
                appointment_kind: kind,
                window_start: time,
                window_end: kind === 'flexible' ? document.getElementById('apt-window-end').value : '',
            });

            closeBottomSheet();
            if (onSaved) await onSaved();
            showToast('Appointment added');
        } catch (err) {
            showToast(err.message);
            btn.disabled = false;
            btn.textContent = 'Add Appointment';
        }
    });
}

// ---------------------------------------------------------------------------
// Edit Appointment
// ---------------------------------------------------------------------------

export function showEditAppointment(apt, onSaved) {
    const isFixed = apt.appointment_kind === 'fixed';
    const isFlex = !isFixed;

    showBottomSheet(`
        <div class="px-4 pb-6">
            <div class="flex items-center justify-between mb-4">
                <h2 class="text-base font-semibold">Edit Appointment</h2>
                <button id="delete-apt-btn" class="p-2 rounded-lg hover:bg-red-50 text-red-500">
                    <i data-lucide="trash-2" class="w-4 h-4"></i>
                </button>
            </div>
            <form id="edit-apt-form" class="space-y-3">
                <div>
                    <label class="block text-sm font-medium mb-1">Mother</label>
                    <div class="h-10 px-3 flex items-center rounded-lg bg-stone-50 border border-stone-200 text-sm text-stone-600">
                        ${escapeHtml(apt.patient_name)}
                    </div>
                </div>
                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block text-sm font-medium mb-1">Date</label>
                        <input id="edit-date" type="date" value="${apt.date}" required
                            class="w-full h-10 px-3 rounded-lg border border-stone-200 text-sm" />
                    </div>
                    <div>
                        <label class="block text-sm font-medium mb-1">Time</label>
                        <input id="edit-time" type="time" value="${apt.time}" required
                            class="w-full h-10 px-3 rounded-lg border border-stone-200 text-sm" />
                    </div>
                </div>
                <div>
                    <label class="block text-sm font-medium mb-1">Type</label>
                    <div class="flex gap-2">
                        <label class="flex-1">
                            <input type="radio" name="edit-kind" value="fixed" ${isFixed ? 'checked' : ''} class="hidden peer" />
                            <div class="h-10 flex items-center justify-center rounded-lg border border-stone-200 text-sm peer-checked:bg-stone-900 peer-checked:text-white peer-checked:border-stone-900 cursor-pointer">Fixed</div>
                        </label>
                        <label class="flex-1">
                            <input type="radio" name="edit-kind" value="flexible" ${isFlex ? 'checked' : ''} class="hidden peer" />
                            <div class="h-10 flex items-center justify-center rounded-lg border border-stone-200 text-sm peer-checked:bg-stone-900 peer-checked:text-white peer-checked:border-stone-900 cursor-pointer">Flex</div>
                        </label>
                    </div>
                </div>
                <div id="edit-window-end-field" class="${isFlex ? '' : 'hidden'}">
                    <label class="block text-sm font-medium mb-1">Flexible until</label>
                    <input id="edit-window-end" type="time" value="${apt.window_end || '13:00'}"
                        class="w-full h-10 px-3 rounded-lg border border-stone-200 text-sm" />
                </div>
                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block text-sm font-medium mb-1">Visit type</label>
                        <select id="edit-visit-type" class="w-full h-10 px-3 rounded-lg border border-stone-200 text-sm">
                            <option value="prenatal" ${apt.visit_type === 'prenatal' ? 'selected' : ''}>Prenatal</option>
                            <option value="postnatal" ${apt.visit_type === 'postnatal' ? 'selected' : ''}>Postnatal</option>
                            <option value="birth" ${apt.visit_type === 'birth' ? 'selected' : ''}>Birth</option>
                        </select>
                    </div>
                    <div>
                        <label class="block text-sm font-medium mb-1">Duration</label>
                        <select id="edit-duration" class="w-full h-10 px-3 rounded-lg border border-stone-200 text-sm">
                            <option value="15" ${apt.duration_minutes == 15 ? 'selected' : ''}>15 min</option>
                            <option value="30" ${apt.duration_minutes == 30 ? 'selected' : ''}>30 min</option>
                            <option value="45" ${apt.duration_minutes == 45 ? 'selected' : ''}>45 min</option>
                            <option value="60" ${apt.duration_minutes == 60 || !apt.duration_minutes ? 'selected' : ''}>1 hr</option>
                            <option value="90" ${apt.duration_minutes == 90 ? 'selected' : ''}>1.5 hr</option>
                            <option value="120" ${apt.duration_minutes == 120 ? 'selected' : ''}>2 hr</option>
                        </select>
                    </div>
                </div>
                <div>
                    <label class="block text-sm font-medium mb-1">Notes</label>
                    <textarea id="edit-notes" rows="2" placeholder="Optional notes"
                        class="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm resize-none">${escapeHtml(apt.notes || '')}</textarea>
                </div>
                <button type="submit" id="edit-submit"
                    class="w-full h-11 bg-stone-900 text-white rounded-lg font-medium hover:bg-stone-800 mt-2">
                    Save Changes
                </button>
            </form>
        </div>
    `);

    // Toggle window end field
    document.querySelectorAll('input[name="edit-kind"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            document.getElementById('edit-window-end-field').classList.toggle('hidden', e.target.value !== 'flexible');
        });
    });

    // Delete
    document.getElementById('delete-apt-btn').addEventListener('click', async () => {
        if (!confirm('Cancel this appointment?')) return;
        try {
            await api.cancelAppointment(apt.id);
            closeBottomSheet();
            if (onSaved) await onSaved();
            showToast('Appointment cancelled');
        } catch (err) {
            showToast(err.message);
        }
    });

    // Submit
    document.getElementById('edit-apt-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('edit-submit');
        btn.disabled = true;
        btn.textContent = 'Saving...';

        try {
            const kind = document.querySelector('input[name="edit-kind"]:checked').value;
            const time = document.getElementById('edit-time').value;

            await api.updateAppointment(apt.id, {
                date: document.getElementById('edit-date').value,
                time: time,
                visit_type: document.getElementById('edit-visit-type').value,
                duration_minutes: parseInt(document.getElementById('edit-duration').value),
                appointment_kind: kind,
                window_start: time,
                window_end: kind === 'flexible' ? document.getElementById('edit-window-end').value : '',
                notes: document.getElementById('edit-notes').value,
            });

            closeBottomSheet();
            if (onSaved) await onSaved();
            showToast('Appointment updated');
        } catch (err) {
            showToast(err.message);
            btn.disabled = false;
            btn.textContent = 'Save Changes';
        }
    });

    lucide.createIcons();
}
