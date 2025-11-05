// POS System - Real-time Point of Sale Module
import { db, collection, addDoc, getDocs, doc, updateDoc, deleteDoc, query, where, orderBy, limit } from './firebase-config.js';
import branchManager from './branch-manager.js';
import dataManager from './data-manager.js';

class POSSystem {
    constructor() {
        this.cart = [];
        this.discount = 0;
        this.discountType = 'percent'; // 'percent' or 'fixed'
        this.tax = 0;
        this.taxType = 'percent'; // 'percent' or 'fixed'
        this.inventory = [];
        this.todayStats = {
            sales: 0,
            profit: 0,
            itemsSold: 0,
            transactions: 0,
            revenue: 0
        };
        this.searchTimeout = null;
    }

    async init() {
        console.log('🛒 Initializing POS System...');
        await this.loadInventory();
        await this.loadTodayStats();
        this.renderStats();
        this.attachEventListeners();
        this.startRealtimeSync();
        console.log('✅ POS System ready');
    }

    // Load all inventory items for search
    async loadInventory() {
        try {
            this.inventory = await dataManager.getInventory();
            console.log(`📦 Loaded ${this.inventory.length} items from inventory`);
        } catch (error) {
            console.error('Error loading inventory:', error);
            this.showNotification('Error loading inventory', 'error');
        }
    }

    // Load today's sales statistics
    async loadTodayStats() {
        try {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            const sales = await dataManager.getSales({
                startDate: today.toISOString()
            });

            this.todayStats = {
                sales: sales.length,
                profit: sales.reduce((sum, sale) => sum + (sale.profit || 0), 0),
                itemsSold: sales.reduce((sum, sale) => sum + (sale.items?.length || 0), 0),
                transactions: sales.length,
                revenue: sales.reduce((sum, sale) => sum + (sale.total || 0), 0)
            };
        } catch (error) {
            console.error('Error loading today stats:', error);
        }
    }

    // Start real-time sync for stats
    startRealtimeSync() {
        // Refresh stats every 30 seconds
        setInterval(() => {
            this.loadTodayStats();
            this.renderStats();
        }, 30000);
    }

    // Render statistics cards
    renderStats() {
        const statsHTML = `
            <div class="pos-stat-card">
                <div class="pos-stat-icon" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="12" y1="1" x2="12" y2="23"></line>
                        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                    </svg>
                </div>
                <div class="pos-stat-content">
                    <div class="pos-stat-label">Revenue</div>
                    <div class="pos-stat-value">KES ${this.formatCurrency(this.todayStats.revenue)}</div>
                </div>
            </div>
            <div class="pos-stat-card">
                <div class="pos-stat-icon" style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                    </svg>
                </div>
                <div class="pos-stat-content">
                    <div class="pos-stat-label">Profit</div>
                    <div class="pos-stat-value">KES ${this.formatCurrency(this.todayStats.profit)}</div>
                </div>
            </div>
            <div class="pos-stat-card">
                <div class="pos-stat-icon" style="background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                    </svg>
                </div>
                <div class="pos-stat-content">
                    <div class="pos-stat-label">Items Sold</div>
                    <div class="pos-stat-value">${this.todayStats.itemsSold}</div>
                </div>
            </div>
            <div class="pos-stat-card">
                <div class="pos-stat-icon" style="background: linear-gradient(135deg, #fa709a 0%, #fee140 100%);">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="9" cy="21" r="1"></circle>
                        <circle cx="20" cy="21" r="1"></circle>
                        <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
                    </svg>
                </div>
                <div class="pos-stat-content">
                    <div class="pos-stat-label">Transactions</div>
                    <div class="pos-stat-value">${this.todayStats.transactions}</div>
                </div>
            </div>
        `;
        
        const statsContainer = document.getElementById('posStatsContainer');
        if (statsContainer) {
            statsContainer.innerHTML = statsHTML;
        }
    }

