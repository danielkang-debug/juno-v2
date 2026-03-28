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
let reorderInProgress = false;

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

function renderAppointmentList() {
    const content = document.getElementById('today-content');
    const apts = state.optimizedRoute
        ? state.optimizedRoute.ordered_appointments
        : state.appointments;
    const etas = state.optimizedRoute?.etas || {};
    const legs = state.optimizedRoute?.legs || [];
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
        // Starting point card
        if (isOptimized && state.user?.home_lat != null) {
            const firstLeg = legs[0];
            const departureTime = state.optimizedRoute.departure_time || '';
            html += `
                <div class="bg-stone-50 rounded-lg border border-stone-200 p-3 mb-1 flex items-center gap-3">
                    <i data-lucide="home" class="w-5 h-5 text-stone-400"></i>
                    <div class="flex-1">
                        <span class="text-sm font-medium">Start</span>
                        ${departureTime ? `<span class="text-sm text-stone-500 ml-2">Depart ${departureTime}</span>` : ''}
                        <div class="text-xs text-stone-400 truncate mt-0.5">${escapeHtml(state.user.home_address || '')}</div>
                    </div>
                </div>
            `;
            if (firstLeg) {
                html += `
                    <div class="flex items-center gap-2 py-1 pl-5">
                        <div class="w-px h-4 bg-stone-300"></div>
                        <span class="text-xs text-stone-400">${firstLeg.distance_km} km &middot; ${firstLeg.minutes} min</span>
                    </div>
                `;
            }
        }

        // Appointment cards
        apts.forEach((apt, i) => {
            const isFixed = apt.appointment_kind === 'fixed';
            const eta = etas[apt.id];
            const num = isOptimized ? i + 1 : null;

            if (isOptimized && i > 0) {
                const legIdx = state.user?.home_lat != null ? i : i - 1;
                const leg = legs[legIdx];
                if (leg) {
                    html += `
                        <div class="flex items-center gap-2 py-1 pl-5">
                            <div class="w-px h-4 bg-stone-300"></div>
                            <span class="text-xs text-stone-400">${leg.distance_km} km &middot; ${leg.minutes} min</span>
                        </div>
                    `;
                }
            }

            html += `
                <div class="bg-white rounded-lg border border-stone-200 p-3 mb-1" data-apt-id="${apt.id}">
                    <div class="flex items-start gap-3">
                        ${num ? `<span class="w-6 h-6 rounded-full bg-stone-900 text-white text-xs flex items-center justify-center shrink-0 mt-0.5">${num}</span>` : ''}
                        <div class="flex-1 min-w-0">
                            <div class="flex items-center gap-2 mb-0.5">
                                <span class="text-sm font-medium">${escapeHtml(apt.patient_name)}</span>
                                <span class="text-xs px-1.5 py-0.5 rounded ${isFixed ? 'bg-stone-100 text-stone-600' : 'bg-stone-50 text-stone-400 border border-dashed border-stone-300'}">${isFixed ? 'Fixed' : 'Flex'}</span>
                            </div>
                            <div class="text-sm text-stone-500">
                                ${eta ? `ETA ${eta}` : apt.time} · ${apt.duration_minutes || 60} min · ${apt.visit_type || 'Visit'}
                            </div>
                            <div class="text-xs text-stone-400 truncate mt-0.5">${escapeHtml(apt.address || '')}</div>
                            ${!apt.lat && apt.address ? '<div class="text-xs text-red-500 mt-0.5">No location found</div>' : ''}
                        </div>
                        ${!isOptimized ? `<span class="text-sm text-stone-400 shrink-0">${apt.time}</span>` : ''}
                        ${isOptimized ? `
                            <div class="flex flex-col gap-0.5 shrink-0 ml-1">
                                <button class="reorder-btn w-7 h-7 flex items-center justify-center rounded hover:bg-stone-100 ${i === 0 ? 'invisible' : ''}" data-dir="up" data-idx="${i}">
                                    <i data-lucide="chevron-up" class="w-4 h-4 text-stone-400"></i>
                                </button>
                                <button class="reorder-btn w-7 h-7 flex items-center justify-center rounded hover:bg-stone-100 ${i === apts.length - 1 ? 'invisible' : ''}" data-dir="down" data-idx="${i}">
                                    <i data-lucide="chevron-down" class="w-4 h-4 text-stone-400"></i>
                                </button>
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;
        });

        // Total round-trip distance
        if (isOptimized && state.optimizedRoute.total_distance_km != null) {
            const lastLeg = legs[legs.length - 1];
            const returnInfo = lastLeg && lastLeg.to_id === 'home'
                ? `${lastLeg.distance_km} km return`
                : '';
            if (returnInfo) {
                html += `
                    <div class="flex items-center gap-2 py-1 pl-5">
                        <div class="w-px h-4 bg-stone-300"></div>
                        <span class="text-xs text-stone-400">${returnInfo}</span>
                    </div>
                `;
            }
            html += `
                <div class="bg-stone-50 rounded-lg border border-stone-200 p-3 mb-1 flex items-center gap-3">
                    <i data-lucide="home" class="w-5 h-5 text-stone-400"></i>
                    <div class="flex-1">
                        <span class="text-sm font-medium">Total round trip</span>
                        <span class="text-sm text-stone-500 ml-2">${state.optimizedRoute.total_distance_km} km</span>
                    </div>
                </div>
            `;
        }

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

    // Appointment card click → edit (ignore reorder button clicks)
    document.querySelectorAll('[data-apt-id]').forEach(card => {
        card.style.cursor = 'pointer';
        card.addEventListener('click', (e) => {
            if (e.target.closest('.reorder-btn')) return;
            const aptId = card.dataset.aptId;
            const apt = (state.optimizedRoute?.ordered_appointments || state.appointments)
                .find(a => a.id === aptId);
            if (apt) showEditAppointment(apt, loadAppointments);
        });
    });

    // Reorder buttons
    document.querySelectorAll('.reorder-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            handleReorder(parseInt(btn.dataset.idx), btn.dataset.dir);
        });
    });

    lucide.createIcons();

    // Render map if optimized
    if (isOptimized) {
        setTimeout(() => renderMap(), 50);
    }
}

