// Expense Management Module
import dataManager from './data-manager.js';
import branchManager from './branch-manager.js';

class ExpenseManager {
    constructor() {
        this.expenses = [];
        this.filteredExpenses = [];
        this.currentFilter = 'all';
        this.searchQuery = '';
    }

    // Initialize
    async init() {
        console.log('💰 Initializing Expense Manager...');
        await this.loadExpenses();
        this.setupEventListeners();
        this.renderStats();
        this.renderExpenses();
    }

    // Setup event listeners
    setupEventListeners() {
        // Search
        const searchInput = document.getElementById('expenseSearch');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.searchQuery = e.target.value.toLowerCase();
                this.filterExpenses();
            });
        }

        // Filter buttons
        const filterBtns = document.querySelectorAll('.expense-filter-btn');
        filterBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                filterBtns.forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.currentFilter = e.target.dataset.filter;
                this.filterExpenses();
            });
        });

        // Add expense form
        const addForm = document.getElementById('addExpenseForm');
        if (addForm) {
            addForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.addExpense();
            });
        }
    }

    // Load expenses from database
    async loadExpenses() {
        try {
            this.expenses = await dataManager.getExpenses();
            this.filteredExpenses = [...this.expenses];
            console.log('✅ Loaded', this.expenses.length, 'expenses');
        } catch (error) {
            console.error('Error loading expenses:', error);
            window.showNotification('Failed to load expenses', 'error');
        }
    }

    // Filter expenses
    filterExpenses() {
        let filtered = [...this.expenses];

        // Apply search filter
        if (this.searchQuery) {
            filtered = filtered.filter(expense => 
                expense.description?.toLowerCase().includes(this.searchQuery) ||
                expense.category?.toLowerCase().includes(this.searchQuery) ||
                expense.vendor?.toLowerCase().includes(this.searchQuery)
            );
        }

        // Apply status filter
        if (this.currentFilter !== 'all') {
            filtered = filtered.filter(expense => expense.status === this.currentFilter);
        }

        this.filteredExpenses = filtered;
        this.renderExpenses();
    }

    // Calculate stats
    getStats() {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

        let todayTotal = 0;
        let monthTotal = 0;
        let pendingCount = 0;
        let approvedCount = 0;

        this.expenses.forEach(expense => {
            const expenseDate = new Date(expense.date);
            const amount = parseFloat(expense.amount) || 0;

            // Today's expenses
            if (expenseDate >= today) {
                todayTotal += amount;
            }

            // This month's expenses
            if (expenseDate >= monthStart) {
                monthTotal += amount;
                
                // Count approved in month
                if (expense.status === 'approved') {
                    approvedCount++;
                }
            }

            // Pending approval
            if (expense.status === 'pending') {
                pendingCount++;
            }
        });

        return {
            todayTotal,
            monthTotal,
            pendingCount,
            approvedCount
        };
    }

    // Render stats cards
    renderStats() {
        const stats = this.getStats();

        const todayEl = document.getElementById('expensesTodayAmount');
        const monthEl = document.getElementById('expensesMonthAmount');
        const pendingEl = document.getElementById('expensesPendingCount');
        const approvedEl = document.getElementById('expensesApprovedCount');

        if (todayEl) todayEl.textContent = `KSh ${stats.todayTotal.toLocaleString()}`;
        if (monthEl) monthEl.textContent = `KSh ${stats.monthTotal.toLocaleString()}`;
        if (pendingEl) pendingEl.textContent = stats.pendingCount;
        if (approvedEl) approvedEl.textContent = stats.approvedCount;
    }

    // Render expenses table
    renderExpenses() {
        const container = document.getElementById('expensesTableBody');
        if (!container) return;

        if (this.filteredExpenses.length === 0) {
            container.innerHTML = `
                <tr>
                    <td colspan="7" style="text-align: center; padding: 3rem; color: var(--text-secondary);">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity: 0.3; margin-bottom: 1rem;">
                            <circle cx="12" cy="12" r="10"></circle>
                            <line x1="12" y1="8" x2="12" y2="12"></line>
                            <line x1="12" y1="16" x2="12.01" y2="16"></line>
                        </svg>
                        <div>No expenses found</div>
                    </td>
                </tr>
            `;
            return;
        }

        container.innerHTML = this.filteredExpenses.map(expense => `
            <tr>
                <td>${new Date(expense.date).toLocaleDateString()}</td>
                <td>
                    <strong>${expense.description || 'N/A'}</strong>
                    ${expense.reference ? `<br><small style="color: var(--text-secondary);">${expense.reference}</small>` : ''}
                </td>
                <td>${expense.category || 'Uncategorized'}</td>
                <td>${expense.vendor || '-'}</td>
                <td><strong>KSh ${parseFloat(expense.amount || 0).toLocaleString()}</strong></td>
                <td>
                    <span class="status-badge status-${expense.status || 'pending'}">
                        ${expense.status || 'pending'}
                    </span>
                </td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-icon" onclick="window.expenseManager.viewExpense('${expense.id}')" title="View">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                <circle cx="12" cy="12" r="3"></circle>
                            </svg>
                        </button>
                        <button class="btn-icon" onclick="window.expenseManager.editExpense('${expense.id}')" title="Edit">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                            </svg>
                        </button>
                        <button class="btn-icon btn-icon-danger" onclick="window.expenseManager.deleteExpense('${expense.id}')" title="Delete">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6"></polyline>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            </svg>
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');
    }

    // Add expense
    async addExpense() {
        const form = document.getElementById('addExpenseForm');
        const formData = new FormData(form);

        const expense = {
            date: formData.get('date'),
            description: formData.get('description'),
            category: formData.get('category'),
            amount: parseFloat(formData.get('amount')),
            vendor: formData.get('vendor'),
            reference: formData.get('reference'),
            paymentMethod: formData.get('paymentMethod'),
            status: formData.get('status') || 'pending',
            notes: formData.get('notes'),
            createdAt: new Date().toISOString()
        };

        try {
            await dataManager.createExpense(expense);
            window.showNotification('Expense added successfully', 'success');
            form.reset();
            
            // Navigate back to expenses page
            document.querySelector('[data-page="expenses"]').click();
            
            // Reload expenses
            await this.refresh();

            // Refresh dashboard stats
            if (window.refreshDashboardStats) {
                await window.refreshDashboardStats();
            }

            // Refresh reports if initialized
            if (window.reportsManager && window.reportsManager.initialized) {
                await window.reportsManager.loadAllData();
            }
        } catch (error) {
            console.error('Error adding expense:', error);
            window.showNotification('Failed to add expense', 'error');
        }
    }

    // View expense details
    viewExpense(expenseId) {
        const expense = this.expenses.find(e => e.id === expenseId);
        if (!expense) {
            window.showNotification('Expense not found', 'error');
            return;
        }

        const modal = document.createElement('div');
        modal.className = 'pos-modal';
        
        modal.innerHTML = `
            <div class="pos-modal-content" style="max-width: 600px;">
                <div class="pos-modal-header">
                    <h3>Expense Details</h3>
                    <button class="pos-modal-close" onclick="this.closest('.pos-modal').remove()">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
                <div class="pos-modal-body">
                    <div class="expense-details">
                        <div class="detail-row">
                            <span class="detail-label">Date:</span>
                            <span class="detail-value">${new Date(expense.date).toLocaleDateString()}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Description:</span>
                            <span class="detail-value"><strong>${expense.description}</strong></span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Category:</span>
                            <span class="detail-value">${expense.category}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Amount:</span>
                            <span class="detail-value"><strong style="color: var(--danger); font-size: 1.2rem;">KSh ${parseFloat(expense.amount).toLocaleString()}</strong></span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Vendor:</span>
                            <span class="detail-value">${expense.vendor || '-'}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Reference:</span>
                            <span class="detail-value">${expense.reference || '-'}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Payment Method:</span>
                            <span class="detail-value">${expense.paymentMethod || '-'}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Status:</span>
                            <span class="detail-value">
                                <span class="status-badge status-${expense.status}">${expense.status}</span>
                            </span>
                        </div>
                        ${expense.notes ? `
                        <div class="detail-row">
                            <span class="detail-label">Notes:</span>
                            <span class="detail-value">${expense.notes}</span>
                        </div>
                        ` : ''}
                    </div>
                </div>
                <div class="pos-modal-footer">
                    <button class="btn-secondary" onclick="this.closest('.pos-modal').remove()">Close</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
    }

    // Edit expense
    editExpense(expenseId) {
        const expense = this.expenses.find(e => e.id === expenseId);
        if (!expense) {
            window.showNotification('Expense not found', 'error');
            return;
        }

        const modal = document.createElement('div');
        modal.className = 'pos-modal';
        
        modal.innerHTML = `
            <div class="pos-modal-content" style="max-width: 700px;">
                <div class="pos-modal-header">
                    <h3>Edit Expense</h3>
                    <button class="pos-modal-close" onclick="this.closest('.pos-modal').remove()">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
                <div class="pos-modal-body">
                    <form id="editExpenseForm" class="expense-form">
                        <div class="form-grid">
                            <div class="form-group">
                                <label>Date *</label>
                                <input type="date" name="date" class="form-input" value="${expense.date}" required>
                            </div>
                            <div class="form-group">
                                <label>Category *</label>
                                <select name="category" class="form-input" required>
                                    <option value="">Select Category</option>
                                    <option value="Rent" ${expense.category === 'Rent' ? 'selected' : ''}>Rent</option>
                                    <option value="Utilities" ${expense.category === 'Utilities' ? 'selected' : ''}>Utilities</option>
                                    <option value="Salaries" ${expense.category === 'Salaries' ? 'selected' : ''}>Salaries</option>
                                    <option value="Inventory" ${expense.category === 'Inventory' ? 'selected' : ''}>Inventory</option>
                                    <option value="Marketing" ${expense.category === 'Marketing' ? 'selected' : ''}>Marketing</option>
                                    <option value="Supplies" ${expense.category === 'Supplies' ? 'selected' : ''}>Supplies</option>
                                    <option value="Transport" ${expense.category === 'Transport' ? 'selected' : ''}>Transport</option>
                                    <option value="Maintenance" ${expense.category === 'Maintenance' ? 'selected' : ''}>Maintenance</option>
                                    <option value="Other" ${expense.category === 'Other' ? 'selected' : ''}>Other</option>
                                </select>
                            </div>
                            <div class="form-group form-group-full">
                                <label>Description *</label>
                                <input type="text" name="description" class="form-input" value="${expense.description}" required>
                            </div>
                            <div class="form-group">
                                <label>Amount (KES) *</label>
                                <input type="number" name="amount" class="form-input" value="${expense.amount}" step="0.01" min="0" required>
                            </div>
                            <div class="form-group">
                                <label>Vendor</label>
                                <input type="text" name="vendor" class="form-input" value="${expense.vendor || ''}">
                            </div>
                            <div class="form-group">
                                <label>Reference</label>
                                <input type="text" name="reference" class="form-input" value="${expense.reference || ''}" placeholder="Invoice #, Receipt #">
                            </div>
                            <div class="form-group">
                                <label>Payment Method</label>
                                <select name="paymentMethod" class="form-input">
                                    <option value="">Select Method</option>
                                    <option value="Cash" ${expense.paymentMethod === 'Cash' ? 'selected' : ''}>Cash</option>
                                    <option value="M-Pesa" ${expense.paymentMethod === 'M-Pesa' ? 'selected' : ''}>M-Pesa</option>
                                    <option value="Bank Transfer" ${expense.paymentMethod === 'Bank Transfer' ? 'selected' : ''}>Bank Transfer</option>
                                    <option value="Card" ${expense.paymentMethod === 'Card' ? 'selected' : ''}>Card</option>
                                    <option value="Cheque" ${expense.paymentMethod === 'Cheque' ? 'selected' : ''}>Cheque</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label>Status</label>
                                <select name="status" class="form-input">
                                    <option value="pending" ${expense.status === 'pending' ? 'selected' : ''}>Pending</option>
                                    <option value="approved" ${expense.status === 'approved' ? 'selected' : ''}>Approved</option>
                                    <option value="rejected" ${expense.status === 'rejected' ? 'selected' : ''}>Rejected</option>
                                </select>
                            </div>
                            <div class="form-group form-group-full">
                                <label>Notes</label>
                                <textarea name="notes" class="form-input" rows="3">${expense.notes || ''}</textarea>
                            </div>
                        </div>
                    </form>
                </div>
                <div class="pos-modal-footer">
                    <button class="btn-secondary" onclick="this.closest('.pos-modal').remove()">Cancel</button>
                    <button class="btn-primary" onclick="window.expenseManager.saveExpenseChanges('${expenseId}')">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                        Save Changes
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
    }

    // Save expense changes
    async saveExpenseChanges(expenseId) {
        const form = document.getElementById('editExpenseForm');
        const formData = new FormData(form);

        const updates = {
            date: formData.get('date'),
            description: formData.get('description'),
            category: formData.get('category'),
            amount: parseFloat(formData.get('amount')),
            vendor: formData.get('vendor'),
            reference: formData.get('reference'),
            paymentMethod: formData.get('paymentMethod'),
            status: formData.get('status'),
            notes: formData.get('notes'),
            updatedAt: new Date().toISOString()
        };

        try {
            await dataManager.updateExpense(expenseId, updates);
            
            // Update local expense
            const expense = this.expenses.find(e => e.id === expenseId);
            if (expense) {
                Object.assign(expense, updates);
            }
            
            // Close modal
            document.querySelector('.pos-modal').remove();
            
            // Refresh display
            await this.refresh();
            window.showNotification('Expense updated successfully', 'success');
        } catch (error) {
            console.error('Error updating expense:', error);
            window.showNotification('Failed to update expense', 'error');
        }
    }

    // Delete expense
    async deleteExpense(expenseId) {
        if (!confirm('Are you sure you want to delete this expense?')) {
            return;
        }

        try {
            await dataManager.deleteExpense(expenseId);
            await this.refresh();
            window.showNotification('Expense deleted successfully', 'success');
        } catch (error) {
            console.error('Error deleting expense:', error);
            window.showNotification('Failed to delete expense', 'error');
        }
    }

    // Refresh data
    async refresh() {
        await this.loadExpenses();
        this.filterExpenses();
        this.renderStats();
        
        // Also refresh dashboard stats if on dashboard
        if (typeof window.refreshDashboardStats === 'function') {
            await window.refreshDashboardStats();
        }
    }

    // Export to PDF
    exportToPDF() {
        const stats = this.getStats();
        
        // Create printable content
        const printContent = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Expense Report</title>
                <style>
                    * { margin: 0; padding: 0; box-sizing: border-box; }
                    body {
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
                        padding: 40px;
                        background: white;
                        color: #000;
                    }
                    .header {
                        text-align: center;
                        margin-bottom: 30px;
                        padding-bottom: 20px;
                        border-bottom: 3px solid #2563eb;
                    }
                    .header h1 {
                        font-size: 28px;
                        color: #1f2937;
                        margin-bottom: 8px;
                    }
                    .header .date {
                        color: #6b7280;
                        font-size: 14px;
                    }
                    .summary {
                        display: grid;
                        grid-template-columns: repeat(4, 1fr);
                        gap: 20px;
                        margin-bottom: 30px;
                    }
                    .summary-card {
                        background: #f9fafb;
                        padding: 20px;
                        border-radius: 8px;
                        border: 1px solid #e5e7eb;
                    }
                    .summary-card .label {
                        font-size: 12px;
                        color: #6b7280;
                        text-transform: uppercase;
                        letter-spacing: 0.5px;
                        margin-bottom: 8px;
                    }
                    .summary-card .value {
                        font-size: 24px;
                        font-weight: bold;
                        color: #1f2937;
                    }
                    .summary-card.red .value { color: #ef4444; }
                    .summary-card.orange .value { color: #f59e0b; }
                    .summary-card.yellow .value { color: #eab308; }
                    .summary-card.green .value { color: #10b981; }
                    table {
                        width: 100%;
                        border-collapse: collapse;
                        margin-top: 20px;
                    }
                    thead {
                        background: #f3f4f6;
                    }
                    th {
                        padding: 12px;
                        text-align: left;
                        font-weight: 600;
                        font-size: 12px;
                        color: #374151;
                        text-transform: uppercase;
                        letter-spacing: 0.5px;
                        border-bottom: 2px solid #e5e7eb;
                    }
                    td {
                        padding: 12px;
                        border-bottom: 1px solid #e5e7eb;
                        font-size: 13px;
                        color: #1f2937;
                    }
                    tr:hover {
                        background: #f9fafb;
                    }
                    .status {
                        display: inline-block;
                        padding: 4px 12px;
                        border-radius: 12px;
                        font-size: 11px;
                        font-weight: 600;
                        text-transform: capitalize;
                    }
                    .status.pending {
                        background: #fef3c7;
                        color: #92400e;
                    }
                    .status.approved {
                        background: #d1fae5;
                        color: #065f46;
                    }
                    .status.rejected {
                        background: #fee2e2;
                        color: #991b1b;
                    }
                    .footer {
                        margin-top: 40px;
                        padding-top: 20px;
                        border-top: 1px solid #e5e7eb;
                        text-align: center;
                        color: #6b7280;
                        font-size: 12px;
                    }
                    .amount {
                        font-weight: 600;
                        color: #1f2937;
                    }
                    @media print {
                        body { padding: 20px; }
                        .summary { page-break-inside: avoid; }
                        table { page-break-inside: auto; }
                        tr { page-break-inside: avoid; }
                    }
                </style>
            </head>
            <body>
                <div class="header">
                    <h1>📊 Expense Report</h1>
                    <div class="date">Generated on ${new Date().toLocaleString()}</div>
                </div>

                <div class="summary">
                    <div class="summary-card red">
                        <div class="label">Today's Expenses</div>
                        <div class="value">KSh ${stats.todayTotal.toLocaleString()}</div>
                    </div>
                    <div class="summary-card orange">
                        <div class="label">This Month</div>
                        <div class="value">KSh ${stats.monthTotal.toLocaleString()}</div>
                    </div>
                    <div class="summary-card yellow">
                        <div class="label">Pending Approval</div>
                        <div class="value">${stats.pendingCount}</div>
                    </div>
                    <div class="summary-card green">
                        <div class="label">Approved (Month)</div>
                        <div class="value">${stats.approvedCount}</div>
                    </div>
                </div>

                <table>
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Description</th>
                            <th>Category</th>
                            <th>Vendor</th>
                            <th>Amount</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${this.filteredExpenses.map(expense => `
                            <tr>
                                <td>${new Date(expense.date).toLocaleDateString()}</td>
                                <td>
                                    <strong>${expense.description || 'N/A'}</strong>
                                    ${expense.reference ? `<br><small style="color: #6b7280;">${expense.reference}</small>` : ''}
                                </td>
                                <td>${expense.category || 'Uncategorized'}</td>
                                <td>${expense.vendor || '-'}</td>
                                <td class="amount">KSh ${parseFloat(expense.amount || 0).toLocaleString()}</td>
                                <td><span class="status ${expense.status || 'pending'}">${expense.status || 'pending'}</span></td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>

                <div class="footer">
                    <p>Total Expenses Shown: ${this.filteredExpenses.length} | Total Amount: KSh ${this.filteredExpenses.reduce((sum, e) => sum + parseFloat(e.amount || 0), 0).toLocaleString()}</p>
                    <p style="margin-top: 8px;">Report generated from Vendlfy POS System</p>
                </div>
            </body>
            </html>
        `;

        // Open print dialog
        const printWindow = window.open('', '_blank');
        printWindow.document.write(printContent);
        printWindow.document.close();
        
        // Wait for content to load then print
        printWindow.onload = function() {
            printWindow.focus();
            printWindow.print();
        };
    }
}

// Create and export instance
const expenseManager = new ExpenseManager();
export default expenseManager;

// Make available globally
window.expenseManager = expenseManager;
