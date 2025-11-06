// Reports Module - Comprehensive Business Reports with Real-Time Charts
import { db, collection, getDocs, query, where } from './firebase-config.js';

const reportsManager = {
    sales: [],
    b2bSales: [],
    expenses: [],
    orders: [],
    inventory: [],
    initialized: false,
    refreshInterval: null,
    charts: {},
    currentPeriod: 'month', // today, week, month, year, custom

    async init() {
        if (this.initialized) {
            console.log('Reports Manager already initialized, refreshing data...');
            this.loadAllData();
            return;
        }

        console.log('📊 Initializing Reports Manager...');
        this.initialized = true;

        await this.waitForFirebase();
        await this.loadAllData();
        this.setupEventListeners();
        this.renderAllReports();

        // Auto-refresh every 60 seconds
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }
        this.refreshInterval = setInterval(() => {
            this.loadAllData();
        }, 60000);

        console.log('✅ Reports Manager ready');
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
            });
        });

        // Refresh button
        const refreshBtn = document.getElementById('refreshReportsBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', async () => {
                await this.loadAllData();
                this.showNotification('Reports refreshed', 'success');
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
    },

    async loadAllData() {
        console.log('📊 Loading all reports data...');

        try {
            await Promise.all([
                this.loadSales(),
                this.loadB2BSales(),
                this.loadExpenses(),
                this.loadOrders(),
                this.loadInventory()
            ]);

            // Log data statistics for verification
            console.log('✅ All reports data loaded:', {
                sales: this.sales.length,
                b2bSales: this.b2bSales.length,
                expenses: this.expenses.length,
                orders: this.orders.length,
                inventory: this.inventory.length,
                totalRevenue: this.sales.reduce((sum, s) => sum + (parseFloat(s.total) || 0), 0) +
                             this.b2bSales.reduce((sum, s) => sum + (parseFloat(s.total) || 0), 0),
                totalExpenses: this.expenses.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0)
            });

            this.renderAllReports();
        } catch (error) {
            console.error('❌ Error loading reports data:', error);
            this.showNotification('Error loading data', 'error');
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
            if (!window.db) return;

            const branchId = window.branchManager?.currentBranch;
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

    renderAllReports() {
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

        console.log('📊 Overview Cards Data:', {
            totalRevenue,
            totalExpenses,
            netProfit,
            totalTransactions,
            salesCount: data.sales.length,
            b2bSalesCount: data.b2bSales.length,
            expensesCount: data.expenses.length
        });

        this.updateElement('reportTotalRevenue', this.formatCurrency(totalRevenue));
        this.updateElement('reportTotalExpenses', this.formatCurrency(totalExpenses));
        this.updateElement('reportNetProfit', this.formatCurrency(netProfit));
        this.updateElement('reportTotalTransactions', totalTransactions);

        // Update profit class
        const profitEl = document.getElementById('reportNetProfit');
        if (profitEl) {
            profitEl.className = netProfit >= 0 ? 'stat-value profit' : 'stat-value loss';
        }
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
        const padding = 40;

        ctx.clearRect(0, 0, width, height);

        if (!data.labels || data.labels.length === 0) {
            ctx.fillStyle = '#9ca3af';
            ctx.font = '14px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('No data available', width / 2, height / 2);
            return;
        }

        const maxValue = Math.max(...data.revenue, ...data.expenses);
        const step = width / (data.labels.length - 1 || 1);

        // Draw grid
        ctx.strokeStyle = '#e5e7eb';
        ctx.lineWidth = 1;
        for (let i = 0; i <= 5; i++) {
            const y = padding + (height - padding * 2) * (i / 5);
            ctx.beginPath();
            ctx.moveTo(padding, y);
            ctx.lineTo(width - padding, y);
            ctx.stroke();
        }

        // Draw revenue line
        ctx.strokeStyle = color1;
        ctx.lineWidth = 3;
        ctx.beginPath();
        data.revenue.forEach((value, index) => {
            const x = padding + step * index;
            const y = height - padding - ((value / maxValue) * (height - padding * 2));
            if (index === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });
        ctx.stroke();

        // Draw expenses line
        ctx.strokeStyle = color2;
        ctx.beginPath();
        data.expenses.forEach((value, index) => {
            const x = padding + step * index;
            const y = height - padding - ((value / maxValue) * (height - padding * 2));
            if (index === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });
        ctx.stroke();

        // Draw labels
        ctx.fillStyle = '#6b7280';
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        data.labels.forEach((label, index) => {
            const x = padding + step * index;
            ctx.fillText(label, x, height - 10);
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
                // Hourly data for today
                for (let i = 0; i < 24; i++) {
                    periods.push({ hour: i, label: `${i}:00` });
                }
                break;
            case 'week':
                // Daily data for last 7 days
                for (let i = 6; i >= 0; i--) {
                    const date = new Date(now);
                    date.setDate(date.getDate() - i);
                    periods.push({ date, label: date.toLocaleDateString('en-US', { weekday: 'short' }) });
                }
                break;
            case 'month':
                // Daily data for last 30 days (sample 10 points)
                for (let i = 29; i >= 0; i -= 3) {
                    const date = new Date(now);
                    date.setDate(date.getDate() - i);
                    periods.push({ date, label: date.getDate().toString() });
                }
                break;
            case 'year':
                // Monthly data for last 12 months
                for (let i = 11; i >= 0; i--) {
                    const date = new Date(now);
                    date.setMonth(date.getMonth() - i);
                    periods.push({ date, label: date.toLocaleDateString('en-US', { month: 'short' }) });
                }
                break;
        }

        periods.forEach(period => {
            labels.push(period.label);

            let periodRevenue = 0;
            let periodExpenses = 0;

            if (this.currentPeriod === 'today') {
                // Filter by hour
                [...data.sales, ...data.b2bSales].forEach(sale => {
                    const saleDate = this.parseDate(sale);
                    if (saleDate.getDate() === now.getDate() && saleDate.getHours() === period.hour) {
                        periodRevenue += parseFloat(sale.total) || 0;
                    }
                });

                data.expenses.forEach(expense => {
                    const expenseDate = this.parseDate(expense);
                    if (expenseDate.getDate() === now.getDate() && expenseDate.getHours() === period.hour) {
                        periodExpenses += parseFloat(expense.amount) || 0;
                    }
                });
            } else {
                // Filter by date
                const periodStart = new Date(period.date);
                periodStart.setHours(0, 0, 0, 0);
                const periodEnd = new Date(period.date);
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
    }
};

export default reportsManager;