// ---------------------------------------------------------------------------
// Reorder
// ---------------------------------------------------------------------------

function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const toRad = (v) => v * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function recomputeLocally(newOrder, route) {
    const departureMins = timeToMinutes(route.departure_time || routeStartTime);
    const bufferMins = route.buffer_minutes ?? 15;
    const user = state.user;
    const hasHome = user?.home_lat != null;

    // Compute ETAs and legs by walking the ordered list
    const etas = {};
    const legs = [];
    let currentTime = departureMins;
    let prevLat = hasHome ? user.home_lat : null;
    let prevLon = hasHome ? user.home_lon : null;
    let prevId = hasHome ? 'home' : null;

    for (const apt of newOrder) {
        if (apt.lat == null) continue;
        if (prevLat != null) {
            const dist = haversineKm(prevLat, prevLon, apt.lat, apt.lon);
            const mins = Math.max(1, Math.round((dist / 30) * 60)); // ~30 km/h avg
            legs.push({ from_id: prevId, to_id: apt.id, distance_km: Math.round(dist * 100) / 100, minutes: mins });
            currentTime += mins;
        }
        const windowStart = timeToMinutes(apt.window_start || apt.time || '');
        if (currentTime < windowStart) currentTime = windowStart;
        etas[apt.id] = minutesToTime(currentTime);
        currentTime += (apt.duration_minutes || 60) + bufferMins;
        prevLat = apt.lat;
        prevLon = apt.lon;
        prevId = apt.id;
    }

    // Return-home leg
    if (hasHome && newOrder.length > 0) {
        const last = newOrder[newOrder.length - 1];
        if (last.lat != null) {
            const dist = haversineKm(last.lat, last.lon, user.home_lat, user.home_lon);
            const mins = Math.max(1, Math.round((dist / 30) * 60));
            legs.push({ from_id: last.id, to_id: 'home', distance_km: Math.round(dist * 100) / 100, minutes: mins });
        }
    }

    const totalKm = Math.round(legs.reduce((s, l) => s + l.distance_km, 0) * 10) / 10;

    return {
        ...route,
        ordered_appointments: newOrder,
        etas,
        legs,
        total_distance_km: totalKm,
        road_geometry: null, // cleared until backend updates
    };
}

function timeToMinutes(str) {
    if (!str) return 0;
    const [h, m] = str.split(':').map(Number);
    return h * 60 + (m || 0);
}

function minutesToTime(mins) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function handleReorder(index, direction) {
    if (reorderInProgress) return;
    const route = state.optimizedRoute;
    if (!route) return;

    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    const apts = route.ordered_appointments;
    if (targetIndex < 0 || targetIndex >= apts.length) return;

    // Swap
    const newOrder = [...apts];
    [newOrder[index], newOrder[targetIndex]] = [newOrder[targetIndex], newOrder[index]];

    // Instant local recalculation
    const scrollY = window.scrollY;
    state.optimizedRoute = recomputeLocally(newOrder, route);
    renderAppointmentList();
    window.scrollTo(0, scrollY);

    // Background: get accurate OSRM data and save to server
    reorderInProgress = true;
    api.recalculateRoute({
        date: state.selectedDate,
        ordered_appointment_ids: newOrder.map(a => a.id),
        departure_time: route.departure_time || routeStartTime,
    }).then(result => {
        state.optimizedRoute = result;
        const savedScroll = window.scrollY;
        renderAppointmentList();
        window.scrollTo(0, savedScroll);
    }).catch(() => {
        // Local data is already showing — just skip the OSRM update
    }).finally(() => {
        reorderInProgress = false;
    });
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
