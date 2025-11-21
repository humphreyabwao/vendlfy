// User Management System
import { db, auth, collection, addDoc, getDocs, doc, updateDoc, deleteDoc, query, where, orderBy, onSnapshot, createUserWithEmailAndPassword, isFirebaseConfigured } from './firebase-config.js';
import branchManager from './branch-manager.js';
import auditLogger from './audit-logger.js';

class UserManager {
    constructor() {
        this.users = [];
        this.usersListener = null;
        this.callbacks = [];
    }

    // Check if Firebase is available
    isFirebaseAvailable() {
        return isFirebaseConfigured && db !== undefined;
    }

    // Start real-time listener for users
    startRealtimeListener() {
        if (!this.isFirebaseAvailable()) {
            console.warn('⚠️ Firebase not available, real-time updates disabled');
            return;
        }

        if (this.usersListener) {
            console.log('🔄 Real-time user listener already active');
            return;
        }

        console.log('👂 Starting real-time user listener...');
        const usersRef = collection(db, 'users');
        const q = query(usersRef, orderBy('createdAt', 'desc'));

        this.usersListener = onSnapshot(q, (snapshot) => {
            console.log('🔔 User data changed, updating...');
            
            this.users = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));

            console.log(`✅ Real-time update: ${this.users.length} users loaded`);
            
            // Notify all callbacks
            this.callbacks.forEach(callback => {
                try {
                    callback(this.users);
                } catch (error) {
                    console.error('Error in user update callback:', error);
                }
            });

            // Dispatch custom event
            window.dispatchEvent(new CustomEvent('usersUpdated', { 
                detail: { users: this.users }
            }));

        }, (error) => {
            console.error('❌ Real-time user listener error:', error);
        });

        console.log('✅ Real-time user listener started');
    }

    // Stop real-time listener
    stopRealtimeListener() {
        if (this.usersListener) {
            console.log('🔇 Stopping real-time user listener...');
            this.usersListener();
            this.usersListener = null;
        }
    }

    // Add callback for real-time updates
    onUsersUpdated(callback) {
        if (typeof callback === 'function') {
            this.callbacks.push(callback);
            console.log('✅ Added user update callback');
        }
    }

    // Load users from Firestore
    async loadUsers() {
        try {
            if (this.isFirebaseAvailable()) {
                console.log('🔄 Loading users from Firestore...');
                const usersRef = collection(db, 'users');
                const q = query(usersRef, orderBy('createdAt', 'desc'));
                const snapshot = await getDocs(q);
                
                this.users = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }));
                console.log(`✅ Loaded ${this.users.length} users from Firestore`);
            } else {
                // Fallback to localStorage
                const localUsers = localStorage.getItem('vendify_users');
                this.users = localUsers ? JSON.parse(localUsers) : [];
                console.log(`📦 Loaded ${this.users.length} users from local storage`);
            }
            
            return this.users;
        } catch (error) {
            console.error('❌ Error loading users:', error);
            return [];
        }
    }

    // Create new user
    async createUser(userData) {
        try {
            console.log('👤 Creating new user...', userData.email);

            // Create user in Firebase Auth first
            if (this.isFirebaseAvailable()) {
                const userCredential = await createUserWithEmailAndPassword(auth, userData.email, userData.password);
                const authUser = userCredential.user;
                
                console.log('✅ User created in Firebase Auth:', authUser.uid);

                // Create user profile in Firestore
                const userProfile = {
                    uid: authUser.uid,
                    email: userData.email,
                    fullName: userData.fullName,
                    role: userData.role,
                    branchId: userData.branchId || null,
                    phone: userData.phone || '',
                    status: userData.status || 'active',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    createdBy: auth.currentUser?.uid || 'system'
                };

                const usersRef = collection(db, 'users');
                const docRef = await addDoc(usersRef, userProfile);
                
                console.log('✅ User profile saved to Firestore with ID:', docRef.id);
                
                // Log activity
                if (window.activityTracker) {
                    window.activityTracker.logActivity('user', 'created', {
                        userName: userData.fullName,
                        email: userData.email,
                        role: userData.role
                    });
                }
                
                await this.loadUsers();
                
                // Log user creation to audit trail
                await auditLogger.logUserManagement('CREATE_USER', {
                    fullName: userProfile.fullName,
                    email: userProfile.email,
                    role: userProfile.role
                });
                
                return { id: docRef.id, ...userProfile };
            } else {
                // Fallback to localStorage
                const localUser = {
                    id: 'local_' + Date.now(),
                    ...userData,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };

                this.users.push(localUser);
                localStorage.setItem('vendify_users', JSON.stringify(this.users));
                console.log('📦 User saved to local storage:', localUser.id);
                return localUser;
            }

        } catch (error) {
            console.error('❌ Error creating user:', error);
            throw new Error(`Failed to create user: ${error.message}`);
        }
    }

    // Update user
    async updateUser(userId, updates) {
        try {
            updates.updatedAt = new Date().toISOString();

            if (this.isFirebaseAvailable()) {
                console.log('💾 Updating user in Firestore:', userId);
                const userRef = doc(db, 'users', userId);
                await updateDoc(userRef, updates);
                console.log('✅ User updated in Firestore');
                
                await this.loadUsers();
                
                // Log user update to audit trail
                const user = this.getUserById(userId);
                if (user) {
                    await auditLogger.logUserManagement('UPDATE_USER', {
                        fullName: user.fullName,
                        email: user.email,
                        role: user.role
                    });
                }
            } else {
                // Update in localStorage
                const userIndex = this.users.findIndex(user => user.id === userId);
                if (userIndex !== -1) {
                    this.users[userIndex] = { ...this.users[userIndex], ...updates };
                    localStorage.setItem('vendify_users', JSON.stringify(this.users));
                    console.log('📦 User updated in local storage');
                }
            }

            return true;
        } catch (error) {
            console.error('❌ Error updating user:', error);
            throw new Error(`Failed to update user: ${error.message}`);
        }
    }

    // Delete user
    async deleteUser(userId) {
        try {
            // Get user data before deletion for audit log
            const user = this.getUserById(userId);
            
            if (this.isFirebaseAvailable()) {
                console.log('🗑️ Deleting user from Firestore:', userId);
                const userRef = doc(db, 'users', userId);
                await deleteDoc(userRef);
                console.log('✅ User deleted from Firestore');
                
                await this.loadUsers();
            } else {
                // Delete from localStorage
                this.users = this.users.filter(user => user.id !== userId);
                localStorage.setItem('vendify_users', JSON.stringify(this.users));
                console.log('📦 User deleted from local storage');
            }
            
            // Log user deletion to audit trail
            if (user) {
                await auditLogger.logUserManagement('DELETE_USER', {
                    fullName: user.fullName,
                    email: user.email,
                    role: user.role
                });
            }

            return true;
        } catch (error) {
            console.error('❌ Error deleting user:', error);
            throw new Error(`Failed to delete user: ${error.message}`);
        }
    }

    // Update user activity (lastActive timestamp)
    async updateUserActivity(userId) {
        try {
            const updates = {
                lastActive: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            if (this.isFirebaseAvailable()) {
                const userRef = doc(db, 'users', userId);
                await updateDoc(userRef, updates);
                
                // Update local cache
                const userIndex = this.users.findIndex(u => u.id === userId);
                if (userIndex !== -1) {
                    this.users[userIndex] = { ...this.users[userIndex], ...updates };
                }
            } else {
                // Update in localStorage
                const userIndex = this.users.findIndex(user => user.id === userId);
                if (userIndex !== -1) {
                    this.users[userIndex] = { ...this.users[userIndex], ...updates };
                    localStorage.setItem('vendify_users', JSON.stringify(this.users));
                }
            }

            return true;
        } catch (error) {
            console.error('❌ Error updating user activity:', error);
            return false;
        }
    }

    // Check if user is online (active in last 5 minutes)
    isUserOnline(user) {
        if (!user || !user.lastActive) return false;
        
        const lastActiveTime = new Date(user.lastActive).getTime();
        const currentTime = Date.now();
        const fiveMinutes = 5 * 60 * 1000; // 5 minutes in milliseconds
        
        return (currentTime - lastActiveTime) < fiveMinutes;
    }

    // Get time since last active
    getLastSeenText(user) {
        if (!user || !user.lastActive) return 'Never';
        
        const lastActiveTime = new Date(user.lastActive).getTime();
        const currentTime = Date.now();
        const diffMs = currentTime - lastActiveTime;
        
        const diffMinutes = Math.floor(diffMs / (1000 * 60));
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        
        if (diffMinutes < 1) return 'Just now';
        if (diffMinutes < 5) return 'Online';
        if (diffMinutes < 60) return `${diffMinutes} min ago`;
        if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
        return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    }

    // Get all users
    getAllUsers() {
        return this.users;
    }

    // Get user by ID
    getUserById(userId) {
        return this.users.find(user => user.id === userId);
    }

    // Get users by role
    getUsersByRole(role) {
        return this.users.filter(user => user.role === role);
    }

    // Get users by branch
    getUsersByBranch(branchId) {
        return this.users.filter(user => user.branchId === branchId || !user.branchId);
    }

    // Get active users
    getActiveUsers() {
        return this.users.filter(user => user.status === 'active');
    }
}

// Create and export singleton instance
const userManager = new UserManager();
export default userManager;