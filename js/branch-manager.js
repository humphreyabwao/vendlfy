// Branch Management System
import { db, collection, addDoc, getDocs, doc, updateDoc, deleteDoc, query, where, orderBy, onSnapshot, isFirebaseConfigured } from './firebase-config.js';

class BranchManager {
    constructor() {
        this.currentBranch = this.loadCurrentBranch();
        this.branches = [];
        this.useLocalStorage = !isFirebaseConfigured; // Fallback to localStorage if Firebase not configured
        this.branchesListener = null; // Real-time listener
        this.callbacks = []; // Callbacks for real-time updates
    }

    // Check if Firebase is available
    isFirebaseAvailable() {
        return isFirebaseConfigured && db !== undefined;
    }

    // Load current branch from localStorage
    loadCurrentBranch() {
        const saved = localStorage.getItem('currentBranch');
        return saved ? JSON.parse(saved) : null;
    }

    // Save current branch to localStorage
    saveCurrentBranch(branch) {
        localStorage.setItem('currentBranch', JSON.stringify(branch));
        this.currentBranch = branch;
    }

    // Get current branch
    getCurrentBranch() {
        return this.currentBranch;
    }

    // Initialize branches collection
    async initializeBranches() {
        try {
            if (!this.isFirebaseAvailable()) {
                console.warn('⚠️ Firebase not configured. Using local storage for demo.');
                this.initializeLocalBranches();
                return;
            }

            console.log('🔄 Initializing branches from Firestore...');
            const branchesRef = collection(db, 'branches');
            const snapshot = await getDocs(branchesRef);
            
            if (snapshot.empty) {
                // Create default central branch
                console.log('📝 Creating default central branch...');
                await this.createBranch({
                    name: 'Central Branch',
                    code: 'CENTRAL',
                    isCentral: true,
                    address: '',
                    phone: '',
                    manager: '',
                    status: 'active'
                });
                console.log('✅ Default central branch created in Firestore');
            }
            
            await this.loadBranches();
            console.log(`✅ Loaded ${this.branches.length} branches from Firestore`);
        } catch (error) {
            console.error('❌ Error initializing branches:', error);
            console.warn('⚠️ Falling back to local storage');
            this.initializeLocalBranches();
        }
    }

    // Fallback: Initialize local branches
    initializeLocalBranches() {
        const localBranches = localStorage.getItem('vendify_branches');
        if (!localBranches) {
            this.branches = [{
                id: 'central',
                name: 'Central Branch',
                code: 'CENTRAL',
                isCentral: true,
                address: '',
                phone: '',
                manager: '',
                status: 'active',
                createdAt: new Date().toISOString()
            }];
            localStorage.setItem('vendify_branches', JSON.stringify(this.branches));
        } else {
            this.branches = JSON.parse(localBranches);
        }
        
        if (!this.currentBranch && this.branches.length > 0) {
            this.saveCurrentBranch(this.branches[0]);
        }
        console.log('📦 Using local storage with', this.branches.length, 'branches');
    }

    // Generate unique branch code
    generateBranchCode() {
        const activeBranches = this.branches.filter(b => !b.isCentral);
        const branchNumber = activeBranches.length + 1;
        return `BR${String(branchNumber).padStart(3, '0')}`;
    }

    // Create new branch
    async createBranch(branchData) {
        try {
            // Auto-generate code if not provided or if creating non-central branch
            if (!branchData.code || !branchData.isCentral) {
                branchData.code = this.generateBranchCode();
            }
            
            const newBranch = {
                ...branchData,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            if (this.isFirebaseAvailable()) {
                // Save to Firestore
                console.log('💾 Saving branch to Firestore:', newBranch.name);
                const branchesRef = collection(db, 'branches');
                const docRef = await addDoc(branchesRef, newBranch);
                console.log('✅ Branch saved to Firestore with ID:', docRef.id);
                
                await this.loadBranches();
                return { id: docRef.id, ...newBranch };
            } else {
                // Save to localStorage
                console.log('💾 Saving branch to local storage:', newBranch.name);
                newBranch.id = 'local_' + Date.now();
                this.branches.push(newBranch);
                localStorage.setItem('vendify_branches', JSON.stringify(this.branches));
                console.log('✅ Branch saved to local storage');
                return newBranch;
            }
        } catch (error) {
            console.error('❌ Error creating branch:', error);
            throw error;
        }
    }

    // Load all branches
    async loadBranches() {
        try {
            if (this.isFirebaseAvailable()) {
                console.log('🔄 Loading branches from Firestore...');
                const branchesRef = collection(db, 'branches');
                const q = query(branchesRef, orderBy('createdAt', 'asc'));
                const snapshot = await getDocs(q);
                
                this.branches = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }));
                console.log(`✅ Loaded ${this.branches.length} branches from Firestore`);
            } else {
                // Load from localStorage
                const localBranches = localStorage.getItem('vendify_branches');
                this.branches = localBranches ? JSON.parse(localBranches) : [];
                console.log(`📦 Loaded ${this.branches.length} branches from local storage`);
            }
            
            // Set current branch if not set
            if (!this.currentBranch && this.branches.length > 0) {
                this.saveCurrentBranch(this.branches[0]);
            }
            
