// User Management System — production RBAC version
// Uses a secondary Firebase App to create Auth users without signing out the admin.
// Stores user documents at /users/{uid} (not random ID) for clean Firestore rules.

import {
    db, auth, isFirebaseConfigured, isRtdbConfigured, firebaseConfig,
    collection, query, orderBy,
    createUserWithEmailAndPassword,
    initializeApp, getAuth, getApps
} from './firebase-config.js';
import {
    readMerged,
    streamDual,
    saveUserProfileDuplex,
    updateUserProfileDuplex,
    deleteUserProfileDuplex
} from './storage-adapter.js';
import auditLogger from './audit-logger.js';

const USER_IO_TIMEOUT_MS = 15000;
/** Create-user profile write: keep tight so the form returns quickly while FS+RTDB still race in parallel. */
const CREATE_USER_PROFILE_TIMEOUT_MS = 8000;

const CREATE_USER_SECONDARY_APP_NAME = 'vendify-create-user-secondary';

function _getCreateUserSecondaryAuth() {
    const apps = getApps();
    const existing = apps.find((a) => a.name === CREATE_USER_SECONDARY_APP_NAME);
    if (existing) return getAuth(existing);
    return getAuth(initializeApp(firebaseConfig, CREATE_USER_SECONDARY_APP_NAME));
}

class UserManager {
    constructor() {
        this.users = [];
        this.usersListener = null;
        this.callbacks = [];
    }

    isFirebaseAvailable() {
        return isFirebaseConfigured && db !== undefined;
    }

    // ---------- Real-time listener ----------

    startRealtimeListener() {
        if (this.usersListener) return;

        if (!this.isFirebaseAvailable() && !isRtdbConfigured) {
            console.warn('⚠️ Firestore and Realtime Database unavailable; user list live updates disabled');
            return;
        }

        const q = this.isFirebaseAvailable()
            ? query(collection(db, 'users'), orderBy('createdAt', 'desc'))
            : null;

        this.usersListener = streamDual({
            firestoreQuery: q,
            rtdbPath: isRtdbConfigured ? 'users' : null,
            rtdbFilter: () => true,
            onUpdate: (list) => {
                const sorted = [...list].sort((a, b) => {
                    const ta = new Date(a.createdAt || 0).getTime();
                    const tb = new Date(b.createdAt || 0).getTime();
                    return tb - ta;
                });
                this.users = sorted;
                this.callbacks.forEach((cb) => {
                    try { cb(this.users); } catch (e) { /* ignore */ }
                });
                window.dispatchEvent(new CustomEvent('usersUpdated', { detail: { users: this.users } }));
            },
            onError: (err, src) => {
                console.error(`❌ Users stream error (${src}):`, err?.message || err);
            }
        });
    }

    stopRealtimeListener() {
        if (this.usersListener) { this.usersListener(); this.usersListener = null; }
    }

    onUsersUpdated(cb) {
        if (typeof cb === 'function') this.callbacks.push(cb);
    }

    // ---------- CRUD ----------

    async loadUsers() {
        try {
            if (this.isFirebaseAvailable() || isRtdbConfigured) {
                const firestoreQuery = this.isFirebaseAvailable()
                    ? query(collection(db, 'users'), orderBy('createdAt', 'desc'))
                    : null;
                const merged = await readMerged({
                    firestoreQuery,
                    rtdbPath: isRtdbConfigured ? 'users' : null,
                    timeoutMs: USER_IO_TIMEOUT_MS
                });
                merged.sort((a, b) => {
                    const ta = new Date(a.createdAt || 0).getTime();
                    const tb = new Date(b.createdAt || 0).getTime();
                    return tb - ta;
                });
                this.users = merged;
            } else {
                const local = localStorage.getItem('vendify_users');
                this.users = local ? JSON.parse(local) : [];
            }
            return this.users;
        } catch (error) {
            console.error('❌ Error loading users:', error);
            return [];
        }
    }

    // Normalize branch data: accepts branchIds (array), branchId (string), or ""/"all" (no restriction).
    _buildBranchData(userData) {
        let branchIds = [];
        if (Array.isArray(userData.branchIds) && userData.branchIds.length > 0) {
            branchIds = userData.branchIds.filter(Boolean);
        } else if (userData.branchId && userData.branchId !== 'all') {
            branchIds = [userData.branchId];
        }
        return {
            branchIds,
            primaryBranchId: branchIds[0] || null,
            branchId: branchIds[0] || null // legacy compat
        };
    }

    async createUser(userData) {
        if (!this.isFirebaseAvailable()) {
            return this._createUserLocally(userData);
        }

        try {
            const secondaryAuth = _getCreateUserSecondaryAuth();

            const credential = await createUserWithEmailAndPassword(
                secondaryAuth, userData.email, userData.password
            );
            const uid = credential.user.uid;

            void secondaryAuth.signOut().catch(() => {});

            const branchData = this._buildBranchData(userData);
            const permissions = Array.isArray(userData.permissions) ? userData.permissions : [];

            const profile = {
                uid,
                email: userData.email,
                fullName: userData.fullName,
                role: userData.role,
                permissions,
                ...branchData,
                phone: userData.phone || '',
                status: userData.status || 'active',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                createdBy: auth.currentUser?.uid || 'system'
            };

            await saveUserProfileDuplex(uid, profile, { timeoutMs: CREATE_USER_PROFILE_TIMEOUT_MS });

            const result = { id: uid, ...profile };

            // Audit / activity / full reload hit Firestore (and IP lookup) — defer so the UI unblocks immediately.
            const self = this;
            queueMicrotask(() => {
                void (async () => {
                    try {
                        if (window.activityTracker) {
                            await window.activityTracker.logActivity('user', 'created', {
                                userName: userData.fullName,
                                email: userData.email,
                                role: userData.role
                            });
                        }
                    } catch (e) { /* ignore */ }
                    try {
                        await auditLogger.logUserManagement('CREATE_USER', {
                            fullName: profile.fullName,
                            email: profile.email,
                            role: profile.role
                        });
                    } catch (e) { /* ignore */ }
                    try {
                        await self.loadUsers();
                    } catch (e) { /* ignore */ }
                })();
            });

            return result;
        } catch (error) {
            console.error('❌ Error creating user:', error);
            throw new Error(`Failed to create user: ${error.message}`);
        }
    }

