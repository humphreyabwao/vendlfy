// Permission Guard — UI gating + live enforcement driven by session-manager.
//
// Responsibilities:
//   1. Hide nav links and [data-perm] elements the user cannot access.
//   2. Block click-time navigation to forbidden pages (with feedback).
//   3. Live-evict the user from a page they no longer have access to,
//      whenever the admin updates their role/permissions/branches/status.
//   4. Provide a small helper for modules to re-gate freshly-rendered DOM.

import sessionManager from './session-manager.js';

// Map of page ID → required permission(s). If any matches, grant access.
const PAGE_PERMISSIONS = {
    'dashboard':       ['dashboard.view'],
    'inventory':       ['inventory.view'],
    'add-item':        ['inventory.add'],
    'pos':             ['pos.view'],
    'all-sales':       ['sales.view'],
    'b2b-sales':       ['b2b.view'],
    'new-b2b-sale':    ['b2b.create'],
    'orders':          ['orders.view'],
    'new-order':       ['orders.create'],
    'add-supplier':    ['suppliers.add'],
    'customers':       ['customers.view'],
    'add-customer':    ['customers.add'],
    'tenants':         ['tenants.view', 'tenants.add', 'tenants.edit', 'tenants.collect'],
    'ventures':        ['ventures.view', 'ventures.create', 'ventures.edit', 'ventures.entry'],
    'expenses':        ['expenses.view'],
    'add-expense':     ['expenses.add'],
    'hr-staff':        ['hr.view', 'hr.add', 'hr.edit', 'hr.pay'],
    'add-staff':       ['hr.add'],
    'pay-staff':       ['hr.pay'],
    'salary-history':  ['hr.view'],
    'accounts':        ['accounts.view'],
    'reports':         ['reports.view'],
    'activities':      ['dashboard.view'],
    'admin':           ['admin.branches', 'admin.users', 'admin.settings'],
    'new-user':        ['admin.users'],
    'system-settings': ['admin.settings']
};

// Preferred order to fall back to when the user's current page is forbidden.
const FALLBACK_PAGE_ORDER = [
    'dashboard',
    'pos',
    'inventory',
    'all-sales',
    'b2b-sales',
    'orders',
    'customers',
    'tenants',
    'ventures',
    'expenses',
    'hr-staff',
    'accounts',
    'reports',
    'activities',
    'admin'
];

class PermissionGuard {
    constructor() {
        this._applied = false;
        this._lastSignature = null;
        this._enforceTimer = null;
    }

    // Call after session is ready. Hides nav items + marks pages the user can't access.
    applyToUI() {
        this._applied = true;
        this._gateNavLinks();
        this._gateDataPermElements();
        this._lastSignature = sessionManager.getPermissionsSignature?.() || null;
    }

    // Re-run whenever session changes (role/permission change propagates live).
    refresh() {
        if (!this._applied) return;
        this._gateNavLinks();
        this._gateDataPermElements();
    }

    // Re-apply [data-perm] gating to a freshly-rendered DOM subtree.
    // Modules can call this after appending rows to a table, etc.
    gateContainer(root) {
        if (!root || typeof root.querySelectorAll !== 'function') return;
        root.querySelectorAll('[data-perm]').forEach((el) => {
            const perm = el.getAttribute('data-perm');
            const allowed = sessionManager.hasPermission(perm);
            el.style.display = allowed ? '' : 'none';
        });
    }

    // Check if the current user can open a page. Returns true if allowed.
    canNavigateTo(pageId) {
        if (!sessionManager.isProfileLoaded()) return false;
        if (sessionManager.isAdmin()) return true;
        const required = PAGE_PERMISSIONS[pageId];
        if (!required) return true; // unknown page (no rule registered) — allow
        return sessionManager.hasAnyPermission(required);
    }

    // Hide / show nav links based on permissions
    _gateNavLinks() {
        const navLinks = document.querySelectorAll('[data-page]');
        navLinks.forEach((link) => {
            const pageId = link.getAttribute('data-page');
            const allowed = this.canNavigateTo(pageId);

            const li = link.closest('.nav-item') || link.parentElement;
            if (li && (li.classList.contains('nav-item') || li.tagName === 'LI')) {
                li.style.display = allowed ? '' : 'none';
            } else {
                link.style.display = allowed ? '' : 'none';
            }
        });
    }

