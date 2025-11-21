// POS System - Real-time Point of Sale Module
import { db, collection, addDoc, getDocs, doc, updateDoc, deleteDoc, query, where, orderBy, limit } from './firebase-config.js';
import branchManager from './branch-manager.js';
import dataManager from './data-manager.js';
import auditLogger from './audit-logger.js';

class POSSystem {
    constructor() {
        this.cart = [];
        this.discount = 0;
        this.discountType = 'percent'; // 'percent' or 'fixed'
        this.tax = 0;
        this.taxType = 'percent'; // 'percent' or 'fixed'
        this.inventory = [];
        this.heldSales = []; // Store held sales
        this.todayStats = {
            sales: 0,
            profit: 0,
            itemsSold: 0,
            transactions: 0,
            revenue: 0
        };
        this.searchTimeout = null;
        this.scannerStream = null;
        this.scannerActive = false;
        this.lastScannedCode = null;
        this.scanCooldown = false;
        
        // Physical barcode scanner support
        this.barcodeBuffer = '';
        this.barcodeTimeout = null;
        this.scannerInputSpeed = 50; // ms between characters (scanners type fast)
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
                <div class="pos-stat-icon" style="background: #667eea;">
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
                <div class="pos-stat-icon" style="background: #f5576c;">
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
                <div class="pos-stat-icon" style="background: #4facfe;">
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
                <div class="pos-stat-icon" style="background: #fa709a;">
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
            // Physical barcode scanner detection
            searchInput.addEventListener('keydown', (e) => {
                this.handleBarcodeScanner(e);
            });

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

            // Keep focus on search input for barcode scanner
            searchInput.addEventListener('blur', () => {
                // Auto-refocus after a short delay if on POS page
                setTimeout(() => {
                    const posPage = document.getElementById('pos-page');
                    if (posPage && posPage.classList.contains('active')) {
                        searchInput.focus();
                    }
                }, 100);
            });

            // Focus on load
            setTimeout(() => searchInput.focus(), 500);
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

        // Barcode scanner button
        const scanBarcodeBtn = document.getElementById('posScanBarcode');
        if (scanBarcodeBtn) {
            scanBarcodeBtn.addEventListener('click', () => this.openBarcodeScanner());
        }

        // Close scanner button
        const closeScannerBtn = document.getElementById('closePOSScannerBtn');
        if (closeScannerBtn) {
            closeScannerBtn.addEventListener('click', () => this.closeBarcodeScanner());
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

    // Handle physical barcode scanner input
    handleBarcodeScanner(e) {
        // Detect rapid keyboard input (characteristic of barcode scanners)
        const char = e.key;
        
        // Ignore special keys except Enter
        if (char.length > 1 && char !== 'Enter') {
            return;
        }

        // Clear previous timeout
        clearTimeout(this.barcodeTimeout);

        if (char === 'Enter') {
            // Enter key pressed - process the barcode
            if (this.barcodeBuffer.length > 3) { // Minimum barcode length
                e.preventDefault();
                this.processBarcodeFromScanner(this.barcodeBuffer);
                this.barcodeBuffer = '';
                
                // Clear the search input
                const searchInput = document.getElementById('posSearchInput');
                if (searchInput) {
                    searchInput.value = '';
                }
            }
        } else {
            // Add character to buffer
            this.barcodeBuffer += char;
            
            // Reset buffer after delay (if typing is slow, it's manual input)
            this.barcodeTimeout = setTimeout(() => {
                this.barcodeBuffer = '';
            }, this.scannerInputSpeed);
        }
    }

    // Process barcode from physical scanner
    processBarcodeFromScanner(barcode) {
        console.log('🔍 Barcode scanner input:', barcode);

        // Clean the barcode (remove any whitespace)
        const cleanBarcode = barcode.trim();

        // Find item by barcode or SKU
        const item = this.inventory.find(i => 
            (i.barcode && i.barcode.toLowerCase() === cleanBarcode.toLowerCase()) ||
            (i.sku && i.sku.toLowerCase() === cleanBarcode.toLowerCase())
        );

        if (item) {
            // Add to cart
            this.addToCart(item.id);
            
            // Visual feedback
            this.showBarcodeScannedFeedback(item.name, cleanBarcode);
            
            // Play beep sound
            this.playBeep();
            
            console.log(`✅ Item added via barcode scanner: ${item.name}`);
        } else {
            // Item not found
            this.showNotification(`Item not found: ${cleanBarcode}`, 'error');
            console.log(`❌ No item found for barcode: ${cleanBarcode}`);
        }
    }

    // Show visual feedback for scanned item
    showBarcodeScannedFeedback(itemName, barcode) {
        // Create temporary notification
        const feedback = document.createElement('div');
        feedback.className = 'barcode-scan-feedback';
        feedback.innerHTML = `
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <div>
                <div class="feedback-title">Scanned!</div>
                <div class="feedback-item">${itemName}</div>
                <div class="feedback-code">${barcode}</div>
            </div>
        `;

        document.body.appendChild(feedback);

        // Animate in
        setTimeout(() => feedback.classList.add('show'), 10);

        // Remove after 2 seconds
        setTimeout(() => {
            feedback.classList.remove('show');
            setTimeout(() => feedback.remove(), 300);
        }, 2000);
    }

    // Open barcode scanner
    async openBarcodeScanner() {
        const modal = document.getElementById('posScannerModal');
        const video = document.getElementById('posScannerVideo');
        const statusDiv = document.getElementById('posScannerStatus');

        if (!modal || !video) return;

        modal.classList.add('active');
        this.scannerActive = true;

        try {
            // Request camera access
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { 
                    facingMode: 'environment',
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                } 
            });
            
            video.srcObject = stream;
            this.scannerStream = stream;

            // Update status
            if (statusDiv) {
                statusDiv.innerHTML = `
                    <span class="status-indicator active"></span>
                    <span class="status-text">Scanning... Position barcode in frame</span>
                `;
            }

            // Load QuaggaJS for barcode scanning if not loaded
            if (typeof Quagga === 'undefined') {
                await this.loadQuagga();
            }

            // Initialize Quagga
            Quagga.init({
                inputStream: {
                    name: 'Live',
                    type: 'LiveStream',
                    target: video,
                    constraints: {
                        facingMode: 'environment'
                    }
                },
                decoder: {
                    readers: [
                        'code_128_reader', 
                        'ean_reader', 
                        'ean_8_reader', 
                        'upc_reader',
                        'code_39_reader'
                    ]
                },
                locate: true
            }, (err) => {
                if (err) {
                    console.error('Error initializing Quagga:', err);
                    this.showNotification('Failed to start scanner', 'error');
                    this.closeBarcodeScanner();
                    return;
                }
                Quagga.start();
            });

            // Listen for detected barcodes
            Quagga.onDetected((data) => {
                if (this.scannerActive && data && data.codeResult && data.codeResult.code) {
                    const barcode = data.codeResult.code;
                    this.handleScannedBarcode(barcode);
                }
            });

        } catch (error) {
            console.error('Error accessing camera:', error);
            this.showNotification('Camera access denied or not available', 'error');
            modal.classList.remove('active');
            this.scannerActive = false;
        }
    }

