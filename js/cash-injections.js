// Cash Injections Manager
// Handles manual cash inflows that aren't tied to sales — daily cash floats,
// company drop-offs for staff, capital injections, refunds, etc.
// Streams /cashInjections in real time, branch-scoped + RBAC-aware.

import {
    db, isFirebaseConfigured,
    collection, addDoc, doc, deleteDoc,
    query, where, onSnapshot
} from './firebase-config.js';
import branchManager from './branch-manager.js';
import sessionManager from './session-manager.js';
import brandManager from './brand-manager.js';
import { setBtnState, friendlyError } from './ui-feedback.js';

const TYPE_LABELS = {
    float:   'Cash Float',
    capital: 'Capital Injection',
    company: 'Company Drop-off',
    refund:  'Refund Received',
    loan:    'Loan / Advance',
    other:   'Other'
};

const TYPE_BADGES = {
    float:   ['#dbeafe', '#1d4ed8'],
    capital: ['#dcfce7', '#15803d'],
    company: ['#fef3c7', '#b45309'],
    refund:  ['#ede9fe', '#5b21b6'],
    loan:    ['#fee2e2', '#b91c1c'],
    other:   ['#e5e7eb', '#475569']
};

class CashInjectionsManager {
    constructor() {
        this.entries = [];
        this.useLocal = !isFirebaseConfigured;
        this._unsub = null;
        this._wired = false;
        this._callbacks = [];

        // All-entries modal filter state
        this._allFilters = {
            search: '',
            type: 'all',
            range: 'all',   // all | today | week | month | custom
            from: '',
            to: ''
        };
        this._allFiltersWired = false;

        if (this.useLocal) this._loadLocal();
    }

    // ---------- Public API ----------

    init() {
        if (!this._wired) {
            this._wired = true;
            this._wireUI();
            window.addEventListener('branchChanged', () => this._restartStream());
        }
        this._restartStream();
    }

    onChange(cb) {
        if (typeof cb === 'function') this._callbacks.push(cb);
        return () => {
            const i = this._callbacks.indexOf(cb);
            if (i >= 0) this._callbacks.splice(i, 1);
        };
    }

    getEntries() { return this.entries.slice(); }

    // Sum of cash injections in a given timeframe ({ startDate, endDate })
    sumInRange(start, end) {
        const s = start instanceof Date ? start.getTime() : new Date(start).getTime();
        const e = end   instanceof Date ? end.getTime()   : new Date(end).getTime();
        return this.entries.reduce((sum, x) => {
            const t = new Date(x.entryDate || x.createdAt).getTime();
            if (t >= s && t <= e) return sum + (Number(x.amount) || 0);
            return sum;
        }, 0);
    }

    sumToday() {
        const start = new Date(); start.setHours(0, 0, 0, 0);
        const end   = new Date(); end.setHours(23, 59, 59, 999);
        return this.sumInRange(start, end);
    }

    todayEntries() {
        const start = new Date(); start.setHours(0, 0, 0, 0);
        return this.entries
            .filter((x) => new Date(x.entryDate || x.createdAt).getTime() >= start.getTime())
            .sort((a, b) => new Date(b.entryDate || b.createdAt) - new Date(a.entryDate || a.createdAt));
    }

    // ---------- Storage ----------

    _loadLocal() {
        try { this.entries = JSON.parse(localStorage.getItem('vendlfy_cash_injections') || '[]'); }
        catch (e) { this.entries = []; }
    }
    _saveLocal() {
        try { localStorage.setItem('vendlfy_cash_injections', JSON.stringify(this.entries)); }
        catch (e) {}
    }

    _branchScopedQuery() {
        const ref = collection(db, 'cashInjections');
        const allowed = sessionManager.getAllowedBranchIds();
        const current = branchManager.getCurrentBranch?.();
        const viewingAll = branchManager.isViewingAllBranches?.();

        if (allowed === null && current && !viewingAll) {
            return query(ref, where('branchId', '==', current.id));
        }
        if (allowed === null) return ref;
        if (!allowed || allowed.length === 0) return query(ref, where('branchId', '==', '__no_access__'));
        if (allowed.length === 1) return query(ref, where('branchId', '==', allowed[0]));
        return query(ref, where('branchId', 'in', allowed.slice(0, 30)));
    }

