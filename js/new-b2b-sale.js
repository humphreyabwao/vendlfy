// New B2B Sale Module - Wholesale Order Creation
import dataManager from './data-manager.js';
import branchManager from './branch-manager.js';

class NewB2BSaleManager {
    constructor() {
        this.cart = [];
        this.selectedCustomer = null;
        this.inventory = [];
        this.customers = [];
        this.discount = 0;
        this.discountType = 'percent'; // percent or fixed
        this.creditTerm = 'immediate'; // immediate, net30, net60, net90
        this.paymentMethod = 'cash';
    }

    async init() {
        console.log('🏢 Initializing New B2B Sale...');
        await this.loadInventory();
        await this.loadCustomers();
        this.setupEventListeners();
        this.renderCustomerSelect();
        this.checkQuickAdd();
        console.log('✅ New B2B Sale ready');
    }

    // Load inventory
    async loadInventory() {
        try {
            this.inventory = await dataManager.getInventory();
            this.renderInventorySelect();
        } catch (error) {
            console.error('Error loading inventory:', error);
        }
    }

    // Load customers
    async loadCustomers() {
        try {
            this.customers = await dataManager.getCustomers();
        } catch (error) {
            console.error('Error loading customers:', error);
        }
    }

    // Setup event listeners
    setupEventListeners() {
        // Product search
        const searchInput = document.getElementById('b2bProductSearch');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => this.searchProducts(e.target.value));
            searchInput.addEventListener('focus', () => {
                if (searchInput.value) this.searchProducts(searchInput.value);
            });
        }

        // Click outside to close search results
        document.addEventListener('click', (e) => {
            const searchWrapper = document.querySelector('.product-search-wrapper');
            if (searchWrapper && !searchWrapper.contains(e.target)) {
                document.getElementById('b2bSearchResults').classList.remove('show');
            }
        });

        // Manual item add button
        const manualAddBtn = document.getElementById('addManualItemBtn');
        if (manualAddBtn) {
            manualAddBtn.addEventListener('click', () => this.addManualItemToCart());
        }

        // Customer selection
        const customerSelect = document.getElementById('b2bCustomerSelect');
        if (customerSelect) {
            customerSelect.addEventListener('change', (e) => this.selectCustomer(e.target.value));
        }

        // Complete sale button
        const completeBtn = document.getElementById('completeB2BSale');
        if (completeBtn) {
            completeBtn.addEventListener('click', () => this.completeSale());
        }

        // Clear cart button
        const clearBtn = document.getElementById('clearB2BCart');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => this.clearCart());
        }

        // Discount inputs
        const discountValue = document.getElementById('b2bDiscountValue');
        const discountType = document.getElementById('b2bDiscountType');
        if (discountValue) {
            discountValue.addEventListener('input', () => this.updateDiscount());
        }
        if (discountType) {
            discountType.addEventListener('change', () => this.updateDiscount());
        }

        // Credit term
        const creditTerm = document.getElementById('b2bCreditTerm');
        if (creditTerm) {
            creditTerm.addEventListener('change', (e) => {
                this.creditTerm = e.target.value;
                this.updateTotals();
            });
        }

        // Payment method
        const paymentMethod = document.getElementById('b2bPaymentMethod');
        if (paymentMethod) {
            paymentMethod.addEventListener('change', (e) => {
                this.paymentMethod = e.target.value;
            });
        }
    }

    // Search products from inventory
    searchProducts(query) {
        const resultsContainer = document.getElementById('b2bSearchResults');
        if (!resultsContainer) return;

        if (!query || query.length < 2) {
            resultsContainer.classList.remove('show');
            return;
        }

        const searchTerm = query.toLowerCase();
        const results = this.inventory.filter(item => 
            item.name?.toLowerCase().includes(searchTerm) ||
            item.sku?.toLowerCase().includes(searchTerm) ||
            item.category?.toLowerCase().includes(searchTerm)
        ).slice(0, 10); // Limit to 10 results

        if (results.length === 0) {
            resultsContainer.innerHTML = `
                <div class="search-result-item" style="text-align: center; color: #9ca3af;">
                    No products found
                </div>
            `;
            resultsContainer.classList.add('show');
            return;
        }

        resultsContainer.innerHTML = results.map(item => {
            const wholesalePrice = item.price * 0.85; // 15% discount
            return `
                <div class="search-result-item" onclick="window.newB2BSaleManager.selectProductFromSearch('${item.id}')">
                    <div class="result-item-name">${item.name}</div>
                    <div class="result-item-details">
                        <span>SKU: ${item.sku || 'N/A'}</span>
                        <span class="result-item-price">Wholesale: ${this.formatCurrency(wholesalePrice)}</span>
                        <span class="result-item-stock">Stock: ${item.quantity} units</span>
                    </div>
                </div>
            `;
        }).join('');

        resultsContainer.classList.add('show');
    }

    // Select product from search results
    selectProductFromSearch(itemId) {
        const item = this.inventory.find(i => i.id === itemId);
        if (!item) return;

        const wholesalePrice = item.price * 0.85;

        // Check if item already in cart
        const existingIndex = this.cart.findIndex(c => c.id === itemId);
        if (existingIndex >= 0) {
            // Increase quantity
            this.cart[existingIndex].quantity += 10;
            this.cart[existingIndex].total = this.cart[existingIndex].quantity * this.cart[existingIndex].price;
            this.showNotification('Quantity increased for ' + item.name, 'success');
        } else {
            // Add new item
            this.cart.push({
                id: itemId,
                name: item.name,
                sku: item.sku,
                price: wholesalePrice,
                quantity: 10,
                total: wholesalePrice * 10
            });
            this.showNotification('Added ' + item.name + ' to cart', 'success');
        }

        this.renderCart();
        this.updateTotals();

        // Clear search
        document.getElementById('b2bProductSearch').value = '';
        document.getElementById('b2bSearchResults').classList.remove('show');
    }

    // Add manual item to cart
    addManualItemToCart() {
        const nameInput = document.getElementById('manualProductName');
        const priceInput = document.getElementById('manualProductPrice');
        const qtyInput = document.getElementById('manualProductQty');

        if (!nameInput || !priceInput || !qtyInput) return;

        const name = nameInput.value.trim();
        const price = parseFloat(priceInput.value) || 0;
        const quantity = parseInt(qtyInput.value) || 1;

        if (!name) {
            this.showNotification('Please enter product name', 'error');
            return;
        }

        if (price <= 0) {
            this.showNotification('Please enter valid price', 'error');
            return;
        }

        if (quantity < 1) {
            this.showNotification('Quantity must be at least 1', 'error');
            return;
        }

        // Add to cart
        const manualId = 'manual_' + Date.now();
        this.cart.push({
            id: manualId,
            name: name,
            sku: 'MANUAL',
            price: price,
            quantity: quantity,
            total: price * quantity,
            isManual: true
        });

        this.renderCart();
        this.updateTotals();
        this.showNotification('Manual item added to cart', 'success');

        // Clear form
        nameInput.value = '';
        priceInput.value = '';
        qtyInput.value = '10';
    }

    // Check if there's a quick add item from B2B sales page
    checkQuickAdd() {
        const quickAddItemId = sessionStorage.getItem('quickAddItemId');
        if (quickAddItemId) {
            const item = this.inventory.find(i => i.id === quickAddItemId);
            if (item) {
                const itemSelect = document.getElementById('b2bItemSelect');
                if (itemSelect) {
                    itemSelect.value = quickAddItemId;
                    this.updateItemDetails(quickAddItemId);
                }
            }
            sessionStorage.removeItem('quickAddItemId');
        }
    }

    // Render customer select dropdown
    renderCustomerSelect() {
        const select = document.getElementById('b2bCustomerSelect');
        if (!select) return;

        select.innerHTML = '<option value="">Select Customer...</option>';
        this.customers.forEach(customer => {
            const option = document.createElement('option');
            option.value = customer.id;
            option.textContent = `${customer.name} - ${customer.phone || 'No phone'}`;
            select.appendChild(option);
        });
    }

    // Render inventory select dropdown
    renderInventorySelect() {
        const select = document.getElementById('b2bItemSelect');
        if (!select) return;

        select.innerHTML = '<option value="">Select Product...</option>';
        this.inventory.forEach(item => {
            const option = document.createElement('option');
            option.value = item.id;
            option.textContent = `${item.name} - ${item.sku || 'N/A'} (Stock: ${item.quantity})`;
            select.appendChild(option);
        });

        // Add change listener
        select.addEventListener('change', (e) => this.updateItemDetails(e.target.value));
    }

    // Update item details when selected
    updateItemDetails(itemId) {
        const item = this.inventory.find(i => i.id === itemId);
        if (!item) return;

        const retailPriceEl = document.getElementById('b2bRetailPrice');
        const wholesalePriceEl = document.getElementById('b2bWholesalePrice');
        const stockEl = document.getElementById('b2bStockAvailable');

        const wholesalePrice = item.price * 0.85; // 15% discount

        if (retailPriceEl) retailPriceEl.textContent = this.formatCurrency(item.price);
        if (wholesalePriceEl) wholesalePriceEl.textContent = this.formatCurrency(wholesalePrice);
        if (stockEl) stockEl.textContent = `${item.quantity} units`;

        // Set wholesale price in hidden input
        const priceInput = document.getElementById('b2bItemPrice');
        if (priceInput) priceInput.value = wholesalePrice;
    }

    // Select customer
    selectCustomer(customerId) {
        this.selectedCustomer = this.customers.find(c => c.id === customerId);
        
        // Update customer quick info
        const quickInfo = document.getElementById('customerQuickInfo');
        if (quickInfo && this.selectedCustomer) {
            quickInfo.innerHTML = `
                <div class="customer-details">
                    <strong>${this.selectedCustomer.name}</strong>
                    <span>📞 ${this.selectedCustomer.phone || 'No phone'}</span>
                    <span>✉️ ${this.selectedCustomer.email || 'No email'}</span>
                </div>
            `;
        } else if (quickInfo) {
            quickInfo.innerHTML = '<div class="info-placeholder">Select a customer to see details</div>';
        }
    }

    // Add item to cart
    addItemToCart() {
        const itemSelect = document.getElementById('b2bItemSelect');
        const qtyInput = document.getElementById('b2bItemQuantity');
        const priceInput = document.getElementById('b2bItemPrice');

        if (!itemSelect || !qtyInput || !priceInput) return;

        const itemId = itemSelect.value;
        const quantity = parseInt(qtyInput.value) || 0;
        const price = parseFloat(priceInput.value) || 0;

        if (!itemId) {
            this.showNotification('Please select a product', 'error');
            return;
        }

        if (quantity < 10) {
            this.showNotification('Minimum wholesale order is 10 units', 'error');
            return;
        }

        const item = this.inventory.find(i => i.id === itemId);
        if (!item) return;

        if (quantity > item.quantity) {
            this.showNotification('Insufficient stock available', 'error');
            return;
        }

        // Check if item already in cart
        const existingIndex = this.cart.findIndex(c => c.id === itemId);
        if (existingIndex >= 0) {
            this.cart[existingIndex].quantity += quantity;
            this.cart[existingIndex].total = this.cart[existingIndex].quantity * this.cart[existingIndex].price;
        } else {
            this.cart.push({
                id: itemId,
                name: item.name,
                sku: item.sku,
                price: price,
                quantity: quantity,
                total: price * quantity
            });
        }

        this.renderCart();
        this.updateTotals();
        this.showNotification('Product added to cart', 'success');

        // Reset form
        itemSelect.value = '';
        qtyInput.value = '10';
        document.getElementById('b2bRetailPrice').textContent = 'KES 0';
        document.getElementById('b2bWholesalePrice').textContent = 'KES 0';
        document.getElementById('b2bStockAvailable').textContent = '0 units';
    }

    // Render cart
    renderCart() {
        const tbody = document.getElementById('b2bCartTableBody');
        const cartCount = document.getElementById('cartItemCount');
        
        if (!tbody) return;

        // Update cart count
        if (cartCount) {
            cartCount.textContent = `${this.cart.length} item${this.cart.length !== 1 ? 's' : ''}`;
        }

        if (this.cart.length === 0) {
            tbody.innerHTML = `
                <tr class="empty-cart-row">
                    <td colspan="7">
                        <div class="empty-cart-message">
                            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                                <circle cx="9" cy="21" r="1"></circle>
                                <circle cx="20" cy="21" r="1"></circle>
                                <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
                            </svg>
                            <p>Cart is empty</p>
                            <span>Search or manually add products to create an order</span>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = this.cart.map((item, index) => `
            <tr>
                <td><span class="cart-item-number">${index + 1}</span></td>
                <td><span class="cart-product-name">${item.name}</span></td>
                <td>${item.sku || 'N/A'}</td>
                <td><strong>${this.formatCurrency(item.price)}</strong></td>
                <td>
                    <input 
                        type="number" 
                        value="${item.quantity}" 
                        min="1" 
                        class="cart-qty-input"
                        onchange="window.newB2BSaleManager.updateCartQuantity(${index}, this.value)"
                    >
                </td>
                <td><strong>${this.formatCurrency(item.total)}</strong></td>
                <td>
                    <button class="cart-remove-btn" onclick="window.newB2BSaleManager.removeFromCart(${index})" title="Remove item">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                    </button>
                </td>
            </tr>
        `).join('');
    }

    // Update cart quantity
    updateCartQuantity(index, newQty) {
        const quantity = parseInt(newQty) || 1;
        if (quantity < 1) {
            this.showNotification('Quantity must be at least 1', 'error');
            return;
        }

        const item = this.cart[index];
        
        // Check stock only for non-manual items
        if (!item.isManual) {
            const inventoryItem = this.inventory.find(i => i.id === item.id);
            if (inventoryItem && quantity > inventoryItem.quantity) {
                this.showNotification('Insufficient stock available', 'error');
                return;
            }
        }

        this.cart[index].quantity = quantity;
        this.cart[index].total = quantity * item.price;
        
        this.renderCart();
        this.updateTotals();
    }

    // Remove from cart
    removeFromCart(index) {
        this.cart.splice(index, 1);
        this.renderCart();
        this.updateTotals();
        this.showNotification('Item removed from cart', 'info');
    }

    // Clear cart
    clearCart() {
        if (this.cart.length === 0) return;
        
        if (confirm('Are you sure you want to clear the entire cart?')) {
            this.cart = [];
            this.renderCart();
            this.updateTotals();
            this.showNotification('Cart cleared', 'info');
        }
    }

    // Update discount
    updateDiscount() {
        const discountValue = parseFloat(document.getElementById('b2bDiscountValue')?.value) || 0;
        const discountType = document.getElementById('b2bDiscountType')?.value || 'percent';
        
        this.discount = discountValue;
        this.discountType = discountType;
        this.updateTotals();
    }

    // Update totals
    updateTotals() {
        const subtotal = this.cart.reduce((sum, item) => sum + item.total, 0);
        
        let discountAmount = 0;
        if (this.discountType === 'percent') {
            discountAmount = (subtotal * this.discount) / 100;
        } else {
            discountAmount = this.discount;
        }

        const total = subtotal - discountAmount;

        document.getElementById('b2bSubtotal').textContent = this.formatCurrency(subtotal);
        document.getElementById('b2bDiscountAmount').textContent = this.formatCurrency(discountAmount);
        document.getElementById('b2bGrandTotal').textContent = this.formatCurrency(total);

        // Show credit term info
        if (this.creditTerm !== 'immediate') {
            const creditDays = this.creditTerm.replace('net', '');
            const dueDate = new Date();
            dueDate.setDate(dueDate.getDate() + parseInt(creditDays));
            document.getElementById('b2bDueDate').textContent = `Due: ${dueDate.toLocaleDateString()}`;
        } else {
            document.getElementById('b2bDueDate').textContent = 'Payment: Immediate';
        }
    }

    // Complete sale
    async completeSale() {
        if (this.cart.length === 0) {
            this.showNotification('Cart is empty. Add products to create an order.', 'error');
            return;
        }

        if (!this.selectedCustomer) {
            this.showNotification('Please select a customer', 'error');
            return;
        }

        const subtotal = this.cart.reduce((sum, item) => sum + item.total, 0);
        let discountAmount = 0;
        if (this.discountType === 'percent') {
            discountAmount = (subtotal * this.discount) / 100;
        } else {
            discountAmount = this.discount;
        }
        const total = subtotal - discountAmount;

        const saleData = {
            type: 'b2b',
            saleType: 'wholesale',
            customer: this.selectedCustomer.name,
            customerId: this.selectedCustomer.id,
            customerPhone: this.selectedCustomer.phone,
            items: this.cart,
            subtotal: subtotal,
            discount: discountAmount,
            discountType: this.discountType,
            total: total,
            paymentMethod: this.paymentMethod,
            creditTerm: this.creditTerm,
            status: this.creditTerm === 'immediate' ? 'completed' : 'pending',
            branchId: branchManager.getCurrentBranch()?.id,
            branchName: branchManager.getCurrentBranch()?.name,
            createdAt: new Date().toISOString(),
            saleNumber: this.generateSaleNumber()
        };

        try {
            // Save to database
            await dataManager.createSale(saleData);

            // Update inventory only for non-manual items
            for (const item of this.cart) {
                if (!item.isManual) {
                    const inventoryItem = this.inventory.find(i => i.id === item.id);
                    if (inventoryItem) {
                        const newQuantity = inventoryItem.quantity - item.quantity;
                        await dataManager.updateInventoryItem(item.id, { quantity: newQuantity });
                    }
                }
            }

            // Refresh dashboard stats to update pending B2B count
            if (window.refreshDashboardStats) {
                await window.refreshDashboardStats();
            }

            // Refresh reports if initialized
            if (window.reportsManager && window.reportsManager.initialized) {
                await window.reportsManager.loadAllData();
            }

            // Show success message modal
            this.showSuccessMessage(saleData);
            
            // Reset form
            this.cart = [];
            this.selectedCustomer = null;
            this.discount = 0;
            this.creditTerm = 'immediate';
            document.getElementById('b2bCustomerSelect').value = '';
            document.getElementById('b2bDiscountValue').value = '0';
            document.getElementById('customerQuickInfo').innerHTML = '<div class="info-placeholder">Select a customer to see details</div>';
            this.renderCart();
            this.updateTotals();

        } catch (error) {
            console.error('Error completing B2B sale:', error);
            this.showNotification('Error completing sale. Please try again.', 'error');
        }
    }

    // Show success message modal
    showSuccessMessage(sale) {
        const modal = document.createElement('div');
        modal.className = 'pos-modal success-modal';
        modal.innerHTML = `
            <div class="pos-modal-overlay"></div>
            <div class="pos-modal-content success-modal-content">
                <div class="success-icon-container">
                    <svg class="success-checkmark" width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10" stroke="#10b981" fill="#d1fae5"></circle>
                        <polyline points="8 12 11 15 16 9" stroke="#10b981" stroke-width="3"></polyline>
                    </svg>
                </div>
                <h2 class="success-title">Wholesale Order Created Successfully!</h2>
                <p class="success-message">Invoice #${sale.saleNumber} has been generated</p>
                
                <div class="success-details">
                    <div class="success-detail-row">
                        <span>Customer:</span>
                        <strong>${sale.customer}</strong>
                    </div>
                    <div class="success-detail-row">
                        <span>Items:</span>
                        <strong>${sale.items.length} products</strong>
                    </div>
                    <div class="success-detail-row">
                        <span>Total Amount:</span>
                        <strong class="success-amount">${this.formatCurrency(sale.total)}</strong>
                    </div>
                    <div class="success-detail-row">
                        <span>Payment Terms:</span>
                        <strong>${this.formatCreditTerm(sale.creditTerm)}</strong>
                    </div>
                    <div class="success-detail-row">
                        <span>Status:</span>
                        <span class="status-badge ${sale.status === 'completed' ? 'success' : 'warning'}">${sale.status === 'completed' ? 'Completed' : 'Pending'}</span>
                    </div>
                </div>

                <div class="success-actions">
                    <button onclick="window.newB2BSaleManager.printInvoice('${sale.saleNumber}'); this.closest('.pos-modal').remove();" class="btn btn-primary btn-large">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="6 9 6 2 18 2 18 9"></polyline>
                            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                            <rect x="6" y="14" width="12" height="8"></rect>
                        </svg>
                        Print Invoice
                    </button>
                    <button onclick="this.closest('.pos-modal').remove(); document.querySelector('[data-page=\\'b2b-sales\\']').click();" class="btn btn-secondary btn-large">
                        View All B2B Sales
                    </button>
                    <button onclick="this.closest('.pos-modal').remove();" class="btn btn-outline btn-large">
                        Create Another Order
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        setTimeout(() => modal.classList.add('show'), 10);
    }

    // Print invoice from success modal
    printInvoice(saleNumber) {
        // Since we just completed the sale, we can use the most recent data
        // In a real app, you'd fetch from the database
        const printWindow = window.open('', '', 'height=800,width=600');
        printWindow.document.write(`
            <html>
            <head>
                <title>Invoice ${saleNumber}</title>
                <style>
                    body { font-family: Arial, sans-serif; padding: 20px; }
                    h1 { text-align: center; color: #333; }
                    .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #333; padding-bottom: 20px; }
                    .info { margin: 20px 0; }
                    .info-row { display: flex; justify-content: space-between; margin: 5px 0; }
                    .message { background: #d1fae5; padding: 15px; border-radius: 8px; margin: 20px 0; text-align: center; }
                    .message strong { color: #059669; }
                </style>
            </head>
            <body>
                <div class="header">
                    <h1>WHOLESALE INVOICE</h1>
                    <p><strong>Invoice #:</strong> ${saleNumber}</p>
                </div>
                <div class="message">
                    <strong>✓ Wholesale Order Successfully Created!</strong>
                    <p>Thank you for your business</p>
                </div>
                <script>window.print(); window.onafterprint = function(){ window.close(); }</script>
            </body>
            </html>
        `);
        printWindow.document.close();
    }

    // Format credit term
    formatCreditTerm(term) {
        const terms = {
            'immediate': 'Immediate Payment',
            'net30': 'Net 30 Days',
            'net60': 'Net 60 Days',
            'net90': 'Net 90 Days'
        };
        return terms[term] || term || 'Immediate';
    }

    // Generate sale number
    generateSaleNumber() {
        const date = new Date();
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const time = String(date.getHours()) + String(date.getMinutes()) + String(date.getSeconds());
        return `B2B-${year}${month}${day}-${time}`;
    }

    // Show invoice dialog
    showInvoice(sale) {
        const modal = document.createElement('div');
        modal.className = 'pos-modal';
        modal.innerHTML = `
            <div class="pos-modal-overlay"></div>
            <div class="pos-modal-content invoice-modal">
                <div class="pos-modal-header">
                    <h3>Wholesale Invoice</h3>
                    <button class="modal-close" onclick="this.closest('.pos-modal').remove()">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
                <div class="pos-modal-body">
                    <div class="invoice-content">
                        <div class="invoice-header">
                            <h2>WHOLESALE INVOICE</h2>
                            <p><strong>Invoice #:</strong> ${sale.saleNumber}</p>
                            <p><strong>Date:</strong> ${new Date(sale.createdAt).toLocaleString()}</p>
                            <p><strong>Branch:</strong> ${sale.branchName}</p>
                        </div>
                        
                        <div class="invoice-customer">
                            <h4>Bill To:</h4>
                            <p><strong>${sale.customer}</strong></p>
                            <p>${sale.customerPhone || ''}</p>
                        </div>

                        <table class="invoice-table">
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
                                ${sale.items.map(item => `
                                    <tr>
                                        <td>${item.name}</td>
                                        <td>${item.sku || 'N/A'}</td>
                                        <td>${this.formatCurrency(item.price)}</td>
                                        <td>${item.quantity}</td>
                                        <td>${this.formatCurrency(item.total)}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>

                        <div class="invoice-totals">
                            <div class="total-row">
                                <span>Subtotal:</span>
                                <span>${this.formatCurrency(sale.subtotal)}</span>
                            </div>
                            <div class="total-row">
                                <span>Discount:</span>
                                <span>-${this.formatCurrency(sale.discount)}</span>
                            </div>
                            <div class="total-row grand-total">
                                <span>Grand Total:</span>
                                <span>${this.formatCurrency(sale.total)}</span>
                            </div>
                        </div>

                        <div class="invoice-footer">
                            <p><strong>Payment Terms:</strong> ${sale.creditTerm === 'immediate' ? 'Immediate Payment' : sale.creditTerm.toUpperCase()}</p>
                            <p><strong>Payment Method:</strong> ${sale.paymentMethod}</p>
                            <p style="margin-top: 20px; font-size: 0.9em; color: #666;">
                                Thank you for your business!
                            </p>
                        </div>
                    </div>
                </div>
                <div class="pos-modal-footer">
                    <button onclick="window.print()" class="btn btn-primary">
                        Print Invoice
                    </button>
                    <button onclick="this.closest('.pos-modal').remove()" class="btn btn-secondary">
                        Close
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        setTimeout(() => modal.classList.add('show'), 10);
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

        setTimeout(() => notification.classList.add('show'), 100);
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }
}

// Create and export instance
const newB2BSaleManager = new NewB2BSaleManager();
export default newB2BSaleManager;

// Make available globally
window.newB2BSaleManager = newB2BSaleManager;
