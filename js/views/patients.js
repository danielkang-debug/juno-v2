/**
 * views/patients.js — Mother list + add/edit (secondary screen)
 */

import { api } from '../api.js';
import { state } from '../state.js';
import { escapeHtml, showBottomSheet, closeBottomSheet, showToast } from '../ui.js';

let container = null;
let patients = [];
let searchQuery = '';

async function render(el) {
    container = el;

    const headerTitle = document.getElementById('header-title');
    headerTitle.textContent = 'Mothers';

    container.innerHTML = `
        <div class="py-4">
            <div class="flex items-center gap-2 mb-4">
                <div class="flex-1 relative">
                    <i data-lucide="search" class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400"></i>
                    <input id="patient-search" type="text" placeholder="Search..." value="${escapeHtml(searchQuery)}"
                        class="w-full h-10 pl-9 pr-3 rounded-lg border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900" />
                </div>
                <button id="add-patient-btn" class="h-10 w-10 flex items-center justify-center rounded-lg bg-stone-900 text-white hover:bg-stone-800">
                    <i data-lucide="plus" class="w-4 h-4"></i>
                </button>
            </div>
            <div id="patient-list" class="md:grid md:grid-cols-2 md:gap-2">
                <div class="flex items-center justify-center py-8 text-stone-400">
                    <i data-lucide="loader-2" class="w-5 h-5 animate-spin"></i>
                </div>
            </div>
        </div>
    `;

    document.getElementById('patient-search').addEventListener('input', (e) => {
        searchQuery = e.target.value;
        renderList();
    });
    document.getElementById('add-patient-btn').addEventListener('click', showAddPatient);

    lucide.createIcons();
    await loadPatients();
}

async function loadPatients() {
    try {
        patients = await api.getPatients();
        renderList();
    } catch (e) {
        document.getElementById('patient-list').innerHTML = `
            <p class="text-center text-stone-400 py-8">Could not load patients</p>
        `;
    }
}

function renderList() {
    const list = document.getElementById('patient-list');
    const q = searchQuery.toLowerCase();
    const filtered = patients.filter(p =>
        p.name.toLowerCase().includes(q) || (p.address || '').toLowerCase().includes(q)
    );

    if (filtered.length === 0) {
        list.innerHTML = `<p class="text-center text-stone-400 py-8">${patients.length === 0 ? 'No mothers yet' : 'No results'}</p>`;
        return;
    }

    list.innerHTML = filtered.map(p => {
        const statusColors = {
            active: 'bg-green-100 text-green-700',
            postpartum: 'bg-blue-100 text-blue-700',
            discharged: 'bg-stone-100 text-stone-500',
        };
        const statusClass = statusColors[p.status] || statusColors.active;
        const ga = p.gestational_age_weeks > 0 ? `${p.gestational_age_weeks}+${p.gestational_age_days} GA` : '';
        const noLocation = !p.lat && p.address;

        return `
            <div class="bg-white rounded-lg border border-stone-200 p-3 mb-2 cursor-pointer hover:bg-stone-50 patient-card" data-id="${p.id}">
                <div class="flex items-start gap-3">
                    <div class="w-9 h-9 rounded-full bg-stone-100 flex items-center justify-center text-sm font-medium text-stone-600 shrink-0">
                        ${p.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                    </div>
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 mb-0.5">
                            <span class="text-sm font-medium">${escapeHtml(p.name)}</span>
                            <span class="text-xs px-1.5 py-0.5 rounded ${statusClass}">${p.status}</span>
                        </div>
                        <div class="text-xs text-stone-400 truncate">${escapeHtml(p.address || 'No address')}</div>
                        <div class="flex items-center gap-3 mt-1">
                            ${ga ? `<span class="text-xs text-stone-500">${ga}</span>` : ''}
                            ${p.due_date ? `<span class="text-xs text-stone-500">Due: ${p.due_date}</span>` : ''}
                            ${p.phone ? `<span class="text-xs text-stone-400">${escapeHtml(p.phone)}</span>` : ''}
                        </div>
                        ${noLocation ? '<span class="text-xs text-red-500">No location</span>' : ''}
                    </div>
                </div>
            </div>
        `;
    }).join('');

    list.querySelectorAll('.patient-card').forEach(card => {
        card.addEventListener('click', () => showEditPatient(card.dataset.id));
    });
}

function showAddPatient() {
    showPatientForm(null);
}

function showEditPatient(id) {
    const patient = patients.find(p => p.id === id);
    if (patient) showPatientForm(patient);
}

