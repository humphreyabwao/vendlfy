// B2B Sales Module - Wholesale Sales Management
import dataManager from './data-manager.js';
import branchManager from './branch-manager.js';

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
                this.applyFilters();
            });
        });

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
    }

    // Start real-time sync for sales updates
    startRealtimeSync() {
        // Refresh sales every 30 seconds
        setInterval(async () => {
            await this.loadB2BSales();
            this.renderStats();
            this.renderSalesTable();
        }, 30000);
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

        if (this.filteredSales.length === 0) {
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
            return;
        }

        tbody.innerHTML = this.filteredSales.map(sale => this.renderSaleRow(sale)).join('');
    }

    // Render individual sale row
    renderSaleRow(sale) {
        const date = new Date(sale.createdAt);
        const statusClass = sale.status === 'completed' ? 'success' : 
                           sale.status === 'pending' ? 'warning' : 'danger';
        const statusText = sale.status ? sale.status.charAt(0).toUpperCase() + sale.status.slice(1) : 'N/A';

        return `
            <tr>
                <td><strong>${sale.saleNumber || 'N/A'}</strong></td>
                <td>${date.toLocaleDateString()} ${date.toLocaleTimeString()}</td>
                <td>${sale.customer || 'Walk-in'}</td>
                <td>${sale.customerPhone || 'N/A'}</td>
                <td>${sale.items?.length || 0} items</td>
                <td><strong>${this.formatCurrency(sale.total)}</strong></td>
                <td>
                    <span class="payment-badge">${this.formatPaymentMethod(sale.paymentMethod)}</span>
                </td>
                <td>
                    <span class="credit-badge">${this.formatCreditTerm(sale.creditTerm)}</span>
                </td>
                <td>
                    <span class="status-badge ${statusClass}">${statusText}</span>
                </td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-icon" onclick="window.b2bSalesManager.viewSaleDetails('${sale.id}')" title="View Details">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                <circle cx="12" cy="12" r="3"></circle>
                            </svg>
                        </button>
                        <button class="btn-icon" onclick="window.b2bSalesManager.printInvoice('${sale.id}')" title="Print Invoice">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="6 9 6 2 18 2 18 9"></polyline>
                                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                                <rect x="6" y="14" width="12" height="8"></rect>
                            </svg>
                        </button>
                        ${sale.status === 'pending' ? `
                            <button class="btn-icon success" onclick="window.b2bSalesManager.markAsCompleted('${sale.id}')" title="Mark as Completed">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <polyline points="20 6 9 17 4 12"></polyline>
                                </svg>
                            </button>
                        ` : ''}
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

        const printWindow = window.open('', '', 'height=800,width=600');
        printWindow.document.write(`
            <html>
            <head>
                <title>Invoice ${sale.saleNumber}</title>
                <style>
                    body { font-family: Arial, sans-serif; padding: 20px; }
                    h1 { text-align: center; color: #333; }
                    .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #333; padding-bottom: 20px; }
                    .info { margin: 20px 0; }
                    .info-row { display: flex; justify-content: space-between; margin: 5px 0; }
                    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
                    th, td { border: 1px solid #ddd; padding: 10px; text-align: left; }
                    th { background: #f4f4f4; font-weight: bold; }
                    .totals { text-align: right; margin-top: 20px; }
                    .totals div { margin: 10px 0; }
                    .grand-total { font-size: 1.5em; font-weight: bold; color: #667eea; }
                </style>
            </head>
            <body>
                <div class="header">
                    <h1>WHOLESALE INVOICE</h1>
                    <p><strong>Invoice #:</strong> ${sale.saleNumber}</p>
                    <p>${new Date(sale.createdAt).toLocaleString()}</p>
                </div>
                <div class="info">
                    <div class="info-row"><strong>Customer:</strong> ${sale.customer}</div>
                    <div class="info-row"><strong>Phone:</strong> ${sale.customerPhone || 'N/A'}</div>
                    <div class="info-row"><strong>Branch:</strong> ${sale.branchName || 'N/A'}</div>
                    <div class="info-row"><strong>Payment:</strong> ${this.formatPaymentMethod(sale.paymentMethod)}</div>
                    <div class="info-row"><strong>Terms:</strong> ${this.formatCreditTerm(sale.creditTerm)}</div>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th>Item</th>
                            <th>SKU</th>
                            <th>Price</th>
                            <th>Qty</th>
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
                                <td>${this.formatCurrency(item.total)}</td>
                            </tr>
                        `).join('') || ''}
                    </tbody>
                </table>
                <div class="totals">
                    <div>Subtotal: ${this.formatCurrency(sale.subtotal || sale.total)}</div>
                    ${sale.discount ? `<div>Discount: -${this.formatCurrency(sale.discount)}</div>` : ''}
                    <div class="grand-total">Grand Total: ${this.formatCurrency(sale.total)}</div>
                </div>
                <script>window.print(); window.onafterprint = function(){ window.close(); }</script>
            </body>
            </html>
        `);
        printWindow.document.close();
    }

    // Mark sale as completed
    async markAsCompleted(saleId) {
        if (!confirm('Mark this order as completed?')) return;

        try {
            await dataManager.updateSale(saleId, { status: 'completed' });
            await this.loadB2BSales();
            this.renderStats();
            this.renderSalesTable();
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