    _restartStream() {
        try { this._unsub?.(); } catch (e) {}
        this._unsub = null;

        if (this.useLocal) {
            this._notify();
            return;
        }
        try {
            const q = this._branchScopedQuery();
            this._unsub = onSnapshot(
                q,
                (snap) => {
                    this.entries = [];
                    snap.forEach((d) => this.entries.push({ id: d.id, ...d.data() }));
                    this.entries.sort((a, b) =>
                        new Date(b.entryDate || b.createdAt || 0) -
                        new Date(a.entryDate || a.createdAt || 0)
                    );
                    this._notify();
                },
                (err) => console.warn('Cash injections stream error:', err.message)
            );
        } catch (e) {
            console.error('Failed to start cash injections stream:', e);
        }
    }

    _notify() {
        this._callbacks.forEach((cb) => { try { cb(this.entries); } catch (e) {} });
        // If the all-entries modal is open, keep it in sync with live updates
        const modal = document.getElementById('allCashInjectionsModal');
        if (modal && modal.classList.contains('active')) {
            this._renderAllEntriesTable();
        }
    }

    // ---------- UI ----------

    _wireUI() {
        document.getElementById('addCashInjectionBtn')?.addEventListener('click', () => this.openModal());
        document.getElementById('viewAllCashInjectionsBtn')?.addEventListener('click', () => this.openAllEntriesModal());
    }

    openModal() {
        if (!sessionManager.hasPermission('accounts.cashin')) {
            this._toast('You do not have permission to add cash entries', 'error');
            return;
        }
        const modal = document.getElementById('cashInjectionModal');
        if (!modal) return;

        document.getElementById('cashInjectionForm')?.reset();
        document.getElementById('cashInjectionDate').value = new Date().toISOString().substring(0, 10);
        document.getElementById('cashInjectionType').value = 'float';
        modal.classList.add('active');
        setTimeout(() => document.getElementById('cashInjectionAmount')?.focus(), 60);
    }

    closeModal() {
        document.getElementById('cashInjectionModal')?.classList.remove('active');
    }

    openAllEntriesModal() {
        const modal = document.getElementById('allCashInjectionsModal');
        if (!modal) return;
        this._wireAllEntriesFilters();
        this._renderAllEntriesTable();
        modal.classList.add('active');
    }

    _wireAllEntriesFilters() {
        if (this._allFiltersWired) return;
        this._allFiltersWired = true;

        const search = document.getElementById('cashInjectionsSearchInput');
        if (search) {
            let t;
            search.addEventListener('input', (e) => {
                clearTimeout(t);
                t = setTimeout(() => {
                    this._allFilters.search = e.target.value.trim().toLowerCase();
                    this._renderAllEntriesTable();
                }, 200);
            });
        }

        document.getElementById('cashInjectionsTypeFilter')?.addEventListener('change', (e) => {
            this._allFilters.type = e.target.value;
            this._renderAllEntriesTable();
        });

        document.getElementById('cashInjectionsRangeFilter')?.addEventListener('change', (e) => {
            const range = e.target.value;
            this._allFilters.range = range;
            const fromEl = document.getElementById('cashInjectionsDateFrom');
            const toEl   = document.getElementById('cashInjectionsDateTo');
            const showCustom = (range === 'custom');
            if (fromEl) fromEl.style.display = showCustom ? '' : 'none';
            if (toEl)   toEl.style.display   = showCustom ? '' : 'none';
            this._renderAllEntriesTable();
        });

        document.getElementById('cashInjectionsDateFrom')?.addEventListener('change', (e) => {
            this._allFilters.from = e.target.value;
            this._renderAllEntriesTable();
        });
        document.getElementById('cashInjectionsDateTo')?.addEventListener('change', (e) => {
            this._allFilters.to = e.target.value;
            this._renderAllEntriesTable();
        });

        document.getElementById('cashInjectionsClearFiltersBtn')?.addEventListener('click', () => {
            this._allFilters = { search: '', type: 'all', range: 'all', from: '', to: '' };
            const s    = document.getElementById('cashInjectionsSearchInput');
            const ty   = document.getElementById('cashInjectionsTypeFilter');
            const rg   = document.getElementById('cashInjectionsRangeFilter');
            const fr   = document.getElementById('cashInjectionsDateFrom');
            const to   = document.getElementById('cashInjectionsDateTo');
            if (s)  s.value  = '';
            if (ty) ty.value = 'all';
            if (rg) rg.value = 'all';
            if (fr) { fr.value = ''; fr.style.display = 'none'; }
            if (to) { to.value = ''; to.style.display = 'none'; }
            this._renderAllEntriesTable();
        });
    }

