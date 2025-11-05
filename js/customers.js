// Customer Management Module
import dataManager from './data-manager.js';
import branchManager from './branch-manager.js';

class CustomerManager {
    constructor() {
        this.customers = [];
        this.filteredCustomers = [];
        this.currentFilter = 'all';
        this.searchQuery = '';
        this.dateFilter = 'all';
    }

    // Initialize
    async init() {
        console.log('👥 Initializing Customer Manager...');
        await this.loadCustomers();
        this.setupEventListeners();
        this.renderStats();
        this.renderCustomers();
    }

    // Setup event listeners
    setupEventListeners() {
        // Search
        const searchInput = document.getElementById('customerSearch');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.searchQuery = e.target.value.toLowerCase();
                this.filterCustomers();
            });
        }

        // Filter buttons
        const filterBtns = document.querySelectorAll('.customer-filter-btn');
        filterBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                filterBtns.forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.currentFilter = e.target.dataset.filter;
                this.filterCustomers();
            });
        });

        // Date filter
        const dateFilter = document.getElementById('customerDateFilter');
        if (dateFilter) {
            dateFilter.addEventListener('change', (e) => {
                this.dateFilter = e.target.value;
                this.filterCustomers();
            });
        }

        // Add customer form
        const addForm = document.getElementById('addCustomerForm');
        if (addForm) {
            addForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.addCustomer();
            });
        }
    }

    // Load customers from database
    async loadCustomers() {
        try {
            this.customers = await dataManager.getCustomers();
            this.filteredCustomers = [...this.customers];
            console.log('✅ Loaded', this.customers.length, 'customers');
        } catch (error) {
            console.error('Error loading customers:', error);
            window.showNotification('Failed to load customers', 'error');
        }
    }

    // Filter customers
    filterCustomers() {
        let filtered = [...this.customers];

        // Apply search filter
        if (this.searchQuery) {
            filtered = filtered.filter(customer => 
                customer.name?.toLowerCase().includes(this.searchQuery) ||
                customer.email?.toLowerCase().includes(this.searchQuery) ||
                customer.phone?.toLowerCase().includes(this.searchQuery) ||
                customer.company?.toLowerCase().includes(this.searchQuery)
            );
        }

        // Apply status filter
        if (this.currentFilter !== 'all') {
            filtered = filtered.filter(customer => customer.status === this.currentFilter);
        }

        // Apply date filter
        if (this.dateFilter !== 'all') {
            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
            const yearStart = new Date(now.getFullYear(), 0, 1);

            filtered = filtered.filter(customer => {
                const createdDate = new Date(customer.createdAt);
                
                switch(this.dateFilter) {
                    case 'today':
                        return createdDate >= today;
                    case 'this-month':
                        return createdDate >= monthStart;
                    case 'this-year':
                        return createdDate >= yearStart;
                    default:
                        return true;
                }
            });
        }

        this.filteredCustomers = filtered;
        this.renderCustomers();
    }

    // Calculate stats
    getStats() {
        const total = this.customers.length;
        const active = this.customers.filter(c => c.status === 'active').length;
        const inactive = this.customers.filter(c => c.status === 'inactive').length;

        return {
            total,
            active,
            inactive
        };
    }

    // Render stats cards
    renderStats() {
        const stats = this.getStats();

        const totalEl = document.getElementById('customersTotalCount');
        const activeEl = document.getElementById('customersActiveCount');
        const inactiveEl = document.getElementById('customersInactiveCount');

        if (totalEl) totalEl.textContent = stats.total;
        if (activeEl) activeEl.textContent = stats.active;
        if (inactiveEl) inactiveEl.textContent = stats.inactive;
    }

    // Render customers table
    renderCustomers() {
        const container = document.getElementById('customersTableBody');
        if (!container) return;

        if (this.filteredCustomers.length === 0) {
            container.innerHTML = `
                <tr>
                    <td colspan="6" style="text-align: center; padding: 3rem; color: var(--text-secondary);">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity: 0.3; margin-bottom: 1rem;">
                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                            <circle cx="9" cy="7" r="4"></circle>
                            <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                            <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                        </svg>
                        <div>No customers found</div>
                    </td>
                </tr>
            `;
            return;
        }

        container.innerHTML = this.filteredCustomers.map(customer => `
            <tr>
                <td>
                    <div style="display: flex; align-items: center; gap: 0.75rem;">
                        <div class="customer-avatar">${(customer.name || 'N/A').charAt(0).toUpperCase()}</div>
                        <div>
                            <strong>${customer.name || 'N/A'}</strong>
                            ${customer.company ? `<br><small style="color: var(--text-secondary);">${customer.company}</small>` : ''}
                        </div>
                    </div>
                </td>
                <td>${customer.email || '-'}</td>
                <td>${customer.phone || '-'}</td>
                <td>${customer.address || '-'}</td>
                <td>
                    <span class="status-badge status-${customer.status || 'active'}">
                        ${customer.status || 'active'}
                    </span>
                </td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-icon" onclick="window.customerManager.viewCustomer('${customer.id}')" title="View">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                <circle cx="12" cy="12" r="3"></circle>
                            </svg>
                        </button>
                        <button class="btn-icon" onclick="window.customerManager.editCustomer('${customer.id}')" title="Edit">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                            </svg>
                        </button>
                        <button class="btn-icon btn-icon-danger" onclick="window.customerManager.deleteCustomer('${customer.id}')" title="Delete">
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

    // Add customer
    async addCustomer() {
        const form = document.getElementById('addCustomerForm');
        const formData = new FormData(form);

        const customer = {
            name: formData.get('name'),
            email: formData.get('email'),
            phone: formData.get('phone'),
            company: formData.get('company'),
            address: formData.get('address'),
            city: formData.get('city'),
            country: formData.get('country'),
            status: formData.get('status') || 'active',
            notes: formData.get('notes'),
            createdAt: new Date().toISOString()
        };

        try {
            await dataManager.createCustomer(customer);
            window.showNotification('Customer added successfully', 'success');
            form.reset();
            
            // Navigate back to customers page
            document.querySelector('[data-page="customers"]').click();
            
            // Reload customers
            await this.refresh();
        } catch (error) {
            console.error('Error adding customer:', error);
            window.showNotification('Failed to add customer', 'error');
        }
    }

    // View customer details
    viewCustomer(customerId) {
        const customer = this.customers.find(c => c.id === customerId);
        if (!customer) {
            window.showNotification('Customer not found', 'error');
            return;
        }

        const modal = document.createElement('div');
        modal.className = 'pos-modal';
        
        modal.innerHTML = `
            <div class="pos-modal-content" style="max-width: 600px;">
                <div class="pos-modal-header">
                    <h3>Customer Details</h3>
                    <button class="pos-modal-close" onclick="this.closest('.pos-modal').remove()">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
                <div class="pos-modal-body">
                    <div class="customer-details-view">
                        <div class="customer-header">
                            <div class="customer-avatar-large">${(customer.name || 'N/A').charAt(0).toUpperCase()}</div>
                            <div>
                                <h3>${customer.name}</h3>
                                ${customer.company ? `<p style="color: var(--text-secondary);">${customer.company}</p>` : ''}
                            </div>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Email:</span>
                            <span class="detail-value">${customer.email || '-'}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Phone:</span>
                            <span class="detail-value">${customer.phone || '-'}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Address:</span>
                            <span class="detail-value">${customer.address || '-'}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">City:</span>
                            <span class="detail-value">${customer.city || '-'}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Country:</span>
                            <span class="detail-value">${customer.country || '-'}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Status:</span>
                            <span class="detail-value">
                                <span class="status-badge status-${customer.status}">${customer.status}</span>
                            </span>
                        </div>
                        ${customer.notes ? `
                        <div class="detail-row">
                            <span class="detail-label">Notes:</span>
                            <span class="detail-value">${customer.notes}</span>
                        </div>
                        ` : ''}
                        <div class="detail-row">
                            <span class="detail-label">Registered:</span>
                            <span class="detail-value">${new Date(customer.createdAt).toLocaleDateString()}</span>
                        </div>
                    </div>
                </div>
                <div class="pos-modal-footer">
                    <button class="btn-secondary" onclick="this.closest('.pos-modal').remove()">Close</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
    }

    // Edit customer
    editCustomer(customerId) {
        const customer = this.customers.find(c => c.id === customerId);
        if (!customer) {
            window.showNotification('Customer not found', 'error');
            return;
        }

        const modal = document.createElement('div');
        modal.className = 'pos-modal';
        
        modal.innerHTML = `
            <div class="pos-modal-content" style="max-width: 700px;">
                <div class="pos-modal-header">
                    <h3>Edit Customer</h3>
                    <button class="pos-modal-close" onclick="this.closest('.pos-modal').remove()">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
                <div class="pos-modal-body">
                    <form id="editCustomerForm" class="customer-form">
                        <div class="form-row">
                            <div class="form-group">
                                <label>Full Name *</label>
                                <input type="text" name="name" class="form-input" value="${customer.name}" required>
                            </div>
                            <div class="form-group">
                                <label>Email</label>
                                <input type="email" name="email" class="form-input" value="${customer.email || ''}">
                            </div>
                            <div class="form-group">
                                <label>Phone</label>
                                <input type="tel" name="phone" class="form-input" value="${customer.phone || ''}">
                            </div>
                            <div class="form-group">
                                <label>Company</label>
                                <input type="text" name="company" class="form-input" value="${customer.company || ''}">
                            </div>
                            <div class="form-group form-group-full">
                                <label>Address</label>
                                <input type="text" name="address" class="form-input" value="${customer.address || ''}">
                            </div>
                            <div class="form-group">
                                <label>City</label>
                                <input type="text" name="city" class="form-input" value="${customer.city || ''}">
                            </div>
                            <div class="form-group">
                                <label>Country</label>
                                <input type="text" name="country" class="form-input" value="${customer.country || ''}">
                            </div>
                            <div class="form-group">
                                <label>Status</label>
                                <select name="status" class="form-input">
                                    <option value="active" ${customer.status === 'active' ? 'selected' : ''}>Active</option>
                                    <option value="inactive" ${customer.status === 'inactive' ? 'selected' : ''}>Inactive</option>
                                </select>
                            </div>
                            <div class="form-group form-group-full">
                                <label>Notes</label>
                                <textarea name="notes" class="form-input" rows="3">${customer.notes || ''}</textarea>
                            </div>
                        </div>
                    </form>
                </div>
                <div class="pos-modal-footer">
                    <button class="btn-secondary" onclick="this.closest('.pos-modal').remove()">Cancel</button>
                    <button class="btn-primary" onclick="window.customerManager.saveCustomerChanges('${customerId}')">
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

    // Save customer changes
    async saveCustomerChanges(customerId) {
        const form = document.getElementById('editCustomerForm');
        const formData = new FormData(form);

        const updates = {
            name: formData.get('name'),
            email: formData.get('email'),
            phone: formData.get('phone'),
            company: formData.get('company'),
            address: formData.get('address'),
            city: formData.get('city'),
            country: formData.get('country'),
            status: formData.get('status'),
            notes: formData.get('notes'),
            updatedAt: new Date().toISOString()
        };

        try {
            await dataManager.updateCustomer(customerId, updates);
            
            // Update local customer
            const customer = this.customers.find(c => c.id === customerId);
            if (customer) {
                Object.assign(customer, updates);
            }
            
            // Close modal
            document.querySelector('.pos-modal').remove();
            
            // Refresh display
            await this.refresh();
            window.showNotification('Customer updated successfully', 'success');
        } catch (error) {
            console.error('Error updating customer:', error);
            window.showNotification('Failed to update customer', 'error');
        }
    }

    // Delete customer
    async deleteCustomer(customerId) {
        if (!confirm('Are you sure you want to delete this customer?')) {
            return;
        }

        try {
            await dataManager.deleteCustomer(customerId);
            await this.refresh();
            window.showNotification('Customer deleted successfully', 'success');
        } catch (error) {
            console.error('Error deleting customer:', error);
            window.showNotification('Failed to delete customer', 'error');
        }
    }

    // Export to PDF
    exportToPDF() {
        const stats = this.getStats();
        
        const printContent = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Customer Report</title>
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
                        color: #000000;
                        margin-bottom: 8px;
                        font-weight: 700;
                    }
                    .header .date {
                        color: #6b7280;
                        font-size: 14px;
                    }
                    .summary {
                        display: grid;
                        grid-template-columns: repeat(3, 1fr);
                        gap: 20px;
                        margin-bottom: 30px;
                    }
                    .summary-card {
                        background: #f9fafb;
                        padding: 20px;
                        border-radius: 8px;
                        border: 1px solid #e5e7eb;
                        text-align: center;
                    }
                    .summary-card .label {
                        font-size: 12px;
                        color: #6b7280;
                        text-transform: uppercase;
                        letter-spacing: 0.5px;
                        margin-bottom: 8px;
                    }
                    .summary-card .value {
                        font-size: 32px;
                        font-weight: bold;
                        color: #000000;
                    }
                    .summary-card.blue .value { color: #000000; }
                    .summary-card.green .value { color: #000000; }
                    .summary-card.gray .value { color: #000000; }
                    table {
                        width: 100%;
                        border-collapse: collapse;
                        margin-top: 20px;
                    }
                    thead {
                        background: white;
                        border-bottom: 2px solid #000000;
                    }
                    th {
                        padding: 12px;
                        text-align: left;
                        font-weight: 700;
                        font-size: 12px;
                        color: #000000;
                        text-transform: uppercase;
                        letter-spacing: 0.5px;
                    }
                    td {
                        padding: 12px;
                        border-bottom: 1px solid #e5e7eb;
                        font-size: 13px;
                        color: #000000;
                    }
                    tr:hover {
                        background: #f9fafb;
                    }
                    .status {
                        display: inline-block;
                        padding: 4px 12px;
                        border-radius: 4px;
                        font-size: 11px;
                        font-weight: 600;
                        text-transform: capitalize;
                        border: 1px solid #d1d5db;
                    }
                    .status.active {
                        background: white;
                        color: #000000;
                    }
                    .status.inactive {
                        background: #f3f4f6;
                        color: #6b7280;
                    }
                    .footer {
                        margin-top: 40px;
                        padding-top: 20px;
                        border-top: 1px solid #e5e7eb;
                        text-align: center;
                        color: #6b7280;
                        font-size: 12px;
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
                    <h1>👥 Customer Report</h1>
                    <div class="date">Generated on ${new Date().toLocaleString()}</div>
                </div>

                <div class="summary">
                    <div class="summary-card blue">
                        <div class="label">Total Customers</div>
                        <div class="value">${stats.total}</div>
                    </div>
                    <div class="summary-card green">
                        <div class="label">Active Customers</div>
                        <div class="value">${stats.active}</div>
                    </div>
                    <div class="summary-card gray">
                        <div class="label">Inactive Customers</div>
                        <div class="value">${stats.inactive}</div>
                    </div>
                </div>

                <table>
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Email</th>
                            <th>Phone</th>
                            <th>Address</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${this.filteredCustomers.map(customer => `
                            <tr>
                                <td>
                                    <strong>${customer.name || 'N/A'}</strong>
                                    ${customer.company ? `<br><small style="color: #6b7280;">${customer.company}</small>` : ''}
                                </td>
                                <td>${customer.email || '-'}</td>
                                <td>${customer.phone || '-'}</td>
                                <td>${customer.address || '-'}</td>
                                <td><span class="status ${customer.status || 'active'}">${customer.status || 'active'}</span></td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>

                <div class="footer">
                    <p>Total Customers Shown: ${this.filteredCustomers.length}</p>
                    <p style="margin-top: 8px;">Report generated from Vendlfy POS System</p>
                </div>
            </body>
            </html>
        `;

        const printWindow = window.open('', '_blank');
        printWindow.document.write(printContent);
        printWindow.document.close();
        
        printWindow.onload = function() {
            printWindow.focus();
            printWindow.print();
        };
    }

    // Refresh data
    async refresh() {
        await this.loadCustomers();
        this.filterCustomers();
        this.renderStats();
        
        // Also refresh dashboard stats if available
        if (typeof window.refreshDashboardStats === 'function') {
            await window.refreshDashboardStats();
        }
    }
}

// Create and export instance
const customerManager = new CustomerManager();
export default customerManager;

// Make available globally
window.customerManager = customerManager;
