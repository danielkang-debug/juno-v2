/**
 * views/dashboard.js — Dashboard: stats + quick-add + upcoming appointments
 */

import { api } from '../api.js';
import { state } from '../state.js';
import { router } from '../router.js';
import { escapeHtml, showToast } from '../ui.js';
import { showAddAppointment } from './appointment-form.js';

function todayStr() {
    return new Date().toISOString().split('T')[0];
}

function greeting() {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
}

function formatDayLabel(dateStr) {
    const today = todayStr();
    const tomorrow = new Date(today + 'T00:00:00');
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    if (dateStr === today) return 'Today';
    if (dateStr === tomorrowStr) return 'Tomorrow';

    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

async function render(el) {
    const headerTitle = document.getElementById('header-title');
    const headerActions = document.getElementById('header-actions');
    headerTitle.textContent = '';
    headerActions.innerHTML = '';

    el.innerHTML = `
        <div class="py-2">
            <p class="text-base font-semibold mb-4" id="dash-greeting"></p>

            <!-- Stat tiles -->
            <div class="grid grid-cols-2 gap-3 mb-4" id="dash-stats">
                <div class="bg-white rounded-xl border border-stone-200 p-4 animate-pulse h-20"></div>
                <div class="bg-white rounded-xl border border-stone-200 p-4 animate-pulse h-20"></div>
            </div>

            <!-- Quick actions -->
            <div class="flex gap-2 mb-5">
                <button id="dash-plan-btn"
                    class="flex-1 h-11 bg-stone-900 text-white rounded-lg font-medium hover:bg-stone-800 flex items-center justify-center gap-2">
                    <i data-lucide="route" class="w-4 h-4"></i>
                    Plan today
                </button>
                <button id="dash-add-btn"
                    class="flex-1 h-11 border border-stone-200 rounded-lg font-medium text-sm hover:bg-stone-50 flex items-center justify-center gap-2">
                    <i data-lucide="plus" class="w-4 h-4"></i>
                    Add appointment
                </button>
            </div>

            <!-- Upcoming -->
            <div class="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-3">Upcoming</div>
            <div id="dash-upcoming">
                <div class="flex justify-center py-8">
                    <i data-lucide="loader-2" class="w-5 h-5 animate-spin text-stone-300"></i>
                </div>
            </div>
        </div>
    `;

    lucide.createIcons();

    // Greeting
    const name = state.user?.name?.split(' ')[0] || '';
    document.getElementById('dash-greeting').textContent =
        name ? `${greeting()}, ${name}` : greeting();

    // Plan today
    document.getElementById('dash-plan-btn').addEventListener('click', async () => {
        const btn = document.getElementById('dash-plan-btn');
        btn.disabled = true;
        btn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Optimizing...';
        lucide.createIcons();
        try {
            const result = await api.optimizeRoute({ date: todayStr() });
            state.optimizedRoute = result;
            state.selectedDate = todayStr();
            router.navigateTo('today', { date: todayStr() });
        } catch (err) {
            showToast('Could not optimize: ' + err.message);
            btn.disabled = false;
            btn.innerHTML = '<i data-lucide="route" class="w-4 h-4"></i> Plan today';
            lucide.createIcons();
        }
    });

    // Quick add
    document.getElementById('dash-add-btn').addEventListener('click', () => {
        showAddAppointment(async () => {
            await loadData(el);
        });
    });

    await loadData(el);
}

async function loadData(el) {
    try {
        const today = todayStr();
        const apts = await api.getAppointments({ from: today, days: 7 });

        renderStats(apts, today);
        renderUpcoming(apts, today);
    } catch (err) {
        document.getElementById('dash-upcoming').innerHTML =
            `<p class="text-sm text-red-500 text-center py-4">${escapeHtml(err.message)}</p>`;
    }
}

function renderStats(apts, today) {
    const todayCount = apts.filter(a => a.date === today).length;
    const weekCount = apts.length;

    document.getElementById('dash-stats').innerHTML = `
        <div class="bg-white rounded-xl border border-stone-200 p-4">
            <div class="text-xs text-stone-400 mb-1">Today</div>
            <div class="text-2xl font-bold leading-none mb-1">${todayCount}</div>
            <div class="text-xs text-stone-500">appointment${todayCount !== 1 ? 's' : ''}</div>
        </div>
        <div class="bg-white rounded-xl border border-stone-200 p-4">
            <div class="text-xs text-stone-400 mb-1">This week</div>
            <div class="text-2xl font-bold leading-none mb-1">${weekCount}</div>
            <div class="text-xs text-stone-500">appointment${weekCount !== 1 ? 's' : ''}</div>
        </div>
    `;
}

function renderUpcoming(apts, today) {
    const container = document.getElementById('dash-upcoming');

    if (apts.length === 0) {
        container.innerHTML = `<p class="text-sm text-stone-400 text-center py-8">No appointments in the next 7 days</p>`;
        return;
    }

    // Group by date
    const byDate = {};
    for (const apt of apts) {
        if (!byDate[apt.date]) byDate[apt.date] = [];
        byDate[apt.date].push(apt);
    }

    let html = '';
    for (const [date, dayApts] of Object.entries(byDate).sort()) {
        const label = formatDayLabel(date);
        const isToday = date === today;

        html += `
            <div class="text-xs font-semibold mb-2 mt-4 first:mt-0 ${isToday ? 'text-stone-800' : 'text-stone-500'}">
                ${escapeHtml(label)}${isToday ? ` · <button class="underline underline-offset-2 font-normal" data-goto-date="${escapeHtml(date)}">View full day</button>` : ''}
            </div>
        `;

        for (const apt of dayApts.sort((a, b) => a.time.localeCompare(b.time))) {
            html += `
                <div class="bg-white rounded-lg border border-stone-200 p-3 mb-1.5 cursor-pointer hover:bg-stone-50"
                     data-goto-date="${escapeHtml(apt.date)}">
                    <div class="flex items-center justify-between mb-0.5">
                        <span class="text-sm font-medium">${escapeHtml(apt.patient_name)}</span>
                        <span class="text-sm text-stone-400">${escapeHtml(apt.time)}</span>
                    </div>
                    <div class="text-xs text-stone-400">${apt.duration_minutes || 60} min · ${escapeHtml(apt.visit_type || 'visit')}</div>
                </div>
            `;
        }
    }

    container.innerHTML = html;

    // Navigate to today view for that date on click
    container.querySelectorAll('[data-goto-date]').forEach(el => {
        el.addEventListener('click', () => {
            router.navigateTo('today', { date: el.dataset.gotoDate });
        });
    });
}

export const dashboardView = { render };
