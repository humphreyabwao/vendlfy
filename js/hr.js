// HR / Staff Statistics Module
// Manages staff records, salaries (fixed / commission / hybrid),
// pay cycles, and per-staff payment history. Salary payments also
// auto-create an Expense entry (category=Salaries) so the books reconcile.

import dataManager from './data-manager.js';
import sessionManager from './session-manager.js';
import branchManager from './branch-manager.js';
import brandManager from './brand-manager.js';

class HRManager {
    constructor() {
        this.staff = [];
        this.payments = [];
        this.filteredStaff = [];
        this.currentFilter = 'all';
        this.searchQuery = '';
        this.initialized = false;
        this._listenersBound = false;
    }

    // ---------- Lifecycle ----------

    async init() {
        console.log('👥 Initializing HR Manager...');
        await this.loadAll();
        this.bindEventListeners();
        this.renderStats();
        this.renderStaffList();
        this.populateStaffSelectors();
        this.initialized = true;
    }

    async refresh() {
        await this.loadAll();
        this.renderStats();
        this.renderStaffList();
        this.renderPaymentHistory();
        this.populateStaffSelectors();
    }

    async loadAll() {
        try {
            const [staff, payments] = await Promise.all([
                dataManager.getStaff(),
                dataManager.getSalaryPayments()
            ]);
            this.staff = staff || [];
            this.payments = (payments || []).sort((a, b) =>
                new Date(b.paymentDate || b.createdAt) - new Date(a.paymentDate || a.createdAt)
            );
            this.filteredStaff = [...this.staff];
            console.log(`✅ Loaded ${this.staff.length} staff and ${this.payments.length} salary payments`);
        } catch (e) {
            console.error('Error loading HR data:', e);
            this._toast('Failed to load HR data', 'error');
        }
    }

