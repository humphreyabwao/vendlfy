// Data Management System with Branch Support
import { db, isFirebaseConfigured, collection, addDoc, getDocs, doc, updateDoc, deleteDoc, setDoc, getDoc, query, where, orderBy, limit } from './firebase-config.js';
import branchManager from './branch-manager.js';
import sessionManager from './session-manager.js';
import { addWithFallback, updateWithFallback, deleteWithFallback, readMerged, streamDual } from './storage-adapter.js';

class DataManager {
    constructor() {
        this.cache = {
            sales: [],
            inventory: [],
            customers: [],
            expenses: [],
            orders: [],
            staff: [],
            salaryPayments: []
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

    /**
     * Wait until role/branch RBAC is loaded before building queries.
     * If fetches run while profile is still null, non-admins get the "__no_access__"
     * branch filter and see no inventory or other branch data.
     */
    async _ensureSessionReady() {
        if (this.useLocalStorage || !sessionManager.getAuthUser?.()) return;
        await sessionManager.ready();
    }

    // Create query with branch filter — enforces RBAC at the data layer
    createBranchQuery(collectionName, additionalConditions = []) {
        const collectionRef = collection(db, collectionName);
        const currentBranch = branchManager.getCurrentBranch();

        // Admin (or no session loaded yet) — use the branch selector's current value
        if (sessionManager.canAccessAllBranches()) {
            if (!currentBranch || branchManager.isViewingAllBranches()) {
                // No filter — admin sees everything
                if (additionalConditions.length > 0) {
                    return query(collectionRef, ...additionalConditions);
                }
                return collectionRef;
            }
            // Admin has a specific branch selected
            const conditions = [where('branchId', '==', currentBranch.id), ...additionalConditions];
            return query(collectionRef, ...conditions);
        }

        // Non-admin — always scope to their allowed branches regardless of selector
        const allowedIds = sessionManager.getAllowedBranchIds();
        if (!allowedIds || allowedIds.length === 0) {
            // No branches assigned — return an impossible query (empty results)
            const conditions = [where('branchId', '==', '__no_access__'), ...additionalConditions];
            return query(collectionRef, ...conditions);
        }

        if (allowedIds.length === 1) {
            // Single branch — simple equality
            const conditions = [where('branchId', '==', allowedIds[0]), ...additionalConditions];
            return query(collectionRef, ...conditions);
        }

        // Multiple branches — Firestore 'in' supports up to 30 values
        const conditions = [where('branchId', 'in', allowedIds.slice(0, 30)), ...additionalConditions];
        return query(collectionRef, ...conditions);
    }

    /** Matches createBranchQuery branch scope for RTDB merge filters (readMerged / streamDual). */
    _rtdbBranchFilter() {
        const currentBranch = branchManager.getCurrentBranch();

        if (sessionManager.canAccessAllBranches()) {
            if (!currentBranch || branchManager.isViewingAllBranches()) {
                return () => true;
            }
            const bid = currentBranch.id;
            return (item) => item.branchId === bid;
        }

        const allowedIds = sessionManager.getAllowedBranchIds();
        if (!allowedIds || allowedIds.length === 0) {
            return () => false;
        }
        if (allowedIds.length === 1) {
            return (item) => item.branchId === allowedIds[0];
        }
        return (item) => allowedIds.includes(item.branchId);
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
            
            console.log('🔥 Saving sale to Firestore (primary) with Realtime DB fallback...');
            const newSale = this.addBranchData({
                ...saleData,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                syncedToCentral: false
            });

            console.log('📤 Sending sale data:', newSale);
            const result = await addWithFallback('sales', newSale);
            console.log('✅ Sale saved (id:', result.id, 'source:', result.source + ')');

            // Sync to central if not central branch
            try {
                await this.syncToCentral('sales', result.id, newSale);
                console.log('✅ Sale sync-to-central attempted');
            } catch (syncError) {
                console.warn('⚠️ Could not sync to central branch:', syncError.message);
            }

            // Log activity
            if (window.activityTracker) {
                window.activityTracker.logActivity('sale', 'completed', {
                    amount: saleData.total || saleData.grandTotal || 0,
                    items: saleData.items?.length || 0
                });
            }

            return { id: result.id, ...newSale, _source: result.source };
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
            
            // Firebase: merge Firestore + RTDB (fallback rows stay visible after quota events)
            await this._ensureSessionReady();
            const q = this.createBranchQuery('sales', conditions);
            let sales = await readMerged({
                firestoreQuery: q,
                rtdbPath: 'sales',
                rtdbFilter: this._rtdbBranchFilter()
            });

            if (filters.startDate) {
                const startDate = new Date(filters.startDate);
                sales = sales.filter((sale) => new Date(sale.createdAt) >= startDate);
            }
            if (filters.endDate) {
                const endDate = new Date(filters.endDate);
                sales = sales.filter((sale) => new Date(sale.createdAt) <= endDate);
            }

            sales.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            if (filters.limit) {
                sales = sales.slice(0, filters.limit);
            }

            return sales;
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

    async updateSale(saleId, updates) {
        try {
            const saleRef = doc(db, 'sales', saleId);
            const snap = await getDoc(saleRef);
            const source = snap.exists() ? 'firestore' : 'rtdb';
            await updateWithFallback('sales', saleId, {
                ...updates,
                updatedAt: new Date().toISOString()
            }, source);
            console.log('✅ Sale updated successfully:', saleId);
            return true;
        } catch (error) {
            console.error('Error updating sale:', error);
            throw error;
        }
    }

    async deleteSale(saleId) {
        try {
            const saleRef = doc(db, 'sales', saleId);
            const snap = await getDoc(saleRef);
            const source = snap.exists() ? 'firestore' : 'rtdb';
            await deleteWithFallback('sales', saleId, source);
            console.log('✅ Sale deleted successfully:', saleId);
            return true;
        } catch (error) {
            console.error('Error deleting sale:', error);
            throw error;
        }
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
            // Validate item data before saving
            if (!itemData || typeof itemData !== 'object') {
                throw new Error('Invalid item data');
            }

            // Validate required fields
            if (!itemData.name || !itemData.name.trim()) {
                throw new Error('Item name is required');
            }

            if (!itemData.sku || !itemData.sku.trim()) {
                throw new Error('Item SKU is required');
            }

            if (!itemData.category || !itemData.category.trim()) {
                throw new Error('Item category is required');
            }

            // Validate numeric fields
            if (itemData.price === undefined || itemData.price === null || isNaN(itemData.price) || itemData.price < 0) {
                throw new Error('Valid item price is required');
            }

            if (itemData.quantity === undefined || itemData.quantity === null || isNaN(itemData.quantity) || itemData.quantity < 0) {
                throw new Error('Valid item quantity is required');
            }

            // Sanitize data to prevent invalid values
            const sanitizedData = {
                ...itemData,
                name: itemData.name.trim(),
                sku: itemData.sku.trim(),
                category: itemData.category.trim(),
                price: parseFloat(itemData.price),
                cost: parseFloat(itemData.cost) || 0,
                quantity: parseInt(itemData.quantity) || 0,
                reorderLevel: parseInt(itemData.reorderLevel) || 5,
                description: itemData.description ? itemData.description.trim() : '',
                supplier: itemData.supplier ? itemData.supplier.trim() : '',
                location: itemData.location ? itemData.location.trim() : '',
                unit: itemData.unit || 'piece'
            };

            console.log('✅ Item data validated:', sanitizedData);

            // Use localStorage if Firebase not configured
            if (this.useLocalStorage) {
                console.log('📦 Saving to localStorage (Firebase not configured)');
                const newItem = this.addBranchData({
                    ...sanitizedData,
                    id: this.generateLocalId(),
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                });
                
                this.cache.inventory.push(newItem);
                this.saveToLocalStorage();
                console.log('✅ Item saved to localStorage:', newItem);
                return newItem;
            }
            
            // Use Firebase — Firestore primary, Realtime Database fallback on quota / timeouts
            console.log('🔥 Saving to Firestore (primary) with RTDB fallback...');
            const newItem = this.addBranchData({
                ...sanitizedData,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                syncedToCentral: false
            });

            console.log('📤 Sending data:', newItem);
            const result = await addWithFallback('inventory', newItem);
            console.log('✅ Item saved (id:', result.id, 'source:', result.source + ')');

            await this.syncToCentral('inventory', result.id, newItem);

            const savedItem = { id: result.id, ...newItem, _source: result.source };
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
            
            await this._ensureSessionReady();
            const q = this.createBranchQuery('inventory', conditions);
            console.log('📡 Fetching inventory (Firestore + RTDB merge)...');
            let items = await readMerged({
                firestoreQuery: q,
                rtdbPath: 'inventory',
                rtdbFilter: this._rtdbBranchFilter()
            });

            if (filters.status) {
                items = items.filter((item) => item.status === filters.status);
            }
            if (filters.search) {
                const searchLower = filters.search.toLowerCase();
                items = items.filter(
                    (item) =>
                        item.name?.toLowerCase().includes(searchLower) ||
                        item.sku?.toLowerCase().includes(searchLower) ||
                        item.barcode?.toLowerCase().includes(searchLower)
                );
            }

            console.log(`✅ Retrieved ${items.length} inventory row(s) (merged)`);
            return items;
        } catch (error) {
            console.error('Error getting inventory:', error);
            return [];
        }
    }

    /**
     * Live merged inventory (Firestore snapshot + RTDB). Call the returned function to unsubscribe.
     */
    subscribeInventory({ onUpdate, onError } = {}) {
        if (this.useLocalStorage) {
            return () => {};
        }
        let cancelled = false;
        let innerUnsub = null;
        (async () => {
            try {
                await this._ensureSessionReady();
                if (cancelled) return;
                const fsQuery = this.createBranchQuery('inventory', []);
                innerUnsub = streamDual({
                    firestoreQuery: fsQuery,
                    rtdbPath: 'inventory',
                    rtdbFilter: this._rtdbBranchFilter(),
                    onUpdate: (items) => onUpdate?.(items),
                    onError: (err, source) => {
                        console.error(`[data-manager] inventory stream (${source}):`, err?.code, err?.message);
                        onError?.(err, source);
                    }
                });
            } catch (e) {
                console.error('subscribeInventory failed:', e);
            }
        })();
        return () => {
            cancelled = true;
            try {
                innerUnsub?.();
            } catch (e) { /* ignore */ }
        };
    }

    async updateInventoryItem(itemId, updates, fullItemData = null) {
        try {
            if (!itemId) {
                throw new Error('Item ID is required for update');
            }

            console.log('🔄 Updating inventory item:', itemId);
            console.log('📝 Updates:', updates);
            
            // Ensure quantity is never negative
            if (updates.quantity !== undefined) {
                updates.quantity = Math.max(0, parseInt(updates.quantity) || 0);
                console.log('✅ Validated quantity:', updates.quantity);
            }
            if (updates.stock !== undefined) {
                updates.stock = Math.max(0, parseInt(updates.stock) || 0);
            }

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
                } else {
                    throw new Error('Item not found in localStorage');
                }
                return;
            }
            
            // Use Firebase - All items should now have Firebase IDs
            const itemRef = doc(db, 'inventory', itemId);

            if (itemId.startsWith('item_') || itemId.startsWith('local_')) {
                console.error('❌ Cannot update item with local ID:', itemId);
                throw new Error(`This item exists only locally and cannot be synced. Please delete it and reload the inventory from Firebase.`);
            }

            let source =
                fullItemData && (fullItemData._source === 'rtdb' || fullItemData._source === 'firestore')
                    ? fullItemData._source
                    : null;
            const docSnap = source !== 'rtdb' ? await getDoc(itemRef) : { exists: () => false };

            if (!source) {
                source = docSnap.exists() ? 'firestore' : 'rtdb';
            }

            if (source === 'firestore') {
                if (!docSnap.exists()) {
                    console.error('❌ Document does not exist in Firestore:', itemId);
                    throw new Error(`Item not found in Firebase. The item may have been deleted. Please refresh the inventory.`);
                }
            }

            console.log('📤 Updating inventory via storage adapter (source:', source + ')...');
            await updateWithFallback('inventory', itemId, {
                ...updates,
                updatedAt: new Date().toISOString()
            }, source);
            console.log('✅ Item updated successfully');

            await this.syncToCentral('inventory', itemId, updates);
        } catch (error) {
            console.error('❌ Error updating inventory:', error);
            console.error('Error details:', error.message);
            throw error;
        }
    }
    
