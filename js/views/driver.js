/**
 * views/driver.js — Driver/tracking mode: current stop + nav + completion + day summary
 */

import { api } from '../api.js';
import { state, saveDriverMode } from '../state.js';
import { router } from '../router.js';
import { mapManager } from '../map.js';
import { escapeHtml } from '../ui.js';

let container = null;

function render(el) {
    container = el;
    document.getElementById('app-header').classList.add('hidden');

    const dm = state.driverMode;
    if (!dm || !dm.active || !dm.route) {
        router.navigateTo('today');
        return;
    }

    const apts = dm.route.ordered_appointments || [];
    const totalStops = apts.length;
    const currentIdx = dm.currentStopIndex;

    // All done?
    if (currentIdx >= totalStops) {
        renderDaySummary();
        return;
    }

    const apt = apts[currentIdx];
    const etas = dm.route.etas || {};
    const eta = etas[apt.id] || apt.time;
    const phone = (apt.phone || '').replace(/\s/g, '');
    const nextApt = currentIdx + 1 < totalStops ? apts[currentIdx + 1] : null;
    const nextEta = nextApt ? (etas[nextApt.id] || nextApt.time) : null;

    // Find travel time to next
    const legs = dm.route.legs || [];
    const nextLeg = nextApt ? legs.find(l => l.to_id === nextApt.id) : null;

    container.innerHTML = `
        <div class="min-h-screen flex flex-col max-w-2xl mx-auto">
            <!-- Top bar -->
            <div class="flex items-center justify-between px-4 py-3">
                <button id="driver-exit" class="flex items-center gap-1 text-sm text-stone-500 hover:text-stone-700">
                    <i data-lucide="x" class="w-4 h-4"></i> Exit
                </button>
                <span class="text-sm font-medium">Stop ${currentIdx + 1} of ${totalStops}</span>
            </div>

            <!-- Current stop card -->
            <div class="px-4 flex-1">
                <div class="mb-6">
                    <h2 class="text-xl font-semibold mb-1">${escapeHtml(apt.patient_name)}</h2>
                    <p class="text-sm text-stone-500 mb-1">${apt.visit_type || 'Visit'}</p>
                    <p class="text-sm text-stone-600">${escapeHtml(apt.address || '')}</p>
                    <p class="text-base font-medium mt-3">ETA: ${eta}</p>
                </div>

                <!-- Action buttons -->
                <div class="flex gap-3 mb-4">
                    ${apt.lat != null ? `
                        <a href="https://www.google.com/maps/dir/?api=1&destination=${apt.lat},${apt.lon}"
                           target="_blank"
                           class="flex-1 h-11 flex items-center justify-center gap-2 bg-white border border-stone-200 rounded-lg text-sm font-medium hover:bg-stone-50">
                            <i data-lucide="navigation" class="w-4 h-4"></i> Navigate
                        </a>
                    ` : ''}
                    ${phone ? `
                        <a href="tel:${phone}"
                           class="h-11 w-11 flex items-center justify-center bg-white border border-stone-200 rounded-lg hover:bg-stone-50">
                            <i data-lucide="phone" class="w-4 h-4"></i>
                        </a>
                    ` : ''}
                </div>

                <!-- Map -->
                <div id="driver-map" class="h-40 md:h-64 rounded-lg overflow-hidden border border-stone-200 mb-4"></div>

                <!-- Next stop preview -->
                ${nextApt ? `
                    <div class="bg-stone-50 rounded-lg p-3 mb-4">
                        <span class="text-xs text-stone-400 uppercase tracking-wide">Next</span>
                        <p class="text-sm font-medium mt-0.5">${escapeHtml(nextApt.patient_name)} · ${nextEta}</p>
                        ${nextLeg ? `<p class="text-xs text-stone-400">~${nextLeg.minutes} min away</p>` : ''}
                    </div>
                ` : ''}
            </div>

            <!-- Arrived button -->
            <div class="sticky bottom-0 p-4 bg-stone-50">
                <button id="arrived-btn" class="w-full h-12 bg-stone-900 text-white rounded-lg font-medium text-base hover:bg-stone-800">
                    Arrived
                </button>
            </div>
        </div>
    `;

    // Event listeners
    document.getElementById('driver-exit').addEventListener('click', exitDriverMode);
    document.getElementById('arrived-btn').addEventListener('click', () => showCompletionSheet(apt));

    // Render mini map
    setTimeout(() => {
        mapManager.init('driver-map');
        if (apt.lat != null) {
            mapManager.addPin(apt.lat, apt.lon, escapeHtml(apt.patient_name), currentIdx + 1);
        }
        const user = state.user;
        if (user?.home_lat != null) {
            mapManager.addHomePin(user.home_lat, user.home_lon, user.home_address);
        }
        mapManager.fitBounds(30);
        lucide.createIcons();
    }, 50);

    lucide.createIcons();
}

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------