    // Close barcode scanner
    closeBarcodeScanner() {
        const modal = document.getElementById('posScannerModal');
        const resultDiv = document.getElementById('posScannerResult');

        if (modal) {
            modal.classList.remove('active');
        }

        if (resultDiv) {
            resultDiv.style.display = 'none';
        }

        this.scannerActive = false;

        // Stop Quagga
        if (typeof Quagga !== 'undefined') {
            Quagga.stop();
        }

        // Stop camera stream
        if (this.scannerStream) {
            this.scannerStream.getTracks().forEach(track => track.stop());
            this.scannerStream = null;
        }
    }

    // Handle scanned barcode
    handleScannedBarcode(barcode) {
        // Prevent duplicate scans (cooldown of 1 second)
        if (this.scanCooldown || barcode === this.lastScannedCode) {
            return;
        }

        console.log('📷 Scanned barcode:', barcode);

        // Find item by barcode or SKU
        const item = this.inventory.find(i => 
            (i.barcode && i.barcode.toLowerCase() === barcode.toLowerCase()) ||
            (i.sku && i.sku.toLowerCase() === barcode.toLowerCase())
        );

        const resultDiv = document.getElementById('posScannerResult');
        const itemNameDiv = document.getElementById('scannedItemName');
        const itemCodeDiv = document.getElementById('scannedItemCode');

        if (item) {
            // Add to cart
            this.addToCart(item.id);

            // Show success message
            if (resultDiv && itemNameDiv && itemCodeDiv) {
                itemNameDiv.textContent = item.name;
                itemCodeDiv.textContent = `${item.sku ? 'SKU: ' + item.sku : 'Barcode: ' + barcode}`;
                resultDiv.style.display = 'flex';

                // Hide after 2 seconds
                setTimeout(() => {
                    if (resultDiv) resultDiv.style.display = 'none';
                }, 2000);
            }

            // Play success sound (optional)
            this.playBeep();

        } else {
            this.showNotification(`Item not found: ${barcode}`, 'error');
        }

        // Set cooldown
        this.lastScannedCode = barcode;
        this.scanCooldown = true;
        setTimeout(() => {
            this.scanCooldown = false;
            this.lastScannedCode = null;
        }, 1000);
    }

