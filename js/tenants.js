// Tenants & Rent Module
// Simple, real-time tenant management + rent collection.
// Branch-scoped, RBAC-aware, pulls in brand currency for amounts.

import {
    db, isFirebaseConfigured,
    collection, addDoc, doc, updateDoc, deleteDoc,
    onSnapshot, query, where, orderBy
} from './firebase-config.js';
import branchManager from './branch-manager.js';
import sessionManager from './session-manager.js';
import brandManager from './brand-manager.js';
import {
    addWithFallback, updateWithFallback, deleteWithFallback, streamDual
} from './storage-adapter.js';
import { setBtnState, friendlyError } from './ui-feedback.js';

const TENANTS_KEY  = 'vendlfy_tenants';
const PAYMENTS_KEY = 'vendlfy_rent_payments';

const PLAN_LABELS = {
    daily:     'Daily',
    weekly:    'Weekly',
    monthly:   'Monthly',
    quarterly: 'Quarterly',
    yearly:    'Yearly'
};

class TenantsManager {
    constructor() {
        this.tenants = [];
        this.payments = [];
        this.useLocal = !isFirebaseConfigured;
        this.currentView = 'tenants'; // 'tenants' | 'payments'
        this.searchTerm = '';
        this.planFilter = 'all';
        this.statusFilter = 'all';
        this.sortBy = 'name'; // name | overdue | outstanding | rent | recent | lastPayment
        this._tenantsUnsub = null;
        this._paymentsUnsub = null;
        this._wired = false;

        if (this.useLocal) this._loadLocal();
    }

    _loadLocal() {
        try { this.tenants  = JSON.parse(localStorage.getItem(TENANTS_KEY)  || '[]'); } catch (e) {}
        try { this.payments = JSON.parse(localStorage.getItem(PAYMENTS_KEY) || '[]'); } catch (e) {}
    }
    _saveLocal() {
        try {
            localStorage.setItem(TENANTS_KEY,  JSON.stringify(this.tenants));
            localStorage.setItem(PAYMENTS_KEY, JSON.stringify(this.payments));
        } catch (e) {}
    }

    // ---------- Lifecycle ----------

    init() {
        if (!this._wired) {
            this._wired = true;
            this._wireUI();
            // Re-stream when branch changes
            window.addEventListener('branchChanged', () => this._restartStreams());
            window.addEventListener('sessionChanged', () => this._restartStreams());
        }
        this._restartStreams();
        this.render();
    }

    _restartStreams() {
        this._stopStreams();
        if (this.useLocal) {
            this.render();
            return;
        }
        this._startTenantsStream();
        this._startPaymentsStream();
    }

    _stopStreams() {
        try { this._tenantsUnsub?.(); } catch (e) {}
        try { this._paymentsUnsub?.(); } catch (e) {}
        this._tenantsUnsub = null;
        this._paymentsUnsub = null;
    }

    _branchScopedQuery(collectionName, extra = []) {
        const ref = collection(db, collectionName);
        const allowed = sessionManager.getAllowedBranchIds(); // null = admin (all branches)
        const current = branchManager.getCurrentBranch?.();
        const viewingAll = branchManager.isViewingAllBranches?.();

        // Admin viewing one branch
        if (allowed === null && current && !viewingAll) {
            return query(ref, where('branchId', '==', current.id), ...extra);
        }
        // Admin viewing all
        if (allowed === null) {
            return query(ref, ...extra);
        }
        // Non-admin with no branches
        if (!allowed || allowed.length === 0) {
            return query(ref, where('branchId', '==', '__no_access__'), ...extra);
        }
        if (allowed.length === 1) {
            return query(ref, where('branchId', '==', allowed[0]), ...extra);
        }
        return query(ref, where('branchId', 'in', allowed.slice(0, 30)), ...extra);
    }

    // Returns a client-side filter that reflects the current branch view.
    // Used to keep RTDB results consistent with the Firestore branch-scoped query.
    _currentBranchFilter() {
        const allowed = sessionManager.getAllowedBranchIds();
        const current = branchManager.getCurrentBranch?.();
        const viewingAll = !!branchManager.isViewingAllBranches?.();

        if (allowed === null && current && !viewingAll && current.id !== 'all' && current.code !== 'ALL') {
            return (item) => item.branchId === current.id;
        }
        if (allowed === null) return () => true;
        if (!allowed || allowed.length === 0) return () => false;
        return (item) => allowed.includes(item.branchId);
    }

    _startTenantsStream() {
        try {
            const fsQuery = this._branchScopedQuery('tenants');
            const branchFilter = this._currentBranchFilter();

            this._tenantsUnsub = streamDual({
                firestoreQuery: fsQuery,
                rtdbPath: 'tenants',
                rtdbFilter: branchFilter,
                onUpdate: (items) => {
                    this.tenants = items.slice();
                    this.tenants.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
                    const fsCount = items.filter((x) => x._source === 'firestore').length;
                    const rtdbCount = items.filter((x) => x._source === 'rtdb').length;
                    console.log(`🏠 Tenants stream: ${this.tenants.length} tenant(s) (${fsCount} Firestore, ${rtdbCount} RTDB)`);
                    this.render();
                },
                onError: (err, source) => {
                    console.error(`❌ Tenants stream (${source}) error:`, err.code, err.message);
                }
            });
        } catch (e) { console.error('Failed to start tenants stream:', e); }
    }

    _startPaymentsStream() {
        try {
            const fsQuery = this._branchScopedQuery('rentPayments');
            const branchFilter = this._currentBranchFilter();

            this._paymentsUnsub = streamDual({
                firestoreQuery: fsQuery,
                rtdbPath: 'rentPayments',
                rtdbFilter: branchFilter,
                onUpdate: (items) => {
                    this.payments = items.slice();
                    this.payments.sort((a, b) =>
                        new Date(b.paymentDate || b.createdAt || 0) -
                        new Date(a.paymentDate || a.createdAt || 0)
                    );
                    const fsCount = items.filter((x) => x._source === 'firestore').length;
                    const rtdbCount = items.filter((x) => x._source === 'rtdb').length;
                    console.log(`💵 Rent payments stream: ${this.payments.length} payment(s) (${fsCount} Firestore, ${rtdbCount} RTDB)`);
                    this.render();
                },
                onError: (err, source) => {
                    console.error(`❌ Rent payments stream (${source}) error:`, err.code, err.message);
                }
            });
        } catch (e) { console.error('Failed to start payments stream:', e); }
    }

