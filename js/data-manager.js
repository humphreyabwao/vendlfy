// Data Management System with Branch Support
import { db, collection, addDoc, getDocs, doc, updateDoc, deleteDoc, query, where, orderBy, limit } from './firebase-config.js';
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
            const salesRef = collection(db, 'sales');
            const newSale = this.addBranchData({
                ...saleData,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                syncedToCentral: false
            });
            
            const docRef = await addDoc(salesRef, newSale);
            
            // Sync to central if not central branch
            await this.syncToCentral('sales', docRef.id, newSale);
            
            return { id: docRef.id, ...newSale };
        } catch (error) {
            console.error('Error creating sale:', error);
            throw error;
        }
    }

    async getSales(filters = {}) {
        try {
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

    // INVENTORY OPERATIONS
    async createInventoryItem(itemData) {
        try {
            const inventoryRef = collection(db, 'inventory');
            const newItem = this.addBranchData({
                ...itemData,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                syncedToCentral: false
            });
            
            const docRef = await addDoc(inventoryRef, newItem);
            await this.syncToCentral('inventory', docRef.id, newItem);
            
            return { id: docRef.id, ...newItem };
        } catch (error) {
            console.error('Error creating inventory item:', error);
            throw error;
        }
    }

    async getInventory(filters = {}) {
        try {
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
