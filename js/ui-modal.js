// UI Modal — clean, themeable replacements for window.alert / window.confirm / window.prompt.
// Use uiAlert / uiConfirm / uiPrompt anywhere you'd reach for the browser dialogs.
// All three return a Promise so callers can `await` them.
//
// Examples:
//   await uiAlert({ title: 'Saved', message: 'Your changes were saved.' });
//   const ok = await uiConfirm({ title: 'Delete tenant?', message: 'This cannot be undone.', tone: 'danger' });
//   const name = await uiPrompt({ title: 'Customer name', placeholder: 'Walk-in' });

const STYLE_ID = 'ui-modal-styles';
const ROOT_ID  = 'uiModalRoot';

// One-time stylesheet injection. Reuses the app's CSS variables when present so
// the modal naturally adopts the active light/dark theme.
function ensureStylesInjected() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
        .ui-modal-backdrop {
            position: fixed; inset: 0;
            background: rgba(15, 23, 42, 0.55);
            backdrop-filter: blur(2px);
            display: flex; align-items: center; justify-content: center;
            padding: 20px;
            z-index: 100000;
            animation: uiModalFade 160ms ease-out;
            font-family: 'Montserrat', system-ui, -apple-system, sans-serif;
        }
        .ui-modal-card {
            width: 100%; max-width: 420px;
            background: var(--bg-primary, #ffffff);
            color: var(--text-primary, #0f172a);
            border-radius: 14px;
            box-shadow: 0 24px 48px rgba(15, 23, 42, 0.28), 0 4px 14px rgba(15, 23, 42, 0.12);
            overflow: hidden;
            transform-origin: center;
            animation: uiModalPop 180ms cubic-bezier(.2, .8, .25, 1);
        }
        .ui-modal-card[data-tone="danger"]  { border-top: 3px solid #ef4444; }
        .ui-modal-card[data-tone="warning"] { border-top: 3px solid #f59e0b; }
        .ui-modal-card[data-tone="success"] { border-top: 3px solid #10b981; }
        .ui-modal-card[data-tone="info"]    { border-top: 3px solid #3b82f6; }

        .ui-modal-body {
            padding: 22px 22px 16px;
            display: flex; gap: 14px; align-items: flex-start;
        }
        .ui-modal-icon {
            flex: 0 0 40px; height: 40px; width: 40px;
            border-radius: 50%;
            display: inline-flex; align-items: center; justify-content: center;
        }
        .ui-modal-icon[data-tone="danger"]  { background: rgba(239, 68, 68, 0.12);  color: #ef4444; }
        .ui-modal-icon[data-tone="warning"] { background: rgba(245, 158, 11, 0.12); color: #f59e0b; }
        .ui-modal-icon[data-tone="success"] { background: rgba(16, 185, 129, 0.12); color: #10b981; }
        .ui-modal-icon[data-tone="info"]    { background: rgba(59, 130, 246, 0.12); color: #3b82f6; }

        .ui-modal-content { flex: 1 1 auto; min-width: 0; }
        .ui-modal-title {
            font-size: 16px; font-weight: 600; margin: 2px 0 6px;
            color: var(--text-primary, #0f172a); line-height: 1.3;
        }
        .ui-modal-message {
            font-size: 14px; line-height: 1.55;
            color: var(--text-secondary, #475569);
            white-space: pre-wrap; word-break: break-word;
        }
        .ui-modal-input {
            margin-top: 12px; width: 100%;
            padding: 10px 12px; border-radius: 8px;
            border: 1px solid var(--border-color, #e2e8f0);
            background: var(--bg-secondary, #f8fafc);
            color: var(--text-primary, #0f172a);
            font-family: inherit; font-size: 14px;
            transition: border-color 120ms ease, box-shadow 120ms ease;
        }
        .ui-modal-input:focus {
            outline: none;
            border-color: var(--primary-blue, #3b82f6);
            box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.18);
        }

        .ui-modal-actions {
            display: flex; justify-content: flex-end; gap: 8px;
            padding: 12px 18px 18px;
            background: linear-gradient(180deg, transparent, rgba(15, 23, 42, 0.02));
        }
        .ui-modal-btn {
            font: inherit; font-size: 13px; font-weight: 600;
            padding: 9px 16px; border-radius: 8px;
            border: 1px solid transparent;
            cursor: pointer;
            transition: transform 80ms ease, box-shadow 120ms ease, background 120ms ease;
        }
        .ui-modal-btn:active { transform: translateY(1px); }
        .ui-modal-btn-secondary {
            background: var(--bg-secondary, #f1f5f9);
            color: var(--text-primary, #0f172a);
            border-color: var(--border-color, #e2e8f0);
        }
        .ui-modal-btn-secondary:hover { background: var(--bg-tertiary, #e2e8f0); }

        .ui-modal-btn-primary { background: #3b82f6; color: #ffffff; }
        .ui-modal-btn-primary:hover  { background: #2563eb; }
        .ui-modal-btn-primary[data-tone="danger"]  { background: #ef4444; }
        .ui-modal-btn-primary[data-tone="danger"]:hover  { background: #dc2626; }
        .ui-modal-btn-primary[data-tone="warning"] { background: #f59e0b; color: #1f2937; }
        .ui-modal-btn-primary[data-tone="warning"]:hover { background: #d97706; color: #fff; }
        .ui-modal-btn-primary[data-tone="success"] { background: #10b981; }
        .ui-modal-btn-primary[data-tone="success"]:hover { background: #059669; }

        @keyframes uiModalFade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes uiModalPop  { from { opacity: 0; transform: translateY(8px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }

        /* Dark theme polish (uses existing app variables when set) */
        [data-theme="dark"] .ui-modal-card {
            background: var(--bg-primary, #0f172a);
            color: var(--text-primary, #f1f5f9);
            box-shadow: 0 24px 48px rgba(0, 0, 0, 0.5), 0 4px 14px rgba(0, 0, 0, 0.4);
        }
    `;
    document.head.appendChild(style);
}

function ensureRoot() {
    let root = document.getElementById(ROOT_ID);
    if (!root) {
        root = document.createElement('div');
        root.id = ROOT_ID;
        document.body.appendChild(root);
    }
    return root;
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
}

function iconFor(tone) {
    const stroke = 'currentColor';
    const path = {
        danger:  '<line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>',
        warning: '<line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>',
        success: '<polyline points="20 6 9 17 4 12"></polyline>',
        info:    '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line>',
        question:'<circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line>'
    }[tone] || '<circle cx="12" cy="12" r="10"></circle>';
    return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}

function buildModal({ title, message, tone, mode, okLabel, cancelLabel, placeholder, defaultValue }) {
    const isAlert  = mode === 'alert';
    const isPrompt = mode === 'prompt';

    const iconTone = tone === 'danger' || tone === 'warning' || tone === 'success' || tone === 'info'
        ? tone
        : (isAlert ? 'info' : 'question');

    const inputHtml = isPrompt ? `
        <input type="text"
               class="ui-modal-input"
               placeholder="${escapeHtml(placeholder || '')}"
               value="${escapeHtml(defaultValue || '')}">
    ` : '';

    const cancelBtn = isAlert ? '' : `
        <button type="button" class="ui-modal-btn ui-modal-btn-secondary" data-action="cancel">${escapeHtml(cancelLabel || 'Cancel')}</button>
    `;

    const confirmTone = tone === 'danger' || tone === 'warning' || tone === 'success' ? tone : '';

    return `
        <div class="ui-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="uiModalTitle">
            <div class="ui-modal-card" data-tone="${iconTone}">
                <div class="ui-modal-body">
                    <div class="ui-modal-icon" data-tone="${iconTone}">${iconFor(iconTone)}</div>
                    <div class="ui-modal-content">
                        ${title ? `<div class="ui-modal-title" id="uiModalTitle">${escapeHtml(title)}</div>` : ''}
                        ${message ? `<div class="ui-modal-message">${escapeHtml(message)}</div>` : ''}
                        ${inputHtml}
                    </div>
                </div>
                <div class="ui-modal-actions">
                    ${cancelBtn}
                    <button type="button" class="ui-modal-btn ui-modal-btn-primary" data-action="confirm" data-tone="${confirmTone}">
                        ${escapeHtml(okLabel || (isAlert ? 'OK' : 'Confirm'))}
                    </button>
                </div>
            </div>
        </div>
    `;
}

// Internal: opens a modal and returns a Promise resolved by the user's choice.
// `mode` is one of: 'alert' | 'confirm' | 'prompt'.
function openModal(opts) {
    ensureStylesInjected();
    const root = ensureRoot();

    return new Promise((resolve) => {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = buildModal(opts);
        const backdrop = wrapper.firstElementChild;
        root.appendChild(backdrop);

        const close = (result) => {
            try { document.removeEventListener('keydown', onKey); } catch (e) { /* ignore */ }
            backdrop.style.animation = 'uiModalFade 120ms ease-in reverse';
            const card = backdrop.querySelector('.ui-modal-card');
            if (card) card.style.animation = 'uiModalPop 140ms ease-in reverse';
            setTimeout(() => {
                try { backdrop.remove(); } catch (e) { /* ignore */ }
                resolve(result);
            }, 120);
        };

        const input = backdrop.querySelector('.ui-modal-input');
        const okBtn = backdrop.querySelector('[data-action="confirm"]');
        const cancelBtn = backdrop.querySelector('[data-action="cancel"]');

        const submit = () => {
            if (opts.mode === 'prompt') {
                close(input ? input.value : '');
            } else if (opts.mode === 'confirm') {
                close(true);
            } else {
                close(true);
            }
        };

        const dismiss = () => {
            if (opts.mode === 'prompt') return close(null);
            if (opts.mode === 'confirm') return close(false);
            return close(true); // alert: dismiss = ok
        };

        okBtn?.addEventListener('click', submit);
        cancelBtn?.addEventListener('click', dismiss);

        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) dismiss();
        });

        const onKey = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                dismiss();
            } else if (e.key === 'Enter' && !e.isComposing) {
                if (document.activeElement?.tagName !== 'TEXTAREA') {
                    e.preventDefault();
                    submit();
                }
            }
        };
        document.addEventListener('keydown', onKey);

        // Focus management — input first, otherwise the OK button
        setTimeout(() => {
            (input || okBtn)?.focus();
            if (input && opts.defaultValue) input.select();
        }, 30);
    });
}

// ---------- Public API ----------

export function uiAlert(opts = {}) {
    if (typeof opts === 'string') opts = { message: opts };
    return openModal({ ...opts, mode: 'alert' });
}

export function uiConfirm(opts = {}) {
    if (typeof opts === 'string') opts = { message: opts };
    return openModal({ ...opts, mode: 'confirm' });
}

export function uiPrompt(opts = {}) {
    if (typeof opts === 'string') opts = { message: opts };
    return openModal({ ...opts, mode: 'prompt' });
}

if (typeof window !== 'undefined') {
    window.uiAlert = uiAlert;
    window.uiConfirm = uiConfirm;
    window.uiPrompt = uiPrompt;
}

export default { uiAlert, uiConfirm, uiPrompt };