    // Resolves a *real* branch to attach to a write. Never returns the synthetic
    // "All Branches" pseudo-branch (id: 'all'), which would break Firestore rules
    // and queries downstream.
    _resolveWriteBranch(explicitBranchId = null) {
        let allBranches = [];
        try { allBranches = branchManager.getAllBranches?.() || []; } catch (e) {}

        const findBranch = (id) => allBranches.find((b) => b && b.id === id) || null;

        // 1. Explicit user choice wins
        if (explicitBranchId) {
            const m = findBranch(explicitBranchId);
            if (m) return { id: m.id, name: m.name || null };
            return { id: explicitBranchId, name: null };
        }

        // 2. Current branch from selector — only if it's a real branch
        const cur = branchManager.getCurrentBranch?.();
        const viewingAll = !!branchManager.isViewingAllBranches?.();
        if (cur && !viewingAll && cur.id && cur.id !== 'all' && cur.code !== 'ALL') {
            return { id: cur.id, name: cur.name || null };
        }

        // 3. User's primary / first allowed branch
        const profile = sessionManager.getUser?.() || {};
        const primary = profile.primaryBranchId || profile.branchId || null;
        if (primary) {
            const m = findBranch(primary);
            return { id: primary, name: m?.name || null };
        }
        const allowed = sessionManager.getAllowedBranchIds?.();
        if (Array.isArray(allowed) && allowed.length > 0) {
            const m = findBranch(allowed[0]);
            return { id: allowed[0], name: m?.name || null };
        }

        // 4. Admin fallback — central or first available branch
        if (sessionManager.canAccessAllBranches?.()) {
            const central = allBranches.find((b) => b.isCentral) || allBranches[0];
            if (central) return { id: central.id, name: central.name || null };
        }

        return { id: null, name: null };
    }

    // ---------- UI wiring ----------

    _wireUI() {
        const addBtn = document.getElementById('addTenantBtn');
        if (addBtn) addBtn.addEventListener('click', () => this.openTenantModal());

        const toggleBtn = document.getElementById('tenantsViewToggleBtn');
        if (toggleBtn) toggleBtn.addEventListener('click', () => this.toggleView());

        const search = document.getElementById('tenantsSearchInput');
        if (search) {
            let t;
            search.addEventListener('input', (e) => {
                clearTimeout(t);
                t = setTimeout(() => {
                    this.searchTerm = e.target.value.trim().toLowerCase();
                    this.render();
                }, 200);
            });
        }

        document.getElementById('tenantsPlanFilter')?.addEventListener('change', (e) => {
            this.planFilter = e.target.value;
            this.render();
        });

        document.getElementById('tenantsStatusFilter')?.addEventListener('change', (e) => {
            this.statusFilter = e.target.value;
            this.render();
        });

        document.getElementById('tenantsSortBy')?.addEventListener('change', (e) => {
            this.sortBy = e.target.value;
            this.render();
        });

        document.getElementById('tenantsClearFiltersBtn')?.addEventListener('click', () => {
            this.searchTerm = '';
            this.planFilter = 'all';
            this.statusFilter = 'all';
            this.sortBy = 'name';
            const s    = document.getElementById('tenantsSearchInput');
            const pl   = document.getElementById('tenantsPlanFilter');
            const st   = document.getElementById('tenantsStatusFilter');
            const sort = document.getElementById('tenantsSortBy');
            if (s)    s.value    = '';
            if (pl)   pl.value   = 'all';
            if (st)   st.value   = 'all';
            if (sort) sort.value = 'name';
            this.render();
        });
    }

    toggleView() {
        this.currentView = this.currentView === 'tenants' ? 'payments' : 'tenants';
        const listView    = document.getElementById('tenantsListView');
        const paymentView = document.getElementById('rentPaymentsView');
        const label       = document.getElementById('tenantsViewToggleLabel');

        if (this.currentView === 'tenants') {
            if (listView)    listView.style.display    = '';
            if (paymentView) paymentView.style.display = 'none';
            if (label)       label.textContent         = 'View Rent Payments';
        } else {
            if (listView)    listView.style.display    = 'none';
            if (paymentView) paymentView.style.display = '';
            if (label)       label.textContent         = 'View Tenants';
        }
        this.render();
    }

    // ---------- Rendering ----------

    render() {
        this._renderStats();
        this._renderTenantsTable();
        this._renderPaymentsTable();
        // Keep the history modal in sync if it's currently open
        if (this._historyTenantId &&
            document.getElementById('tenantHistoryModal')?.classList.contains('active')) {
            this._renderHistory();
        }
    }

    _renderStats() {
        const cur = brandManager.getBrand().currency || 'KES';
        const total  = this.tenants.length;
        const active = this.tenants.filter((t) => (t.status || 'active') === 'active').length;

        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const collected = this.payments
            .filter((p) => new Date(p.paymentDate || p.createdAt || 0) >= monthStart)
            .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

        const outstanding = this.tenants.reduce((sum, t) => {
            const bal = this._tenantOutstanding(t);
            return bal > 0 ? sum + bal : sum;
        }, 0);

        this._setText('tenantsTotalCount', String(total));
        this._setText('tenantsActiveCount', String(active));
        this._setText('tenantsCollectedThisMonth', `${cur} ${this._fmt(collected)}`);
        this._setText('tenantsOutstanding', `${cur} ${this._fmt(outstanding)}`);
    }