    // Load QuaggaJS library
    loadQuagga() {
        return new Promise((resolve, reject) => {
            if (typeof Quagga !== 'undefined') {
                resolve();
                return;
            }

            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/quagga@0.12.1/dist/quagga.min.js';
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    // Play beep sound
    playBeep() {
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);

            oscillator.frequency.value = 800;
            oscillator.type = 'sine';

            gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);

            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.1);
        } catch (error) {
            // Silently fail if audio not supported
        }
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

        // Check if item already in cart (check by both id AND name to catch duplicates)
        const existingItem = this.cart.find(i => i.id === itemId || (i.name === item.name && !i.isManual));
        if (existingItem) {
            if (existingItem.quantity >= itemStock) {
                this.showNotification('Cannot exceed available stock', 'error');
                return;
            }
            existingItem.quantity++;
            console.log(`✅ Updated quantity for "${item.name}" to ${existingItem.quantity}`);
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
            console.log(`✅ Added new item to cart: "${item.name}"`);
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

            let sale = null;
            let saleCreated = false;

            try {
                // Save sale to database
                console.log('💾 Saving sale to database...');
                sale = await dataManager.createSale(saleData);
                saleCreated = true;
                console.log('✅ Sale saved successfully:', sale.id);
            } catch (saleError) {
                console.error('❌ Failed to save sale to database:', saleError);
                throw new Error(`Failed to save sale: ${saleError.message}`);
            }

            // Log POS sale to audit trail
            await auditLogger.logSale('POS', {
                total: total,
                items: this.cart,
                itemCount: this.cart.length,
                customerName: 'Walk-in',
                discount: discountAmount,
                tax: taxAmount
            });

            // Update inventory stock (non-critical - sale already saved)
            try {
                console.log('📦 Updating inventory stock...');
                for (const item of this.cart) {
                    if (item.isManual) continue; // Skip manual entries (not in inventory)
                    
                    const inventoryItem = this.inventory.find(i => i.id === item.id);
                    if (inventoryItem) {
                        // Use quantity or stock field (matches the structure from add-item.js)
                        const currentStock = inventoryItem.quantity || inventoryItem.stock || 0;
                        const newStock = Math.max(0, currentStock - item.quantity); // Prevent negative stock
                        
                        console.log(`📊 Updating ${item.name}: ${currentStock} → ${newStock} (sold: ${item.quantity})`);
                        
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
                console.log('✅ Inventory updated successfully');
            } catch (inventoryError) {
                console.error('⚠️ Error updating inventory (sale was saved):', inventoryError);
                // Don't throw - sale is already saved
            }

            // Clear cart and reset UI
            this.cart = [];
            this.discount = 0;
            this.tax = 0;
            
            const discountInput = document.getElementById('posDiscountInput');
            const taxInput = document.getElementById('posTaxInput');
            if (discountInput) discountInput.value = '';
            if (taxInput) taxInput.value = '';

            this.renderCart();
            this.updateTotals();

            // Reload stats (non-critical)
            try {
                console.log('📊 Reloading stats...');
                await this.loadTodayStats();
                this.renderStats();
                console.log('✅ Stats reloaded');
            } catch (statsError) {
                console.error('⚠️ Error reloading stats:', statsError);
                // Don't throw - sale is already saved
            }
            
            // Refresh dashboard stats if available (non-critical)
            if (typeof window.refreshDashboardStats === 'function') {
                try {
                    console.log('📊 Refreshing dashboard stats...');
                    await window.refreshDashboardStats();
                    console.log('✅ Dashboard stats refreshed');
                } catch (dashError) {
                    console.error('⚠️ Error refreshing dashboard:', dashError);
                    // Don't throw - sale is already saved
                }
            }

            // Refresh reports if initialized (non-critical)
            if (window.reportsManager && window.reportsManager.initialized) {
                try {
                    console.log('📊 Refreshing reports...');
                    await window.reportsManager.loadAllData();
                    console.log('✅ Reports refreshed');
                } catch (reportsError) {
                    console.error('⚠️ Error refreshing reports:', reportsError);
                }
            }
            
            // Reload POS inventory (non-critical)
            try {
                console.log('🔄 Reloading POS inventory...');
                await this.loadInventory();
                console.log('✅ POS inventory reloaded');
            } catch (loadError) {
                console.error('⚠️ Error reloading POS inventory:', loadError);
                // Don't throw - sale is already saved
            }
            
            // Refresh inventory page if active (non-critical)
            if (window.inventoryManager && typeof window.inventoryManager.refresh === 'function') {
                try {
                    console.log('🔄 Refreshing inventory manager...');
                    await window.inventoryManager.refresh();
                    console.log('✅ Inventory manager refreshed');
                } catch (refreshError) {
                    console.error('⚠️ Error refreshing inventory manager:', refreshError);
                    // Don't throw - sale is already saved
                }
            }

            // Show success message (always show if sale was saved)
            this.showNotification(`Sale completed! Total: KES ${this.formatCurrency(total)}`, 'success');
            
            // Show receipt dialog (non-critical)
            try {
                console.log('🧾 Showing receipt...');
                this.showReceiptDialog(sale);
            } catch (receiptError) {
                console.error('⚠️ Error showing receipt:', receiptError);
                // Don't throw - sale is already saved, just log it
            }

        } catch (error) {
            console.error('❌ Error completing sale:', error);
            console.error('Error message:', error.message);
            console.error('Error stack:', error.stack);
            
            // Show detailed error to help debug
            const errorMsg = error.message || 'Unknown error occurred';
            this.showNotification(`Sale Error: ${errorMsg}`, 'error');
            
            // If sale was actually saved despite error, inform user
            if (error.message && error.message.includes('refresh')) {
                this.showNotification('Sale may have been saved. Check All Sales page.', 'info');
            }
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

    // Hold current sale for later
    async holdSale() {
        if (this.cart.length === 0) {
            this.showNotification('Cart is empty. Add items before holding.', 'error');
            return;
        }

        const holdData = {
            cart: JSON.parse(JSON.stringify(this.cart)), // Deep copy
            discount: this.discount,
            discountType: this.discountType,
            tax: this.tax,
            taxType: this.taxType,
            heldAt: new Date().toISOString(),
            heldBy: branchManager.getCurrentBranch()?.name || 'Unknown'
        };

        try {
            // Save to Firestore
            const heldSale = await dataManager.createHeldSale(holdData);
            
            // Also save to localStorage as backup
            const heldSales = JSON.parse(localStorage.getItem('heldSales') || '[]');
            heldSales.push({ id: heldSale.id, ...holdData });
            localStorage.setItem('heldSales', JSON.stringify(heldSales));

            // Clear current cart
            this.clearCart();

            this.showNotification('Sale held successfully! Access from "Load Held Sales"', 'success');
            console.log('✅ Sale held:', heldSale.id);
        } catch (error) {
            console.error('❌ Error holding sale:', error);
            this.showNotification('Error holding sale', 'error');
        }
    }

    // Generate quote from current cart
    async generateQuote() {
        if (this.cart.length === 0) {
            this.showNotification('Cart is empty. Add items before generating quote.', 'error');
            return;
        }

        // Calculate totals
        const subtotal = this.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        const discountAmount = this.discountType === 'percentage' 
            ? subtotal * (this.discount / 100)
            : this.discount;
        const taxableAmount = subtotal - discountAmount;
        const taxAmount = this.taxType === 'percentage'
            ? taxableAmount * (this.tax / 100)
            : this.tax;
        const total = taxableAmount + taxAmount;

        // Create quote data
        const quoteData = {
            quoteNumber: `Q-${Date.now()}`,
            items: this.cart.map(item => ({
                id: item.id || 'manual',
                name: item.name,
                barcode: item.barcode || '',
                price: item.price,
                quantity: item.quantity,
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
            status: 'quote',
            validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
            createdAt: new Date().toISOString(),
            branch: branchManager.getCurrentBranch()?.name || 'Main Branch'
        };

        try {
            // Save quote to Firestore
            const quote = await dataManager.createQuote(quoteData);
            
            this.showNotification('Quote generated successfully!', 'success');
            this.showQuoteDialog(quote);
            console.log('✅ Quote generated:', quote.id);
        } catch (error) {
            console.error('❌ Error generating quote:', error);
            this.showNotification('Error generating quote', 'error');
        }
    }

    // Show quote dialog (similar to receipt but for quotes)
    showQuoteDialog(quote) {
        const modal = document.createElement('div');
        modal.className = 'pos-modal';
        
        const validUntilDate = new Date(quote.validUntil).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });

        modal.innerHTML = `
            <div class="pos-modal-content" style="max-width: 500px;">
                <div class="pos-modal-header">
                    <h3>Quotation</h3>
                    <button onclick="this.closest('.pos-modal').remove()" class="pos-modal-close">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
                <div class="pos-modal-body">
                    <div class="receipt-content">
                        <div class="receipt-header">
                            <h2>QUOTATION</h2>
                            <p><strong>Quote #:</strong> ${quote.quoteNumber}</p>
                            <p><strong>Valid Until:</strong> ${validUntilDate}</p>
                            <p>${new Date(quote.createdAt).toLocaleString()}</p>
                            <p><strong>Branch:</strong> ${quote.branch}</p>
                        </div>
                        
                        <div class="receipt-items">
                            <table style="width: 100%; margin: 15px 0;">
                                <thead>
                                    <tr style="border-bottom: 2px solid #333;">
                                        <th style="text-align: left; padding: 8px 0;">Item</th>
                                        <th style="text-align: center;">Qty</th>
                                        <th style="text-align: right;">Price</th>
                                        <th style="text-align: right;">Total</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${quote.items.map(item => `
                                        <tr>
                                            <td style="padding: 8px 0;">${item.name}</td>
                                            <td style="text-align: center;">${item.quantity}</td>
                                            <td style="text-align: right;">KES ${this.formatCurrency(item.price)}</td>
                                            <td style="text-align: right;">KES ${this.formatCurrency(item.total)}</td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                        
                        <div class="receipt-totals" style="border-top: 2px solid #333; padding-top: 10px; margin-top: 10px;">
                            <div style="display: flex; justify-content: space-between; margin: 5px 0;">
                                <span>Subtotal:</span>
                                <span>KES ${this.formatCurrency(quote.subtotal)}</span>
                            </div>
                            ${quote.discount > 0 ? `
                                <div style="display: flex; justify-content: space-between; margin: 5px 0; color: #10b981;">
                                    <span>Discount (${quote.discountType === 'percentage' ? quote.discountValue + '%' : 'KES ' + this.formatCurrency(quote.discountValue)}):</span>
                                    <span>-KES ${this.formatCurrency(quote.discount)}</span>
                                </div>
                            ` : ''}
                            ${quote.tax > 0 ? `
                                <div style="display: flex; justify-content: space-between; margin: 5px 0;">
                                    <span>Tax (${quote.taxType === 'percentage' ? quote.taxValue + '%' : 'KES ' + this.formatCurrency(quote.taxValue)}):</span>
                                    <span>KES ${this.formatCurrency(quote.tax)}</span>
                                </div>
                            ` : ''}
                            <div style="display: flex; justify-content: space-between; margin-top: 10px; padding-top: 10px; border-top: 2px solid #333; font-size: 1.2em; font-weight: bold;">
                                <span>TOTAL:</span>
                                <span>KES ${this.formatCurrency(quote.total)}</span>
                            </div>
                        </div>

                        <div class="receipt-footer" style="margin-top: 20px; padding-top: 15px; border-top: 1px dashed #666; text-align: center; font-size: 0.9em; color: #666;">
                            <p><strong>This is a quotation, not an invoice.</strong></p>
                            <p>Valid for 30 days from the date of issue.</p>
                            <p>Terms and conditions apply.</p>
                        </div>
                    </div>
                </div>
                <div class="pos-modal-footer">
                    <button onclick="window.print()" class="btn btn-primary">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="6 9 6 2 18 2 18 9"></polyline>
                            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                            <rect x="6" y="14" width="12" height="8"></rect>
                        </svg>
                        Print Quote
                    </button>
                    <button onclick="this.closest('.pos-modal').remove()" class="btn btn-secondary">Close</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
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

        // Check if item with same name and price already exists in cart
        const existingItem = this.cart.find(i => 
            i.isManual && 
            i.name.toLowerCase() === name.toLowerCase() && 
            i.price === price
        );

        if (existingItem) {
            // Add to existing quantity instead of creating duplicate
            existingItem.quantity += quantity;
            this.showNotification(`Updated quantity for "${name}"`, 'success');
        } else {
            // Add new item to cart
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
            this.showNotification('Manual item added to cart', 'success');
        }

        this.renderCart();
        this.updateTotals();
        
        // Close modal
        document.querySelector('.pos-modal').remove();
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