    _filterAllEntries() {
        const f = this._allFilters;
        let out = this.entries.slice();

        if (f.search) {
            out = out.filter((e) =>
                (e.source || '').toLowerCase().includes(f.search) ||
                (e.notes  || '').toLowerCase().includes(f.search) ||
                (e.recordedByName || '').toLowerCase().includes(f.search)
            );
        }

        if (f.type && f.type !== 'all') {
            out = out.filter((e) => (e.type || 'other') === f.type);
        }

        let start = null, end = null;
        if (f.range === 'today') {
            start = new Date(); start.setHours(0, 0, 0, 0);
            end   = new Date(); end.setHours(23, 59, 59, 999);
        } else if (f.range === 'week') {
            start = new Date(); start.setDate(start.getDate() - start.getDay());
            start.setHours(0, 0, 0, 0);
            end = new Date(); end.setHours(23, 59, 59, 999);
        } else if (f.range === 'month') {
            start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0);
            end = new Date(); end.setHours(23, 59, 59, 999);
        } else if (f.range === 'custom') {
            if (f.from) { start = new Date(f.from); start.setHours(0, 0, 0, 0); }
            if (f.to)   { end   = new Date(f.to);   end.setHours(23, 59, 59, 999); }
        }

        if (start || end) {
            out = out.filter((e) => {
                const t = new Date(e.entryDate || e.createdAt).getTime();
                if (start && t < start.getTime()) return false;
                if (end   && t > end.getTime())   return false;
                return true;
            });
        }

