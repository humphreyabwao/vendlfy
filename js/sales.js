// Sales Management Module - View All Sales
import dataManager from './data-manager.js';
import branchManager from './branch-manager.js';

class SalesManager {
    constructor() {
        this.sales = [];
        this.filteredSales = [];
        this.filters = {
            dateRange: 'today',
            startDate: null,
            endDate: null,
            search: ''
        };
    }

    async init() {
        console.log('📊 Initializing Sales Manager...');
        await this.loadSales();
        this.renderSales();
        this.attachEventListeners();
        console.log('✅ Sales Manager ready');
    }

    // Load sales from database
    async loadSales() {
        try {
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            let filters = {};

            // Apply date range filter
            switch (this.filters.dateRange) {
                case 'today':
                    filters.startDate = today.toISOString();
                    break;
                case 'yesterday':
                    const yesterday = new Date(today);
                    yesterday.setDate(yesterday.getDate() - 1);
                    filters.startDate = yesterday.toISOString();
                    filters.endDate = today.toISOString();
                    break;
                case 'week':
                    const weekAgo = new Date(today);
                    weekAgo.setDate(weekAgo.getDate() - 7);
                    filters.startDate = weekAgo.toISOString();
                    break;
                case 'month':
                    const monthAgo = new Date(today);
                    monthAgo.setMonth(monthAgo.getMonth() - 1);
                    filters.startDate = monthAgo.toISOString();
                    break;
                case 'custom':
                    if (this.filters.startDate) {
                        filters.startDate = this.filters.startDate;
                    }
                    if (this.filters.endDate) {
                        filters.endDate = this.filters.endDate;
                    }
                    break;
            }

            this.sales = await dataManager.getSales(filters);
            this.filteredSales = [...this.sales];
            
            console.log(`📦 Loaded ${this.sales.length} sales`);
        } catch (error) {
            console.error('Error loading sales:', error);
            this.sales = [];
            this.filteredSales = [];
        }
    }