    _renderTenantsTable() {
        const body = document.getElementById('tenantsTableBody');
        if (!body) return;
        const cur = brandManager.getBrand().currency || 'KES';

        const list = this._filterTenants(this.tenants);

        if (list.length === 0) {
            const hasFilters = this.searchTerm || this.planFilter !== 'all' || this.statusFilter !== 'all';
            body.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:32px; color:var(--text-secondary);">
                ${hasFilters ? 'No tenants match your filters.' : 'No tenants yet. Click <strong>Add Tenant</strong> to get started.'}
            </td></tr>`;
            return;
        }

        const canEdit  = sessionManager.hasPermission('tenants.edit');
        const canPay   = sessionManager.hasPermission('tenants.collect');
        const canDel   = sessionManager.hasPermission('tenants.delete');

        body.innerHTML = list.map((t) => {
            const status     = this._tenantStatus(t);
            const lastPay    = this._lastPaymentFor(t.id);
            const lastPayTxt = lastPay ? this._fmtDate(lastPay.paymentDate || lastPay.createdAt) : '<span style="color:var(--text-tertiary);">Never</span>';

            return `
                <tr>
                    <td><strong>${this._esc(t.name)}</strong></td>
                    <td>${this._esc(t.phone || '-')}</td>
                    <td><span class="badge" style="background:#eef2ff;color:#4338ca;padding:3px 8px;border-radius:6px;font-size:12px;">${this._esc(t.houseNumber || '-')}</span></td>
                    <td>${PLAN_LABELS[t.plan] || (t.plan || '-')}</td>
                    <td><strong>${cur} ${this._fmt(t.rentAmount || 0)}</strong></td>
                    <td>${this._statusBadge(status)}</td>
                    <td>${lastPayTxt}</td>
                    <td>
                        <div class="action-buttons" style="justify-content:flex-end;flex-wrap:nowrap;">
                            ${canPay ? `<button class="btn-icon" title="Collect Rent" onclick="window.tenantsManager.openCollectRentModal('${t.id}')" style="color:#10b981;border-color:#10b98155;background:rgba(16,185,129,0.08);">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
                            </button>` : ''}
                            ${canPay ? `<button class="btn-icon" title="Send Rent Reminder" onclick="window.tenantsManager.openReminderModal('${t.id}')" style="color:#f59e0b;border-color:#f59e0b55;background:rgba(245,158,11,0.08);">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
                            </button>` : ''}
                            <button class="btn-icon" title="Payment History" onclick="window.tenantsManager.openHistoryModal('${t.id}')" style="color:#6366f1;border-color:#6366f155;background:rgba(99,102,241,0.08);">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"></path><path d="M7 14l4-4 4 3 5-6"></path></svg>
                            </button>
                            ${canEdit ? `<button class="btn-icon" title="Edit Tenant" onclick="window.tenantsManager.openTenantModal('${t.id}')">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                            </button>` : ''}
                            ${canDel ? `<button class="btn-icon" title="Delete Tenant" onclick="window.tenantsManager.deleteTenant('${t.id}')" style="color:#ef4444;border-color:#ef444455;background:rgba(239,68,68,0.08);">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                            </button>` : ''}
                        </div>
                    </td>
                </tr>`;
        }).join('');
    }

    _renderPaymentsTable() {
        const body = document.getElementById('rentPaymentsTableBody');
        if (!body) return;
        const cur = brandManager.getBrand().currency || 'KES';

        let list = this.payments.slice();
        if (this.searchTerm) {
            list = list.filter((p) =>
                (p.tenantName || '').toLowerCase().includes(this.searchTerm) ||
                (p.houseNumber || '').toLowerCase().includes(this.searchTerm)
            );
        }

        if (list.length === 0) {
            body.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:32px; color:var(--text-secondary);">No rent payments recorded yet.</td></tr>`;
            return;
        }

        body.innerHTML = list.map((p) => `
            <tr>
                <td>${this._fmtDate(p.paymentDate || p.createdAt)}</td>
                <td><strong>${this._esc(p.tenantName || '-')}</strong></td>
                <td>${this._esc(p.houseNumber || '-')}</td>
                <td>${this._esc(p.periodLabel || '-')}</td>
                <td>${PLAN_LABELS[p.plan] || (p.plan || '-')}</td>
                <td><strong>${cur} ${this._fmt(p.amount || 0)}</strong></td>
                <td>${this._esc(this._methodLabel(p.method))}</td>
                <td>${this._esc(p.recordedByName || '-')}</td>
            </tr>`).join('');
    }

    _filterTenants(list) {
        let out = list.slice();
        const q = this.searchTerm;

        if (q) {
            out = out.filter((t) =>
                (t.name || '').toLowerCase().includes(q) ||
                (t.phone || '').toLowerCase().includes(q) ||
                (t.houseNumber || '').toLowerCase().includes(q)
            );
        }

        if (this.planFilter && this.planFilter !== 'all') {
            out = out.filter((t) => (t.plan || 'monthly') === this.planFilter);
        }

        if (this.statusFilter && this.statusFilter !== 'all') {
            out = out.filter((t) => this._tenantStatus(t) === this.statusFilter);
        }

        const lastPayTime = (id) => {
            const p = this._lastPaymentFor(id);
            return p ? new Date(p.paymentDate || p.createdAt).getTime() : 0;
        };
        const overdueDays = (t) => {
            const last = this._lastPaymentFor(t.id);
            const ref  = last ? new Date(last.paymentDate || last.createdAt).getTime() : new Date(t.startDate || t.createdAt || Date.now()).getTime();
            const days = (Date.now() - ref) / 86400000;
            return Math.max(0, days - this._planDays(t.plan));
        };

        switch (this.sortBy) {
            case 'overdue':
                out.sort((a, b) => overdueDays(b) - overdueDays(a));
                break;
            case 'outstanding':
                out.sort((a, b) => this._tenantOutstanding(b) - this._tenantOutstanding(a));
                break;
            case 'rent':
                out.sort((a, b) => (Number(b.rentAmount) || 0) - (Number(a.rentAmount) || 0));
                break;
            case 'recent':
                out.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
                break;
            case 'lastPayment':
                out.sort((a, b) => lastPayTime(b.id) - lastPayTime(a.id));
                break;
            case 'name':
            default:
                out.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        }

        return out;
    }

    // ---------- Computed status ----------

    _planDays(plan) {
        switch (plan) {
            case 'daily':     return 1;
            case 'weekly':    return 7;
            case 'monthly':   return 30;
            case 'quarterly': return 91;
            case 'yearly':    return 365;
            default:          return 30;
        }
    }

    _lastPaymentFor(tenantId) {
        return this.payments.find((p) => p.tenantId === tenantId) || null;
    }

    _tenantOutstanding(t) {
        const last = this._lastPaymentFor(t.id);
        if (!last) {
            // Never paid — owe one full period from start date or now
            return Number(t.rentAmount) || 0;
        }
        const days = (Date.now() - new Date(last.paymentDate || last.createdAt).getTime()) / 86400000;
        const periods = Math.floor(days / this._planDays(t.plan));
        return Math.max(0, periods) * (Number(t.rentAmount) || 0);
    }

    _tenantStatus(t) {
        if ((t.status || 'active') !== 'active') return 'inactive';
        const last = this._lastPaymentFor(t.id);
        if (!last) return 'due';
        const days = (Date.now() - new Date(last.paymentDate || last.createdAt).getTime()) / 86400000;
        const period = this._planDays(t.plan);
        if (days <= period)         return 'paid';
        if (days <= period * 2)     return 'due';
        return 'overdue';
    }

