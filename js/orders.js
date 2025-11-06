// Orders Manager
const ordersManager = {
    orders: [],
    suppliers: [],
    filteredOrders: [],
    currentFilter: 'all',

    init() {
        console.log('Initializing Orders Manager...');
        this.loadOrders();
        this.loadSuppliers();
        this.setupEventListeners();
        this.renderStats();
        this.renderOrdersTable();
        
        // Auto-refresh every 30 seconds
        setInterval(() => {
            this.loadOrders();
            this.loadSuppliers();
        }, 30000);
    },

    setupEventListeners() {
        // Search input
        const searchInput = document.getElementById('ordersSearchInput');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.searchOrders(e.target.value);
            });
        }

        // Filter buttons
        const filterBtns = document.querySelectorAll('#orders-page .b2b-filter-btn');
        filterBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                // Remove active class from all buttons
                filterBtns.forEach(b => b.classList.remove('active'));
                // Add active class to clicked button
                e.target.classList.add('active');
                // Filter orders
                this.currentFilter = e.target.dataset.status;
                this.filterOrders(this.currentFilter);
            });
        });

        // Export button
        const exportBtn = document.getElementById('exportOrdersBtn');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => {
                this.showExportModal();
            });
        }
    },

    async loadOrders() {
        try {
            const branchId = window.branchManager?.currentBranch;
            if (!branchId) {
                console.log('No branch selected');
                return;
            }

            const ordersRef = window.db.collection('orders')
                .where('branchId', '==', branchId)
                .orderBy('createdAt', 'desc');

            const snapshot = await ordersRef.get();
            this.orders = [];

            snapshot.forEach(doc => {
                this.orders.push({
                    id: doc.id,
                    ...doc.data()
                });
            });

            console.log(`Loaded ${this.orders.length} orders`);
            this.filteredOrders = [...this.orders];
            this.renderStats();
            this.renderOrdersTable();
        } catch (error) {
            console.error('Error loading orders:', error);
        }
    },

    async loadSuppliers() {
        try {
            const branchId = window.branchManager?.currentBranch;
            if (!branchId) return;

            const suppliersRef = window.db.collection('suppliers')
                .where('branchId', '==', branchId);

            const snapshot = await suppliersRef.get();
            this.suppliers = [];

            snapshot.forEach(doc => {
                this.suppliers.push({
                    id: doc.id,
                    ...doc.data()
                });
            });

            console.log(`Loaded ${this.suppliers.length} suppliers`);
            this.renderStats();
        } catch (error) {
            console.error('Error loading suppliers:', error);
        }
    },

    renderStats() {
        const totalOrders = this.orders.length;
        const totalAmount = this.orders.reduce((sum, order) => sum + (order.totalAmount || 0), 0);
        
        const pendingOrders = this.orders.filter(o => o.deliveryStatus === 'pending' || o.deliveryStatus === 'processing');
        const pendingAmount = pendingOrders.reduce((sum, order) => sum + (order.totalAmount || 0), 0);
        
        const completedOrders = this.orders.filter(o => o.deliveryStatus === 'delivered' || o.deliveryStatus === 'completed');
        const completedAmount = completedOrders.reduce((sum, order) => sum + (order.totalAmount || 0), 0);
        
        const totalSuppliers = this.suppliers.filter(s => s.status === 'active').length;

        // Update DOM
        this.updateElement('totalOrdersCount', totalOrders);
        this.updateElement('totalOrdersAmount', `KSh ${this.formatNumber(totalAmount)}`);
        
        this.updateElement('pendingOrdersCount', pendingOrders.length);
        this.updateElement('pendingOrdersAmount', `KSh ${this.formatNumber(pendingAmount)}`);
        
        this.updateElement('completedOrdersCount', completedOrders.length);
        this.updateElement('completedOrdersAmount', `KSh ${this.formatNumber(completedAmount)}`);
        
        this.updateElement('totalSuppliersCount', totalSuppliers);
    },

    renderOrdersTable() {
        const tbody = document.getElementById('ordersTableBody');
        if (!tbody) return;

        if (this.filteredOrders.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="9" style="text-align: center; padding: 3rem;">
                        <div class="empty-state-inline">
                            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                                <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
                                <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
                            </svg>
                            <p>No orders found. Create your first order!</p>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = this.filteredOrders.map(order => `
            <tr>
                <td><strong>#${order.orderNumber || order.id.substring(0, 8).toUpperCase()}</strong></td>
                <td>${this.formatDate(order.createdAt)}</td>
                <td>${order.supplierName || 'N/A'}</td>
                <td style="text-align: center;">${order.items?.length || 0}</td>
                <td style="text-align: right;"><strong>KSh ${this.formatNumber(order.totalAmount || 0)}</strong></td>
                <td style="text-align: center;">
                    <span class="status-badge ${this.getPaymentStatusClass(order.paymentStatus)}">
                        ${this.capitalizeFirst(order.paymentStatus || 'pending')}
                    </span>
                </td>
                <td style="text-align: center;">
                    <span class="status-badge ${this.getDeliveryStatusClass(order.deliveryStatus)}">
                        ${this.capitalizeFirst(order.deliveryStatus || 'pending')}
                    </span>
                </td>
                <td>${order.expectedDelivery ? this.formatDate(order.expectedDelivery) : 'TBD'}</td>
                <td style="text-align: center;">
                    <div class="table-actions">
                        <button class="btn-icon" onclick="ordersManager.viewOrder('${order.id}')" title="View Details">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                <circle cx="12" cy="12" r="3"></circle>
                            </svg>
                        </button>
                        <button class="btn-icon" onclick="ordersManager.editOrder('${order.id}')" title="Edit Order">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                            </svg>
                        </button>
                        ${order.deliveryStatus !== 'delivered' ? `
                        <button class="btn-icon" onclick="ordersManager.markAsDelivered('${order.id}')" title="Mark as Delivered">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="20 6 9 17 4 12"></polyline>
                            </svg>
                        </button>
                        ` : ''}
                    </div>
                </td>
            </tr>
        `).join('');
    },

    filterOrders(status) {
        if (status === 'all') {
            this.filteredOrders = [...this.orders];
        } else if (status === 'pending') {
            this.filteredOrders = this.orders.filter(o => 
                o.deliveryStatus === 'pending' || o.deliveryStatus === 'processing'
            );
        } else if (status === 'completed') {
            this.filteredOrders = this.orders.filter(o => 
                o.deliveryStatus === 'delivered' || o.deliveryStatus === 'completed'
            );
        } else if (status === 'cancelled') {
            this.filteredOrders = this.orders.filter(o => 
                o.deliveryStatus === 'cancelled'
            );
        }
        this.renderOrdersTable();
    },

    searchOrders(query) {
        const searchTerm = query.toLowerCase().trim();
        
        if (!searchTerm) {
            this.filterOrders(this.currentFilter);
            return;
        }

        this.filteredOrders = this.orders.filter(order => {
            const orderNumber = (order.orderNumber || order.id).toLowerCase();
            const supplierName = (order.supplierName || '').toLowerCase();
            const amount = (order.totalAmount || 0).toString();
            
            return orderNumber.includes(searchTerm) ||
                   supplierName.includes(searchTerm) ||
                   amount.includes(searchTerm);
        });

        this.renderOrdersTable();
    },

    async viewOrder(orderId) {
        const order = this.orders.find(o => o.id === orderId);
        if (!order) return;

        const modal = document.createElement('div');
        modal.className = 'pos-modal';
        modal.innerHTML = `
            <div class="pos-modal-content" style="max-width: 800px;">
                <div class="pos-modal-header">
                    <h3>Order Details - #${order.orderNumber || order.id.substring(0, 8).toUpperCase()}</h3>
                    <button class="pos-modal-close" onclick="this.closest('.pos-modal').remove()">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
                <div class="pos-modal-body" style="max-height: 70vh; overflow-y: auto;">
                    <div class="detail-section">
                        <h4>Order Information</h4>
                        <div class="detail-row">
                            <span>Order Number:</span>
                            <strong>#${order.orderNumber || order.id.substring(0, 8).toUpperCase()}</strong>
                        </div>
                        <div class="detail-row">
                            <span>Supplier:</span>
                            <strong>${order.supplierName || 'N/A'}</strong>
                        </div>
                        <div class="detail-row">
                            <span>Order Date:</span>
                            <strong>${this.formatDate(order.createdAt)}</strong>
                        </div>
                        <div class="detail-row">
                            <span>Expected Delivery:</span>
                            <strong>${order.expectedDelivery ? this.formatDate(order.expectedDelivery) : 'TBD'}</strong>
                        </div>
                        <div class="detail-row">
                            <span>Payment Status:</span>
                            <span class="status-badge ${this.getPaymentStatusClass(order.paymentStatus)}">
                                ${this.capitalizeFirst(order.paymentStatus || 'pending')}
                            </span>
                        </div>
                        <div class="detail-row">
                            <span>Delivery Status:</span>
                            <span class="status-badge ${this.getDeliveryStatusClass(order.deliveryStatus)}">
                                ${this.capitalizeFirst(order.deliveryStatus || 'pending')}
                            </span>
                        </div>
                    </div>

                    <div class="detail-section">
                        <h4>Order Items</h4>
                        <table class="detail-table">
                            <thead>
                                <tr>
                                    <th>Item</th>
                                    <th style="text-align: center;">Quantity</th>
                                    <th style="text-align: right;">Unit Price</th>
                                    <th style="text-align: right;">Total</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${(order.items || []).map(item => `
                                    <tr>
                                        <td>${item.name || item.itemName}</td>
                                        <td style="text-align: center;">${item.quantity}</td>
                                        <td style="text-align: right;">KSh ${this.formatNumber(item.unitPrice || 0)}</td>
                                        <td style="text-align: right;">KSh ${this.formatNumber((item.quantity || 0) * (item.unitPrice || 0))}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>

                    <div class="sale-summary">
                        <div class="summary-row">
                            <span>Subtotal:</span>
                            <strong>KSh ${this.formatNumber(order.subtotal || order.totalAmount || 0)}</strong>
                        </div>
                        ${order.tax ? `
                        <div class="summary-row">
                            <span>Tax:</span>
                            <strong>KSh ${this.formatNumber(order.tax)}</strong>
                        </div>
                        ` : ''}
                        ${order.discount ? `
                        <div class="summary-row">
                            <span>Discount:</span>
                            <strong>- KSh ${this.formatNumber(order.discount)}</strong>
                        </div>
                        ` : ''}
                        <div class="summary-row grand-total">
                            <span>Total Amount:</span>
                            <strong>KSh ${this.formatNumber(order.totalAmount || 0)}</strong>
                        </div>
                    </div>

                    ${order.notes ? `
                    <div class="detail-section">
                        <h4>Notes</h4>
                        <p>${order.notes}</p>
                    </div>
                    ` : ''}
                </div>
                <div class="pos-modal-footer">
                    <button class="btn btn-secondary" onclick="this.closest('.pos-modal').remove()">Close</button>
                    ${order.deliveryStatus !== 'delivered' ? `
                    <button class="btn btn-success" onclick="ordersManager.markAsDelivered('${order.id}'); this.closest('.pos-modal').remove();">
                        Mark as Delivered
                    </button>
                    ` : ''}
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    },

    async markAsDelivered(orderId) {
        if (!confirm('Mark this order as delivered?')) return;

        try {
            await window.dataManager.updateOrder(orderId, {
                deliveryStatus: 'delivered',
                deliveredAt: new Date(),
                paymentStatus: 'paid'
            });

            // Update inventory for delivered items
            const order = this.orders.find(o => o.id === orderId);
            if (order && order.items) {
                for (const item of order.items) {
                    await this.updateInventoryFromOrder(item);
                }
            }

            this.showNotification('Order marked as delivered successfully!', 'success');
            this.loadOrders();
        } catch (error) {
            console.error('Error updating order:', error);
            this.showNotification('Failed to update order', 'error');
        }
    },

    async updateInventoryFromOrder(item) {
        try {
            const inventoryRef = window.db.collection('inventory')
                .where('branchId', '==', window.branchManager?.currentBranch)
                .where('name', '==', item.name || item.itemName);

            const snapshot = await inventoryRef.get();
            
            if (!snapshot.empty) {
                const doc = snapshot.docs[0];
                const currentStock = doc.data().stock || 0;
                const newStock = currentStock + (item.quantity || 0);

                await window.dataManager.updateInventory(doc.id, {
                    stock: newStock,
                    lastRestocked: new Date()
                });
            }
        } catch (error) {
            console.error('Error updating inventory:', error);
        }
    },

    editOrder(orderId) {
        // Navigate to edit order page
        this.showNotification('Edit order functionality coming soon!', 'info');
    },

    showExportModal() {
        const modal = document.createElement('div');
        modal.className = 'pos-modal';
        modal.innerHTML = `
            <div class="pos-modal-content" style="max-width: 400px;">
                <div class="pos-modal-header">
                    <h3>Export Orders</h3>
                    <button class="pos-modal-close" onclick="this.closest('.pos-modal').remove()">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
                <div class="pos-modal-body">
                    <p style="margin-bottom: 1.5rem; color: var(--text-secondary);">Choose your export format:</p>
                    <div style="display: flex; flex-direction: column; gap: 1rem;">
                        <button class="btn btn-primary" onclick="ordersManager.exportToExcel(); this.closest('.pos-modal').remove();" style="width: 100%;">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                <polyline points="14 2 14 8 20 8"></polyline>
                                <line x1="16" y1="13" x2="8" y2="13"></line>
                                <line x1="16" y1="17" x2="8" y2="17"></line>
                                <polyline points="10 9 9 9 8 9"></polyline>
                            </svg>
                            Export to Excel
                        </button>
                        <button class="btn btn-secondary" onclick="ordersManager.exportToPDF(); this.closest('.pos-modal').remove();" style="width: 100%;">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                <polyline points="14 2 14 8 20 8"></polyline>
                                <line x1="16" y1="13" x2="8" y2="13"></line>
                                <line x1="16" y1="17" x2="8" y2="17"></line>
                                <line x1="12" y1="9" x2="12" y2="13"></line>
                            </svg>
                            Export to PDF
                        </button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    },

    exportToExcel() {
        const data = this.filteredOrders.map(order => ({
            'Order #': order.orderNumber || order.id.substring(0, 8).toUpperCase(),
            'Date': this.formatDate(order.createdAt),
            'Supplier': order.supplierName || 'N/A',
            'Items': order.items?.length || 0,
            'Total Amount': order.totalAmount || 0,
            'Payment Status': this.capitalizeFirst(order.paymentStatus || 'pending'),
            'Delivery Status': this.capitalizeFirst(order.deliveryStatus || 'pending'),
            'Expected Delivery': order.expectedDelivery ? this.formatDate(order.expectedDelivery) : 'TBD'
        }));

        // Create CSV
        const headers = Object.keys(data[0]);
        const csv = [
            headers.join(','),
            ...data.map(row => headers.map(header => {
                const value = row[header];
                return typeof value === 'string' && value.includes(',') ? `"${value}"` : value;
            }).join(','))
        ].join('\n');

        // Download
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `orders_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);

        this.showNotification('Orders exported to Excel successfully!', 'success');
    },

    exportToPDF() {
        const printWindow = window.open('', '', 'width=800,height=600');
        
        const html = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Orders Report</title>
                <style>
                    body { font-family: Arial, sans-serif; padding: 20px; }
                    h1 { color: #333; border-bottom: 3px solid #3b82f6; padding-bottom: 10px; }
                    .info { margin: 20px 0; color: #666; }
                    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                    th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
                    th { background-color: #3b82f6; color: white; font-weight: 600; }
                    tr:nth-child(even) { background-color: #f9fafb; }
                    .status { padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; }
                    .status.pending { background: #fef3c7; color: #92400e; }
                    .status.completed { background: #d1fae5; color: #065f46; }
                    .status.delivered { background: #d1fae5; color: #065f46; }
                    .status.cancelled { background: #fee2e2; color: #991b1b; }
                    .total { font-weight: bold; background-color: #eff6ff; }
                    @media print {
                        button { display: none; }
                    }
                </style>
            </head>
            <body>
                <h1>Orders Report</h1>
                <div class="info">
                    <p><strong>Generated:</strong> ${new Date().toLocaleString()}</p>
                    <p><strong>Total Orders:</strong> ${this.filteredOrders.length}</p>
                    <p><strong>Total Value:</strong> KSh ${this.formatNumber(this.filteredOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0))}</p>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th>Order #</th>
                            <th>Date</th>
                            <th>Supplier</th>
                            <th>Items</th>
                            <th>Amount</th>
                            <th>Payment</th>
                            <th>Delivery</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${this.filteredOrders.map(order => `
                            <tr>
                                <td>${order.orderNumber || order.id.substring(0, 8).toUpperCase()}</td>
                                <td>${this.formatDate(order.createdAt)}</td>
                                <td>${order.supplierName || 'N/A'}</td>
                                <td>${order.items?.length || 0}</td>
                                <td>KSh ${this.formatNumber(order.totalAmount || 0)}</td>
                                <td><span class="status ${order.paymentStatus}">${this.capitalizeFirst(order.paymentStatus || 'pending')}</span></td>
                                <td><span class="status ${order.deliveryStatus}">${this.capitalizeFirst(order.deliveryStatus || 'pending')}</span></td>
                            </tr>
                        `).join('')}
                        <tr class="total">
                            <td colspan="4"><strong>TOTAL</strong></td>
                            <td><strong>KSh ${this.formatNumber(this.filteredOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0))}</strong></td>
                            <td colspan="2"></td>
                        </tr>
                    </tbody>
                </table>
                <button onclick="window.print()" style="margin-top: 20px; padding: 10px 20px; background: #3b82f6; color: white; border: none; border-radius: 6px; cursor: pointer;">Print PDF</button>
            </body>
            </html>
        `;
        
        printWindow.document.write(html);
        printWindow.document.close();

        this.showNotification('PDF preview opened. Click Print to save as PDF.', 'success');
    },

    // Helper methods
    getPaymentStatusClass(status) {
        const statusMap = {
            'paid': 'completed',
            'pending': 'pending',
            'partial': 'processing',
            'failed': 'cancelled'
        };
        return statusMap[status] || 'pending';
    },

    getDeliveryStatusClass(status) {
        const statusMap = {
            'delivered': 'delivered',
            'completed': 'completed',
            'pending': 'pending',
            'processing': 'processing',
            'cancelled': 'cancelled',
            'shipped': 'processing'
        };
        return statusMap[status] || 'pending';
    },

    formatDate(timestamp) {
        if (!timestamp) return 'N/A';
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        return date.toLocaleDateString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    },

    formatNumber(num) {
        return new Intl.NumberFormat('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(num);
    },

    capitalizeFirst(str) {
        if (!str) return '';
        return str.charAt(0).toUpperCase() + str.slice(1);
    },

    updateElement(id, value) {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = value;
        }
    },

    showNotification(message, type = 'info') {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 1rem 1.5rem;
            background: ${type === 'success' ? '#22c55e' : type === 'error' ? '#ef4444' : '#3b82f6'};
            color: white;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 10000;
            animation: slideIn 0.3s ease;
        `;
        notification.textContent = message;

        document.body.appendChild(notification);

        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }
};

// Export as default
export default ordersManager;

// Make it globally available
window.ordersManager = ordersManager;

// Add CSS animations
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { transform: translateX(400px); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(400px); opacity: 0; }
    }
`;
document.head.appendChild(style);
