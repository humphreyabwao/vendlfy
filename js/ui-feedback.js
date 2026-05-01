// Shared UI feedback utilities — button loading/success/error animations,
// human-readable error messages, and a tiny declarative form-wiring helper.
//
// All save / submit / delete buttons across the app should feed through
// `setBtnState()` so users get IMMEDIATE visual feedback the moment they
// click. The CSS for `.is-loading` / `.is-success` / `.is-error` lives in
// css/style.css and applies to `.btn.btn-primary`, `.btn.btn-secondary`,
// `.btn.btn-danger`, and the HR/branch-specific button classes.

const SPINNER_SVG = '<svg class="ui-btn-spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>';
const CHECK_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
const X_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

function escHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

/**
 * Drive a button through 'loading' → 'success' | 'error' → 'idle'.
 * Captures the original innerHTML on first call so the idle state can be
 * restored verbatim (preserving icons, layout, etc.).
 *
 * @param {HTMLElement|null} btn - the button to update
 * @param {'loading'|'success'|'error'|'idle'} state
 * @param {string} [label] - optional override for the visible label
 */
export function setBtnState(btn, state, label) {
    if (!btn) return;

    if (!btn.dataset.uiOriginalHtml) {
        btn.dataset.uiOriginalHtml = btn.innerHTML;
    }
    clearTimeout(btn._uiRestoreTimer);
    btn.classList.remove('is-loading', 'is-success', 'is-error');

    if (state === 'loading') {
        btn.disabled = true;
        btn.classList.add('is-loading');
        btn.innerHTML = `${SPINNER_SVG}<span> ${escHtml(label || 'Saving…')}</span>`;
        return;
    }
    if (state === 'success') {
        btn.disabled = true;
        btn.classList.add('is-success');
        btn.innerHTML = `${CHECK_SVG}<span> ${escHtml(label || 'Saved!')}</span>`;
        btn._uiRestoreTimer = setTimeout(() => setBtnState(btn, 'idle'), 1100);
        return;
    }
    if (state === 'error') {
        btn.disabled = false;
        btn.classList.add('is-error');
        btn.innerHTML = `${X_SVG}<span> ${escHtml(label || 'Failed')}</span>`;
        btn._uiRestoreTimer = setTimeout(() => setBtnState(btn, 'idle'), 1800);
        return;
    }
    // idle — restore captured HTML
    btn.disabled = false;
    btn.innerHTML = btn.dataset.uiOriginalHtml || btn.innerHTML;
}

/**
 * Translate Firebase / network errors into short, actionable messages users
 * can act on. Catches the most common cases — permission rules not deployed,
 * offline, expired session, invalid argument.
 */
export function friendlyError(e, action = 'save') {
    if (!e) return `Could not ${action}.`;
    const code = e.code || e?.cause?.code || '';
    const msg = (e.message || '').toLowerCase();

    if (code === 'permission-denied' || msg.includes('permission')) {
        return `Permission denied while trying to ${action}. If you're an admin, ensure Firestore rules are deployed (run: firebase deploy --only firestore:rules).`;
    }
    if (code === 'unauthenticated') {
        return `Your session has expired. Please sign in again to ${action}.`;
    }
    if (code === 'unavailable' || msg.includes('offline') || msg.includes('network')) {
        return `You appear to be offline — could not ${action}. Reconnect and retry.`;
    }
    if (code === 'deadline-exceeded' || code === 'timeout' || msg.includes('timeout')) {
        return `Network is slow — could not ${action} in time. Check your connection and retry.`;
    }
    if (code === 'invalid-argument' || msg.includes('invalid')) {
        return `Invalid data provided — could not ${action}. Check the form and retry.`;
    }
    if (code === 'already-exists') {
        return `Could not ${action}: this record already exists.`;
    }
    return `Could not ${action}: ${e.message || e}`;
}

/**
 * Show a toast via `window.showNotification` if available, otherwise a
 * minimal self-contained fallback toast. Useful when called before app.js
 * has finished defining the global notifier.
 */
export function toast(message, type = 'info') {
    try {
        if (typeof window.showNotification === 'function') {
            window.showNotification(message, type);
            return;
        }
    } catch (_) { /* fall through */ }

    const el = document.createElement('div');
    const palette = {
        success: { bg: '#10b981', fg: '#fff' },
        error: { bg: '#ef4444', fg: '#fff' },
        warning: { bg: '#f59e0b', fg: '#fff' },
        info: { bg: '#3b82f6', fg: '#fff' }
    }[type] || { bg: '#374151', fg: '#fff' };

    el.textContent = String(message);
    el.style.cssText = `position:fixed;bottom:24px;right:24px;background:${palette.bg};color:${palette.fg};padding:12px 18px;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.18);font-size:14px;z-index:99999;max-width:360px;`;
    document.body.appendChild(el);
    setTimeout(() => { el.style.transition = 'opacity .25s'; el.style.opacity = '0'; }, 2400);
    setTimeout(() => el.remove(), 2800);
}

/**
 * Wire a form's submit event to an async handler with consistent visual
 * feedback. Prevents the default GET submission, drives the submit button
 * through loading → success | error, and surfaces a friendly message.
 *
 * The handler receives `{ event, form, btn, formData }` and may return:
 *   - undefined / true        → success
 *   - false                   → silent abort (validation failed; handler shows its own toast)
 *   - { successLabel, errorLabel, action } → success with custom labels
 *   - throw                   → error path (button shakes, toast shown)
 *
 * @param {HTMLFormElement|string} formOrId
 * @param {(ctx: {event: SubmitEvent, form: HTMLFormElement, btn: HTMLButtonElement|null, formData: FormData}) => any} handler
 * @param {{ action?: string, successLabel?: string, loadingLabel?: string }} [opts]
 * @returns {() => void} unsubscribe function
 */
export function wireSubmit(formOrId, handler, opts = {}) {
    const form = typeof formOrId === 'string' ? document.getElementById(formOrId) : formOrId;
    if (!form) return () => {};
    const action = opts.action || 'save';

    const onSubmit = async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const btn = form.querySelector('button[type="submit"]')
            || event.submitter
            || null;

        const formData = new FormData(form);

        // Show loading IMMEDIATELY — before any awaits — so users get
        // instant feedback rather than a "frozen" button.
        setBtnState(btn, 'loading', opts.loadingLabel || 'Saving…');

        let result;
        try {
            result = await handler({ event, form, btn, formData });
        } catch (err) {
            console.error(`[ui-feedback] ${action} failed:`, err);
            setBtnState(btn, 'error', 'Failed');
            toast(friendlyError(err, action), 'error');
            return;
        }

        if (result === false) {
            // Handler aborted (e.g. validation failed). Reset the button so
            // the user can correct and retry.
            setBtnState(btn, 'idle');
            return;
        }

        const successLabel = (result && result.successLabel) || opts.successLabel || 'Saved!';
        setBtnState(btn, 'success', successLabel);
    };

    form.addEventListener('submit', onSubmit);
    return () => form.removeEventListener('submit', onSubmit);
}

// Also expose globally so non-module scripts (and inline `onsubmit=` handlers)
// can use the helpers if needed.
if (typeof window !== 'undefined') {
    window.uiFeedback = { setBtnState, friendlyError, toast, wireSubmit };
}

export default { setBtnState, friendlyError, toast, wireSubmit };