    _statusBadge(status) {
        const map = {
            paid:     ['#dcfce7', '#15803d', 'Paid'],
            due:      ['#fef3c7', '#b45309', 'Due'],
            overdue:  ['#fee2e2', '#b91c1c', 'Overdue'],
            inactive: ['#e5e7eb', '#475569', 'Inactive']
        };
        const [bg, fg, label] = map[status] || map.due;
        return `<span style="background:${bg};color:${fg};padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600;">${label}</span>`;
    }

    // ---------- Tenant CRUD ----------

    openTenantModal(tenantId = null) {
        const modal = document.getElementById('tenantModal');
        const title = document.getElementById('tenantModalTitle');
        if (!modal) return;

        const idEl    = document.getElementById('tenantId');
        const name    = document.getElementById('tenantName');
        const phone   = document.getElementById('tenantPhone');
        const house   = document.getElementById('tenantHouseNumber');
        const plan    = document.getElementById('tenantPlan');
        const amount  = document.getElementById('tenantRentAmount');
        const start   = document.getElementById('tenantStartDate');
        const notes   = document.getElementById('tenantNotes');
        const branchSel = document.getElementById('tenantBranch');

        this._populateBranchSelect();

        if (tenantId) {
            const t = this.tenants.find((x) => x.id === tenantId);
            if (!t) return;
            if (title) title.textContent = 'Edit Tenant';
            idEl.value    = t.id;
            name.value    = t.name || '';
            phone.value   = t.phone || '';
            house.value   = t.houseNumber || '';
            plan.value    = t.plan || 'monthly';
            amount.value  = t.rentAmount || '';
            start.value   = t.startDate ? t.startDate.substring(0, 10) : '';
            notes.value   = t.notes || '';
            if (branchSel) branchSel.value = t.branchId && t.branchId !== 'all' ? t.branchId : '';
        } else {
            if (title) title.textContent = 'Add Tenant';
            document.getElementById('tenantForm')?.reset();
            idEl.value  = '';
            plan.value  = 'monthly';
            start.value = new Date().toISOString().substring(0, 10);
            // Pre-select current branch when it's a real one
            const cur = branchManager.getCurrentBranch?.();
            const viewingAll = !!branchManager.isViewingAllBranches?.();
            if (branchSel && cur && !viewingAll && cur.id !== 'all' && cur.code !== 'ALL') {
                branchSel.value = cur.id;
            } else if (branchSel) {
                branchSel.value = '';
            }
        }

        modal.classList.add('active');
    }

    _populateBranchSelect() {
        const sel = document.getElementById('tenantBranch');
        if (!sel) return;

        let branches = [];
        try { branches = branchManager.getAllBranches?.() || []; } catch (e) { branches = []; }

        const allowed = sessionManager.getAllowedBranchIds?.();
        if (Array.isArray(allowed)) {
            branches = branches.filter((b) => allowed.includes(b.id));
        }

        sel.innerHTML = '<option value="">— Select branch —</option>' +
            branches
                .slice()
                .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
                .map((b) => `<option value="${b.id}">${this._esc(b.name || b.id)}</option>`)
                .join('');
    }

    closeTenantModal() {
        document.getElementById('tenantModal')?.classList.remove('active');
    }

    async saveTenant() {
        const id     = document.getElementById('tenantId').value;
        const name   = document.getElementById('tenantName').value.trim();
        const phone  = document.getElementById('tenantPhone').value.trim();
        const house  = document.getElementById('tenantHouseNumber').value.trim();
        const plan   = document.getElementById('tenantPlan').value;
        const amount = parseFloat(document.getElementById('tenantRentAmount').value);
        const start  = document.getElementById('tenantStartDate').value;
        const notes  = document.getElementById('tenantNotes').value.trim();
        const chosenBranchId = (document.getElementById('tenantBranch')?.value || '').trim();

        if (!name || !phone || !house || !plan || isNaN(amount) || amount < 0) {
            this._toast('Please fill in all required fields with valid values', 'error');
            return;
        }

        // For UPDATE: keep the tenant's existing branch unless user changed it.
        let resolved;
        if (id) {
            const existing = this.tenants.find((x) => x.id === id);
            if (chosenBranchId) {
                resolved = this._resolveWriteBranch(chosenBranchId);
            } else if (existing && existing.branchId && existing.branchId !== 'all') {
                resolved = { id: existing.branchId, name: existing.branchName || null };
            } else {
                resolved = this._resolveWriteBranch();
            }
        } else {
            resolved = this._resolveWriteBranch(chosenBranchId);
        }

        if (!resolved.id) {
            this._toast('Please pick a branch for this tenant (or switch out of "All Branches" view).', 'error');
            return;
        }

        // RBAC: prevent assigning a tenant to a branch the user can't access
        const allowed = sessionManager.getAllowedBranchIds?.();
        if (Array.isArray(allowed) && !allowed.includes(resolved.id)) {
            this._toast('You do not have access to that branch', 'error');
            return;
        }

        const data = {
            name, phone,
            houseNumber: house,
            plan,
            rentAmount: amount,
            startDate: start ? new Date(start).toISOString() : new Date().toISOString(),
            notes,
            status: 'active',
            branchId:   resolved.id,
            branchName: resolved.name,
            updatedAt:  new Date().toISOString()
        };

        // Drive the Save button through loading → success/error states.
        const saveBtn = document.querySelector('#tenantModal .modal-actions .btn-primary');
        setBtnState(saveBtn, 'loading', id ? 'Updating…' : 'Saving…');

        const existingTenant = id ? this.tenants.find((t) => t.id === id) : null;
        const existingSource = existingTenant?._source || 'firestore';
        let savedOk = false;
        let savedSource = null;
        let savedId = null;

        try {
            if (this.useLocal) {
                console.log('💾 Saving tenant to local storage (Firebase not configured)');
                if (id) {
                    const idx = this.tenants.findIndex((t) => t.id === id);
                    if (idx >= 0) this.tenants[idx] = { ...this.tenants[idx], ...data };
                } else {
                    this.tenants.push({ id: 'lt_' + Date.now(), createdAt: new Date().toISOString(), ...data });
                }
                this._saveLocal();
                this.render();
                savedOk = true;
                savedSource = 'local';
                savedId = id || null;
            } else if (id) {
                console.log(`💾 Updating tenant in ${existingSource} (id: ${id})`);
                await updateWithFallback('tenants', id, data, existingSource);
                console.log(`✅ Tenant updated (id: ${id})`);
                const idx = this.tenants.findIndex((t) => t.id === id);
                if (idx >= 0) {
                    this.tenants[idx] = { ...this.tenants[idx], ...data, _source: existingSource };
                    this.render();
                }
                savedOk = true;
                savedSource = existingSource;
                savedId = id;
            } else {
                data.createdAt = new Date().toISOString();
                data.createdBy = sessionManager.getAuthUser?.()?.uid || null;
                console.log('💾 Creating tenant (branch:', resolved.id, ')');
                const result = await addWithFallback('tenants', data);
                console.log(`✅ Tenant created in ${result.source} (id: ${result.id})`);
                if (!this.tenants.some((t) => t.id === result.id)) {
                    this.tenants.push({ id: result.id, ...data, _source: result.source });
                    this.tenants.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
                    this.render();
                }
                savedOk = true;
                savedSource = result.source;
                savedId = result.id;
            }
        } catch (e) {
            console.error('❌ Save tenant failed:', e?.code, e?.message, e);
            setBtnState(saveBtn, 'error', 'Failed');
            this._toast(friendlyError(e, id ? 'update tenant' : 'add tenant'), 'error');
        }

        if (savedOk) {
            setBtnState(saveBtn, 'success', id ? 'Updated!' : 'Saved!');
            this._toast(id ? 'Tenant updated' : 'Tenant added', 'success');

            try {
                window.activityTracker?.logActivity?.('tenant', id ? 'updated' : 'added', {
                    tenantName: name, houseNumber: house, plan, rentAmount: amount, storage: savedSource
                });
            } catch (e) { /* non-fatal */ }

            // Close the modal after the success state has been visible.
            setTimeout(() => this.closeTenantModal(), 700);
        }
    }

