// Ventures Module - Side Businesses (gambling, aviator, M-Pesa, etc.)
// Each venture has a daily finance log (income / expenses / net)
// Real-time, branch-scoped, RBAC-aware.

import {
    db, isFirebaseConfigured,
    collection,
    query, where
} from './firebase-config.js';
import branchManager from './branch-manager.js';
import sessionManager from './session-manager.js';
import brandManager from './brand-manager.js';
import { addWithFallback, updateWithFallback, deleteWithFallback, streamDual } from './storage-adapter.js';
import { setBtnState, friendlyError } from './ui-feedback.js';

const TYPES = {
    gambling:  { label: 'Gambling / Betting', color: '#ef4444' },
    aviator:   { label: 'Aviator',            color: '#f59e0b' },
    lottery:   { label: 'Lottery',            color: '#a855f7' },
    kanyonde:  { label: 'Kanyonde',           color: '#db2777' },
    mpesa:     { label: 'M-Pesa Agent',       color: '#10b981' },
    cyber:     { label: 'Cyber Café',         color: '#3b82f6' },
    rental:    { label: 'Rental',             color: '#0ea5e9' },
    farm:      { label: 'Farm / Agriculture', color: '#16a34a' },
    transport: { label: 'Transport',          color: '#6366f1' },
    kiosk:     { label: 'Kiosk',              color: '#f97316' },
    services:  { label: 'Services',           color: '#0891b2' },
    other:     { label: 'Other',              color: '#64748b' }
};

const STATUS = {
    active: { label: 'Active',  bg: '#dcfce7', fg: '#15803d' },
    paused: { label: 'Paused',  bg: '#fef3c7', fg: '#b45309' },
    closed: { label: 'Closed',  bg: '#e5e7eb', fg: '#475569' }
};

class VenturesManager {
    constructor() {
        this.ventures = [];
        this.entries  = [];
        this.useLocal = !isFirebaseConfigured;
        this.currentVentureId = null;     // detail view target
        this.searchTerm = '';
        this.categoryFilter = 'all';
        this.statusFilter = 'all';
        this.sortBy = 'name';             // name | today | month | balance | recent | created
        this.entriesRange = 'all';        // all | month | week | today
        this._venturesUnsub = null;
        this._entriesUnsub  = null;
        this._wired = false;

        if (this.useLocal) this._loadLocal();
    }

    // ---------- Lifecycle ----------

    init() {
        if (!this._wired) {
            this._wired = true;
            this._wireUI();
            window.addEventListener('branchChanged', () => this._restartStreams());
        }
        this._restartStreams();
        this._renderList();
    }

    _restartStreams() {
        try { this._venturesUnsub?.(); } catch (e) {}
        try { this._entriesUnsub?.(); }  catch (e) {}
        this._venturesUnsub = null;
        this._entriesUnsub  = null;

        if (this.useLocal) {
            this._renderAll();
            return;
        }
        this._startVenturesStream();
        this._startEntriesStream();
    }

    _branchScopedQuery(name) {
        const ref = collection(db, name);
        const allowed = sessionManager.getAllowedBranchIds();
        const current = branchManager.getCurrentBranch?.();
        const viewingAll = branchManager.isViewingAllBranches?.();

        if (allowed === null && current && !viewingAll) return query(ref, where('branchId', '==', current.id));
        if (allowed === null) return ref;
        if (!allowed || allowed.length === 0) return query(ref, where('branchId', '==', '__no_access__'));
        if (allowed.length === 1) return query(ref, where('branchId', '==', allowed[0]));
        return query(ref, where('branchId', 'in', allowed.slice(0, 30)));
    }

    // Client-side filter so RTDB merged stream matches Firestore branch scope.
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

    _startVenturesStream() {
        try {
            const fsQuery = this._branchScopedQuery('ventures');
            const branchFilter = this._currentBranchFilter();

            this._venturesUnsub = streamDual({
                firestoreQuery: fsQuery,
                rtdbPath: 'ventures',
                rtdbFilter: branchFilter,
                onUpdate: (items) => {
                    this.ventures = items.slice();
                    this.ventures.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
                    const fsCount = items.filter((x) => x._source === 'firestore').length;
                    const rtdbCount = items.filter((x) => x._source === 'rtdb').length;
                    console.log(`🎯 Ventures stream: ${this.ventures.length} venture(s) (${fsCount} Firestore, ${rtdbCount} RTDB)`);
                    this._renderAll();
                },
                onError: (err, source) => {
                    console.error(`❌ Ventures stream (${source}) error:`, err?.code, err?.message);
                }
            });
        } catch (e) { console.error('Ventures stream failed:', e); }
    }

