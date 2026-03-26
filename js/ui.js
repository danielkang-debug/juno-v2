/**
 * ui.js — Shared UI utilities: bottom sheet, toast, escapeHtml
 */

export function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}

export function showBottomSheet(html) {
    closeBottomSheet();

    const backdrop = document.createElement('div');
    backdrop.className = 'bottom-sheet-backdrop';
    backdrop.id = 'bs-backdrop';
    backdrop.addEventListener('click', closeBottomSheet);

    const sheet = document.createElement('div');
    sheet.className = 'bottom-sheet';
    sheet.id = 'bs-sheet';
    sheet.innerHTML = `<div class="drag-handle"></div>${html}`;

    document.body.appendChild(backdrop);
    document.body.appendChild(sheet);

    requestAnimationFrame(() => {
        backdrop.classList.add('open');
        sheet.classList.add('open');
    });

    lucide.createIcons();
}

export function closeBottomSheet() {
    const backdrop = document.getElementById('bs-backdrop');
    const sheet = document.getElementById('bs-sheet');
    if (backdrop) {
        backdrop.classList.remove('open');
        setTimeout(() => backdrop.remove(), 300);
    }
    if (sheet) {
        sheet.classList.remove('open');
        setTimeout(() => sheet.remove(), 300);
    }
}

export function showToast(msg) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// Keep window globals for backward compatibility during transition
window.showBottomSheet = showBottomSheet;
window.closeBottomSheet = closeBottomSheet;
window.showToast = showToast;