    async deleteTenant(tenantId) {
        const t = this.tenants.find((x) => x.id === tenantId);
        if (!t) return;
        const ok = await window.uiConfirm?.({
            title: 'Delete tenant?',
            message: `Are you sure you want to delete "${t.name}"? Their payment history will be kept.`,
            tone: 'danger',
            okLabel: 'Delete'
        });
        if (!ok) return;

        try {
            if (this.useLocal) {
                this.tenants = this.tenants.filter((x) => x.id !== tenantId);
                this._saveLocal();
                this.render();
            } else {
                await deleteWithFallback('tenants', tenantId, t._source || 'firestore');
                this.tenants = this.tenants.filter((x) => x.id !== tenantId);
                this.render();
            }
            try {
                window.activityTracker?.logActivity?.('tenant', 'deleted', { tenantName: t.name, houseNumber: t.houseNumber });
            } catch (e) { /* non-fatal */ }
            this._toast('Tenant deleted', 'success');
        } catch (e) {
            console.error('Delete tenant failed:', e?.code, e?.message);
            const reason =
                e?.code === 'permission-denied' ? 'Permission denied. You need the "tenants.delete" permission.' :
                e?.code === 'timeout' ? 'Delete timed out and fallback failed. Check your connection.' :
                (e?.message || 'unknown error');
            this._toast(`Failed to delete tenant: ${reason}`, 'error');
        }
    }

    // ---------- Rent collection ----------