    _startEntriesStream() {
        try {
            const fsQuery = this._branchScopedQuery('ventureEntries');
            const branchFilter = this._currentBranchFilter();

            this._entriesUnsub = streamDual({
                firestoreQuery: fsQuery,
                rtdbPath: 'ventureEntries',
                rtdbFilter: branchFilter,
                onUpdate: (items) => {
                    this.entries = items.slice();
                    this.entries.sort((a, b) =>
                        new Date(b.entryDate || b.createdAt || 0) -
                        new Date(a.entryDate || a.createdAt || 0)
                    );
                    const fsCount = items.filter((x) => x._source === 'firestore').length;
                    const rtdbCount = items.filter((x) => x._source === 'rtdb').length;
                    console.log(`📒 Venture entries stream: ${this.entries.length} entry(ies) (${fsCount} Firestore, ${rtdbCount} RTDB)`);
                    this._renderAll();
                },
                onError: (err, source) => {
                    console.error(`❌ Venture entries stream (${source}) error:`, err?.code, err?.message);
                }
            });
        } catch (e) { console.error('Entries stream failed:', e); }
    }

    _loadLocal() {
        try { this.ventures = JSON.parse(localStorage.getItem('vendlfy_ventures') || '[]'); } catch (e) {}
        try { this.entries  = JSON.parse(localStorage.getItem('vendlfy_venture_entries') || '[]'); } catch (e) {}
    }
    _saveLocal() {
        try {
            localStorage.setItem('vendlfy_ventures', JSON.stringify(this.ventures));
            localStorage.setItem('vendlfy_venture_entries', JSON.stringify(this.entries));
        } catch (e) {}
    }

    // ---------- UI wiring ----------

