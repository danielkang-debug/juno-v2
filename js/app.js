/**
 * app.js — Entry point: auth check, router init, nav setup
 */

import { state, saveDriverMode } from './state.js';
import { api } from './api.js';
import { router } from './router.js';
import './ui.js'; // Initialize shared UI utilities
import { authView } from './views/auth.js';
import { dashboardView } from './views/dashboard.js';
import { todayView } from './views/today.js';
import { driverView } from './views/driver.js';
import { patientsView } from './views/patients.js';
import { calendarView } from './views/calendar.js';

// Register views
router.register('auth', authView);
router.register('dashboard', dashboardView);
router.register('today', todayView);
router.register('driver', driverView);
router.register('patients', patientsView);
router.register('calendar', calendarView);

// Nav links config
const NAV_LINKS = [
    { name: 'dashboard', label: 'Dashboard', icon: 'layout-dashboard' },
    { name: 'today', label: 'Today', icon: 'route' },
    { name: 'calendar', label: 'Calendar', icon: 'calendar' },
    { name: 'patients', label: 'Mothers', icon: 'user' },
];

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function init() {
    router.init();
    setupNav();
    setupGlobalListeners();

    // Check auth
    try {
        const user = await api.me();
        state.user = user;

        // Check for active driver mode
        if (state.driverMode?.active) {
            router.navigateTo('driver');
            return;
        }

        // Navigate to requested view or default
        const { name, params } = router.parseHash();
        if (name && name !== 'auth') {
            router.navigateTo(name, params);
        } else {
            router.navigateTo('dashboard');
        }
    } catch (e) {
        // Not logged in
        router.navigateTo('auth');
    }

    lucide.createIcons();
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

function setupNav() {
    const navLinks = document.getElementById('nav-links');
    navLinks.innerHTML = NAV_LINKS.map(link => `
        <button data-nav="${link.name}"
            class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-stone-700 hover:bg-stone-100 transition-colors">
            <i data-lucide="${link.icon}" class="w-5 h-5"></i>
            ${link.label}
        </button>
    `).join('') + `
        <div class="border-t border-stone-200 mt-4 pt-4">
            <button id="nav-logout"
                class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-stone-500 hover:bg-stone-100">
                <i data-lucide="log-out" class="w-5 h-5"></i>
                Sign out
            </button>
        </div>
    `;

    // Nav link clicks
    navLinks.querySelectorAll('[data-nav]').forEach(btn => {
        btn.addEventListener('click', () => {
            closeNav();
            router.navigateTo(btn.dataset.nav);
        });
    });

    // Logout
    document.getElementById('nav-logout').addEventListener('click', async () => {
        closeNav();
        try { await api.logout(); } catch (e) {}
        state.user = null;
        state.driverMode = null;
        saveDriverMode();
        router.navigateTo('auth');
    });
}

window.openNav = function() {
    document.getElementById('nav-sidebar').classList.remove('-translate-x-full');
    document.getElementById('nav-backdrop').classList.remove('hidden');
};

window.closeNav = function() {
    document.getElementById('nav-sidebar').classList.add('-translate-x-full');
    document.getElementById('nav-backdrop').classList.add('hidden');
};

function closeNav() {
    window.closeNav();
}

// ---------------------------------------------------------------------------
// Global listeners
// ---------------------------------------------------------------------------

function setupGlobalListeners() {
    // Auth gate: redirect to login on 401
    window.addEventListener('juno:unauthorized', () => {
        state.user = null;
        router.navigateTo('auth');
    });
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
