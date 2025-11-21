// Orders Manager
import { db, collection, getDocs, doc, updateDoc, deleteDoc, query, where, orderBy as firestoreOrderBy, serverTimestamp } from './firebase-config.js';

const ordersManager = {
    orders: [],
    suppliers: [],
    filteredOrders: [],
    currentFilter: 'all',
    initialized: false,
    refreshInterval: null,
    currentPage: 1,
    itemsPerPage: 10,
    totalPages: 1,

    init() {
        if (this.initialized) {
            console.log('Orders Manager already initialized, refreshing data...');
            this.loadOrders();
            this.loadSuppliers();
            return;
        }
        
        console.log('Initializing Orders Manager...');
        this.initialized = true;
        
        this.waitForFirebase().then(() => {
            this.loadOrders();
            this.loadSuppliers();
            this.setupEventListeners();
            this.renderStats();
            this.renderOrdersTable();
            
            // Clear any existing interval
            if (this.refreshInterval) {
                clearInterval(this.refreshInterval);
            }
            
            // Auto-refresh every 30 seconds
            this.refreshInterval = setInterval(() => {
                this.loadOrders();
                this.loadSuppliers();
            }, 30000);
        });
    },

    async waitForFirebase() {
        let attempts = 0;
        while (!window.db && attempts < 50) {
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
        }
        if (!window.db) {
            console.error('Firebase not available after waiting');
        }
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
            if (!window.db) {
                console.error('Firestore database not initialized');
                this.renderOrdersTable();
                return;
            }

            const branchId = window.branchManager?.currentBranch;
            if (!branchId) {
                console.log('No branch selected');
                this.orders = [];
                this.filteredOrders = [];
                this.renderStats();
                this.renderOrdersTable();
                return;
            }

            console.log('Loading orders for branch:', branchId);

            const ordersRef = collection(db, 'orders');
            
            // Try loading ALL orders first to see if any exist
            console.log('🔍 Attempting to load ALL orders from Firestore...');
            const allSnapshot = await getDocs(ordersRef);
            console.log(`📊 Found ${allSnapshot.size} total orders in database (all branches)`);
            
            if (allSnapshot.size > 0) {
                const firstDoc = allSnapshot.docs[0].data();
                console.log('📄 Sample order data:', {
                    orderNumber: firstDoc.orderNumber || firstDoc.id,
                    supplierName: firstDoc.supplierName,
                    branchId: firstDoc.branchId,
                    totalAmount: firstDoc.totalAmount,
                    status: firstDoc.status
                });
            }
            
            // Now filter by branch using simple query first (no ordering)
            console.log(`🔍 Loading orders for current branch: ${branchId}`);
            const simpleQuery = query(
                ordersRef,
                where('branchId', '==', branchId)
            );

            const simpleSnapshot = await getDocs(simpleQuery);
            console.log(`📊 Found ${simpleSnapshot.size} orders for branch ${branchId} (without ordering)`);
            
            this.orders = [];
            simpleSnapshot.forEach(docSnap => {
                this.orders.push({
                    id: docSnap.id,
                    ...docSnap.data()
                });
            });
            
            // Sort in memory instead of using Firestore orderBy
            this.orders.sort((a, b) => {
                const dateA = a.createdAt?.toDate?.() || new Date(0);
                const dateB = b.createdAt?.toDate?.() || new Date(0);
                return dateB - dateA; // Descending order
            });

            console.log(`✅ Loaded ${this.orders.length} orders for branch ${branchId}`);
            
            // Apply current filter
            if (this.currentFilter === 'all') {
                this.filteredOrders = [...this.orders];
            } else {
                this.filteredOrders = this.orders.filter(o => o.status === this.currentFilter);
            }
            
            console.log(`Displaying ${this.filteredOrders.length} orders after filter: ${this.currentFilter}`);
            this.renderStats();
            this.renderOrdersTable();
        } catch (error) {
            console.error('❌ Error loading orders:', error);
            console.error('Error details:', error.message);
            console.error('Error code:', error.code);
            
            if (error.message && error.message.includes('index')) {
                console.error('⚠️ FIRESTORE INDEX REQUIRED:');
                console.error('Collection: orders');
                console.error('Fields: branchId (Ascending), createdAt (Descending)');
                console.error('Click the error link above to auto-create the index');
            }
            
            this.renderStats();
            this.renderOrdersTable();
        }
    },

    async loadSuppliers() {
        try {
            if (!window.db) {
                console.error('Firestore database not initialized');
                return;
            }

            const branchId = window.branchManager?.currentBranch;
            if (!branchId) {
                console.log('No branch selected for suppliers');
                return;
            }

            console.log('Loading suppliers for orders page...');

            const suppliersRef = collection(db, 'suppliers');
            const q = query(
                suppliersRef,
                where('branchId', '==', branchId)
            );

            const snapshot = await getDocs(q);
            this.suppliers = [];

            snapshot.forEach(docSnap => {
                this.suppliers.push({
                    id: docSnap.id,
                    ...docSnap.data()
                });
            });

            console.log(`✅ Loaded ${this.suppliers.length} suppliers for orders`);
            this.renderStats();
        } catch (error) {
            console.error('❌ Error loading suppliers:', error);
            console.error('Error details:', error.message);
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
        if (!tbody) {
            console.error('❌ Table body element not found: ordersTableBody');
            return;
        }

        console.log(`📊 Rendering ${this.filteredOrders.length} orders to table...`);
        console.log('Current orders data:', this.filteredOrders);

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
            this.renderPagination();
            console.log('✅ Rendered empty state for orders table');
            return;
        }

        // Calculate pagination
        this.totalPages = Math.ceil(this.filteredOrders.length / this.itemsPerPage);
        const startIndex = (this.currentPage - 1) * this.itemsPerPage;
        const endIndex = startIndex + this.itemsPerPage;
        const paginatedOrders = this.filteredOrders.slice(startIndex, endIndex);

        console.log(`Showing ${paginatedOrders.length} orders (page ${this.currentPage} of ${this.totalPages})`);

        try {
            const rows = paginatedOrders.map(order => {
                console.log('Rendering order:', order.id);
                return `
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
                    <td>${order.expectedDelivery || order.expectedDeliveryDate ? this.formatDate(order.expectedDelivery || order.expectedDeliveryDate) : 'TBD'}</td>
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
                            <button class="btn-icon" onclick="ordersManager.printOrder('${order.id}')" title="Print Order">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <polyline points="6 9 6 2 18 2 18 9"></polyline>
                                    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                                    <rect x="6" y="14" width="12" height="8"></rect>
                                </svg>
                            </button>
                            ${order.deliveryStatus !== 'delivered' ? `
                            <button class="btn-icon" onclick="ordersManager.markAsDelivered('${order.id}')" title="Mark as Delivered">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <polyline points="20 6 9 17 4 12"></polyline>
                                </svg>
                            </button>
                            ` : ''}
                            <button class="btn-icon btn-delete" onclick="ordersManager.deleteOrder('${order.id}')" title="Delete Order">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <polyline points="3 6 5 6 21 6"></polyline>
                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                    <line x1="10" y1="11" x2="10" y2="17"></line>
                                    <line x1="14" y1="11" x2="14" y2="17"></line>
                                </svg>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
            }).join('');
            
            tbody.innerHTML = rows;
            this.renderPagination();
            console.log(`✅ Successfully rendered ${paginatedOrders.length} orders to table (page ${this.currentPage})`);
        } catch (error) {
            console.error('❌ Error rendering orders table:', error);
        }
        
        console.log('✅ Orders table rendering complete');
    },

    renderPagination() {
        const paginationContainer = document.getElementById('ordersPagination');
        if (!paginationContainer || this.totalPages <= 1) {
            if (paginationContainer) paginationContainer.innerHTML = '';
            return;
        }

        const maxVisiblePages = 5;
        let startPage = Math.max(1, this.currentPage - Math.floor(maxVisiblePages / 2));
        let endPage = Math.min(this.totalPages, startPage + maxVisiblePages - 1);

        if (endPage - startPage + 1 < maxVisiblePages) {
            startPage = Math.max(1, endPage - maxVisiblePages + 1);
        }

        let paginationHTML = `
            <div class="pagination">
                <button class="pagination-btn" ${this.currentPage === 1 ? 'disabled' : ''} 
                        onclick="ordersManager.goToPage(1)">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="11 17 6 12 11 7"></polyline>
                        <polyline points="18 17 13 12 18 7"></polyline>
                    </svg>
                </button>
                <button class="pagination-btn" ${this.currentPage === 1 ? 'disabled' : ''} 
                        onclick="ordersManager.goToPage(${this.currentPage - 1})">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="15 18 9 12 15 6"></polyline>
                    </svg>
                </button>
        `;

        for (let i = startPage; i <= endPage; i++) {
            paginationHTML += `
                <button class="pagination-btn ${i === this.currentPage ? 'active' : ''}" 
                        onclick="ordersManager.goToPage(${i})">${i}</button>
            `;
        }

        paginationHTML += `
                <button class="pagination-btn" ${this.currentPage === this.totalPages ? 'disabled' : ''} 
                        onclick="ordersManager.goToPage(${this.currentPage + 1})">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="9 18 15 12 9 6"></polyline>
                    </svg>
                </button>
                <button class="pagination-btn" ${this.currentPage === this.totalPages ? 'disabled' : ''} 
                        onclick="ordersManager.goToPage(${this.totalPages})">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="13 17 18 12 13 7"></polyline>
                        <polyline points="6 17 11 12 6 7"></polyline>
                    </svg>
                </button>
                <span class="pagination-info">
                    Showing ${(this.currentPage - 1) * this.itemsPerPage + 1}-${Math.min(this.currentPage * this.itemsPerPage, this.filteredOrders.length)} of ${this.filteredOrders.length}
                </span>
            </div>
        `;

        paginationContainer.innerHTML = paginationHTML;
    },

    goToPage(page) {
        if (page < 1 || page > this.totalPages || page === this.currentPage) {
            return;
        }
        this.currentPage = page;
        this.renderOrdersTable();
        
        // Scroll to top of table
        document.querySelector('#ordersTable')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
            const inventoryRef = collection(db, 'inventory');
            const q = query(
                inventoryRef,
                where('branchId', '==', window.branchManager?.currentBranch),
                where('name', '==', item.name || item.itemName)
            );

            const snapshot = await getDocs(q);
            
            if (!snapshot.empty) {
                const docSnap = snapshot.docs[0];
                const currentStock = docSnap.data().stock || 0;
                const newStock = currentStock + (item.quantity || 0);

                await window.dataManager.updateInventory(docSnap.id, {
                    stock: newStock,
                    lastRestocked: new Date()
                });
                
                console.log(`✅ Updated inventory for ${item.name}: ${currentStock} → ${newStock}`);
            } else {
                console.log(`⚠️ Inventory item not found: ${item.name}`);
            }
        } catch (error) {
            console.error('❌ Error updating inventory:', error);
            console.error('Error details:', error.message);
        }
    },

    printOrder(orderId) {
        const order = this.orders.find(o => o.id === orderId);
        if (!order) {
            this.showNotification('Order not found', 'error');
            return;
        }

        const printWindow = window.open('', '_blank');
        const orderNumber = order.orderNumber || order.id.substring(0, 8).toUpperCase();
        const orderDate = this.formatDate(order.createdAt);
        
        let itemsHTML = '';
        if (order.items && order.items.length > 0) {
            itemsHTML = order.items.map(item => `
                <tr>
                    <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">${item.name || 'N/A'}</td>
                    <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">${item.quantity || 0}</td>
                    <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right;">KSh ${this.formatNumber(item.price || 0)}</td>
                    <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right;"><strong>KSh ${this.formatNumber((item.quantity || 0) * (item.price || 0))}</strong></td>
                </tr>
            `).join('');
        }

        printWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Order #${orderNumber}</title>
                <style>
                    * { margin: 0; padding: 0; box-sizing: border-box; }
                    body { font-family: Arial, sans-serif; padding: 40px; background: white; }
                    .header { text-align: center; margin-bottom: 40px; border-bottom: 3px solid #3b82f6; padding-bottom: 20px; }
                    .header h1 { color: #1f2937; font-size: 28px; margin-bottom: 8px; }
                    .header p { color: #6b7280; font-size: 14px; }
                    .order-info { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-bottom: 40px; }
                    .info-section h3 { color: #1f2937; font-size: 16px; margin-bottom: 12px; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px; }
                    .info-row { display: flex; justify-content: space-between; padding: 8px 0; font-size: 14px; }
                    .info-row .label { color: #6b7280; }
                    .info-row .value { color: #1f2937; font-weight: 600; }
                    table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
                    thead { background: #f3f4f6; }
                    th { padding: 12px; text-align: left; font-size: 14px; color: #374151; font-weight: 600; border-bottom: 2px solid #d1d5db; }
                    td { font-size: 14px; color: #1f2937; }
                    .totals { margin-top: 30px; text-align: right; }
                    .total-row { display: flex; justify-content: flex-end; padding: 8px 0; font-size: 14px; }
                    .total-row .label { color: #6b7280; margin-right: 20px; min-width: 120px; }
                    .total-row.grand-total { font-size: 18px; font-weight: bold; color: #1f2937; border-top: 2px solid #3b82f6; padding-top: 12px; margin-top: 12px; }
                    .footer { margin-top: 60px; text-align: center; color: #9ca3af; font-size: 12px; border-top: 1px solid #e5e7eb; padding-top: 20px; }
                    @media print {
                        body { padding: 20px; }
                        .no-print { display: none; }
                    }
                </style>
            </head>
            <body>
                <div class="header">
                    <h1>PURCHASE ORDER</h1>
                    <p>Order #${orderNumber}</p>
                </div>
                
                <div class="order-info">
                    <div class="info-section">
                        <h3>Order Information</h3>
                        <div class="info-row">
                            <span class="label">Order Date:</span>
                            <span class="value">${orderDate}</span>
                        </div>
                        <div class="info-row">
                            <span class="label">Expected Delivery:</span>
                            <span class="value">${order.expectedDelivery ? this.formatDate(order.expectedDelivery) : 'TBD'}</span>
                        </div>
                        <div class="info-row">
                            <span class="label">Delivery Status:</span>
                            <span class="value">${this.capitalizeFirst(order.deliveryStatus || 'pending')}</span>
                        </div>
                    </div>
                    <div class="info-section">
                        <h3>Supplier Information</h3>
                        <div class="info-row">
                            <span class="label">Supplier:</span>
                            <span class="value">${order.supplierName || 'N/A'}</span>
                        </div>
                        <div class="info-row">
                            <span class="label">Contact:</span>
                            <span class="value">${order.supplierContact || 'N/A'}</span>
                        </div>
                        <div class="info-row">
                            <span class="label">Payment Status:</span>
                            <span class="value">${this.capitalizeFirst(order.paymentStatus || 'pending')}</span>
                        </div>
                    </div>
                </div>

                <table>
                    <thead>
                        <tr>
                            <th>Item</th>
                            <th style="text-align: center;">Quantity</th>
                            <th style="text-align: right;">Unit Price</th>
                            <th style="text-align: right;">Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${itemsHTML}
                    </tbody>
                </table>

                <div class="totals">
                    <div class="total-row grand-total">
                        <span class="label">TOTAL AMOUNT:</span>
                        <span class="value">KSh ${this.formatNumber(order.totalAmount || 0)}</span>
                    </div>
                </div>

                ${order.notes ? `
                <div style="margin-top: 30px; padding: 15px; background: #f9fafb; border-left: 4px solid #3b82f6;">
                    <strong style="color: #1f2937;">Notes:</strong>
                    <p style="color: #6b7280; margin-top: 8px;">${order.notes}</p>
                </div>
                ` : ''}

                <div class="footer">
                    <p>Generated on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}</p>
                    <p style="margin-top: 5px;">Vendify POS - Order Management System</p>
                </div>
                
                <script>
                    window.onload = function() { window.print(); };
                </script>
            </body>
            </html>
        `);
        
        printWindow.document.close();
    },

    async deleteOrder(orderId) {
        const order = this.orders.find(o => o.id === orderId);
        if (!order) {
            this.showNotification('Order not found', 'error');
            return;
        }

        const orderNumber = order.orderNumber || order.id.substring(0, 8).toUpperCase();
        const confirmMessage = `Are you sure you want to delete Order #${orderNumber}?\n\nThis action cannot be undone.`;
        
        if (!confirm(confirmMessage)) return;

        try {
            const orderRef = doc(db, 'orders', orderId);
            await deleteDoc(orderRef);

            // Log activity
            if (window.activityTracker) {
                window.activityTracker.logActivity('order', 'deleted', {
                    orderNumber: orderNumber,
                    supplierName: order.supplierName,
                    totalAmount: order.totalAmount,
                    items: order.items?.length || 0
                });
            }

            this.showNotification('Order deleted successfully!', 'success');
            await this.loadOrders();
        } catch (error) {
            console.error('Error deleting order:', error);
            this.showNotification('Failed to delete order. Please try again.', 'error');
        }
    },

    editOrder(orderId) {
        const order = this.orders.find(o => o.id === orderId);
        if (!order) {
            this.showNotification('Order not found', 'error');
            return;
        }

        const modal = document.createElement('div');
        modal.className = 'pos-modal';
        modal.innerHTML = `
            <div class="pos-modal-content" style="max-width: 600px;">
                <div class="pos-modal-header">
                    <h3>Edit Order #${order.orderNumber || order.id.substring(0, 8).toUpperCase()}</h3>
                    <button class="pos-modal-close" onclick="this.closest('.pos-modal').remove()">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
                <div class="pos-modal-body">
                    <form id="editOrderForm" style="display: grid; gap: 1rem;">
                        <div class="form-group">
                            <label>Supplier</label>
                            <select id="editOrderSupplier" class="form-control" disabled>
                                <option value="${order.supplierId}">${order.supplierName} - ${order.supplierCompany || ''}</option>
                            </select>
                        </div>

                        <div class="form-row" style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                            <div class="form-group">
                                <label>Payment Status</label>
                                <select id="editPaymentStatus" class="form-control">
                                    <option value="pending" ${order.paymentStatus === 'pending' ? 'selected' : ''}>Pending</option>
                                    <option value="partial" ${order.paymentStatus === 'partial' ? 'selected' : ''}>Partial</option>
                                    <option value="paid" ${order.paymentStatus === 'paid' ? 'selected' : ''}>Paid</option>
                                </select>
                            </div>

                            <div class="form-group">
                                <label>Delivery Status</label>
                                <select id="editDeliveryStatus" class="form-control">
                                    <option value="pending" ${order.deliveryStatus === 'pending' ? 'selected' : ''}>Pending</option>
                                    <option value="processing" ${order.deliveryStatus === 'processing' ? 'selected' : ''}>Processing</option>
                                    <option value="shipped" ${order.deliveryStatus === 'shipped' ? 'selected' : ''}>Shipped</option>
                                    <option value="delivered" ${order.deliveryStatus === 'delivered' ? 'selected' : ''}>Delivered</option>
                                    <option value="cancelled" ${order.deliveryStatus === 'cancelled' ? 'selected' : ''}>Cancelled</option>
                                </select>
                            </div>
                        </div>

                        <div class="form-group">
                            <label>Expected Delivery Date</label>
                            <input type="date" id="editExpectedDate" class="form-control" 
                                   value="${order.expectedDeliveryDate || order.expectedDelivery || ''}">
                        </div>

                        <div class="form-group">
                            <label>Notes</label>
                            <textarea id="editOrderNotes" class="form-control" rows="3">${order.notes || ''}</textarea>
                        </div>

                        <div class="form-group">
                            <label>Order Status</label>
                            <select id="editOrderStatus" class="form-control">
                                <option value="pending" ${order.status === 'pending' ? 'selected' : ''}>Pending</option>
                                <option value="processing" ${order.status === 'processing' ? 'selected' : ''}>Processing</option>
                                <option value="completed" ${order.status === 'completed' ? 'selected' : ''}>Completed</option>
                                <option value="cancelled" ${order.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
                            </select>
                        </div>

                        <div class="pos-modal-footer" style="margin-top: 1rem;">
                            <button type="button" class="btn btn-secondary" onclick="this.closest('.pos-modal').remove()">Cancel</button>
                            <button type="submit" class="btn btn-primary">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                                    <polyline points="17 21 17 13 7 13 7 21"></polyline>
                                    <polyline points="7 3 7 8 15 8"></polyline>
                                </svg>
                                Update Order
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Handle form submission
        const form = document.getElementById('editOrderForm');
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.updateOrder(orderId);
        });

        // Show modal
        setTimeout(() => modal.classList.add('active'), 10);
    },

    async updateOrder(orderId) {
        try {
            const updateData = {
                paymentStatus: document.getElementById('editPaymentStatus').value,
                deliveryStatus: document.getElementById('editDeliveryStatus').value,
                expectedDeliveryDate: document.getElementById('editExpectedDate').value,
                notes: document.getElementById('editOrderNotes').value.trim(),
                status: document.getElementById('editOrderStatus').value,
                updatedAt: serverTimestamp()
            };

            const orderRef = doc(db, 'orders', orderId);
            await updateDoc(orderRef, updateData);

            console.log('✅ Order updated successfully');
            this.showNotification('Order updated successfully!', 'success');
            
            // Close modal
            document.querySelector('.pos-modal').remove();
            
            // Reload orders
            await this.loadOrders();
        } catch (error) {
            console.error('❌ Error updating order:', error);
            this.showNotification('Failed to update order: ' + error.message, 'error');
        }
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
