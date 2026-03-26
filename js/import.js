/**
 * import.js — Client-side CSV/iCal parsing + column mapping + import UI
 */

import { api } from './api.js';
import { escapeHtml, showBottomSheet, closeBottomSheet, showToast } from './ui.js';

// ---------------------------------------------------------------------------
// CSV Parser
// ---------------------------------------------------------------------------

function parseCSV(text) {
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length < 2) return { headers: [], rows: [] };

    // Detect delimiter
    const firstLine = lines[0];
    const delimiter = firstLine.includes('\t') ? '\t' : firstLine.includes(';') ? ';' : ',';

    const headers = parseLine(firstLine, delimiter);
    const rows = lines.slice(1).map(line => {
        const values = parseLine(line, delimiter);
        const obj = {};
        headers.forEach((h, i) => { obj[h] = values[i] || ''; });
        return obj;
    });

    return { headers, rows };
}

function parseLine(line, delimiter) {
    const values = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            inQuotes = !inQuotes;
        } else if (ch === delimiter && !inQuotes) {
            values.push(current.trim());
            current = '';
        } else {
            current += ch;
        }
    }
    values.push(current.trim());
    return values;
}

// ---------------------------------------------------------------------------
// iCal Parser
// ---------------------------------------------------------------------------

function parseICal(text) {
    const events = [];
    const blocks = text.split('BEGIN:VEVENT');

    for (let i = 1; i < blocks.length; i++) {
        const block = blocks[i].split('END:VEVENT')[0];
        const event = {};

        const lines = unfoldICalLines(block);
        for (const line of lines) {
            const [key, ...rest] = line.split(':');
            const value = rest.join(':').trim();
            const baseKey = key.split(';')[0].trim();

            if (baseKey === 'SUMMARY') event.summary = value;
            if (baseKey === 'DTSTART') event.dtstart = value;
            if (baseKey === 'LOCATION') event.location = value;
            if (baseKey === 'DESCRIPTION') event.description = value;
            if (baseKey === 'DURATION') event.duration = value;
        }

        if (event.dtstart) {
            // Parse DTSTART: 20260319T093000 or 20260319
            const dt = event.dtstart.replace(/[^0-9T]/g, '');
            if (dt.length >= 8) {
                event.date = `${dt.slice(0,4)}-${dt.slice(4,6)}-${dt.slice(6,8)}`;
                if (dt.includes('T') && dt.length >= 13) {
                    event.time = `${dt.slice(9,11)}:${dt.slice(11,13)}`;
                }
            }
            events.push(event);
        }
    }

    return events;
}

function unfoldICalLines(text) {
    // iCal folding: continuation lines start with space or tab
    return text.replace(/\r\n[\t ]/g, '').replace(/\r/g, '').split('\n').filter(l => l.trim());
}

// ---------------------------------------------------------------------------
// Column Mapping
// ---------------------------------------------------------------------------

const FIELD_ALIASES = {
    patient_name: ['name', 'patient', 'patient_name', 'patientname', 'mutter', 'mother', 'hebamme', 'summary'],
    address: ['address', 'adresse', 'location', 'ort', 'anschrift', 'strasse', 'street'],
    date: ['date', 'datum', 'day', 'tag'],
    time: ['time', 'zeit', 'uhrzeit', 'start', 'startzeit', 'beginn'],
    phone: ['phone', 'telefon', 'tel', 'mobile', 'handy'],
    visit_type: ['type', 'visit_type', 'besuchsart', 'art', 'typ'],
    notes: ['notes', 'notizen', 'bemerkung', 'comment', 'description', 'anmerkung'],
    duration_minutes: ['duration', 'dauer', 'minutes', 'minuten'],
};

function autoMapColumns(headers) {
    const mapping = {};
    const lowerHeaders = headers.map(h => h.toLowerCase().trim());

    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
        const idx = lowerHeaders.findIndex(h => aliases.includes(h));
        if (idx >= 0) {
            mapping[field] = headers[idx];
        }
    }
    return mapping;
}

// ---------------------------------------------------------------------------
// Import UI
// ---------------------------------------------------------------------------

export function showImportSheet(onComplete) {
    showBottomSheet(`
        <div class="px-4 pb-6">
            <h2 class="text-base font-semibold mb-4">Import Appointments</h2>
            <p class="text-sm text-stone-500 mb-4">Upload a CSV or iCal (.ics) file with your appointments.</p>

            <label class="block w-full h-24 border-2 border-dashed border-stone-300 rounded-lg flex flex-col items-center justify-center cursor-pointer hover:border-stone-400 hover:bg-stone-50 transition-colors">
                <i data-lucide="upload" class="w-6 h-6 text-stone-400 mb-1"></i>
                <span class="text-sm text-stone-500">Choose file</span>
                <span class="text-xs text-stone-400">.csv, .ics</span>
                <input id="import-file" type="file" accept=".csv,.ics,.tsv" class="hidden" />
            </label>

            <div id="import-preview" class="mt-4 hidden"></div>
        </div>
    `);

    document.getElementById('import-file').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const text = await file.text();
        const isICal = file.name.endsWith('.ics');

        if (isICal) {
            handleICalImport(text, onComplete);
        } else {
            handleCSVImport(text, onComplete);
        }
    });

    lucide.createIcons();
}

function handleCSVImport(text, onComplete) {
    const { headers, rows } = parseCSV(text);
    if (rows.length === 0) {
        showToast('No data found in file');
        return;
    }

    const mapping = autoMapColumns(headers);
    showMappingUI(headers, rows, mapping, onComplete);
}