    _createUserLocally(userData) {
        const local = {
            id: 'local_' + Date.now(),
            uid: 'local_' + Date.now(),
            ...userData,
            ...this._buildBranchData(userData),
            permissions: Array.isArray(userData.permissions) ? userData.permissions : [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        this.users.push(local);
        localStorage.setItem('vendify_users', JSON.stringify(this.users));
        return local;
    }

    async updateUser(userId, updates) {
        try {
            updates.updatedAt = new Date().toISOString();
            // Normalize branch data in updates
            const branchUpdate = this._buildBranchData(updates);
            Object.assign(updates, branchUpdate);

            if (this.isFirebaseAvailable() || isRtdbConfigured) {
                await updateUserProfileDuplex(userId, updates, { timeoutMs: USER_IO_TIMEOUT_MS });
                const self = this;
                queueMicrotask(() => {
                    void (async () => {
                        try {
                            await self.loadUsers();
                        } catch (e) { /* ignore */ }
                        try {
                            const user = self.getUserById(userId);
                            if (user) {
                                await auditLogger.logUserManagement('UPDATE_USER', {
                                    fullName: user.fullName,
                                    email: user.email,
                                    role: user.role
                                });
                            }
                        } catch (e) { /* ignore */ }
                    })();
                });
            } else {
                const idx = this.users.findIndex((u) => u.id === userId);
                if (idx !== -1) {
                    this.users[idx] = { ...this.users[idx], ...updates };
                    localStorage.setItem('vendify_users', JSON.stringify(this.users));
                }
            }
            return true;
        } catch (error) {
            console.error('❌ Error updating user:', error);
            throw new Error(`Failed to update user: ${error.message}`);
        }
    }

    async deleteUser(userId) {
        try {
            const user = this.getUserById(userId);
            if (this.isFirebaseAvailable() || isRtdbConfigured) {
                await deleteUserProfileDuplex(userId, { timeoutMs: USER_IO_TIMEOUT_MS });
                await this.loadUsers();
            } else {
                this.users = this.users.filter((u) => u.id !== userId);
                localStorage.setItem('vendify_users', JSON.stringify(this.users));
            }
            if (user) {
                await auditLogger.logUserManagement('DELETE_USER', {
                    fullName: user.fullName, email: user.email, role: user.role
                });
            }
            return true;
        } catch (error) {
            console.error('❌ Error deleting user:', error);
            throw new Error(`Failed to delete user: ${error.message}`);
        }
    }

    async updateUserActivity(userId) {
        try {
            const updates = { lastActive: new Date().toISOString(), updatedAt: new Date().toISOString() };
            if (this.isFirebaseAvailable() || isRtdbConfigured) {
                await updateUserProfileDuplex(userId, updates, { timeoutMs: USER_IO_TIMEOUT_MS });
                const idx = this.users.findIndex((u) => u.id === userId);
                if (idx !== -1) this.users[idx] = { ...this.users[idx], ...updates };
            } else {
                const idx = this.users.findIndex((u) => u.id === userId);
                if (idx !== -1) {
                    this.users[idx] = { ...this.users[idx], ...updates };
                    localStorage.setItem('vendify_users', JSON.stringify(this.users));
                }
            }
            return true;
        } catch (error) {
            return false;
        }
    }

    // ---------- Getters ----------

    isUserOnline(user) {
        if (!user?.lastActive) return false;
        return (Date.now() - new Date(user.lastActive).getTime()) < 5 * 60 * 1000;
    }

    getLastSeenText(user) {
        if (!user?.lastActive) return 'Never';
        const diffMs = Date.now() - new Date(user.lastActive).getTime();
        const min = Math.floor(diffMs / 60000);
        const hr = Math.floor(diffMs / 3600000);
        const day = Math.floor(diffMs / 86400000);
        if (min < 1) return 'Just now';
        if (min < 5) return 'Online';
        if (min < 60) return `${min} min ago`;
        if (hr < 24) return `${hr} hour${hr > 1 ? 's' : ''} ago`;
        return `${day} day${day > 1 ? 's' : ''} ago`;
    }

    getAllUsers() { return this.users; }
    getUserById(userId) { return this.users.find((u) => u.id === userId || u.uid === userId); }
    getUserByEmail(email) { return this.users.find((u) => u.email === email); }
    getUsersByRole(role) { return this.users.filter((u) => u.role === role); }
    getUsersByBranch(branchId) {
        return this.users.filter((u) => {
            const ids = Array.isArray(u.branchIds) ? u.branchIds : (u.branchId ? [u.branchId] : []);
            return ids.length === 0 || ids.includes(branchId);
        });
    }
    getActiveUsers() { return this.users.filter((u) => u.status === 'active'); }
}

const userManager = new UserManager();
export default userManager;