        return out;
    }

    closeAllEntriesModal() {
        document.getElementById('allCashInjectionsModal')?.classList.remove('active');
    }

    async saveEntry() {
        // The Save button has an inline onclick so we resolve it from the form.
        const form = document.getElementById('cashInjectionForm');
        const btn = form?.querySelector('button.btn-primary')
            || document.querySelector('#cashInjectionModal button.btn-primary')
            || null;

        const amount = parseFloat(document.getElementById('cashInjectionAmount').value);
        const type   = document.getElementById('cashInjectionType').value;
        const date   = document.getElementById('cashInjectionDate').value;
        const source = document.getElementById('cashInjectionSource').value.trim();
        const notes  = document.getElementById('cashInjectionNotes').value.trim();

        if (isNaN(amount) || amount <= 0) { this._toast('Enter a valid amount greater than zero', 'error'); return; }
        if (!type) { this._toast('Pick an entry type', 'error'); return; }
        if (!date) { this._toast('Pick a date', 'error'); return; }

        const branch = branchManager.getCurrentBranch?.();
        const me     = sessionManager.getUser?.() || {};
        const auth   = sessionManager.getAuthUser?.();
        const data = {
            amount,
            type,
            source,
            notes,
            entryDate:      new Date(date).toISOString(),
            recordedById:   auth?.uid || null,
            recordedByName: me.fullName || me.name || me.email || auth?.email || 'Unknown',
            branchId:   branch?.id   || null,
            branchName: branch?.name || null,
            createdAt:  new Date().toISOString()
        };

        setBtnState(btn, 'loading', 'Saving…');
        try {
            if (this.useLocal) {
                this.entries.unshift({ id: 'lc_' + Date.now(), ...data });
                this._saveLocal();
                this._notify();
            } else {
                await addDoc(collection(db, 'cashInjections'), data);
            }

            window.activityTracker?.logActivity?.('cashin', 'added', {
                amount,
                type: TYPE_LABELS[type] || type,
                source,
                currency: brandManager.getBrand().currency || 'KES'
            });

            setBtnState(btn, 'success', 'Saved!');
            this._toast(`${this._fmtAmount(amount)} added to today's cash`, 'success');

            if (window.accountsManager?.renderDashboard) {
                window.accountsManager.renderDashboard();
            }

            setTimeout(() => this.closeModal(), 700);
        } catch (e) {
            console.error('Save cash entry failed:', e);
            setBtnState(btn, 'error', 'Failed');
            this._toast(friendlyError(e, 'save cash entry'), 'error');
        }
    }

    async deleteEntry(id) {
        const entry = this.entries.find((x) => x.id === id);
        if (!entry) return;
        const ok = await window.uiConfirm?.({
            title: 'Delete entry?',
            message: `Remove this ${TYPE_LABELS[entry.type] || entry.type} entry of ${this._fmtAmount(entry.amount)}?`,
            tone: 'danger',
            okLabel: 'Delete'
        });
        if (!ok) return;

        try {
            if (this.useLocal) {
                this.entries = this.entries.filter((x) => x.id !== id);
                this._saveLocal();
                this._notify();
            } else {
                await deleteDoc(doc(db, 'cashInjections', id));
            }
            window.activityTracker?.logActivity?.('cashin', 'deleted', {
                amount: entry.amount,
                type: TYPE_LABELS[entry.type] || entry.type
            });
            this._toast('Cash entry deleted', 'success');
            this._renderAllEntriesTable();
        } catch (e) {
            console.error('Delete cash entry failed:', e);
            this._toast('Failed to delete: ' + (e.message || 'permission denied'), 'error');
        }
    }

    // Render today's entries inside the reconciliation card
    renderTodayList() {
        const container = document.getElementById('todayCashInjectionsList');
        if (!container) return;

        const today = this.todayEntries();
        if (today.length === 0) {
            container.innerHTML = `<p style="text-align:center;color:var(--text-tertiary);font-size:13px;padding:14px 0;">No cash entries recorded today.</p>`;
            return;
        }

        const cur = brandManager.getBrand().currency || 'KES';
        container.innerHTML = `
            <div style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-secondary);margin-bottom:8px;">Today's Cash Entries</div>
            ${today.map((e) => {
                const [bg, fg] = TYPE_BADGES[e.type] || TYPE_BADGES.other;
                return `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:var(--bg-secondary);border-radius:8px;margin-bottom:6px;">
                    <div style="display:flex;flex-direction:column;gap:2px;">
                        <div style="display:flex;align-items:center;gap:8px;">
                            <span style="background:${bg};color:${fg};padding:2px 8px;border-radius:6px;font-size:11px;font-weight:600;">${TYPE_LABELS[e.type] || e.type}</span>
                            ${e.source ? `<span style="font-size:13px;font-weight:500;">${this._esc(e.source)}</span>` : ''}
                        </div>
                        ${e.notes ? `<span style="font-size:11px;color:var(--text-tertiary);">${this._esc(e.notes)}</span>` : ''}
                        <span style="font-size:11px;color:var(--text-tertiary);">${e.recordedByName || 'Unknown'} &middot; ${this._fmtTime(e.createdAt)}</span>
                    </div>
                    <div style="font-size:15px;font-weight:700;color:#15803d;">+ ${cur} ${this._fmt(e.amount)}</div>
                </div>`;
            }).join('')}`;
    }

    _renderAllEntriesTable() {
        const body = document.getElementById('allCashInjectionsTableBody');
        if (!body) return;

        const filtered = this._filterAllEntries();
        const summary  = document.getElementById('cashInjectionsResultSummary');
        const cur = brandManager.getBrand().currency || 'KES';

        if (summary) {
            const total = filtered.reduce((s, x) => s + (Number(x.amount) || 0), 0);
            summary.textContent = filtered.length === 0
                ? `0 entries`
                : `${filtered.length} ${filtered.length === 1 ? 'entry' : 'entries'} · Total ${cur} ${this._fmt(total)}`;
        }

        if (this.entries.length === 0) {
            body.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--text-secondary);">No cash entries recorded yet.</td></tr>`;
            return;
        }

        if (filtered.length === 0) {
            body.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--text-secondary);">
                No entries match your filters.
            </td></tr>`;
            return;
        }

        const canDelete = sessionManager.isAdmin();

        body.innerHTML = filtered.map((e) => {
            const [bg, fg] = TYPE_BADGES[e.type] || TYPE_BADGES.other;
            return `
                <tr>
                    <td>${this._fmtDate(e.entryDate || e.createdAt)}</td>
                    <td><span style="background:${bg};color:${fg};padding:2px 8px;border-radius:6px;font-size:11px;font-weight:600;">${TYPE_LABELS[e.type] || e.type}</span></td>
                    <td>${this._esc(e.source || '-')}</td>
                    <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${this._esc(e.notes || '')}">${this._esc(e.notes || '-')}</td>
                    <td style="text-align:right;font-weight:700;color:#15803d;">${cur} ${this._fmt(e.amount)}</td>
                    <td>${this._esc(e.recordedByName || '-')}</td>
                    <td style="text-align:right;">
                        ${canDelete ? `<button class="btn-icon" title="Delete" style="color:#ef4444;" onclick="window.cashInjectionsManager.deleteEntry('${e.id}')">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        </button>` : ''}
                    </td>
                </tr>`;
        }).join('');
    }

    // ---------- helpers ----------

    _esc(s) {
        return String(s ?? '').replace(/[&<>"']/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[c]);
    }
    _fmt(n) {
        return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    _fmtAmount(n) {
        const cur = brandManager.getBrand().currency || 'KES';
        return `${cur} ${this._fmt(n)}`;
    }
    _fmtDate(iso) {
        if (!iso) return '-';
        const d = new Date(iso);
        return isNaN(d.getTime()) ? '-' : d.toLocaleDateString();
    }
    _fmtTime(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        return isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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

const cashInjectionsManager = new CashInjectionsManager();

if (typeof window !== 'undefined') {
    window.cashInjectionsManager = cashInjectionsManager;
}

export default cashInjectionsManager;
