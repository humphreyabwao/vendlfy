// Inventory Management System
import { db, collection, addDoc, getDocs, doc, updateDoc, deleteDoc, query, where, orderBy } from './firebase-config.js';
import branchManager from './branch-manager.js';
import dataManager from './data-manager.js';
import brandManager from './brand-manager.js';
import { appendStockHistoryRecord } from './stock-history.js';

function stockHistoryBranchFromItem(item) {
    const branchId = item?.branchId || branchManager.getCurrentBranch?.()?.id || '';
    const br = branchId && branchManager.getBranchById?.(branchId);
    const branchName = br?.name ?? branchManager.getCurrentBranch?.()?.name ?? null;
    return { branchId, branchName };
}

class InventoryManager {
    constructor() {
        this.items = [];
        this.filteredItems = [];
        this.stats = {
            totalValue: 0,
            totalItems: 0,
            lowStock: 0,
            outOfStock: 0,
            expired: 0,
            stockMovement: 0
        };
        this.filters = {
            search: '',
            category: '',
            status: '',
            sortBy: 'name-asc'
        };
        this.pagination = {
            currentPage: 1,
            itemsPerPage: 50,
            totalPages: 1
        };
        this.selectedItems = new Set();
        this._inventoryUnsub = null;
        this._inventoryBranchBound = false;
        this._inventoryChangeEmitTimer = null;
    }

    _stopInventoryRealtime() {
        try {
            this._inventoryUnsub?.();
        } catch (e) { /* ignore */ }
        this._inventoryUnsub = null;
    }

    _emitInventoryChangedDebounced() {
        clearTimeout(this._inventoryChangeEmitTimer);
        this._inventoryChangeEmitTimer = setTimeout(() => {
            window.dispatchEvent(new CustomEvent('inventoryDataChanged'));
        }, 350);
    }

    _startInventoryRealtime() {
        this._stopInventoryRealtime();
        if (dataManager.useLocalStorage) return;

        this._inventoryUnsub = dataManager.subscribeInventory({
            onUpdate: (items) => this._onInventoryRealtimeUpdate(items),
            onError: () => { /* logged in data-manager */ }
        });
    }

    _onInventoryRealtimeUpdate(items) {
        this.items = this._normalizeInventoryList(items, { notifyLocalRemoved: false });
        const page = this.pagination.currentPage;
        this.applyFilters();
        this.pagination.currentPage = Math.min(page, Math.max(1, this.pagination.totalPages));
        this.calculateStats();
        this.updateStatsUI();
        this.renderTable();
        this._emitInventoryChangedDebounced();
    }

    /**
     * Dedupe + drop unsyncable local ids. Optionally show one-time toast for local rows (initial load).
     */
    _normalizeInventoryList(items, { notifyLocalRemoved = false } = {}) {
        const localItems = items.filter(
            (item) => item.id && (item.id.startsWith('item_') || item.id.startsWith('local_'))
        );
        if (notifyLocalRemoved && localItems.length > 0) {
            console.warn(`⚠️ Found ${localItems.length} local items that cannot sync with Firebase`);
            window.showNotification(
                `Removed ${localItems.length} local item(s) that cannot sync with Firebase. All items are now from Firebase.`,
                'info'
            );
        }

        let filteredItems = items.filter(
            (item) => !item.id || (!item.id.startsWith('item_') && !item.id.startsWith('local_'))
        );

        const uniqueItems = [];
        const seenIds = new Set();
        const seenSKUs = new Set();
        const seenNames = new Set();

        filteredItems.forEach((item) => {
            const itemSKU = (item.sku || '').toLowerCase().trim();
            const itemName = (item.name || '').toLowerCase().trim();

            if (item.id && seenIds.has(item.id)) return;
            if (itemSKU && seenSKUs.has(itemSKU)) return;
            if (itemName && seenNames.has(itemName)) return;

            if (item.id) seenIds.add(item.id);
            if (itemSKU) seenSKUs.add(itemSKU);
            if (itemName) seenNames.add(itemName);

            uniqueItems.push(item);
        });

        return uniqueItems;
    }

    _ensureBranchChangeListener() {
        if (this._inventoryBranchBound) return;
        this._inventoryBranchBound = true;
        window.addEventListener('branchChanged', () => {
            this._onInventoryBranchChanged().catch((e) => console.error('inventory branch change:', e));
        });
    }

    async _onInventoryBranchChanged() {
        this._stopInventoryRealtime();
        this.showLoading(true);
        try {
            await this.loadInventory();
            this.applyFilters();
            this.updateStatsUI();
            this.renderTable();
        } finally {
            this.showLoading(false);
        }
        this._startInventoryRealtime();
    }

    // Initialize inventory when page loads
    async init() {
        this.showLoading(true);
        this._ensureBranchChangeListener();

        this.cleanupLocalStorage();

        this._stopInventoryRealtime();
        await this.loadInventory();
        this._startInventoryRealtime();

        this.applyFilters();
        this.updateStatsUI();
        this.renderTable();
        this.attachEventListeners();
        this.showLoading(false);
    }

    // Clean up local items from localStorage
    cleanupLocalStorage() {
        try {
            const data = localStorage.getItem('vendlfy_data');
            if (data) {
                const parsed = JSON.parse(data);
                if (parsed.inventory && Array.isArray(parsed.inventory)) {
                    const originalCount = parsed.inventory.length;
                    
                    // Remove items with local IDs
                    parsed.inventory = parsed.inventory.filter(item => 
                        !item.id || (!item.id.startsWith('item_') && !item.id.startsWith('local_'))
                    );
                    
                    const removedCount = originalCount - parsed.inventory.length;
                    
                    if (removedCount > 0) {
                        localStorage.setItem('vendlfy_data', JSON.stringify(parsed));
                        console.log(`🧹 Cleaned up ${removedCount} local items from localStorage`);
                    }
                }
            }
        } catch (error) {
            console.error('Error cleaning localStorage:', error);
        }
    }

    // Load inventory items (one-shot; live updates come from _startInventoryRealtime)
    async loadInventory() {
        try {
            console.log('📥 Loading inventory from database...');
            const items = await dataManager.getInventory();
            this.items = this._normalizeInventoryList(items, { notifyLocalRemoved: true });
            console.log(`✅ Using ${this.items.length} unique synced items`);
            this.calculateStats();
        } catch (error) {
            console.error('Error loading inventory:', error);
            this.items = [];
        }
    }

