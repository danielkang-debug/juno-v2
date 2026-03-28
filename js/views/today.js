/**
 * views/today.js — Main screen: appointment list + optimize + map
 */

import { api } from '../api.js';
import { state } from '../state.js';
import { router } from '../router.js';
import { mapManager } from '../map.js';
import { escapeHtml, showBottomSheet, closeBottomSheet, showToast } from '../ui.js';
import { showAddAppointment, showEditAppointment } from './appointment-form.js';
import { exportToGoogleMaps, showNotifySheet } from './notify.js';

let container = null;
let routeStartTime = '08:00'; // persists across re-renders within session

function formatDate(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function shiftDate(dateStr, days) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + days);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

async function render(el, params) {
    container = el;

    if (params.date) state.selectedDate = params.date;

    // Header
    const headerTitle = document.getElementById('header-title');
    const headerActions = document.getElementById('header-actions');
    headerTitle.textContent = '';
    headerActions.innerHTML = '';

    renderShell();
    await loadAppointments();
}

function renderShell() {
    container.innerHTML = `
        <!-- Date navigation -->
        <div class="flex items-center justify-between py-3">
            <button id="prev-day" class="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-stone-100">
                <i data-lucide="chevron-left" class="w-5 h-5"></i>
            </button>
            <div class="text-center">
                <button id="today-label" class="text-base font-semibold">${formatDate(state.selectedDate)}</button>
                <button id="go-today" class="block text-xs text-stone-400 hover:text-stone-600 mx-auto">Today</button>
            </div>
            <button id="next-day" class="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-stone-100">
                <i data-lucide="chevron-right" class="w-5 h-5"></i>
            </button>
        </div>

        <!-- Home address -->
        <div id="home-section"></div>

        <!-- Content -->
        <div id="today-content">
            <div class="flex justify-center py-12">
                <i data-lucide="loader-2" class="w-6 h-6 animate-spin text-stone-300"></i>
            </div>
        </div>
    `;

    // Date nav events
    document.getElementById('prev-day').addEventListener('click', () => {
        state.selectedDate = shiftDate(state.selectedDate, -1);
        state.optimizedRoute = null;
        renderShell();
        loadAppointments();
    });
    document.getElementById('next-day').addEventListener('click', () => {
        state.selectedDate = shiftDate(state.selectedDate, 1);
        state.optimizedRoute = null;
        renderShell();
        loadAppointments();
    });
    document.getElementById('go-today').addEventListener('click', () => {
        state.selectedDate = new Date().toISOString().split('T')[0];
        state.optimizedRoute = null;
        renderShell();
        loadAppointments();
    });

    lucide.createIcons();

    // Render home section
    renderHomeSection();
}

function renderHomeSection() {
    const section = document.getElementById('home-section');
    const user = state.user;

    if (!user) { section.innerHTML = ''; return; }

    if (user.home_address) {
        section.innerHTML = `
            <div id="home-bar" class="flex items-center gap-2 px-3 py-2 bg-stone-50 rounded-lg mb-3 cursor-pointer hover:bg-stone-100">
                <i data-lucide="home" class="w-4 h-4 text-stone-400 shrink-0"></i>
                <span class="text-sm text-stone-600 truncate flex-1">${escapeHtml(user.home_address)}</span>
                <i data-lucide="pencil" class="w-3.5 h-3.5 text-stone-300"></i>
            </div>
        `;
        document.getElementById('home-bar').addEventListener('click', showHomeEditor);
    } else {
        section.innerHTML = `
            <button id="set-home-btn" class="w-full flex items-center gap-2 px-3 py-2 border border-dashed border-stone-300 rounded-lg mb-3 text-sm text-stone-500 hover:bg-stone-50">
                <i data-lucide="home" class="w-4 h-4"></i>
                Set home address
            </button>
        `;
        document.getElementById('set-home-btn').addEventListener('click', showHomeEditor);
    }
    lucide.createIcons();
}