    async deleteInventoryItem(itemId) {
        try {
            if (!itemId) {
                throw new Error('Item ID is required for deletion');
            }

            console.log('🗑️ Deleting inventory item:', itemId);

            // Use localStorage if Firebase not configured
            if (this.useLocalStorage) {
                const initialLength = this.cache.inventory.length;
                this.cache.inventory = this.cache.inventory.filter(item => item.id !== itemId);
                
                if (this.cache.inventory.length === initialLength) {
                    throw new Error('Item not found in localStorage');
                }
                
                this.saveToLocalStorage();
                console.log('✅ Item deleted from localStorage');
                return;
            }
            
            // Use Firebase - Delete from Firestore
            const itemRef = doc(db, 'inventory', itemId);

            const docSnap = await getDoc(itemRef);
            const source = docSnap.exists() ? 'firestore' : 'rtdb';

            if (!docSnap.exists()) {
                console.log('⚠️ Item not found in Firestore (may be RTDB-only or already deleted):', itemId);
            }

            console.log('📤 Deleting inventory via storage adapter (source:', source + ')...');
            await deleteWithFallback('inventory', itemId, source);
            console.log('✅ Item delete completed:', itemId);
            
        } catch (error) {
            console.error('❌ Error deleting inventory:', error);
            console.error('Error details:', error.message);
            throw error;
        }
    }