    /**
     * Wire up DOM listeners. Safe to call multiple times — guarded by
     * `_listenersBound` and idempotent on a per-element basis.
     *
     * IMPORTANT: this is also wired to DOMContentLoaded at the bottom of
     * the file so the form works even if the user lands on add-staff / pay-staff
     * BEFORE having opened hr-staff (which would otherwise be the only path
     * that calls init() and binds listeners).
     */
    bindEventListeners() {
        if (this._listenersBound) return;

        // Search
        const search = document.getElementById('staffSearch');
        if (search) {
            search.addEventListener('input', (e) => {
                this.searchQuery = e.target.value.toLowerCase();
                this.filterStaff();
            });
        }

        // Status filter buttons
        document.querySelectorAll('.staff-filter-btn').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.staff-filter-btn').forEach(b => b.classList.remove('active'));
                e.currentTarget.classList.add('active');
                this.currentFilter = e.currentTarget.dataset.filter;
                this.filterStaff();
            });
        });

        // Add staff form
        const addForm = document.getElementById('addStaffForm');
        if (addForm) {
            addForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleAddOrEditStaff();
            });
        }

        // Salary type → toggle commission inputs
        const salaryTypeSelect = document.getElementById('staffSalaryType');
        if (salaryTypeSelect) {
            salaryTypeSelect.addEventListener('change', () => this._onSalaryTypeChange());
            this._onSalaryTypeChange();
        }

        // Record payment form
        const payForm = document.getElementById('paySalaryForm');
        if (payForm) {
            payForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleRecordPayment();
            });
        }

        const payStaffSelect = document.getElementById('paySalaryStaff');
        if (payStaffSelect) {
            payStaffSelect.addEventListener('change', () => this._onPayStaffChange());
        }

        // Live total recalculation
        ['paySalaryBase', 'paySalaryCommission', 'paySalaryBonus', 'paySalaryDeductions']
            .forEach(id => {
                const el = document.getElementById(id);
                if (el) el.addEventListener('input', () => this._recalcPaymentTotal());
            });

        // History filter
        const histStaffFilter = document.getElementById('historyStaffFilter');
        if (histStaffFilter) {
            histStaffFilter.addEventListener('change', () => this.renderPaymentHistory());
        }

        this._listenersBound = true;
    }

    // ---------- Stats ----------

    getStats() {
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();

        const activeStaff = this.staff.filter(s => (s.status || 'active') === 'active');
        const totalMonthlyPayroll = activeStaff.reduce((sum, s) => {
            return sum + this._estimateMonthlyCost(s);
        }, 0);

        const monthPayments = this.payments.filter(p => {
            const d = p.paymentDate || p.createdAt;
            return d >= monthStart && d < nextMonthStart;
        });
        const monthPaid = monthPayments.reduce((sum, p) => sum + (parseFloat(p.netAmount) || 0), 0);

        // Upcoming pay events (within 7 days)
        const soon = new Date(); soon.setDate(soon.getDate() + 7);
        const upcoming = activeStaff.filter(s => {
            const next = this._computeNextPayDate(s);
            return next && new Date(next) <= soon;
        }).length;

        return {
            activeCount: activeStaff.length,
            totalCount: this.staff.length,
            monthlyPayroll: totalMonthlyPayroll,
            monthPaid,
            upcoming
        };
    }

    renderStats() {
        const s = this.getStats();
        const cur = this._currency();

        const setText = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val;
        };
        setText('staffActiveCount', s.activeCount);
        setText('staffMonthlyPayroll', `${cur} ${this._fmt(s.monthlyPayroll)}`);
        setText('staffPaidThisMonth', `${cur} ${this._fmt(s.monthPaid)}`);
        setText('staffUpcomingPay', s.upcoming);
    }

    // ---------- Filtering ----------

    filterStaff() {
        let list = [...this.staff];
        if (this.searchQuery) {
            list = list.filter(s =>
                (s.name || '').toLowerCase().includes(this.searchQuery) ||
                (s.position || '').toLowerCase().includes(this.searchQuery) ||
                (s.phone || '').toLowerCase().includes(this.searchQuery) ||
                (s.email || '').toLowerCase().includes(this.searchQuery)
            );
        }
        if (this.currentFilter && this.currentFilter !== 'all') {
            list = list.filter(s => (s.status || 'active') === this.currentFilter);
        }
        this.filteredStaff = list;
        this.renderStaffList();
    }

    // ---------- Renders ----------

    renderStaffList() {
        const tbody = document.getElementById('staffTableBody');
        if (!tbody) return;
        const cur = this._currency();

        if (!this.filteredStaff.length) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align:center;padding:3rem;color:var(--text-secondary);">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:0.3;margin-bottom:1rem;">
                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                            <circle cx="9" cy="7" r="4"></circle>
                            <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                            <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                        </svg>
                        <div>No staff found. Click "Add Staff" to get started.</div>
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = this.filteredStaff.map(s => {
            const nextPay = this._computeNextPayDate(s);
            const monthly = this._estimateMonthlyCost(s);
            const lastPaid = this._lastPaymentFor(s.id);
            return `
                <tr>
                    <td>
                        <strong>${this._esc(s.name || '-')}</strong>
                        ${s.email ? `<br><small style="color:var(--text-secondary);">${this._esc(s.email)}</small>` : ''}
                    </td>
                    <td>${this._esc(s.position || '-')}</td>
                    <td>${this._esc(s.phone || '-')}</td>
                    <td>${this._salaryTypeLabel(s.salaryType)}</td>
                    <td><strong>${cur} ${this._fmt(monthly)}</strong><br><small style="color:var(--text-secondary);">${this._payCycleLabel(s.payCycle)}</small></td>
                    <td>${nextPay ? new Date(nextPay).toLocaleDateString() : '-'}</td>
                    <td>${lastPaid ? `${cur} ${this._fmt(lastPaid.netAmount)}<br><small style="color:var(--text-secondary);">${new Date(lastPaid.paymentDate || lastPaid.createdAt).toLocaleDateString()}</small>` : '<span style="color:var(--text-tertiary);">No payments</span>'}</td>
                    <td>
                        <span class="status-badge status-${s.status || 'active'}">${s.status || 'active'}</span>
                    </td>
                    <td>
                        <div class="action-buttons">
                            <button class="btn-icon" onclick="window.hrManager.viewStaff('${s.id}')" title="View / History">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                    <circle cx="12" cy="12" r="3"></circle>
                                </svg>
                            </button>
                            <button class="btn-icon" onclick="window.hrManager.startPayment('${s.id}')" title="Record Payment" data-perm="hr.pay">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <line x1="12" y1="1" x2="12" y2="23"></line>
                                    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                                </svg>
                            </button>
                            <button class="btn-icon" onclick="window.hrManager.editStaff('${s.id}')" title="Edit" data-perm="hr.edit">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                                </svg>
                            </button>
                            <button class="btn-icon btn-icon-danger" onclick="window.hrManager.deleteStaff('${s.id}')" title="Delete" data-perm="hr.delete">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <polyline points="3 6 5 6 21 6"></polyline>
                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                </svg>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        // Re-apply permission gating to the freshly-rendered rows
        if (window.permissionGuard?.gateContainer) window.permissionGuard.gateContainer(tbody);
        else if (window.permissionGuard?.refresh) window.permissionGuard.refresh();
    }

    renderPaymentHistory() {
        const tbody = document.getElementById('salaryHistoryTableBody');
        if (!tbody) return;
        const cur = this._currency();

        const filterId = document.getElementById('historyStaffFilter')?.value || '';
        let rows = [...this.payments];
        if (filterId) rows = rows.filter(p => p.staffId === filterId);

        if (!rows.length) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align:center;padding:3rem;color:var(--text-secondary);">
                        No salary payments recorded yet.
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = rows.map(p => `
            <tr>
                <td>${new Date(p.paymentDate || p.createdAt).toLocaleDateString()}</td>
                <td><strong>${this._esc(p.staffName || '-')}</strong></td>
                <td>${p.periodStart ? `${new Date(p.periodStart).toLocaleDateString()} → ${new Date(p.periodEnd).toLocaleDateString()}` : '-'}</td>
                <td>${cur} ${this._fmt(p.baseAmount)}</td>
                <td>${cur} ${this._fmt(p.commissionAmount)}</td>
                <td>${cur} ${this._fmt(p.bonus)}</td>
                <td>${cur} ${this._fmt(p.deductions)}</td>
                <td><strong>${cur} ${this._fmt(p.netAmount)}</strong></td>
            </tr>
        `).join('');
    }

    populateStaffSelectors() {
        const options = ['<option value="">Select Staff…</option>']
            .concat(this.staff
                .filter(s => (s.status || 'active') === 'active')
                .map(s => `<option value="${s.id}">${this._esc(s.name)} — ${this._esc(s.position || '')}</option>`)
            ).join('');

        const paySel = document.getElementById('paySalaryStaff');
        if (paySel) {
            const prev = paySel.value;
            paySel.innerHTML = options;
            if (prev) paySel.value = prev;
        }

        const histSel = document.getElementById('historyStaffFilter');
        if (histSel) {
            const prev = histSel.value;
            histSel.innerHTML = '<option value="">All Staff</option>' +
                this.staff.map(s => `<option value="${s.id}">${this._esc(s.name)}</option>`).join('');
            if (prev) histSel.value = prev;
        }
    }

    // ---------- Add / Edit Staff ----------

    async handleAddOrEditStaff() {
        const form = document.getElementById('addStaffForm');
        if (!form) return;

        const submitBtn = form.querySelector('button[type="submit"]');
        const fd = new FormData(form);
        const editingId = form.dataset.editingId || '';
        const data = {
            name: (fd.get('name') || '').toString().trim(),
            position: (fd.get('position') || '').toString().trim(),
            phone: (fd.get('phone') || '').toString().trim(),
            email: (fd.get('email') || '').toString().trim(),
            salaryType: fd.get('salaryType') || 'fixed',
            baseSalary: parseFloat(fd.get('baseSalary')) || 0,
            commissionRate: parseFloat(fd.get('commissionRate')) || 0,
            payCycle: fd.get('payCycle') || 'monthly',
            payDay: parseInt(fd.get('payDay'), 10) || 1,
            hireDate: fd.get('hireDate') || new Date().toISOString().split('T')[0],
            status: fd.get('status') || 'active',
            notes: (fd.get('notes') || '').toString().trim()
        };

        if (!data.name) {
            this._toast('Staff name is required', 'error');
            this._setBtnState(submitBtn, 'error', 'Name required');
            return;
        }
        if (data.salaryType !== 'commission' && data.baseSalary <= 0) {
            this._toast('Base salary must be greater than zero', 'error');
            this._setBtnState(submitBtn, 'error', 'Invalid salary');
            return;
        }
        if (data.salaryType !== 'fixed' && (data.commissionRate <= 0 || data.commissionRate > 100)) {
            this._toast('Commission rate must be between 0 and 100', 'error');
            this._setBtnState(submitBtn, 'error', 'Invalid rate');
            return;
        }

        this._setBtnState(submitBtn, 'loading', editingId ? 'Saving…' : 'Adding…');
        console.log('🧑‍💼 [HR] Saving staff', editingId ? `(edit ${editingId})` : '(new)', data);

        try {
            let saved;
            if (editingId) {
                saved = await dataManager.updateStaff(editingId, data);
                this._logActivity('updated', data.name);
            } else {
                saved = await dataManager.createStaff(data);
                this._logActivity('added', data.name);
            }
            console.log('✅ [HR] Staff saved:', saved);

            this._setBtnState(submitBtn, 'success', editingId ? 'Saved!' : 'Added!');
            this._toast(editingId ? 'Staff updated' : 'Staff added successfully', 'success');

            await this.refresh();

            // Restore form + navigate after the success animation has been seen.
            setTimeout(() => {
                form.reset();
                form.dataset.editingId = '';
                this._resetAddFormHeader();
                const link = document.querySelector('[data-page="hr-staff"]');
                if (link) link.click();
            }, 700);
        } catch (e) {
            console.error('❌ [HR] Save staff failed:', e);
            const msg = this._errorMessage(e, editingId ? 'hr.edit' : 'hr.add', 'save staff');
            this._setBtnState(submitBtn, 'error', 'Failed');
            this._toast(msg, 'error');
        }
    }

    editStaff(staffId) {
        const s = this.staff.find(x => x.id === staffId);
        if (!s) return;

        // Mark intent so app.js does not reset the form on the upcoming page-show
        this._editingIntent = true;

        const link = document.querySelector('[data-page="add-staff"]');
        if (link) link.click();

        setTimeout(() => {
            const form = document.getElementById('addStaffForm');
            if (!form) return;
            form.dataset.editingId = staffId;

            const set = (name, val) => {
                const el = form.querySelector(`[name="${name}"]`);
                if (el) el.value = val ?? '';
            };
            set('name', s.name);
            set('position', s.position);
            set('phone', s.phone);
            set('email', s.email);
            set('salaryType', s.salaryType || 'fixed');
            set('baseSalary', s.baseSalary || '');
            set('commissionRate', s.commissionRate || '');
            set('payCycle', s.payCycle || 'monthly');
            set('payDay', s.payDay || 1);
            set('hireDate', s.hireDate || '');
            set('status', s.status || 'active');
            set('notes', s.notes || '');

            this._onSalaryTypeChange();

            const header = document.getElementById('addStaffHeader');
            if (header) header.textContent = 'Edit Staff';
            const submitBtn = form.querySelector('button[type="submit"] span') || form.querySelector('button[type="submit"]');
            if (submitBtn) submitBtn.textContent = 'Save Changes';
        }, 100);
    }

    async deleteStaff(staffId) {
        const s = this.staff.find(x => x.id === staffId);
        if (!s) return;
        if (!confirm(`Delete "${s.name}"? Their payment history will be kept for records.`)) return;

        console.log('🗑️  [HR] Deleting staff', staffId, s.name);
        this._toast(`Removing ${s.name}…`, 'info');

        try {
            await dataManager.deleteStaff(staffId);
            this._logActivity('removed', s.name);
            this._toast(`Removed ${s.name}`, 'success');
            await this.refresh();
        } catch (e) {
            console.error('❌ [HR] Delete staff failed:', e);
            this._toast(this._errorMessage(e, 'hr.delete', 'delete staff'), 'error');
        }
    }

    // ---------- View staff details ----------

    viewStaff(staffId) {
        const s = this.staff.find(x => x.id === staffId);
        if (!s) return;
        const cur = this._currency();
        const hist = this.payments.filter(p => p.staffId === staffId);
        const totalPaid = hist.reduce((sum, p) => sum + (parseFloat(p.netAmount) || 0), 0);

        const modal = document.createElement('div');
        modal.className = 'pos-modal';
        modal.innerHTML = `
            <div class="pos-modal-content" style="max-width: 720px;">
                <div class="pos-modal-header">
                    <h3>${this._esc(s.name)} <small style="color:var(--text-secondary);font-weight:400;">${this._esc(s.position || '')}</small></h3>
                    <button class="pos-modal-close" onclick="this.closest('.pos-modal').remove()">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
                <div class="pos-modal-body">
                    <div class="expense-details" style="margin-bottom:1.25rem;">
                        <div class="detail-row"><span class="detail-label">Phone:</span><span class="detail-value">${this._esc(s.phone || '-')}</span></div>
                        <div class="detail-row"><span class="detail-label">Email:</span><span class="detail-value">${this._esc(s.email || '-')}</span></div>
                        <div class="detail-row"><span class="detail-label">Salary Type:</span><span class="detail-value">${this._salaryTypeLabel(s.salaryType)}</span></div>
                        <div class="detail-row"><span class="detail-label">Base Salary:</span><span class="detail-value">${cur} ${this._fmt(s.baseSalary)} / ${this._payCycleLabel(s.payCycle)}</span></div>
                        ${s.salaryType !== 'fixed' ? `<div class="detail-row"><span class="detail-label">Commission:</span><span class="detail-value">${this._fmt(s.commissionRate)}%</span></div>` : ''}
                        <div class="detail-row"><span class="detail-label">Hire Date:</span><span class="detail-value">${s.hireDate ? new Date(s.hireDate).toLocaleDateString() : '-'}</span></div>
                        <div class="detail-row"><span class="detail-label">Next Pay Date:</span><span class="detail-value">${this._computeNextPayDate(s) ? new Date(this._computeNextPayDate(s)).toLocaleDateString() : '-'}</span></div>
                        <div class="detail-row"><span class="detail-label">Status:</span><span class="detail-value"><span class="status-badge status-${s.status || 'active'}">${s.status || 'active'}</span></span></div>
                        ${s.notes ? `<div class="detail-row"><span class="detail-label">Notes:</span><span class="detail-value">${this._esc(s.notes)}</span></div>` : ''}
                    </div>

                    <h4 style="margin-bottom:0.75rem;display:flex;justify-content:space-between;align-items:center;">
                        <span>Payment History (${hist.length})</span>
                        <small style="font-weight:400;color:var(--text-secondary);">Total paid: <strong>${cur} ${this._fmt(totalPaid)}</strong></small>
                    </h4>
                    <div class="table-container" style="max-height:300px;overflow-y:auto;">
                        <table class="data-table">
                            <thead>
                                <tr>
                                    <th>Date</th>
                                    <th>Period</th>
                                    <th>Base</th>
                                    <th>Commission</th>
                                    <th>Bonus</th>
                                    <th>Deduct.</th>
                                    <th>Net</th>
                                    <th>Method</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${hist.length ? hist.map(p => `
                                    <tr>
                                        <td>${new Date(p.paymentDate || p.createdAt).toLocaleDateString()}</td>
                                        <td>${p.periodStart ? `${new Date(p.periodStart).toLocaleDateString()} → ${new Date(p.periodEnd).toLocaleDateString()}` : '-'}</td>
                                        <td>${cur} ${this._fmt(p.baseAmount)}</td>
                                        <td>${cur} ${this._fmt(p.commissionAmount)}</td>
                                        <td>${cur} ${this._fmt(p.bonus)}</td>
                                        <td>${cur} ${this._fmt(p.deductions)}</td>
                                        <td><strong>${cur} ${this._fmt(p.netAmount)}</strong></td>
                                        <td>${this._esc(p.paymentMethod || '-')}</td>
                                    </tr>
                                `).join('') : `
                                    <tr><td colspan="8" style="text-align:center;padding:1.5rem;color:var(--text-secondary);">No payments yet.</td></tr>
                                `}
                            </tbody>
                        </table>
                    </div>
                </div>
                <div class="pos-modal-footer">
                    ${sessionManager.hasPermission?.('hr.pay') ? `<button class="btn btn-primary" onclick="this.closest('.pos-modal').remove(); window.hrManager.startPayment('${s.id}');">Record Payment</button>` : ''}
                    <button class="btn btn-secondary" onclick="this.closest('.pos-modal').remove()">Close</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    // ---------- Record Payment ----------

    startPayment(staffId) {
        const link = document.querySelector('[data-page="pay-staff"]');
        if (link) link.click();

        setTimeout(() => {
            const sel = document.getElementById('paySalaryStaff');
            if (sel) {
                sel.value = staffId;
                this._onPayStaffChange();
            }
        }, 100);
    }

    async handleRecordPayment() {
        const form = document.getElementById('paySalaryForm');
        if (!form) return;

        const submitBtn = form.querySelector('button[type="submit"]');
        const fd = new FormData(form);
        const staffId = fd.get('staffId');
        const staff = this.staff.find(s => s.id === staffId);
        if (!staff) {
            this._toast('Please select a staff member', 'error');
            this._setBtnState(submitBtn, 'error', 'Pick staff');
            return;
        }

        const baseAmount = parseFloat(fd.get('baseAmount')) || 0;
        const commissionAmount = parseFloat(fd.get('commissionAmount')) || 0;
        const bonus = parseFloat(fd.get('bonus')) || 0;
        const deductions = parseFloat(fd.get('deductions')) || 0;
        const netAmount = baseAmount + commissionAmount + bonus - deductions;

        if (netAmount <= 0) {
            this._toast('Net pay must be greater than zero', 'error');
            this._setBtnState(submitBtn, 'error', 'Invalid amount');
            return;
        }

        const me = sessionManager.getUser?.() || {};
        const auth = sessionManager.getAuthUser?.();
        const recordedById = auth?.uid || null;
        const recordedByName = me.fullName || me.name || me.email || auth?.email || 'Unknown';

        const periodStart = fd.get('periodStart') || null;
        const periodEnd = fd.get('periodEnd') || null;
        const paymentDate = fd.get('paymentDate') || new Date().toISOString().split('T')[0];
        const paymentMethod = fd.get('paymentMethod') || 'Cash';
        const reference = (fd.get('reference') || '').toString().trim();
        const notes = (fd.get('notes') || '').toString().trim();
        const createExpense = fd.get('createExpense') !== 'no';

        this._setBtnState(submitBtn, 'loading', 'Recording…');
        console.log('💰 [HR] Recording salary payment', { staffId, netAmount, createExpense });

        try {
            // 1. Optionally create the matching Expense first so we can link it.
            let linkedExpenseId = null;
            if (createExpense) {
                try {
                    const exp = await dataManager.createExpense({
                        date: paymentDate,
                        description: `Salary — ${staff.name}${periodStart ? ` (${new Date(periodStart).toLocaleDateString()} → ${new Date(periodEnd).toLocaleDateString()})` : ''}`,
                        category: 'Salaries',
                        amount: netAmount,
                        vendor: staff.name,
                        reference,
                        paymentMethod,
                        status: 'approved',
                        notes
                    });
                    linkedExpenseId = exp?.id || null;
                    console.log('✅ [HR] Linked expense created:', linkedExpenseId);
                } catch (e) {
                    console.warn('⚠️ [HR] Could not auto-create Expense for salary payment:', e);
                }
            }

            // 2. Create the salary payment record.
            const payment = await dataManager.createSalaryPayment({
                staffId,
                staffName: staff.name,
                periodStart: periodStart ? new Date(periodStart).toISOString() : null,
                periodEnd: periodEnd ? new Date(periodEnd).toISOString() : null,
                paymentDate: new Date(paymentDate).toISOString(),
                baseAmount, commissionAmount, bonus, deductions, netAmount,
                paymentMethod, reference, notes,
                recordedById, recordedByName,
                linkedExpenseId
            });
            console.log('✅ [HR] Salary payment saved:', payment);

            // 3. Stamp staff with last/next pay date.
            try {
                const next = this._computeNextPayDate({ ...staff, lastPaidDate: payment.paymentDate });
                await dataManager.updateStaff(staffId, {
                    lastPaidDate: payment.paymentDate,
                    nextPayDate: next
                });
            } catch (e) {
                console.warn('⚠️ [HR] Could not stamp staff lastPaidDate:', e);
            }

            this._logActivity('paid', `${staff.name} (${this._currency()} ${this._fmt(netAmount)})`);
            this._setBtnState(submitBtn, 'success', 'Paid!');
            this._toast(`Payment recorded for ${staff.name}`, 'success');

            await this.refresh();

            setTimeout(() => {
                form.reset();
                this._setDefaultPaymentDate();
                this._recalcPaymentTotal();
                const link = document.querySelector('[data-page="hr-staff"]');
                if (link) link.click();
            }, 700);

            // Refresh dashboard / reports / accounts that depend on expenses.
            if (window.refreshDashboardStats) try { await window.refreshDashboardStats(); } catch (_) {}
            if (window.expenseManager?.refresh) try { await window.expenseManager.refresh(); } catch (_) {}
            if (window.reportsManager?.initialized) try { await window.reportsManager.loadAllData?.(); } catch (_) {}
        } catch (e) {
            console.error('❌ [HR] Record payment failed:', e);
            const msg = this._errorMessage(e, 'hr.pay', 'record payment');
            this._setBtnState(submitBtn, 'error', 'Failed');
            this._toast(msg, 'error');
        }
    }

    // ---------- Internal helpers ----------

    _onSalaryTypeChange() {
        const type = (document.getElementById('staffSalaryType') || {}).value || 'fixed';
        const baseGroup = document.getElementById('staffBaseSalaryGroup');
        const commGroup = document.getElementById('staffCommissionGroup');
        if (baseGroup) baseGroup.style.display = type === 'commission' ? 'none' : '';
        if (commGroup) commGroup.style.display = type === 'fixed' ? 'none' : '';
    }

    _onPayStaffChange() {
        const sel = document.getElementById('paySalaryStaff');
        if (!sel) return;
        const staff = this.staff.find(s => s.id === sel.value);

        const setVal = (id, v) => {
            const el = document.getElementById(id);
            if (el) el.value = v ?? '';
        };
        const setText = (id, v) => {
            const el = document.getElementById(id);
            if (el) el.textContent = v;
        };

        if (!staff) {
            setVal('paySalaryBase', '');
            setVal('paySalaryCommission', '');
            setText('paySalaryStaffInfo', '');
            this._recalcPaymentTotal();
            return;
        }

        setVal('paySalaryBase', staff.salaryType === 'commission' ? 0 : (staff.baseSalary || 0));
        setVal('paySalaryCommission', '');

        // Default the period to the staff's pay cycle (last paid → today)
        const today = new Date();
        const last = staff.lastPaidDate ? new Date(staff.lastPaidDate) : null;
        const start = last
            ? new Date(last.getTime() + 24 * 60 * 60 * 1000)
            : this._cycleStart(staff.payCycle, today);
        setVal('paySalaryPeriodStart', start.toISOString().split('T')[0]);
        setVal('paySalaryPeriodEnd', today.toISOString().split('T')[0]);

        const cur = this._currency();
        setText('paySalaryStaffInfo',
            `${this._salaryTypeLabel(staff.salaryType)} • Base ${cur} ${this._fmt(staff.baseSalary)} • ` +
            (staff.salaryType !== 'fixed' ? `Commission ${this._fmt(staff.commissionRate)}% • ` : '') +
            `${this._payCycleLabel(staff.payCycle)}`
        );

        this._recalcPaymentTotal();
    }

    _recalcPaymentTotal() {
        const num = (id) => parseFloat(document.getElementById(id)?.value) || 0;
        const total = num('paySalaryBase') + num('paySalaryCommission') + num('paySalaryBonus') - num('paySalaryDeductions');
        const el = document.getElementById('paySalaryNetTotal');
        if (el) el.textContent = `${this._currency()} ${this._fmt(total)}`;
    }

    _setDefaultPaymentDate() {
        const el = document.getElementById('paySalaryDate');
        if (el && !el.value) el.value = new Date().toISOString().split('T')[0];
    }

    _cycleStart(cycle, ref) {
        const d = new Date(ref);
        if (cycle === 'weekly') {
            d.setDate(d.getDate() - 7);
        } else if (cycle === 'biweekly') {
            d.setDate(d.getDate() - 14);
        } else {
            // monthly: first of this month
            d.setDate(1);
        }
        return d;
    }

    _computeNextPayDate(staff) {
        if (!staff) return null;
        const cycle = staff.payCycle || 'monthly';
        const last = staff.lastPaidDate ? new Date(staff.lastPaidDate) : null;
        const today = new Date();

        if (cycle === 'monthly') {
            const day = parseInt(staff.payDay, 10) || 1;
            const next = new Date(today.getFullYear(), today.getMonth(), day);
            if (last && next <= last) next.setMonth(next.getMonth() + 1);
            else if (next < today) next.setMonth(next.getMonth() + 1);
            return next.toISOString();
        }
        if (cycle === 'biweekly') {
            const base = last || (staff.hireDate ? new Date(staff.hireDate) : today);
            const next = new Date(base);
            do { next.setDate(next.getDate() + 14); } while (next < today);
            return next.toISOString();
        }
        if (cycle === 'weekly') {
            const base = last || (staff.hireDate ? new Date(staff.hireDate) : today);
            const next = new Date(base);
            do { next.setDate(next.getDate() + 7); } while (next < today);
            return next.toISOString();
        }
        return null;
    }

    _estimateMonthlyCost(s) {
        const base = parseFloat(s.baseSalary) || 0;
        const cycle = s.payCycle || 'monthly';
        if (cycle === 'weekly') return base * 4;
        if (cycle === 'biweekly') return base * 2;
        return base;
    }

    _lastPaymentFor(staffId) {
        return this.payments.find(p => p.staffId === staffId);
    }

    _salaryTypeLabel(t) {
        return ({ fixed: 'Fixed', commission: 'Commission', hybrid: 'Base + Commission' })[t || 'fixed'];
    }

    _payCycleLabel(c) {
        return ({ weekly: 'Weekly', biweekly: 'Biweekly', monthly: 'Monthly' })[c || 'monthly'];
    }

    _currency() {
        const c = brandManager?.getCurrentBrand?.()?.currency;
        return c || 'KSh';
    }

    _fmt(n) {
        const v = parseFloat(n) || 0;
        return v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    }

    _esc(s) {
        return String(s ?? '').replace(/[&<>"']/g, (m) =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])
        );
    }

    _toast(msg, type = 'info') {
        // Always log so devtools shows what happened.
        const tag = type === 'error' ? 'error' : type === 'warning' ? 'warn' : 'log';
        try { console[tag](`[HR] ${msg}`); } catch (_) {}

        // Prefer the global notification first; fall back to a local toast so the
        // user always sees something — even before app.js finishes booting.
        if (typeof window.showNotification === 'function') {
            try { window.showNotification(msg, type); return; } catch (_) {}
        }
        try {
            const n = document.createElement('div');
            n.className = `hr-fallback-toast hr-toast-${type}`;
            n.textContent = msg;
            n.style.cssText = `
                position:fixed;top:80px;right:20px;padding:14px 20px;
                background:${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : type === 'warning' ? '#f59e0b' : '#3b82f6'};
                color:#fff;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.18);
                z-index:10001;font-family:'Montserrat',sans-serif;font-size:14px;
                font-weight:500;max-width:380px;`;
            document.body.appendChild(n);
            setTimeout(() => n.remove(), 3500);
        } catch (_) {}
    }

    /**
     * Drive a button through loading → success/error visual states.
     * Disables the button while loading; auto-restores after success/error.
     * Original markup is captured the first time we touch the button so
     * we can restore the SVG + label cleanly.
     */
    _setBtnState(btn, state, label) {
        if (!btn) return;

        // Capture original HTML once so we can restore later.
        if (!btn.dataset.hrOriginalHtml) {
            btn.dataset.hrOriginalHtml = btn.innerHTML;
        }
        clearTimeout(btn._hrRestoreTimer);
        btn.classList.remove('is-loading', 'is-success', 'is-error');

        const spinner = '<svg class="hr-btn-spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>';
        const checkSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
        const xSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

        if (state === 'loading') {
            btn.disabled = true;
            btn.classList.add('is-loading');
            btn.innerHTML = `${spinner}<span> ${this._esc(label || 'Saving…')}</span>`;
            return;
        }
        if (state === 'success') {
            btn.disabled = true;
            btn.classList.add('is-success');
            btn.innerHTML = `${checkSvg}<span> ${this._esc(label || 'Saved!')}</span>`;
            btn._hrRestoreTimer = setTimeout(() => this._setBtnState(btn, 'idle'), 1100);
            return;
        }
        if (state === 'error') {
            btn.disabled = false;
            btn.classList.add('is-error');
            btn.innerHTML = `${xSvg}<span> ${this._esc(label || 'Failed')}</span>`;
            btn._hrRestoreTimer = setTimeout(() => this._setBtnState(btn, 'idle'), 1800);
            return;
        }
        // idle: restore captured HTML
        btn.disabled = false;
        btn.innerHTML = btn.dataset.hrOriginalHtml || btn.innerHTML;
    }

    /**
     * Translate Firebase / network errors into human-readable messages.
     * Common case: rules not deployed → catch-all rule fires permission-denied.
     */
    _errorMessage(e, neededPerm, action) {
        if (!e) return `Could not ${action}.`;
        const code = e.code || e?.cause?.code || '';
        const msg = (e.message || '').toLowerCase();

        if (code === 'permission-denied' || msg.includes('permission')) {
            return `Permission denied. You need the "${neededPerm}" permission, and the Firestore rules must be deployed (run: firebase deploy --only firestore:rules).`;
        }
        if (code === 'unavailable' || msg.includes('offline') || msg.includes('network')) {
            return `Network error — could not ${action}. Check your connection and retry.`;
        }
        if (code === 'unauthenticated') {
            return `Your session has expired. Please sign in again.`;
        }
        return `Could not ${action}: ${e.message || e}`;
    }

    _logActivity(action, details) {
        if (!window.activityTracker) return;
        try {
            window.activityTracker.logActivity('staff', action, { details });
        } catch (_) {}
    }

    _resetAddFormHeader() {
        const header = document.getElementById('addStaffHeader');
        if (header) header.textContent = 'Add Staff';
        const form = document.getElementById('addStaffForm');
        const span = form?.querySelector('button[type="submit"] span');
        if (span) span.textContent = ' Add Staff';
    }
}

const hrManager = new HRManager();

if (typeof window !== 'undefined') {
    window.hrManager = hrManager;
}

// Bind listeners eagerly as soon as the DOM is ready, so the form submit
// handlers are wired up even if the user navigates to "Add Staff" / "Record
// Payment" BEFORE opening the main HR page (which would otherwise be the
// only path to call init() and bind listeners).
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            try { hrManager.bindEventListeners(); } catch (e) { console.error('[HR] bind error:', e); }
        }, { once: true });
    } else {
        try { hrManager.bindEventListeners(); } catch (e) { console.error('[HR] bind error:', e); }
    }
}

export default hrManager;
