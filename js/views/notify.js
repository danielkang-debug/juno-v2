/**
 * views/notify.js — Notify mothers & export to Google Maps
 */

import { state } from '../state.js';
import { escapeHtml, showBottomSheet, showToast } from '../ui.js';

// ---------------------------------------------------------------------------
// Export to Google Maps
// ---------------------------------------------------------------------------

export function exportToGoogleMaps() {
    const route = state.optimizedRoute;
    if (!route) return;

    const user = state.user;
    const stops = [];

    if (user?.home_lat != null) {
        stops.push(`${user.home_lat},${user.home_lon}`);
    }

    route.ordered_appointments.forEach(apt => {
        if (apt.lat != null && apt.lon != null) {
            stops.push(`${apt.lat},${apt.lon}`);
        }
    });

    if (user?.home_lat != null) {
        stops.push(`${user.home_lat},${user.home_lon}`);
    }

    if (stops.length < 2) {
        showToast('Need at least 2 locations');
        return;
    }

    const url = `https://www.google.com/maps/dir/${stops.join('/')}`;
    window.open(url, '_blank');
}

// ---------------------------------------------------------------------------
// Notify Mothers
// ---------------------------------------------------------------------------

export function showNotifySheet() {
    const route = state.optimizedRoute;
    if (!route) return;

    const etas = route.etas || {};

    let messagesHtml = '';
    route.ordered_appointments.forEach(apt => {
        const eta = etas[apt.id] || apt.time;
        const msg = `Hi ${apt.patient_name.split(' ')[0]}, I'll be at your place around ${eta}.`;
        const phone = (apt.phone || '').replace(/\s/g, '');
        const waLink = phone ? `https://wa.me/${phone.replace('+', '')}?text=${encodeURIComponent(msg)}` : '';

        messagesHtml += `
            <div class="py-3 ${messagesHtml ? 'border-t border-stone-100' : ''}">
                <div class="flex items-center justify-between mb-1">
                    <span class="text-sm font-medium">${escapeHtml(apt.patient_name)}</span>
                    <span class="text-xs text-stone-400">ETA ${eta}</span>
                </div>
                <p class="text-sm text-stone-600 mb-2">"${escapeHtml(msg)}"</p>
                <div class="flex gap-2">
                    <button class="copy-msg-btn flex-1 h-9 flex items-center justify-center gap-1.5 rounded-lg border border-stone-200 text-sm hover:bg-stone-50" data-msg="${escapeHtml(msg)}">
                        <i data-lucide="copy" class="w-3.5 h-3.5"></i> Copy
                    </button>
                    ${waLink ? `
                        <a href="${waLink}" target="_blank" class="flex-1 h-9 flex items-center justify-center gap-1.5 rounded-lg border border-stone-200 text-sm hover:bg-stone-50">
                            <i data-lucide="message-circle" class="w-3.5 h-3.5"></i> WhatsApp
                        </a>
                    ` : ''}
                    ${phone ? `
                        <a href="tel:${phone}" class="h-9 w-9 flex items-center justify-center rounded-lg border border-stone-200 hover:bg-stone-50">
                            <i data-lucide="phone" class="w-3.5 h-3.5"></i>
                        </a>
                    ` : ''}
                </div>
            </div>
        `;
    });

    showBottomSheet(`
        <div class="px-4 pb-6">
            <div class="flex items-center justify-between mb-4">
                <h2 class="text-base font-semibold">Notify Mothers</h2>
            </div>
            ${messagesHtml}
            <button id="copy-all-btn" class="w-full h-11 mt-3 flex items-center justify-center gap-2 bg-stone-900 text-white rounded-lg font-medium text-sm hover:bg-stone-800">
                <i data-lucide="copy" class="w-4 h-4"></i> Copy All Messages
            </button>
        </div>
    `);

    // Copy individual message buttons
    document.querySelectorAll('.copy-msg-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            navigator.clipboard.writeText(btn.dataset.msg);
            btn.innerHTML = '<i data-lucide="check" class="w-3.5 h-3.5"></i> Copied';
            lucide.createIcons();
            setTimeout(() => {
                btn.innerHTML = '<i data-lucide="copy" class="w-3.5 h-3.5"></i> Copy';
                lucide.createIcons();
            }, 2000);
        });
    });

    // Copy all
    document.getElementById('copy-all-btn')?.addEventListener('click', () => {
        const allMsgs = route.ordered_appointments.map(apt => {
            const eta = etas[apt.id] || apt.time;
            return `${apt.patient_name}: Hi ${apt.patient_name.split(' ')[0]}, I'll be at your place around ${eta}.`;
        }).join('\n\n');
        navigator.clipboard.writeText(allMsgs);
        showToast('All messages copied');
    });

    lucide.createIcons();
}
