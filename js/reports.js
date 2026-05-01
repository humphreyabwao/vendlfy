// Reports Module - Comprehensive Business Reports with Real-Time Charts
import { db, collection, getDocs, query, where, onSnapshot } from './firebase-config.js';
import brandManager from './brand-manager.js';

const reportsManager = {
    sales: [],
    b2bSales: [],
    expenses: [],
    orders: [],
    inventory: [],
    customers: [],
    suppliers: [],
    initialized: false,
    refreshInterval: null,
    charts: {},
    currentPeriod: 'month', // today, week, month, year, custom
    realtimeListeners: [], // Store unsubscribe functions for cleanup
    lastUpdateTime: null,
    updateCount: 0,

    async init() {
        console.log('📊 Initializing Reports Manager...');

        // Show loading state on stat cards
        this.showLoadingState();

        await this.waitForFirebase();
        
        // Load data from managers FIRST (immediate data)
        await this.loadDataFromManagers();
        
        // Render with manager data immediately
        this.renderAllReports();
        console.log('📊 Initial render complete with manager data');
        
        // Setup real-time Firestore listeners for automatic updates
        if (!this.initialized) {
            await this.setupRealtimeListeners();
            this.setupEventListeners();
            this.initialized = true;
        }

        console.log('✅ Reports Manager ready with real-time data sync');
    },





    // Force refresh all data
    async forceRefresh() {
        console.log('🔄 Refreshing reports data...');
        await this.loadDataFromManagers();
        this.renderAllReports();
        console.log('✅ Refresh complete');
    },

    showLoadingState() {
        // Show loading indicators on stat cards
        this.updateElement('reportTotalRevenue', 'Loading...');
        this.updateElement('reportTotalExpenses', 'Loading...');
        this.updateElement('reportNetProfit', 'Loading...');
        this.updateElement('reportTotalTransactions', 'Loading...');
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
        // Period selector
        const periodBtns = document.querySelectorAll('.report-period-btn');
        periodBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                periodBtns.forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.currentPeriod = e.target.dataset.period;
                this.renderAllReports();
                this.showNotification(`Showing ${e.target.dataset.period} data`, 'info');
            });
        });

        // Refresh button with loading state
        const refreshBtn = document.getElementById('refreshReportsBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', async () => {
                refreshBtn.disabled = true;
                refreshBtn.innerHTML = `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="rotating">
                        <polyline points="23 4 23 10 17 10"></polyline>
                        <polyline points="1 20 1 14 7 14"></polyline>
                        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                    </svg>
                    Refreshing...
                `;
                
                await this.loadAllData();
                
                refreshBtn.disabled = false;
                refreshBtn.innerHTML = `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="23 4 23 10 17 10"></polyline>
                        <polyline points="1 20 1 14 7 14"></polyline>
                        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                    </svg>
                    Refresh
                `;
            });
        }

        // Export buttons
        const exportPdfBtn = document.getElementById('exportReportPdf');
        if (exportPdfBtn) {
            exportPdfBtn.addEventListener('click', () => this.exportToPDF());
        }

        const exportExcelBtn = document.getElementById('exportReportExcel');
        if (exportExcelBtn) {
            exportExcelBtn.addEventListener('click', () => this.exportToExcel());
        }

        // Custom Report Generator
        const generateCustomReportBtn = document.getElementById('generateCustomReportBtn');
        if (generateCustomReportBtn) {
            generateCustomReportBtn.addEventListener('click', () => this.generateCustomReport());
        }

        // Listen for branch changes to re-setup listeners
        window.addEventListener('branchChanged', () => {
            console.log('📊 Branch changed, reinitializing reports...');
            this.setupRealtimeListeners();
        });

        // Auto-compare feature
        const autoCompareBtn = document.getElementById('autoCompareBtn');
        if (autoCompareBtn) {
            autoCompareBtn.addEventListener('click', () => this.showComparativeAnalysis());
        }

        // Listen for custom event when reports page is shown
        window.addEventListener('reportsPageShown', async () => {
            console.log('📊 Reports page opened - loading fresh data');
            await this.loadDataFromManagers();
            this.renderAllReports();
        });
    },

    // Cleanup on destroy
    destroy() {
        console.log('🧹 Destroying Reports Manager...');
        this.cleanupListeners();
        this.initialized = false;
    },

    async setupRealtimeListeners() {
        console.log('🔄 Setting up real-time Firestore listeners...');

        try {
            // Get current branch - handle both object and string ID
            const currentBranch = window.branchManager?.currentBranch;
            const branchId = currentBranch?.id || currentBranch;
            
            if (!branchId) {
                console.warn('⚠️ Branch ID not available yet, retrying in 2 seconds...');
                setTimeout(() => this.setupRealtimeListeners(), 2000);
                return;
            }

            if (!window.db) {
                console.warn('⚠️ Firestore DB not available, using data manager fallback...');
                await this.loadDataFromManagers();
                return;
            }

            console.log('📊 Setting up listeners for branch:', branchId);

            // Unsubscribe from existing listeners
            this.cleanupListeners();

            // Sales Listener — single subscription, partitioned client-side into
            // POS vs B2B. Previously this method created TWO identical onSnapshot
            // subscriptions on the same `where('branchId','==', branchId)` query
            // (one tagged "POS", one tagged "B2B"), doubling Firestore reads on
            // every sales document change.
            const salesRef = collection(db, 'sales');
            const salesQuery = query(salesRef, where('branchId', '==', branchId));
            const unsubSales = onSnapshot(salesQuery, (snapshot) => {
                const pos = [];
                const b2b = [];
                snapshot.forEach(doc => {
                    const data = doc.data();
                    const item = { id: doc.id, ...data };
                    if (data.type === 'b2b' || data.saleType === 'wholesale') {
                        b2b.push(item);
                    } else {
                        pos.push(item);
                    }
                });
                this.sales = pos;
                this.b2bSales = b2b;
                console.log(`🔄 Real-time update: ${pos.length} POS sales, ${b2b.length} B2B sales`);
                this.onDataUpdate('sales');
            });
            this.realtimeListeners.push(unsubSales);

            // Expenses Listener
            const expensesRef = collection(db, 'expenses');
            const expensesQuery = query(expensesRef, where('branchId', '==', branchId));
            const unsubExpenses = onSnapshot(expensesQuery, (snapshot) => {
                this.expenses = [];
                snapshot.forEach(doc => {
                    this.expenses.push({ id: doc.id, ...doc.data() });
                });
                console.log(`🔄 Real-time update: ${this.expenses.length} expenses`);
                this.onDataUpdate('expenses');
            });
            this.realtimeListeners.push(unsubExpenses);

            // Orders Listener
            const ordersRef = collection(db, 'orders');
            const ordersQuery = query(ordersRef, where('branchId', '==', branchId));
            const unsubOrders = onSnapshot(ordersQuery, (snapshot) => {
                this.orders = [];
                snapshot.forEach(doc => {
                    this.orders.push({ id: doc.id, ...doc.data() });
                });
                console.log(`🔄 Real-time update: ${this.orders.length} orders`);
                this.onDataUpdate('orders');
            });
            this.realtimeListeners.push(unsubOrders);

            // Inventory Listener
            const inventoryRef = collection(db, 'inventory');
            const inventoryQuery = query(inventoryRef, where('branchId', '==', branchId));
            const unsubInventory = onSnapshot(inventoryQuery, (snapshot) => {
                this.inventory = [];
                snapshot.forEach(doc => {
                    this.inventory.push({ id: doc.id, ...doc.data() });
                });
                console.log(`🔄 Real-time update: ${this.inventory.length} inventory items`);
                this.onDataUpdate('inventory');
            });
            this.realtimeListeners.push(unsubInventory);

            // Customers Listener
            const customersRef = collection(db, 'customers');
            const customersQuery = query(customersRef, where('branchId', '==', branchId));
            const unsubCustomers = onSnapshot(customersQuery, (snapshot) => {
                this.customers = [];
                snapshot.forEach(doc => {
                    this.customers.push({ id: doc.id, ...doc.data() });
                });
                console.log(`🔄 Real-time update: ${this.customers.length} customers`);
                this.onDataUpdate('customers');
            });
            this.realtimeListeners.push(unsubCustomers);

            // Suppliers Listener
            const suppliersRef = collection(db, 'suppliers');
            const suppliersQuery = query(suppliersRef, where('branchId', '==', branchId));
            const unsubSuppliers = onSnapshot(suppliersQuery, (snapshot) => {
                this.suppliers = [];
                snapshot.forEach(doc => {
                    this.suppliers.push({ id: doc.id, ...doc.data() });
                });
                console.log(`🔄 Real-time update: ${this.suppliers.length} suppliers`);
                this.onDataUpdate('suppliers');
            });
            this.realtimeListeners.push(unsubSuppliers);

            console.log('✅ Real-time listeners active for all modules');
        } catch (error) {
            console.error('❌ Error setting up real-time listeners:', error);
            this.showNotification('Error setting up real-time sync', 'error');
        }
    },

    cleanupListeners() {
        // Unsubscribe from all active listeners
        this.realtimeListeners.forEach(unsubscribe => {
            if (typeof unsubscribe === 'function') {
                unsubscribe();
            }
        });
        this.realtimeListeners = [];
        console.log('🧹 Cleaned up real-time listeners');
    },

    onDataUpdate(source) {
        // Track updates
        this.lastUpdateTime = new Date();
        this.updateCount++;

        // Only re-render if reports page is currently active
        const reportsPage = document.getElementById('reports-page');
        const isReportsActive = reportsPage?.classList.contains('active');

        if (!isReportsActive) {
            console.log(`📊 Data updated (${source}) but reports page not active - skipping render`);
            return;
        }

        // Update the last update indicator in UI
        this.updateLastSyncIndicator();

        // Debounce rapid updates to prevent excessive re-renders
        clearTimeout(this.renderDebounceTimer);
        this.renderDebounceTimer = setTimeout(() => {
            console.log(`📊 Rendering reports after ${source} update`);
            this.renderAllReports();
        }, 1000); // Wait 1 second after last update before re-rendering
    },

    logDataStatistics() {
        console.log('📊 Real-time Data Statistics:', {
            sales: this.sales.length,
            b2bSales: this.b2bSales.length,
            expenses: this.expenses.length,
            orders: this.orders.length,
            inventory: this.inventory.length,
            customers: this.customers.length,
            suppliers: this.suppliers.length,
            totalRevenue: this.sales.reduce((sum, s) => sum + (parseFloat(s.total) || 0), 0) +
                         this.b2bSales.reduce((sum, s) => sum + (parseFloat(s.total) || 0), 0),
            totalExpenses: this.expenses.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0),
            lastUpdate: this.lastUpdateTime?.toLocaleTimeString(),
            updateCount: this.updateCount
        });
    },

    updateLastSyncIndicator() {
        // Update a visual indicator showing when data was last synced
        const indicator = document.getElementById('lastSyncIndicator');
        if (indicator) {
            const timeStr = this.lastUpdateTime.toLocaleTimeString();
            indicator.innerHTML = `
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align: middle; margin-right: 4px;">
                    <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
                Last updated: ${timeStr}
            `;
            indicator.style.color = '#22c55e';
            indicator.style.fontWeight = '600';
            
            // Add a pulse animation
            indicator.classList.remove('pulse');
            setTimeout(() => indicator.classList.add('pulse'), 10);
            
            // Show brief notification
            this.showBriefUpdateNotification();
        }
    },

    showBriefUpdateNotification() {
        // Create or update a subtle notification
        let notification = document.getElementById('realtimeUpdateBadge');
        if (!notification) {
            notification = document.createElement('div');
            notification.id = 'realtimeUpdateBadge';
            notification.style.cssText = `
                position: fixed;
                top: 80px;
                right: 20px;
                background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
                color: white;
                padding: 8px 16px;
                border-radius: 8px;
                font-size: 13px;
                font-weight: 600;
                box-shadow: 0 4px 12px rgba(34, 197, 94, 0.3);
                z-index: 9999;
                display: flex;
                align-items: center;
                gap: 8px;
                animation: slideIn 0.3s ease-out;
                pointer-events: none;
            `;
            document.body.appendChild(notification);
        }

        notification.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            Data updated
        `;
        notification.style.display = 'flex';

        // Auto-hide after 2 seconds
        setTimeout(() => {
            if (notification) {
                notification.style.animation = 'slideOut 0.3s ease-out';
                setTimeout(() => {
                    notification.style.display = 'none';
                }, 300);
            }
        }, 2000);
    },

    async loadAllData() {
        // Fallback method for manual refresh
        console.log('📊 Manual data refresh...');

        try {
            await Promise.all([
                this.loadSales(),
                this.loadB2BSales(),
                this.loadExpenses(),
                this.loadOrders(),
                this.loadInventory(),
                this.loadCustomers(),
                this.loadSuppliers()
            ]);

            this.logDataStatistics();
            this.renderAllReports();
            this.showNotification('Reports refreshed successfully', 'success');
        } catch (error) {
            console.error('❌ Error loading reports data:', error);
            this.showNotification('Error loading data', 'error');
        }
    },

    async loadDataFromManagers() {
        // Load data from global managers
        try {
            // Get data from sales manager
            if (window.salesManager?.sales) {
                this.sales = window.salesManager.sales.filter(s => s.type !== 'b2b' && s.saleType !== 'wholesale');
            }

            // Get B2B sales
            if (window.b2bSalesManager?.sales) {
                this.b2bSales = window.b2bSalesManager.sales;
            }

            // Get expenses
            if (window.expenseManager?.expenses) {
                this.expenses = window.expenseManager.expenses;
            }

            // Get orders
            if (window.ordersManager?.orders) {
                this.orders = window.ordersManager.orders;
            }

            // Get inventory
            if (window.inventoryManager?.inventory) {
                this.inventory = window.inventoryManager.inventory;
            }

            // Get customers
            if (window.customerManager?.customers) {
                this.customers = window.customerManager.customers;
            }

            // Get suppliers
            if (window.supplierManager?.suppliers) {
                this.suppliers = window.supplierManager.suppliers;
            }

            console.log('📦 Data loaded:', {
                sales: this.sales.length,
                expenses: this.expenses.length,
                inventory: this.inventory.length
            });
        } catch (error) {
            console.error('Error loading data from managers:', error);
        }
    },

    async loadSales() {
        try {
            if (!window.db) {
                // Try to get from sales manager
                if (window.salesManager?.sales) {
                    this.sales = window.salesManager.sales.filter(s => s.type !== 'b2b' && s.saleType !== 'wholesale');
                    return;
                }
                return;
            }

            const currentBranch = window.branchManager?.currentBranch;
            const branchId = currentBranch?.id || currentBranch;
            
            if (!branchId) {
                this.sales = [];
                return;
            }

            const salesRef = collection(db, 'sales');
            const q = query(salesRef, where('branchId', '==', branchId));
            const snapshot = await getDocs(q);

            this.sales = [];
            snapshot.forEach(doc => {
                const data = doc.data();
                // Filter out B2B sales
                if (data.type !== 'b2b' && data.saleType !== 'wholesale') {
                    this.sales.push({ id: doc.id, ...data });
                }
            });

            console.log(`✅ Loaded ${this.sales.length} POS sales`);
        } catch (error) {
            console.error('Error loading sales:', error);
            this.sales = [];
        }
    },

    async loadB2BSales() {
        try {
            if (!window.db) {
                // Try to get from B2B manager
                if (window.b2bSalesManager?.sales) {
                    this.b2bSales = window.b2bSalesManager.sales;
                    return;
                }
                return;
            }

            const currentBranch = window.branchManager?.currentBranch;
            const branchId = currentBranch?.id || currentBranch;
            
            if (!branchId) {
                this.b2bSales = [];
                return;
            }

            const salesRef = collection(db, 'sales');
            const q = query(salesRef, where('branchId', '==', branchId));
            const snapshot = await getDocs(q);

            this.b2bSales = [];
            snapshot.forEach(doc => {
                const data = doc.data();
                // Filter B2B sales only
                if (data.type === 'b2b' || data.saleType === 'wholesale') {
                    this.b2bSales.push({ id: doc.id, ...data });
                }
            });

            console.log(`✅ Loaded ${this.b2bSales.length} B2B sales`);
        } catch (error) {
            console.error('Error loading B2B sales:', error);
            this.b2bSales = [];
        }
    },

    async loadExpenses() {
        try {
            if (!window.db) {
                // Try to get from expense manager
                if (window.expenseManager?.expenses) {
                    this.expenses = window.expenseManager.expenses;
                    return;
                }
                return;
            }

            const currentBranch = window.branchManager?.currentBranch;
            const branchId = currentBranch?.id || currentBranch;
            
            if (!branchId) {
                this.expenses = [];
                return;
            }

            const expensesRef = collection(db, 'expenses');
            const q = query(expensesRef, where('branchId', '==', branchId));
            const snapshot = await getDocs(q);

            this.expenses = [];
            snapshot.forEach(doc => {
                this.expenses.push({ id: doc.id, ...doc.data() });
            });

            console.log(`✅ Loaded ${this.expenses.length} expenses`);
        } catch (error) {
            console.error('Error loading expenses:', error);
            this.expenses = [];
        }
    },

    async loadOrders() {
        try {
            if (!window.db) {
                // Try to get from orders manager
                if (window.ordersManager?.orders) {
                    this.orders = window.ordersManager.orders;
                    return;
                }
                return;
            }

            const currentBranch = window.branchManager?.currentBranch;
            const branchId = currentBranch?.id || currentBranch;
            
            if (!branchId) {
                this.orders = [];
                return;
            }

            const ordersRef = collection(db, 'orders');
            const q = query(ordersRef, where('branchId', '==', branchId));
            const snapshot = await getDocs(q);

            this.orders = [];
            snapshot.forEach(doc => {
                this.orders.push({ id: doc.id, ...doc.data() });
            });

            console.log(`✅ Loaded ${this.orders.length} orders`);
        } catch (error) {
            console.error('Error loading orders:', error);
            this.orders = [];
        }
    },

    async loadInventory() {
        try {
            if (!window.db) {
                // Try to get from inventory manager
                if (window.inventoryManager?.inventory) {
                    this.inventory = window.inventoryManager.inventory;
                    return;
                }
                return;
            }

            const currentBranch = window.branchManager?.currentBranch;
            const branchId = currentBranch?.id || currentBranch;
            
            if (!branchId) {
                this.inventory = [];
                return;
            }

            const inventoryRef = collection(db, 'inventory');
            const q = query(inventoryRef, where('branchId', '==', branchId));
            const snapshot = await getDocs(q);

            this.inventory = [];
            snapshot.forEach(doc => {
                this.inventory.push({ id: doc.id, ...doc.data() });
            });

            console.log(`✅ Loaded ${this.inventory.length} inventory items`);
        } catch (error) {
            console.error('Error loading inventory:', error);
            this.inventory = [];
        }
    },

    async loadCustomers() {
        try {
            if (!window.db) {
                // Try to get from customer manager
                if (window.customerManager?.customers) {
                    this.customers = window.customerManager.customers;
                    return;
                }
                return;
            }

            const currentBranch = window.branchManager?.currentBranch;
            const branchId = currentBranch?.id || currentBranch;
            
            if (!branchId) {
                this.customers = [];
                return;
            }

            const customersRef = collection(db, 'customers');
            const q = query(customersRef, where('branchId', '==', branchId));
            const snapshot = await getDocs(q);

            this.customers = [];
            snapshot.forEach(doc => {
                this.customers.push({ id: doc.id, ...doc.data() });
            });

            console.log(`✅ Loaded ${this.customers.length} customers`);
        } catch (error) {
            console.error('Error loading customers:', error);
            this.customers = [];
        }
    },

    async loadSuppliers() {
        try {
            if (!window.db) {
                // Try to get from supplier manager
                if (window.supplierManager?.suppliers) {
                    this.suppliers = window.supplierManager.suppliers;
                    return;
                }
                return;
            }

            const currentBranch = window.branchManager?.currentBranch;
            const branchId = currentBranch?.id || currentBranch;
            
            if (!branchId) {
                this.suppliers = [];
                return;
            }

            const suppliersRef = collection(db, 'suppliers');
            const q = query(suppliersRef, where('branchId', '==', branchId));
            const snapshot = await getDocs(q);

            this.suppliers = [];
            snapshot.forEach(doc => {
                this.suppliers.push({ id: doc.id, ...doc.data() });
            });

            console.log(`✅ Loaded ${this.suppliers.length} suppliers`);
        } catch (error) {
            console.error('Error loading suppliers:', error);
            this.suppliers = [];
        }
    },

    renderAllReports() {
        this.renderInsights();
        this.renderOverviewCards();
        this.renderSalesChart();
        this.renderRevenueBreakdownChart();
        this.renderExpensesChart();
        this.renderTopProducts();
        this.renderRecentTransactions();
    },

    renderOverviewCards() {
        const data = this.getFilteredData();
        
        // Parse values as floats to ensure proper calculation
        const totalRevenue = data.sales.reduce((sum, s) => sum + (parseFloat(s.total) || 0), 0) +
                           data.b2bSales.reduce((sum, s) => sum + (parseFloat(s.total) || 0), 0);
        const totalExpenses = data.expenses.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
        const netProfit = totalRevenue - totalExpenses;
        const totalTransactions = data.sales.length + data.b2bSales.length;

        console.log('📊 Overview Cards Data (Real-time):', {
            totalRevenue,
            totalExpenses,
            netProfit,
            totalTransactions,
            salesCount: data.sales.length,
            b2bSalesCount: data.b2bSales.length,
            expensesCount: data.expenses.length,
            timestamp: new Date().toLocaleTimeString()
        });

        // Update elements with animation
        this.updateElementWithAnimation('reportTotalRevenue', this.formatCurrency(totalRevenue));
        this.updateElementWithAnimation('reportTotalExpenses', this.formatCurrency(totalExpenses));
        this.updateElementWithAnimation('reportNetProfit', this.formatCurrency(netProfit));
        this.updateElementWithAnimation('reportTotalTransactions', totalTransactions);

        // Update profit class with animation
        const profitEl = document.getElementById('reportNetProfit');
        if (profitEl) {
            const newClass = netProfit >= 0 ? 'stat-value profit' : 'stat-value loss';
            if (profitEl.className !== newClass) {
                profitEl.className = newClass;
                this.highlightElement(profitEl);
            }
        }

        // Highlight cards on update
        this.highlightCard('reportTotalRevenue');
        this.highlightCard('reportTotalExpenses');
        this.highlightCard('reportNetProfit');
        this.highlightCard('reportTotalTransactions');
    },

    renderSalesChart() {
        const canvas = document.getElementById('salesTrendChart');
        if (!canvas) return;

        const data = this.getSalesTrendData();
        
        // Destroy existing chart
        if (this.charts.salesTrend) {
            this.charts.salesTrend = null;
        }

        // Clear canvas
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Draw simple line chart
        this.drawLineChart(canvas, data, '#6366f1', '#22c55e');
    },

    renderRevenueBreakdownChart() {
        const canvas = document.getElementById('revenueBreakdownChart');
        if (!canvas) return;

        const data = this.getFilteredData();
        const posRevenue = data.sales.reduce((sum, s) => sum + (parseFloat(s.total) || 0), 0);
        const b2bRevenue = data.b2bSales.reduce((sum, s) => sum + (parseFloat(s.total) || 0), 0);

        const chartData = [
            { label: 'POS Sales', value: posRevenue, color: '#6366f1' },
            { label: 'B2B Sales', value: b2bRevenue, color: '#22c55e' }
        ];

        this.drawDonutChart(canvas, chartData);
    },

    renderExpensesChart() {
        const canvas = document.getElementById('expensesCategoryChart');
        if (!canvas) return;

        const data = this.getFilteredData();
        const expensesByCategory = {};

        data.expenses.forEach(expense => {
            const category = expense.category || 'Other';
            expensesByCategory[category] = (expensesByCategory[category] || 0) + (parseFloat(expense.amount) || 0);
        });

        const colors = ['#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16'];
        const chartData = Object.entries(expensesByCategory).map(([label, value], index) => ({
            label,
            value,
            color: colors[index % colors.length]
        }));

        this.drawBarChart(canvas, chartData);
    },

    renderTopProducts() {
        const data = this.getFilteredData();
        const productSales = {};

        // Aggregate from both POS and B2B sales
        [...data.sales, ...data.b2bSales].forEach(sale => {
            if (sale.items && Array.isArray(sale.items)) {
                sale.items.forEach(item => {
                    const key = item.name || item.product;
                    if (!productSales[key]) {
                        productSales[key] = { quantity: 0, revenue: 0 };
                    }
                    productSales[key].quantity += parseFloat(item.quantity) || 0;
                    productSales[key].revenue += parseFloat(item.total || (item.price * item.quantity)) || 0;
                });
            }
        });

        // Sort by revenue
        const topProducts = Object.entries(productSales)
            .map(([name, data]) => ({ name, ...data }))
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, 5);

        const container = document.getElementById('topProductsList');
        if (!container) return;

        if (topProducts.length === 0) {
            container.innerHTML = '<p class="no-data">No product sales data available</p>';
            return;
        }

        container.innerHTML = topProducts.map((product, index) => `
            <div class="product-item">
                <div class="product-rank">#${index + 1}</div>
                <div class="product-info">
                    <div class="product-name">${product.name}</div>
                    <div class="product-stats">
                        <span>${product.quantity} units</span>
                        <span class="product-revenue">${this.formatCurrency(product.revenue)}</span>
                    </div>
                </div>
            </div>
        `).join('');
    },

    renderRecentTransactions() {
        const data = this.getFilteredData();
        
        // Combine and sort transactions
        const allTransactions = [
            ...data.sales.map(s => ({ ...s, type: 'POS Sale' })),
            ...data.b2bSales.map(s => ({ ...s, type: 'B2B Sale' })),
            ...data.expenses.map(e => ({ ...e, type: 'Expense', total: -(parseFloat(e.amount) || 0) }))
        ].sort((a, b) => {
            const dateA = this.parseDate(a);
            const dateB = this.parseDate(b);
            return dateB - dateA;
        }).slice(0, 10);

        const container = document.getElementById('recentTransactionsList');
        if (!container) return;

        if (allTransactions.length === 0) {
            container.innerHTML = '<p class="no-data">No recent transactions</p>';
            return;
        }

        container.innerHTML = allTransactions.map(txn => {
            const isExpense = txn.type === 'Expense';
            const amount = parseFloat(txn.total) || parseFloat(txn.amount) || 0;
            const date = this.parseDate(txn);
            
            return `
                <div class="transaction-row">
                    <div class="transaction-info">
                        <div class="transaction-type">${txn.type}</div>
                        <div class="transaction-date">${this.formatDate(date)}</div>
                    </div>
                    <div class="transaction-amount ${isExpense ? 'expense' : 'revenue'}">
                        ${isExpense ? '-' : ''}${this.formatCurrency(Math.abs(amount))}
                    </div>
                </div>
            `;
        }).join('');
    },

    // Chart Drawing Functions
    drawLineChart(canvas, data, color1, color2) {
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        const padding = 60;
        const topPadding = 30;

        ctx.clearRect(0, 0, width, height);

        if (!data.labels || data.labels.length === 0) {
            ctx.fillStyle = '#9ca3af';
            ctx.font = '14px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('No data available', width / 2, height / 2);
            return;
        }

        // Calculate max value with buffer for better visualization
        const maxRevenue = Math.max(...data.revenue, 0);
        const maxExpenses = Math.max(...data.expenses, 0);
        const maxValue = Math.max(maxRevenue, maxExpenses);
        
        // Add 20% buffer to max value for better scaling
        const chartMax = maxValue > 0 ? maxValue * 1.2 : 100;
        
        // Calculate step for x-axis
        const chartWidth = width - padding * 2;
        const chartHeight = height - padding - topPadding;
        const step = data.labels.length > 1 ? chartWidth / (data.labels.length - 1) : chartWidth / 2;

        // Helper function to get y coordinate
        const getY = (value) => {
            const ratio = value / chartMax;
            return height - padding - (ratio * chartHeight);
        };

        // Draw background grid
        ctx.strokeStyle = '#f3f4f6';
        ctx.lineWidth = 1;
        for (let i = 0; i <= 5; i++) {
            const y = topPadding + (chartHeight * (i / 5));
            ctx.beginPath();
            ctx.moveTo(padding, y);
            ctx.lineTo(width - padding, y);
            ctx.stroke();
            
            // Draw y-axis labels
            const value = chartMax * (1 - i / 5);
            ctx.fillStyle = '#9ca3af';
            ctx.font = '11px Arial';
            ctx.textAlign = 'right';
            ctx.fillText(this.formatCurrency(value), padding - 10, y + 4);
        }

        // Draw axes
        ctx.strokeStyle = '#d1d5db';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(padding, topPadding);
        ctx.lineTo(padding, height - padding);
        ctx.lineTo(width - padding, height - padding);
        ctx.stroke();

        // Draw revenue line with gradient
        if (data.revenue.some(v => v > 0)) {
            // Create gradient
            const gradient1 = ctx.createLinearGradient(0, topPadding, 0, height - padding);
            gradient1.addColorStop(0, color1);
            gradient1.addColorStop(1, color1 + '80');

            // Draw area under curve
            ctx.beginPath();
            data.revenue.forEach((value, index) => {
                const x = padding + step * index;
                const y = getY(value);
                if (index === 0) {
                    ctx.moveTo(x, height - padding);
                    ctx.lineTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            });
            ctx.lineTo(padding + step * (data.revenue.length - 1), height - padding);
            ctx.closePath();
            ctx.fillStyle = color1 + '20';
            ctx.fill();

            // Draw line
            ctx.strokeStyle = color1;
            ctx.lineWidth = 3;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            data.revenue.forEach((value, index) => {
                const x = padding + step * index;
                const y = getY(value);
                if (index === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            });
            ctx.stroke();

            // Draw data points
            data.revenue.forEach((value, index) => {
                const x = padding + step * index;
                const y = getY(value);
                ctx.beginPath();
                ctx.arc(x, y, 5, 0, Math.PI * 2);
                ctx.fillStyle = '#ffffff';
                ctx.fill();
                ctx.strokeStyle = color1;
                ctx.lineWidth = 2;
                ctx.stroke();
            });
        }

        // Draw expenses line
        if (data.expenses.some(v => v > 0)) {
            // Draw area under curve
            ctx.beginPath();
            data.expenses.forEach((value, index) => {
                const x = padding + step * index;
                const y = getY(value);
                if (index === 0) {
                    ctx.moveTo(x, height - padding);
                    ctx.lineTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            });
            ctx.lineTo(padding + step * (data.expenses.length - 1), height - padding);
            ctx.closePath();
            ctx.fillStyle = color2 + '20';
            ctx.fill();

            // Draw line
            ctx.strokeStyle = color2;
            ctx.lineWidth = 3;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            data.expenses.forEach((value, index) => {
                const x = padding + step * index;
                const y = getY(value);
                if (index === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            });
            ctx.stroke();

            // Draw data points
            data.expenses.forEach((value, index) => {
                const x = padding + step * index;
                const y = getY(value);
                ctx.beginPath();
                ctx.arc(x, y, 5, 0, Math.PI * 2);
                ctx.fillStyle = '#ffffff';
                ctx.fill();
                ctx.strokeStyle = color2;
                ctx.lineWidth = 2;
                ctx.stroke();
            });
        }

        // Draw x-axis labels
        ctx.fillStyle = '#6b7280';
        ctx.font = '11px Arial';
        ctx.textAlign = 'center';
        data.labels.forEach((label, index) => {
            const x = padding + step * index;
            ctx.fillText(label, x, height - padding + 20);
        });
    },

    drawDonutChart(canvas, data) {
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        const centerX = width / 2;
        const centerY = height / 2;
        const radius = Math.min(width, height) / 2 - 40;
        const innerRadius = radius * 0.6;

        ctx.clearRect(0, 0, width, height);

        const total = data.reduce((sum, item) => sum + item.value, 0);
        
        if (total === 0) {
            ctx.fillStyle = '#9ca3af';
            ctx.font = '14px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('No data available', centerX, centerY);
            return;
        }

        let currentAngle = -Math.PI / 2;

        data.forEach(item => {
            const sliceAngle = (item.value / total) * 2 * Math.PI;

            // Draw outer arc
            ctx.fillStyle = item.color;
            ctx.beginPath();
            ctx.arc(centerX, centerY, radius, currentAngle, currentAngle + sliceAngle);
            ctx.arc(centerX, centerY, innerRadius, currentAngle + sliceAngle, currentAngle, true);
            ctx.closePath();
            ctx.fill();

            currentAngle += sliceAngle;
        });

        // Draw center circle
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(centerX, centerY, innerRadius, 0, 2 * Math.PI);
        ctx.fill();

        // Draw legend
        let legendY = 20;
        data.forEach(item => {
            ctx.fillStyle = item.color;
            ctx.fillRect(width - 120, legendY, 15, 15);
            
            ctx.fillStyle = '#374151';
            ctx.font = '12px Arial';
            ctx.textAlign = 'left';
            ctx.fillText(item.label, width - 100, legendY + 12);
            
            legendY += 25;
        });
    },

    drawBarChart(canvas, data) {
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        const padding = 40;

        ctx.clearRect(0, 0, width, height);

        if (data.length === 0) {
            ctx.fillStyle = '#9ca3af';
            ctx.font = '14px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('No data available', width / 2, height / 2);
            return;
        }

        const maxValue = Math.max(...data.map(d => d.value));
        const barWidth = (width - padding * 2) / data.length - 10;

        data.forEach((item, index) => {
            const barHeight = (item.value / maxValue) * (height - padding * 2);
            const x = padding + index * ((width - padding * 2) / data.length);
            const y = height - padding - barHeight;

            ctx.fillStyle = item.color;
            ctx.fillRect(x, y, barWidth, barHeight);

            // Draw label
            ctx.fillStyle = '#6b7280';
            ctx.font = '11px Arial';
            ctx.textAlign = 'center';
            ctx.save();
            ctx.translate(x + barWidth / 2, height - 10);
            ctx.rotate(-Math.PI / 4);
            ctx.fillText(item.label, 0, 0);
            ctx.restore();
        });
    },

    // Data Processing Functions
    parseDate(item) {
        // Handle Firebase Timestamp objects
        if (item.timestamp && typeof item.timestamp.toDate === 'function') {
            return item.timestamp.toDate();
        }
        
        // Handle createdAt field (could be string or Date)
        if (item.createdAt) {
            const date = new Date(item.createdAt);
            if (!isNaN(date.getTime())) {
                return date;
            }
        }
        
        // Handle date field (for expenses)
        if (item.date) {
            const date = new Date(item.date);
            if (!isNaN(date.getTime())) {
                return date;
            }
        }
        
        // Fallback to current date (with warning)
        console.warn('⚠️ Could not parse date for item, using current date:', item);
        return new Date();
    },

    getFilteredData() {
        const now = new Date();
        const filterDate = this.getFilterStartDate(now);

        const filterByDate = (item) => {
            const itemDate = this.parseDate(item);
            return itemDate >= filterDate && itemDate <= now;
        };

        const filtered = {
            sales: this.sales.filter(filterByDate),
            b2bSales: this.b2bSales.filter(filterByDate),
            expenses: this.expenses.filter(filterByDate),
            orders: this.orders.filter(filterByDate),
            inventory: this.inventory
        };

        console.log(`📅 Filtered data for period "${this.currentPeriod}":`, {
            dateRange: `${filterDate.toLocaleDateString()} - ${now.toLocaleDateString()}`,
            sales: filtered.sales.length,
            b2bSales: filtered.b2bSales.length,
            expenses: filtered.expenses.length,
            orders: filtered.orders.length
        });

        return filtered;
    },

    getFilterStartDate(now) {
        const date = new Date(now);
        date.setHours(0, 0, 0, 0);

        switch (this.currentPeriod) {
            case 'today':
                return date;
            case 'week':
                date.setDate(date.getDate() - 7);
                return date;
            case 'month':
                date.setMonth(date.getMonth() - 1);
                return date;
            case 'year':
                date.setFullYear(date.getFullYear() - 1);
                return date;
            default:
                return new Date(0);
        }
    },

    getSalesTrendData() {
        const data = this.getFilteredData();
        const labels = [];
        const revenue = [];
        const expenses = [];

        // Generate labels based on period
        const now = new Date();
        let periods = [];

        switch (this.currentPeriod) {
            case 'today':
                // Hourly data for today (every 2 hours for better visualization)
                for (let i = 0; i < 24; i += 2) {
                    const hour = i === 0 ? 12 : i > 12 ? i - 12 : i;
                    const ampm = i < 12 ? 'AM' : 'PM';
                    periods.push({ hour: i, label: `${hour}${ampm}` });
                }
                break;
            case 'week':
                // Daily data for last 7 days
                for (let i = 6; i >= 0; i--) {
                    const date = new Date(now);
                    date.setDate(date.getDate() - i);
                    periods.push({ 
                        date, 
                        label: i === 0 ? 'Today' : date.toLocaleDateString('en-US', { weekday: 'short' })
                    });
                }
                break;
            case 'month':
                // Weekly data for last 4 weeks
                for (let i = 3; i >= 0; i--) {
                    const date = new Date(now);
                    date.setDate(date.getDate() - (i * 7));
                    const endDate = new Date(date);
                    endDate.setDate(endDate.getDate() + 6);
                    periods.push({ 
                        date, 
                        endDate,
                        label: i === 0 ? 'This Week' : `Week ${4-i}`
                    });
                }
                break;
            case 'year':
                // Monthly data for last 12 months
                for (let i = 11; i >= 0; i--) {
                    const date = new Date(now);
                    date.setMonth(date.getMonth() - i);
                    periods.push({ 
                        date, 
                        label: date.toLocaleDateString('en-US', { month: 'short' })
                    });
                }
                break;
        }

        periods.forEach(period => {
            labels.push(period.label);

            let periodRevenue = 0;
            let periodExpenses = 0;

            if (this.currentPeriod === 'today') {
                // Filter by hour range (2-hour blocks)
                const startHour = period.hour;
                const endHour = period.hour + 2;

                [...data.sales, ...data.b2bSales].forEach(sale => {
                    const saleDate = this.parseDate(sale);
                    const isToday = saleDate.toDateString() === now.toDateString();
                    const hour = saleDate.getHours();
                    if (isToday && hour >= startHour && hour < endHour) {
                        periodRevenue += parseFloat(sale.total) || 0;
                    }
                });

                data.expenses.forEach(expense => {
                    const expenseDate = this.parseDate(expense);
                    const isToday = expenseDate.toDateString() === now.toDateString();
                    const hour = expenseDate.getHours();
                    if (isToday && hour >= startHour && hour < endHour) {
                        periodExpenses += parseFloat(expense.amount) || 0;
                    }
                });
            } else if (this.currentPeriod === 'month' && period.endDate) {
                // Filter by week range
                const periodStart = new Date(period.date);
                periodStart.setHours(0, 0, 0, 0);
                const periodEnd = new Date(period.endDate);
                periodEnd.setHours(23, 59, 59, 999);

                [...data.sales, ...data.b2bSales].forEach(sale => {
                    const saleDate = this.parseDate(sale);
                    if (saleDate >= periodStart && saleDate <= periodEnd) {
                        periodRevenue += parseFloat(sale.total) || 0;
                    }
                });

                data.expenses.forEach(expense => {
                    const expenseDate = this.parseDate(expense);
                    if (expenseDate >= periodStart && expenseDate <= periodEnd) {
                        periodExpenses += parseFloat(expense.amount) || 0;
                    }
                });
            } else {
                // Filter by date
                const periodStart = new Date(period.date);
                periodStart.setHours(0, 0, 0, 0);
                const periodEnd = new Date(period.date);
                
                if (this.currentPeriod === 'year') {
                    // For yearly view, include entire month
                    periodEnd.setMonth(periodEnd.getMonth() + 1);
                    periodEnd.setDate(0); // Last day of month
                }
                periodEnd.setHours(23, 59, 59, 999);

                [...data.sales, ...data.b2bSales].forEach(sale => {
                    const saleDate = this.parseDate(sale);
                    if (saleDate >= periodStart && saleDate <= periodEnd) {
                        periodRevenue += parseFloat(sale.total) || 0;
                    }
                });

                data.expenses.forEach(expense => {
                    const expenseDate = this.parseDate(expense);
                    if (expenseDate >= periodStart && expenseDate <= periodEnd) {
                        periodExpenses += parseFloat(expense.amount) || 0;
                    }
                });
            }

            revenue.push(periodRevenue);
            expenses.push(periodExpenses);
        });

        console.log('📊 Sales Trend Data:', { 
            period: this.currentPeriod, 
            labels, 
            revenue, 
            expenses,
            maxRevenue: Math.max(...revenue),
            maxExpenses: Math.max(...expenses)
        });

        return { labels, revenue, expenses };
    },

    // Export Functions
    exportToPDF() {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        doc.setFontSize(20);
        doc.setTextColor(99, 102, 241);
        doc.text('Business Performance Report', 14, 20);

        doc.setFontSize(10);
        doc.setTextColor(100, 100, 100);
        doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 28);
        doc.text(`Period: ${this.currentPeriod.toUpperCase()}`, 14, 34);

        const data = this.getFilteredData();
        const totalRevenue = data.sales.reduce((sum, s) => sum + (s.total || 0), 0) +
                           data.b2bSales.reduce((sum, s) => sum + (s.total || 0), 0);
        const totalExpenses = data.expenses.reduce((sum, e) => sum + (e.amount || 0), 0);

        let yPos = 45;

        doc.setFontSize(14);
        doc.setTextColor(0, 0, 0);
        doc.text('Performance Summary', 14, yPos);
        yPos += 8;

        doc.autoTable({
            startY: yPos,
            head: [['Metric', 'Value']],
            body: [
                ['Total Revenue', `KSh ${this.formatNumber(totalRevenue)}`],
                ['Total Expenses', `KSh ${this.formatNumber(totalExpenses)}`],
                ['Net Profit', `KSh ${this.formatNumber(totalRevenue - totalExpenses)}`],
                ['Total Transactions', data.sales.length + data.b2bSales.length]
            ],
            theme: 'striped',
            headStyles: { fillColor: [99, 102, 241] },
            margin: { left: 14, right: 14 }
        });

        doc.save(`business-report-${new Date().toISOString().split('T')[0]}.pdf`);
        this.showNotification('Report exported as PDF', 'success');
    },

    exportToExcel() {
        const XLSX = window.XLSX;
        const wb = XLSX.utils.book_new();

        const data = this.getFilteredData();
        const totalRevenue = data.sales.reduce((sum, s) => sum + (s.total || 0), 0) +
                           data.b2bSales.reduce((sum, s) => sum + (s.total || 0), 0);
        const totalExpenses = data.expenses.reduce((sum, e) => sum + (e.amount || 0), 0);

        // Summary sheet
        const summaryData = [
            ['Business Performance Report'],
            ['Generated:', new Date().toLocaleString()],
            ['Period:', this.currentPeriod.toUpperCase()],
            [],
            ['Metric', 'Value'],
            ['Total Revenue', totalRevenue],
            ['Total Expenses', totalExpenses],
            ['Net Profit', totalRevenue - totalExpenses],
            ['Total Transactions', data.sales.length + data.b2bSales.length]
        ];

        const ws1 = XLSX.utils.aoa_to_sheet(summaryData);
        ws1['!cols'] = [{ wch: 25 }, { wch: 20 }];
        XLSX.utils.book_append_sheet(wb, ws1, 'Summary');

        XLSX.writeFile(wb, `business-report-${new Date().toISOString().split('T')[0]}.xlsx`);
        this.showNotification('Report exported as Excel', 'success');
    },

    // Utility Functions
    updateElement(id, value) {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = value;
        }
    },

    updateElementWithAnimation(id, newValue) {
        const element = document.getElementById(id);
        if (element) {
            const oldValue = element.textContent;
            if (oldValue !== newValue) {
                // Add update animation
                element.style.transition = 'transform 0.3s ease, color 0.3s ease';
                element.style.transform = 'scale(1.1)';
                element.style.color = 'var(--primary-color)';
                
                // Update value
                element.textContent = newValue;
                
                // Reset animation
                setTimeout(() => {
                    element.style.transform = 'scale(1)';
                    element.style.color = '';
                }, 300);
            }
        }
    },

    highlightElement(element) {
        if (!element) return;
        element.classList.add('stat-updated');
        setTimeout(() => {
            element.classList.remove('stat-updated');
        }, 1000);
    },

    highlightCard(elementId) {
        const element = document.getElementById(elementId);
        if (!element) return;
        
        // Find parent card
        const card = element.closest('.report-card');
        if (card) {
            card.classList.add('card-updated');
            setTimeout(() => {
                card.classList.remove('card-updated');
            }, 1000);
        }
    },

    formatCurrency(amount) {
        return `KSh ${this.formatNumber(amount)}`;
    },

    formatNumber(num) {
        return new Intl.NumberFormat('en-KE', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(num || 0);
    },

    formatDate(date) {
        if (!date) return 'N/A';
        return date.toLocaleDateString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    },

    showNotification(message, type = 'info') {
        if (window.dataManager && window.dataManager.showNotification) {
            window.dataManager.showNotification(message, type);
        } else {
            console.log(`${type.toUpperCase()}: ${message}`);
        }
    },

    // Custom Report Generator
    generateCustomReport() {
        const reportType = document.getElementById('reportTypeSelect').value;
        const reportPeriod = document.getElementById('reportPeriodSelect').value;
        const previewContainer = document.getElementById('customReportPreview');

        if (!reportType) {
            this.showNotification('Please select a report type', 'warning');
            return;
        }

        // Set current period for data filtering
        const originalPeriod = this.currentPeriod;
        this.currentPeriod = reportPeriod;

        let reportHtml = '';
        const data = this.getFilteredData();
        const branchName = window.branchManager?.branches?.find(b => b.id === window.branchManager?.currentBranch)?.name || 'Unknown Branch';
        const periodLabel = this.getPeriodLabel(reportPeriod);

        switch (reportType) {
            case 'sales-summary':
                reportHtml = this.generateSalesSummaryReport(data, branchName, periodLabel);
                break;
            case 'b2b-summary':
                reportHtml = this.generateB2BSummaryReport(data, branchName, periodLabel);
                break;
            case 'expenses-summary':
                reportHtml = this.generateExpensesSummaryReport(data, branchName, periodLabel);
                break;
            case 'inventory-status':
                reportHtml = this.generateInventoryStatusReport(data, branchName, periodLabel);
                break;
            case 'profit-loss':
                reportHtml = this.generateProfitLossReport(data, branchName, periodLabel);
                break;
            case 'top-products':
                reportHtml = this.generateTopProductsReport(data, branchName, periodLabel);
                break;
            case 'customer-orders':
                reportHtml = this.generateCustomerOrdersReport(data, branchName, periodLabel);
                break;
            case 'complete-overview':
                reportHtml = this.generateCompleteOverviewReport(data, branchName, periodLabel);
                break;
            default:
                this.showNotification('Invalid report type selected', 'error');
                return;
        }

        // Restore original period
        this.currentPeriod = originalPeriod;

        // Display report preview
        previewContainer.innerHTML = reportHtml;
        this.showNotification('Report generated successfully', 'success');
    },

    getPeriodLabel(period) {
        const labels = {
            'today': 'Today',
            'week': 'Last 7 Days',
            'month': 'Last 30 Days',
            'year': 'Last 12 Months',
            'all': 'All Time'
        };
        return labels[period] || period;
    },

    generateSalesSummaryReport(data, branchName, periodLabel) {
        const totalRevenue = data.sales.reduce((sum, s) => sum + (parseFloat(s.total) || 0), 0);
        const totalTransactions = data.sales.length;
        const avgTransaction = totalTransactions > 0 ? totalRevenue / totalTransactions : 0;

        return `
            <div class="report-preview-content">
                <div class="report-preview-header">
                    <h2>Sales Summary Report</h2>
                    <div class="report-meta">
                        <span><strong>Branch:</strong> ${branchName}</span>
                        <span><strong>Period:</strong> ${periodLabel}</span>
                        <span><strong>Generated:</strong> ${new Date().toLocaleDateString()}</span>
                    </div>
                </div>

                <div class="report-preview-section">
                    <h3>Summary Statistics</h3>
                    <div class="report-stats-grid">
                        <div class="report-stat-item">
                            <div class="report-stat-label">Total Revenue</div>
                            <div class="report-stat-value">${this.formatCurrency(totalRevenue)}</div>
                        </div>
                        <div class="report-stat-item">
                            <div class="report-stat-label">Total Transactions</div>
                            <div class="report-stat-value">${totalTransactions}</div>
                        </div>
                        <div class="report-stat-item">
                            <div class="report-stat-label">Average Transaction</div>
                            <div class="report-stat-value">${this.formatCurrency(avgTransaction)}</div>
                        </div>
                    </div>
                </div>

                <div class="report-preview-section">
                    <h3>Transaction Details</h3>
                    <table class="report-table">
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>Items</th>
                                <th>Payment Method</th>
                                <th>Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${data.sales.slice(0, 50).map(sale => `
                                <tr>
                                    <td>${this.formatDate(this.parseDate(sale))}</td>
                                    <td>${sale.items?.length || 0} items</td>
                                    <td>${sale.paymentMethod || 'N/A'}</td>
                                    <td class="report-amount-positive">${this.formatCurrency(parseFloat(sale.total) || 0)}</td>
                                </tr>
                            `).join('')}
                            ${data.sales.length > 50 ? `<tr><td colspan="4" style="text-align: center; font-style: italic;">Showing first 50 of ${data.sales.length} transactions</td></tr>` : ''}
                        </tbody>
                        <tfoot>
                            <tr class="report-total-row">
                                <td colspan="3"><strong>Total</strong></td>
                                <td><strong>${this.formatCurrency(totalRevenue)}</strong></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>

                <div style="margin-top: 24px; text-align: center;">
                    <button class="btn btn-primary" onclick="reportsManager.printCustomReport()">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="6 9 6 2 18 2 18 9"></polyline>
                            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                            <rect x="6" y="14" width="12" height="8"></rect>
                        </svg>
                        Print Report
                    </button>
                </div>
            </div>
        `;
    },

    generateB2BSummaryReport(data, branchName, periodLabel) {
        const totalRevenue = data.b2bSales.reduce((sum, s) => sum + (parseFloat(s.total) || 0), 0);
        const totalOrders = data.b2bSales.length;
        const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

        return `
            <div class="report-preview-content">
                <div class="report-preview-header">
                    <h2>B2B Sales Report</h2>
                    <div class="report-meta">
                        <span><strong>Branch:</strong> ${branchName}</span>
                        <span><strong>Period:</strong> ${periodLabel}</span>
                        <span><strong>Generated:</strong> ${new Date().toLocaleDateString()}</span>
                    </div>
                </div>

                <div class="report-preview-section">
                    <h3>Summary Statistics</h3>
                    <div class="report-stats-grid">
                        <div class="report-stat-item">
                            <div class="report-stat-label">Total B2B Revenue</div>
                            <div class="report-stat-value">${this.formatCurrency(totalRevenue)}</div>
                        </div>
                        <div class="report-stat-item">
                            <div class="report-stat-label">Total Orders</div>
                            <div class="report-stat-value">${totalOrders}</div>
                        </div>
                        <div class="report-stat-item">
                            <div class="report-stat-label">Average Order Value</div>
                            <div class="report-stat-value">${this.formatCurrency(avgOrderValue)}</div>
                        </div>
                    </div>
                </div>

                <div class="report-preview-section">
                    <h3>B2B Orders</h3>
                    <table class="report-table">
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>Customer</th>
                                <th>Items</th>
                                <th>Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${data.b2bSales.slice(0, 50).map(sale => `
                                <tr>
                                    <td>${this.formatDate(this.parseDate(sale))}</td>
                                    <td>${sale.customerName || 'N/A'}</td>
                                    <td>${sale.items?.length || 0} items</td>
                                    <td class="report-amount-positive">${this.formatCurrency(parseFloat(sale.total) || 0)}</td>
                                </tr>
                            `).join('')}
                            ${data.b2bSales.length > 50 ? `<tr><td colspan="4" style="text-align: center; font-style: italic;">Showing first 50 of ${data.b2bSales.length} orders</td></tr>` : ''}
                        </tbody>
                        <tfoot>
                            <tr class="report-total-row">
                                <td colspan="3"><strong>Total</strong></td>
                                <td><strong>${this.formatCurrency(totalRevenue)}</strong></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>

                <div style="margin-top: 24px; text-align: center;">
                    <button class="btn btn-primary" onclick="reportsManager.printCustomReport()">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="6 9 6 2 18 2 18 9"></polyline>
                            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                            <rect x="6" y="14" width="12" height="8"></rect>
                        </svg>
                        Print Report
                    </button>
                </div>
            </div>
        `;
    },

    generateExpensesSummaryReport(data, branchName, periodLabel) {
        const totalExpenses = data.expenses.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
        const expensesByCategory = {};
        data.expenses.forEach(e => {
            const cat = e.category || 'Other';
            expensesByCategory[cat] = (expensesByCategory[cat] || 0) + (parseFloat(e.amount) || 0);
        });

        return `
            <div class="report-preview-content">
                <div class="report-preview-header">
                    <h2>Expenses Report</h2>
                    <div class="report-meta">
                        <span><strong>Branch:</strong> ${branchName}</span>
                        <span><strong>Period:</strong> ${periodLabel}</span>
                        <span><strong>Generated:</strong> ${new Date().toLocaleDateString()}</span>
                    </div>
                </div>

                <div class="report-preview-section">
                    <h3>Summary Statistics</h3>
                    <div class="report-stats-grid">
                        <div class="report-stat-item">
                            <div class="report-stat-label">Total Expenses</div>
                            <div class="report-stat-value report-amount-negative">${this.formatCurrency(totalExpenses)}</div>
                        </div>
                        <div class="report-stat-item">
                            <div class="report-stat-label">Total Transactions</div>
                            <div class="report-stat-value">${data.expenses.length}</div>
                        </div>
                        <div class="report-stat-item">
                            <div class="report-stat-label">Categories</div>
                            <div class="report-stat-value">${Object.keys(expensesByCategory).length}</div>
                        </div>
                    </div>
                </div>

                <div class="report-preview-section">
                    <h3>Expenses by Category</h3>
                    <table class="report-table">
                        <thead>
                            <tr>
                                <th>Category</th>
                                <th>Number of Expenses</th>
                                <th>Total Amount</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${Object.entries(expensesByCategory).map(([category, amount]) => `
                                <tr>
                                    <td>${category}</td>
                                    <td>${data.expenses.filter(e => (e.category || 'Other') === category).length}</td>
                                    <td class="report-amount-negative">${this.formatCurrency(amount)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                        <tfoot>
                            <tr class="report-total-row">
                                <td colspan="2"><strong>Total</strong></td>
                                <td><strong>${this.formatCurrency(totalExpenses)}</strong></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>

                <div class="report-preview-section">
                    <h3>Expense Details</h3>
                    <table class="report-table">
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>Category</th>
                                <th>Description</th>
                                <th>Amount</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${data.expenses.slice(0, 50).map(expense => `
                                <tr>
                                    <td>${this.formatDate(this.parseDate(expense))}</td>
                                    <td>${expense.category || 'Other'}</td>
                                    <td>${expense.description || 'N/A'}</td>
                                    <td class="report-amount-negative">${this.formatCurrency(parseFloat(expense.amount) || 0)}</td>
                                </tr>
                            `).join('')}
                            ${data.expenses.length > 50 ? `<tr><td colspan="4" style="text-align: center; font-style: italic;">Showing first 50 of ${data.expenses.length} expenses</td></tr>` : ''}
                        </tbody>
                    </table>
                </div>

                <div style="margin-top: 24px; text-align: center;">
                    <button class="btn btn-primary" onclick="reportsManager.printCustomReport()">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="6 9 6 2 18 2 18 9"></polyline>
                            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                            <rect x="6" y="14" width="12" height="8"></rect>
                        </svg>
                        Print Report
                    </button>
                </div>
            </div>
        `;
    },

    generateInventoryStatusReport(data, branchName, periodLabel) {
        const totalProducts = data.inventory.length;
        const lowStockItems = data.inventory.filter(item => (parseFloat(item.quantity) || 0) < 10);
        const totalValue = data.inventory.reduce((sum, item) => sum + ((parseFloat(item.quantity) || 0) * (parseFloat(item.price) || 0)), 0);

        return `
            <div class="report-preview-content">
                <div class="report-preview-header">
                    <h2>Inventory Status Report</h2>
                    <div class="report-meta">
                        <span><strong>Branch:</strong> ${branchName}</span>
                        <span><strong>Generated:</strong> ${new Date().toLocaleDateString()}</span>
                    </div>
                </div>

                <div class="report-preview-section">
                    <h3>Summary Statistics</h3>
                    <div class="report-stats-grid">
                        <div class="report-stat-item">
                            <div class="report-stat-label">Total Products</div>
                            <div class="report-stat-value">${totalProducts}</div>
                        </div>
                        <div class="report-stat-item">
                            <div class="report-stat-label">Low Stock Items</div>
                            <div class="report-stat-value report-amount-negative">${lowStockItems.length}</div>
                        </div>
                        <div class="report-stat-item">
                            <div class="report-stat-label">Total Inventory Value</div>
                            <div class="report-stat-value">${this.formatCurrency(totalValue)}</div>
                        </div>
                    </div>
                </div>

                <div class="report-preview-section">
                    <h3>Inventory List</h3>
                    <table class="report-table">
                        <thead>
                            <tr>
                                <th>Product Name</th>
                                <th>Category</th>
                                <th>Quantity</th>
                                <th>Price</th>
                                <th>Value</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${data.inventory.map(item => {
                                const qty = parseFloat(item.quantity) || 0;
                                const price = parseFloat(item.price) || 0;
                                const value = qty * price;
                                const isLowStock = qty < 10;
                                return `
                                    <tr ${isLowStock ? 'style="background-color: rgba(239, 68, 68, 0.1);"' : ''}>
                                        <td>${item.name || 'N/A'}</td>
                                        <td>${item.category || 'N/A'}</td>
                                        <td ${isLowStock ? 'class="report-amount-negative"' : ''}>${qty}</td>
                                        <td>${this.formatCurrency(price)}</td>
                                        <td>${this.formatCurrency(value)}</td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                        <tfoot>
                            <tr class="report-total-row">
                                <td colspan="4"><strong>Total Value</strong></td>
                                <td><strong>${this.formatCurrency(totalValue)}</strong></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>

                ${lowStockItems.length > 0 ? `
                    <div class="report-preview-section">
                        <h3>Low Stock Alert (Less than 10 units)</h3>
                        <table class="report-table">
                            <thead>
                                <tr>
                                    <th>Product Name</th>
                                    <th>Current Stock</th>
                                    <th>Price</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${lowStockItems.map(item => `
                                    <tr>
                                        <td>${item.name || 'N/A'}</td>
                                        <td class="report-amount-negative">${parseFloat(item.quantity) || 0}</td>
                                        <td>${this.formatCurrency(parseFloat(item.price) || 0)}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                ` : ''}

                <div style="margin-top: 24px; text-align: center;">
                    <button class="btn btn-primary" onclick="reportsManager.printCustomReport()">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="6 9 6 2 18 2 18 9"></polyline>
                            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                            <rect x="6" y="14" width="12" height="8"></rect>
                        </svg>
                        Print Report
                    </button>
                </div>
            </div>
        `;
    },

    generateProfitLossReport(data, branchName, periodLabel) {
        const posRevenue = data.sales.reduce((sum, s) => sum + (parseFloat(s.total) || 0), 0);
        const b2bRevenue = data.b2bSales.reduce((sum, s) => sum + (parseFloat(s.total) || 0), 0);
        const totalRevenue = posRevenue + b2bRevenue;
        const totalExpenses = data.expenses.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
        const netProfit = totalRevenue - totalExpenses;
        const profitMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

        return `
            <div class="report-preview-content">
                <div class="report-preview-header">
                    <h2>Profit & Loss Statement</h2>
                    <div class="report-meta">
                        <span><strong>Branch:</strong> ${branchName}</span>
                        <span><strong>Period:</strong> ${periodLabel}</span>
                        <span><strong>Generated:</strong> ${new Date().toLocaleDateString()}</span>
                    </div>
                </div>

                <div class="report-preview-section">
                    <h3>Financial Summary</h3>
                    <div class="report-stats-grid">
                        <div class="report-stat-item">
                            <div class="report-stat-label">Total Revenue</div>
                            <div class="report-stat-value report-amount-positive">${this.formatCurrency(totalRevenue)}</div>
                        </div>
                        <div class="report-stat-item">
                            <div class="report-stat-label">Total Expenses</div>
                            <div class="report-stat-value report-amount-negative">${this.formatCurrency(totalExpenses)}</div>
                        </div>
                        <div class="report-stat-item">
                            <div class="report-stat-label">Net Profit</div>
                            <div class="report-stat-value ${netProfit >= 0 ? 'report-amount-positive' : 'report-amount-negative'}">${this.formatCurrency(netProfit)}</div>
                        </div>
                        <div class="report-stat-item">
                            <div class="report-stat-label">Profit Margin</div>
                            <div class="report-stat-value ${profitMargin >= 0 ? 'report-amount-positive' : 'report-amount-negative'}">${profitMargin.toFixed(2)}%</div>
                        </div>
                    </div>
                </div>

                <div class="report-preview-section">
                    <h3>Revenue Breakdown</h3>
                    <table class="report-table">
                        <thead>
                            <tr>
                                <th>Source</th>
                                <th>Transactions</th>
                                <th>Amount</th>
                                <th>Percentage</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>POS Sales</td>
                                <td>${data.sales.length}</td>
                                <td class="report-amount-positive">${this.formatCurrency(posRevenue)}</td>
                                <td>${totalRevenue > 0 ? ((posRevenue / totalRevenue) * 100).toFixed(2) : 0}%</td>
                            </tr>
                            <tr>
                                <td>B2B Sales</td>
                                <td>${data.b2bSales.length}</td>
                                <td class="report-amount-positive">${this.formatCurrency(b2bRevenue)}</td>
                                <td>${totalRevenue > 0 ? ((b2bRevenue / totalRevenue) * 100).toFixed(2) : 0}%</td>
                            </tr>
                        </tbody>
                        <tfoot>
                            <tr class="report-total-row">
                                <td><strong>Total Revenue</strong></td>
                                <td><strong>${data.sales.length + data.b2bSales.length}</strong></td>
                                <td><strong>${this.formatCurrency(totalRevenue)}</strong></td>
                                <td><strong>100%</strong></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>

                <div class="report-preview-section">
                    <h3>Profit & Loss Summary</h3>
                    <table class="report-table">
                        <tbody>
                            <tr>
                                <td><strong>Revenue</strong></td>
                                <td></td>
                            </tr>
                            <tr>
                                <td style="padding-left: 32px;">POS Sales</td>
                                <td class="report-amount-positive">${this.formatCurrency(posRevenue)}</td>
                            </tr>
                            <tr>
                                <td style="padding-left: 32px;">B2B Sales</td>
                                <td class="report-amount-positive">${this.formatCurrency(b2bRevenue)}</td>
                            </tr>
                            <tr class="report-total-row">
                                <td><strong>Total Revenue</strong></td>
                                <td><strong class="report-amount-positive">${this.formatCurrency(totalRevenue)}</strong></td>
                            </tr>
                            <tr>
                                <td><strong>Expenses</strong></td>
                                <td class="report-amount-negative"><strong>${this.formatCurrency(totalExpenses)}</strong></td>
                            </tr>
                            <tr class="report-total-row" style="border-top: 3px double var(--border-color);">
                                <td><strong>Net Profit/Loss</strong></td>
                                <td><strong class="${netProfit >= 0 ? 'report-amount-positive' : 'report-amount-negative'}">${this.formatCurrency(netProfit)}</strong></td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div style="margin-top: 24px; text-align: center;">
                    <button class="btn btn-primary" onclick="reportsManager.printCustomReport()">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="6 9 6 2 18 2 18 9"></polyline>
                            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                            <rect x="6" y="14" width="12" height="8"></rect>
                        </svg>
                        Print Report
                    </button>
                </div>
            </div>
        `;
    },

    generateTopProductsReport(data, branchName, periodLabel) {
        const productSales = {};
        [...data.sales, ...data.b2bSales].forEach(sale => {
            if (sale.items && Array.isArray(sale.items)) {
                sale.items.forEach(item => {
                    const key = item.name || item.product;
                    if (!productSales[key]) {
                        productSales[key] = { quantity: 0, revenue: 0, transactions: 0 };
                    }
                    productSales[key].quantity += parseFloat(item.quantity) || 0;
                    productSales[key].revenue += parseFloat(item.total || (item.price * item.quantity)) || 0;
                    productSales[key].transactions += 1;
                });
            }
        });

        const topProducts = Object.entries(productSales)
            .map(([name, data]) => ({ name, ...data }))
            .sort((a, b) => b.revenue - a.revenue);

        return `
            <div class="report-preview-content">
                <div class="report-preview-header">
                    <h2>Top Products Report</h2>
                    <div class="report-meta">
                        <span><strong>Branch:</strong> ${branchName}</span>
                        <span><strong>Period:</strong> ${periodLabel}</span>
                        <span><strong>Generated:</strong> ${new Date().toLocaleDateString()}</span>
                    </div>
                </div>

                <div class="report-preview-section">
                    <h3>Top 20 Products by Revenue</h3>
                    <table class="report-table">
                        <thead>
                            <tr>
                                <th>Rank</th>
                                <th>Product Name</th>
                                <th>Units Sold</th>
                                <th>Transactions</th>
                                <th>Total Revenue</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${topProducts.slice(0, 20).map((product, index) => `
                                <tr>
                                    <td><strong>#${index + 1}</strong></td>
                                    <td>${product.name}</td>
                                    <td>${product.quantity}</td>
                                    <td>${product.transactions}</td>
                                    <td class="report-amount-positive">${this.formatCurrency(product.revenue)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                        <tfoot>
                            <tr class="report-total-row">
                                <td colspan="2"><strong>Total (Top 20)</strong></td>
                                <td><strong>${topProducts.slice(0, 20).reduce((sum, p) => sum + p.quantity, 0)}</strong></td>
                                <td><strong>${topProducts.slice(0, 20).reduce((sum, p) => sum + p.transactions, 0)}</strong></td>
                                <td><strong>${this.formatCurrency(topProducts.slice(0, 20).reduce((sum, p) => sum + p.revenue, 0))}</strong></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>

                <div style="margin-top: 24px; text-align: center;">
                    <button class="btn btn-primary" onclick="reportsManager.printCustomReport()">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="6 9 6 2 18 2 18 9"></polyline>
                            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                            <rect x="6" y="14" width="12" height="8"></rect>
                        </svg>
                        Print Report
                    </button>
                </div>
            </div>
        `;
    },

    generateCustomerOrdersReport(data, branchName, periodLabel) {
        const pendingOrders = data.orders.filter(o => o.status === 'pending');
        const completedOrders = data.orders.filter(o => o.status === 'completed');
        const cancelledOrders = data.orders.filter(o => o.status === 'cancelled');

        return `
            <div class="report-preview-content">
                <div class="report-preview-header">
                    <h2>Customer Orders Report</h2>
                    <div class="report-meta">
                        <span><strong>Branch:</strong> ${branchName}</span>
                        <span><strong>Period:</strong> ${periodLabel}</span>
                        <span><strong>Generated:</strong> ${new Date().toLocaleDateString()}</span>
                    </div>
                </div>

                <div class="report-preview-section">
                    <h3>Order Summary</h3>
                    <div class="report-stats-grid">
                        <div class="report-stat-item">
                            <div class="report-stat-label">Total Orders</div>
                            <div class="report-stat-value">${data.orders.length}</div>
                        </div>
                        <div class="report-stat-item">
                            <div class="report-stat-label">Pending Orders</div>
                            <div class="report-stat-value" style="color: #f59e0b;">${pendingOrders.length}</div>
                        </div>
                        <div class="report-stat-item">
                            <div class="report-stat-label">Completed Orders</div>
                            <div class="report-stat-value report-amount-positive">${completedOrders.length}</div>
                        </div>
                        <div class="report-stat-item">
                            <div class="report-stat-label">Cancelled Orders</div>
                            <div class="report-stat-value report-amount-negative">${cancelledOrders.length}</div>
                        </div>
                    </div>
                </div>

                <div class="report-preview-section">
                    <h3>All Orders</h3>
                    <table class="report-table">
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>Customer</th>
                                <th>Items</th>
                                <th>Total</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${data.orders.map(order => `
                                <tr>
                                    <td>${this.formatDate(this.parseDate(order))}</td>
                                    <td>${order.customerName || 'N/A'}</td>
                                    <td>${order.items?.length || 0} items</td>
                                    <td>${this.formatCurrency(parseFloat(order.total) || 0)}</td>
                                    <td>
                                        <span style="
                                            padding: 4px 8px;
                                            border-radius: 4px;
                                            font-size: 12px;
                                            font-weight: 500;
                                            background: ${order.status === 'completed' ? 'rgba(34, 197, 94, 0.1)' : order.status === 'pending' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(239, 68, 68, 0.1)'};
                                            color: ${order.status === 'completed' ? '#22c55e' : order.status === 'pending' ? '#f59e0b' : '#ef4444'};
                                        ">
                                            ${order.status || 'N/A'}
                                        </span>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>

                <div style="margin-top: 24px; text-align: center;">
                    <button class="btn btn-primary" onclick="reportsManager.printCustomReport()">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="6 9 6 2 18 2 18 9"></polyline>
                            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                            <rect x="6" y="14" width="12" height="8"></rect>
                        </svg>
                        Print Report
                    </button>
                </div>
            </div>
        `;
    },

    generateCompleteOverviewReport(data, branchName, periodLabel) {
        const posRevenue = data.sales.reduce((sum, s) => sum + (parseFloat(s.total) || 0), 0);
        const b2bRevenue = data.b2bSales.reduce((sum, s) => sum + (parseFloat(s.total) || 0), 0);
        const totalRevenue = posRevenue + b2bRevenue;
        const totalExpenses = data.expenses.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
        const netProfit = totalRevenue - totalExpenses;

        return `
            <div class="report-preview-content">
                <div class="report-preview-header">
                    <h2>Complete Business Overview</h2>
                    <div class="report-meta">
                        <span><strong>Branch:</strong> ${branchName}</span>
                        <span><strong>Period:</strong> ${periodLabel}</span>
                        <span><strong>Generated:</strong> ${new Date().toLocaleDateString()}</span>
                    </div>
                </div>

                <div class="report-preview-section">
                    <h3>Financial Overview</h3>
                    <div class="report-stats-grid">
                        <div class="report-stat-item">
                            <div class="report-stat-label">Total Revenue</div>
                            <div class="report-stat-value report-amount-positive">${this.formatCurrency(totalRevenue)}</div>
                        </div>
                        <div class="report-stat-item">
                            <div class="report-stat-label">Total Expenses</div>
                            <div class="report-stat-value report-amount-negative">${this.formatCurrency(totalExpenses)}</div>
                        </div>
                        <div class="report-stat-item">
                            <div class="report-stat-label">Net Profit</div>
                            <div class="report-stat-value ${netProfit >= 0 ? 'report-amount-positive' : 'report-amount-negative'}">${this.formatCurrency(netProfit)}</div>
                        </div>
                        <div class="report-stat-item">
                            <div class="report-stat-label">Total Transactions</div>
                            <div class="report-stat-value">${data.sales.length + data.b2bSales.length}</div>
                        </div>
                    </div>
                </div>

                <div class="report-preview-section">
                    <h3>Sales Breakdown</h3>
                    <table class="report-table">
                        <thead>
                            <tr>
                                <th>Category</th>
                                <th>Count</th>
                                <th>Revenue</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>POS Sales</td>
                                <td>${data.sales.length}</td>
                                <td class="report-amount-positive">${this.formatCurrency(posRevenue)}</td>
                            </tr>
                            <tr>
                                <td>B2B Sales</td>
                                <td>${data.b2bSales.length}</td>
                                <td class="report-amount-positive">${this.formatCurrency(b2bRevenue)}</td>
                            </tr>
                        </tbody>
                        <tfoot>
                            <tr class="report-total-row">
                                <td><strong>Total</strong></td>
                                <td><strong>${data.sales.length + data.b2bSales.length}</strong></td>
                                <td><strong>${this.formatCurrency(totalRevenue)}</strong></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>

                <div class="report-preview-section">
                    <h3>Inventory Status</h3>
                    <div class="report-stats-grid">
                        <div class="report-stat-item">
                            <div class="report-stat-label">Total Products</div>
                            <div class="report-stat-value">${data.inventory.length}</div>
                        </div>
                        <div class="report-stat-item">
                            <div class="report-stat-label">Low Stock Items</div>
                            <div class="report-stat-value report-amount-negative">${data.inventory.filter(i => (parseFloat(i.quantity) || 0) < 10).length}</div>
                        </div>
                        <div class="report-stat-item">
                            <div class="report-stat-label">Total Inventory Value</div>
                            <div class="report-stat-value">${this.formatCurrency(data.inventory.reduce((sum, i) => sum + ((parseFloat(i.quantity) || 0) * (parseFloat(i.price) || 0)), 0))}</div>
                        </div>
                        <div class="report-stat-item">
                            <div class="report-stat-label">Pending Orders</div>
                            <div class="report-stat-value">${data.orders.filter(o => o.status === 'pending').length}</div>
                        </div>
                    </div>
                </div>

                <div class="report-preview-section">
                    <h3>Expense Summary</h3>
                    <table class="report-table">
                        <tbody>
                            <tr>
                                <td><strong>Total Expenses</strong></td>
                                <td class="report-amount-negative"><strong>${this.formatCurrency(totalExpenses)}</strong></td>
                            </tr>
                            <tr>
                                <td>Number of Expense Transactions</td>
                                <td>${data.expenses.length}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div style="margin-top: 24px; text-align: center;">
                    <button class="btn btn-primary" onclick="reportsManager.printCustomReport()">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="6 9 6 2 18 2 18 9"></polyline>
                            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                            <rect x="6" y="14" width="12" height="8"></rect>
                        </svg>
                        Print Report
                    </button>
                </div>
            </div>
        `;
    },

    printCustomReport() {
        const previewContent = document.getElementById('customReportPreview');
        if (!previewContent || !previewContent.querySelector('.report-preview-content')) {
            this.showNotification('Please generate a report first', 'warning');
            return;
        }

        // Create a new window for printing
        const printWindow = window.open('', '_blank');
        const reportContent = previewContent.innerHTML;

        printWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Report - ${new Date().toLocaleDateString()}</title>
                <style>
                    * {
                        margin: 0;
                        padding: 0;
                        box-sizing: border-box;
                    }
                    body {
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                        padding: 40px;
                        color: #1e293b;
                        background: white;
                    }
                    .report-preview-header {
                        text-align: center;
                        padding-bottom: 20px;
                        border-bottom: 2px solid #e2e8f0;
                        margin-bottom: 32px;
                    }
                    .report-preview-header h2 {
                        font-size: 28px;
                        color: #6366f1;
                        margin-bottom: 12px;
                    }
                    .report-meta {
                        display: flex;
                        justify-content: center;
                        gap: 32px;
                        font-size: 14px;
                        color: #64748b;
                        margin-top: 16px;
                    }
                    .report-preview-section {
                        margin-bottom: 40px;
                        page-break-inside: avoid;
                    }
                    .report-preview-section h3 {
                        font-size: 20px;
                        color: #1e293b;
                        margin-bottom: 16px;
                        padding-bottom: 8px;
                        border-bottom: 1px solid #e2e8f0;
                    }
                    .report-stats-grid {
                        display: grid;
                        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                        gap: 20px;
                        margin-bottom: 24px;
                    }
                    .report-stat-item {
                        background: #f8fafc;
                        padding: 20px;
                        border-radius: 8px;
                        border: 1px solid #e2e8f0;
                    }
                    .report-stat-label {
                        font-size: 13px;
                        color: #64748b;
                        margin-bottom: 8px;
                    }
                    .report-stat-value {
                        font-size: 24px;
                        font-weight: 600;
                        color: #6366f1;
                    }
                    .report-table {
                        width: 100%;
                        border-collapse: collapse;
                        margin-top: 16px;
                    }
                    .report-table th,
                    .report-table td {
                        padding: 12px;
                        text-align: left;
                        border-bottom: 1px solid #e2e8f0;
                    }
                    .report-table th {
                        background: #f8fafc;
                        font-weight: 600;
                        font-size: 13px;
                        color: #64748b;
                        text-transform: uppercase;
                        letter-spacing: 0.5px;
                    }
                    .report-table td {
                        font-size: 14px;
                        color: #1e293b;
                    }
                    .report-total-row {
                        font-weight: 600;
                        background: #f8fafc;
                        border-top: 2px solid #cbd5e1;
                    }
                    .report-amount-positive {
                        color: #22c55e;
                    }
                    .report-amount-negative {
                        color: #ef4444;
                    }
                    button {
                        display: none;
                    }
                    @media print {
                        body {
                            padding: 20px;
                        }
                        .report-preview-section {
                            page-break-inside: avoid;
                        }
                    }
                </style>
            </head>
            <body>
                <div style="text-align:center;margin-bottom:24px;padding-bottom:16px;border-bottom:2px solid #e2e8f0;">
                    ${brandManager.getLogoHTML({ maxWidth: 80, maxHeight: 80, marginBottom: 6, alt: brandManager.name() })}
                    <div style="font-size:18px;font-weight:700;color:#1f2937;">${brandManager.name()}</div>
                </div>
                ${reportContent}
            </body>
            </html>
        `);

        printWindow.document.close();
        
        // Wait for content to load, then print
        setTimeout(() => {
            printWindow.print();
        }, 500);
    },

    // ============ ADVANCED FEATURES ============

    showComparativeAnalysis() {
        console.log('📊 Generating comparative analysis...');
        
        const periods = ['today', 'week', 'month', 'year'];
        const comparisons = {};

        periods.forEach(period => {
            const originalPeriod = this.currentPeriod;
            this.currentPeriod = period;
            const data = this.getFilteredData();
            
            comparisons[period] = {
                revenue: data.sales.reduce((sum, s) => sum + (parseFloat(s.total) || 0), 0) +
                        data.b2bSales.reduce((sum, s) => sum + (parseFloat(s.total) || 0), 0),
                expenses: data.expenses.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0),
                transactions: data.sales.length + data.b2bSales.length,
                profit: 0
            };
            comparisons[period].profit = comparisons[period].revenue - comparisons[period].expenses;
            
            this.currentPeriod = originalPeriod;
        });

        this.renderComparativeAnalysis(comparisons);
    },

    renderComparativeAnalysis(comparisons) {
        const html = `
            <div class="comparative-analysis">
                <h3>📊 Comparative Period Analysis</h3>
                <table class="report-table">
                    <thead>
                        <tr>
                            <th>Period</th>
                            <th>Revenue</th>
                            <th>Expenses</th>
                            <th>Profit</th>
                            <th>Transactions</th>
                            <th>Avg Transaction</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${Object.entries(comparisons).map(([period, data]) => `
                            <tr>
                                <td><strong>${period.charAt(0).toUpperCase() + period.slice(1)}</strong></td>
                                <td class="report-amount-positive">${this.formatCurrency(data.revenue)}</td>
                                <td class="report-amount-negative">${this.formatCurrency(data.expenses)}</td>
                                <td class="${data.profit >= 0 ? 'report-amount-positive' : 'report-amount-negative'}">
                                    ${this.formatCurrency(data.profit)}
                                </td>
                                <td>${data.transactions}</td>
                                <td>${this.formatCurrency(data.transactions > 0 ? data.revenue / data.transactions : 0)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;

        const previewContainer = document.getElementById('customReportPreview');
        if (previewContainer) {
            previewContainer.innerHTML = html;
        }

        this.showNotification('Comparative analysis generated', 'success');
    },

    // Get insights based on current data
    getBusinessInsights() {
        const data = this.getFilteredData();
        const insights = [];

        // Revenue insights
        const totalRevenue = data.sales.reduce((sum, s) => sum + (parseFloat(s.total) || 0), 0) +
                           data.b2bSales.reduce((sum, s) => sum + (parseFloat(s.total) || 0), 0);
        const totalExpenses = data.expenses.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
        const netProfit = totalRevenue - totalExpenses;
        const profitMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

        if (profitMargin > 30) {
            insights.push({
                type: 'success',
                title: 'Excellent Profit Margin',
                message: `Your profit margin of ${profitMargin.toFixed(1)}% is excellent. Keep up the good work!`
            });
        } else if (profitMargin < 10 && profitMargin > 0) {
            insights.push({
                type: 'warning',
                title: 'Low Profit Margin',
                message: `Your profit margin of ${profitMargin.toFixed(1)}% is low. Consider reviewing expenses or pricing.`
            });
        } else if (profitMargin < 0) {
            insights.push({
                type: 'danger',
                title: 'Operating at a Loss',
                message: `You're currently operating at a loss. Immediate action needed to reduce expenses or increase revenue.`
            });
        }

        // Inventory insights
        const lowStockItems = data.inventory.filter(item => (parseFloat(item.quantity) || 0) < 10);
        if (lowStockItems.length > 0) {
            insights.push({
                type: 'warning',
                title: 'Low Stock Alert',
                message: `${lowStockItems.length} items are running low on stock. Consider reordering soon.`
            });
        }

        // Order insights
        const pendingOrders = data.orders.filter(o => o.status === 'pending');
        if (pendingOrders.length > 5) {
            insights.push({
                type: 'info',
                title: 'Pending Orders',
                message: `You have ${pendingOrders.length} pending orders. Review and process them promptly.`
            });
        }

        // Sales trend insights
        const avgDailySales = totalRevenue / Math.max(this.getDaysInPeriod(), 1);
        insights.push({
            type: 'info',
            title: 'Average Daily Sales',
            message: `Your average daily sales for this period: ${this.formatCurrency(avgDailySales)}`
        });

        return insights;
    },

    getDaysInPeriod() {
        switch (this.currentPeriod) {
            case 'today': return 1;
            case 'week': return 7;
            case 'month': return 30;
            case 'year': return 365;
            default: return 30;
        }
    },

    renderInsights() {
        const insights = this.getBusinessInsights();
        const container = document.getElementById('businessInsights');
        
        if (!container) return;

        if (insights.length === 0) {
            container.innerHTML = '<p class="no-data">No insights available at this time.</p>';
            return;
        }

        container.innerHTML = insights.map(insight => `
            <div class="insight-card insight-${insight.type}">
                <div class="insight-icon">
                    ${insight.type === 'success' ? '✓' : insight.type === 'warning' ? '⚠' : insight.type === 'danger' ? '✕' : 'ℹ'}
                </div>
                <div class="insight-content">
                    <h4>${insight.title}</h4>
                    <p>${insight.message}</p>
                </div>
            </div>
        `).join('');
    },

    // Export with enhanced data
    exportEnhancedReport(format = 'pdf') {
        const data = this.getFilteredData();
        const insights = this.getBusinessInsights();
        
        if (format === 'pdf') {
            this.exportEnhancedPDF(data, insights);
        } else {
            this.exportEnhancedExcel(data, insights);
        }
    },

    exportEnhancedPDF(data, insights) {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        // Title
        doc.setFontSize(24);
        doc.setTextColor(99, 102, 241);
        doc.text('Enhanced Business Report', 14, 20);

        // Metadata
        doc.setFontSize(10);
        doc.setTextColor(100, 100, 100);
        doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 28);
        doc.text(`Period: ${this.currentPeriod.toUpperCase()}`, 14, 34);
        doc.text(`Branch: ${window.branchManager?.branches?.find(b => b.id === window.branchManager?.currentBranch)?.name || 'N/A'}`, 14, 40);

        let yPos = 50;

        // Executive Summary
        doc.setFontSize(16);
        doc.setTextColor(0, 0, 0);
        doc.text('Executive Summary', 14, yPos);
        yPos += 8;

        const totalRevenue = data.sales.reduce((sum, s) => sum + (parseFloat(s.total) || 0), 0) +
                           data.b2bSales.reduce((sum, s) => sum + (parseFloat(s.total) || 0), 0);
        const totalExpenses = data.expenses.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
        const netProfit = totalRevenue - totalExpenses;

        doc.autoTable({
            startY: yPos,
            head: [['Metric', 'Value']],
            body: [
                ['Total Revenue', this.formatCurrency(totalRevenue)],
                ['Total Expenses', this.formatCurrency(totalExpenses)],
                ['Net Profit', this.formatCurrency(netProfit)],
                ['Profit Margin', `${totalRevenue > 0 ? ((netProfit / totalRevenue) * 100).toFixed(2) : 0}%`],
                ['Total Transactions', data.sales.length + data.b2bSales.length],
                ['Average Transaction', this.formatCurrency((data.sales.length + data.b2bSales.length) > 0 ? totalRevenue / (data.sales.length + data.b2bSales.length) : 0)]
            ],
            theme: 'striped',
            headStyles: { fillColor: [99, 102, 241] },
            margin: { left: 14, right: 14 }
        });

        yPos = doc.lastAutoTable.finalY + 15;

        // Business Insights
        if (insights.length > 0 && yPos < 250) {
            doc.setFontSize(16);
            doc.text('Business Insights', 14, yPos);
            yPos += 8;

            doc.setFontSize(10);
            insights.forEach(insight => {
                if (yPos > 270) {
                    doc.addPage();
                    yPos = 20;
                }
                doc.setTextColor(100, 100, 100);
                doc.text(`• ${insight.title}: ${insight.message}`, 14, yPos, { maxWidth: 180 });
                yPos += 12;
            });
        }

        doc.save(`enhanced-report-${new Date().toISOString().split('T')[0]}.pdf`);
        this.showNotification('Enhanced PDF report exported', 'success');
    },

    exportEnhancedExcel(data, insights) {
        const XLSX = window.XLSX;
        const wb = XLSX.utils.book_new();

        // Summary sheet
        const totalRevenue = data.sales.reduce((sum, s) => sum + (parseFloat(s.total) || 0), 0) +
                           data.b2bSales.reduce((sum, s) => sum + (parseFloat(s.total) || 0), 0);
        const totalExpenses = data.expenses.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
        const netProfit = totalRevenue - totalExpenses;

        const summaryData = [
            ['Enhanced Business Report'],
            ['Generated:', new Date().toLocaleString()],
            ['Period:', this.currentPeriod.toUpperCase()],
            [],
            ['Executive Summary'],
            ['Metric', 'Value'],
            ['Total Revenue', totalRevenue],
            ['Total Expenses', totalExpenses],
            ['Net Profit', netProfit],
            ['Profit Margin', `${totalRevenue > 0 ? ((netProfit / totalRevenue) * 100).toFixed(2) : 0}%`],
            ['Total Transactions', data.sales.length + data.b2bSales.length],
            [],
            ['Business Insights'],
            ...insights.map(i => [i.title, i.message])
        ];

        const ws1 = XLSX.utils.aoa_to_sheet(summaryData);
        XLSX.utils.book_append_sheet(wb, ws1, 'Summary');

        // Sales detail sheet
        if (data.sales.length > 0) {
            const salesData = data.sales.map(sale => ({
                Date: this.formatDate(this.parseDate(sale)),
                Items: sale.items?.length || 0,
                'Payment Method': sale.paymentMethod || 'N/A',
                Total: parseFloat(sale.total) || 0
            }));
            const ws2 = XLSX.utils.json_to_sheet(salesData);
            XLSX.utils.book_append_sheet(wb, ws2, 'Sales');
        }

        // Expenses detail sheet
        if (data.expenses.length > 0) {
            const expensesData = data.expenses.map(expense => ({
                Date: this.formatDate(this.parseDate(expense)),
                Category: expense.category || 'Other',
                Description: expense.description || 'N/A',
                Amount: parseFloat(expense.amount) || 0
            }));
            const ws3 = XLSX.utils.json_to_sheet(expensesData);
            XLSX.utils.book_append_sheet(wb, ws3, 'Expenses');
        }

        XLSX.writeFile(wb, `enhanced-report-${new Date().toISOString().split('T')[0]}.xlsx`);
        this.showNotification('Enhanced Excel report exported', 'success');
    }
};

export default reportsManager;