    // Calculate inventory statistics
    calculateStats() {
        this.stats = {
            totalValue: 0,
            totalItems: 0,
            lowStock: 0,
            outOfStock: 0,
            expired: 0,
            stockMovement: 0
        };

        const today = new Date();
        
        this.items.forEach(item => {
            const quantity = Math.max(0, parseInt(item.quantity, 10) || parseInt(item.stock, 10) || 0); // Ensure non-negative
            const price = parseFloat(item.price) || 0;
            const reorderLevel = parseInt(item.reorderLevel) || 5;
            
            // Total value and items
            this.stats.totalValue += quantity * price;
            this.stats.totalItems += quantity;

            // Low stock check
            if (quantity > 0 && quantity <= reorderLevel) {
                this.stats.lowStock++;
            }

            // Out of stock check
            if (quantity === 0) {
                this.stats.outOfStock++;
            }

            // Expired items check
            if (item.expiryDate) {
                const expiryDate = new Date(item.expiryDate);
                if (expiryDate < today) {
                    this.stats.expired++;
                }
            }

            // Stock movement (items sold in last 30 days)
            if (item.salesLastMonth) {
                this.stats.stockMovement += item.salesLastMonth;
            }
        });
    }

    // Apply filters and search
    applyFilters() {
        let filtered = [...this.items];

        // Apply search filter
        if (this.filters.search) {
            const searchLower = this.filters.search.toLowerCase();
            filtered = filtered.filter(item => {
                return (
                    (item.name || '').toLowerCase().includes(searchLower) ||
                    (item.sku || '').toLowerCase().includes(searchLower) ||
                    (item.category || '').toLowerCase().includes(searchLower)
                );
            });
        }

        // Apply category filter
        if (this.filters.category) {
            filtered = filtered.filter(item => 
                (item.category || '').toLowerCase() === this.filters.category.toLowerCase()
            );
        }

        // Apply status filter
        if (this.filters.status) {
            const today = new Date();
            filtered = filtered.filter(item => {
                const quantity = Math.max(0, parseInt(item.quantity, 10) || parseInt(item.stock, 10) || 0);
                const reorderLevel = item.reorderLevel || 5;
                
                switch (this.filters.status) {
                    case 'in-stock':
                        return quantity > reorderLevel;
                    case 'low-stock':
                        return quantity > 0 && quantity <= reorderLevel;
                    case 'out-of-stock':
                        return quantity === 0;
                    case 'expired':
                        if (item.expiryDate) {
                            const expiryDate = new Date(item.expiryDate);
                            return expiryDate < today;
                        }
                        return false;
                    default:
                        return true;
                }
            });
        }

        // Apply sorting
        filtered.sort((a, b) => {
            const [field, order] = this.filters.sortBy.split('-');
            let compareA, compareB;

            switch (field) {
                case 'name':
                    compareA = (a.name || '').toLowerCase();
                    compareB = (b.name || '').toLowerCase();
                    break;
                case 'quantity':
                    compareA = Math.max(0, parseInt(a.quantity, 10) || parseInt(a.stock, 10) || 0);
                    compareB = Math.max(0, parseInt(b.quantity, 10) || parseInt(b.stock, 10) || 0);
                    break;
                case 'value':
                    compareA = (Math.max(0, parseInt(a.quantity, 10) || parseInt(a.stock, 10) || 0)) * (a.price || 0);
                    compareB = (Math.max(0, parseInt(b.quantity, 10) || parseInt(b.stock, 10) || 0)) * (b.price || 0);
                    break;
                default:
                    return 0;
            }

            if (order === 'asc') {
                return compareA > compareB ? 1 : compareA < compareB ? -1 : 0;
            } else {
                return compareA < compareB ? 1 : compareA > compareB ? -1 : 0;
            }
        });

        this.filteredItems = filtered;
        this.pagination.currentPage = 1;
        this.calculatePagination();
        this.updateResultsCount();
    }

    // Calculate pagination
    calculatePagination() {
        this.pagination.totalPages = Math.ceil(this.filteredItems.length / this.pagination.itemsPerPage);
        if (this.pagination.currentPage > this.pagination.totalPages) {
            this.pagination.currentPage = Math.max(1, this.pagination.totalPages);
        }
    }

    // Get items for current page
    getCurrentPageItems() {
        const start = (this.pagination.currentPage - 1) * this.pagination.itemsPerPage;
        const end = start + this.pagination.itemsPerPage;
        return this.filteredItems.slice(start, end);
    }

    // Render table
    renderTable() {
        const tbody = document.getElementById('inventoryTableBody');
        const emptyState = document.getElementById('inventoryEmptyState');
        const table = document.getElementById('inventoryTable');

        if (!tbody) return;

        // Clear existing rows
        tbody.innerHTML = '';
        
        // Clean up selected items that no longer exist
        this.selectedItems.forEach(id => {
            if (!this.items.find(item => item.id === id)) {
                this.selectedItems.delete(id);
            }
        });

        // Check if we have items
        if (this.filteredItems.length === 0) {
            if (table) table.style.display = 'none';
            if (emptyState) emptyState.classList.add('active');
            this.updatePaginationUI();
            return;
        }

        // Show table, hide empty state
        if (table) table.style.display = 'table';
        if (emptyState) emptyState.classList.remove('active');

        // Get items for current page
        const pageItems = this.getCurrentPageItems();

        // Render each item
        pageItems.forEach(item => {
            const row = this.createTableRow(item);
            tbody.appendChild(row);
        });

        // Update pagination UI
        this.updatePaginationUI();
    }

    // Create table row
    createTableRow(item) {
        const row = document.createElement('tr');
        const quantity = Math.max(0, parseInt(item.quantity, 10) || parseInt(item.stock, 10) || 0); // Ensure non-negative
        const price = parseFloat(item.price) || 0;
        const reorderLevel = parseInt(item.reorderLevel) || 5;
        const value = quantity * price;
        const itemId = item.id || '';

        // Determine status
        let status = 'in-stock';
        let statusText = 'In Stock';
        
        if (quantity === 0) {
            status = 'out-of-stock';
            statusText = 'Out of Stock';
        } else if (quantity <= reorderLevel) {
            status = 'low-stock';
            statusText = 'Low Stock';
        }

        // Check if expired
        const expiryStatus = this.checkExpiry(item);
        if (expiryStatus && expiryStatus.includes('Expired')) {
            status = 'expired';
            statusText = 'Expired';
        }

        row.innerHTML = `
            <td>
                <div class="checkbox-cell">
                    <input type="checkbox" class="checkbox item-checkbox" data-id="${itemId}" ${this.selectedItems.has(itemId) ? 'checked' : ''}>
                    ${this.selectedItems.has(itemId) ? `
                        <button class="inline-delete-btn" onclick="window.inventoryManager.deleteItem('${itemId}')" title="Delete Item">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6"></polyline>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            </svg>
                        </button>
                    ` : ''}
                </div>
            </td>
            <td>
                <div class="product-name">${this.escapeHtml(item.name || 'Unnamed Product')}</div>
            </td>
            <td>
                <div class="product-sku">${this.escapeHtml(item.sku || 'N/A')}</div>
            </td>
            <td>
                <span class="category-badge">${this.escapeHtml(item.category || 'Uncategorized')}</span>
            </td>
            <td>
                <span class="quantity-cell" style="color: ${quantity === 0 ? 'var(--primary-red)' : quantity <= reorderLevel ? 'var(--primary-orange)' : 'var(--text-primary)'}">${quantity}</span>
            </td>
            <td>
                <span class="price-cell">${window.formatCurrency(price)}</span>
            </td>
            <td>
                <span class="value-cell">${window.formatCurrency(value)}</span>
            </td>
            <td>
                <span class="supplier-name">${this.escapeHtml(item.supplier || 'N/A')}</span>
            </td>
            <td>
                <span class="status-badge ${status}">
                    <span class="status-indicator"></span>
                    ${statusText}
                </span>
            </td>
            <td>
                <span class="date-cell">${item.dateAdded ? window.formatDate(item.dateAdded) : 'N/A'}</span>
            </td>
            <td>
                <div class="action-buttons">
                    <button type="button" class="action-btn add-stock" onclick="window.inventoryManager.addStock('${itemId}')" title="Add stock">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                            <path d="M12 5v14M5 12h14"></path>
                        </svg>
                    </button>
                    <button class="action-btn view" onclick="window.inventoryManager.viewItem('${itemId}')" title="View Details">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                            <circle cx="12" cy="12" r="3"></circle>
                        </svg>
                    </button>
                    <button class="action-btn edit" onclick="window.inventoryManager.editItem('${itemId}')" title="Edit Item">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                    </button>
                    <button class="action-btn delete" onclick="window.inventoryManager.deleteItem('${itemId}')" title="Delete Item">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                    </button>
                </div>
            </td>
        `;

        return row;
    }