function showHomeEditor() {
    const currentAddr = state.user?.home_address || '';
    showBottomSheet(`
        <div class="px-4 pb-6">
            <h2 class="text-base font-semibold mb-4">Home Address</h2>
            <input id="home-input" type="text" value="${escapeHtml(currentAddr)}" placeholder="Enter your home address"
                class="w-full h-10 px-3 rounded-lg border border-stone-200 text-sm mb-3" />
            <button id="save-home" class="w-full h-11 bg-stone-900 text-white rounded-lg font-medium hover:bg-stone-800">
                Save
            </button>
        </div>
    `);

    document.getElementById('save-home').addEventListener('click', async () => {
        const addr = document.getElementById('home-input').value.trim();
        if (!addr) return;
        const btn = document.getElementById('save-home');
        btn.disabled = true;
        btn.textContent = 'Saving...';
        try {
            const user = await api.updateMe({ home_address: addr });
            state.user = user;
            closeBottomSheet();
            renderHomeSection();
            showToast('Home address saved');
        } catch (err) {
            showToast('Could not save address');
            btn.disabled = false;
            btn.textContent = 'Save';
        }
    });
}

// ---------------------------------------------------------------------------
// Load Appointments
// ---------------------------------------------------------------------------

async function loadAppointments() {
    try {
        const apts = await api.getAppointments({ date: state.selectedDate });
        state.appointments = apts;
        // Preserve a pre-loaded optimized route (e.g. from dashboard "Plan today")
        if (!state.optimizedRoute || state.optimizedRoute.date !== state.selectedDate) {
            state.optimizedRoute = null;
        }
        renderAppointmentList();
    } catch (err) {
        document.getElementById('today-content').innerHTML =
            `<p class="text-center text-red-500 py-8">${escapeHtml(err.message)}</p>`;
    }
}

// ---------------------------------------------------------------------------
// Timeline helpers
// ---------------------------------------------------------------------------

const PX_PER_HOUR = 64;

function minutesToPx(minutes, dayStartMinutes) {
    return (minutes - dayStartMinutes) * PX_PER_HOUR / 60;
}

function computeDayRange(apts, etas) {
    let earliest = 8 * 60;
    let latest = 18 * 60;
    for (const apt of apts) {
        const isFlex = apt.appointment_kind !== 'fixed';
        const assignedTime = etas[apt.id];
        let startMin, endMin;
        if (isFlex && !assignedTime) {
            startMin = timeToMinutes(apt.window_start || apt.time || '08:00');
            endMin   = timeToMinutes(apt.window_end   || apt.time || '18:00');
        } else {
            startMin = timeToMinutes(assignedTime || apt.time || '08:00');
            endMin   = startMin + (apt.duration_minutes || 60);
        }
        earliest = Math.min(earliest, startMin - 60);
        latest   = Math.max(latest,   endMin   + 60);
    }
    return {
        earliest: Math.floor(Math.min(earliest, 8 * 60) / 60) * 60,
        latest:   Math.ceil( Math.max(latest,  18 * 60) / 60) * 60,
    };
}

function assignColumns(blocks) {
    const sorted = [...blocks].sort((a, b) => a.startMin - b.startMin);
    const colEnds = []; // endMin of last block in each column
    for (const block of sorted) {
        let placed = false;
        for (let c = 0; c < colEnds.length; c++) {
            if (colEnds[c] <= block.startMin) {
                block.colIndex = c;
                colEnds[c] = block.endMin;
                placed = true;
                break;
            }
        }
        if (!placed) {
            block.colIndex = colEnds.length;
            colEnds.push(block.endMin);
        }
    }
    const totalCols = Math.max(colEnds.length, 1);
    blocks.forEach(b => { b.colTotal = totalCols; });
    return blocks;
}