    openCollectRentModal(tenantId) {
        const t = this.tenants.find((x) => x.id === tenantId);
        if (!t) return;

        const cur = brandManager.getBrand().currency || 'KES';
        const outstanding = this._tenantOutstanding(t);
        const last = this._lastPaymentFor(t.id);

        document.getElementById('rentTenantId').value = t.id;
        document.getElementById('rentAmountPaid').value = (outstanding > 0 ? outstanding : Number(t.rentAmount) || 0).toFixed(2);
        document.getElementById('rentPaymentDate').value = new Date().toISOString().substring(0, 10);
        document.getElementById('rentPaymentMethod').value = 'cash';
        document.getElementById('rentPeriodLabel').value = this._suggestPeriodLabel(t.plan);
        document.getElementById('rentPaymentNotes').value = '';

        const summary = document.getElementById('rentTenantSummary');
        if (summary) {
            summary.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <strong>${this._esc(t.name)}</strong>
                    <span style="color:var(--text-secondary);">House #${this._esc(t.houseNumber || '-')}</span>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-secondary);">
                    <span>${PLAN_LABELS[t.plan]} &middot; ${cur} ${this._fmt(t.rentAmount || 0)}</span>
                    <span>${last ? 'Last paid ' + this._fmtDate(last.paymentDate || last.createdAt) : 'No payments yet'}</span>
                </div>
                ${outstanding > 0 ? `<div style="margin-top:8px;padding:6px 10px;background:#fef3c7;color:#b45309;border-radius:6px;font-size:12px;font-weight:600;">Outstanding: ${cur} ${this._fmt(outstanding)}</div>` : ''}`;
        }

        document.getElementById('collectRentModal')?.classList.add('active');
    }

    closeCollectRentModal() {
        document.getElementById('collectRentModal')?.classList.remove('active');
    }

    _suggestPeriodLabel(plan) {
        const now = new Date();
        switch (plan) {
            case 'daily':   return now.toLocaleDateString();
            case 'weekly':  return `Week of ${now.toLocaleDateString()}`;
            case 'monthly': return now.toLocaleString('default', { month: 'long', year: 'numeric' });
            case 'quarterly': {
                const q = Math.floor(now.getMonth() / 3) + 1;
                return `Q${q} ${now.getFullYear()}`;
            }
            case 'yearly':  return String(now.getFullYear());
            default:        return now.toLocaleDateString();
        }
    }

    async recordRentPayment() {
        const tenantId = document.getElementById('rentTenantId').value;
        const amount   = parseFloat(document.getElementById('rentAmountPaid').value);
        const dateStr  = document.getElementById('rentPaymentDate').value;
        const method   = document.getElementById('rentPaymentMethod').value;
        const period   = document.getElementById('rentPeriodLabel').value.trim();
        const notes    = document.getElementById('rentPaymentNotes').value.trim();

        const t = this.tenants.find((x) => x.id === tenantId);
        if (!t) { this._toast('Tenant not found', 'error'); return; }
        if (isNaN(amount) || amount <= 0) { this._toast('Enter a valid amount', 'error'); return; }
        if (!dateStr) { this._toast('Select a payment date', 'error'); return; }

        // Pin the payment to the same branch as the tenant
        const resolved = (t.branchId && t.branchId !== 'all')
            ? { id: t.branchId, name: t.branchName || null }
            : this._resolveWriteBranch();

        if (!resolved.id) {
            this._toast('No branch on this tenant. Please edit the tenant and pick a branch first.', 'error');
            return;
        }

        const me     = sessionManager.getUser?.() || {};
        const auth   = sessionManager.getAuthUser?.();
        const data = {
            tenantId,
            tenantName:  t.name,
            houseNumber: t.houseNumber,
            plan:        t.plan,
            amount,
            paymentDate: new Date(dateStr).toISOString(),
            method,
            periodLabel: period,
            notes,
            recordedById:  auth?.uid || null,
            recordedByName: me.fullName || me.name || me.email || auth?.email || 'Unknown',
            branchId:   resolved.id,
            branchName: resolved.name,
            createdAt:  new Date().toISOString()
        };

        const saveBtn = document.querySelector('#collectRentModal .modal-actions .btn-primary');
        setBtnState(saveBtn, 'loading', 'Recording…');

        let savedOk = false;
        let savedSource = null;

        try {
            if (this.useLocal) {
                console.log('💾 Saving rent payment to local storage (Firebase not configured)');
                this.payments.unshift({ id: 'lp_' + Date.now(), ...data });
                this._saveLocal();
                this.render();
                savedOk = true;
                savedSource = 'local';
            } else {
                console.log('💾 Recording rent payment for tenant:', tenantId);
                const result = await addWithFallback('rentPayments', data);
                console.log(`✅ Rent payment recorded in ${result.source} (id: ${result.id})`);
                if (!this.payments.some((p) => p.id === result.id)) {
                    this.payments.unshift({ id: result.id, ...data, _source: result.source });
                    this.render();
                }
                savedOk = true;
                savedSource = result.source;

                // Stamp the tenant with last-payment for quick access (non-fatal).
                try {
                    await updateWithFallback('tenants', tenantId, {
                        lastPaymentDate: data.paymentDate,
                        lastPaymentAmount: amount,
                        updatedAt: new Date().toISOString()
                    }, t._source || 'firestore');
                } catch (e) {
                    console.warn('Could not stamp tenant lastPaymentDate (non-fatal):', e?.code || '', e?.message);
                }
            }
        } catch (e) {
            console.error('❌ Record rent failed:', e?.code, e?.message, e);
            setBtnState(saveBtn, 'error', 'Failed');
            this._toast(friendlyError(e, 'record rent payment'), 'error');
        }

        if (savedOk) {
            setBtnState(saveBtn, 'success', 'Recorded!');
            this._toast('Rent payment recorded', 'success');

            try {
                window.activityTracker?.logActivity?.('tenant', 'paid', {
                    tenantName: t.name,
                    houseNumber: t.houseNumber,
                    amount,
                    plan: t.plan,
                    period,
                    storage: savedSource
                });
            } catch (e) { /* non-fatal */ }

            setTimeout(() => this.closeCollectRentModal(), 700);
        }
    }

    // ---------- Rent reminder ----------

    openReminderModal(tenantId) {
        const t = this.tenants.find((x) => x.id === tenantId);
        if (!t) { this._toast('Tenant not found', 'error'); return; }

        const cur = brandManager.getBrand().currency || 'KES';
        const brandName = brandManager.getBrand().name || 'Management';
        const outstanding = this._tenantOutstanding(t);
        const last = this._lastPaymentFor(t.id);

        document.getElementById('reminderTenantId').value = t.id;

        const summary = document.getElementById('reminderTenantSummary');
        if (summary) {
            summary.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <strong>${this._esc(t.name)}</strong>
                    <span style="color:var(--text-secondary);">${this._esc(t.phone || '-')}</span>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-secondary);">
                    <span>House #${this._esc(t.houseNumber || '-')} &middot; ${PLAN_LABELS[t.plan] || (t.plan || '-')}</span>
                    <span>Rent: ${cur} ${this._fmt(t.rentAmount || 0)}</span>
                </div>
                ${outstanding > 0
                    ? `<div style="margin-top:8px;padding:6px 10px;background:#fef3c7;color:#b45309;border-radius:6px;font-size:12px;font-weight:600;">Outstanding: ${cur} ${this._fmt(outstanding)}</div>`
                    : `<div style="margin-top:8px;padding:6px 10px;background:#dcfce7;color:#166534;border-radius:6px;font-size:12px;font-weight:600;">No outstanding balance</div>`}
            `;
        }

        const msg = this._buildReminderMessage(t, outstanding, last, cur, brandName);
        const ta = document.getElementById('reminderMessage');
        if (ta) ta.value = msg;

        document.getElementById('tenantReminderModal')?.classList.add('active');
    }

    closeReminderModal() {
        document.getElementById('tenantReminderModal')?.classList.remove('active');
    }

    _buildReminderMessage(t, outstanding, last, cur, brandName) {
        const periodLabel = this._suggestPeriodLabel(t.plan);
        const dueAmount = outstanding > 0 ? outstanding : (Number(t.rentAmount) || 0);
        const lastTxt = last
            ? `Your last payment of ${cur} ${this._fmt(last.amount || 0)} was received on ${this._fmtDate(last.paymentDate || last.createdAt)}.`
            : 'We have no record of a previous payment.';

        return [
            `Hello ${t.name},`,
            ``,
            `This is a friendly reminder from ${brandName} regarding rent for House #${t.houseNumber || ''} (${PLAN_LABELS[t.plan] || t.plan}).`,
            `Amount due for ${periodLabel}: ${cur} ${this._fmt(dueAmount)}.`,
            lastTxt,
            ``,
            `Kindly settle at your earliest convenience. Reply to this message if you have any questions.`,
            ``,
            `Thank you.`
        ].join('\n');
    }

    _normalizePhone(phone) {
        if (!phone) return '';
        let p = String(phone).replace(/[^\d+]/g, '');
        if (p.startsWith('+')) p = p.substring(1);
        return p;
    }