    // Render sales table
    renderSales() {
        const container = document.getElementById('salesTableContainer');
        if (!container) return;

        if (this.filteredSales.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                        <polyline points="14 2 14 8 20 8"></polyline>
                        <line x1="16" y1="13" x2="8" y2="13"></line>
                        <line x1="16" y1="17" x2="8" y2="17"></line>
                    </svg>
                    <h3>No Sales Found</h3>
                    <p>No sales transactions for the selected period</p>
                </div>
            `;
            return;
        }

        const tableHTML = `
            <div class="sales-summary-cards">
                <div class="summary-card">
                    <div class="summary-label">Total Sales</div>
                    <div class="summary-value">${this.filteredSales.length}</div>
                </div>
                <div class="summary-card">
                    <div class="summary-label">Total Revenue</div>
                    <div class="summary-value">KES ${this.formatCurrency(this.getTotalRevenue())}</div>
                </div>
                <div class="summary-card">
                    <div class="summary-label">Total Profit</div>
                    <div class="summary-value">KES ${this.formatCurrency(this.getTotalProfit())}</div>
                </div>
                <div class="summary-card">
                    <div class="summary-label">Items Sold</div>
                    <div class="summary-value">${this.getTotalItems()}</div>
                </div>
            </div>
            
            <div class="table-container">
                <table class="sales-table">
                    <thead>
                        <tr>
                            <th>Sale ID</th>
                            <th>Date & Time</th>
                            <th>Items</th>
                            <th>Subtotal</th>
                            <th>Discount</th>
                            <th>Tax</th>
                            <th>Total</th>
                            <th>Profit</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${this.filteredSales.map(sale => this.renderSaleRow(sale)).join('')}
                    </tbody>
                </table>
            </div>
        `;

        container.innerHTML = tableHTML;
    }

    // Render individual sale row
    renderSaleRow(sale) {
        const date = new Date(sale.createdAt);
        const formattedDate = date.toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric', 
            year: 'numeric' 
        });
        const formattedTime = date.toLocaleTimeString('en-US', { 
            hour: '2-digit', 
            minute: '2-digit' 
        });

        const itemCount = sale.items ? sale.items.length : 0;
        const statusClass = sale.status === 'completed' ? 'status-completed' : 'status-pending';

        return `
            <tr>
                <td><span class="sale-id">#${sale.id.substring(0, 8).toUpperCase()}</span></td>
                <td>
                    <div class="date-time">
                        <div>${formattedDate}</div>
                        <small>${formattedTime}</small>
                    </div>
                </td>
                <td>${itemCount} item${itemCount !== 1 ? 's' : ''}</td>
                <td>KES ${this.formatCurrency(sale.subtotal || 0)}</td>
                <td>${sale.discount ? '-KES ' + this.formatCurrency(sale.discount) : '-'}</td>
                <td>${sale.tax ? '+KES ' + this.formatCurrency(sale.tax) : '-'}</td>
                <td><strong>KES ${this.formatCurrency(sale.total || 0)}</strong></td>
                <td class="profit-cell">KES ${this.formatCurrency(sale.profit || 0)}</td>
                <td><span class="status-badge ${statusClass}">${sale.status || 'completed'}</span></td>
                <td>
                    <div class="action-buttons-inline">
                        <button class="btn-icon-sm" onclick="salesManager.viewSaleDetails('${sale.id}')" title="View Details">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                <circle cx="12" cy="12" r="3"></circle>
                            </svg>
                        </button>
                        <button class="btn-icon-sm" onclick="salesManager.printReceipt('${sale.id}')" title="Print Receipt">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
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

    // View sale details
    viewSaleDetails(saleId) {
        const sale = this.sales.find(s => s.id === saleId);
        if (!sale) return;

        const modal = document.createElement('div');
        modal.className = 'pos-modal';
        
        const itemsHTML = sale.items ? sale.items.map(item => `
            <tr>
                <td>${item.name}</td>
                <td>${item.quantity}</td>
                <td>KES ${this.formatCurrency(item.price)}</td>
                <td>KES ${this.formatCurrency(item.total)}</td>
            </tr>
        `).join('') : '';

        modal.innerHTML = `
            <div class="pos-modal-content">
                <div class="pos-modal-header">
                    <h3>Sale Details - #${saleId.substring(0, 8).toUpperCase()}</h3>
                    <button class="pos-modal-close" onclick="this.closest('.pos-modal').remove()">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
                <div class="pos-modal-body">
                    <div class="sale-details-info">
                        <div class="info-row">
                            <span class="info-label">Date:</span>
                            <span>${new Date(sale.createdAt).toLocaleString()}</span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">Status:</span>
                            <span class="status-badge status-${sale.status}">${sale.status}</span>
                        </div>
                        ${sale.branchName ? `
                        <div class="info-row">
                            <span class="info-label">Branch:</span>
                            <span>${sale.branchName}</span>
                        </div>
                        ` : ''}
                    </div>
                    
                    <h4 style="margin: 20px 0 10px 0;">Items</h4>
                    <table class="receipt-table">
                        <thead>
                            <tr>
                                <th>Item</th>
                                <th>Qty</th>
                                <th>Price</th>
                                <th>Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${itemsHTML}
                        </tbody>
                    </table>
                    
                    <div class="receipt-totals" style="margin-top: 20px;">
                        <div class="receipt-row">
                            <span>Subtotal:</span>
                            <span>KES ${this.formatCurrency(sale.subtotal)}</span>
                        </div>
                        ${sale.discount > 0 ? `
                        <div class="receipt-row">
                            <span>Discount:</span>
                            <span>-KES ${this.formatCurrency(sale.discount)}</span>
                        </div>
                        ` : ''}
                        ${sale.tax > 0 ? `
                        <div class="receipt-row">
                            <span>Tax:</span>
                            <span>+KES ${this.formatCurrency(sale.tax)}</span>
                        </div>
                        ` : ''}
                        <div class="receipt-row receipt-total">
                            <span>Total:</span>
                            <span>KES ${this.formatCurrency(sale.total)}</span>
                        </div>
                        <div class="receipt-row">
                            <span>Profit:</span>
                            <span>KES ${this.formatCurrency(sale.profit)}</span>
                        </div>
                    </div>
                </div>
                <div class="pos-modal-footer">
                    <button class="btn-secondary" onclick="this.closest('.pos-modal').remove()">Close</button>
                    <button class="btn-primary" onclick="salesManager.printReceipt('${saleId}')">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="6 9 6 2 18 2 18 9"></polyline>
                            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                            <rect x="6" y="14" width="12" height="8"></rect>
                        </svg>
                        Print Receipt
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
    }

    // Print receipt
    printReceipt(saleId) {
        const sale = this.sales.find(s => s.id === saleId);
        if (!sale) return;

        // Use the POS system's receipt dialog if available
        if (window.posSystem && typeof window.posSystem.showReceiptDialog === 'function') {
            window.posSystem.showReceiptDialog(sale);
        } else {
            window.print();
        }
    }

    // Calculate totals
    getTotalRevenue() {
        return this.filteredSales.reduce((sum, sale) => sum + (sale.total || 0), 0);
    }

    getTotalProfit() {
        return this.filteredSales.reduce((sum, sale) => sum + (sale.profit || 0), 0);
    }

    getTotalItems() {
        return this.filteredSales.reduce((sum, sale) => {
            return sum + (sale.items ? sale.items.reduce((itemSum, item) => itemSum + item.quantity, 0) : 0);
        }, 0);
    }

    // Attach event listeners
    attachEventListeners() {
        // Date range filter
        const dateRangeSelect = document.getElementById('salesDateRange');
        if (dateRangeSelect) {
            dateRangeSelect.addEventListener('change', async (e) => {
                this.filters.dateRange = e.target.value;
                await this.loadSales();
                this.renderSales();
            });
        }

        // Refresh button
        const refreshBtn = document.getElementById('refreshSalesBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', async () => {
                await this.loadSales();
                this.renderSales();
                this.showNotification('Sales refreshed', 'success');
            });
        }

        // Export to Excel button
        const exportExcelBtn = document.getElementById('exportExcelBtn');
        if (exportExcelBtn) {
            exportExcelBtn.addEventListener('click', () => {
                this.exportToExcel();
            });
        }

        // Export to PDF button
        const exportPdfBtn = document.getElementById('exportPdfBtn');
        if (exportPdfBtn) {
            exportPdfBtn.addEventListener('click', () => {
                this.exportToPDF();
            });
        }
    }

    // Export to Excel (CSV format)
    exportToExcel() {
        if (this.filteredSales.length === 0) {
            this.showNotification('No sales data to export', 'error');
            return;
        }

        try {
            // Get date range label
            const dateRangeSelect = document.getElementById('salesDateRange');
            const dateRangeLabel = dateRangeSelect?.options[dateRangeSelect.selectedIndex]?.text || 'All';

            // Create CSV content
            let csv = 'Sale ID,Date,Time,Items,Subtotal,Discount,Tax,Total,Profit,Payment Method,Status\n';

            this.filteredSales.forEach(sale => {
                const date = new Date(sale.createdAt);
                const dateStr = date.toLocaleDateString();
                const timeStr = date.toLocaleTimeString();
                const itemsCount = sale.items?.length || 0;
                const subtotal = sale.subtotal || 0;
                const discount = sale.discount || 0;
                const tax = sale.tax || 0;
                const total = sale.total || 0;
                const profit = sale.profit || 0;
                const paymentMethod = sale.paymentMethod || 'cash';
                const status = sale.status || 'completed';

                csv += `${sale.id},"${dateStr}","${timeStr}",${itemsCount},${subtotal},${discount},${tax},${total},${profit},"${paymentMethod}","${status}"\n`;
            });

            // Create download link
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            const url = URL.createObjectURL(blob);
            
            const filename = `sales_${dateRangeLabel.toLowerCase().replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`;
            
            link.setAttribute('href', url);
            link.setAttribute('download', filename);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            this.showNotification(`Exported ${this.filteredSales.length} sales to Excel`, 'success');
            console.log('✅ Sales exported to Excel:', filename);
        } catch (error) {
            console.error('❌ Error exporting to Excel:', error);
            this.showNotification('Error exporting to Excel', 'error');
        }
    }

    // Export to PDF
    exportToPDF() {
        if (this.filteredSales.length === 0) {
            this.showNotification('No sales data to export', 'error');
            return;
        }

        try {
            // Get date range label
            const dateRangeSelect = document.getElementById('salesDateRange');
            const dateRangeLabel = dateRangeSelect?.options[dateRangeSelect.selectedIndex]?.text || 'All Time';
            const currentBranch = branchManager.getCurrentBranch();
            const branchName = currentBranch?.name || 'All Branches';

            // Calculate totals
            const totalRevenue = this.filteredSales.reduce((sum, sale) => sum + (sale.total || 0), 0);
            const totalProfit = this.filteredSales.reduce((sum, sale) => sum + (sale.profit || 0), 0);
            const totalDiscount = this.filteredSales.reduce((sum, sale) => sum + (sale.discount || 0), 0);
            const totalTax = this.filteredSales.reduce((sum, sale) => sum + (sale.tax || 0), 0);

            // Create PDF content (HTML that will be printed)
            const printWindow = window.open('', '', 'width=800,height=600');
            printWindow.document.write(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Sales Report - ${dateRangeLabel}</title>
                    <style>
                        * { margin: 0; padding: 0; box-sizing: border-box; }
                        body { 
                            font-family: Arial, sans-serif; 
                            padding: 20px;
                            color: #333;
                        }
                        .header { 
                            text-align: center; 
                            margin-bottom: 30px;
                            border-bottom: 3px solid #667eea;
                            padding-bottom: 15px;
                        }
                        .header h1 { 
                            font-size: 24px; 
                            color: #667eea;
                            margin-bottom: 5px;
                        }
                        .header p { 
                            font-size: 12px; 
                            color: #666;
                            margin: 3px 0;
                        }
                        .summary {
                            display: grid;
                            grid-template-columns: repeat(4, 1fr);
                            gap: 15px;
                            margin-bottom: 25px;
                        }
                        .summary-card {
                            background: #f8f9fa;
                            padding: 12px;
                            border-radius: 6px;
                            border-left: 3px solid #667eea;
                        }
                        .summary-card h3 {
                            font-size: 11px;
                            color: #666;
                            text-transform: uppercase;
                            margin-bottom: 5px;
                        }
                        .summary-card p {
                            font-size: 18px;
                            font-weight: bold;
                            color: #333;
                        }
                        table { 
                            width: 100%; 
                            border-collapse: collapse;
                            margin-top: 10px;
                            font-size: 11px;
                        }
                        th, td { 
                            padding: 10px 8px; 
                            text-align: left; 
                            border-bottom: 1px solid #ddd;
                        }
                        th { 
                            background: #667eea; 
                            color: white;
                            font-weight: 600;
                            text-transform: uppercase;
                            font-size: 10px;
                            letter-spacing: 0.5px;
                        }
                        tr:hover { background: #f8f9fa; }
                        .text-right { text-align: right; }
                        .text-center { text-align: center; }
                        .footer {
                            margin-top: 30px;
                            padding-top: 15px;
                            border-top: 2px solid #ddd;
                            text-align: center;
                            font-size: 10px;
                            color: #666;
                        }
                        @media print {
                            body { padding: 0; }
                            .summary { page-break-inside: avoid; }
                            table { page-break-inside: auto; }
                            tr { page-break-inside: avoid; page-break-after: auto; }
                        }
                    </style>
                </head>
                <body>
                    <div class="header">
                        <h1>SALES REPORT</h1>
                        <p><strong>Period:</strong> ${dateRangeLabel}</p>
                        <p><strong>Branch:</strong> ${branchName}</p>
                        <p><strong>Generated:</strong> ${new Date().toLocaleString()}</p>
                        <p><strong>Total Transactions:</strong> ${this.filteredSales.length}</p>
                    </div>

                    <div class="summary">
                        <div class="summary-card">
                            <h3>Total Revenue</h3>
                            <p>KES ${this.formatCurrency(totalRevenue)}</p>
                        </div>
                        <div class="summary-card">
                            <h3>Total Profit</h3>
                            <p>KES ${this.formatCurrency(totalProfit)}</p>
                        </div>
                        <div class="summary-card">
                            <h3>Total Discount</h3>
                            <p>KES ${this.formatCurrency(totalDiscount)}</p>
                        </div>
                        <div class="summary-card">
                            <h3>Total Tax</h3>
                            <p>KES ${this.formatCurrency(totalTax)}</p>
                        </div>
                    </div>

                    <table>
                        <thead>
                            <tr>
                                <th>Date & Time</th>
                                <th class="text-center">Items</th>
                                <th class="text-right">Subtotal</th>
                                <th class="text-right">Discount</th>
                                <th class="text-right">Tax</th>
                                <th class="text-right">Total</th>
                                <th class="text-right">Profit</th>
                                <th class="text-center">Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${this.filteredSales.map(sale => {
                                const date = new Date(sale.createdAt);
                                return `
                                    <tr>
                                        <td>${date.toLocaleDateString()} ${date.toLocaleTimeString()}</td>
                                        <td class="text-center">${sale.items?.length || 0}</td>
                                        <td class="text-right">KES ${this.formatCurrency(sale.subtotal || 0)}</td>
                                        <td class="text-right">KES ${this.formatCurrency(sale.discount || 0)}</td>
                                        <td class="text-right">KES ${this.formatCurrency(sale.tax || 0)}</td>
                                        <td class="text-right"><strong>KES ${this.formatCurrency(sale.total || 0)}</strong></td>
                                        <td class="text-right">KES ${this.formatCurrency(sale.profit || 0)}</td>
                                        <td class="text-center">${sale.status || 'completed'}</td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>

                    <div class="footer">
                        <p>This is a computer-generated report from Vendlfy POS System</p>
                        <p>Generated on ${new Date().toLocaleString()}</p>
                    </div>

                    <script>
                        window.onload = function() {
                            window.print();
                            // Close window after printing (optional)
                            // setTimeout(() => window.close(), 1000);
                        };
                    </script>
                </body>
                </html>
            `);
            printWindow.document.close();

            this.showNotification(`Preparing PDF export for ${this.filteredSales.length} sales`, 'success');
            console.log('✅ Sales exported to PDF');
        } catch (error) {
            console.error('❌ Error exporting to PDF:', error);
            this.showNotification('Error exporting to PDF', 'error');
        }
    }


    // Format currency
    formatCurrency(amount) {
        return parseFloat(amount || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    // Show notification
    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `pos-notification pos-notification-${type}`;
        notification.textContent = message;
        document.body.appendChild(notification);

        setTimeout(() => notification.classList.add('show'), 10);
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }

    // Refresh sales
    async refresh() {
        await this.loadSales();
        this.renderSales();
    }
}

// Initialize sales manager
const salesManager = new SalesManager();

// Export for global access
window.salesManager = salesManager;

export default salesManager;
