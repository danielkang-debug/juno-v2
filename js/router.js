/**
 * router.js — Hash-based SPA router
 */

import { mapManager } from './map.js';

const routes = {};
let currentView = null;

export const router = {
    register(name, view) {
        routes[name] = view;
    },

    navigateTo(name, params = {}, pushState = true) {
        // Destroy map if leaving a view that has one
        if (currentView && currentView !== name) {
            mapManager.destroy();
        }

        const view = routes[name];
        if (!view) {
            console.error(`[router] Unknown view: ${name}`);
            return;
        }

        currentView = name;

        // Build hash
        const qs = Object.entries(params)
            .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
            .join('&');
        const hash = qs ? `#${name}?${qs}` : `#${name}`;

        if (pushState) {
            history.pushState(null, '', hash);
        }

        // Update nav active state
        document.querySelectorAll('[data-nav]').forEach(el => {
            el.classList.toggle('bg-stone-100', el.dataset.nav === name);
            el.classList.toggle('font-medium', el.dataset.nav === name);
        });

        // Render view
        const main = document.getElementById('main-content');
        view.render(main, params);

        // Update header
        const header = document.getElementById('app-header');
        header.classList.remove('hidden');

        // Re-init Lucide icons
        if (window.lucide) lucide.createIcons();
    },

    parseHash() {
        const hash = location.hash.slice(1) || 'dashboard';
        const [name, queryString] = hash.split('?');
        const params = {};
        if (queryString) {
            new URLSearchParams(queryString).forEach((v, k) => { params[k] = v; });
        }
        return { name, params };
    },

    init() {
        window.addEventListener('popstate', () => {
            const { name, params } = this.parseHash();
            if (routes[name]) {
                this.navigateTo(name, params, false);
            }
        });
    },

    getCurrentView() {
        return currentView;
    }
};