    async copyReminderMessage() {
        const msg = document.getElementById('reminderMessage')?.value || '';
        if (!msg.trim()) { this._toast('Message is empty', 'error'); return; }
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(msg);
            } else {
                const ta = document.createElement('textarea');
                ta.value = msg;
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                ta.remove();
            }
            this._toast('Message copied to clipboard', 'success');
        } catch (e) {
            console.error('Copy failed:', e);
            this._toast('Failed to copy message', 'error');
        }
    }

    sendReminder(via) {
        const tenantId = document.getElementById('reminderTenantId')?.value;
        const msg = document.getElementById('reminderMessage')?.value || '';
        const t = this.tenants.find((x) => x.id === tenantId);
        if (!t) { this._toast('Tenant not found', 'error'); return; }
        if (!msg.trim()) { this._toast('Message cannot be empty', 'error'); return; }

        const phone = this._normalizePhone(t.phone);
        if (!phone) { this._toast('Tenant has no phone number on file', 'error'); return; }

        const encoded = encodeURIComponent(msg);
        let url = '';

        if (via === 'whatsapp') {
            url = `https://wa.me/${phone}?text=${encoded}`;
            window.open(url, '_blank', 'noopener');
        } else if (via === 'sms') {
            const sep = /Android/i.test(navigator.userAgent) ? '?' : '&';
            url = `sms:+${phone}${sep}body=${encoded}`;
            window.location.href = url;
        } else {
            this._toast('Unknown send method', 'error');
            return;
        }

        try {
            window.activityTracker?.logActivity?.('tenant', 'reminder_sent', {
                tenantName: t.name,
                houseNumber: t.houseNumber,
                channel: via
            });
        } catch (e) { /* non-fatal */ }

        this._toast(`Reminder opened in ${via === 'whatsapp' ? 'WhatsApp' : 'SMS app'}`, 'success');
        this.closeReminderModal();
    }

    // ---------- Payment history ----------

    openHistoryModal(tenantId) {
        const t = this.tenants.find((x) => x.id === tenantId);
        if (!t) { this._toast('Tenant not found', 'error'); return; }

        this._historyTenantId = tenantId;

        const cur = brandManager.getBrand().currency || 'KES';
        const titleEl = document.getElementById('tenantHistoryTitle');
        if (titleEl) titleEl.textContent = `Rent Payment History — ${t.name}`;

        const summary = document.getElementById('tenantHistorySummary');
        if (summary) {
            summary.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
                    <div>
                        <strong style="font-size:14px;">${this._esc(t.name)}</strong>
                        <span style="color:var(--text-secondary);margin-left:8px;">${this._esc(t.phone || '-')}</span>
                    </div>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;font-size:12px;">
                        <span class="badge" style="background:#eef2ff;color:#4338ca;padding:3px 10px;border-radius:6px;">House #${this._esc(t.houseNumber || '-')}</span>
                        <span class="badge" style="background:#f0fdf4;color:#15803d;padding:3px 10px;border-radius:6px;">${PLAN_LABELS[t.plan] || (t.plan || '-')}</span>
                        <span class="badge" style="background:#fef3c7;color:#b45309;padding:3px 10px;border-radius:6px;">Rent: ${cur} ${this._fmt(t.rentAmount || 0)}</span>
                    </div>
                </div>
            `;
        }

        const rangeSel = document.getElementById('tenantHistoryRange');
        if (rangeSel && !rangeSel._wired) {
            rangeSel._wired = true;
            rangeSel.addEventListener('change', () => this._renderHistory());
        }

        document.getElementById('tenantHistoryModal')?.classList.add('active');
        // Render after the modal is visible so the canvas has its real size
        requestAnimationFrame(() => this._renderHistory());
    }

    closeHistoryModal() {
        document.getElementById('tenantHistoryModal')?.classList.remove('active');
        this._historyTenantId = null;
    }

    _renderHistory() {
        const tenantId = this._historyTenantId;
        if (!tenantId) return;
        const t = this.tenants.find((x) => x.id === tenantId);
        if (!t) return;

        const cur = brandManager.getBrand().currency || 'KES';
        const all = this.payments
            .filter((p) => p.tenantId === tenantId)
            .slice()
            .sort((a, b) => new Date(a.paymentDate || a.createdAt || 0) - new Date(b.paymentDate || b.createdAt || 0));

        // Stats
        const total = all.reduce((s, p) => s + (Number(p.amount) || 0), 0);
        const count = all.length;
        const avg = count ? total / count : 0;
        const lastPay = all[all.length - 1] || null;
        const statsEl = document.getElementById('tenantHistoryStats');
        if (statsEl) {
            statsEl.innerHTML = `
                <div class="stat-card"><div class="stat-header"><span class="stat-label">Total Paid</span></div><div class="stat-value" style="color:#10b981;">${cur} ${this._fmt(total)}</div></div>
                <div class="stat-card"><div class="stat-header"><span class="stat-label">Payments</span></div><div class="stat-value">${count}</div></div>
                <div class="stat-card"><div class="stat-header"><span class="stat-label">Avg Payment</span></div><div class="stat-value">${cur} ${this._fmt(avg)}</div></div>
                <div class="stat-card"><div class="stat-header"><span class="stat-label">Last Payment</span></div><div class="stat-value" style="font-size:18px;">${lastPay ? this._fmtDate(lastPay.paymentDate || lastPay.createdAt) : '—'}</div></div>
            `;
        }

        // Range
        const rangeVal = document.getElementById('tenantHistoryRange')?.value || '12';
        let chartPayments = all;
        if (rangeVal !== 'all') {
            const months = parseInt(rangeVal, 10) || 12;
            const cutoff = new Date();
            cutoff.setMonth(cutoff.getMonth() - months + 1);
            cutoff.setDate(1);
            cutoff.setHours(0, 0, 0, 0);
            chartPayments = all.filter((p) => new Date(p.paymentDate || p.createdAt || 0) >= cutoff);
        }

        // Bucket by year-month
        const buckets = new Map();
        const months = rangeVal === 'all'
            ? this._monthsBetween(
                chartPayments[0] ? new Date(chartPayments[0].paymentDate || chartPayments[0].createdAt) : new Date(),
                new Date()
            )
            : this._monthsBetween(
                (() => { const d = new Date(); d.setMonth(d.getMonth() - (parseInt(rangeVal, 10) - 1)); d.setDate(1); return d; })(),
                new Date()
            );

        months.forEach((key) => buckets.set(key, 0));
        chartPayments.forEach((p) => {
            const d = new Date(p.paymentDate || p.createdAt || 0);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            buckets.set(key, (buckets.get(key) || 0) + (Number(p.amount) || 0));
        });

        const labels = Array.from(buckets.keys());
        const values = Array.from(buckets.values());
        this._drawHistoryChart(document.getElementById('tenantHistoryChart'), labels, values, cur);

        // List (newest first)
        const body = document.getElementById('tenantHistoryTableBody');
        if (body) {
            const rows = all.slice().reverse();
            if (rows.length === 0) {
                body.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--text-secondary);">No payments yet.</td></tr>`;
            } else {
                body.innerHTML = rows.map((p) => `
                    <tr>
                        <td>${this._fmtDate(p.paymentDate || p.createdAt)}</td>
                        <td>${this._esc(p.periodLabel || '-')}</td>
                        <td><strong>${cur} ${this._fmt(p.amount || 0)}</strong></td>
                        <td>${this._esc(this._methodLabel(p.method))}</td>
                        <td>${this._esc(p.recordedByName || '-')}</td>
                        <td style="color:var(--text-secondary);">${this._esc(p.notes || '')}</td>
                    </tr>`).join('');
            }
        }
    }

    _monthsBetween(start, end) {
        const out = [];
        const d = new Date(start.getFullYear(), start.getMonth(), 1);
        const last = new Date(end.getFullYear(), end.getMonth(), 1);
        while (d <= last) {
            out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
            d.setMonth(d.getMonth() + 1);
        }
        return out.length ? out : [`${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}`];
    }

    _drawHistoryChart(canvas, labels, values, cur) {
        if (!canvas) return;
        const ctx = canvas.getContext('2d');

        // Match the canvas backing store to its CSS size for crisp rendering
        const dpr = window.devicePixelRatio || 1;
        const cssW = canvas.clientWidth || 800;
        const cssH = canvas.clientHeight || 240;
        canvas.width  = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const w = cssW, h = cssH;
        const padL = 56, padR = 16, padT = 18, padB = 36;
        const chartW = w - padL - padR;
        const chartH = h - padT - padB;

        ctx.clearRect(0, 0, w, h);

        if (!labels.length) {
            ctx.fillStyle = '#9ca3af';
            ctx.font = '13px Montserrat, Arial, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('No payments to chart', w / 2, h / 2);
            return;
        }

        const maxVal = Math.max(...values, 0);
        const niceMax = maxVal > 0 ? this._niceMax(maxVal) : 100;

        // Grid + Y labels
        ctx.strokeStyle = '#e5e7eb';
        ctx.fillStyle   = '#9ca3af';
        ctx.font        = '11px Montserrat, Arial, sans-serif';
        ctx.textAlign   = 'right';
        ctx.lineWidth   = 1;
        const lines = 4;
        for (let i = 0; i <= lines; i++) {
            const y = padT + (chartH * i) / lines;
            ctx.beginPath();
            ctx.moveTo(padL, y);
            ctx.lineTo(padL + chartW, y);
            ctx.stroke();
            const v = niceMax * (1 - i / lines);
            ctx.fillText(this._shortNumber(v), padL - 8, y + 3);
        }

        // Bars
        const barGap = 6;
        const barW = Math.max(6, (chartW / labels.length) - barGap);
        labels.forEach((lab, i) => {
            const v = values[i] || 0;
            const x = padL + i * (chartW / labels.length) + ((chartW / labels.length) - barW) / 2;
            const barH = niceMax > 0 ? (v / niceMax) * chartH : 0;
            const y = padT + chartH - barH;

            const grad = ctx.createLinearGradient(0, y, 0, padT + chartH);
            grad.addColorStop(0, '#6366f1');
            grad.addColorStop(1, '#a5b4fc');
            ctx.fillStyle = v > 0 ? grad : '#e5e7eb';
            this._roundedRect(ctx, x, y, barW, Math.max(barH, v > 0 ? 2 : 0), 4);
            ctx.fill();

            // Value label on top of bar (only if there's room and value > 0)
            if (v > 0 && barH > 16) {
                ctx.fillStyle = '#4338ca';
                ctx.font = '10px Montserrat, Arial, sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(this._shortNumber(v), x + barW / 2, y - 4);
            }

            // X-axis label (Mon-YY)
            const [yr, mo] = lab.split('-');
            const monthLabel = new Date(parseInt(yr, 10), parseInt(mo, 10) - 1, 1)
                .toLocaleString('default', { month: 'short' });
            const xLabel = labels.length > 12 ? `${monthLabel}` : `${monthLabel} ${yr.slice(2)}`;
            ctx.fillStyle = '#6b7280';
            ctx.font = '10px Montserrat, Arial, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(xLabel, x + barW / 2, padT + chartH + 16);
        });

        // Axis line
        ctx.strokeStyle = '#d1d5db';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(padL, padT + chartH);
        ctx.lineTo(padL + chartW, padT + chartH);
        ctx.stroke();

        // Title (currency hint)
        ctx.fillStyle = '#6b7280';
        ctx.font = '10px Montserrat, Arial, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`Amount (${cur})`, padL, padT - 4);
    }

    _roundedRect(ctx, x, y, w, h, r) {
        const rr = Math.min(r, w / 2, h / 2);
        ctx.beginPath();
        ctx.moveTo(x + rr, y);
        ctx.lineTo(x + w - rr, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
        ctx.lineTo(x + w, y + h - rr);
        ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
        ctx.lineTo(x + rr, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
        ctx.lineTo(x, y + rr);
        ctx.quadraticCurveTo(x, y, x + rr, y);
        ctx.closePath();
    }

    _niceMax(v) {
        if (v <= 0) return 100;
        const exp = Math.floor(Math.log10(v));
        const base = Math.pow(10, exp);
        const m = v / base;
        let nice;
        if (m <= 1)      nice = 1;
        else if (m <= 2) nice = 2;
        else if (m <= 5) nice = 5;
        else             nice = 10;
        return nice * base;
    }

    _shortNumber(n) {
        const v = Number(n) || 0;
        if (Math.abs(v) >= 1e9) return (v / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
        if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
        if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
        return v.toFixed(0);
    }

    // ---------- Helpers ----------

    _setText(id, txt) {
        const el = document.getElementById(id);
        if (el) el.textContent = txt;
    }
    _esc(s) {
        return String(s ?? '').replace(/[&<>"']/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[c]);
    }
    _fmt(n) {
        return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    _fmtDate(iso) {
        if (!iso) return '-';
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '-';
        return d.toLocaleDateString();
    }
    _methodLabel(m) {
        return ({ cash: 'Cash', mpesa: 'M-Pesa', bank: 'Bank', card: 'Card', other: 'Other' })[m] || (m || '-');
    }
    _toast(msg, type = 'info') {
        if (typeof window.showNotification === 'function') {
            window.showNotification(msg, type);
            return;
        }
        const n = document.createElement('div');
        n.textContent = msg;
        n.style.cssText = `
            position:fixed;top:80px;right:20px;padding:14px 20px;border-radius:8px;
            background:${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
            color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.18);z-index:99999;
            font-family:'Montserrat',sans-serif;font-size:13px;font-weight:500;`;
        document.body.appendChild(n);
        setTimeout(() => n.remove(), 3500);
    }
}

const tenantsManager = new TenantsManager();

if (typeof window !== 'undefined') {
    window.tenantsManager = tenantsManager;
}

export default tenantsManager;