function renderTimeline(apts, etas) {
    const { earliest, latest } = computeDayRange(apts, etas);
    const totalHeight = minutesToPx(latest, earliest);

    // Build block descriptors
    const blocks = apts.map(apt => {
        const isFlex = apt.appointment_kind !== 'fixed';
        const assignedTime = etas[apt.id];
        const isWindowMode = isFlex && !assignedTime;
        const startMin = isWindowMode
            ? timeToMinutes(apt.window_start || apt.time || '08:00')
            : timeToMinutes(assignedTime || apt.time || '08:00');
        const endMin = isWindowMode
            ? timeToMinutes(apt.window_end || apt.time || '18:00')
            : startMin + (apt.duration_minutes || 60);
        return { ...apt, startMin, endMin, isWindowMode };
    });

    assignColumns(blocks);

    // Hour labels + grid lines
    let hoursHtml = '';
    for (let m = earliest; m <= latest; m += 60) {
        const h = Math.floor(m / 60);
        const label = h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`;
        const top = minutesToPx(m, earliest);
        hoursHtml += `
            <div class="absolute left-0 right-0 flex items-start pointer-events-none" style="top:${top}px;">
                <span class="w-11 text-right pr-2 text-[10px] text-stone-400 leading-none shrink-0" style="margin-top:-6px;">${label}</span>
                <div class="flex-1 border-t border-stone-100"></div>
            </div>`;
    }

    // Now-line (today only)
    let nowHtml = '';
    const todayStr = new Date().toISOString().split('T')[0];
    if (state.selectedDate === todayStr) {
        const now = new Date();
        const nowMin = now.getHours() * 60 + now.getMinutes();
        const nowTop = minutesToPx(nowMin, earliest);
        if (nowTop >= 0 && nowTop <= totalHeight) {
            nowHtml = `
                <div class="absolute pointer-events-none z-10" style="left:44px;right:0;top:${nowTop}px;">
                    <div class="relative" style="height:2px;background:#ef4444;">
                        <div class="absolute rounded-full" style="width:10px;height:10px;background:#ef4444;left:-5px;top:-4px;"></div>
                    </div>
                </div>`;
        }
    }

    // Appointment blocks
    const blocksHtml = blocks.map(b => {
        const top    = minutesToPx(b.startMin, earliest);
        const height = Math.max(minutesToPx(b.endMin, earliest) - top, 22);
        const colWidthPct  = 100 / b.colTotal;
        const leftPct  = b.colIndex * colWidthPct;
        const rightPct = (b.colTotal - b.colIndex - 1) * colWidthPct;

        const timeLabel = b.isWindowMode
            ? `${b.window_start}–${b.window_end} · ${b.visit_type} · ${b.duration_minutes || 60} min`
            : `${etas[b.id] || b.time} · ${b.visit_type} · ${b.duration_minutes || 60} min`;

        const blockStyle = b.isWindowMode
            ? 'background:rgba(168,162,158,0.10);border:1.5px dashed #a8a29e;color:#44403c;'
            : 'background:#1c1917;color:#fff;';

        return `
            <div class="absolute rounded-md overflow-hidden cursor-pointer"
                 style="top:${top}px;height:${height}px;left:calc(${leftPct}% + 2px);right:calc(${rightPct}% + 2px);padding:4px 7px;box-sizing:border-box;${blockStyle}"
                 data-apt-id="${b.id}">
                <div style="font-size:11px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.3;">${escapeHtml(b.patient_name)}</div>
                ${height > 30 ? `<div style="font-size:10px;opacity:0.7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(timeLabel)}</div>` : ''}
            </div>`;
    }).join('');

    return `
        <div class="relative mb-3" style="height:${totalHeight}px;">
            ${hoursHtml}
            <!-- Appointment column (starts after 44px time gutter) -->
            <div class="absolute inset-y-0" style="left:44px;right:0;">
                ${nowHtml}
                ${blocksHtml}
            </div>
        </div>`;
}

// ---------------------------------------------------------------------------
// Render appointment list (timeline view)
// ---------------------------------------------------------------------------

function renderAppointmentList() {
    const content = document.getElementById('today-content');
    const apts = state.optimizedRoute
        ? state.optimizedRoute.ordered_appointments
        : state.appointments;
    const etas = state.optimizedRoute?.etas || {};
    const isOptimized = !!state.optimizedRoute;

    let html = '';

    // Header row
    html += `
        <div class="flex items-center justify-between mb-3">
            <span class="text-sm text-stone-500">${apts.length} appointment${apts.length !== 1 ? 's' : ''}</span>
            <button id="import-btn" class="p-2 rounded-lg hover:bg-stone-100" title="Import">
                <i data-lucide="upload" class="w-4 h-4"></i>
            </button>
        </div>
    `;

    if (isOptimized) {
        html += `
            <div class="bg-white rounded-lg border border-stone-200 p-3 mb-3 flex items-center gap-3">
                <i data-lucide="route" class="w-5 h-5 text-stone-400"></i>
                <div class="flex-1">
                    <span class="text-sm font-medium">${apts.length} stops</span>
                    <span class="text-sm text-stone-500 ml-2">${state.optimizedRoute.total_distance_km} km</span>
                </div>
            </div>
        `;
        html += `<div id="route-map" class="h-48 md:h-72 rounded-lg overflow-hidden mb-3 border border-stone-200"></div>`;
    }

    if (apts.length === 0) {
        html += `
            <div class="text-center py-8 text-stone-400 text-sm">No appointments for this day</div>
            <button id="add-apt-row" class="w-full flex items-center justify-center gap-2 py-3 rounded-lg border border-dashed border-stone-300 text-sm text-stone-400 hover:bg-stone-50 mb-3">
                <span class="text-base leading-none">+</span> Add appointment
            </button>
        `;
    } else {
        // Timeline
        html += renderTimeline(apts, etas);

        // Inline add row (only before optimization)
        if (!isOptimized) {
            html += `
                <button id="add-apt-row" class="w-full flex items-center justify-center gap-2 py-3 rounded-lg border border-dashed border-stone-300 text-sm text-stone-400 hover:bg-stone-50 mt-1 mb-3">
                    <span class="text-base leading-none">+</span> Add appointment
                </button>
            `;
        }

        // Action buttons
        if (isOptimized) {
            html += `
                <div class="space-y-2 mt-4">
                    <button id="export-maps-btn" class="w-full h-11 flex items-center justify-center gap-2 bg-white border border-stone-200 rounded-lg font-medium text-sm hover:bg-stone-50">
                        <i data-lucide="navigation" class="w-4 h-4"></i>
                        Export to Google Maps
                    </button>
                    <button id="notify-btn" class="w-full h-11 flex items-center justify-center gap-2 bg-white border border-stone-200 rounded-lg font-medium text-sm hover:bg-stone-50">
                        <i data-lucide="message-circle" class="w-4 h-4"></i>
                        Notify Mothers
                    </button>
                    <button id="start-route-btn" class="w-full h-11 bg-stone-900 text-white rounded-lg font-medium hover:bg-stone-800 flex items-center justify-center gap-2">
                        <i data-lucide="play" class="w-4 h-4"></i>
                        Start Route
                    </button>
                </div>
            `;
        } else {
            const bufferVal = state.user?.buffer_minutes ?? 15;
            html += `
                <div class="mt-4 mb-3 space-y-2">
                    <div class="flex items-center gap-3">
                        <label class="text-sm text-stone-500 whitespace-nowrap">Leave home at</label>
                        <input id="start-time-input" type="time" value="${routeStartTime}"
                            class="h-10 px-3 rounded-lg border border-stone-200 text-sm flex-1" />
                    </div>
                    <div class="flex items-center gap-3">
                        <label class="text-sm text-stone-500 whitespace-nowrap">Buffer between visits</label>
                        <select id="buffer-select" class="h-10 px-3 rounded-lg border border-stone-200 text-sm flex-1">
                            <option value="0" ${bufferVal == 0 ? 'selected' : ''}>None</option>
                            <option value="5" ${bufferVal == 5 ? 'selected' : ''}>5 min</option>
                            <option value="10" ${bufferVal == 10 ? 'selected' : ''}>10 min</option>
                            <option value="15" ${bufferVal == 15 ? 'selected' : ''}>15 min</option>
                            <option value="20" ${bufferVal == 20 ? 'selected' : ''}>20 min</option>
                            <option value="30" ${bufferVal == 30 ? 'selected' : ''}>30 min</option>
                        </select>
                    </div>
                </div>
                <button id="optimize-btn" class="w-full h-12 bg-stone-900 text-white rounded-lg font-medium hover:bg-stone-800 flex items-center justify-center gap-2">
                    <i data-lucide="route" class="w-5 h-5"></i>
                    Optimize Route
                </button>
            `;
        }
    }

    content.innerHTML = html;

    // Event listeners
    document.getElementById('optimize-btn')?.addEventListener('click', optimizeRoute);
    document.getElementById('export-maps-btn')?.addEventListener('click', exportToGoogleMaps);
    document.getElementById('notify-btn')?.addEventListener('click', showNotifySheet);
    document.getElementById('start-route-btn')?.addEventListener('click', startRoute);
    document.getElementById('add-apt-row')?.addEventListener('click', () => showAddAppointment(loadAppointments));
    document.getElementById('import-btn')?.addEventListener('click', showImport);

    // Route settings inputs
    document.getElementById('start-time-input')?.addEventListener('change', (e) => {
        routeStartTime = e.target.value;
    });
    document.getElementById('buffer-select')?.addEventListener('change', async (e) => {
        const val = parseInt(e.target.value);
        try {
            const user = await api.updateMe({ buffer_minutes: val });
            state.user = user;
        } catch (err) {
            showToast('Could not save buffer setting');
        }
    });

    // Block click → edit
    document.querySelectorAll('[data-apt-id]').forEach(block => {
        block.addEventListener('click', () => {
            const aptId = block.dataset.aptId;
            const apt = (state.optimizedRoute?.ordered_appointments || state.appointments)
                .find(a => a.id === aptId);
            if (apt) showEditAppointment(apt, loadAppointments);
        });
    });

    lucide.createIcons();

    // Render map if optimized
    if (isOptimized) {
        setTimeout(() => renderMap(), 50);
    }
}

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

function timeToMinutes(str) {
    if (!str) return 0;
    const [h, m] = str.split(':').map(Number);
    return h * 60 + (m || 0);
}


// ---------------------------------------------------------------------------
// Optimize
// ---------------------------------------------------------------------------

async function optimizeRoute() {
    const btn = document.getElementById('optimize-btn');
    if (!btn) return;
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader-2" class="w-5 h-5 animate-spin"></i> Optimizing...';
    lucide.createIcons();

    try {
        const startTime = document.getElementById('start-time-input')?.value || routeStartTime;
        const result = await api.optimizeRoute({ date: state.selectedDate, start_time: startTime });
        state.optimizedRoute = result;
        renderAppointmentList();
    } catch (err) {
        showToast('Optimization failed: ' + err.message);
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="route" class="w-5 h-5"></i> Optimize Route';
        lucide.createIcons();
    }
}

// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------

function renderMap() {
    const route = state.optimizedRoute;
    if (!route) return;

    mapManager.init('route-map');

    const user = state.user;
    if (user?.home_lat != null) {
        mapManager.addHomePin(user.home_lat, user.home_lon, user.home_address);
    }

    route.ordered_appointments.forEach((apt, i) => {
        if (apt.lat != null && apt.lon != null) {
            mapManager.addPin(apt.lat, apt.lon, `<strong>${escapeHtml(apt.patient_name)}</strong><br/>${escapeHtml(apt.address || '')}`, i + 1);
        }
    });

    if (route.road_geometry) {
        mapManager.drawRoute(route.road_geometry);
    } else {
        const waypoints = [];
        if (user?.home_lat != null) waypoints.push([user.home_lat, user.home_lon]);
        route.ordered_appointments.forEach(a => {
            if (a.lat != null) waypoints.push([a.lat, a.lon]);
        });
        if (user?.home_lat != null) waypoints.push([user.home_lat, user.home_lon]);
        mapManager.drawDashedRoute(waypoints);
    }

    mapManager.fitBounds();
    lucide.createIcons();
}

// ---------------------------------------------------------------------------
// Start Route (Driver Mode)
// ---------------------------------------------------------------------------

function startRoute() {
    const route = state.optimizedRoute;
    if (!route) return;

    state.driverMode = {
        active: true,
        currentStopIndex: 0,
        completedStops: [],
        routeDate: state.selectedDate,
        startedAt: new Date().toISOString(),
        route: route,
    };

    localStorage.setItem('juno_driver_mode', JSON.stringify(state.driverMode));
    router.navigateTo('driver');
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

async function showImport() {
    const { showImportSheet } = await import('../import.js');
    showImportSheet(async () => {
        await loadAppointments();
    });
}

export const todayView = { render };