    // Update pagination UI
    updatePaginationUI() {
        const start = (this.pagination.currentPage - 1) * this.pagination.itemsPerPage + 1;
        const end = Math.min(this.pagination.currentPage * this.pagination.itemsPerPage, this.filteredItems.length);
        const total = this.filteredItems.length;

        // Update pagination info
        const startEl = document.getElementById('paginationStart');
        const endEl = document.getElementById('paginationEnd');
        const totalEl = document.getElementById('paginationTotal');

        if (startEl) startEl.textContent = total > 0 ? start : 0;
        if (endEl) endEl.textContent = end;
        if (totalEl) totalEl.textContent = total;

        // Update buttons
        const firstBtn = document.getElementById('firstPageBtn');
        const prevBtn = document.getElementById('prevPageBtn');
        const nextBtn = document.getElementById('nextPageBtn');
        const lastBtn = document.getElementById('lastPageBtn');

        if (firstBtn) firstBtn.disabled = this.pagination.currentPage === 1;
        if (prevBtn) prevBtn.disabled = this.pagination.currentPage === 1;
        if (nextBtn) nextBtn.disabled = this.pagination.currentPage >= this.pagination.totalPages;
        if (lastBtn) lastBtn.disabled = this.pagination.currentPage >= this.pagination.totalPages;

        // Render page numbers
        this.renderPageNumbers();
    }

    // Render page numbers
    renderPageNumbers() {
        const container = document.getElementById('pageNumbers');
        if (!container) return;

        container.innerHTML = '';

        const currentPage = this.pagination.currentPage;
        const totalPages = this.pagination.totalPages;
        const maxVisible = 5;

        let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
        let endPage = Math.min(totalPages, startPage + maxVisible - 1);

        if (endPage - startPage < maxVisible - 1) {
            startPage = Math.max(1, endPage - maxVisible + 1);
        }

        // First page
        if (startPage > 1) {
            container.appendChild(this.createPageButton(1));
            if (startPage > 2) {
                container.appendChild(this.createEllipsis());
            }
        }

        // Page numbers
        for (let i = startPage; i <= endPage; i++) {
            container.appendChild(this.createPageButton(i));
        }

        // Last page
        if (endPage < totalPages) {
            if (endPage < totalPages - 1) {
                container.appendChild(this.createEllipsis());
            }
            container.appendChild(this.createPageButton(totalPages));
        }
    }

    // Create page button
    createPageButton(pageNum) {
        const button = document.createElement('button');
        button.className = 'page-number';
        if (pageNum === this.pagination.currentPage) {
            button.classList.add('active');
        }
        button.textContent = pageNum;
        button.onclick = () => this.goToPage(pageNum);
        return button;
    }

    // Create ellipsis
    createEllipsis() {
        const span = document.createElement('span');
        span.className = 'page-number ellipsis';
        span.textContent = '...';
        return span;
    }

    // Go to page
    goToPage(pageNum) {
        this.pagination.currentPage = pageNum;
        this.renderTable();
        this.scrollToTop();
    }

    // Scroll to top of table
    scrollToTop() {
        const tableWrapper = document.querySelector('.table-wrapper');
        if (tableWrapper) {
            tableWrapper.scrollTop = 0;
        }
    }

    // Update results count
    updateResultsCount() {
        const countEl = document.getElementById('inventoryResultsCount');
        if (countEl) {
            const count = this.filteredItems.length;
            const itemText = count === 1 ? 'item' : 'items';
            countEl.textContent = `${count} ${itemText}`;
        }
    }

    // Show/hide loading state
    showLoading(show) {
        const loadingState = document.getElementById('inventoryLoadingState');
        if (loadingState) {
            loadingState.style.display = show ? 'flex' : 'none';
        }
    }

    // Escape HTML
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Update stats display in UI
    updateStatsUI() {
        // Total Stock Value - Green if has value, black if zero
        const totalValueEl = document.getElementById('totalStockValue');
        if (totalValueEl) {
            totalValueEl.textContent = window.formatCurrency(this.stats.totalValue);
            totalValueEl.className = 'stat-value';
            if (this.stats.totalValue > 0) {
                totalValueEl.classList.add('green');
            } else {
                totalValueEl.classList.add('black');
            }
        }

        // Total Items Count
        const totalItemsEl = document.getElementById('totalItemsCount');
        if (totalItemsEl) {
            const itemText = this.stats.totalItems === 1 ? 'item' : 'items';
            totalItemsEl.textContent = `${this.stats.totalItems} ${itemText} in stock`;
        }

        // Low Stock Count - Yellow/Orange for warning
        const lowStockEl = document.getElementById('lowStockCount');
        if (lowStockEl) {
            lowStockEl.textContent = this.stats.lowStock;
            lowStockEl.className = 'stat-value';
            if (this.stats.lowStock > 0) {
                lowStockEl.classList.add('yellow');
            } else {
                lowStockEl.classList.add('black');
            }
        }

        // Out of Stock / Expired Count - Red for danger
        const outOfStockEl = document.getElementById('outOfStockCount');
        if (outOfStockEl) {
            const total = this.stats.outOfStock + this.stats.expired;
            outOfStockEl.textContent = total;
            outOfStockEl.className = 'stat-value';
            if (total > 0) {
                outOfStockEl.classList.add('red');
            } else {
                outOfStockEl.classList.add('green');
            }
        }

        // Stock Status Text
        const statusTextEl = document.getElementById('stockStatusText');
        if (statusTextEl) {
            const total = this.stats.outOfStock + this.stats.expired;
            if (total === 0) {
                statusTextEl.textContent = 'All items in stock';
            } else {
                const parts = [];
                if (this.stats.outOfStock > 0) {
                    parts.push(`${this.stats.outOfStock} out of stock`);
                }
                if (this.stats.expired > 0) {
                    parts.push(`${this.stats.expired} expired`);
                }
                statusTextEl.textContent = parts.join(', ');
            }
        }

        // Stock Movement - Green if there's movement, black if zero
        const movementEl = document.getElementById('stockMovement');
        if (movementEl) {
            movementEl.textContent = this.stats.stockMovement;
            movementEl.className = 'stat-value';
            if (this.stats.stockMovement > 0) {
                movementEl.classList.add('green');
            } else {
                movementEl.classList.add('black');
            }
        }
    }