function showCompletionSheet(apt) {
    const sheet = document.createElement('div');
    sheet.className = 'bottom-sheet';
    sheet.id = 'bs-sheet';
    sheet.innerHTML = `
        <div class="drag-handle"></div>
        <div class="px-4 pb-6">
            <h2 class="text-base font-semibold mb-4">Visit Complete: ${escapeHtml(apt.patient_name)}</h2>

            <div class="flex gap-2 mb-4">
                <button class="quick-note flex-1 h-10 rounded-lg border border-stone-200 text-sm hover:bg-stone-50" data-note="All normal">
                    All normal
                </button>
                <button class="quick-note flex-1 h-10 rounded-lg border border-stone-200 text-sm hover:bg-stone-50" data-note="Follow-up needed">
                    Follow-up needed
                </button>
            </div>

            <textarea id="completion-notes" rows="3" placeholder="Notes (optional)"
                class="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-stone-900"></textarea>

            <button id="complete-btn" class="w-full h-11 bg-stone-900 text-white rounded-lg font-medium mt-3 hover:bg-stone-800">
                ${state.driverMode.currentStopIndex + 1 >= (state.driverMode.route?.ordered_appointments?.length || 0)
                    ? 'Finish Day'
                    : 'Done, Next Stop'}
            </button>
        </div>
    `;

    const backdrop = document.createElement('div');
    backdrop.className = 'bottom-sheet-backdrop';
    backdrop.id = 'bs-backdrop';

    document.body.appendChild(backdrop);
    document.body.appendChild(sheet);

    requestAnimationFrame(() => {
        backdrop.classList.add('open');
        sheet.classList.add('open');
    });

    // Quick note chips
    sheet.querySelectorAll('.quick-note').forEach(btn => {
        btn.addEventListener('click', () => {
            const notes = document.getElementById('completion-notes');
            notes.value = btn.dataset.note;
            sheet.querySelectorAll('.quick-note').forEach(b => {
                b.classList.remove('bg-stone-900', 'text-white', 'border-stone-900');
            });
            btn.classList.add('bg-stone-900', 'text-white', 'border-stone-900');
        });
    });

    // Complete
    document.getElementById('complete-btn').addEventListener('click', async () => {
        const notes = document.getElementById('completion-notes').value.trim();

        try {
            await api.updateAppointment(apt.id, {
                status: 'completed',
                completed_at: new Date().toISOString(),
                completion_notes: notes,
            });
        } catch (e) {
            // Non-fatal — save locally even if API fails
        }

        // Advance
        state.driverMode.completedStops.push({
            id: apt.id,
            completedAt: new Date().toISOString(),
            notes: notes,
        });
        state.driverMode.currentStopIndex++;
        saveDriverMode();

        // Close sheet
        backdrop.classList.remove('open');
        sheet.classList.remove('open');
        setTimeout(() => {
            backdrop.remove();
            sheet.remove();
            render(container);
        }, 300);
    });
}

// ---------------------------------------------------------------------------
// Day Summary
// ---------------------------------------------------------------------------

function renderDaySummary() {
    const dm = state.driverMode;
    const totalStops = dm.route?.ordered_appointments?.length || 0;
    const completed = dm.completedStops?.length || 0;
    const totalMinutes = dm.route?.total_travel_minutes || 0;
    const started = dm.startedAt ? new Date(dm.startedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '--';
    const finished = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

    container.innerHTML = `
        <div class="min-h-screen flex items-center justify-center">
            <div class="text-center">
                <div class="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                    <i data-lucide="check" class="w-8 h-8 text-green-600"></i>
                </div>
                <h2 class="text-xl font-semibold mb-6">Day Complete</h2>

                <div class="space-y-3 text-sm mb-8">
                    <div class="flex justify-between px-8">
                        <span class="text-stone-500">Visits completed</span>
                        <span class="font-medium">${completed} / ${totalStops}</span>
                    </div>
                    <div class="flex justify-between px-8">
                        <span class="text-stone-500">Total driving</span>
                        <span class="font-medium">~${totalMinutes} min</span>
                    </div>
                    <div class="flex justify-between px-8">
                        <span class="text-stone-500">Started</span>
                        <span class="font-medium">${started}</span>
                    </div>
                    <div class="flex justify-between px-8">
                        <span class="text-stone-500">Finished</span>
                        <span class="font-medium">${finished}</span>
                    </div>
                </div>

                <button id="finish-btn" class="w-full h-11 bg-stone-900 text-white rounded-lg font-medium hover:bg-stone-800">
                    Done
                </button>
            </div>
        </div>
    `;

    document.getElementById('finish-btn').addEventListener('click', () => {
        state.driverMode = null;
        saveDriverMode();
        router.navigateTo('today');
    });

    lucide.createIcons();
}

// ---------------------------------------------------------------------------
// Exit
// ---------------------------------------------------------------------------

function exitDriverMode() {
    if (confirm('Exit driver mode? Your progress is saved.')) {
        router.navigateTo('today');
    }
}

export const driverView = { render };
