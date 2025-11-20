// Global Search System
import dataManager from './data-manager.js';

class GlobalSearch {
    constructor() {
        this.searchInput = null;
        this.searchResults = null;
        this.searchTimeout = null;
        this.isSearching = false;
        this.currentResults = [];
    }

    // Initialize global search
    init() {
        this.searchInput = document.getElementById('globalSearchInput');
        this.searchResults = document.getElementById('globalSearchResults');

        if (!this.searchInput || !this.searchResults) {
            console.warn('Global search elements not found');
            return;
        }

        this.attachEventListeners();
        console.log('✅ Global search initialized');
    }

    // Attach event listeners
    attachEventListeners() {
        // Search input
        this.searchInput.addEventListener('input', (e) => {
            const query = e.target.value.trim();
            
            // Clear previous timeout
            clearTimeout(this.searchTimeout);
            
            if (query.length < 2) {
                this.hideResults();
                return;
            }

            // Debounce search
            this.searchTimeout = setTimeout(() => {
                this.performSearch(query);
            }, 300);
        });

        // Focus and blur events
        this.searchInput.addEventListener('focus', () => {
            if (this.currentResults.length > 0) {
                this.showResults();
            }
        });

        this.searchInput.addEventListener('blur', () => {
            // Delay hiding to allow click on results
            setTimeout(() => {
                this.hideResults();
            }, 200);
        });

        // Close on escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.hideResults();
                this.searchInput.blur();
            }
        });

        // Close when clicking outside
        document.addEventListener('click', (e) => {
            if (!this.searchInput.contains(e.target) && !this.searchResults.contains(e.target)) {
                this.hideResults();
            }
        });
    }

    // Perform search across all modules
    async performSearch(query) {
        if (this.isSearching) return;
        
        this.isSearching = true;
        this.showLoading();

        try {
            const queryLower = query.toLowerCase();
            
            // Search all modules in parallel
            const [
                inventoryResults,
                customerResults,
                salesResults,
                expenseResults,
                orderResults,
                supplierResults
            ] = await Promise.all([
                this.searchInventory(queryLower),
                this.searchCustomers(queryLower),
                this.searchSales(queryLower),
                this.searchExpenses(queryLower),
                this.searchOrders(queryLower),
                this.searchSuppliers(queryLower)
            ]);

            // Combine and categorize results
            this.currentResults = [
                ...inventoryResults,
                ...customerResults,
                ...salesResults,
                ...expenseResults,
                ...orderResults,
                ...supplierResults
            ];

            // Display results
            if (this.currentResults.length > 0) {
                this.displayResults(this.currentResults);
            } else {
                this.displayNoResults(query);
            }

        } catch (error) {
            console.error('Search error:', error);
            this.displayError();
        } finally {
            this.isSearching = false;
        }
    }

    // Search inventory/products
    async searchInventory(query) {
        try {
            const items = await dataManager.getInventory();
            
            return items
                .filter(item => 
                    item.name?.toLowerCase().includes(query) ||
                    item.sku?.toLowerCase().includes(query) ||
                    item.category?.toLowerCase().includes(query) ||
                    item.description?.toLowerCase().includes(query)
                )
                .slice(0, 5)
                .map(item => ({
                    type: 'inventory',
                    id: item.id,
                    title: item.name,
                    subtitle: `SKU: ${item.sku} | Stock: ${item.quantity}`,
                    description: `KES ${item.price}`,
                    icon: 'inventory',
                    action: () => this.navigateToInventory(item.id)
                }));
        } catch (error) {
            console.error('Error searching inventory:', error);
            return [];
        }
    }

    // Search customers
    async searchCustomers(query) {
        try {
            const customers = await dataManager.getCustomers();
            
            return customers
                .filter(customer => 
                    customer.name?.toLowerCase().includes(query) ||
                    customer.email?.toLowerCase().includes(query) ||
                    customer.phone?.toLowerCase().includes(query) ||
                    customer.company?.toLowerCase().includes(query)
                )
                .slice(0, 5)
                .map(customer => ({
                    type: 'customer',
                    id: customer.id,
                    title: customer.name,
                    subtitle: customer.email || customer.phone,
                    description: customer.company || 'Individual',
                    icon: 'customer',
                    action: () => this.navigateToCustomers(customer.id)
                }));
        } catch (error) {
            console.error('Error searching customers:', error);
            return [];
        }
    }

    // Search sales
    async searchSales(query) {
        try {
            const sales = await dataManager.getSales({ limit: 100 });
            
            return sales
                .filter(sale => 
                    sale.invoiceNumber?.toLowerCase().includes(query) ||
                    sale.customerName?.toLowerCase().includes(query) ||
                    sale.total?.toString().includes(query)
                )
                .slice(0, 5)
                .map(sale => ({
                    type: 'sale',
                    id: sale.id,
                    title: `Invoice ${sale.invoiceNumber || sale.id}`,
                    subtitle: sale.customerName || 'Walk-in Customer',
                    description: `KES ${sale.total || sale.grandTotal || 0} | ${new Date(sale.createdAt).toLocaleDateString()}`,
                    icon: 'sale',
                    action: () => this.navigateToSales(sale.id)
                }));
        } catch (error) {
            console.error('Error searching sales:', error);
            return [];
        }
    }

    // Search expenses
    async searchExpenses(query) {
        try {
            const expenses = await dataManager.getExpenses({ limit: 100 });
            
            return expenses
                .filter(expense => 
                    expense.category?.toLowerCase().includes(query) ||
                    expense.description?.toLowerCase().includes(query) ||
                    expense.amount?.toString().includes(query)
                )
                .slice(0, 5)
                .map(expense => ({
                    type: 'expense',
                    id: expense.id,
                    title: expense.category || 'Expense',
                    subtitle: expense.description || 'No description',
                    description: `KES ${expense.amount} | ${new Date(expense.date).toLocaleDateString()}`,
                    icon: 'expense',
                    action: () => this.navigateToExpenses(expense.id)
                }));
        } catch (error) {
            console.error('Error searching expenses:', error);
            return [];
        }
    }

    // Search orders
    async searchOrders(query) {
        try {
            const orders = await dataManager.getOrders({ limit: 100 });
            
            return orders
                .filter(order => 
                    order.orderNumber?.toLowerCase().includes(query) ||
                    order.supplierName?.toLowerCase().includes(query) ||
                    order.status?.toLowerCase().includes(query)
                )
                .slice(0, 5)
                .map(order => ({
                    type: 'order',
                    id: order.id,
                    title: `Order ${order.orderNumber || order.id}`,
                    subtitle: order.supplierName || 'Unknown Supplier',
                    description: `KES ${order.totalAmount || 0} | ${order.status || 'Pending'}`,
                    icon: 'order',
                    action: () => this.navigateToOrders(order.id)
                }));
        } catch (error) {
            console.error('Error searching orders:', error);
            return [];
        }
    }

    // Search suppliers
    async searchSuppliers(query) {
        try {
            const suppliers = await dataManager.getSuppliers();
            
            return suppliers
                .filter(supplier => 
                    supplier.name?.toLowerCase().includes(query) ||
                    supplier.email?.toLowerCase().includes(query) ||
                    supplier.phone?.toLowerCase().includes(query) ||
                    supplier.company?.toLowerCase().includes(query)
                )
                .slice(0, 5)
                .map(supplier => ({
                    type: 'supplier',
                    id: supplier.id,
                    title: supplier.name || supplier.company,
                    subtitle: supplier.email || supplier.phone,
                    description: supplier.company || 'Supplier',
                    icon: 'supplier',
                    action: () => this.navigateToSuppliers(supplier.id)
                }));
        } catch (error) {
            console.error('Error searching suppliers:', error);
            return [];
        }
    }

    // Display results
    displayResults(results) {
        // Group by type
        const grouped = {};
        results.forEach(result => {
            if (!grouped[result.type]) {
                grouped[result.type] = [];
            }
            grouped[result.type].push(result);
        });

        let html = '<div class="search-results-container">';
        
        // Display by category
        for (const [type, items] of Object.entries(grouped)) {
            html += `
                <div class="search-category">
                    <div class="search-category-header">
                        ${this.getTypeIcon(type)}
                        <span>${this.getTypeName(type)}</span>
                        <span class="search-count">${items.length}</span>
                    </div>
                    <div class="search-category-items">
            `;
            
            items.forEach(item => {
                html += `
                    <div class="search-result-item" data-type="${item.type}" data-id="${item.id}">
                        <div class="search-result-icon">${this.getItemIcon(item.icon)}</div>
                        <div class="search-result-content">
                            <div class="search-result-title">${this.highlightMatch(item.title)}</div>
                            <div class="search-result-subtitle">${item.subtitle}</div>
                            <div class="search-result-description">${item.description}</div>
                        </div>
                        <svg class="search-result-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="9 18 15 12 9 6"></polyline>
                        </svg>
                    </div>
                `;
            });
            
            html += `
                    </div>
                </div>
            `;
        }
        
        html += '</div>';
        
        this.searchResults.innerHTML = html;
        this.showResults();
        
        // Attach click handlers
        this.attachResultHandlers();
    }

    // Attach click handlers to results
    attachResultHandlers() {
        const resultItems = this.searchResults.querySelectorAll('.search-result-item');
        
        resultItems.forEach(item => {
            item.addEventListener('click', () => {
                const type = item.getAttribute('data-type');
                const id = item.getAttribute('data-id');
                
                const result = this.currentResults.find(r => r.type === type && r.id === id);
                if (result && result.action) {
                    result.action();
                    this.hideResults();
                    this.searchInput.value = '';
                }
            });
        });
    }

    // Highlight matching text
    highlightMatch(text) {
        const query = this.searchInput.value.trim();
        if (!query) return text;
        
        const regex = new RegExp(`(${query})`, 'gi');
        return text.replace(regex, '<mark>$1</mark>');
    }

    // Get type name
    getTypeName(type) {
        const names = {
            inventory: 'Products',
            customer: 'Customers',
            sale: 'Sales',
            expense: 'Expenses',
            order: 'Orders',
            supplier: 'Suppliers'
        };
        return names[type] || type;
    }

    // Get type icon
    getTypeIcon(type) {
        const icons = {
            inventory: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path></svg>',
            customer: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>',
            sale: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg>',
            expense: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>',
            order: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>',
            supplier: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>'
        };
        return icons[type] || icons.inventory;
    }

    // Get item icon
    getItemIcon(icon) {
        return this.getTypeIcon(icon);
    }

    // Navigation methods
    navigateToInventory(id) {
        const link = document.querySelector('[data-page="inventory"]');
        if (link) link.click();
        console.log('Navigate to inventory item:', id);
    }

    navigateToCustomers(id) {
        const link = document.querySelector('[data-page="customers"]');
        if (link) link.click();
        console.log('Navigate to customer:', id);
    }

    navigateToSales(id) {
        const link = document.querySelector('[data-page="all-sales"]');
        if (link) link.click();
        console.log('Navigate to sale:', id);
    }

    navigateToExpenses(id) {
        const link = document.querySelector('[data-page="expenses"]');
        if (link) link.click();
        console.log('Navigate to expense:', id);
    }

    navigateToOrders(id) {
        const link = document.querySelector('[data-page="orders"]');
        if (link) link.click();
        console.log('Navigate to order:', id);
    }

    navigateToSuppliers(id) {
        const link = document.querySelector('[data-page="add-supplier"]');
        if (link) link.click();
        console.log('Navigate to supplier:', id);
    }

    // Display loading state
    showLoading() {
        this.searchResults.innerHTML = `
            <div class="search-loading">
                <div class="spinner"></div>
                <p>Searching...</p>
            </div>
        `;
        this.showResults();
    }

    // Display no results
    displayNoResults(query) {
        this.searchResults.innerHTML = `
            <div class="search-no-results">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <circle cx="11" cy="11" r="8"></circle>
                    <path d="m21 21-4.35-4.35"></path>
                </svg>
                <p>No results found for "${query}"</p>
                <span>Try searching with different keywords</span>
            </div>
        `;
        this.showResults();
    }

    // Display error
    displayError() {
        this.searchResults.innerHTML = `
            <div class="search-error">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
                <p>Search error occurred</p>
                <span>Please try again</span>
            </div>
        `;
        this.showResults();
    }

    // Show results
    showResults() {
        this.searchResults.classList.add('active');
    }

    // Hide results
    hideResults() {
        this.searchResults.classList.remove('active');
    }
}

// Create singleton instance
const globalSearch = new GlobalSearch();

// Make it globally available
window.globalSearch = globalSearch;

export default globalSearch;