    // CUSTOMER OPERATIONS
    async createCustomer(customerData) {
        try {
            // Use localStorage if Firebase not configured
            if (this.useLocalStorage) {
                const newCustomer = {
                    id: this.generateLocalId(),
                    ...customerData,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };
                this.cache.customers.push(newCustomer);
                this.saveToLocalStorage();
                return newCustomer;
            }
            
            // Use Firebase
            const customersRef = collection(db, 'customers');
            const newCustomer = this.addBranchData({
                ...customerData,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                syncedToCentral: false
            });
            
            const docRef = await addDoc(customersRef, newCustomer);
            
            // Cache the new customer locally to prevent duplicate queries
            const customerWithId = { id: docRef.id, ...newCustomer };
            if (!this.cache.customers) {
                this.cache.customers = [];
            }
            this.cache.customers.push(customerWithId);
            
            // Sync to central collection
            try {
                await this.syncToCentral('customers', docRef.id, newCustomer);
            } catch (syncError) {
                console.warn('Failed to sync to central, but customer created:', syncError);
            }
            
            return customerWithId;
        } catch (error) {
            console.error('Error creating customer:', error);
            throw error;
        }
    }

    async getCustomers(filters = {}) {
        try {
            // Use localStorage if Firebase not configured
            if (this.useLocalStorage) {
                return this.cache.customers || [];
            }
            
            const conditions = [];
            
            if (filters.search) {
                // Note: Firestore doesn't support case-insensitive search well
                // Consider using Algolia or similar for advanced search
                conditions.push(where('name', '>=', filters.search));
                conditions.push(where('name', '<=', filters.search + '\uf8ff'));
            }
            
            await this._ensureSessionReady();
            const q = this.createBranchQuery('customers', conditions);
            const snapshot = await getDocs(q);
            
            const customers = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            
            // Remove duplicates by ID (just in case)
            const uniqueCustomers = customers.reduce((acc, customer) => {
                if (!acc.find(c => c.id === customer.id)) {
                    acc.push(customer);
                }
                return acc;
            }, []);
            
            // Update cache
            this.cache.customers = uniqueCustomers;
            
            return uniqueCustomers;
        } catch (error) {
            console.error('Error getting customers:', error);
            // Return cached data if Firebase fails
            return this.cache.customers || [];
        }
    }

