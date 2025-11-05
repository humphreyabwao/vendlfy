// Data Management System with Branch Support
import { db, isFirebaseConfigured, collection, addDoc, getDocs, doc, updateDoc, deleteDoc, query, where, orderBy, limit } from './firebase-config.js';
import branchManager from './branch-manager.js';

class DataManager {
    constructor() {
        this.cache = {
            sales: [],
            inventory: [],
            customers: [],
            expenses: [],
            orders: []
        };
        this.useLocalStorage = !isFirebaseConfigured;
        
        if (this.useLocalStorage) {
            console.warn('⚠️ Using localStorage as fallback - Firebase not configured');
            this.loadFromLocalStorage();
        }
    }
    
    // LocalStorage fallback methods
    loadFromLocalStorage() {
        try {
            const data = localStorage.getItem('vendlfy_data');
            if (data) {
                this.cache = JSON.parse(data);
            }
        } catch (error) {
            console.error('Error loading from localStorage:', error);
        }
    }
    
    saveToLocalStorage() {
        try {
            localStorage.setItem('vendlfy_data', JSON.stringify(this.cache));
        } catch (error) {
            console.error('Error saving to localStorage:', error);
        }
    }
    
    generateLocalId() {
        return 'local_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    // Add branch ID to data
    addBranchData(data) {
        const currentBranch = branchManager.getCurrentBranch();
        return {
            ...data,
            branchId: currentBranch ? currentBranch.id : null,
            branchCode: currentBranch ? currentBranch.code : null,
            branchName: currentBranch ? currentBranch.name : null
        };
    }

    // Create query with branch filter
    createBranchQuery(collectionName, additionalConditions = []) {
        const currentBranch = branchManager.getCurrentBranch();
        const collectionRef = collection(db, collectionName);
        
        // If viewing all branches or central branch, don't filter
        if (!currentBranch || branchManager.isViewingAllBranches()) {
            if (additionalConditions.length > 0) {
                return query(collectionRef, ...additionalConditions);
            }
            return collectionRef;
        }
        
        // Filter by current branch
        const conditions = [where('branchId', '==', currentBranch.id), ...additionalConditions];
        return query(collectionRef, ...conditions);
    }

    // SALES OPERATIONS
    async createSale(saleData) {
        try {
            // Use localStorage if Firebase not configured
            if (this.useLocalStorage) {
                console.log('💾 Saving sale to localStorage (Firebase not configured)');
                const newSale = this.addBranchData({
                    ...saleData,
                    id: this.generateLocalId(),
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                });
                
                this.cache.sales.push(newSale);
                this.saveToLocalStorage();
                console.log('✅ Sale saved to localStorage:', newSale);
                return newSale;
            }
            
            // Use Firebase - Real-time sync to Firestore
            console.log('🔥 Saving sale to Firestore (real-time)...');
            const salesRef = collection(db, 'sales');
            const newSale = this.addBranchData({
                ...saleData,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                syncedToCentral: false
            });
            
            console.log('📤 Sending sale data to Firestore:', newSale);
            const docRef = await addDoc(salesRef, newSale);
            console.log('✅ Sale saved to Firestore with ID:', docRef.id);
            
            // Sync to central if not central branch
            try {
                await this.syncToCentral('sales', docRef.id, newSale);
                console.log('✅ Sale synced to central branch');
            } catch (syncError) {
                console.warn('⚠️ Could not sync to central branch:', syncError.message);
            }
            
            return { id: docRef.id, ...newSale };
        } catch (error) {
            console.error('❌ Error creating sale:', error);
            console.error('Error message:', error.message);
            console.error('Error stack:', error.stack);
            throw error;
        }
    }

    async getSales(filters = {}) {
        try {
            // Use localStorage if Firebase not configured
            if (this.useLocalStorage) {
                let sales = [...this.cache.sales];
                
                // Apply filters
                if (filters.startDate) {
                    const startDate = new Date(filters.startDate);
                    sales = sales.filter(sale => new Date(sale.createdAt) >= startDate);
                }
                if (filters.endDate) {
                    const endDate = new Date(filters.endDate);
                    sales = sales.filter(sale => new Date(sale.createdAt) <= endDate);
                }
                if (filters.limit) {
                    sales = sales.slice(0, filters.limit);
                }
                
                return sales;
            }
            
            // Use Firebase
            const conditions = [];
            
            if (filters.startDate) {
                conditions.push(where('createdAt', '>=', filters.startDate));
            }
            if (filters.endDate) {
                conditions.push(where('createdAt', '<=', filters.endDate));
            }
            if (filters.limit) {
                conditions.push(orderBy('createdAt', 'desc'), limit(filters.limit));
            }
            
            const q = this.createBranchQuery('sales', conditions);
            const snapshot = await getDocs(q);
            
            return snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
        } catch (error) {
            console.error('Error getting sales:', error);
            return [];
        }
    }

    async getTodaysSales() {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        return await this.getSales({
            startDate: today.toISOString()
        });
    }

    // ============================================
    // HELD SALES OPERATIONS
    // ============================================

    async createHeldSale(heldData) {
        const currentBranch = branchManager.getCurrentBranch();
        
        const heldSaleData = {
            ...heldData,
            branchId: currentBranch?.id || 'main',
            branchName: currentBranch?.name || 'Main Branch',
            status: 'held',
            createdAt: new Date().toISOString()
        };

        try {
            const docRef = await addDoc(collection(db, 'heldSales'), heldSaleData);
            console.log('✅ Held sale saved to Firestore:', docRef.id);
            return { id: docRef.id, ...heldSaleData };
        } catch (error) {
            console.error('❌ Error saving held sale to Firestore:', error);
            // Fallback to localStorage
            const id = `held_${Date.now()}`;
            const heldSales = JSON.parse(localStorage.getItem('heldSales') || '[]');
            heldSales.push({ id, ...heldSaleData });
            localStorage.setItem('heldSales', JSON.stringify(heldSales));
            return { id, ...heldSaleData };
        }
    }

    async getHeldSales() {
        const currentBranch = branchManager.getCurrentBranch();

        try {
            let q = collection(db, 'heldSales');
            
            if (currentBranch) {
                q = query(q, where('branchId', '==', currentBranch.id));
            }

            const querySnapshot = await getDocs(q);
            const heldSales = [];
            
            querySnapshot.forEach((doc) => {
                heldSales.push({ id: doc.id, ...doc.data() });
            });

            console.log(`✅ Fetched ${heldSales.length} held sales from Firestore`);
            return heldSales;
        } catch (error) {
            console.error('❌ Error fetching held sales from Firestore:', error);
            // Fallback to localStorage
            const heldSales = JSON.parse(localStorage.getItem('heldSales') || '[]');
            return heldSales.filter(sale => 
                !currentBranch || sale.branchId === currentBranch.id
            );
        }
    }

    async deleteHeldSale(heldSaleId) {
        try {
            await deleteDoc(doc(db, 'heldSales', heldSaleId));
            console.log('✅ Held sale deleted from Firestore:', heldSaleId);
        } catch (error) {
            console.error('❌ Error deleting held sale from Firestore:', error);
            // Fallback to localStorage
            const heldSales = JSON.parse(localStorage.getItem('heldSales') || '[]');
            const filtered = heldSales.filter(sale => sale.id !== heldSaleId);
            localStorage.setItem('heldSales', JSON.stringify(filtered));
        }
    }

    // ============================================
    // QUOTES OPERATIONS
    // ============================================

    async createQuote(quoteData) {
        const currentBranch = branchManager.getCurrentBranch();
        
        const quoteDataWithBranch = {
            ...quoteData,
            branchId: currentBranch?.id || 'main',
            branchName: currentBranch?.name || 'Main Branch',
            createdAt: new Date().toISOString()
        };

        try {
            const docRef = await addDoc(collection(db, 'quotes'), quoteDataWithBranch);
            console.log('✅ Quote saved to Firestore:', docRef.id);
            return { id: docRef.id, ...quoteDataWithBranch };
        } catch (error) {
            console.error('❌ Error saving quote to Firestore:', error);
            // Fallback to localStorage
            const id = `quote_${Date.now()}`;
            const quotes = JSON.parse(localStorage.getItem('quotes') || '[]');
            quotes.push({ id, ...quoteDataWithBranch });
            localStorage.setItem('quotes', JSON.stringify(quotes));
            return { id, ...quoteDataWithBranch };
        }
    }

    async getQuotes(filters = {}) {
        const currentBranch = branchManager.getCurrentBranch();

        try {
            let q = collection(db, 'quotes');
            
            if (currentBranch) {
                q = query(q, where('branchId', '==', currentBranch.id));
            }

            const querySnapshot = await getDocs(q);
            const quotes = [];
            
            querySnapshot.forEach((doc) => {
                quotes.push({ id: doc.id, ...doc.data() });
            });

            console.log(`✅ Fetched ${quotes.length} quotes from Firestore`);
            return quotes;
        } catch (error) {
            console.error('❌ Error fetching quotes from Firestore:', error);
            // Fallback to localStorage
            const quotes = JSON.parse(localStorage.getItem('quotes') || '[]');
            return quotes.filter(quote => 
                !currentBranch || quote.branchId === currentBranch.id
            );
        }
    }

    // INVENTORY OPERATIONS
    async createInventoryItem(itemData) {
        try {
            // Use localStorage if Firebase not configured
            if (this.useLocalStorage) {
                console.log('📦 Saving to localStorage (Firebase not configured)');
                const newItem = this.addBranchData({
                    ...itemData,
                    id: this.generateLocalId(),
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                });
                
                this.cache.inventory.push(newItem);
                this.saveToLocalStorage();
                console.log('✅ Item saved to localStorage:', newItem);
                return newItem;
            }
            
            // Use Firebase
            console.log('🔥 Saving to Firestore...');
            const inventoryRef = collection(db, 'inventory');
            const newItem = this.addBranchData({
                ...itemData,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                syncedToCentral: false
            });
            
            console.log('📤 Sending data to Firestore:', newItem);
            const docRef = await addDoc(inventoryRef, newItem);
            console.log('✅ Item saved to Firestore with ID:', docRef.id);
            
            await this.syncToCentral('inventory', docRef.id, newItem);
            
            const savedItem = { id: docRef.id, ...newItem };
            console.log('✅ Complete item data:', savedItem);
            return savedItem;
        } catch (error) {
            console.error('❌ Error creating inventory item:', error);
            console.error('Error details:', error.message);
            console.error('Error stack:', error.stack);
            throw error;
        }
    }

    async getInventory(filters = {}) {
        try {
            // Use localStorage if Firebase not configured
            if (this.useLocalStorage) {
                let items = [...this.cache.inventory];
                
                // Apply filters
                if (filters.category) {
                    items = items.filter(item => item.category === filters.category);
                }
                if (filters.inStock) {
                    items = items.filter(item => item.quantity > 0);
                }
                if (filters.status) {
                    items = items.filter(item => item.status === filters.status);
                }
                if (filters.search) {
                    const searchLower = filters.search.toLowerCase();
                    items = items.filter(item => 
                        item.name?.toLowerCase().includes(searchLower) ||
                        item.sku?.toLowerCase().includes(searchLower) ||
                        item.barcode?.toLowerCase().includes(searchLower)
                    );
                }
                
                console.log(`📦 Retrieved ${items.length} items from localStorage`);
                return items;
            }
            
            // Use Firebase
            const conditions = [];
            
            if (filters.category) {
                conditions.push(where('category', '==', filters.category));
            }
            if (filters.inStock) {
                conditions.push(where('quantity', '>', 0));
            }
            
            const q = this.createBranchQuery('inventory', conditions);
            const snapshot = await getDocs(q);
            
            return snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
        } catch (error) {
            console.error('Error getting inventory:', error);
            return [];
        }
    }

    async updateInventoryItem(itemId, updates) {
        try {
            // Use localStorage if Firebase not configured
            if (this.useLocalStorage) {
                const index = this.cache.inventory.findIndex(item => item.id === itemId);
                if (index !== -1) {
                    this.cache.inventory[index] = {
                        ...this.cache.inventory[index],
                        ...updates,
                        updatedAt: new Date().toISOString()
                    };
                    this.saveToLocalStorage();
                    console.log('✅ Item updated in localStorage');
                }
                return;
            }
            
            // Use Firebase
            const itemRef = doc(db, 'inventory', itemId);
            await updateDoc(itemRef, {
                ...updates,
                updatedAt: new Date().toISOString()
            });
            
            await this.syncToCentral('inventory', itemId, updates);
        } catch (error) {
            console.error('Error updating inventory:', error);
            throw error;
        }
    }
    
    async deleteInventoryItem(itemId) {
        try {
            // Use localStorage if Firebase not configured
            if (this.useLocalStorage) {
                this.cache.inventory = this.cache.inventory.filter(item => item.id !== itemId);
                this.saveToLocalStorage();
                console.log('✅ Item deleted from localStorage');
                return;
            }
            
            // Use Firebase
            const itemRef = doc(db, 'inventory', itemId);
            await deleteDoc(itemRef);
            console.log('✅ Item deleted from Firebase');
        } catch (error) {
            console.error('Error deleting inventory:', error);
            throw error;
        }
    }

    // CUSTOMER OPERATIONS
    async createCustomer(customerData) {
        try {
            const customersRef = collection(db, 'customers');
            const newCustomer = this.addBranchData({
                ...customerData,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                syncedToCentral: false
            });
            
            const docRef = await addDoc(customersRef, newCustomer);
            await this.syncToCentral('customers', docRef.id, newCustomer);
            
            return { id: docRef.id, ...newCustomer };
        } catch (error) {
            console.error('Error creating customer:', error);
            throw error;
        }
    }

    async getCustomers(filters = {}) {
        try {
            const conditions = [];
            
            if (filters.search) {
                // Note: Firestore doesn't support case-insensitive search well
                // Consider using Algolia or similar for advanced search
                conditions.push(where('name', '>=', filters.search));
                conditions.push(where('name', '<=', filters.search + '\uf8ff'));
            }
            
            const q = this.createBranchQuery('customers', conditions);
            const snapshot = await getDocs(q);
            
            return snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
        } catch (error) {
            console.error('Error getting customers:', error);
            return [];
        }
    }

    // EXPENSE OPERATIONS
    async createExpense(expenseData) {
        try {
            // Use localStorage if Firebase not configured
            if (this.useLocalStorage) {
                const newExpense = {
                    id: this.generateLocalId(),
                    ...expenseData,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };
                this.cache.expenses.push(newExpense);
                this.saveToLocalStorage();
                return newExpense;
            }
            
            // Use Firebase
            const expensesRef = collection(db, 'expenses');
            const newExpense = this.addBranchData({
                ...expenseData,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                syncedToCentral: false
            });
            
            const docRef = await addDoc(expensesRef, newExpense);
            await this.syncToCentral('expenses', docRef.id, newExpense);
            
            return { id: docRef.id, ...newExpense };
        } catch (error) {
            console.error('Error creating expense:', error);
            throw error;
        }
    }

    async getTodaysExpenses() {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        return await this.getExpenses({
            startDate: today.toISOString()
        });
    }

    async getExpenses(filters = {}) {
        try {
            // Use localStorage if Firebase not configured
            if (this.useLocalStorage) {
                let expenses = this.cache.expenses || [];
                
                if (filters.startDate) {
                    expenses = expenses.filter(e => e.createdAt >= filters.startDate);
                }
                if (filters.endDate) {
                    expenses = expenses.filter(e => e.createdAt <= filters.endDate);
                }
                
                return expenses;
            }
            
            const conditions = [];
            
            if (filters.startDate) {
                conditions.push(where('createdAt', '>=', filters.startDate));
            }
            if (filters.endDate) {
                conditions.push(where('createdAt', '<=', filters.endDate));
            }
            
            const q = this.createBranchQuery('expenses', conditions);
            const snapshot = await getDocs(q);
            
            return snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
        } catch (error) {
            console.error('Error getting expenses:', error);
            return [];
        }
    }

    async updateExpense(expenseId, updates) {
        try {
            // Use localStorage if Firebase not configured
            if (this.useLocalStorage) {
                const index = this.cache.expenses.findIndex(expense => expense.id === expenseId);
                if (index !== -1) {
                    this.cache.expenses[index] = {
                        ...this.cache.expenses[index],
                        ...updates,
                        updatedAt: new Date().toISOString()
                    };
                    this.saveToLocalStorage();
                    return this.cache.expenses[index];
                }
                throw new Error('Expense not found in localStorage');
            }
            
            // Use Firebase
            const expenseRef = doc(db, 'expenses', expenseId);
            const updateData = {
                ...updates,
                updatedAt: new Date().toISOString()
            };
            
            await updateDoc(expenseRef, updateData);
            
            // Try to sync to central, but don't fail if it errors
            try {
                await this.syncToCentral('expenses', expenseId, updates);
            } catch (syncError) {
                console.warn('⚠️ Could not sync to central, but expense was updated:', syncError);
            }
            
            return { id: expenseId, ...updateData };
        } catch (error) {
            console.error('Error updating expense:', error);
            throw error;
        }
    }

    async deleteExpense(expenseId) {
        try {
            // Use localStorage if Firebase not configured
            if (this.useLocalStorage) {
                this.cache.expenses = this.cache.expenses.filter(expense => expense.id !== expenseId);
                this.saveToLocalStorage();
                return;
            }
            
            // Use Firebase
            const expenseRef = doc(db, 'expenses', expenseId);
            await deleteDoc(expenseRef);
        } catch (error) {
            console.error('Error deleting expense:', error);
            throw error;
        }
    }

    // ORDER OPERATIONS
    async createOrder(orderData) {
        try {
            const ordersRef = collection(db, 'orders');
            const newOrder = this.addBranchData({
                ...orderData,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                syncedToCentral: false
            });
            
            const docRef = await addDoc(ordersRef, newOrder);
            await this.syncToCentral('orders', docRef.id, newOrder);
            
            return { id: docRef.id, ...newOrder };
        } catch (error) {
            console.error('Error creating order:', error);
            throw error;
        }
    }

    async getOrders(filters = {}) {
        try {
            const conditions = [];
            
            if (filters.status) {
                conditions.push(where('status', '==', filters.status));
            }
            
            const q = this.createBranchQuery('orders', conditions);
            const snapshot = await getDocs(q);
            
            return snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
        } catch (error) {
            console.error('Error getting orders:', error);
            return [];
        }
    }

    // CENTRAL SYNC
    async syncToCentral(collectionName, docId, data) {
        try {
            const currentBranch = branchManager.getCurrentBranch();
            
            // Don't sync if already central or no branch
            if (!currentBranch || currentBranch.isCentral) {
                return;
            }
            
            // Create sync record in central collection
            const syncRef = collection(db, `central_${collectionName}`);
            await addDoc(syncRef, {
                ...data,
                originalId: docId,
                syncedAt: new Date().toISOString(),
                syncSource: 'branch'
            });
            
            // Mark original as synced
            const docRef = doc(db, collectionName, docId);
            await updateDoc(docRef, { syncedToCentral: true });
            
            console.log(`Data synced to central ${collectionName}`);
        } catch (error) {
            console.error('Error syncing to central:', error);
        }
    }

    // Get aggregated data across all branches (for central view)
    async getAggregatedData(collectionName, filters = {}) {
        try {
            const centralRef = collection(db, `central_${collectionName}`);
            const snapshot = await getDocs(centralRef);
            
            return snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
        } catch (error) {
            console.error('Error getting aggregated data:', error);
            return [];
        }
    }

    // STATISTICS
    async getDashboardStats() {
        try {
            const [sales, expenses, customers, inventory, orders] = await Promise.all([
                this.getTodaysSales(),
                this.getTodaysExpenses(),
                this.getCustomers(),
                this.getInventory(),
                this.getOrders({ status: 'pending' })
            ]);
            
            const totalSales = sales.reduce((sum, sale) => sum + (sale.total || 0), 0);
            const totalExpenses = expenses.reduce((sum, expense) => sum + (expense.amount || 0), 0);
            const stockValue = inventory.reduce((sum, item) => sum + ((item.quantity || 0) * (item.price || 0)), 0);
            const outOfStock = inventory.filter(item => (item.quantity || 0) === 0).length;
            
            // Get active branches count
            const activeBranches = branchManager.getActiveBranches().length;
            
            return {
                todaysSales: totalSales,
                todaysExpenses: totalExpenses,
                profitLoss: totalSales - totalExpenses,
                totalCustomers: customers.length,
                stockValue: stockValue,
                pendingB2BOrders: orders.filter(o => o.type === 'b2b').length,
                activeBranches: activeBranches,
                outOfStock: outOfStock
            };
        } catch (error) {
            console.error('Error getting dashboard stats:', error);
            return {
                todaysSales: 0,
                todaysExpenses: 0,
                profitLoss: 0,
                totalCustomers: 0,
                stockValue: 0,
                pendingB2BOrders: 0,
                activeBranches: 0,
                outOfStock: 0
            };
        }
    }
}

// Create and export singleton instance
const dataManager = new DataManager();
export default dataManager;