            return this.branches;
        } catch (error) {
            console.error('❌ Error loading branches:', error);
            return [];
        }
    }

    // Get all branches
    getAllBranches() {
        return this.branches;
    }

    // Get active branches
    getActiveBranches() {
        return this.branches.filter(branch => branch.status === 'active');
    }

    // Get central branch
    getCentralBranch() {
        return this.branches.find(branch => branch.isCentral === true);
    }

    // Update branch
    async updateBranch(branchId, updates) {
        try {
            updates.updatedAt = new Date().toISOString();

            if (this.isFirebaseAvailable()) {
                console.log('💾 Updating branch in Firestore:', branchId);
                const branchRef = doc(db, 'branches', branchId);
                await updateDoc(branchRef, updates);
                console.log('✅ Branch updated in Firestore');
            } else {
                // Update in localStorage
                console.log('💾 Updating branch in local storage:', branchId);
                const index = this.branches.findIndex(b => b.id === branchId);
                if (index !== -1) {
                    this.branches[index] = { ...this.branches[index], ...updates };
                    localStorage.setItem('vendify_branches', JSON.stringify(this.branches));
                    console.log('✅ Branch updated in local storage');
                }
            }
            
            await this.loadBranches();
            
            // Update current branch if it was updated
            if (this.currentBranch && this.currentBranch.id === branchId) {
                const updatedBranch = this.branches.find(b => b.id === branchId);
                this.saveCurrentBranch(updatedBranch);
            }
            
        } catch (error) {
            console.error('❌ Error updating branch:', error);
            throw error;
        }
    }

    // Delete branch
    async deleteBranch(branchId) {
        try {
            const branch = this.branches.find(b => b.id === branchId);
            
            // Prevent deletion of central branch
            if (branch && branch.isCentral) {
                throw new Error('Cannot delete central branch');
            }

            if (this.isFirebaseAvailable()) {
                console.log('🗑️ Deleting branch from Firestore:', branchId);
                const branchRef = doc(db, 'branches', branchId);
                await deleteDoc(branchRef);
                console.log('✅ Branch deleted from Firestore');
            } else {
                // Delete from localStorage
                console.log('🗑️ Deleting branch from local storage:', branchId);
                this.branches = this.branches.filter(b => b.id !== branchId);
                localStorage.setItem('vendify_branches', JSON.stringify(this.branches));
                console.log('✅ Branch deleted from local storage');
            }
            
            await this.loadBranches();
            
            // Switch to central branch if current branch was deleted
            if (this.currentBranch && this.currentBranch.id === branchId) {
                const central = this.getCentralBranch();
                this.saveCurrentBranch(central);
            }
            
        } catch (error) {
            console.error('❌ Error deleting branch:', error);
            throw error;
        }
    }

    // Switch branch
    switchBranch(branchId) {
        const branch = this.branches.find(b => b.id === branchId);
        if (branch) {
            this.saveCurrentBranch(branch);
            // Trigger branch change event
            window.dispatchEvent(new CustomEvent('branchChanged', { detail: branch }));
            return true;
        }
        return false;
    }

    // Get branch by ID
    getBranchById(branchId) {
        return this.branches.find(b => b.id === branchId);
    }

    // Check if viewing all branches
    isViewingAllBranches() {
        return this.currentBranch && this.currentBranch.code === 'ALL';
    }

    // Set view to all branches
    setViewAllBranches() {
        this.saveCurrentBranch({
            id: 'all',
            code: 'ALL',
            name: 'All Branches',
            isCentral: false
        });
        window.dispatchEvent(new CustomEvent('branchChanged', { detail: this.currentBranch }));
    }

    // Start real-time listener for branches
    startRealtimeListener() {
        if (!this.isFirebaseAvailable()) {
            console.warn('⚠️ Firebase not available, real-time updates disabled');
            return;
        }

        if (this.branchesListener) {
            console.log('🔄 Real-time listener already active');
            return;
        }

        console.log('👂 Starting real-time branch listener...');
        const branchesRef = collection(db, 'branches');
        const q = query(branchesRef, orderBy('createdAt', 'asc'));

        this.branchesListener = onSnapshot(q, (snapshot) => {
            console.log('🔔 Branch data changed, updating...');
            
            this.branches = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));

            console.log(`✅ Real-time update: ${this.branches.length} branches loaded`);
            
            // Notify all callbacks
            this.callbacks.forEach(callback => {
                try {
                    callback(this.branches);
                } catch (error) {
                    console.error('Error in branch update callback:', error);
                }
            });

            // Update branch selector if available
            if (window.populateBranchSelector) {
                window.populateBranchSelector();
            }

            // Dispatch custom event for other components
            window.dispatchEvent(new CustomEvent('branchesUpdated', { 
                detail: { branches: this.branches }
            }));

        }, (error) => {
            console.error('❌ Real-time listener error:', error);
        });

        console.log('✅ Real-time branch listener started');
    }

    // Stop real-time listener
    stopRealtimeListener() {
        if (this.branchesListener) {
            console.log('🔇 Stopping real-time branch listener...');
            this.branchesListener();
            this.branchesListener = null;
        }
    }

    // Add callback for real-time updates
    onBranchesUpdated(callback) {
        if (typeof callback === 'function') {
            this.callbacks.push(callback);
            console.log('✅ Added branch update callback');
        }
    }

    // Remove callback
    offBranchesUpdated(callback) {
        const index = this.callbacks.indexOf(callback);
        if (index > -1) {
            this.callbacks.splice(index, 1);
            console.log('✅ Removed branch update callback');
        }
    }

    // Get branch by ID (helper method for UI)
    getBranchById(branchId) {
        return this.branches.find(branch => branch.id === branchId);
    }
}

// Create and export singleton instance
const branchManager = new BranchManager();
export default branchManager;
