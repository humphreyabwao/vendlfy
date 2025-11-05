// Inventory Management System
import { db, collection, addDoc, getDocs, doc, updateDoc, deleteDoc, query, where, orderBy } from './firebase-config.js';
import branchManager from './branch-manager.js';
import dataManager from './data-manager.js';

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
    }

    // Initialize inventory when page loads
    async init() {
        this.showLoading(true);
        await this.loadInventory();
        this.applyFilters();
        this.updateStatsUI();
        this.renderTable();
        this.attachEventListeners();
        this.showLoading(false);
    }

    // Load inventory items
    async loadInventory() {
        try {
            const items = await dataManager.getInventory();
            this.items = items;
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
            const quantity = item.quantity || 0;
            const price = item.price || 0;
            const reorderLevel = item.reorderLevel || 5;
            
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
                const quantity = item.quantity || 0;
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
                    compareA = a.quantity || 0;
                    compareB = b.quantity || 0;
                    break;
                case 'value':
                    compareA = (a.quantity || 0) * (a.price || 0);
                    compareB = (b.quantity || 0) * (b.price || 0);
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
        this.renderTable();
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
        const quantity = item.quantity || 0;
        const price = item.price || 0;
        const reorderLevel = item.reorderLevel || 5;
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
                <input type="checkbox" class="checkbox item-checkbox" data-id="${itemId}" ${this.selectedItems.has(itemId) ? 'checked' : ''}>
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
            });
        }

        // Category filter
        const categoryFilter = document.getElementById('inventoryCategoryFilter');
        if (categoryFilter) {
            categoryFilter.addEventListener('change', (e) => {
                this.filters.category = e.target.value;
                this.applyFilters();
            });
        }

        // Status filter
        const statusFilter = document.getElementById('inventoryStatusFilter');
        if (statusFilter) {
            statusFilter.addEventListener('change', (e) => {
                this.filters.status = e.target.value;
                this.applyFilters();
            });
        }

        // Sort by
        const sortBy = document.getElementById('inventorySortBy');
        if (sortBy) {
            sortBy.addEventListener('change', (e) => {
                this.filters.sortBy = e.target.value;
                this.applyFilters();
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
        const headers = ['Item Name', 'SKU', 'Category', 'Quantity', 'Price (KSh)', 'Total Value (KSh)', 'Reorder Level', 'Status', 'Branch'];
        
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

        // Add summary row
        const totalValue = items.reduce((sum, item) => sum + ((item.quantity || 0) * (item.price || 0)), 0);
        const totalItems = items.reduce((sum, item) => sum + (item.quantity || 0), 0);
        
        rows.push([]);
        rows.push(['SUMMARY', '', '', '', '', '', '', '', '']);
        rows.push(['Total Items:', totalItems, '', '', '', '', '', '', '']);
        rows.push(['Total Value:', '', '', '', '', totalValue.toFixed(2), '', '', '']);

        const csvContent = [
            headers.join(','),
            ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `inventory-export-${window.formatDate(new Date())}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);

        window.showNotification('Inventory exported to Excel successfully', 'success');
    }

    // Export to PDF using jsPDF
    async exportToPDF(items) {
        // Check if jsPDF is loaded
        if (typeof window.jspdf === 'undefined') {
            await this.loadJsPDF();
        }

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        const currentBranch = branchManager.getCurrentBranch();
        const branchName = currentBranch ? currentBranch.name : 'All Branches';
        
        // Add title
        doc.setFontSize(18);
        doc.text('Inventory Report', 14, 22);
        
        doc.setFontSize(11);
        doc.text(`Branch: ${branchName}`, 14, 32);
        doc.text(`Generated: ${window.formatDateTime(new Date())}`, 14, 38);
        doc.text(`Total Items: ${items.length}`, 14, 44);

        // Add summary stats
        const totalValue = items.reduce((sum, item) => sum + ((item.quantity || 0) * (item.price || 0)), 0);
        const totalQty = items.reduce((sum, item) => sum + (item.quantity || 0), 0);
        
        doc.text(`Total Stock Value: ${window.formatCurrency(totalValue)}`, 14, 50);
        doc.text(`Total Quantity: ${totalQty} items`, 14, 56);

        // Prepare table data
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
                `KSh ${price.toFixed(2)}`,
                `KSh ${(quantity * price).toFixed(2)}`,
                status
            ];
        });

        // Add table
        doc.autoTable({
            head: [['Item Name', 'SKU', 'Qty', 'Price', 'Value', 'Status']],
            body: tableData,
            startY: 65,
            styles: { fontSize: 9 },
            headStyles: { fillColor: [37, 99, 235] },
        });

        // Save PDF
        doc.save(`inventory-report-${window.formatDate(new Date())}.pdf`);

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

    // Refresh inventory data
    async refresh() {
        await this.loadInventory();
        this.applyFilters();
        this.updateStatsUI();
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

        // Create modal or show details
        alert(`Item Details:\n\nName: ${item.name}\nSKU: ${item.sku}\nCategory: ${item.category}\nQuantity: ${item.quantity}\nPrice: ${window.formatCurrency(item.price)}`);
    }

    // Edit item
    editItem(itemId) {
        const item = this.items.find(i => i.id === itemId);
        if (!item) {
            window.showNotification('Item not found', 'error');
            return;
        }

        // Navigate to edit page or open modal
        window.showNotification('Edit functionality coming soon', 'info');
        // TODO: Implement edit modal or navigate to edit page
    }

    // Delete item
    async deleteItem(itemId) {
        const item = this.items.find(i => i.id === itemId);
        if (!item) {
            window.showNotification('Item not found', 'error');
            return;
        }

        const confirmed = confirm(`Are you sure you want to delete "${item.name}"?\n\nThis action cannot be undone.`);
        if (!confirmed) return;

        try {
            // TODO: Implement actual delete from database
            // await dataManager.deleteInventoryItem(itemId);
            
            // For now, remove from local array
            this.items = this.items.filter(i => i.id !== itemId);
            this.selectedItems.delete(itemId);
            
            await this.refresh();
            window.showNotification('Item deleted successfully', 'success');
        } catch (error) {
            console.error('Error deleting item:', error);
            window.showNotification('Failed to delete item', 'error');
        }
    }
}

// Create and export singleton instance
const inventoryManager = new InventoryManager();
export default inventoryManager;
