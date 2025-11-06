// Accounts Manager - Financial Management Module
import { db, collection, getDocs, query, where, orderBy as firestoreOrderBy } from './firebase-config.js';

const accountsManager = {
    sales: [],
    b2bSales: [],
    expenses: [],
    orders: [],
    inventory: [],
    initialized: false,
    refreshInterval: null,
    currentTimeframe: 'month',

    init() {
        if (this.initialized) {
            console.log('Accounts Manager already initialized, refreshing data...');
            this.loadAllFinancialData();
            return;
        }
        
        console.log('Initializing Accounts Manager...');
        this.initialized = true;
        
        this.waitForFirebase().then(() => {
            this.loadAllFinancialData();
            this.setupEventListeners();
            
            // Clear any existing interval
            if (this.refreshInterval) {
                clearInterval(this.refreshInterval);
            }
            
            // Auto-refresh every 60 seconds
            this.refreshInterval = setInterval(() => {
                this.loadAllFinancialData();
            }, 60000);
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
        // Refresh button
        const refreshBtn = document.getElementById('refreshFinancialsBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                this.loadAllFinancialData();
                this.showNotification('Financial data refreshed', 'success');
            });
        }

        // Export report button
        const exportBtn = document.getElementById('exportFinancialReportBtn');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => {
                this.showExportModal();
            });
        }

        // Timeframe selectors
        const revenueTimeframe = document.getElementById('revenueTimeframe');
        if (revenueTimeframe) {
            revenueTimeframe.addEventListener('change', (e) => {
                this.currentTimeframe = e.target.value;
                this.renderRevenueBreakdown();
            });
        }

        const expenseTimeframe = document.getElementById('expenseTimeframe');
        if (expenseTimeframe) {
            expenseTimeframe.addEventListener('change', (e) => {
                this.currentTimeframe = e.target.value;
                this.renderExpenseBreakdown();
            });
        }

        // Summary year selector
        const summaryYear = document.getElementById('summaryYear');
        if (summaryYear) {
            summaryYear.value = new Date().getFullYear().toString();
            summaryYear.addEventListener('change', () => {
                this.renderMonthlySummary();
            });
        }

        // View all transactions
        const viewAllBtn = document.getElementById('viewAllTransactionsBtn');
        if (viewAllBtn) {
            viewAllBtn.addEventListener('click', () => {
                this.showAllTransactionsModal();
            });
        }
    },

    async loadAllFinancialData() {
        console.log('📊 Loading all financial data...');
        
        try {
            await Promise.all([
                this.loadSales(),
                this.loadB2BSales(),
                this.loadExpenses(),
                this.loadOrders(),
                this.loadInventory()
            ]);

            console.log('✅ All financial data loaded');
            this.calculateFinancials();
            this.renderDashboard();
        } catch (error) {
            console.error('❌ Error loading financial data:', error);
            this.showNotification('Error loading financial data', 'error');
        }
    },

    async loadSales() {
        try {
            if (!window.db) return;

            const branchId = window.branchManager?.currentBranch;
            if (!branchId) {
                this.sales = [];
                return;
            }

            const salesRef = collection(db, 'sales');
            const q = query(salesRef, where('branchId', '==', branchId));
            const snapshot = await getDocs(q);
            
            this.sales = [];
            snapshot.forEach(doc => {
                this.sales.push({ id: doc.id, ...doc.data() });
            });

            console.log(`✅ Loaded ${this.sales.length} POS sales`);
        } catch (error) {
            console.error('Error loading sales:', error);
            this.sales = [];
        }
    },

    async loadB2BSales() {
        try {
            if (!window.db) return;

            const branchId = window.branchManager?.currentBranch;
            if (!branchId) {
                this.b2bSales = [];
                return;
            }

            const b2bRef = collection(db, 'b2bSales');
            const q = query(b2bRef, where('branchId', '==', branchId));
            const snapshot = await getDocs(q);
            
            this.b2bSales = [];
            snapshot.forEach(doc => {
                this.b2bSales.push({ id: doc.id, ...doc.data() });
            });

            console.log(`✅ Loaded ${this.b2bSales.length} B2B sales`);
        } catch (error) {
            console.error('Error loading B2B sales:', error);
            this.b2bSales = [];
        }
    },

    async loadExpenses() {
        try {
            if (!window.db) return;

            const branchId = window.branchManager?.currentBranch;
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
            if (!window.db) return;

            const branchId = window.branchManager?.currentBranch;
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
            if (!window.db) return;

            const branchId = window.branchManager?.currentBranch;
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

    calculateFinancials() {
        const timeframe = this.getTimeframeData(this.currentTimeframe);
        
        // Calculate total revenue (POS + B2B sales)
        const posSalesRevenue = this.sales
            .filter(s => this.isInTimeframe(s.createdAt, timeframe))
            .reduce((sum, sale) => sum + (sale.total || 0), 0);

        const b2bRevenue = this.b2bSales
            .filter(s => this.isInTimeframe(s.createdAt, timeframe))
            .reduce((sum, sale) => sum + (sale.totalAmount || 0), 0);

        const totalRevenue = posSalesRevenue + b2bRevenue;

        // Calculate total expenses
        const totalExpenses = this.expenses
            .filter(e => this.isInTimeframe(e.date || e.createdAt, timeframe))
            .reduce((sum, expense) => sum + (expense.amount || 0), 0);

        // Calculate total orders cost
        const ordersCost = this.orders
            .filter(o => this.isInTimeframe(o.createdAt, timeframe))
            .reduce((sum, order) => sum + (order.totalAmount || 0), 0);

        // Net profit
        const netProfit = totalRevenue - (totalExpenses + ordersCost);
        const profitMargin = totalRevenue > 0 ? (netProfit / totalRevenue * 100) : 0;

        // Cash balance (simplified - revenue - expenses - unpaid orders)
        const unpaidOrders = this.orders
            .filter(o => o.paymentStatus !== 'paid')
            .reduce((sum, order) => sum + (order.totalAmount || 0), 0);

        const cashBalance = totalRevenue - totalExpenses;

        // Accounts receivable (B2B sales not fully paid)
        const accountsReceivable = this.b2bSales
            .filter(s => s.paymentStatus !== 'paid')
            .reduce((sum, sale) => sum + (sale.totalAmount || sale.outstandingBalance || 0), 0);

        return {
            totalRevenue,
            posSalesRevenue,
            b2bRevenue,
            totalExpenses,
            ordersCost,
            netProfit,
            profitMargin,
            cashBalance,
            accountsReceivable,
            unpaidOrders
        };
    },

    getTimeframeData(timeframe) {
        const now = new Date();
        let startDate = new Date();

        switch(timeframe) {
            case 'today':
                startDate.setHours(0, 0, 0, 0);
                break;
            case 'week':
                startDate.setDate(now.getDate() - 7);
                break;
            case 'month':
                startDate.setMonth(now.getMonth() - 1);
                break;
            case 'year':
                startDate.setFullYear(now.getFullYear() - 1);
                break;
        }

        return { startDate, endDate: now };
    },

    isInTimeframe(timestamp, timeframe) {
        if (!timestamp) return false;
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        return date >= timeframe.startDate && date <= timeframe.endDate;
    },

    renderDashboard() {
        const financials = this.calculateFinancials();

        // Update overview stats
        this.updateElement('totalRevenue', `KSh ${this.formatNumber(financials.totalRevenue)}`);
        this.updateElement('totalExpenses', `KSh ${this.formatNumber(financials.totalExpenses + financials.ordersCost)}`);
        this.updateElement('netProfit', `KSh ${this.formatNumber(financials.netProfit)}`);
        this.updateElement('cashBalance', `KSh ${this.formatNumber(financials.cashBalance)}`);
        this.updateElement('accountsReceivable', `KSh ${this.formatNumber(financials.accountsReceivable)} Receivable`);
        this.updateElement('profitMargin', `${financials.profitMargin.toFixed(1)}% Margin`);

        // Calculate growth percentages (compared to previous period)
        const prevFinancials = this.calculatePreviousPeriodFinancials();
        const revenueGrowth = this.calculateGrowthPercent(financials.totalRevenue, prevFinancials.totalRevenue);
        const expensesChange = this.calculateGrowthPercent(financials.totalExpenses, prevFinancials.totalExpenses);

        this.updateElement('revenueGrowth', `${revenueGrowth >= 0 ? '+' : ''}${revenueGrowth.toFixed(1)}% from last ${this.currentTimeframe}`);
        this.updateElement('expensesChange', `${expensesChange >= 0 ? '+' : ''}${expensesChange.toFixed(1)}% from last ${this.currentTimeframe}`);

        // Render breakdowns
        this.renderRevenueBreakdown();
        this.renderExpenseBreakdown();
        this.renderOutstandingPayments();
        this.renderRecentTransactions();
        this.renderMonthlySummary();
    },

    renderRevenueBreakdown() {
        const container = document.getElementById('revenueBreakdown');
        if (!container) return;

        const financials = this.calculateFinancials();
        const total = financials.totalRevenue;

        if (total === 0) {
            container.innerHTML = '<div class="empty-state-inline"><p>No revenue data</p></div>';
            return;
        }

        const breakdown = [
            { label: 'POS Sales', amount: financials.posSalesRevenue, color: '#22c55e' },
            { label: 'B2B Sales', amount: financials.b2bRevenue, color: '#3b82f6' }
        ];

        container.innerHTML = breakdown.map(item => {
            const percent = total > 0 ? (item.amount / total * 100) : 0;
            return `
                <div class="breakdown-item">
                    <div class="breakdown-info">
                        <span class="breakdown-label">${item.label}</span>
                        <span class="breakdown-percent">${percent.toFixed(1)}%</span>
                    </div>
                    <div class="breakdown-bar">
                        <div class="breakdown-fill" style="width: ${percent}%; background: ${item.color};"></div>
                    </div>
                    <span class="breakdown-amount">KSh ${this.formatNumber(item.amount)}</span>
                </div>
            `;
        }).join('');
    },

    renderExpenseBreakdown() {
        const container = document.getElementById('expenseBreakdown');
        if (!container) return;

        const timeframe = this.getTimeframeData(this.currentTimeframe);
        
        // Group expenses by category
        const expensesByCategory = {};
        let totalExpenses = 0;

        this.expenses
            .filter(e => this.isInTimeframe(e.date || e.createdAt, timeframe))
            .forEach(expense => {
                const category = expense.category || 'Other';
                if (!expensesByCategory[category]) {
                    expensesByCategory[category] = 0;
                }
                expensesByCategory[category] += expense.amount || 0;
                totalExpenses += expense.amount || 0;
            });

        // Add orders as procurement expense
        const ordersCost = this.orders
            .filter(o => this.isInTimeframe(o.createdAt, timeframe))
            .reduce((sum, order) => sum + (order.totalAmount || 0), 0);

        if (ordersCost > 0) {
            expensesByCategory['Procurement'] = ordersCost;
            totalExpenses += ordersCost;
        }

        if (totalExpenses === 0) {
            container.innerHTML = '<div class="empty-state-inline"><p>No expense data</p></div>';
            return;
        }

        const colors = ['#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4'];
        let colorIndex = 0;

        container.innerHTML = Object.entries(expensesByCategory)
            .sort((a, b) => b[1] - a[1])
            .map(([category, amount]) => {
                const percent = (amount / totalExpenses * 100);
                const color = colors[colorIndex % colors.length];
                colorIndex++;
                
                return `
                    <div class="breakdown-item">
                        <div class="breakdown-info">
                            <span class="breakdown-label">${category}</span>
                            <span class="breakdown-percent">${percent.toFixed(1)}%</span>
                        </div>
                        <div class="breakdown-bar">
                            <div class="breakdown-fill" style="width: ${percent}%; background: ${color};"></div>
                        </div>
                        <span class="breakdown-amount">KSh ${this.formatNumber(amount)}</span>
                    </div>
                `;
            }).join('');
    },

    renderOutstandingPayments() {
        const container = document.getElementById('outstandingPayments');
        const countBadge = document.getElementById('outstandingCount');
        
        if (!container) return;

        const outstanding = [
            ...this.b2bSales.filter(s => s.paymentStatus !== 'paid' && (s.totalAmount || s.outstandingBalance)),
            ...this.orders.filter(o => o.paymentStatus !== 'paid')
        ].slice(0, 5);

        if (countBadge) {
            countBadge.textContent = outstanding.length;
        }

        if (outstanding.length === 0) {
            container.innerHTML = '<div class="empty-state-inline"><p>No outstanding payments</p></div>';
            return;
        }

        container.innerHTML = outstanding.map(item => {
            const isSale = item.customerName !== undefined;
            const amount = item.totalAmount || item.outstandingBalance || 0;
            const name = isSale ? item.customerName : item.supplierName;
            const type = isSale ? 'B2B Sale' : 'Order';
            const date = this.formatDate(item.createdAt || item.date);

            return `
                <div class="transaction-item">
                    <div class="transaction-icon ${isSale ? 'revenue' : 'expense'}">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            ${isSale ? '<path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>' : '<circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline>'}
                        </svg>
                    </div>
                    <div class="transaction-details">
                        <div class="transaction-name">${name || 'N/A'}</div>
                        <div class="transaction-date">${type} • ${date}</div>
                    </div>
                    <div class="transaction-amount expense">-KSh ${this.formatNumber(amount)}</div>
                </div>
            `;
        }).join('');
    },

    renderRecentTransactions() {
        const container = document.getElementById('recentTransactions');
        if (!container) return;

        // Combine all transactions
        const allTransactions = [
            ...this.sales.map(s => ({ ...s, type: 'POS Sale', amount: s.total, isRevenue: true })),
            ...this.b2bSales.map(s => ({ ...s, type: 'B2B Sale', amount: s.totalAmount, isRevenue: true })),
            ...this.expenses.map(e => ({ ...e, type: 'Expense', amount: e.amount, isRevenue: false })),
            ...this.orders.map(o => ({ ...o, type: 'Order', amount: o.totalAmount, isRevenue: false }))
        ].sort((a, b) => {
            const dateA = (a.createdAt || a.date)?.toDate?.() || new Date(0);
            const dateB = (b.createdAt || b.date)?.toDate?.() || new Date(0);
            return dateB - dateA;
        }).slice(0, 5);

        if (allTransactions.length === 0) {
            container.innerHTML = '<div class="empty-state-inline"><p>No recent transactions</p></div>';
            return;
        }

        container.innerHTML = allTransactions.map(txn => {
            const date = this.formatDate(txn.createdAt || txn.date);
            const name = txn.customerName || txn.supplierName || txn.description || txn.type;

            return `
                <div class="transaction-item">
                    <div class="transaction-icon ${txn.isRevenue ? 'revenue' : 'expense'}">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            ${txn.isRevenue ? '<polyline points="12 19 12 5"></polyline><polyline points="5 12 12 5 19 12"></polyline>' : '<polyline points="12 5 12 19"></polyline><polyline points="19 12 12 19 5 12"></polyline>'}
                        </svg>
                    </div>
                    <div class="transaction-details">
                        <div class="transaction-name">${name}</div>
                        <div class="transaction-date">${txn.type} • ${date}</div>
                    </div>
                    <div class="transaction-amount ${txn.isRevenue ? 'revenue' : 'expense'}">
                        ${txn.isRevenue ? '+' : '-'}KSh ${this.formatNumber(txn.amount || 0)}
                    </div>
                </div>
            `;
        }).join('');
    },

    renderMonthlySummary() {
        const tbody = document.getElementById('financialSummaryBody');
        if (!tbody) return;

        const year = parseInt(document.getElementById('summaryYear')?.value || new Date().getFullYear());
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        
        const summaryData = months.map((month, index) => {
            const startDate = new Date(year, index, 1);
            const endDate = new Date(year, index + 1, 0);
            
            const revenue = this.getRevenueForPeriod(startDate, endDate);
            const expenses = this.getExpensesForPeriod(startDate, endDate);
            const profit = revenue - expenses;
            const margin = revenue > 0 ? (profit / revenue * 100) : 0;

            return { month, revenue, expenses, profit, margin };
        });

        tbody.innerHTML = summaryData.map(data => `
            <tr>
                <td><strong>${data.month}</strong></td>
                <td style="color: #22c55e; font-weight: 600;">KSh ${this.formatNumber(data.revenue)}</td>
                <td style="color: #ef4444; font-weight: 600;">KSh ${this.formatNumber(data.expenses)}</td>
                <td style="color: ${data.profit >= 0 ? '#22c55e' : '#ef4444'}; font-weight: 600;">
                    KSh ${this.formatNumber(Math.abs(data.profit))}
                </td>
                <td>${data.margin.toFixed(1)}%</td>
                <td style="text-align: center;">
                    <span class="status-badge ${data.profit >= 0 ? 'completed' : 'cancelled'}">
                        ${data.profit >= 0 ? 'Profit' : 'Loss'}
                    </span>
                </td>
            </tr>
        `).join('');
    },

    getRevenueForPeriod(startDate, endDate) {
        const sales = this.sales.filter(s => {
            const date = s.createdAt?.toDate?.() || new Date(s.createdAt);
            return date >= startDate && date <= endDate;
        }).reduce((sum, s) => sum + (s.total || 0), 0);

        const b2b = this.b2bSales.filter(s => {
            const date = s.createdAt?.toDate?.() || new Date(s.createdAt);
            return date >= startDate && date <= endDate;
        }).reduce((sum, s) => sum + (s.totalAmount || 0), 0);

        return sales + b2b;
    },

    getExpensesForPeriod(startDate, endDate) {
        const expenses = this.expenses.filter(e => {
            const date = (e.date || e.createdAt)?.toDate?.() || new Date(e.date || e.createdAt);
            return date >= startDate && date <= endDate;
        }).reduce((sum, e) => sum + (e.amount || 0), 0);

        const orders = this.orders.filter(o => {
            const date = o.createdAt?.toDate?.() || new Date(o.createdAt);
            return date >= startDate && date <= endDate;
        }).reduce((sum, o) => sum + (o.totalAmount || 0), 0);

        return expenses + orders;
    },

    calculatePreviousPeriodFinancials() {
        // Calculate financials for the previous period based on current timeframe
        const now = new Date();
        let startDate = new Date();
        let endDate = new Date();

        switch(this.currentTimeframe) {
            case 'today':
                startDate.setDate(now.getDate() - 1);
                endDate.setDate(now.getDate() - 1);
                startDate.setHours(0, 0, 0, 0);
                endDate.setHours(23, 59, 59, 999);
                break;
            case 'week':
                startDate.setDate(now.getDate() - 14);
                endDate.setDate(now.getDate() - 7);
                break;
            case 'month':
                startDate.setMonth(now.getMonth() - 2);
                endDate.setMonth(now.getMonth() - 1);
                break;
            case 'year':
                startDate.setFullYear(now.getFullYear() - 2);
                endDate.setFullYear(now.getFullYear() - 1);
                break;
        }

        const revenue = this.getRevenueForPeriod(startDate, endDate);
        const expenses = this.getExpensesForPeriod(startDate, endDate);

        return { totalRevenue: revenue, totalExpenses: expenses };
    },

    calculateGrowthPercent(current, previous) {
        if (previous === 0) return current > 0 ? 100 : 0;
        return ((current - previous) / previous) * 100;
    },

    showExportModal() {
        const modal = document.getElementById('exportFormatModal');
        if (modal) {
            modal.style.display = 'flex';
        }
    },

    exportFinancialReport() {
        // Legacy CSV export - now called by exportAsCSV()
        this.exportAsCSV();
    },

    exportAsCSV() {
        const financials = this.calculateFinancials();
        const csvData = [];

        // Header
        csvData.push(['Vendify Financial Report']);
        csvData.push(['Generated:', new Date().toLocaleString()]);
        csvData.push(['Branch:', window.branchManager?.currentBranch || 'N/A']);
        csvData.push([]);

        // Overview
        csvData.push(['Financial Overview']);
        csvData.push(['Total Revenue', `KSh ${this.formatNumber(financials.totalRevenue)}`]);
        csvData.push(['Total Expenses', `KSh ${this.formatNumber(financials.totalExpenses + financials.ordersCost)}`]);
        csvData.push(['Net Profit', `KSh ${this.formatNumber(financials.netProfit)}`]);
        csvData.push(['Profit Margin', `${financials.profitMargin.toFixed(2)}%`]);
        csvData.push(['Cash Balance', `KSh ${this.formatNumber(financials.cashBalance)}`]);
        csvData.push(['Accounts Receivable', `KSh ${this.formatNumber(financials.accountsReceivable)}`]);
        csvData.push([]);

        // Revenue Breakdown
        csvData.push(['Revenue Breakdown']);
        csvData.push(['POS Sales', `KSh ${this.formatNumber(financials.posSales)}`]);
        csvData.push(['B2B Sales', `KSh ${this.formatNumber(financials.b2bSales)}`]);
        csvData.push([]);

        // Expense Breakdown
        csvData.push(['Expense Breakdown']);
        Object.entries(financials.expensesByCategory).forEach(([category, amount]) => {
            csvData.push([category, `KSh ${this.formatNumber(amount)}`]);
        });
        csvData.push(['Orders (Inventory)', `KSh ${this.formatNumber(financials.ordersCost)}`]);
        csvData.push([]);

        // Convert to CSV string
        const csvString = csvData.map(row => row.join(',')).join('\n');
        const blob = new Blob([csvString], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `financial-report-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();

        this.closeExportModal();
        this.showNotification('Financial report exported as CSV successfully', 'success');
    },

    exportAsPDF() {
        const financials = this.calculateFinancials();
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        // Title
        doc.setFontSize(20);
        doc.setTextColor(99, 102, 241);
        doc.text('Vendify Financial Report', 14, 20);

        // Metadata
        doc.setFontSize(10);
        doc.setTextColor(100, 100, 100);
        doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 28);
        doc.text(`Branch: ${window.branchManager?.currentBranch || 'N/A'}`, 14, 34);

        let yPos = 45;

        // Financial Overview Section
        doc.setFontSize(14);
        doc.setTextColor(0, 0, 0);
        doc.text('Financial Overview', 14, yPos);
        yPos += 8;

        doc.autoTable({
            startY: yPos,
            head: [['Metric', 'Amount']],
            body: [
                ['Total Revenue', `KSh ${this.formatNumber(financials.totalRevenue)}`],
                ['Total Expenses', `KSh ${this.formatNumber(financials.totalExpenses + financials.ordersCost)}`],
                ['Net Profit', `KSh ${this.formatNumber(financials.netProfit)}`],
                ['Profit Margin', `${financials.profitMargin.toFixed(2)}%`],
                ['Cash Balance', `KSh ${this.formatNumber(financials.cashBalance)}`],
                ['Accounts Receivable', `KSh ${this.formatNumber(financials.accountsReceivable)}`]
            ],
            theme: 'striped',
            headStyles: { fillColor: [99, 102, 241] },
            margin: { left: 14, right: 14 }
        });

        yPos = doc.lastAutoTable.finalY + 15;

        // Revenue Breakdown
        doc.setFontSize(14);
        doc.text('Revenue Breakdown', 14, yPos);
        yPos += 8;

        doc.autoTable({
            startY: yPos,
            head: [['Source', 'Amount', 'Percentage']],
            body: [
                ['POS Sales', `KSh ${this.formatNumber(financials.posSales)}`, `${((financials.posSales / financials.totalRevenue) * 100).toFixed(1)}%`],
                ['B2B Sales', `KSh ${this.formatNumber(financials.b2bSales)}`, `${((financials.b2bSales / financials.totalRevenue) * 100).toFixed(1)}%`]
            ],
            theme: 'striped',
            headStyles: { fillColor: [34, 197, 94] },
            margin: { left: 14, right: 14 }
        });

        yPos = doc.lastAutoTable.finalY + 15;

        // Expense Breakdown
        if (yPos > 250) {
            doc.addPage();
            yPos = 20;
        }

        doc.setFontSize(14);
        doc.text('Expense Breakdown', 14, yPos);
        yPos += 8;

        const expenseData = Object.entries(financials.expensesByCategory).map(([category, amount]) => [
            category,
            `KSh ${this.formatNumber(amount)}`,
            `${((amount / (financials.totalExpenses + financials.ordersCost)) * 100).toFixed(1)}%`
        ]);
        expenseData.push([
            'Orders (Inventory)',
            `KSh ${this.formatNumber(financials.ordersCost)}`,
            `${((financials.ordersCost / (financials.totalExpenses + financials.ordersCost)) * 100).toFixed(1)}%`
        ]);

        doc.autoTable({
            startY: yPos,
            head: [['Category', 'Amount', 'Percentage']],
            body: expenseData,
            theme: 'striped',
            headStyles: { fillColor: [239, 68, 68] },
            margin: { left: 14, right: 14 }
        });

        // Save PDF
        doc.save(`financial-report-${new Date().toISOString().split('T')[0]}.pdf`);
        
        this.closeExportModal();
        this.showNotification('Financial report exported as PDF successfully', 'success');
    },

    exportAsExcel() {
        const financials = this.calculateFinancials();
        const XLSX = window.XLSX;

        // Create a new workbook
        const wb = XLSX.utils.book_new();

        // Sheet 1: Overview
        const overviewData = [
            ['Vendify Financial Report'],
            ['Generated:', new Date().toLocaleString()],
            ['Branch:', window.branchManager?.currentBranch || 'N/A'],
            [],
            ['Financial Overview'],
            ['Metric', 'Amount'],
            ['Total Revenue', financials.totalRevenue],
            ['Total Expenses', financials.totalExpenses + financials.ordersCost],
            ['Net Profit', financials.netProfit],
            ['Profit Margin', `${financials.profitMargin.toFixed(2)}%`],
            ['Cash Balance', financials.cashBalance],
            ['Accounts Receivable', financials.accountsReceivable]
        ];
        const ws1 = XLSX.utils.aoa_to_sheet(overviewData);
        
        // Set column widths
        ws1['!cols'] = [{ wch: 25 }, { wch: 20 }];
        
        // Add styling to headers
        const range = XLSX.utils.decode_range(ws1['!ref']);
        for (let R = range.s.r; R <= range.e.r; ++R) {
            for (let C = range.s.c; C <= range.e.c; ++C) {
                const cell_address = { c: C, r: R };
                const cell_ref = XLSX.utils.encode_cell(cell_address);
                if (!ws1[cell_ref]) continue;
                
                // Style headers
                if (R === 0 || R === 4 || R === 5) {
                    if (!ws1[cell_ref].s) ws1[cell_ref].s = {};
                    ws1[cell_ref].s.font = { bold: true };
                }
            }
        }
        
        XLSX.utils.book_append_sheet(wb, ws1, 'Overview');

        // Sheet 2: Revenue Breakdown
        const revenueData = [
            ['Revenue Breakdown'],
            ['Source', 'Amount', 'Percentage'],
            ['POS Sales', financials.posSales, `${((financials.posSales / financials.totalRevenue) * 100).toFixed(1)}%`],
            ['B2B Sales', financials.b2bSales, `${((financials.b2bSales / financials.totalRevenue) * 100).toFixed(1)}%`],
            [],
            ['Total Revenue', financials.totalRevenue, '100%']
        ];
        const ws2 = XLSX.utils.aoa_to_sheet(revenueData);
        ws2['!cols'] = [{ wch: 20 }, { wch: 18 }, { wch: 15 }];
        XLSX.utils.book_append_sheet(wb, ws2, 'Revenue');

        // Sheet 3: Expense Breakdown
        const expenseData = [['Expense Breakdown'], ['Category', 'Amount', 'Percentage']];
        Object.entries(financials.expensesByCategory).forEach(([category, amount]) => {
            expenseData.push([
                category,
                amount,
                `${((amount / (financials.totalExpenses + financials.ordersCost)) * 100).toFixed(1)}%`
            ]);
        });
        expenseData.push([
            'Orders (Inventory)',
            financials.ordersCost,
            `${((financials.ordersCost / (financials.totalExpenses + financials.ordersCost)) * 100).toFixed(1)}%`
        ]);
        expenseData.push([]);
        expenseData.push(['Total Expenses', financials.totalExpenses + financials.ordersCost, '100%']);
        
        const ws3 = XLSX.utils.aoa_to_sheet(expenseData);
        ws3['!cols'] = [{ wch: 25 }, { wch: 18 }, { wch: 15 }];
        XLSX.utils.book_append_sheet(wb, ws3, 'Expenses');

        // Sheet 4: Monthly Summary (if available)
        if (this.sales.length > 0 || this.b2bSales.length > 0 || this.expenses.length > 0) {
            const monthlySummaryData = [
                ['Monthly Financial Summary'],
                ['Month', 'Revenue', 'Expenses', 'Net Profit', 'Profit Margin']
            ];

            // Get last 12 months
            const months = [];
            for (let i = 11; i >= 0; i--) {
                const date = new Date();
                date.setMonth(date.getMonth() - i);
                months.push({
                    name: date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
                    start: new Date(date.getFullYear(), date.getMonth(), 1),
                    end: new Date(date.getFullYear(), date.getMonth() + 1, 0)
                });
            }

            months.forEach(month => {
                const monthSales = this.sales.filter(sale => {
                    const saleDate = sale.timestamp.toDate();
                    return saleDate >= month.start && saleDate <= month.end;
                });
                const monthB2B = this.b2bSales.filter(sale => {
                    const saleDate = sale.timestamp.toDate();
                    return saleDate >= month.start && saleDate <= month.end;
                });
                const monthExpenses = this.expenses.filter(expense => {
                    const expenseDate = expense.timestamp.toDate();
                    return expenseDate >= month.start && expenseDate <= month.end;
                });

                const revenue = monthSales.reduce((sum, s) => sum + s.totalAmount, 0) +
                               monthB2B.reduce((sum, s) => sum + s.totalAmount, 0);
                const expenses = monthExpenses.reduce((sum, e) => sum + e.amount, 0);
                const profit = revenue - expenses;
                const margin = revenue > 0 ? ((profit / revenue) * 100).toFixed(2) + '%' : '0%';

                monthlySummaryData.push([month.name, revenue, expenses, profit, margin]);
            });

            const ws4 = XLSX.utils.aoa_to_sheet(monthlySummaryData);
            ws4['!cols'] = [{ wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }];
            XLSX.utils.book_append_sheet(wb, ws4, 'Monthly Summary');
        }

        // Generate Excel file
        XLSX.writeFile(wb, `financial-report-${new Date().toISOString().split('T')[0]}.xlsx`);
        
        this.closeExportModal();
        this.showNotification('Financial report exported as Excel successfully', 'success');
    },

    closeExportModal() {
        const modal = document.getElementById('exportFormatModal');
        if (modal) {
            modal.style.display = 'none';
        }
    },

    showAllTransactionsModal() {
        this.showNotification('View all transactions coming soon!', 'info');
    },

    // Helper methods
    formatNumber(num) {
        return new Intl.NumberFormat('en-KE', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(num || 0);
    },

    formatDate(timestamp) {
        if (!timestamp) return 'N/A';
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        return date.toLocaleDateString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric'
        });
    },

    updateElement(id, value) {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = value;
        }
    },

    showNotification(message, type = 'info') {
        if (window.dataManager && window.dataManager.showNotification) {
            window.dataManager.showNotification(message, type);
        } else {
            console.log(`${type.toUpperCase()}: ${message}`);
        }
    }
};

export default accountsManager;