    // Attach event listeners
    attachEventListeners() {
        // Search input with debounce
        const searchInput = document.getElementById('posSearchInput');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                clearTimeout(this.searchTimeout);
                this.searchTimeout = setTimeout(() => {
                    this.searchItems(e.target.value);
                }, 300);
            });

            searchInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    clearTimeout(this.searchTimeout);
                    this.searchItems(e.target.value);
                }
            });
        }

        // Discount inputs
        const discountInput = document.getElementById('posDiscountInput');
        const discountType = document.getElementById('posDiscountType');
        if (discountInput) {
            discountInput.addEventListener('input', (e) => {
                this.discount = parseFloat(e.target.value) || 0;
                this.updateTotals();
            });
        }
        if (discountType) {
            discountType.addEventListener('change', (e) => {
                this.discountType = e.target.value;
                this.updateTotals();
            });
        }

        // Tax inputs
        const taxInput = document.getElementById('posTaxInput');
        const taxType = document.getElementById('posTaxType');
        if (taxInput) {
            taxInput.addEventListener('input', (e) => {
                this.tax = parseFloat(e.target.value) || 0;
                this.updateTotals();
            });
        }
        if (taxType) {
            taxType.addEventListener('change', (e) => {
                this.taxType = e.target.value;
                this.updateTotals();
            });
        }

        // Clear cart button
        const clearCartBtn = document.getElementById('posClearCart');
        if (clearCartBtn) {
            clearCartBtn.addEventListener('click', () => this.clearCart());
        }

        // Complete sale button
        const completeSaleBtn = document.getElementById('posCompleteSale');
        if (completeSaleBtn) {
            completeSaleBtn.addEventListener('click', () => this.completeSale());
        }

        // Manual entry button
        const manualEntryBtn = document.getElementById('posManualEntry');
        if (manualEntryBtn) {
            manualEntryBtn.addEventListener('click', () => this.showManualEntryDialog());
        }
    }

    // Search items in inventory
    searchItems(searchTerm) {
        const resultsContainer = document.getElementById('posSearchResults');
        if (!resultsContainer) return;

        if (!searchTerm || searchTerm.trim().length < 2) {
            resultsContainer.innerHTML = '';
            resultsContainer.style.display = 'none';
            return;
        }

        const term = searchTerm.toLowerCase().trim();
        const results = this.inventory.filter(item => {
            return (
                item.name.toLowerCase().includes(term) ||
                (item.barcode && item.barcode.toLowerCase().includes(term)) ||
                (item.sku && item.sku.toLowerCase().includes(term)) ||
                (item.category && item.category.toLowerCase().includes(term))
            );
        }).slice(0, 10); // Limit to 10 results

        if (results.length === 0) {
            resultsContainer.innerHTML = '<div class="pos-no-results">No items found</div>';
            resultsContainer.style.display = 'block';
            return;
        }

        const resultsHTML = results.map(item => {
            // Use price field (matches add-item.js structure)
            const itemPrice = item.price || item.sellingPrice || 0;
            const itemStock = item.quantity || item.stock || 0;
            
            return `
                <div class="pos-search-item" onclick="posSystem.addToCart('${item.id}')">
                    <div class="pos-search-item-info">
                        <div class="pos-search-item-name">${item.name}</div>
                        <div class="pos-search-item-details">
                            ${item.barcode ? `<span>Barcode: ${item.barcode}</span>` : ''}
                            ${item.sku ? `<span>SKU: ${item.sku}</span>` : ''}
                            <span>Stock: ${itemStock}</span>
                        </div>
                    </div>
                    <div class="pos-search-item-price">KES ${this.formatCurrency(itemPrice)}</div>
                </div>
            `;
        }).join('');

        resultsContainer.innerHTML = resultsHTML;
        resultsContainer.style.display = 'block';
    }

    // Add item to cart
    addToCart(itemId) {
        const item = this.inventory.find(i => i.id === itemId);
        if (!item) {
            this.showNotification('Item not found', 'error');
            return;
        }

        // Use quantity or stock field
        const itemStock = item.quantity || item.stock || 0;
        
        if (itemStock <= 0) {
            this.showNotification('Item out of stock', 'error');
            return;
        }

        // Check if item already in cart
        const existingItem = this.cart.find(i => i.id === itemId);
        if (existingItem) {
            if (existingItem.quantity >= itemStock) {
                this.showNotification('Cannot exceed available stock', 'error');
                return;
            }
            existingItem.quantity++;
        } else {
            // Use price field (matches add-item.js structure)
            const itemPrice = item.price || item.sellingPrice || 0;
            const itemCost = item.cost || item.buyingPrice || 0;
            
            this.cart.push({
                id: item.id,
                name: item.name,
                price: itemPrice,
                cost: itemCost,
                quantity: 1,
                maxStock: itemStock,
                barcode: item.barcode || '',
                sku: item.sku || ''
            });
        }

        this.renderCart();
        this.updateTotals();
        
        // Clear search
        const searchInput = document.getElementById('posSearchInput');
        if (searchInput) {
            searchInput.value = '';
        }
        const resultsContainer = document.getElementById('posSearchResults');
        if (resultsContainer) {
            resultsContainer.innerHTML = '';
            resultsContainer.style.display = 'none';
        }

        this.showNotification('Item added to cart', 'success');
    }

    // Render cart items
    renderCart() {
        const cartContainer = document.getElementById('posCartItems');
        if (!cartContainer) return;

        if (this.cart.length === 0) {
            cartContainer.innerHTML = `
                <div class="pos-empty-cart">
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <circle cx="9" cy="21" r="1"></circle>
                        <circle cx="20" cy="21" r="1"></circle>
                        <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
                    </svg>
                    <p>Cart is empty</p>
                    <span>Search and add items to start a sale</span>
                </div>
            `;
            return;
        }

        const cartHTML = this.cart.map((item, index) => `
            <div class="pos-cart-item">
                <div class="pos-cart-item-info">
                    <div class="pos-cart-item-name">${item.name}</div>
                    <div class="pos-cart-item-meta">
                        ${item.barcode ? `Barcode: ${item.barcode} • ` : ''}
                        KES ${this.formatCurrency(item.price)} each
                    </div>
                </div>
                <div class="pos-cart-item-controls">
                    <div class="pos-quantity-control">
                        <button class="pos-qty-btn" onclick="posSystem.updateQuantity(${index}, -1)">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <line x1="5" y1="12" x2="19" y2="12"></line>
                            </svg>
                        </button>
                        <input type="number" 
                               class="pos-qty-input" 
                               value="${item.quantity}" 
                               min="1" 
                               max="${item.maxStock}"
                               onchange="posSystem.setQuantity(${index}, this.value)">
                        <button class="pos-qty-btn" onclick="posSystem.updateQuantity(${index}, 1)">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <line x1="12" y1="5" x2="12" y2="19"></line>
                                <line x1="5" y1="12" x2="19" y2="12"></line>
                            </svg>
                        </button>
                    </div>
                    <div class="pos-cart-item-price">KES ${this.formatCurrency(item.price * item.quantity)}</div>
                    <button class="pos-remove-btn" onclick="posSystem.removeFromCart(${index})">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
            </div>
        `).join('');

        cartContainer.innerHTML = cartHTML;
    }

    // Update item quantity
    updateQuantity(index, change) {
        const item = this.cart[index];
        const newQuantity = item.quantity + change;

        if (newQuantity <= 0) {
            this.removeFromCart(index);
            return;
        }

        if (newQuantity > item.maxStock) {
            this.showNotification('Cannot exceed available stock', 'error');
            return;
        }

        item.quantity = newQuantity;
        this.renderCart();
        this.updateTotals();
    }

    // Set item quantity directly
    setQuantity(index, value) {
        const item = this.cart[index];
        const newQuantity = parseInt(value) || 1;

        if (newQuantity <= 0) {
            this.removeFromCart(index);
            return;
        }

        if (newQuantity > item.maxStock) {
            this.showNotification('Cannot exceed available stock', 'error');
            item.quantity = item.maxStock;
        } else {
            item.quantity = newQuantity;
        }

        this.renderCart();
        this.updateTotals();
    }

    // Remove item from cart
    removeFromCart(index) {
        this.cart.splice(index, 1);
        this.renderCart();
        this.updateTotals();
        this.showNotification('Item removed from cart', 'info');
    }

    // Clear entire cart
    clearCart() {
        if (this.cart.length === 0) return;

        if (confirm('Are you sure you want to clear the cart?')) {
            this.cart = [];
            this.discount = 0;
            this.tax = 0;
            
            const discountInput = document.getElementById('posDiscountInput');
            const taxInput = document.getElementById('posTaxInput');
            if (discountInput) discountInput.value = '';
            if (taxInput) taxInput.value = '';
            
            this.renderCart();
            this.updateTotals();
            this.showNotification('Cart cleared', 'info');
        }
    }

    // Update totals and calculations
    updateTotals() {
        const subtotal = this.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        
        let discountAmount = 0;
        if (this.discountType === 'percent') {
            discountAmount = (subtotal * this.discount) / 100;
        } else {
            discountAmount = this.discount;
        }

        const afterDiscount = subtotal - discountAmount;

        let taxAmount = 0;
        if (this.taxType === 'percent') {
            taxAmount = (afterDiscount * this.tax) / 100;
        } else {
            taxAmount = this.tax;
        }

        const total = afterDiscount + taxAmount;

        // Update UI
        document.getElementById('posSubtotal').textContent = `KES ${this.formatCurrency(subtotal)}`;
        document.getElementById('posDiscountAmount').textContent = `-KES ${this.formatCurrency(discountAmount)}`;
        document.getElementById('posTaxAmount').textContent = `+KES ${this.formatCurrency(taxAmount)}`;
        document.getElementById('posTotal').textContent = `KES ${this.formatCurrency(total)}`;
    }

    // Complete sale
    async completeSale() {
        if (this.cart.length === 0) {
            this.showNotification('Cart is empty', 'error');
            return;
        }

        const completeSaleBtn = document.getElementById('posCompleteSale');
        if (completeSaleBtn) {
            completeSaleBtn.disabled = true;
            completeSaleBtn.innerHTML = '<span class="btn-spinner"></span> Processing...';
        }

        try {
            // Calculate totals
            const subtotal = this.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
            const cost = this.cart.reduce((sum, item) => sum + (item.cost * item.quantity), 0);
            
            let discountAmount = 0;
            if (this.discountType === 'percent') {
                discountAmount = (subtotal * this.discount) / 100;
            } else {
                discountAmount = this.discount;
            }

            const afterDiscount = subtotal - discountAmount;

            let taxAmount = 0;
            if (this.taxType === 'percent') {
                taxAmount = (afterDiscount * this.tax) / 100;
            } else {
                taxAmount = this.tax;
            }

            const total = afterDiscount + taxAmount;
            const profit = total - cost;

            // Create sale data
            const saleData = {
                items: this.cart.map(item => ({
                    id: item.id,
                    name: item.name,
                    quantity: item.quantity,
                    price: item.price,
                    cost: item.cost,
                    total: item.price * item.quantity
                })),
                subtotal: subtotal,
                discount: discountAmount,
                discountType: this.discountType,
                discountValue: this.discount,
                tax: taxAmount,
                taxType: this.taxType,
                taxValue: this.tax,
                total: total,
                profit: profit,
                paymentMethod: 'cash', // Can be extended for multiple payment methods
                status: 'completed',
                saleType: 'pos',
                createdAt: new Date().toISOString()
            };

            // Save sale
            const sale = await dataManager.createSale(saleData);

            // Update inventory stock
            for (const item of this.cart) {
                if (item.isManual) continue; // Skip manual entries (not in inventory)
                
                const inventoryItem = this.inventory.find(i => i.id === item.id);
                if (inventoryItem) {
                    // Use quantity or stock field (matches the structure from add-item.js)
                    const currentStock = inventoryItem.quantity || inventoryItem.stock || 0;
                    const newStock = currentStock - item.quantity;
                    
                    // Update using 'quantity' field to match add-item.js structure
                    await dataManager.updateInventoryItem(item.id, { 
                        quantity: newStock,
                        stock: newStock // Update both for compatibility
                    });
                    
                    // Update local cache
                    if ('quantity' in inventoryItem) {
                        inventoryItem.quantity = newStock;
                    }
                    if ('stock' in inventoryItem) {
                        inventoryItem.stock = newStock;
                    }
                }
            }

            // Clear cart and reset
            this.cart = [];
            this.discount = 0;
            this.tax = 0;
            
            const discountInput = document.getElementById('posDiscountInput');
            const taxInput = document.getElementById('posTaxInput');
            if (discountInput) discountInput.value = '';
            if (taxInput) taxInput.value = '';

            this.renderCart();
            this.updateTotals();

            // Reload stats
            await this.loadTodayStats();
            this.renderStats();
            
            // Reload POS inventory to reflect stock changes
            await this.loadInventory();
            
            // Refresh inventory if on inventory page
            if (window.inventoryManager && typeof window.inventoryManager.refresh === 'function') {
                try {
                    await window.inventoryManager.refresh();
                    console.log('✅ Inventory refreshed after sale');
                } catch (error) {
                    console.error('Error refreshing inventory:', error);
                }
            }

            // Show success message
            this.showNotification(`Sale completed! Total: KES ${this.formatCurrency(total)}`, 'success');
            
            // Print receipt (optional)
            this.showReceiptDialog(sale);

        } catch (error) {
            console.error('Error completing sale:', error);
            this.showNotification('Error completing sale', 'error');
        } finally {
            if (completeSaleBtn) {
                completeSaleBtn.disabled = false;
                completeSaleBtn.innerHTML = `
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                    Complete Sale
                `;
            }
        }
    }

    // Show manual entry dialog
    showManualEntryDialog() {
        const modal = document.createElement('div');
        modal.className = 'pos-modal';
        modal.innerHTML = `
            <div class="pos-modal-content">
                <div class="pos-modal-header">
                    <h3>Manual Item Entry</h3>
                    <button class="pos-modal-close" onclick="this.closest('.pos-modal').remove()">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
                <div class="pos-modal-body">
                    <div class="form-group">
                        <label>Item Name *</label>
                        <input type="text" id="manualItemName" class="form-input" placeholder="Enter item name">
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label>Price (KES) *</label>
                            <input type="number" id="manualItemPrice" class="form-input" placeholder="0.00" step="0.01" min="0">
                        </div>
                        <div class="form-group">
                            <label>Quantity *</label>
                            <input type="number" id="manualItemQty" class="form-input" placeholder="1" value="1" min="1">
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Barcode (Optional)</label>
                        <input type="text" id="manualItemBarcode" class="form-input" placeholder="Enter barcode">
                    </div>
                </div>
                <div class="pos-modal-footer">
                    <button class="btn-secondary" onclick="this.closest('.pos-modal').remove()">Cancel</button>
                    <button class="btn-primary" onclick="posSystem.addManualItem()">Add to Cart</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        document.getElementById('manualItemName').focus();
    }

    // Add manual item to cart
    addManualItem() {
        const name = document.getElementById('manualItemName').value.trim();
        const price = parseFloat(document.getElementById('manualItemPrice').value) || 0;
        const quantity = parseInt(document.getElementById('manualItemQty').value) || 1;
        const barcode = document.getElementById('manualItemBarcode').value.trim();

        if (!name) {
            this.showNotification('Please enter item name', 'error');
            return;
        }

        if (price <= 0) {
            this.showNotification('Please enter valid price', 'error');
            return;
        }

        this.cart.push({
            id: 'manual_' + Date.now(),
            name: name,
            price: price,
            cost: 0,
            quantity: quantity,
            maxStock: 999999,
            barcode: barcode,
            sku: '',
            isManual: true
        });

        this.renderCart();
        this.updateTotals();
        
        // Close modal
        document.querySelector('.pos-modal').remove();
        
        this.showNotification('Manual item added to cart', 'success');
    }

    // Show receipt dialog
    showReceiptDialog(sale) {
        const modal = document.createElement('div');
        modal.className = 'pos-modal';
        
        const itemsHTML = sale.items.map(item => `
            <tr>
                <td>${item.name}</td>
                <td>${item.quantity}</td>
                <td>KES ${this.formatCurrency(item.price)}</td>
                <td>KES ${this.formatCurrency(item.total)}</td>
            </tr>
        `).join('');

        modal.innerHTML = `
            <div class="pos-modal-content pos-receipt-modal">
                <div class="pos-modal-header">
                    <h3>Sale Completed</h3>
                    <button class="pos-modal-close" onclick="this.closest('.pos-modal').remove()">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
                <div class="pos-modal-body">
                    <div class="pos-receipt">
                        <div class="receipt-header">
                            <h2>Vendify POS</h2>
                            <p>Receipt #${sale.id.substring(0, 8).toUpperCase()}</p>
                            <p>${new Date().toLocaleString()}</p>
                        </div>
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
                        <div class="receipt-totals">
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
                        </div>
                        <div class="receipt-footer">
                            <p>Thank you for your purchase!</p>
                        </div>
                    </div>
                </div>
                <div class="pos-modal-footer">
                    <button class="btn-secondary" onclick="this.closest('.pos-modal').remove()">Close</button>
                    <button class="btn-primary" onclick="window.print()">
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

    // Format currency
    formatCurrency(amount) {
        return parseFloat(amount).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    // Show notification
    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `pos-notification pos-notification-${type}`;
        notification.textContent = message;
        document.body.appendChild(notification);

        setTimeout(() => {
            notification.classList.add('show');
        }, 10);

        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }
}

// Initialize POS system
const posSystem = new POSSystem();

// Export for global access
window.posSystem = posSystem;

export default posSystem;
