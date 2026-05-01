// B2B Sales Module - Wholesale Sales Management
import dataManager from './data-manager.js';
import branchManager from './branch-manager.js';
import brandManager from './brand-manager.js';

class B2BSalesManager {
    constructor() {
        this.sales = [];
        this.filteredSales = [];
        this.inventory = [];
        this.customers = [];
        this.filters = {
            search: '',
            status: 'all', // all, pending, completed, cancelled
            dateRange: 'all', // all, today, week, month
            customerType: 'all' // all, wholesale, retail
        };
        this.pagination = {
            currentPage: 1,
            itemsPerPage: 10,
            totalPages: 1,
            totalItems: 0
        };
    }

    async init() {
        console.log('🏢 Initializing B2B Sales Module...');
        await this.loadCustomers();
        await this.loadB2BSales();
        this.setupEventListeners();
        this.renderStats();
        this.renderSalesTable();
        this.startRealtimeSync();
        console.log('✅ B2B Sales Module ready');
    }

    // Load inventory for wholesale selling
    async loadInventory() {
        try {
            this.inventory = await dataManager.getInventory();
            console.log(`📦 Loaded ${this.inventory.length} inventory items`);
        } catch (error) {
            console.error('Error loading inventory:', error);
            this.inventory = [];
        }
    }

    // Load customers
    async loadCustomers() {
        try {
            this.customers = await dataManager.getCustomers();
            console.log(`👥 Loaded ${this.customers.length} customers`);
        } catch (error) {
            console.error('Error loading customers:', error);
            this.customers = [];
        }
    }

    // Load B2B sales
    async loadB2BSales() {
        try {
            const allSales = await dataManager.getSales();
            this.sales = allSales.filter(sale => sale.type === 'b2b' || sale.saleType === 'wholesale');
            // Sort by date descending (most recent first)
            this.sales.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            this.filteredSales = [...this.sales];
            console.log(`💼 Loaded ${this.sales.length} B2B sales`);
        } catch (error) {
            console.error('Error loading B2B sales:', error);
            this.sales = [];
            this.filteredSales = [];
        }
    }