    // Attach event listeners
    attachEventListeners() {
        // Add New Item button
        const addItemBtn = document.getElementById('addInventoryItemBtn');
        if (addItemBtn) {
            addItemBtn.addEventListener('click', () => {
                this.openAddItemPage();
            });
        }

        // Export button dropdown toggle
        const exportBtn = document.getElementById('exportInventoryBtn');
        const exportDropdown = exportBtn?.closest('.export-dropdown');
        
        if (exportBtn && exportDropdown) {
            exportBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                exportDropdown.classList.toggle('active');
            });

            // Close dropdown when clicking outside
            document.addEventListener('click', (e) => {
                if (!exportDropdown.contains(e.target)) {
                    exportDropdown.classList.remove('active');
                }
            });
        }

        // Export format options
        const exportOptions = document.querySelectorAll('.export-option');
        exportOptions.forEach(option => {
            option.addEventListener('click', (e) => {
                e.preventDefault();
                const format = option.getAttribute('data-format');
                this.exportInventory(format);
                exportDropdown?.classList.remove('active');
            });
        });

        // Search input
        const searchInput = document.getElementById('inventorySearchInput');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.filters.search = e.target.value;
                this.applyFilters();
                this.renderTable();
            });
        }

        // Category filter
        const categoryFilter = document.getElementById('inventoryCategoryFilter');
        if (categoryFilter) {
            categoryFilter.addEventListener('change', (e) => {
                this.filters.category = e.target.value;
                this.applyFilters();
                this.renderTable();
            });
        }

        // Status filter
        const statusFilter = document.getElementById('inventoryStatusFilter');
        if (statusFilter) {
            statusFilter.addEventListener('change', (e) => {
                this.filters.status = e.target.value;
                this.applyFilters();
                this.renderTable();
            });
        }

        // Sort by
        const sortBy = document.getElementById('inventorySortBy');
        if (sortBy) {
            sortBy.addEventListener('change', (e) => {
                this.filters.sortBy = e.target.value;
                this.applyFilters();
                this.renderTable();
            });
        }

        // Clear filters button
        const clearBtn = document.getElementById('clearFiltersBtn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                this.clearFilters();
            });
        }

        // Pagination controls
        const firstPageBtn = document.getElementById('firstPageBtn');
        const prevPageBtn = document.getElementById('prevPageBtn');
        const nextPageBtn = document.getElementById('nextPageBtn');
        const lastPageBtn = document.getElementById('lastPageBtn');

        if (firstPageBtn) {
            firstPageBtn.addEventListener('click', () => this.goToPage(1));
        }
        if (prevPageBtn) {
            prevPageBtn.addEventListener('click', () => {
                if (this.pagination.currentPage > 1) {
                    this.goToPage(this.pagination.currentPage - 1);
                }
            });
        }
        if (nextPageBtn) {
            nextPageBtn.addEventListener('click', () => {
                if (this.pagination.currentPage < this.pagination.totalPages) {
                    this.goToPage(this.pagination.currentPage + 1);
                }
            });
        }
        if (lastPageBtn) {
            lastPageBtn.addEventListener('click', () => this.goToPage(this.pagination.totalPages));
        }

        // Items per page
        const itemsPerPage = document.getElementById('itemsPerPage');
        if (itemsPerPage) {
            itemsPerPage.addEventListener('change', (e) => {
                this.pagination.itemsPerPage = parseInt(e.target.value);
                this.pagination.currentPage = 1;
                this.calculatePagination();
                this.renderTable();
            });
        }

        // Select all checkbox
        const selectAll = document.getElementById('selectAllInventory');
        if (selectAll) {
            selectAll.addEventListener('change', (e) => {
                this.toggleSelectAll(e.target.checked);
            });
        }

        // Delegate event for individual checkboxes
        const tbody = document.getElementById('inventoryTableBody');
        if (tbody) {
            tbody.addEventListener('change', (e) => {
                if (e.target.classList.contains('item-checkbox')) {
                    const itemId = e.target.getAttribute('data-id');
                    this.toggleItemSelection(itemId, e.target.checked);
                }
            });
        }
    }

    // Clear all filters
    clearFilters() {
        this.filters = {
            search: '',
            category: '',
            status: '',
            sortBy: 'name-asc'
        };

        // Reset UI elements
        const searchInput = document.getElementById('inventorySearchInput');
        const categoryFilter = document.getElementById('inventoryCategoryFilter');
        const statusFilter = document.getElementById('inventoryStatusFilter');
        const sortBy = document.getElementById('inventorySortBy');

        if (searchInput) searchInput.value = '';
        if (categoryFilter) categoryFilter.value = '';
        if (statusFilter) statusFilter.value = '';
        if (sortBy) sortBy.value = 'name-asc';

        this.applyFilters();
        this.renderTable();
        window.showNotification('Filters cleared', 'success');
    }

    // Open add item page
    openAddItemPage() {
        const addItemLink = document.querySelector('[data-page="add-item"]');
        if (addItemLink) {
            addItemLink.click();
        }
    }

    // Export inventory to Excel or PDF
    async exportInventory(format = 'excel') {
        const itemsToExport = this.filteredItems.length > 0 ? this.filteredItems : this.items;
        
        if (itemsToExport.length === 0) {
            window.showNotification('No inventory data to export', 'info');
            return;
        }

        if (format === 'excel') {
            this.exportToExcel(itemsToExport);
        } else if (format === 'pdf') {
            await this.exportToPDF(itemsToExport);
        }
    }

    // Export to Excel
    exportToExcel(items) {
        const brand = brandManager.getBrand();
        const currency = brand.currency || 'KSh';
        const currentBranch = branchManager.getCurrentBranch();
        const branchName = currentBranch ? currentBranch.name : 'All Branches';

        const headers = ['Item Name', 'SKU', 'Category', 'Quantity', `Price (${currency})`, `Total Value (${currency})`, 'Reorder Level', 'Status', 'Branch'];

        const rows = items.map(item => {
            const quantity = item.quantity || 0;
            const price = item.price || 0;
            const reorderLevel = item.reorderLevel || 5;
            
            let status = 'In Stock';
            if (quantity === 0) {
                status = 'Out of Stock';
            } else if (quantity <= reorderLevel) {
                status = 'Low Stock';
            }

            const expiryStatus = this.checkExpiry(item);
            if (expiryStatus) {
                status += ` (${expiryStatus})`;
            }

            return [
                item.name || '',
                item.sku || '',
                item.category || '',
                quantity,
                price.toFixed(2),
                (quantity * price).toFixed(2),
                reorderLevel,
                status,
                item.branchName || 'N/A'
            ];
        });

        const totalValue = items.reduce((sum, item) => sum + ((item.quantity || 0) * (item.price || 0)), 0);
        const totalItems = items.reduce((sum, item) => sum + (item.quantity || 0), 0);

        // Brand-stamped header rows (above the table)
        const headerRows = [
            [brand.name || 'Vendify'],
            brand.tagline ? [brand.tagline] : null,
            brand.address ? [brand.address] : null,
            brand.phone || brand.email ? [[brand.phone ? `Tel: ${brand.phone}` : '', brand.email || ''].filter(Boolean).join(' | ')] : null,
            ['Inventory Report'],
            [`Branch: ${branchName}`],
            [`Generated: ${window.formatDateTime(new Date())}`],
            [`Total Items: ${items.length}`],
            []
        ].filter(Boolean);

        rows.push([]);
        rows.push(['SUMMARY', '', '', '', '', '', '', '', '']);
        rows.push(['Total Items:', totalItems, '', '', '', '', '', '', '']);
        rows.push(['Total Value:', '', '', '', '', totalValue.toFixed(2), '', '', '']);

        const escapeCell = (cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`;
        const csvContent = [
            ...headerRows.map(row => row.map(escapeCell).join(',')),
            headers.map(escapeCell).join(','),
            ...rows.map(row => row.map(escapeCell).join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const safeBrand = (brand.name || 'Vendify').replace(/[^a-z0-9]+/gi, '_');
        a.download = `${safeBrand}_Inventory_${window.formatDate(new Date())}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);

        window.showNotification('Inventory exported to Excel successfully', 'success');
    }

    // Load the brand logo as an Image element so jsPDF can embed it.
    // Returns { img, format } where format is 'JPEG' | 'PNG' (jsPDF tags) or null on failure.
    async _loadBrandLogo() {
        const url = brandManager.getLogoUrl();
        if (!url) return null;

        return new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                const lower = url.toLowerCase();
                let format = 'JPEG';
                if (lower.includes('.png')) format = 'PNG';
                else if (lower.includes('.webp')) format = 'WEBP';
                resolve({ img, format });
            };
            img.onerror = () => resolve(null);
            img.src = url;
        });
    }

    // Export to PDF using jsPDF
    async exportToPDF(items) {
        // Check if jsPDF is loaded
        if (typeof window.jspdf === 'undefined') {
            await this.loadJsPDF();
        }

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        const brand = brandManager.getBrand();
        const currency = brand.currency || 'KSh';
        const currentBranch = branchManager.getCurrentBranch();
        const branchName = currentBranch ? currentBranch.name : 'All Branches';

        // ----- Brand header (logo + company info) -----
        const logo = await this._loadBrandLogo();
        let headerTextX = 14;

        if (logo) {
            try {
                // 22mm square logo, anchored top-left
                doc.addImage(logo.img, logo.format, 14, 10, 22, 22);
                headerTextX = 40;
            } catch (e) {
                // If addImage fails (CORS or unsupported format), fall back to text-only header
                headerTextX = 14;
            }
        }

        // Company name
        doc.setFontSize(18);
        doc.setFont(undefined, 'bold');
        doc.text(brand.name || 'Vendify', headerTextX, 18);

        // Tagline / address line
        doc.setFont(undefined, 'normal');
        doc.setFontSize(10);
        const subLines = [];
        if (brand.tagline) subLines.push(brand.tagline);
        if (brand.address) subLines.push(brand.address);
        const contactBits = [];
        if (brand.phone) contactBits.push(`Tel: ${brand.phone}`);
        if (brand.email) contactBits.push(brand.email);
        if (contactBits.length) subLines.push(contactBits.join(' · '));
        if (brand.taxId) subLines.push(`PIN: ${brand.taxId}`);

        let yCursor = 24;
        subLines.slice(0, 3).forEach((line) => {
            doc.text(String(line), headerTextX, yCursor);
            yCursor += 5;
        });

        // Header divider line
        const dividerY = Math.max(yCursor + 1, logo ? 36 : 30);
        doc.setDrawColor(37, 99, 235);
        doc.setLineWidth(0.6);
        doc.line(14, dividerY, 196, dividerY);

        // ----- Report meta -----
        let metaY = dividerY + 8;
        doc.setFontSize(14);
        doc.setFont(undefined, 'bold');
        doc.text('Inventory Report', 14, metaY);
        metaY += 7;

        doc.setFont(undefined, 'normal');
        doc.setFontSize(10);
        doc.text(`Branch: ${branchName}`, 14, metaY);     metaY += 5;
        doc.text(`Generated: ${window.formatDateTime(new Date())}`, 14, metaY); metaY += 5;
        doc.text(`Total Items: ${items.length}`, 14, metaY); metaY += 5;

        // Summary stats
        const totalValue = items.reduce((sum, item) => sum + ((item.quantity || 0) * (item.price || 0)), 0);
        const totalQty = items.reduce((sum, item) => sum + (item.quantity || 0), 0);

        doc.text(`Total Stock Value: ${currency} ${totalValue.toFixed(2)}`, 14, metaY); metaY += 5;
        doc.text(`Total Quantity: ${totalQty} items`, 14, metaY); metaY += 6;

        // ----- Table -----
        const tableData = items.map(item => {
            const quantity = item.quantity || 0;
            const price = item.price || 0;
            const reorderLevel = item.reorderLevel || 5;

            let status = 'In Stock';
            if (quantity === 0) {
                status = 'Out of Stock';
            } else if (quantity <= reorderLevel) {
                status = 'Low Stock';
            }

            return [
                item.name || '',
                item.sku || '',
                quantity,
                `${currency} ${price.toFixed(2)}`,
                `${currency} ${(quantity * price).toFixed(2)}`,
                status
            ];
        });

        doc.autoTable({
            head: [['Item Name', 'SKU', 'Qty', 'Price', 'Value', 'Status']],
            body: tableData,
            startY: metaY + 2,
            styles: { fontSize: 9 },
            headStyles: { fillColor: [37, 99, 235] },
            // Footer with brand name on every page
            didDrawPage: (data) => {
                const pageCount = doc.internal.getNumberOfPages();
                const pageSize = doc.internal.pageSize;
                const pageWidth = pageSize.getWidth ? pageSize.getWidth() : pageSize.width;
                const pageHeight = pageSize.getHeight ? pageSize.getHeight() : pageSize.height;

                doc.setFontSize(8);
                doc.setTextColor(120);
                doc.text(`${brand.name || 'Vendify'}${brand.website ? ' · ' + brand.website : ''}`, 14, pageHeight - 8);
                doc.text(
                    `Page ${data.pageNumber} of ${pageCount}`,
                    pageWidth - 14,
                    pageHeight - 8,
                    { align: 'right' }
                );
                doc.setTextColor(0);
            }
        });

        // Save PDF — branded filename
        const safeBrand = (brand.name || 'Vendify').replace(/[^a-z0-9]+/gi, '_');
        doc.save(`${safeBrand}_Inventory_${window.formatDate(new Date())}.pdf`);

        window.showNotification('Inventory exported to PDF successfully', 'success');
    }

    // Load jsPDF library dynamically
    async loadJsPDF() {
        return new Promise((resolve, reject) => {
            if (typeof window.jspdf !== 'undefined') {
                resolve();
                return;
            }

            const script1 = document.createElement('script');
            script1.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
            script1.onload = () => {
                const script2 = document.createElement('script');
                script2.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js';
                script2.onload = resolve;
                script2.onerror = reject;
                document.head.appendChild(script2);
            };
            script1.onerror = reject;
            document.head.appendChild(script1);
        });
    }

    // Check if item is expired
    checkExpiry(item) {
        if (!item.expiryDate) return null;
        
        const today = new Date();
        const expiryDate = new Date(item.expiryDate);
        
        if (expiryDate < today) {
            return 'Expired';
        }
        
        const daysUntilExpiry = Math.floor((expiryDate - today) / (1000 * 60 * 60 * 24));
        if (daysUntilExpiry <= 30) {
            return `Expires in ${daysUntilExpiry} days`;
        }
        
        return null;
    }

    // Toggle select all
    toggleSelectAll(checked) {
        const pageItems = this.getCurrentPageItems();
        pageItems.forEach(item => {
            if (checked) {
                this.selectedItems.add(item.id);
            } else {
                this.selectedItems.delete(item.id);
            }
        });
        this.renderTable();
    }

    // Toggle item selection
    toggleItemSelection(itemId, checked) {
        if (checked) {
            this.selectedItems.add(itemId);
        } else {
            this.selectedItems.delete(itemId);
        }
        this.updateSelectAllCheckbox();
    }

    // Update select all checkbox
    updateSelectAllCheckbox() {
        const selectAll = document.getElementById('selectAllInventory');
        if (!selectAll) return;

        const pageItems = this.getCurrentPageItems();
        const allSelected = pageItems.length > 0 && pageItems.every(item => this.selectedItems.has(item.id));
        selectAll.checked = allSelected;
    }

    // View item details
    viewItem(itemId) {
        const item = this.items.find(i => i.id === itemId);
        if (!item) {
            window.showNotification('Item not found', 'error');
            return;
        }

        // Create modal
        const modal = document.createElement('div');
        modal.className = 'pos-modal';
        
        const stockStatus = item.quantity <= item.reorderLevel ? 'Low Stock' : 'In Stock';
        const stockClass = item.quantity <= item.reorderLevel ? 'status-pending' : 'status-completed';
        
        modal.innerHTML = `
            <div class="pos-modal-content" style="max-width: 600px;">
                <div class="pos-modal-header">
                    <h3>Item Details - ${item.name}</h3>
                    <button class="pos-modal-close" onclick="this.closest('.pos-modal').remove()">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
                <div class="pos-modal-body">
                    <div class="item-details-grid">
                        <div class="detail-section">
                            <h4>Basic Information</h4>
                            <div class="detail-row">
                                <span class="detail-label">Name:</span>
                                <span class="detail-value">${item.name}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">SKU:</span>
                                <span class="detail-value">${item.sku || 'N/A'}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">Barcode:</span>
                                <span class="detail-value">${item.barcode || 'N/A'}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">Category:</span>
                                <span class="detail-value">${item.category || 'Uncategorized'}</span>
                            </div>
                            ${item.description ? `
                            <div class="detail-row">
                                <span class="detail-label">Description:</span>
                                <span class="detail-value">${item.description}</span>
                            </div>
                            ` : ''}
                        </div>

                        <div class="detail-section">
                            <h4>Pricing & Stock</h4>
                            <div class="detail-row">
                                <span class="detail-label">Selling Price:</span>
                                <span class="detail-value">KES ${window.formatCurrency(item.price || item.sellingPrice || 0)}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">Buying Price:</span>
                                <span class="detail-value">KES ${window.formatCurrency(item.cost || item.buyingPrice || 0)}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">Profit Margin:</span>
                                <span class="detail-value">KES ${window.formatCurrency((item.price || item.sellingPrice || 0) - (item.cost || item.buyingPrice || 0))}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">Current Stock:</span>
                                <span class="detail-value"><strong>${item.quantity || item.stock || 0} units</strong></span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">Reorder Level:</span>
                                <span class="detail-value">${item.reorderLevel || 0} units</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">Status:</span>
                                <span class="status-badge ${stockClass}">${stockStatus}</span>
                            </div>
                        </div>

                        ${item.supplier || item.location ? `
                        <div class="detail-section">
                            <h4>Additional Information</h4>
                            ${item.supplier ? `
                            <div class="detail-row">
                                <span class="detail-label">Supplier:</span>
                                <span class="detail-value">${item.supplier}</span>
                            </div>
                            ` : ''}
                            ${item.location ? `
                            <div class="detail-row">
                                <span class="detail-label">Location:</span>
                                <span class="detail-value">${item.location}</span>
                            </div>
                            ` : ''}
                            ${item.dateAdded ? `
                            <div class="detail-row">
                                <span class="detail-label">Date Added:</span>
                                <span class="detail-value">${window.formatDate(item.dateAdded)}</span>
                            </div>
                            ` : ''}
                        </div>
                        ` : ''}
                    </div>
                </div>
                <div class="pos-modal-footer">
                    <button class="btn-secondary" onclick="this.closest('.pos-modal').remove()">Close</button>
                    <button class="btn-primary" onclick="this.closest('.pos-modal').remove(); window.inventoryManager.editItem('${itemId}')">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                        Edit Item
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
    }

    async addStock(itemId) {
        const item = this.items.find((i) => i.id === itemId);
        if (!item) {
            window.showNotification('Item not found', 'error');
            return;
        }
        if (!itemId || itemId.startsWith('item_') || itemId.startsWith('local_')) {
            window.showNotification('This item cannot be synced. Remove local-only items and refresh inventory.', 'error');
            return;
        }

        const current = Math.max(0, parseInt(item.quantity, 10) || parseInt(item.stock, 10) || 0);
        const label = String(item.name || 'Item').slice(0, 80);

        const addStr = await window.uiPrompt?.({
            title: 'Add stock',
            message: `${label}\nCurrent quantity: ${current}\n\nHow many units are you adding?`,
            placeholder: 'e.g. 10',
            okLabel: 'Add to stock'
        });
        if (addStr == null) return;

        const toAdd = parseInt(String(addStr).trim(), 10);
        if (!Number.isFinite(toAdd) || toAdd <= 0) {
            window.showNotification('Enter a positive whole number of units to add.', 'error');
            return;
        }

        const newQty = current + toAdd;
        try {
            await dataManager.updateInventoryItem(itemId, { quantity: newQty, stock: newQty }, item);
            Object.assign(item, { quantity: newQty, stock: newQty });
            const filteredItem = this.filteredItems.find((i) => i.id === itemId);
            if (filteredItem) Object.assign(filteredItem, { quantity: newQty, stock: newQty });

            const page = this.pagination.currentPage;
            this.applyFilters();
            this.pagination.currentPage = Math.min(page, Math.max(1, this.pagination.totalPages));
            this.calculateStats();
            this.updateStatsUI();
            this.renderTable();

            window.dispatchEvent(new CustomEvent('inventoryDataChanged'));
            window.showNotification(`Stock updated: ${current} → ${newQty} (+${toAdd})`, 'success');
            window.activityTracker?.logActivity?.('inventory', 'stock-added', {
                itemName: item.name,
                itemId,
                added: toAdd,
                newQuantity: newQty
            });
            const { branchId, branchName } = stockHistoryBranchFromItem(item);
            void appendStockHistoryRecord({
                itemId,
                itemName: item.name,
                sku: item.sku,
                branchId,
                branchName,
                quantityBefore: current,
                quantityAdded: toAdd,
                quantityAfter: newQty,
                source: 'add_stock'
            });
        } catch (e) {
            console.error('addStock failed:', e);
            window.showNotification(e?.message || 'Failed to update stock', 'error');
        }
    }

    // Edit item
    editItem(itemId) {
        const item = this.items.find(i => i.id === itemId);
        if (!item) {
            window.showNotification('Item not found', 'error');
            return;
        }

        // Create edit modal
        const modal = document.createElement('div');
        modal.className = 'pos-modal';
        
        modal.innerHTML = `
            <div class="pos-modal-content" style="max-width: 700px;">
                <div class="pos-modal-header">
                    <h3>Edit Item - ${item.name}</h3>
                    <button class="pos-modal-close" onclick="this.closest('.pos-modal').remove()">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
                <div class="pos-modal-body">
                    <form id="editItemForm" class="edit-item-form">
                        <div class="form-grid">
                            <div class="form-group">
                                <label>Item Name *</label>
                                <input type="text" id="editItemName" class="form-input" value="${item.name}" required>
                            </div>
                            
                            <div class="form-group">
                                <label>SKU</label>
                                <input type="text" id="editItemSKU" class="form-input" value="${item.sku || ''}" readonly style="background: var(--bg-tertiary); cursor: not-allowed;">
                            </div>
                            
                            <div class="form-group">
                                <label>Barcode</label>
                                <input type="text" id="editItemBarcode" class="form-input" value="${item.barcode || ''}">
                            </div>
                            
                            <div class="form-group">
                                <label>Category</label>
                                <select id="editItemCategory" class="form-input">
                                    <option value="">Select Category</option>
                                    <option value="vodka" ${item.category === 'vodka' ? 'selected' : ''}>Vodka</option>
                                    <option value="whisky" ${item.category === 'whisky' ? 'selected' : ''}>Whisky / Whiskey</option>
                                    <option value="gin" ${item.category === 'gin' ? 'selected' : ''}>Gin</option>
                                    <option value="rum" ${item.category === 'rum' ? 'selected' : ''}>Rum</option>
                                    <option value="brandy" ${item.category === 'brandy' ? 'selected' : ''}>Brandy & Cognac</option>
                                    <option value="tequila" ${item.category === 'tequila' ? 'selected' : ''}>Tequila & Mezcal</option>
                                    <option value="wine" ${item.category === 'wine' ? 'selected' : ''}>Wine</option>
                                    <option value="beer" ${item.category === 'beer' ? 'selected' : ''}>Beer & Cider</option>
                                    <option value="liqueurs" ${item.category === 'liqueurs' ? 'selected' : ''}>Liqueurs & Creams</option>
                                    <option value="rtd" ${item.category === 'rtd' ? 'selected' : ''}>Ready-to-Drink (RTD) & Flavored Alcohol</option>
                                    <option value="non-alcoholic" ${item.category === 'non-alcoholic' ? 'selected' : ''}>Non-Alcoholic Drinks</option>
                                    <option value="others" ${item.category === 'others' ? 'selected' : ''}>Others</option>
                                </select>
                            </div>
                            
                            <div class="form-group">
                                <label>Selling Price (KES) *</label>
                                <input type="number" id="editItemPrice" class="form-input" value="${item.price || item.sellingPrice || 0}" step="0.01" min="0" required>
                            </div>
                            
                            <div class="form-group">
                                <label>Buying Price (KES)</label>
                                <input type="number" id="editItemCost" class="form-input" value="${item.cost || item.buyingPrice || 0}" step="0.01" min="0">
                            </div>
                            
                            <div class="form-group">
                                <label>Quantity *</label>
                                <input type="number" id="editItemQuantity" class="form-input" value="${item.quantity || item.stock || 0}" min="0" required>
                            </div>
                            
                            <div class="form-group">
                                <label>Reorder Level</label>
                                <input type="number" id="editItemReorder" class="form-input" value="${item.reorderLevel || 5}" min="0">
                            </div>
                            
                            <div class="form-group form-group-full">
                                <label>Description</label>
                                <textarea id="editItemDescription" class="form-input" rows="3">${item.description || ''}</textarea>
                            </div>
                            
                            <div class="form-group">
                                <label>Supplier</label>
                                <input type="text" id="editItemSupplier" class="form-input" value="${item.supplier || ''}">
                            </div>
                            
                            <div class="form-group">
                                <label>Location</label>
                                <input type="text" id="editItemLocation" class="form-input" value="${item.location || ''}">
                            </div>
                        </div>
                    </form>
                </div>
                <div class="pos-modal-footer">
                    <button class="btn-secondary" onclick="this.closest('.pos-modal').remove()">Cancel</button>
                    <button class="btn-primary" id="saveItemBtn" onclick="window.inventoryManager.saveItemChanges('${itemId}')">
                        <svg id="saveItemIcon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                        <span id="saveItemText">Save Changes</span>
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
    }

    // Save item changes
    async saveItemChanges(itemId) {
        const form = document.getElementById('editItemForm');
        if (!form.checkValidity()) {
            form.reportValidity();
            return;
        }

        // Get button elements
        const saveBtn = document.getElementById('saveItemBtn');
        const saveIcon = document.getElementById('saveItemIcon');
        const saveText = document.getElementById('saveItemText');
        
        // Disable button and show spinning animation
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.style.opacity = '0.7';
            saveBtn.style.cursor = 'not-allowed';
        }
        if (saveIcon) {
            // Change to spinner icon
            saveIcon.innerHTML = '<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" fill="none" stroke-dasharray="60" stroke-dashoffset="15" />';
            saveIcon.classList.add('spinning');
        }
        if (saveText) {
            saveText.textContent = 'Saving...';
        }

        const updates = {
            name: document.getElementById('editItemName').value,
            barcode: document.getElementById('editItemBarcode').value,
            category: document.getElementById('editItemCategory').value,
            price: parseFloat(document.getElementById('editItemPrice').value) || 0,
            sellingPrice: parseFloat(document.getElementById('editItemPrice').value) || 0,
            cost: parseFloat(document.getElementById('editItemCost').value) || 0,
            buyingPrice: parseFloat(document.getElementById('editItemCost').value) || 0,
            quantity: parseInt(document.getElementById('editItemQuantity').value) || 0,
            stock: parseInt(document.getElementById('editItemQuantity').value) || 0,
            reorderLevel: parseInt(document.getElementById('editItemReorder').value) || 5,
            description: document.getElementById('editItemDescription').value,
            supplier: document.getElementById('editItemSupplier').value,
            location: document.getElementById('editItemLocation').value
        };

        try {
            console.log('💾 Saving item updates to database in real-time...');
            console.log('📝 Category being saved:', updates.category);
            
            // Get the full item data to pass along in case we need to create it in Firebase
            const fullItem = this.items.find(i => i.id === itemId);
            const oldQty = Math.max(0, parseInt(fullItem?.quantity, 10) || parseInt(fullItem?.stock, 10) || 0);

            // Update in Firebase database FIRST to ensure real-time data consistency
            // Pass full item data so it can be created if it doesn't exist in Firebase
            await dataManager.updateInventoryItem(itemId, updates, fullItem);
            console.log('✅ Database update successful');
            
            // Update local item after successful database update
            if (fullItem) {
                Object.assign(fullItem, updates);
                console.log('✅ Local item updated:', fullItem.name, '| Category:', fullItem.category);
            }
            
            // Update in filtered items as well
            const filteredItem = this.filteredItems.find(i => i.id === itemId);
            if (filteredItem) {
                Object.assign(filteredItem, updates);
                console.log('✅ Filtered item updated with category:', filteredItem.category);
            }
            
            // Log activity
            if (window.activityTracker) {
                window.activityTracker.logActivity('inventory', 'updated', {
                    itemName: updates.name,
                    itemId: itemId,
                    changes: Object.keys(updates).join(', ')
                });
            }

            const newQty = updates.quantity;
            const cloudId = itemId && !itemId.startsWith('item_') && !itemId.startsWith('local_');
            if (cloudId && newQty > oldQty) {
                const { branchId, branchName } = stockHistoryBranchFromItem(fullItem);
                void appendStockHistoryRecord({
                    itemId,
                    itemName: updates.name,
                    sku: fullItem?.sku || '',
                    branchId,
                    branchName,
                    quantityBefore: oldQty,
                    quantityAdded: newQty - oldQty,
                    quantityAfter: newQty,
                    source: 'edit_increase'
                });
            }

            // Recalculate stats with new values
            this.calculateStats();
            
            // Close modal after successful save
            const modal = document.querySelector('.pos-modal');
            if (modal) modal.remove();
            
            // Update UI immediately to reflect changes in real-time
            this.updateStatsUI();
            this.renderTable();
            
            window.showNotification('Item updated successfully', 'success');
        } catch (error) {
            console.error('❌ Error updating item:', error);
            console.error('Error details:', error.message);
            
            // Check if this is a local item error
            if (error.message.includes('exists only locally') || error.message.includes('local ID')) {
                // Close modal first
                const modal = document.querySelector('.pos-modal');
                if (modal) modal.remove();
                
                const confirmed = await window.uiConfirm?.({
                    title: 'Local-only item',
                    message: 'This item was created locally and cannot be synced to Firebase. Remove it locally and reload the inventory from the cloud?',
                    tone: 'warning',
                    okLabel: 'Remove & reload'
                });
                
                if (confirmed) {
                    // Remove local item
                    this.items = this.items.filter(i => i.id !== itemId);
                    this.filteredItems = this.filteredItems.filter(i => i.id !== itemId);
                    this.selectedItems.delete(itemId);
                    
                    // Reload from Firebase
                    window.showNotification('Removing local item and reloading...', 'info');
                    await this.refresh();
                    window.showNotification('Inventory reloaded from Firebase', 'success');
                    return;
                }
            } else {
                window.showNotification('Failed to update item: ' + error.message, 'error');
            }
            
            // Reset button state on error
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.style.opacity = '1';
                saveBtn.style.cursor = 'pointer';
            }
            if (saveIcon) {
                saveIcon.classList.remove('spinning');
                // Restore checkmark icon
                saveIcon.innerHTML = '<polyline points="20 6 9 17 4 12"></polyline>';
            }
            if (saveText) {
                saveText.textContent = 'Save Changes';
            }
        }
    }


    // Delete item
    async deleteItem(itemId) {
        const item = this.items.find(i => i.id === itemId);
        if (!item) {
            window.showNotification('Item not found', 'error');
            return;
        }

        const confirmed = await window.uiConfirm?.({
            title: 'Delete inventory item?',
            message: `Are you sure you want to delete "${item.name}"? This cannot be undone.`,
            tone: 'danger',
            okLabel: 'Delete'
        });
        if (!confirmed) return;

        console.log('🗑️ Starting delete process for item:', itemId, item.name);

        try {
            // Delete from Firebase database FIRST - this ensures real-time sync
            console.log('📤 Deleting from Firebase...');
            await dataManager.deleteInventoryItem(itemId);
            console.log('✅ Firebase deletion complete');
            
            // Log activity after successful deletion
            if (window.activityTracker) {
                window.activityTracker.logActivity('inventory', 'deleted', {
                    itemName: item.name,
                    itemId: itemId,
                    sku: item.sku
                });
            }
            
            // Remove from local arrays for instant UI update
            console.log('🔄 Removing from local arrays...');
            this.items = this.items.filter(i => i.id !== itemId);
            this.selectedItems.delete(itemId);
            
            // Update filtered items
            this.filteredItems = this.filteredItems.filter(i => i.id !== itemId);
            
            // Recalculate stats and pagination
            this.calculateStats();
            this.calculatePagination();
            
            // Re-render table immediately
            this.updateStatsUI();
            this.renderTable();
            
            window.showNotification('Item deleted successfully', 'success');
        } catch (error) {
            console.error('Error deleting item:', error);
            window.showNotification('Failed to delete item', 'error');
            // Reload on error to ensure consistency
            await this.refresh();
        }
    }
    
    // Refresh inventory data
    async refresh() {
        console.log('🔄 Starting refresh process...');
        this.showLoading(true);
        this.selectedItems.clear();

        this._stopInventoryRealtime();
        await this.loadInventory();
        this._startInventoryRealtime();

        this.applyFilters();
        this.updateStatsUI();
        this.renderTable();

        this.showLoading(false);
        console.log('✅ Refresh complete');
    }
    
    // Handle refresh button click
}

// Create and export singleton instance
const inventoryManager = new InventoryManager();
export default inventoryManager;
