// New Order Manager
import { db, collection, addDoc, getDocs, query, where, serverTimestamp } from './firebase-config.js';

const newOrderManager = {
    suppliers: [],
    orderItems: [],
    itemCounter: 0,

    init() {
        console.log('Initializing New Order Manager...');
        this.waitForFirebase().then(() => {
            this.loadSuppliers();
            this.setupEventListeners();
            this.setMinDate();
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
        // Form submission
        const form = document.getElementById('newOrderForm');
        if (form) {
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                this.createOrder();
            });
        }
    },

    setMinDate() {
        const dateInput = document.getElementById('orderExpectedDate');
        if (dateInput) {
            const today = new Date().toISOString().split('T')[0];
            dateInput.setAttribute('min', today);
            dateInput.value = today;
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
                console.log('No branch selected');
                return;
            }

            console.log('Loading suppliers for dropdown...');

            const suppliersRef = collection(db, 'suppliers');
            const q = query(
                suppliersRef,
                where('branchId', '==', branchId),
                where('status', '==', 'active')
            );

            const snapshot = await getDocs(q);
            this.suppliers = [];

            snapshot.forEach(docSnap => {
                this.suppliers.push({
                    id: docSnap.id,
                    ...docSnap.data()
                });
            });

            console.log(`✅ Loaded ${this.suppliers.length} active suppliers`);
            this.populateSupplierDropdown();
        } catch (error) {
            console.error('❌ Error loading suppliers:', error);
        }
    },

    populateSupplierDropdown() {
        const select = document.getElementById('orderSupplier');
        if (!select) return;

        // Clear existing options except first
        select.innerHTML = '<option value="">-- Select Supplier --</option>';

        if (this.suppliers.length === 0) {
            select.innerHTML += '<option value="" disabled>No active suppliers found</option>';
            return;
        }

        this.suppliers.forEach(supplier => {
            const option = document.createElement('option');
            option.value = supplier.id;
            option.textContent = `${supplier.name}${supplier.company ? ` (${supplier.company})` : ''}`;
            option.dataset.supplierName = supplier.name;
            option.dataset.supplierCompany = supplier.company || '';
            select.appendChild(option);
        });

        console.log('✅ Supplier dropdown populated');
    },

    addOrderItem() {
        this.itemCounter++;
        const itemId = `item-${this.itemCounter}`;

        const itemRow = document.createElement('div');
        itemRow.className = 'order-item-row';
        itemRow.id = itemId;
        itemRow.innerHTML = `
            <div class="form-group">
                <label>Item Name *</label>
                <input type="text" class="form-control item-name" placeholder="Enter item name" required>
            </div>
            <div class="form-group">
                <label>Unit Price *</label>
                <input type="number" class="form-control item-price" placeholder="0.00" min="0" step="0.01" required>
            </div>
            <div class="form-group">
                <label>Quantity *</label>
                <input type="number" class="form-control item-quantity" placeholder="0" min="1" step="1" required>
            </div>
            <div class="order-item-total">
                <div class="order-item-total-label">Total</div>
                <div class="order-item-total-value">KSh 0.00</div>
            </div>
            <button type="button" class="btn-remove-item" onclick="newOrderManager.removeOrderItem('${itemId}')" title="Remove Item">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
            </button>
        `;

        // Remove empty state if exists
        const container = document.getElementById('orderItemsContainer');
        const emptyState = container.querySelector('.empty-state-inline');
        if (emptyState) {
            emptyState.remove();
        }

        container.appendChild(itemRow);

        // Add event listeners for price and quantity inputs
        const priceInput = itemRow.querySelector('.item-price');
        const qtyInput = itemRow.querySelector('.item-quantity');

        priceInput.addEventListener('input', () => this.calculateItemTotal(itemId));
        qtyInput.addEventListener('input', () => this.calculateItemTotal(itemId));

        console.log(`✅ Added order item: ${itemId}`);
        this.updateOrderSummary();
    },

    removeOrderItem(itemId) {
        const item = document.getElementById(itemId);
        if (item) {
            item.remove();
            console.log(`Removed order item: ${itemId}`);
        }

        // Show empty state if no items left
        const container = document.getElementById('orderItemsContainer');
        if (container.children.length === 0) {
            container.innerHTML = `
                <div class="empty-state-inline">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path>
                        <line x1="3" y1="6" x2="21" y2="6"></line>
                        <path d="M16 10a4 4 0 0 1-8 0"></path>
                    </svg>
                    <p>No items added yet. Click "Add Item" to start.</p>
                </div>
            `;
        }

        this.updateOrderSummary();
    },

    calculateItemTotal(itemId) {
        const item = document.getElementById(itemId);
        if (!item) return;

        const price = parseFloat(item.querySelector('.item-price').value) || 0;
        const qty = parseInt(item.querySelector('.item-quantity').value) || 0;
        const total = price * qty;

        const totalElement = item.querySelector('.order-item-total-value');
        totalElement.textContent = `KSh ${total.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

        this.updateOrderSummary();
    },

    updateOrderSummary() {
        const container = document.getElementById('orderItemsContainer');
        const items = container.querySelectorAll('.order-item-row');

        let totalItems = items.length;
        let totalQty = 0;
        let totalAmount = 0;

        items.forEach(item => {
            const price = parseFloat(item.querySelector('.item-price').value) || 0;
            const qty = parseInt(item.querySelector('.item-quantity').value) || 0;
            totalQty += qty;
            totalAmount += (price * qty);
        });

        document.getElementById('summaryTotalItems').textContent = totalItems;
        document.getElementById('summaryTotalQty').textContent = totalQty;
        document.getElementById('summaryTotalAmount').textContent = `KSh ${totalAmount.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    },

    async createOrder() {
        // Validation
        const supplierSelect = document.getElementById('orderSupplier');
        const expectedDate = document.getElementById('orderExpectedDate').value;
        const notes = document.getElementById('orderNotes').value.trim();

        if (!supplierSelect.value) {
            this.showNotification('Please select a supplier', 'error');
            return;
        }

        const container = document.getElementById('orderItemsContainer');
        const items = container.querySelectorAll('.order-item-row');

        if (items.length === 0) {
            this.showNotification('Please add at least one item to the order', 'error');
            return;
        }

        // Validate all items have required fields
        let hasError = false;
        const orderItems = [];
        let totalAmount = 0;

        items.forEach((item, index) => {
            const name = item.querySelector('.item-name').value.trim();
            const price = parseFloat(item.querySelector('.item-price').value);
            const quantity = parseInt(item.querySelector('.item-quantity').value);

            if (!name || !price || !quantity || price <= 0 || quantity <= 0) {
                hasError = true;
                return;
            }

            const itemTotal = price * quantity;
            totalAmount += itemTotal;

            orderItems.push({
                name,
                price,
                quantity,
                total: itemTotal
            });
        });

        if (hasError) {
            this.showNotification('Please fill in all item details correctly', 'error');
            return;
        }

        // Get supplier info
        const selectedOption = supplierSelect.options[supplierSelect.selectedIndex];
        const supplierName = selectedOption.dataset.supplierName;
        const supplierCompany = selectedOption.dataset.supplierCompany;

        // Create order object
        const orderData = {
            supplierId: supplierSelect.value,
            supplierName: supplierName,
            supplierCompany: supplierCompany,
            items: orderItems,
            totalItems: orderItems.length,
            totalQuantity: orderItems.reduce((sum, item) => sum + item.quantity, 0),
            totalAmount: totalAmount,
            expectedDeliveryDate: new Date(expectedDate),
            notes: notes,
            status: 'pending',
            deliveryStatus: 'pending',
            paymentStatus: 'pending',
            branchId: window.branchManager?.currentBranch,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        };

        try {
            console.log('Creating order:', orderData);

            const ordersRef = collection(db, 'orders');
            const docRef = await addDoc(ordersRef, orderData);

            console.log('✅ Order created successfully with ID:', docRef.id);
            this.showNotification('Order created successfully!', 'success');

            // Update orders manager if available
            if (window.ordersManager) {
                await window.ordersManager.loadOrders();
            }

            // Reset form and redirect
            await new Promise(resolve => setTimeout(resolve, 1000));
            this.clearForm();
            showPage('orders');

        } catch (error) {
            console.error('❌ Error creating order:', error);
            this.showNotification('Failed to create order: ' + error.message, 'error');
        }
    },

    clearForm() {
        document.getElementById('newOrderForm').reset();
        const container = document.getElementById('orderItemsContainer');
        container.innerHTML = `
            <div class="empty-state-inline">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path>
                    <line x1="3" y1="6" x2="21" y2="6"></line>
                    <path d="M16 10a4 4 0 0 1-8 0"></path>
                </svg>
                <p>No items added yet. Click "Add Item" to start.</p>
            </div>
        `;
        this.itemCounter = 0;
        this.updateOrderSummary();
        this.setMinDate();
        console.log('Form cleared');
    },

    showNotification(message, type = 'info') {
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
export default newOrderManager;

// Make it globally available
window.newOrderManager = newOrderManager;