    // Setup event listeners
    setupEventListeners() {
        // Search
        const searchInput = document.getElementById('b2bSearchInput');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.filters.search = e.target.value.toLowerCase();
                this.pagination.currentPage = 1; // Reset to first page
                this.applyFilters();
            });
        }

        // Filter buttons
        const filterButtons = document.querySelectorAll('.b2b-filter-btn');
        filterButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const filterType = e.target.dataset.filter;
                const filterValue = e.target.dataset.value;
                
                // Update active state
                document.querySelectorAll(`.b2b-filter-btn[data-filter="${filterType}"]`).forEach(b => {
                    b.classList.remove('active');
                });
                e.target.classList.add('active');
                
                // Apply filter
                this.filters[filterType] = filterValue;
                this.pagination.currentPage = 1; // Reset to first page
                this.applyFilters();
            });
        });

        // Entries per page selector
        const entriesSelect = document.getElementById('b2bEntriesPerPage');
        if (entriesSelect) {
            entriesSelect.addEventListener('change', (e) => {
                this.pagination.itemsPerPage = parseInt(e.target.value);
                this.pagination.currentPage = 1; // Reset to first page
                this.renderSalesTable();
            });
        }

        // Pagination controls
        const firstPage = document.getElementById('b2bFirstPage');
        const prevPage = document.getElementById('b2bPrevPage');
        const nextPage = document.getElementById('b2bNextPage');
        const lastPage = document.getElementById('b2bLastPage');

        if (firstPage) {
            firstPage.addEventListener('click', () => {
                this.pagination.currentPage = 1;
                this.renderSalesTable();
            });
        }

        if (prevPage) {
            prevPage.addEventListener('click', () => {
                if (this.pagination.currentPage > 1) {
                    this.pagination.currentPage--;
                    this.renderSalesTable();
                }
            });
        }

        if (nextPage) {
            nextPage.addEventListener('click', () => {
                if (this.pagination.currentPage < this.pagination.totalPages) {
                    this.pagination.currentPage++;
                    this.renderSalesTable();
                }
            });
        }

        if (lastPage) {
            lastPage.addEventListener('click', () => {
                this.pagination.currentPage = this.pagination.totalPages;
                this.renderSalesTable();
            });
        }

        // Sell as Retailer button
        const retailBtn = document.getElementById('sellAsRetailerBtn');
        if (retailBtn) {
            retailBtn.addEventListener('click', () => {
                this.navigateToRetailPOS();
            });
        }

        // New Wholesale Sale button
        const wholesaleBtn = document.getElementById('newWholesaleBtn');
        if (wholesaleBtn) {
            wholesaleBtn.addEventListener('click', () => {
                this.navigateToNewB2BSale();
            });
        }

        // Listen for branch changes
        window.addEventListener('branchChanged', async () => {
            await this.loadB2BSales();
            this.renderStats();
            this.renderSalesTable();
        });

        // Listen for new B2B sale created event
        window.addEventListener('b2bSaleCreated', async () => {
            console.log('🔔 B2B Sale Created event received, refreshing table...');
            await this.loadB2BSales();
            this.renderStats();
            this.renderSalesTable();
        });
    }

    // Start real-time sync for sales updates.
    // Refresh every 2 minutes, only when the b2b-sales page is visible and the
    // tab is in the foreground. Previously this polled every 30s on every page
    // and ALSO cascaded into refreshDashboardStats + refreshAccountStats — those
    // modules already auto-refresh themselves when their page is active, so the
    // cascade just multiplied Firestore reads.
    startRealtimeSync() {
        if (this._realtimeSyncStarted) return;
        this._realtimeSyncStarted = true;
        setInterval(async () => {
            if (document.visibilityState !== 'visible') return;
            const b2bPage = document.getElementById('b2b-sales-page');
            if (!b2bPage || !b2bPage.classList.contains('active')) return;
            await this.loadB2BSales();
            this.renderStats();
            this.renderSalesTable();
        }, 120000);
    }

    // Apply filters
    applyFilters() {
        this.filteredSales = this.sales.filter(sale => {
            // Search filter
            if (this.filters.search) {
                const searchTerm = this.filters.search;
                const matchesSearch = 
                    sale.customer?.toLowerCase().includes(searchTerm) ||
                    sale.saleNumber?.toLowerCase().includes(searchTerm) ||
                    sale.customerPhone?.toLowerCase().includes(searchTerm);
                if (!matchesSearch) return false;
            }

            // Status filter
            if (this.filters.status !== 'all' && sale.status !== this.filters.status) {
                return false;
            }

            // Date range filter
            if (this.filters.dateRange !== 'all') {
                const saleDate = new Date(sale.createdAt);
                const today = new Date();
                today.setHours(0, 0, 0, 0);

                switch (this.filters.dateRange) {
                    case 'today':
                        if (saleDate < today) return false;
                        break;
                    case 'week':
                        const weekAgo = new Date(today);
                        weekAgo.setDate(weekAgo.getDate() - 7);
                        if (saleDate < weekAgo) return false;
                        break;
                    case 'month':
                        const monthAgo = new Date(today);
                        monthAgo.setMonth(monthAgo.getMonth() - 1);
                        if (saleDate < monthAgo) return false;
                        break;
                }
            }

            return true;
        });

        // Sort by date descending (most recent first)
        this.filteredSales.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        this.renderSalesTable();
    }

    // Render stats cards
    renderStats() {
        const stats = this.calculateStats();

        // Total B2B Sales
        const totalSalesEl = document.getElementById('b2bTotalSales');
        if (totalSalesEl) {
            totalSalesEl.textContent = this.formatCurrency(stats.totalSales);
        }

        // Pending Orders
        const pendingEl = document.getElementById('b2bPendingOrders');
        if (pendingEl) {
            pendingEl.textContent = stats.pendingOrders;
        }

        // Total Customers
        const customersEl = document.getElementById('b2bTotalCustomers');
        if (customersEl) {
            customersEl.textContent = stats.totalCustomers;
        }

        // Average Order Value
        const avgOrderEl = document.getElementById('b2bAvgOrderValue');
        if (avgOrderEl) {
            avgOrderEl.textContent = this.formatCurrency(stats.avgOrderValue);
        }
    }

    // Calculate statistics
    calculateStats() {
        const totalSales = this.sales.reduce((sum, sale) => sum + (sale.total || 0), 0);
        const pendingOrders = this.sales.filter(s => s.status === 'pending').length;
        const wholesaleCustomers = new Set(this.sales.map(s => s.customerId).filter(Boolean));
        const avgOrderValue = this.sales.length > 0 ? totalSales / this.sales.length : 0;

        return {
            totalSales,
            pendingOrders,
            totalCustomers: wholesaleCustomers.size,
            avgOrderValue
        };
    }

    // Render B2B sales table
    renderSalesTable() {
        const tbody = document.getElementById('b2bSalesTableBody');
        if (!tbody) return;

        // Calculate pagination
        this.pagination.totalItems = this.filteredSales.length;
        this.pagination.totalPages = Math.ceil(this.pagination.totalItems / this.pagination.itemsPerPage);
        
        // Ensure current page is valid
        if (this.pagination.currentPage > this.pagination.totalPages) {
            this.pagination.currentPage = Math.max(1, this.pagination.totalPages);
        }

        // Calculate start and end indices
        const startIndex = (this.pagination.currentPage - 1) * this.pagination.itemsPerPage;
        const endIndex = Math.min(startIndex + this.pagination.itemsPerPage, this.pagination.totalItems);
        
        // Get items for current page
        const pageItems = this.filteredSales.slice(startIndex, endIndex);

        // Update table info
        this.updateTableInfo(this.pagination.totalItems, startIndex, endIndex);

        if (this.pagination.totalItems === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="10" style="text-align: center; padding: 3rem;">
                        <div class="empty-state-inline">
                            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                                <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
                                <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
                            </svg>
                            <p>No B2B sales found${this.filters.search || this.filters.status !== 'all' || this.filters.dateRange !== 'all' ? ' for the selected filters' : ''}.</p>
                        </div>
                    </td>
                </tr>
            `;
            this.updatePaginationControls();
            return;
        }

        tbody.innerHTML = pageItems.map(sale => this.renderSaleRow(sale)).join('');
        this.updatePaginationControls();
    }

    // Update table info
    updateTableInfo(totalItems, startIndex, endIndex) {
        const tableInfo = document.getElementById('b2bTableInfo');
        const paginationInfo = document.getElementById('b2bPaginationInfo');
        
        if (tableInfo) {
            tableInfo.textContent = `Showing ${totalItems} of ${this.sales.length} entries`;
        }
        
        if (paginationInfo) {
            if (totalItems === 0) {
                paginationInfo.textContent = 'Showing 0 to 0 of 0 entries';
            } else {
                paginationInfo.textContent = `Showing ${startIndex + 1} to ${endIndex} of ${totalItems} entries`;
            }
        }
    }

    // Update pagination controls
    updatePaginationControls() {
        const firstBtn = document.getElementById('b2bFirstPage');
        const prevBtn = document.getElementById('b2bPrevPage');
        const nextBtn = document.getElementById('b2bNextPage');
        const lastBtn = document.getElementById('b2bLastPage');
        const numbersContainer = document.getElementById('b2bPaginationNumbers');

        if (!numbersContainer) return;

        // Disable/enable navigation buttons
        if (firstBtn) firstBtn.disabled = this.pagination.currentPage === 1;
        if (prevBtn) prevBtn.disabled = this.pagination.currentPage === 1;
        if (nextBtn) nextBtn.disabled = this.pagination.currentPage === this.pagination.totalPages;
        if (lastBtn) lastBtn.disabled = this.pagination.currentPage === this.pagination.totalPages;

        // Generate page numbers
        const pageNumbers = this.generatePageNumbers();
        numbersContainer.innerHTML = pageNumbers.map(page => {
            if (page === '...') {
                return '<span class="pagination-ellipsis">...</span>';
            }
            return `
                <button class="pagination-btn ${page === this.pagination.currentPage ? 'active' : ''}" 
                        onclick="window.b2bSalesManager.goToPage(${page})">
                    ${page}
                </button>
            `;
        }).join('');
    }

    // Generate page numbers for pagination with smart ellipsis
    generatePageNumbers() {
        const current = this.pagination.currentPage;
        const total = this.pagination.totalPages;
        const pages = [];

        if (total <= 7) {
            // Show all pages if 7 or fewer
            for (let i = 1; i <= total; i++) {
                pages.push(i);
            }
        } else {
            // Always show first page
            pages.push(1);
            
            if (current > 3) {
                pages.push('...');
            }
            
            // Show pages around current page
            for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) {
                pages.push(i);
            }
            
            if (current < total - 2) {
                pages.push('...');
            }
            
            // Always show last page
            pages.push(total);
        }

        return pages;
    }

    // Go to specific page
    goToPage(page) {
        this.pagination.currentPage = page;
        this.renderSalesTable();
    }

    // Render individual sale row
    renderSaleRow(sale) {
        const date = new Date(sale.createdAt);
        const status = (sale.status || 'pending').toLowerCase();
        const statusClass = status === 'completed' ? 'success' : 
                           status === 'pending' ? 'warning' : 'danger';
        const statusText = status ? status.charAt(0).toUpperCase() + status.slice(1) : 'N/A';

        return `
            <tr>
                <td style="min-width: 140px;"><strong>${sale.saleNumber || 'N/A'}</strong></td>
                <td style="min-width: 160px; white-space: nowrap;">${date.toLocaleDateString()} ${date.toLocaleTimeString()}</td>
                <td style="min-width: 180px;">${sale.customer || 'Walk-in'}</td>
                <td style="min-width: 130px;">${sale.customerPhone || 'N/A'}</td>
                <td style="min-width: 80px; text-align: center;">${sale.items?.length || 0} items</td>
                <td style="min-width: 120px;"><strong>${this.formatCurrency(sale.total)}</strong></td>
                <td style="min-width: 150px;">
                    <span class="payment-badge">${this.formatPaymentMethod(sale.paymentMethod)}</span>
                </td>
                <td style="min-width: 130px;">
                    <span class="credit-badge">${this.formatCreditTerm(sale.creditTerm)}</span>
                </td>
                <td style="min-width: 110px;">
                    <span class="status-badge ${statusClass}">${statusText}</span>
                </td>
                <td class="sticky-action-cell">
                    <div class="action-buttons">
                        <button class="btn-icon" onclick="window.b2bSalesManager.viewSaleDetails('${sale.id}')" title="View Details">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                <circle cx="12" cy="12" r="3"></circle>
                            </svg>
                        </button>
                        <button class="btn-icon primary" onclick="window.b2bSalesManager.editSale('${sale.id}')" title="Edit Sale">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
                            </svg>
                        </button>
                        <button class="btn-icon danger" onclick="window.b2bSalesManager.deleteSale('${sale.id}')" title="Delete Sale">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6"></polyline>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                <line x1="10" y1="11" x2="10" y2="17"></line>
                                <line x1="14" y1="11" x2="14" y2="17"></line>
                            </svg>
                        </button>
                        <button class="btn-icon" onclick="window.b2bSalesManager.printInvoice('${sale.id}')" title="Print Invoice">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="6 9 6 2 18 2 18 9"></polyline>
                                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                                <rect x="6" y="14" width="12" height="8"></rect>
                            </svg>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }

    // Format payment method
    formatPaymentMethod(method) {
        const methods = {
            'cash': 'Cash',
            'mpesa': 'M-Pesa',
            'bank_transfer': 'Bank Transfer',
            'cheque': 'Cheque',
            'credit': 'Credit'
        };
        return methods[method] || method || 'N/A';
    }

    // Format credit term
    formatCreditTerm(term) {
        const terms = {
            'immediate': 'Immediate',
            'net30': 'Net 30',
            'net60': 'Net 60',
            'net90': 'Net 90'
        };
        return terms[term] || term || 'Immediate';
    }

    // View sale details
    viewSaleDetails(saleId) {
        const sale = this.sales.find(s => s.id === saleId);
        if (!sale) return;

        const modal = document.createElement('div');
        modal.className = 'pos-modal';
        modal.innerHTML = `
            <div class="pos-modal-overlay" onclick="this.parentElement.remove()"></div>
            <div class="pos-modal-content large-modal">
                <div class="pos-modal-header">
                    <h3>B2B Sale Details</h3>
                    <button class="modal-close" onclick="this.closest('.pos-modal').remove()">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
                <div class="pos-modal-body">
                    <div class="sale-details-grid">
                        <div class="detail-section">
                            <h4>Order Information</h4>
                            <div class="detail-row">
                                <span>Invoice #:</span>
                                <strong>${sale.saleNumber || 'N/A'}</strong>
                            </div>
                            <div class="detail-row">
                                <span>Date:</span>
                                <strong>${new Date(sale.createdAt).toLocaleString()}</strong>
                            </div>
                            <div class="detail-row">
                                <span>Status:</span>
                                <span class="status-badge ${sale.status === 'completed' ? 'success' : 'warning'}">${sale.status || 'N/A'}</span>
                            </div>
                            <div class="detail-row">
                                <span>Branch:</span>
                                <strong>${sale.branchName || 'N/A'}</strong>
                            </div>
                        </div>

                        <div class="detail-section">
                            <h4>Customer Information</h4>
                            <div class="detail-row">
                                <span>Name:</span>
                                <strong>${sale.customer || 'N/A'}</strong>
                            </div>
                            <div class="detail-row">
                                <span>Phone:</span>
                                <strong>${sale.customerPhone || 'N/A'}</strong>
                            </div>
                        </div>

                        <div class="detail-section">
                            <h4>Payment Information</h4>
                            <div class="detail-row">
                                <span>Payment Method:</span>
                                <strong>${this.formatPaymentMethod(sale.paymentMethod)}</strong>
                            </div>
                            <div class="detail-row">
                                <span>Credit Terms:</span>
                                <strong>${this.formatCreditTerm(sale.creditTerm)}</strong>
                            </div>
                        </div>
                    </div>

                    <div class="detail-section full-width">
                        <h4>Items Ordered</h4>
                        <table class="detail-table">
                            <thead>
                                <tr>
                                    <th>Item</th>
                                    <th>SKU</th>
                                    <th>Unit Price</th>
                                    <th>Quantity</th>
                                    <th>Total</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${sale.items?.map(item => `
                                    <tr>
                                        <td>${item.name}</td>
                                        <td>${item.sku || 'N/A'}</td>
                                        <td>${this.formatCurrency(item.price)}</td>
                                        <td>${item.quantity}</td>
                                        <td><strong>${this.formatCurrency(item.total)}</strong></td>
                                    </tr>
                                `).join('') || '<tr><td colspan="5">No items</td></tr>'}
                            </tbody>
                        </table>
                    </div>

                    <div class="sale-summary">
                        <div class="summary-row">
                            <span>Subtotal:</span>
                            <strong>${this.formatCurrency(sale.subtotal || sale.total)}</strong>
                        </div>
                        ${sale.discount ? `
                            <div class="summary-row">
                                <span>Discount:</span>
                                <strong class="text-danger">-${this.formatCurrency(sale.discount)}</strong>
                            </div>
                        ` : ''}
                        <div class="summary-row grand-total">
                            <span>Grand Total:</span>
                            <strong>${this.formatCurrency(sale.total)}</strong>
                        </div>
                    </div>
                </div>
                <div class="pos-modal-footer">
                    <button onclick="window.b2bSalesManager.printInvoice('${sale.id}')" class="btn btn-primary">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="6 9 6 2 18 2 18 9"></polyline>
                            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                            <rect x="6" y="14" width="12" height="8"></rect>
                        </svg>
                        Print Invoice
                    </button>
                    <button onclick="this.closest('.pos-modal').remove()" class="btn btn-secondary">Close</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        setTimeout(() => modal.classList.add('show'), 10);
    }

    // Print invoice
    printInvoice(saleId) {
        const sale = this.sales.find(s => s.id === saleId);
        if (!sale) return;

        const brand = brandManager.getBrand();
        const printWindow = window.open('', '', 'height=900,width=800');
        const invoiceDate = new Date(sale.createdAt);
        const dueDate = this.calculateDueDate(invoiceDate, sale.creditTerm);
        
        printWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>Invoice ${sale.saleNumber}</title>
                <style>
                    * { margin: 0; padding: 0; box-sizing: border-box; }
                    @page { size: A4; margin: 15mm; }
                    body {
                        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                        color: #1f2937;
                        line-height: 1.5;
                        max-width: 210mm;
                        margin: 0 auto;
                        padding: 10mm;
                        background: white;
                    }
                    .invoice-header {
                        display: flex;
                        justify-content: space-between;
                        align-items: flex-start;
                        margin-bottom: 30px;
                        padding-bottom: 20px;
                        border-bottom: 3px solid #2563eb;
                    }
                    .company-info h1 {
                        font-size: 32px;
                        color: #2563eb;
                        font-weight: 700;
                        margin-bottom: 5px;
                    }
                    .company-info p {
                        font-size: 12px;
                        color: #6b7280;
                        margin: 2px 0;
                    }
                    .invoice-meta {
                        text-align: right;
                    }
                    .invoice-meta h2 {
                        font-size: 24px;
                        color: #1f2937;
                        margin-bottom: 10px;
                        font-weight: 600;
                    }
                    .invoice-meta p {
                        font-size: 11px;
                        color: #4b5563;
                        margin: 4px 0;
                    }
                    .invoice-meta strong {
                        color: #1f2937;
                        font-weight: 600;
                    }
                    .invoice-details {
                        display: grid;
                        grid-template-columns: 1fr 1fr;
                        gap: 25px;
                        margin-bottom: 30px;
                    }
                    .detail-box {
                        background: #f9fafb;
                        padding: 15px;
                        border-radius: 8px;
                        border-left: 4px solid #2563eb;
                    }
                    .detail-box h3 {
                        font-size: 12px;
                        color: #6b7280;
                        text-transform: uppercase;
                        letter-spacing: 0.5px;
                        margin-bottom: 8px;
                        font-weight: 600;
                    }
                    .detail-box p {
                        font-size: 13px;
                        color: #1f2937;
                        margin: 4px 0;
                    }
                    .detail-box .customer-name {
                        font-size: 15px;
                        font-weight: 600;
                        color: #1f2937;
                        margin-bottom: 6px;
                    }
                    .status-badge {
                        display: inline-block;
                        padding: 4px 12px;
                        border-radius: 12px;
                        font-size: 11px;
                        font-weight: 600;
                        text-transform: uppercase;
                        letter-spacing: 0.5px;
                    }
                    .status-badge.completed { background: #d1fae5; color: #065f46; }
                    .status-badge.pending { background: #fef3c7; color: #92400e; }
                    .status-badge.cancelled { background: #fee2e2; color: #991b1b; }
                    .items-table {
                        width: 100%;
                        border-collapse: collapse;
                        margin: 25px 0;
                        font-size: 12px;
                    }
                    .items-table thead {
                        background: #f3f4f6;
                    }
                    .items-table th {
                        padding: 12px 10px;
                        text-align: left;
                        font-weight: 600;
                        color: #374151;
                        text-transform: uppercase;
                        font-size: 10px;
                        letter-spacing: 0.5px;
                        border-bottom: 2px solid #e5e7eb;
                    }
                    .items-table th:last-child,
                    .items-table td:last-child {
                        text-align: right;
                    }
                    .items-table td {
                        padding: 12px 10px;
                        border-bottom: 1px solid #e5e7eb;
                        color: #1f2937;
                    }
                    .items-table tbody tr:hover {
                        background: #f9fafb;
                    }
                    .items-table .item-name {
                        font-weight: 500;
                        color: #1f2937;
                    }
                    .items-table .item-sku {
                        color: #6b7280;
                        font-size: 11px;
                    }
                    .totals-section {
                        display: flex;
                        justify-content: flex-end;
                        margin-top: 20px;
                        margin-bottom: 30px;
                    }
                    .totals-box {
                        min-width: 300px;
                        background: #f9fafb;
                        padding: 20px;
                        border-radius: 8px;
                    }
                    .total-row {
                        display: flex;
                        justify-content: space-between;
                        padding: 8px 0;
                        font-size: 13px;
                        color: #4b5563;
                    }
                    .total-row.subtotal {
                        border-bottom: 1px solid #e5e7eb;
                    }
                    .total-row.grand-total {
                        border-top: 2px solid #2563eb;
                        padding-top: 12px;
                        margin-top: 8px;
                        font-size: 16px;
                        font-weight: 700;
                        color: #1f2937;
                    }
                    .total-row.grand-total .amount {
                        color: #2563eb;
                    }
                    .invoice-footer {
                        margin-top: 40px;
                        padding-top: 20px;
                        border-top: 2px solid #e5e7eb;
                    }
                    .footer-grid {
                        display: grid;
                        grid-template-columns: 1fr 1fr;
                        gap: 20px;
                        margin-bottom: 20px;
                    }
                    .footer-section h4 {
                        font-size: 11px;
                        color: #6b7280;
                        text-transform: uppercase;
                        letter-spacing: 0.5px;
                        margin-bottom: 8px;
                        font-weight: 600;
                    }
                    .footer-section p {
                        font-size: 12px;
                        color: #4b5563;
                        margin: 4px 0;
                    }
                    .footer-note {
                        background: #eff6ff;
                        padding: 15px;
                        border-radius: 8px;
                        border-left: 4px solid #2563eb;
                        margin-top: 20px;
                    }
                    .footer-note p {
                        font-size: 12px;
                        color: #1e40af;
                        text-align: center;
                        margin: 0;
                    }
                    @media print {
                        body { padding: 0; }
                        .no-print { display: none; }
                    }
                </style>
            </head>
            <body>
                <div class="invoice-header">
                    <div class="company-info" style="display:flex;align-items:center;gap:16px;">
                        ${brandManager.getLogoUrl() ? `<img src="${brandManager.getLogoUrl()}" alt="${brand.name}" style="height:64px;width:auto;max-width:120px;object-fit:contain;flex-shrink:0;" onerror="this.style.display='none'">` : ''}
                        <div>
                            <h1>${brand.name}</h1>
                            ${brand.tagline ? `<p>${brand.tagline}</p>` : ''}
                            ${brand.address ? `<p>${brand.address}</p>` : ''}
                            ${brand.phone ? `<p>Tel: ${brand.phone}</p>` : ''}
                            ${brand.email ? `<p>${brand.email}</p>` : ''}
                            ${brand.website ? `<p>${brand.website}</p>` : ''}
                            ${brand.taxId ? `<p>PIN: ${brand.taxId}</p>` : ''}
                        </div>
                    </div>
                    <div class="invoice-meta">
                        <h2>INVOICE</h2>
                        <p><strong>Invoice #:</strong> ${sale.saleNumber}</p>
                        <p><strong>Date:</strong> ${invoiceDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
                        <p><strong>Time:</strong> ${invoiceDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</p>
                        ${sale.creditTerm !== 'immediate' ? `<p><strong>Due Date:</strong> ${dueDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</p>` : ''}
                    </div>
                </div>

                <div class="invoice-details">
                    <div class="detail-box">
                        <h3>Bill To</h3>
                        <div class="customer-name">${sale.customer}</div>
                        ${sale.customerPhone ? `<p>Phone: ${sale.customerPhone}</p>` : ''}
                        ${sale.customerId ? `<p>Customer ID: ${sale.customerId.substring(0, 8)}</p>` : ''}
                    </div>
                    <div class="detail-box">
                        <h3>Invoice Details</h3>
                        <p><strong>Branch:</strong> ${sale.branchName || 'Main Branch'}</p>
                        <p><strong>Payment Method:</strong> ${this.formatPaymentMethod(sale.paymentMethod)}</p>
                        <p><strong>Terms:</strong> ${this.formatCreditTerm(sale.creditTerm)}</p>
                        <p><strong>Status:</strong> <span class="status-badge ${sale.status || 'completed'}">${(sale.status || 'completed').toUpperCase()}</span></p>
                    </div>
                </div>

                <table class="items-table">
                    <thead>
                        <tr>
                            <th style="width: 5%;">#</th>
                            <th style="width: 40%;">Item Description</th>
                            <th style="width: 15%;">SKU</th>
                            <th style="width: 13%;">Unit Price</th>
                            <th style="width: 10%;">Quantity</th>
                            <th style="width: 17%;">Amount</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${sale.items?.map((item, index) => `
                            <tr>
                                <td>${index + 1}</td>
                                <td>
                                    <div class="item-name">${item.name}</div>
                                    ${item.category ? `<div class="item-sku">${item.category}</div>` : ''}
                                </td>
                                <td>${item.sku || 'N/A'}</td>
                                <td>${this.formatCurrency(item.price)}</td>
                                <td>${item.quantity}</td>
                                <td>${this.formatCurrency(item.total)}</td>
                            </tr>
                        `).join('') || '<tr><td colspan="6" style="text-align: center; color: #9ca3af;">No items</td></tr>'}
                    </tbody>
                </table>

                <div class="totals-section">
                    <div class="totals-box">
                        <div class="total-row subtotal">
                            <span>Subtotal:</span>
                            <span>${this.formatCurrency(sale.subtotal || sale.total)}</span>
                        </div>
                        ${sale.discount > 0 ? `
                        <div class="total-row">
                            <span>Discount:</span>
                            <span>-${this.formatCurrency(sale.discount)}</span>
                        </div>
                        ` : ''}
                        <div class="total-row grand-total">
                            <span>Grand Total:</span>
                            <span class="amount">${this.formatCurrency(sale.total)}</span>
                        </div>
                    </div>
                </div>

                <div class="invoice-footer">
                    <div class="footer-grid">
                        <div class="footer-section">
                            <h4>Payment Information</h4>
                            <p><strong>Method:</strong> ${this.formatPaymentMethod(sale.paymentMethod)}</p>
                            <p><strong>Terms:</strong> ${this.formatCreditTerm(sale.creditTerm)}</p>
                            ${sale.creditTerm !== 'immediate' ? `<p><strong>Due Date:</strong> ${dueDate.toLocaleDateString('en-GB')}</p>` : ''}
                        </div>
                        <div class="footer-section">
                            <h4>Order Summary</h4>
                            <p><strong>Total Items:</strong> ${sale.items?.length || 0}</p>
                            <p><strong>Total Quantity:</strong> ${sale.items?.reduce((sum, item) => sum + item.quantity, 0) || 0}</p>
                            <p><strong>Created By:</strong> ${sale.createdBy || 'System'}</p>
                        </div>
                    </div>
                    <div class="footer-note">
                        <p>Thank you for your business! For questions about this invoice, please contact your branch.</p>
                    </div>
                </div>

                <script>
                    window.onload = function() {
                        window.print();
                    };
                    window.onafterprint = function() {
                        window.close();
                    };
                </script>
            </body>
            </html>
        `);
        printWindow.document.close();
    }

    // Calculate due date based on credit terms
    calculateDueDate(invoiceDate, creditTerm) {
        const date = new Date(invoiceDate);
        switch(creditTerm) {
            case 'net30':
                date.setDate(date.getDate() + 30);
                break;
            case 'net60':
                date.setDate(date.getDate() + 60);
                break;
            case 'net90':
                date.setDate(date.getDate() + 90);
                break;
            default:
                return date;
        }
        return date;
    }

    // Edit sale
    async editSale(saleId) {
        const sale = this.sales.find(s => s.id === saleId);
        if (!sale) return;

        // Load customers for the dropdown
        await this.loadCustomers();

        const modal = document.createElement('div');
        modal.className = 'pos-modal';
        modal.innerHTML = `
            <div class="pos-modal-overlay" onclick="this.parentElement.remove()"></div>
            <div class="pos-modal-content large-modal">
                <div class="pos-modal-header">
                    <h3>Edit B2B Order</h3>
                    <button class="modal-close" onclick="this.closest('.pos-modal').remove()">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
                <div class="pos-modal-body">
                    <div class="form-group">
                        <label>Order #: <strong>${sale.saleNumber}</strong></label>
                    </div>
                    
                    <div class="form-grid-2">
                        <div class="form-group">
                            <label for="editCustomer">Customer *</label>
                            <select id="editCustomer" class="form-input-clean" required>
                                <option value="">Select customer...</option>
                                ${this.customers.map(c => `
                                    <option value="${c.id}" ${sale.customerId === c.id ? 'selected' : ''}>
                                        ${c.name} - ${c.phone || 'N/A'}
                                    </option>
                                `).join('')}
                            </select>
                        </div>
                        
                        <div class="form-group">
                            <label for="editPaymentMethod">Payment Method *</label>
                            <select id="editPaymentMethod" class="form-input-clean" required>
                                <option value="cash" ${sale.paymentMethod === 'cash' ? 'selected' : ''}>Cash</option>
                                <option value="mpesa" ${sale.paymentMethod === 'mpesa' ? 'selected' : ''}>M-Pesa</option>
                                <option value="bank_transfer" ${sale.paymentMethod === 'bank_transfer' ? 'selected' : ''}>Bank Transfer</option>
                                <option value="cheque" ${sale.paymentMethod === 'cheque' ? 'selected' : ''}>Cheque</option>
                                <option value="credit" ${sale.paymentMethod === 'credit' ? 'selected' : ''}>Credit</option>
                            </select>
                        </div>
                    </div>
                    
                    <div class="form-grid-2">
                        <div class="form-group">
                            <label for="editCreditTerm">Credit Terms</label>
                            <select id="editCreditTerm" class="form-input-clean">
                                <option value="immediate" ${sale.creditTerm === 'immediate' ? 'selected' : ''}>Immediate</option>
                                <option value="net30" ${sale.creditTerm === 'net30' ? 'selected' : ''}>Net 30</option>
                                <option value="net60" ${sale.creditTerm === 'net60' ? 'selected' : ''}>Net 60</option>
                                <option value="net90" ${sale.creditTerm === 'net90' ? 'selected' : ''}>Net 90</option>
                            </select>
                        </div>
                        
                        <div class="form-group">
                            <label for="editStatus">Status *</label>
                            <select id="editStatus" class="form-input-clean" required>
                                <option value="pending" ${sale.status === 'pending' ? 'selected' : ''}>Pending</option>
                                <option value="completed" ${sale.status === 'completed' ? 'selected' : ''}>Completed</option>
                                <option value="cancelled" ${sale.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
                            </select>
                        </div>
                    </div>
                    
                    <div class="form-group">
                        <label>Order Items</label>
                        <div style="max-height: 200px; overflow-y: auto; border: 1px solid var(--border-color); border-radius: 8px; padding: 1rem;">
                            ${sale.items?.map((item, idx) => `
                                <div style="display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid var(--border-color);">
                                    <span><strong>${item.name}</strong> (${item.sku || 'N/A'})</span>
                                    <span>Qty: ${item.quantity} × ${this.formatCurrency(item.price)} = <strong>${this.formatCurrency(item.total)}</strong></span>
                                </div>
                            `).join('') || '<p>No items</p>'}
                        </div>
                    </div>
                    
                    <div class="form-group">
                        <div style="display: flex; justify-content: space-between; padding: 1rem; background: var(--bg-secondary); border-radius: 8px;">
                            <strong>Grand Total:</strong>
                            <strong style="font-size: 1.25rem; color: var(--primary-blue);">${this.formatCurrency(sale.total)}</strong>
                        </div>
                    </div>
                </div>
                <div class="pos-modal-footer">
                    <button onclick="this.closest('.pos-modal').remove()" class="btn btn-secondary">Cancel</button>
                    <button onclick="window.b2bSalesManager.saveSaleEdit('${sale.id}')" class="btn btn-primary">Save Changes</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        setTimeout(() => modal.classList.add('show'), 10);
    }

    // Save sale edits
    async saveSaleEdit(saleId) {
        const customerSelect = document.getElementById('editCustomer');
        const paymentMethodSelect = document.getElementById('editPaymentMethod');
        const creditTermSelect = document.getElementById('editCreditTerm');
        const statusSelect = document.getElementById('editStatus');

        if (!customerSelect || !paymentMethodSelect || !statusSelect) return;

        const customerId = customerSelect.value;
        const customer = this.customers.find(c => c.id === customerId);

        if (!customer) {
            this.showNotification('Please select a customer', 'error');
            return;
        }

        const updates = {
            customerId: customer.id,
            customer: customer.name,
            customerPhone: customer.phone || '',
            paymentMethod: paymentMethodSelect.value,
            creditTerm: creditTermSelect.value,
            status: statusSelect.value,
            updatedAt: new Date().toISOString()
        };

        try {
            await dataManager.updateSale(saleId, updates);
            await this.loadB2BSales();
            this.renderStats();
            this.renderSalesTable();
            
            // Refresh dashboard stats
            if (window.refreshDashboardStats) {
                await window.refreshDashboardStats();
            }
            
            // Refresh account stats
            if (window.refreshAccountStats) {
                await window.refreshAccountStats();
            }
            
            // Close modal
            document.querySelector('.pos-modal')?.remove();
            
            this.showNotification('Order updated successfully', 'success');
        } catch (error) {
            console.error('Error updating sale:', error);
            this.showNotification('Error updating order', 'error');
        }
    }

    // Update sale
    updateSale(saleId) {
        const sale = this.sales.find(s => s.id === saleId);
        if (!sale) return;

        const modal = document.createElement('div');
        modal.className = 'pos-modal';
        modal.innerHTML = `
            <div class="pos-modal-overlay" onclick="this.parentElement.remove()"></div>
            <div class="pos-modal-content">
                <div class="pos-modal-header">
                    <h3>Update Order Status</h3>
                    <button class="modal-close" onclick="this.closest('.pos-modal').remove()">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
                <div class="pos-modal-body">
                    <div class="form-group">
                        <label>Order #: <strong>${sale.saleNumber}</strong></label>
                    </div>
                    <div class="form-group">
                        <label>Customer: <strong>${sale.customer}</strong></label>
                    </div>
                    <div class="form-group">
                        <label>Current Status: <span class="status-badge ${sale.status === 'completed' ? 'success' : sale.status === 'pending' ? 'warning' : 'danger'}">${sale.status}</span></label>
                    </div>
                    <div class="form-group">
                        <label for="updateStatus">Update Status *</label>
                        <select id="updateStatus" class="form-input-clean" required>
                            <option value="pending" ${sale.status === 'pending' ? 'selected' : ''}>Pending</option>
                            <option value="completed" ${sale.status === 'completed' ? 'selected' : ''}>Completed</option>
                            <option value="cancelled" ${sale.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
                        </select>
                    </div>
                </div>
                <div class="pos-modal-footer">
                    <button onclick="this.closest('.pos-modal').remove()" class="btn btn-secondary">Cancel</button>
                    <button onclick="window.b2bSalesManager.saveStatusUpdate('${sale.id}')" class="btn btn-primary">Update Status</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        setTimeout(() => modal.classList.add('show'), 10);
    }

    // Save status update
    async saveStatusUpdate(saleId) {
        const statusSelect = document.getElementById('updateStatus');
        if (!statusSelect) return;

        const newStatus = statusSelect.value;

        try {
            await dataManager.updateSale(saleId, { status: newStatus });
            await this.loadB2BSales();
            this.renderStats();
            this.renderSalesTable();
            
            // Refresh dashboard stats
            if (window.refreshDashboardStats) {
                await window.refreshDashboardStats();
            }
            
            // Refresh account stats
            if (window.refreshAccountStats) {
                await window.refreshAccountStats();
            }
            
            // Close modal
            document.querySelector('.pos-modal')?.remove();
            
            this.showNotification(`Order status updated to ${newStatus}`, 'success');
        } catch (error) {
            console.error('Error updating sale status:', error);
            this.showNotification('Error updating order status', 'error');
        }
    }

    // Mark sale as completed
    async markAsCompleted(saleId) {
        const ok = await window.uiConfirm?.({
            title: 'Mark as completed?',
            message: 'This will mark the order as completed.',
            tone: 'success',
            okLabel: 'Mark completed'
        });
        if (!ok) return;

        try {
            await dataManager.updateSale(saleId, { status: 'completed' });
            await this.loadB2BSales();
            this.renderStats();
            this.renderSalesTable();
            
            // Refresh dashboard stats to update pending B2B count
            if (window.refreshDashboardStats) {
                await window.refreshDashboardStats();
            }
            
            // Refresh account stats
            if (window.refreshAccountStats) {
                await window.refreshAccountStats();
            }
            
            this.showNotification('Order marked as completed', 'success');
        } catch (error) {
            console.error('Error updating sale:', error);
            this.showNotification('Error updating order', 'error');
        }
    }

    // Export to Excel
    exportToExcel() {
        const data = this.filteredSales.map(sale => ({
            'Invoice #': sale.saleNumber || 'N/A',
            'Date': new Date(sale.createdAt).toLocaleString(),
            'Customer': sale.customer || 'N/A',
            'Phone': sale.customerPhone || 'N/A',
            'Items': sale.items?.length || 0,
            'Amount': sale.total || 0,
            'Payment Method': this.formatPaymentMethod(sale.paymentMethod),
            'Credit Terms': this.formatCreditTerm(sale.creditTerm),
            'Status': sale.status || 'N/A',
            'Branch': sale.branchName || 'N/A'
        }));

        const csv = [
            Object.keys(data[0]).join(','),
            ...data.map(row => Object.values(row).map(val => `"${val}"`).join(','))
        ].join('\n');

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `b2b-sales-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        this.showNotification('Exported to Excel', 'success');
    }

    // Export to PDF
    exportToPDF() {
        const printWindow = window.open('', '', 'height=800,width=800');
        printWindow.document.write(`
            <html>
            <head>
                <title>B2B Sales Report</title>
                <style>
                    body { font-family: Arial, sans-serif; padding: 20px; }
                    h1 { color: #333; text-align: center; }
                    table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 12px; }
                    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                    th { background: #667eea; color: white; }
                    .header { text-align: center; margin-bottom: 20px; }
                </style>
            </head>
            <body>
                <div class="header">
                    ${brandManager.getLogoHTML({ maxWidth: 80, maxHeight: 80, marginBottom: 6, alt: brandManager.name() })}
                    <div style="font-size:18px;font-weight:700;color:#1f2937;margin-bottom:4px;">${brandManager.name()}</div>
                    <h1>B2B / Wholesale Sales Report</h1>
                    <p>Generated on ${new Date().toLocaleString()}</p>
                    <p>Total Sales: ${this.formatCurrency(this.filteredSales.reduce((sum, s) => sum + s.total, 0))}</p>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th>Invoice #</th>
                            <th>Date</th>
                            <th>Customer</th>
                            <th>Items</th>
                            <th>Amount</th>
                            <th>Payment</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${this.filteredSales.map(sale => `
                            <tr>
                                <td>${sale.saleNumber || 'N/A'}</td>
                                <td>${new Date(sale.createdAt).toLocaleDateString()}</td>
                                <td>${sale.customer || 'N/A'}</td>
                                <td>${sale.items?.length || 0}</td>
                                <td>${this.formatCurrency(sale.total)}</td>
                                <td>${this.formatPaymentMethod(sale.paymentMethod)}</td>
                                <td>${sale.status || 'N/A'}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
                <script>window.print(); window.onafterprint = function(){ window.close(); }</script>
            </body>
            </html>
        `);
        printWindow.document.close();
    }

    // Render inventory grid (kept for backward compatibility but not used)
    renderInventoryGrid() {
        const container = document.getElementById('b2bInventoryGrid');
        if (!container) return;

        if (this.inventory.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                    </svg>
                    <h3>No Inventory Items</h3>
                    <p>Add products to your inventory to start selling wholesale</p>
                    <button class="btn btn-primary" onclick="document.querySelector('[data-page=\\'add-item\\']').click()">
                        Add Products
                    </button>
                </div>
            `;
            return;
        }

        // Filter inventory based on search
        let displayInventory = this.inventory;
        if (this.filters.search) {
            displayInventory = this.inventory.filter(item => 
                item.name?.toLowerCase().includes(this.filters.search) ||
                item.sku?.toLowerCase().includes(this.filters.search) ||
                item.category?.toLowerCase().includes(this.filters.search)
            );
        }

        container.innerHTML = displayInventory.map(item => this.renderInventoryCard(item)).join('');
    }

    // Render individual inventory card
    renderInventoryCard(item) {
        const stockStatus = item.quantity <= item.reorderLevel ? 'low' : 
                          item.quantity === 0 ? 'out' : 'in-stock';
        const stockClass = stockStatus === 'out' ? 'danger' : 
                          stockStatus === 'low' ? 'warning' : 'success';

        // Calculate wholesale price (typically 10-20% less than retail)
        const wholesalePrice = item.price * 0.85; // 15% discount for wholesale
        const minOrderQty = 10; // Minimum order quantity for wholesale

        return `
            <div class="b2b-product-card" data-item-id="${item.id}">
                <div class="product-card-header">
                    <span class="product-sku">${item.sku || 'N/A'}</span>
                    <span class="stock-badge ${stockClass}">${item.quantity || 0} in stock</span>
                </div>
                <div class="product-card-body">
                    <h4 class="product-name">${item.name}</h4>
                    <p class="product-category">${item.category || 'Uncategorized'}</p>
                    <div class="product-pricing">
                        <div class="price-row">
                            <span class="price-label">Retail:</span>
                            <span class="price-value retail">${this.formatCurrency(item.price)}</span>
                        </div>
                        <div class="price-row">
                            <span class="price-label">Wholesale:</span>
                            <span class="price-value wholesale">${this.formatCurrency(wholesalePrice)}</span>
                        </div>
                        <div class="min-order">
                            Min. Order: ${minOrderQty} units
                        </div>
                    </div>
                </div>
                <div class="product-card-footer">
                    <button class="btn-quick-add" onclick="window.b2bSalesManager.quickAddToWholesale('${item.id}')">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="9" cy="21" r="1"></circle>
                            <circle cx="20" cy="21" r="1"></circle>
                            <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
                        </svg>
                        Add to Order
                    </button>
                </div>
            </div>
        `;
    }

    // Quick add to wholesale order
    quickAddToWholesale(itemId) {
        // Store item in session for new wholesale sale
        sessionStorage.setItem('quickAddItemId', itemId);
        this.navigateToNewB2BSale();
    }

    // Navigate to retail POS
    navigateToRetailPOS() {
        const posLink = document.querySelector('[data-page="pos"]');
        if (posLink) {
            posLink.click();
        }
    }

    // Navigate to new B2B sale
    navigateToNewB2BSale() {
        const b2bLink = document.querySelector('[data-page="new-b2b-sale"]');
        if (b2bLink) {
            b2bLink.click();
        }
    }

    // Delete sale
    async deleteSale(saleId) {
        const sale = this.sales.find(s => s.id === saleId);
        if (!sale) return;

        // Confirmation dialog
        const confirmed = await window.uiConfirm?.({
            title: 'Delete B2B sale?',
            message:
                `Invoice: ${sale.saleNumber}\n` +
                `Customer: ${sale.customer || 'Walk-in'}\n` +
                `Amount: KES ${this.formatCurrency(sale.total)}\n\n` +
                `This action cannot be undone.`,
            tone: 'danger',
            okLabel: 'Delete'
        });

        if (!confirmed) return;

        try {
            // Delete from database
            await dataManager.deleteSale(saleId);
            
            this.showNotification('B2B sale deleted successfully', 'success');
            
            // Reload sales
            await this.loadB2BSales();
            this.renderStats();
            this.renderSalesTable();
        } catch (error) {
            console.error('Error deleting sale:', error);
            this.showNotification('Failed to delete sale: ' + error.message, 'error');
        }
    }

    // Format currency
    formatCurrency(amount) {
        return new Intl.NumberFormat('en-KE', {
            style: 'currency',
            currency: 'KES',
            minimumFractionDigits: 0,
            maximumFractionDigits: 2
        }).format(amount || 0);
    }

    // Show notification
    showNotification(message, type = 'success') {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        document.body.appendChild(notification);

        setTimeout(() => {
            notification.classList.add('show');
        }, 100);

        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }
}

// Create and export instance
const b2bSalesManager = new B2BSalesManager();
export default b2bSalesManager;

// Make available globally
window.b2bSalesManager = b2bSalesManager;