function showPatientForm(patient) {
    const isEdit = !!patient;
    const p = patient || {};

    showBottomSheet(`
        <div class="px-4 pb-6">
            <h2 class="text-base font-semibold mb-4">${isEdit ? 'Edit Mother' : 'Add Mother'}</h2>
            <form id="patient-form" class="space-y-3">
                <div>
                    <label class="block text-sm font-medium mb-1">Name *</label>
                    <input id="pf-name" type="text" value="${escapeHtml(p.name || '')}" required
                        class="w-full h-10 px-3 rounded-lg border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900" />
                </div>
                <div class="relative">
                    <label class="block text-sm font-medium mb-1">Address *</label>
                    <input id="pf-address" type="text" value="${escapeHtml(p.address || '')}" required
                        autocomplete="off"
                        class="w-full h-10 px-3 rounded-lg border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900" />
                    <ul id="pf-address-suggestions"
                        class="absolute z-50 w-full bg-white border border-stone-200 rounded-lg mt-1 shadow-md hidden text-sm"></ul>
                </div>
                <div>
                    <label class="block text-sm font-medium mb-1">Phone</label>
                    <input id="pf-phone" type="tel" value="${escapeHtml(p.phone || '')}"
                        class="w-full h-10 px-3 rounded-lg border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900" />
                </div>
                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block text-sm font-medium mb-1">GA Weeks</label>
                        <input id="pf-ga-weeks" type="number" min="0" max="45" value="${p.gestational_age_weeks || 0}"
                            class="w-full h-10 px-3 rounded-lg border border-stone-200 text-sm" />
                    </div>
                    <div>
                        <label class="block text-sm font-medium mb-1">GA Days</label>
                        <input id="pf-ga-days" type="number" min="0" max="6" value="${p.gestational_age_days || 0}"
                            class="w-full h-10 px-3 rounded-lg border border-stone-200 text-sm" />
                    </div>
                </div>
                <div>
                    <label class="block text-sm font-medium mb-1">Due Date</label>
                    <input id="pf-due" type="date" value="${p.due_date || ''}"
                        class="w-full h-10 px-3 rounded-lg border border-stone-200 text-sm" />
                </div>
                <div>
                    <label class="block text-sm font-medium mb-1">Notes</label>
                    <textarea id="pf-notes" rows="2" class="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm resize-none">${escapeHtml(p.notes || '')}</textarea>
                </div>
                ${isEdit ? `
                    <div>
                        <label class="block text-sm font-medium mb-1">Status</label>
                        <select id="pf-status" class="w-full h-10 px-3 rounded-lg border border-stone-200 text-sm">
                            <option value="active" ${p.status === 'active' ? 'selected' : ''}>Active</option>
                            <option value="postpartum" ${p.status === 'postpartum' ? 'selected' : ''}>Postpartum</option>
                            <option value="discharged" ${p.status === 'discharged' ? 'selected' : ''}>Discharged</option>
                        </select>
                    </div>
                ` : ''}
                <button type="submit" id="pf-submit"
                    class="w-full h-11 bg-stone-900 text-white rounded-lg font-medium hover:bg-stone-800 mt-2">
                    ${isEdit ? 'Save Changes' : 'Add Mother'}
                </button>
            </form>
        </div>
    `);

    // --- Address autocomplete ---
    let confirmedCoords = null;
    let debounceTimer = null;

    const addressInput = document.getElementById('pf-address');
    const suggestionsList = document.getElementById('pf-address-suggestions');

    function formatSuggestion(result) {
        const a = result.address || {};
        const parts = [
            a.road,
            a.house_number,
            a.suburb || a.city_district || a.neighbourhood || a.quarter
        ].filter(Boolean);
        return parts.join(' ') || result.display_name;
    }

    addressInput.addEventListener('input', () => {
        confirmedCoords = null;
        clearTimeout(debounceTimer);
        const query = addressInput.value.trim();
        if (query.length < 3) {
            suggestionsList.classList.add('hidden');
            suggestionsList.innerHTML = '';
            return;
        }
        debounceTimer = setTimeout(async () => {
            try {
                const params = new URLSearchParams({
                    q: query, format: 'json', limit: '5',
                    countrycodes: 'de', viewbox: '13.09,52.34,13.76,52.68',
                    bounded: '1', addressdetails: '1'
                });
                const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`);
                const results = await res.json();
                if (!results.length) {
                    suggestionsList.classList.add('hidden');
                    suggestionsList.innerHTML = '';
                    return;
                }
                suggestionsList._results = results;
                suggestionsList.innerHTML = results.map((r, i) =>
                    `<li class="px-3 py-2 cursor-pointer hover:bg-stone-50 border-b border-stone-100 last:border-0" data-index="${i}">${escapeHtml(formatSuggestion(r))}</li>`
                ).join('');
                suggestionsList.classList.remove('hidden');
            } catch {
                suggestionsList.classList.add('hidden');
            }
        }, 300);
    });

    suggestionsList.addEventListener('click', (e) => {
        const li = e.target.closest('li');
        if (!li) return;
        const result = (suggestionsList._results || [])[parseInt(li.dataset.index)];
        if (!result) return;
        addressInput.value = formatSuggestion(result);
        confirmedCoords = { lat: parseFloat(result.lat), lon: parseFloat(result.lon) };
        suggestionsList.classList.add('hidden');
        suggestionsList.innerHTML = '';
    });

    document.addEventListener('click', function dismissOnOutsideClick(e) {
        if (!addressInput.contains(e.target) && !suggestionsList.contains(e.target)) {
            suggestionsList.classList.add('hidden');
        }
    });
    // --- End address autocomplete ---

    document.getElementById('patient-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('pf-submit');
        btn.disabled = true;
        btn.textContent = 'Saving...';

        const data = {
            name: document.getElementById('pf-name').value.trim(),
            address: document.getElementById('pf-address').value.trim(),
            phone: document.getElementById('pf-phone').value.trim(),
            gestational_age_weeks: parseInt(document.getElementById('pf-ga-weeks').value) || 0,
            gestational_age_days: parseInt(document.getElementById('pf-ga-days').value) || 0,
            due_date: document.getElementById('pf-due').value,
            notes: document.getElementById('pf-notes').value.trim(),
            ...(confirmedCoords ? { lat: confirmedCoords.lat, lon: confirmedCoords.lon } : {}),
        };
        if (isEdit) {
            data.status = document.getElementById('pf-status').value;
        }

        try {
            if (isEdit) {
                await api.updatePatient(patient.id, data);
            } else {
                await api.createPatient(data);
            }
            closeBottomSheet();
            await loadPatients();
            showToast(isEdit ? 'Mother updated' : 'Mother added');
        } catch (err) {
            showToast(err.message);
            btn.disabled = false;
            btn.textContent = isEdit ? 'Save Changes' : 'Add Mother';
        }
    });
}

export const patientsView = { render };