    _gateDataPermElements() {
        this.gateContainer(document);
    }

    // Called from initNavigation() before showing a page. Returns error message or null.
    guardNavigation(pageId) {
        if (!sessionManager.isSignedIn()) return 'You must be signed in.';
        if (!sessionManager.isActive()) return 'Your account is disabled.';

        // Profile not yet loaded — block navigation rather than silently allowing it.
        if (!sessionManager.isProfileLoaded()) {
            return 'Loading your access… please try again in a moment.';
        }

        if (sessionManager.isAdmin()) return null;
        const required = PAGE_PERMISSIONS[pageId];
        if (!required) return null;
        if (sessionManager.hasAnyPermission(required)) return null;
        return `You don't have permission to open "${pageId}". Contact your administrator.`;
    }

    // ---------- Live enforcement ----------

    // Returns the first page the user is permitted to open, in preference order.
    getFirstAllowedPage() {
        if (!sessionManager.isProfileLoaded()) return null;
        if (sessionManager.isAdmin()) return 'dashboard';

        for (const pageId of FALLBACK_PAGE_ORDER) {
            if (this.canNavigateTo(pageId)) return pageId;
        }
        // Last-resort: scan the DOM for any visible nav-link
        const visible = Array.from(document.querySelectorAll('.sidebar [data-page]'))
            .find((el) => {
                const li = el.closest('.nav-item') || el.parentElement;
                const target = (li && (li.style.display !== 'none')) ? li : el;
                return target && target.style.display !== 'none';
            });
        return visible ? visible.getAttribute('data-page') : null;
    }

    /**
     * If the currently-active page is no longer permitted, redirect to the
     * first allowed page. Pass `{ silent: true }` to skip the toast (e.g.
     * for the initial load, when nothing was actually revoked).
     */
    enforceCurrentPage(reasonOrOpts = 'permissions changed') {
        const opts = (typeof reasonOrOpts === 'object' && reasonOrOpts) ? reasonOrOpts : { reason: reasonOrOpts };
        const reason = opts.reason || 'permissions changed';
        const silent = !!opts.silent;

        if (!sessionManager.isProfileLoaded()) return;
        const activePage = document.querySelector('.page.active');
        const activePageId = activePage ? activePage.id.replace(/-page$/, '') : null;
        if (!activePageId) return;

        if (this.canNavigateTo(activePageId)) return; // still fine

        const target = this.getFirstAllowedPage();
        if (!target) {
            try {
                if (window.showNotification) {
                    window.showNotification('You no longer have access to any module. Contact your administrator.', 'error');
                }
            } catch (e) { /* ignore */ }
            return;
        }

        if (!silent) {
            try {
                if (window.showNotification) {
                    window.showNotification(
                        `Your access to "${activePageId}" was revoked (${reason}). Moved to "${target}".`,
                        'warning'
                    );
                }
            } catch (e) { /* ignore */ }
        }

        const link = document.querySelector(`.sidebar [data-page="${target}"]`)
            || document.querySelector(`[data-page="${target}"]`);

        if (link && typeof link.click === 'function') {
            link.click();
        } else {
            document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
            const targetPage = document.getElementById(`${target}-page`);
            if (targetPage) targetPage.classList.add('active');
        }
    }

    /**
     * Run on every session change. Detects whether the user's RBAC actually
     * changed (vs. lastActive timestamps etc.) and enforces only when needed.
     */
    onSessionChanged() {
        const newSig = sessionManager.getPermissionsSignature?.() || null;
        const changed = (newSig !== this._lastSignature);
        this._lastSignature = newSig;

        // Always re-gate the UI so newly granted/revoked items appear/hide.
        this.refresh();

        if (!changed) return;

        // Debounce so rapid successive snapshot updates collapse into one redirect.
        clearTimeout(this._enforceTimer);
        this._enforceTimer = setTimeout(() => {
            this.enforceCurrentPage({ reason: 'your access was updated by an administrator' });
        }, 150);
    }
}

const permissionGuard = new PermissionGuard();

if (typeof window !== 'undefined') {
    window.permissionGuard = permissionGuard;
}

// Listen for live session changes and re-apply gating + live-evict if needed.
sessionManager.onChange(() => {
    permissionGuard.onSessionChanged();
    if (typeof window.populateBranchSelector === 'function') {
        window.populateBranchSelector();
    }
});

export default permissionGuard;