function handleICalImport(text, onComplete) {
    const events = parseICal(text);
    if (events.length === 0) {
        showToast('No events found in file');
        return;
    }

    // Convert iCal events to import items directly
    const items = events.map(ev => ({
        patient_name: ev.summary || 'Unknown',
        address: ev.location || '',
        date: ev.date || '',
        time: ev.time || '09:00',
        notes: ev.description || '',
    })).filter(item => item.date);

    showPreviewAndConfirm(items, onComplete);
}

function showMappingUI(headers, rows, mapping, onComplete) {
    const preview = document.getElementById('import-preview');
    const fields = ['patient_name', 'address', 'date', 'time', 'phone', 'visit_type', 'notes'];
    const fieldLabels = {
        patient_name: 'Name *', address: 'Address *', date: 'Date *', time: 'Time *',
        phone: 'Phone', visit_type: 'Visit Type', notes: 'Notes',
    };

    let html = `
        <h3 class="text-sm font-medium mb-2">Map columns (${rows.length} rows)</h3>
        <div class="space-y-2 mb-4">
    `;

    for (const field of fields) {
        const options = headers.map(h =>
            `<option value="${escapeHtml(h)}" ${mapping[field] === h ? 'selected' : ''}>${escapeHtml(h)}</option>`
        ).join('');
        html += `
            <div class="flex items-center gap-2">
                <span class="text-xs text-stone-500 w-20 shrink-0">${fieldLabels[field]}</span>
                <select data-field="${field}" class="mapping-select flex-1 h-8 px-2 rounded border border-stone-200 text-xs">
                    <option value="">-- skip --</option>
                    ${options}
                </select>
            </div>
        `;
    }

    html += `
        </div>
        <button id="import-confirm" class="w-full h-11 bg-stone-900 text-white rounded-lg font-medium hover:bg-stone-800">
            Import ${rows.length} appointments
        </button>
    `;

    preview.innerHTML = html;
    preview.classList.remove('hidden');

    document.getElementById('import-confirm').addEventListener('click', () => {
        // Read final mapping
        const finalMapping = {};
        preview.querySelectorAll('.mapping-select').forEach(sel => {
            if (sel.value) finalMapping[sel.dataset.field] = sel.value;
        });

        if (!finalMapping.patient_name || !finalMapping.date || !finalMapping.time) {
            showToast('Name, Date, and Time mappings are required');
            return;
        }

        const items = rows.map(row => {
            const item = {};
            for (const [field, header] of Object.entries(finalMapping)) {
                item[field] = row[header] || '';
            }
            // Normalize date formats
            item.date = normalizeDate(item.date || '');
            return item;
        }).filter(item => item.patient_name && item.date && item.time);

        showPreviewAndConfirm(items, onComplete);
    });
}

function showPreviewAndConfirm(items, onComplete) {
    const preview = document.getElementById('import-preview');

    let tableHtml = `
        <h3 class="text-sm font-medium mb-2">Preview (${items.length} appointments)</h3>
        <div class="overflow-x-auto mb-4 border border-stone-200 rounded-lg">
            <table class="w-full text-xs">
                <thead><tr class="bg-stone-50 border-b border-stone-200">
                    <th class="px-2 py-1.5 text-left font-medium">Name</th>
                    <th class="px-2 py-1.5 text-left font-medium">Date</th>
                    <th class="px-2 py-1.5 text-left font-medium">Time</th>
                    <th class="px-2 py-1.5 text-left font-medium">Address</th>
                </tr></thead>
                <tbody>
    `;

    items.slice(0, 10).forEach(item => {
        const hasError = !item.date || !item.patient_name;
        tableHtml += `
            <tr class="${hasError ? 'bg-red-50' : ''} border-b border-stone-100">
                <td class="px-2 py-1.5">${escapeHtml(item.patient_name)}</td>
                <td class="px-2 py-1.5">${escapeHtml(item.date)}</td>
                <td class="px-2 py-1.5">${escapeHtml(item.time)}</td>
                <td class="px-2 py-1.5 truncate max-w-[120px]">${escapeHtml(item.address || '-')}</td>
            </tr>
        `;
    });

    if (items.length > 10) {
        tableHtml += `<tr><td colspan="4" class="px-2 py-1.5 text-stone-400">...and ${items.length - 10} more</td></tr>`;
    }

    tableHtml += '</tbody></table></div>';

    preview.innerHTML = tableHtml + `
        <button id="import-final" class="w-full h-11 bg-stone-900 text-white rounded-lg font-medium hover:bg-stone-800">
            Confirm Import
        </button>
    `;

    document.getElementById('import-final').addEventListener('click', async () => {
        const btn = document.getElementById('import-final');
        btn.disabled = true;
        btn.textContent = 'Importing...';

        try {
            const result = await api.importAppointments(items);
            closeBottomSheet();
            showToast(`Imported ${result.created_appointments} appointments`);
            if (onComplete) onComplete();
        } catch (err) {
            showToast('Import failed: ' + err.message);
            btn.disabled = false;
            btn.textContent = 'Confirm Import';
        }
    });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeDate(str) {
    if (!str) return '';
    // Already YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
    // DD.MM.YYYY (German)
    const de = str.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (de) return `${de[3]}-${de[2].padStart(2, '0')}-${de[1].padStart(2, '0')}`;
    // MM/DD/YYYY (US)
    const us = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
    return str;
}