    async updateCustomer(customerId, updates) {
        try {
            // Use localStorage if Firebase not configured
            if (this.useLocalStorage) {
                const index = this.cache.customers.findIndex(customer => customer.id === customerId);
                if (index !== -1) {
                    this.cache.customers[index] = {
                        ...this.cache.customers[index],
                        ...updates,
                        updatedAt: new Date().toISOString()
                    };
                    this.saveToLocalStorage();
                    return this.cache.customers[index];
                }
                throw new Error('Customer not found in localStorage');
            }
            
            // Use Firebase
            const customerRef = doc(db, 'customers', customerId);
            const updateData = {
                ...updates,
                updatedAt: new Date().toISOString()
            };
            
            await updateDoc(customerRef, updateData);
            
            // Try to sync to central, but don't fail if it errors
            try {
                await this.syncToCentral('customers', customerId, updates);
            } catch (syncError) {
                console.warn('⚠️ Could not sync to central, but customer was updated:', syncError);
            }
            
            return { id: customerId, ...updateData };
        } catch (error) {
            console.error('Error updating customer:', error);
            throw error;
        }
    }

    async deleteCustomer(customerId) {
        try {
            // Use localStorage if Firebase not configured
            if (this.useLocalStorage) {
                this.cache.customers = this.cache.customers.filter(customer => customer.id !== customerId);
                this.saveToLocalStorage();
                return;
            }
            
            // Use Firebase
            const customerRef = doc(db, 'customers', customerId);
            await deleteDoc(customerRef);
        } catch (error) {
            console.error('Error deleting customer:', error);
            throw error;
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
            
            await this._ensureSessionReady();
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

    // ---------- STAFF / HR OPERATIONS ----------

    async createStaff(staffData) {
        try {
            const newStaff = this.addBranchData({
                ...staffData,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                status: staffData.status || 'active'
            });

            if (this.useLocalStorage) {
                newStaff.id = this.generateLocalId();
                this.cache.staff.push(newStaff);
                this.saveToLocalStorage();
                return newStaff;
            }

            const staffRef = collection(db, 'staff');
            const docRef = await addDoc(staffRef, newStaff);
            return { id: docRef.id, ...newStaff };
        } catch (error) {
            console.error('Error creating staff:', error);
            throw error;
        }
    }

    async getStaff(filters = {}) {
        try {
            if (this.useLocalStorage) {
                let staff = [...(this.cache.staff || [])];
                if (filters.status) staff = staff.filter(s => s.status === filters.status);
                return staff;
            }

            const conditions = [];
            if (filters.status) {
                conditions.push(where('status', '==', filters.status));
            }

            await this._ensureSessionReady();
            const q = this.createBranchQuery('staff', conditions);
            const snapshot = await getDocs(q);
            return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        } catch (error) {
            console.error('Error getting staff:', error);
            return [];
        }
    }

    async updateStaff(staffId, updates) {
        try {
            const updateData = { ...updates, updatedAt: new Date().toISOString() };

            if (this.useLocalStorage) {
                const idx = this.cache.staff.findIndex(s => s.id === staffId);
                if (idx === -1) throw new Error('Staff not found in localStorage');
                this.cache.staff[idx] = { ...this.cache.staff[idx], ...updateData };
                this.saveToLocalStorage();
                return this.cache.staff[idx];
            }

            const staffRef = doc(db, 'staff', staffId);
            await updateDoc(staffRef, updateData);
            return { id: staffId, ...updateData };
        } catch (error) {
            console.error('Error updating staff:', error);
            throw error;
        }
    }

    async deleteStaff(staffId) {
        try {
            if (this.useLocalStorage) {
                this.cache.staff = this.cache.staff.filter(s => s.id !== staffId);
                this.saveToLocalStorage();
                return;
            }
            await deleteDoc(doc(db, 'staff', staffId));
        } catch (error) {
            console.error('Error deleting staff:', error);
            throw error;
        }
    }

    // ---------- SALARY PAYMENT OPERATIONS ----------

    async createSalaryPayment(paymentData) {
        try {
            const newPayment = this.addBranchData({
                ...paymentData,
                createdAt: new Date().toISOString()
            });

            if (this.useLocalStorage) {
                newPayment.id = this.generateLocalId();
                this.cache.salaryPayments.push(newPayment);
                this.saveToLocalStorage();
                return newPayment;
            }

            const ref = collection(db, 'salaryPayments');
            const docRef = await addDoc(ref, newPayment);
            return { id: docRef.id, ...newPayment };
        } catch (error) {
            console.error('Error creating salary payment:', error);
            throw error;
        }
    }

    async getSalaryPayments(filters = {}) {
        try {
            if (this.useLocalStorage) {
                let payments = [...(this.cache.salaryPayments || [])];
                if (filters.staffId) payments = payments.filter(p => p.staffId === filters.staffId);
                if (filters.startDate) payments = payments.filter(p => (p.paymentDate || p.createdAt) >= filters.startDate);
                if (filters.endDate) payments = payments.filter(p => (p.paymentDate || p.createdAt) <= filters.endDate);
                return payments;
            }

            const conditions = [];
            if (filters.staffId) conditions.push(where('staffId', '==', filters.staffId));
            if (filters.startDate) conditions.push(where('paymentDate', '>=', filters.startDate));
            if (filters.endDate) conditions.push(where('paymentDate', '<=', filters.endDate));

            await this._ensureSessionReady();
            const q = this.createBranchQuery('salaryPayments', conditions);
            const snapshot = await getDocs(q);
            return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        } catch (error) {
            console.error('Error getting salary payments:', error);
            return [];
        }
    }

    async updateSalaryPayment(paymentId, updates) {
        try {
            const updateData = { ...updates, updatedAt: new Date().toISOString() };

            if (this.useLocalStorage) {
                const idx = this.cache.salaryPayments.findIndex(p => p.id === paymentId);
                if (idx === -1) throw new Error('Salary payment not found');
                this.cache.salaryPayments[idx] = { ...this.cache.salaryPayments[idx], ...updateData };
                this.saveToLocalStorage();
                return this.cache.salaryPayments[idx];
            }

            await updateDoc(doc(db, 'salaryPayments', paymentId), updateData);
            return { id: paymentId, ...updateData };
        } catch (error) {
            console.error('Error updating salary payment:', error);
            throw error;
        }
    }

    async deleteSalaryPayment(paymentId) {
        try {
            if (this.useLocalStorage) {
                this.cache.salaryPayments = this.cache.salaryPayments.filter(p => p.id !== paymentId);
                this.saveToLocalStorage();
                return;
            }
            await deleteDoc(doc(db, 'salaryPayments', paymentId));
        } catch (error) {
            console.error('Error deleting salary payment:', error);
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
            
            await this._ensureSessionReady();
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
            const [sales, expenses, customers, inventory, allSales] = await Promise.all([
                this.getTodaysSales(),
                this.getTodaysExpenses(),
                this.getCustomers(),
                this.getInventory(),
                this.getSales() // Get all sales to count pending B2B orders
            ]);
            
            const totalSales = sales.reduce((sum, sale) => sum + (sale.total || 0), 0);
            const totalExpenses = expenses.reduce((sum, expense) => sum + (expense.amount || 0), 0);
            const stockValue = inventory.reduce((sum, item) => sum + ((item.quantity || 0) * (item.price || 0)), 0);
            const outOfStock = inventory.filter(item => (item.quantity || 0) === 0).length;
            
            // Get active branches count
            const activeBranches = branchManager.getActiveBranches().length;
            
            // Count pending B2B orders from sales collection
            const pendingB2B = allSales.filter(sale => 
                (sale.type === 'b2b' || sale.saleType === 'wholesale') && 
                sale.status === 'pending'
            ).length;
            
            return {
                todaysSales: totalSales,
                todaysExpenses: totalExpenses,
                profitLoss: totalSales - totalExpenses,
                totalCustomers: customers.length,
                stockValue: stockValue,
                pendingB2BOrders: pendingB2B,
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

    // Orders Management
    async updateOrder(orderId, updates) {
        try {
            if (this.useLocalStorage) {
                const orderIndex = this.cache.orders.findIndex(o => o.id === orderId);
                if (orderIndex !== -1) {
                    this.cache.orders[orderIndex] = {
                        ...this.cache.orders[orderIndex],
                        ...updates,
                        updatedAt: new Date()
                    };
                    this.saveToLocalStorage();
                    return this.cache.orders[orderIndex];
                }
                throw new Error('Order not found');
            }

            const orderRef = doc(db, 'orders', orderId);
            await updateDoc(orderRef, {
                ...updates,
                updatedAt: new Date()
            });
            
            return { id: orderId, ...updates };
        } catch (error) {
            console.error('Error updating order:', error);
            throw error;
        }
    }

    async updateInventory(itemId, updates) {
        try {
            if (this.useLocalStorage) {
                const itemIndex = this.cache.inventory.findIndex(i => i.id === itemId);
                if (itemIndex !== -1) {
                    this.cache.inventory[itemIndex] = {
                        ...this.cache.inventory[itemIndex],
                        ...updates,
                        updatedAt: new Date()
                    };
                    this.saveToLocalStorage();
                    return this.cache.inventory[itemIndex];
                }
                throw new Error('Inventory item not found');
            }

            const itemRef = doc(db, 'inventory', itemId);
            await updateDoc(itemRef, {
                ...updates,
                updatedAt: new Date()
            });
            
            return { id: itemId, ...updates };
        } catch (error) {
            console.error('Error updating inventory:', error);
            throw error;
        }
    }
}

// Create and export singleton instance
const dataManager = new DataManager();
export default dataManager;