    _wireUI() {
        document.getElementById('createVentureBtn')?.addEventListener('click', () => this.openVentureModal());

        const search = document.getElementById('venturesSearchInput');
        if (search) {
            let t;
            search.addEventListener('input', (e) => {
                clearTimeout(t);
                t = setTimeout(() => {
                    this.searchTerm = e.target.value.trim().toLowerCase();
                    this._renderList();
                }, 200);
            });
        }

        document.getElementById('venturesCategoryFilter')?.addEventListener('change', (e) => {
            this.categoryFilter = e.target.value;
            this._renderList();
        });

        document.getElementById('venturesStatusFilter')?.addEventListener('change', (e) => {
            this.statusFilter = e.target.value;
            this._renderList();
        });

        document.getElementById('venturesSortBy')?.addEventListener('change', (e) => {
            this.sortBy = e.target.value;
            this._renderList();
        });

        document.getElementById('venturesClearFiltersBtn')?.addEventListener('click', () => this._clearFromEmpty());

        // Date-range filter on the detail page
        document.querySelectorAll('[data-venture-range]').forEach((btn) => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('[data-venture-range]').forEach((b) => b.classList.remove('active'));
                btn.classList.add('active');
                this.entriesRange = btn.getAttribute('data-venture-range') || 'all';
                this._renderDetail();
            });
        });

        // Live net = income - expenses inside the entry modal
        const inc = document.getElementById('ventureEntryIncome');
        const exp = document.getElementById('ventureEntryExpenses');
        const net = document.getElementById('ventureEntryNet');
        const updateNet = () => {
            const i = parseFloat(inc?.value) || 0;
            const e = parseFloat(exp?.value) || 0;
            const cur = brandManager.getBrand().currency || 'KES';
            if (net) net.value = `${cur} ${this._fmt(i - e)}`;
        };
        inc?.addEventListener('input', updateNet);
        exp?.addEventListener('input', updateNet);
    }

    // ---------- Rendering ----------

    _renderAll() {
        if (this.currentVentureId && document.getElementById('venture-detail-page')?.classList.contains('active')) {
            this._renderDetail();
        } else {
            this._renderList();
        }
    }

    _renderList() {
        this._renderListStats();
        this._renderListGrid();
    }

    _renderListStats() {
        const cur = brandManager.getBrand().currency || 'KES';
        const fmt = (n) => `${cur} ${this._fmt(n)}`;

        const active = this.ventures.filter((v) => (v.status || 'active') === 'active').length;

        const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
        const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);

        let todayNet = 0, monthNet = 0, allNet = 0;
        this.entries.forEach((e) => {
            const t   = new Date(e.entryDate || e.createdAt).getTime();
            const net = (Number(e.income) || 0) - (Number(e.expenses) || 0);
            allNet += net;
            if (t >= todayStart.getTime()) todayNet += net;
            if (t >= monthStart.getTime()) monthNet += net;
        });

        // Add opening balances to lifetime net (acts as starting capital)
        const openingTotal = this.ventures.reduce((s, v) => s + (Number(v.openingBalance) || 0), 0);
        const lifetime = allNet + openingTotal;

        this._setText('venturesActiveCount',   String(active));
        this._setText('venturesTodayNet',      fmt(todayNet));
        this._setText('venturesMonthNet',      fmt(monthNet));
        this._setText('venturesLifetimeNet',   fmt(lifetime));
    }

    _renderListGrid() {
        const grid = document.getElementById('venturesGrid');
        if (!grid) return;
        const cur = brandManager.getBrand().currency || 'KES';

        const list = this._filtered(this.ventures);
        const hasFilters = this.searchTerm || this.categoryFilter !== 'all' || this.statusFilter !== 'all';
        if (list.length === 0) {
            grid.innerHTML = `
                <div class="empty-state" style="grid-column:1 / -1; text-align:center; padding:48px 16px;">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:.4;margin-bottom:8px;">
                        <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"></polyline>
                        <polyline points="16 7 22 7 22 13"></polyline>
                    </svg>
                    <p>${hasFilters ? 'No ventures match your filters.' : 'No ventures yet. Click <strong>Create Venture</strong> above to add your first side business.'}</p>
                    ${hasFilters ? '<button class="btn btn-link" onclick="window.venturesManager._clearFromEmpty?.()" style="margin-top:8px;">Clear filters</button>' : ''}
                </div>`;
            return;
        }

        grid.innerHTML = list.map((v) => {
            const t = TYPES[v.type] || TYPES.other;
            const s = STATUS[v.status || 'active'] || STATUS.active;

            const ventureEntries = this.entries.filter((e) => e.ventureId === v.id);
            const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
            const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);

            let today = 0, month = 0, lifetime = Number(v.openingBalance) || 0;
            ventureEntries.forEach((e) => {
                const ts  = new Date(e.entryDate || e.createdAt).getTime();
                const net = (Number(e.income) || 0) - (Number(e.expenses) || 0);
                lifetime += net;
                if (ts >= todayStart.getTime()) today += net;
                if (ts >= monthStart.getTime()) month += net;
            });

            const last = ventureEntries[0]; // already sorted desc by stream
            const lastTxt = last ? this._fmtDate(last.entryDate || last.createdAt) : 'No entries yet';

            return `
                <div class="venture-card" style="background:var(--bg-card,#fff);border:1px solid var(--border-color,#e2e8f0);border-radius:12px;padding:16px;cursor:pointer;transition:all 0.15s;display:flex;flex-direction:column;gap:12px;" onclick="window.venturesManager.openVenture('${v.id}')" onmouseenter="this.style.transform='translateY(-2px)';this.style.boxShadow='0 6px 18px rgba(0,0,0,0.06)';" onmouseleave="this.style.transform='';this.style.boxShadow='';">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;">
                        <div style="display:flex;align-items:center;gap:10px;min-width:0;">
                            <div style="width:36px;height:36px;border-radius:8px;background:${t.color}22;color:${t.color};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"></polyline><polyline points="16 7 22 7 22 13"></polyline></svg>
                            </div>
                            <div style="min-width:0;">
                                <div style="font-weight:600;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${this._esc(v.name)}</div>
                                <div style="font-size:11px;color:var(--text-tertiary);">${t.label}</div>
                            </div>
                        </div>
                        <span style="background:${s.bg};color:${s.fg};padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;flex-shrink:0;">${s.label}</span>
                    </div>

                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                        <div style="background:var(--bg-secondary,#f8fafc);padding:8px 10px;border-radius:8px;">
                            <div style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;">Today</div>
                            <div style="font-size:13px;font-weight:700;color:${today >= 0 ? '#15803d' : '#b91c1c'};">${cur} ${this._fmt(today)}</div>
                        </div>
                        <div style="background:var(--bg-secondary,#f8fafc);padding:8px 10px;border-radius:8px;">
                            <div style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;">This Month</div>
                            <div style="font-size:13px;font-weight:700;color:${month >= 0 ? '#15803d' : '#b91c1c'};">${cur} ${this._fmt(month)}</div>
                        </div>
                    </div>

                    <div style="display:flex;justify-content:space-between;align-items:center;padding-top:8px;border-top:1px dashed var(--border-color,#e2e8f0);">
                        <div>
                            <div style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;">Balance</div>
                            <div style="font-size:15px;font-weight:700;color:${lifetime >= 0 ? '#0f172a' : '#b91c1c'};">${cur} ${this._fmt(lifetime)}</div>
                        </div>
                        <div style="text-align:right;font-size:11px;color:var(--text-tertiary);">
                            <div>Last entry</div>
                            <div style="font-weight:600;color:var(--text-secondary);">${lastTxt}</div>
                        </div>
                    </div>

                    <button type="button"
                        onclick="event.stopPropagation();window.venturesManager.openVenture('${v.id}')"
                        style="width:100%;padding:8px 12px;background:${t.color};color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;transition:opacity 0.15s;"
                        onmouseenter="this.style.opacity='0.9';"
                        onmouseleave="this.style.opacity='1';"
                        title="Open ${this._esc(v.name)} details">
                        Click to view
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                            <line x1="5" y1="12" x2="19" y2="12"></line>
                            <polyline points="12 5 19 12 12 19"></polyline>
                        </svg>
                    </button>
                </div>`;
        }).join('');
    }

    _renderDetail() {
        const v = this.ventures.find((x) => x.id === this.currentVentureId);
        if (!v) return;
        const cur = brandManager.getBrand().currency || 'KES';

        // Header
        this._setText('ventureDetailName', v.name);
        const t = TYPES[v.type] || TYPES.other;
        const s = STATUS[v.status || 'active'] || STATUS.active;
        this._setHTML('ventureDetailSubtitle',
            `<span style="color:${t.color};font-weight:600;">${t.label}</span>
             &nbsp;·&nbsp; <span style="background:${s.bg};color:${s.fg};padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;">${s.label}</span>
             ${v.description ? `&nbsp;·&nbsp; <span style="color:var(--text-tertiary);">${this._esc(v.description)}</span>` : ''}`);

        // Entries scoped to this venture
        const all = this.entries.filter((e) => e.ventureId === v.id);

        // Stats
        const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
        const weekStart  = new Date(); weekStart.setDate(weekStart.getDate() - 7); weekStart.setHours(0, 0, 0, 0);
        const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);

        let todayInc = 0, todayExp = 0;
        let week = 0, month = 0, allTime = 0;
        let totalIncome = 0, totalExpenses = 0;
        all.forEach((e) => {
            const ts  = new Date(e.entryDate || e.createdAt).getTime();
            const inc = Number(e.income) || 0;
            const exp = Number(e.expenses) || 0;
            const net = inc - exp;
            allTime += net;
            totalIncome += inc;
            totalExpenses += exp;
            if (ts >= todayStart.getTime()) { todayInc += inc; todayExp += exp; }
            if (ts >= weekStart.getTime())  week  += net;
            if (ts >= monthStart.getTime()) month += net;
        });

        const opening = Number(v.openingBalance) || 0;
        const balance = opening + allTime;
        const todayNet = todayInc - todayExp;

        this._setText('ventureStatToday',         `${cur} ${this._fmt(todayNet)}`);
        this._setHTML('ventureStatTodayDetail',   `<span style="color:#15803d;">+${cur} ${this._fmt(todayInc)}</span> &middot; <span style="color:#b91c1c;">-${cur} ${this._fmt(todayExp)}</span>`);
        this._setText('ventureStatWeek',          `${cur} ${this._fmt(week)}`);
        this._setText('ventureStatMonth',         `${cur} ${this._fmt(month)}`);
        this._setText('ventureStatAllTime',       `${cur} ${this._fmt(balance)}`);
        this._setHTML('ventureStatAllTimeDetail', `Opening ${cur} ${this._fmt(opening)} &middot; Net ${cur} ${this._fmt(allTime)}`);

        // Range filter
        let filtered = all;
        switch (this.entriesRange) {
            case 'today': filtered = all.filter((e) => new Date(e.entryDate || e.createdAt) >= todayStart); break;
            case 'week':  filtered = all.filter((e) => new Date(e.entryDate || e.createdAt) >= weekStart);  break;
            case 'month': filtered = all.filter((e) => new Date(e.entryDate || e.createdAt) >= monthStart); break;
        }

        const body = document.getElementById('ventureEntriesTableBody');
        if (!body) return;
        if (filtered.length === 0) {
            body.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--text-secondary);">
                ${all.length === 0 ? 'No entries yet. Click <strong>Update Daily Finances</strong> to record your first day.' : 'No entries in this range.'}
            </td></tr>`;
            return;
        }

        const canEdit   = sessionManager.hasPermission('ventures.entry') || sessionManager.isAdmin();
        const canDelete = sessionManager.isAdmin();

        body.innerHTML = filtered.map((e) => {
            const inc = Number(e.income) || 0;
            const exp = Number(e.expenses) || 0;
            const net = inc - exp;
            const num = 'font-variant-numeric:tabular-nums;text-align:right;vertical-align:middle;';
            return `
                <tr>
                    <td style="vertical-align:middle;white-space:nowrap;">${this._fmtDate(e.entryDate || e.createdAt)}</td>
                    <td style="${num}color:#15803d;font-weight:600;">${cur} ${this._fmt(inc)}</td>
                    <td style="${num}color:#b91c1c;font-weight:600;">${cur} ${this._fmt(exp)}</td>
                    <td style="${num}font-weight:700;color:${net >= 0 ? '#0f172a' : '#b91c1c'};">${cur} ${this._fmt(net)}</td>
                    <td style="vertical-align:middle;max-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${this._esc(e.notes || '')}">${this._esc(e.notes || '-')}</td>
                    <td style="vertical-align:middle;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${this._esc(e.recordedByName || '')}">${this._esc(e.recordedByName || '-')}</td>
                    <td class="sticky-action-cell" style="text-align:right;white-space:nowrap;vertical-align:middle;">
                        ${canEdit ? `<button class="btn-icon" title="Edit" onclick="window.venturesManager.openEntryModal('${e.id}')">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                        </button>` : ''}
                        ${canDelete ? `<button class="btn-icon" title="Delete" style="color:#ef4444;" onclick="window.venturesManager.deleteEntry('${e.id}')">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        </button>` : ''}
                    </td>
                </tr>`;
        }).join('');
    }

    _filtered(list) {
        const q = this.searchTerm;
        let out = list.slice();

        if (q) {
            out = out.filter((v) =>
                (v.name || '').toLowerCase().includes(q) ||
                (v.description || '').toLowerCase().includes(q) ||
                (TYPES[v.type]?.label || '').toLowerCase().includes(q)
            );
        }

        if (this.categoryFilter && this.categoryFilter !== 'all') {
            out = out.filter((v) => (v.type || 'other') === this.categoryFilter);
        }

        if (this.statusFilter && this.statusFilter !== 'all') {
            out = out.filter((v) => (v.status || 'active') === this.statusFilter);
        }

        // Sorting
        const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
        const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);

        const computeNet = (ventureId, since) => {
            return this.entries
                .filter((e) => e.ventureId === ventureId && new Date(e.entryDate || e.createdAt) >= since)
                .reduce((s, e) => s + ((Number(e.income) || 0) - (Number(e.expenses) || 0)), 0);
        };
        const computeBalance = (v) => {
            const all = this.entries
                .filter((e) => e.ventureId === v.id)
                .reduce((s, e) => s + ((Number(e.income) || 0) - (Number(e.expenses) || 0)), 0);
            return (Number(v.openingBalance) || 0) + all;
        };
        const lastEntryAt = (ventureId) => {
            const last = this.entries.find((e) => e.ventureId === ventureId);
            return last ? new Date(last.entryDate || last.createdAt).getTime() : 0;
        };

        switch (this.sortBy) {
            case 'today':
                out.sort((a, b) => computeNet(b.id, todayStart) - computeNet(a.id, todayStart));
                break;
            case 'month':
                out.sort((a, b) => computeNet(b.id, monthStart) - computeNet(a.id, monthStart));
                break;
            case 'balance':
                out.sort((a, b) => computeBalance(b) - computeBalance(a));
                break;
            case 'recent':
                out.sort((a, b) => lastEntryAt(b.id) - lastEntryAt(a.id));
                break;
            case 'created':
                out.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
                break;
            case 'name':
            default:
                out.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        }

        return out;
    }

    // ---------- Navigation ----------

    openVenture(id) {
        this.currentVentureId = id;
        // Mark sidebar nav as active for ventures
        const listPage   = document.getElementById('ventures-page');
        const detailPage = document.getElementById('venture-detail-page');
        if (listPage)   listPage.classList.remove('active');
        if (detailPage) detailPage.classList.add('active');
        this.entriesRange = 'all';
        // Reset range buttons
        document.querySelectorAll('[data-venture-range]').forEach((b, i) => {
            b.classList.toggle('active', b.getAttribute('data-venture-range') === 'all');
        });
        this._renderDetail();
    }

    backToList() {
        this.currentVentureId = null;
        const listPage   = document.getElementById('ventures-page');
        const detailPage = document.getElementById('venture-detail-page');
        if (detailPage) detailPage.classList.remove('active');
        if (listPage)   listPage.classList.add('active');
        this._renderList();
    }

    _clearFromEmpty() {
        this.searchTerm = '';
        this.categoryFilter = 'all';
        this.statusFilter = 'all';
        this.sortBy = 'name';
        const search = document.getElementById('venturesSearchInput');
        const cat    = document.getElementById('venturesCategoryFilter');
        const st     = document.getElementById('venturesStatusFilter');
        const sort   = document.getElementById('venturesSortBy');
        if (search) search.value = '';
        if (cat)    cat.value    = 'all';
        if (st)     st.value     = 'all';
        if (sort)   sort.value   = 'name';
        this._renderList();
    }

    // ---------- Venture CRUD ----------

    openVentureModal(ventureId = null) {
        const modal = document.getElementById('ventureModal');
        const title = document.getElementById('ventureModalTitle');
        if (!modal) return;

        document.getElementById('ventureForm')?.reset();
        document.getElementById('ventureId').value = '';

        this._populateBranchSelect();

        if (ventureId) {
            const v = this.ventures.find((x) => x.id === ventureId);
            if (!v) return;
            if (title) title.textContent = 'Edit Venture';
            document.getElementById('ventureId').value             = v.id;
            document.getElementById('ventureName').value           = v.name || '';
            document.getElementById('ventureType').value           = v.type || 'other';
            document.getElementById('ventureOpeningBalance').value = v.openingBalance ?? '';
            document.getElementById('ventureStatus').value         = v.status || 'active';
            document.getElementById('ventureDescription').value    = v.description || '';
            const branchSelect = document.getElementById('ventureBranch');
            if (branchSelect) branchSelect.value = v.branchId || '';
        } else {
            if (title) title.textContent = 'Create Venture';
            document.getElementById('ventureType').value   = 'gambling';
            document.getElementById('ventureStatus').value = 'active';
            const branchSelect = document.getElementById('ventureBranch');
            if (branchSelect) branchSelect.value = '';
        }

        modal.classList.add('active');
        setTimeout(() => document.getElementById('ventureName')?.focus(), 60);
    }

    _populateBranchSelect() {
        const sel = document.getElementById('ventureBranch');
        if (!sel) return;

        let branches = [];
        try { branches = branchManager.getAllBranches?.() || []; } catch (e) { branches = []; }

        const allowed = sessionManager.getAllowedBranchIds?.();
        if (Array.isArray(allowed)) {
            branches = branches.filter((b) => allowed.includes(b.id));
        }

        sel.innerHTML = '<option value="">— No specific branch —</option>' +
            branches
                .slice()
                .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
                .map((b) => `<option value="${b.id}">${this._esc(b.name || b.id)}</option>`)
                .join('');
    }

    openEditVenture() {
        if (!this.currentVentureId) return;
        this.openVentureModal(this.currentVentureId);
    }

    closeVentureModal() {
        document.getElementById('ventureModal')?.classList.remove('active');
    }

    async saveVenture() {
        const id     = document.getElementById('ventureId').value;
        const name   = document.getElementById('ventureName').value.trim();
        const type   = document.getElementById('ventureType').value;
        const open   = parseFloat(document.getElementById('ventureOpeningBalance').value) || 0;
        const status = document.getElementById('ventureStatus').value;
        const desc   = document.getElementById('ventureDescription').value.trim();
        const chosenBranchId = (document.getElementById('ventureBranch')?.value || '').trim();

        if (!name) { this._toast('Name is required', 'error'); return; }
        if (!type) { this._toast('Pick a category', 'error'); return; }

        // Resolve branch: explicit selection wins, otherwise fall back to current real branch.
        // Never write the synthetic "All Branches" pseudo-id ('all') to Firestore.
        let branchId   = null;
        let branchName = null;
        if (chosenBranchId) {
            const all = (() => { try { return branchManager.getAllBranches?.() || []; } catch (e) { return []; } })();
            const matched = all.find((b) => b.id === chosenBranchId);
            branchId   = chosenBranchId;
            branchName = matched?.name || null;
        } else {
            const cur = branchManager.getCurrentBranch?.();
            const viewingAll = !!branchManager.isViewingAllBranches?.();
            if (cur && !viewingAll && cur.id !== 'all' && cur.code !== 'ALL') {
                branchId   = cur.id;
                branchName = cur.name || null;
            }
        }

        if (!branchId) {
            this._toast('Pick a branch for this venture (or switch out of "All Branches" view).', 'error');
            return;
        }

        // RBAC: prevent assigning to a branch the user can't access
        const allowed = sessionManager.getAllowedBranchIds?.();
        if (branchId && Array.isArray(allowed) && !allowed.includes(branchId)) {
            this._toast('You cannot assign this venture to that branch', 'error');
            return;
        }

        const me     = sessionManager.getUser?.() || {};
        const auth   = sessionManager.getAuthUser?.();
        const data = {
            name, type,
            openingBalance: open,
            status, description: desc,
            branchId,
            branchName,
            updatedAt:  new Date().toISOString()
        };

        const saveBtn = document.querySelector('#ventureModal .modal-actions .btn-primary');
        setBtnState(saveBtn, 'loading', id ? 'Updating…' : 'Saving…');

        const existingVenture = id ? this.ventures.find((v) => v.id === id) : null;
        const existingSource = existingVenture?._source || 'firestore';
        let savedOk = false;

        try {
            if (this.useLocal) {
                console.log('💾 Saving venture to local storage (Firebase not configured)');
                if (id) {
                    const idx = this.ventures.findIndex((v) => v.id === id);
                    if (idx >= 0) this.ventures[idx] = { ...this.ventures[idx], ...data };
                } else {
                    this.ventures.push({ id: 'lv_' + Date.now(), createdAt: new Date().toISOString(), createdByName: me.fullName || me.email || 'Unknown', ...data });
                }
                this._saveLocal();
                this._renderAll();
                savedOk = true;
            } else if (id) {
                console.log(`💾 Updating venture (${existingSource}, id: ${id})`);
                await updateWithFallback('ventures', id, data, existingSource);
                const idx = this.ventures.findIndex((v) => v.id === id);
                if (idx >= 0) {
                    this.ventures[idx] = { ...this.ventures[idx], ...data, _source: existingSource };
                    this._renderAll();
                }
                savedOk = true;
            } else {
                data.createdAt = new Date().toISOString();
                data.createdById = auth?.uid || null;
                data.createdByName = me.fullName || me.name || me.email || auth?.email || 'Unknown';
                console.log('💾 Creating venture (branch:', branchId, ')');
                const result = await addWithFallback('ventures', data);
                if (!this.ventures.some((v) => v.id === result.id)) {
                    this.ventures.push({ id: result.id, ...data, _source: result.source });
                    this.ventures.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
                    this._renderAll();
                }
                savedOk = true;
            }
        } catch (e) {
            console.error('❌ Save venture failed:', e?.code, e?.message, e);
            setBtnState(saveBtn, 'error', 'Failed');
            this._toast(friendlyError(e, id ? 'update venture' : 'save venture'), 'error');
        }

        if (savedOk) {
            setBtnState(saveBtn, 'success', id ? 'Updated!' : 'Saved!');
            try {
                window.activityTracker?.logActivity?.('venture', id ? 'updated' : 'created', {
                    ventureName: name, type, status
                });
            } catch (e) { /* non-fatal */ }

            this._toast(id ? 'Venture updated' : 'Venture created', 'success');
            setTimeout(() => this.closeVentureModal(), 700);
        }
    }

    async deleteVenture(ventureId) {
        const v = this.ventures.find((x) => x.id === ventureId);
        if (!v) return;
        const ok = await window.uiConfirm?.({
            title: 'Delete venture?',
            message: `Are you sure you want to delete "${v.name}"? All daily entries linked to it will also be removed.`,
            tone: 'danger',
            okLabel: 'Delete'
        });
        if (!ok) return;
        try {
            if (this.useLocal) {
                this.ventures = this.ventures.filter((x) => x.id !== ventureId);
                this.entries  = this.entries.filter((e) => e.ventureId !== ventureId);
                this._saveLocal();
            } else {
                await deleteWithFallback('ventures', ventureId, v._source || 'firestore');
                // Note: cascading deletes for entries should be done via a server fn; here we only delete the venture doc
            }
            window.activityTracker?.logActivity?.('venture', 'deleted', { ventureName: v.name });
            if (this.currentVentureId === ventureId) this.backToList();
            this._toast('Venture deleted', 'success');
        } catch (e) {
            console.error('Delete venture failed:', e);
            this._toast('Failed to delete: ' + (e.message || 'permission denied'), 'error');
        }
    }

    // ---------- Daily entry CRUD ----------

    openEntryModal(entryId = null) {
        const modal = document.getElementById('ventureEntryModal');
        const title = document.getElementById('ventureEntryModalTitle');
        if (!modal) return;

        const ventureId = (() => {
            if (entryId) {
                const e = this.entries.find((x) => x.id === entryId);
                return e?.ventureId;
            }
            return this.currentVentureId;
        })();
        if (!ventureId) { this._toast('Select a venture first', 'error'); return; }

        const v = this.ventures.find((x) => x.id === ventureId);
        if (!v) return;
        const cur = brandManager.getBrand().currency || 'KES';

        const summary = document.getElementById('ventureEntrySummary');
        if (summary) {
            const t = TYPES[v.type] || TYPES.other;
            summary.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <div>
                        <strong>${this._esc(v.name)}</strong>
                        <span style="color:${t.color};font-size:12px;margin-left:8px;">${t.label}</span>
                    </div>
                    <span style="font-size:11px;color:var(--text-secondary);">All amounts in ${cur}</span>
                </div>`;
        }

        document.getElementById('ventureEntryForm')?.reset();
        document.getElementById('ventureEntryVentureId').value = ventureId;

        if (entryId) {
            const e = this.entries.find((x) => x.id === entryId);
            if (!e) return;
            if (title) title.textContent = 'Edit Entry';
            document.getElementById('ventureEntryId').value       = e.id;
            document.getElementById('ventureEntryDate').value     = (e.entryDate || e.createdAt).substring(0, 10);
            document.getElementById('ventureEntryIncome').value   = e.income ?? '';
            document.getElementById('ventureEntryExpenses').value = e.expenses ?? '';
            document.getElementById('ventureEntryNotes').value    = e.notes || '';
        } else {
            if (title) title.textContent = 'Update Daily Finances';
            document.getElementById('ventureEntryId').value   = '';
            document.getElementById('ventureEntryDate').value = new Date().toISOString().substring(0, 10);
        }

        // Trigger live net calc
        document.getElementById('ventureEntryIncome')?.dispatchEvent(new Event('input'));

        modal.classList.add('active');
        setTimeout(() => document.getElementById('ventureEntryIncome')?.focus(), 60);
    }

    closeEntryModal() {
        document.getElementById('ventureEntryModal')?.classList.remove('active');
    }

    async saveEntry() {
        const id        = document.getElementById('ventureEntryId').value;
        const ventureId = document.getElementById('ventureEntryVentureId').value;
        const dateStr   = document.getElementById('ventureEntryDate').value;
        const income    = parseFloat(document.getElementById('ventureEntryIncome').value);
        const expenses  = parseFloat(document.getElementById('ventureEntryExpenses').value);
        const notes     = document.getElementById('ventureEntryNotes').value.trim();

        if (!ventureId) { this._toast('No venture selected', 'error'); return; }
        if (!dateStr)   { this._toast('Pick a date', 'error'); return; }
        if (isNaN(income)   || income   < 0) { this._toast('Enter a valid income amount', 'error'); return; }
        if (isNaN(expenses) || expenses < 0) { this._toast('Enter a valid expenses amount', 'error'); return; }

        const v = this.ventures.find((x) => x.id === ventureId);
        if (!v) { this._toast('Venture not found', 'error'); return; }

        // Pin entry to the venture's branch (or fall back to current real branch).
        const cur        = branchManager.getCurrentBranch?.();
        const viewingAll = !!branchManager.isViewingAllBranches?.();
        const realCurrentBranchId = (cur && !viewingAll && cur.id !== 'all' && cur.code !== 'ALL') ? cur.id : null;
        const realCurrentBranchName = realCurrentBranchId ? (cur.name || null) : null;

        const finalBranchId   = (v.branchId && v.branchId !== 'all') ? v.branchId : realCurrentBranchId;
        const finalBranchName = (v.branchId && v.branchId !== 'all') ? (v.branchName || null) : realCurrentBranchName;

        if (!finalBranchId) {
            this._toast('No branch on this venture. Edit the venture and pick a branch first.', 'error');
            return;
        }

        const me     = sessionManager.getUser?.() || {};
        const auth   = sessionManager.getAuthUser?.();
        const data = {
            ventureId,
            ventureName: v.name,
            ventureType: v.type,
            entryDate:   new Date(dateStr).toISOString(),
            income, expenses,
            net: income - expenses,
            notes,
            recordedById:   auth?.uid || null,
            recordedByName: me.fullName || me.name || me.email || auth?.email || 'Unknown',
            branchId:   finalBranchId,
            branchName: finalBranchName,
            updatedAt:  new Date().toISOString()
        };

        const saveBtn = document.querySelector('#ventureEntryModal .modal-actions .btn-primary');
        setBtnState(saveBtn, 'loading', id ? 'Updating…' : 'Saving…');

        const existingEntry = id ? this.entries.find((e) => e.id === id) : null;
        const existingSource = existingEntry?._source || 'firestore';
        let savedOk = false;

        try {
            if (this.useLocal) {
                console.log('💾 Saving venture entry to local storage (Firebase not configured)');
                if (id) {
                    const idx = this.entries.findIndex((e) => e.id === id);
                    if (idx >= 0) this.entries[idx] = { ...this.entries[idx], ...data };
                } else {
                    this.entries.unshift({ id: 'le_' + Date.now(), createdAt: new Date().toISOString(), ...data });
                }
                this._saveLocal();
                this._renderAll();
                savedOk = true;
            } else if (id) {
                console.log(`💾 Updating venture entry (${existingSource}, id: ${id})`);
                await updateWithFallback('ventureEntries', id, data, existingSource);
                const idx = this.entries.findIndex((e) => e.id === id);
                if (idx >= 0) {
                    this.entries[idx] = { ...this.entries[idx], ...data, _source: existingSource };
                    this._renderAll();
                }
                savedOk = true;
            } else {
                data.createdAt = new Date().toISOString();
                console.log('💾 Creating venture entry for venture:', ventureId);
                const result = await addWithFallback('ventureEntries', data);
                if (!this.entries.some((e) => e.id === result.id)) {
                    this.entries.unshift({ id: result.id, ...data, _source: result.source });
                    this._renderAll();
                }
                savedOk = true;
            }
        } catch (e) {
            console.error('❌ Save entry failed:', e?.code, e?.message, e);
            setBtnState(saveBtn, 'error', 'Failed');
            this._toast(friendlyError(e, id ? 'update entry' : 'save entry'), 'error');
        }

        if (savedOk) {
            setBtnState(saveBtn, 'success', id ? 'Updated!' : 'Saved!');
            try {
                window.activityTracker?.logActivity?.('venture', 'entry', {
                    ventureName: v.name,
                    income, expenses,
                    net: income - expenses,
                    currency: brandManager.getBrand().currency || 'KES'
                });
            } catch (e) { /* non-fatal */ }

            this._toast(id ? 'Entry updated' : 'Daily finances recorded', 'success');
            setTimeout(() => this.closeEntryModal(), 700);
        }
    }

    async deleteEntry(entryId) {
        const e = this.entries.find((x) => x.id === entryId);
        if (!e) return;
        const ok = await window.uiConfirm?.({
            title: 'Delete entry?',
            message: `Remove the daily entry from ${this._fmtDate(e.entryDate || e.createdAt)}? This cannot be undone.`,
            tone: 'danger',
            okLabel: 'Delete'
        });
        if (!ok) return;
        try {
            if (this.useLocal) {
                this.entries = this.entries.filter((x) => x.id !== entryId);
                this._saveLocal();
                this._renderAll();
            } else {
                await deleteWithFallback('ventureEntries', entryId, e._source || 'firestore');
            }
            window.activityTracker?.logActivity?.('venture', 'entry-deleted', { ventureName: e.ventureName });
            this._toast('Entry deleted', 'success');
        } catch (e2) {
            console.error('Delete entry failed:', e2);
            this._toast('Failed to delete: ' + (e2.message || 'permission denied'), 'error');
        }
    }

    // ---------- helpers ----------

    _setText(id, txt) { const el = document.getElementById(id); if (el) el.textContent = txt; }
    _setHTML(id, html) { const el = document.getElementById(id); if (el) el.innerHTML = html; }
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
        return isNaN(d.getTime()) ? '-' : d.toLocaleDateString();
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

const venturesManager = new VenturesManager();

if (typeof window !== 'undefined') {
    window.venturesManager = venturesManager;
}

export default venturesManager;
