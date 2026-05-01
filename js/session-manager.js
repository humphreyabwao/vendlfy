// Session Manager - Real-time Role-Based Access Control
// Loads the current user's Firestore profile and exposes role/branch/permission helpers.
// Subscribes to live updates so that role/branch/status changes propagate instantly.

import {
    auth,
    db,
    isFirebaseConfigured,
    isRtdbConfigured,
    rtdb,
    signOut,
    onAuthStateChanged,
    doc,
    getDoc,
    onSnapshot,
    writeBatch,
    rtdbRef,
    rtdbGet,
    rtdbOnValue,
    rtdbOff
} from './firebase-config.js';
import { mirrorUserProfileToRtdb } from './storage-adapter.js';

class SessionManager {
    constructor() {
        this.user = null;          // Firebase Auth user
        this.profile = null;       // Firestore user document (or null / { _missing: true })
        this.profileUnsub = null;  // onSnapshot unsubscribe for /users/{uid}
        this.callbacks = [];
        this._initialized = false;
        this._readyResolvers = [];
        this._authResolved = false;
        this._rtdbProfileUnsub = null;
    }

    // Returns a promise that resolves once we have either:
    //  - a non-authenticated state, OR
    //  - an authenticated user with a loaded profile (or a known missing profile).
    ready() {
        if (this._initialized) return Promise.resolve(this.profile);
        return new Promise((resolve) => this._readyResolvers.push(resolve));
    }

    _markReady() {
        if (this._initialized) return;
        this._initialized = true;
        const value = this.profile;
        this._readyResolvers.forEach((r) => r(value));
        this._readyResolvers = [];
    }

    /** New sign-in cycle: allow ready() to block again until this session is resolved. */
    _resetReadyGate() {
        this._initialized = false;
    }

    /**
     * Instant RBAC from last session (dashboard writes currentUser on each profile load).
     * Avoids waiting for the first Firestore snapshot — removes long "empty data" spinners.
     */
    _profileFromLocalStorage(user) {
        try {
            const raw = localStorage.getItem('currentUser');
            if (!raw) return null;
            const c = JSON.parse(raw);
            if (!c || c.uid !== user.uid) return null;
            const branchIds = Array.isArray(c.branchIds) ? c.branchIds.filter(Boolean) : (c.branchId ? [c.branchId] : []);
            return {
                id: user.uid,
                uid: user.uid,
                email: c.email || user.email || '',
                fullName: c.name || c.displayName || c.fullName || '',
                role: c.role || 'viewer',
                branchIds,
                primaryBranchId: c.primaryBranchId || branchIds[0] || null,
                branchId: c.primaryBranchId || branchIds[0] || null,
                permissions: Array.isArray(c.permissions) ? c.permissions : [],
                status: 'active',
                phone: c.phone || '',
                _hydratedFromCache: true
            };
        } catch (e) {
            return null;
        }
    }

    // Attach to Firebase Auth and start listening for the user's profile in real time.
    init() {
        if (!isFirebaseConfigured) {
            console.warn('⚠️ Session manager: Firebase not configured');
            this._markReady();
            return;
        }

        onAuthStateChanged(auth, async (user) => {
            if (this.profileUnsub) {
                try { this.profileUnsub(); } catch (e) { /* ignore */ }
                this.profileUnsub = null;
            }
            if (this._rtdbProfileUnsub) {
                try { this._rtdbProfileUnsub(); } catch (e) { /* ignore */ }
                this._rtdbProfileUnsub = null;
            }

            // If a different user is now signed in, drop UI state from the previous session
            // (currentBranch / cached profile) so the new user starts from a clean slate.
            try {
                const cachedRaw = localStorage.getItem('currentUser');
                if (cachedRaw) {
                    const cached = JSON.parse(cachedRaw);
                    if (cached?.uid && (!user || cached.uid !== user.uid)) {
                        localStorage.removeItem('currentBranch');
                        localStorage.removeItem('currentUser');
                    }
                }
            } catch (e) { /* ignore */ }

            this.user = user;
            this.profile = null;
            this._resetReadyGate();

            if (!user) {
                this._authResolved = true;
                this._notify();
                this._markReady();
                return;
            }

            const profileRef = doc(db, 'users', user.uid);
            const cachedProfile = this._profileFromLocalStorage(user);

            if (cachedProfile) {
                this.profile = cachedProfile;
                this._notify();
                this._markReady();
            }

            (async () => {
                try {
                    const snap = await getDoc(profileRef);
                    if (!this.user || this.user.uid !== user.uid) return;

                    if (snap.exists()) {
                        const data = { id: snap.id, ...snap.data() };
                        await this._applyLiveProfile(user, data);
                    } else {
                        const fromRtdb = await this._loadProfileFromRtdb(user.uid);
                        if (fromRtdb) {
                            await this._applyLiveProfile(user, fromRtdb);
                            this._attachRtdbLiveProfile(user);
                        } else if (!cachedProfile) {
                            this.profile = { _missing: true, uid: user.uid, email: user.email };
                            console.warn('⚠️ No Firestore profile for current user');
                            this._notify();
                            this._markReady();
                        }
                    }
                } catch (err) {
                    if (!this.user || this.user.uid !== user.uid) return;
                    if (cachedProfile) {
                        console.warn('⚠️ Profile refresh failed (using cached session):', err?.message || err);
                        if (!this._initialized) this._markReady();
                    } else {
                        await this._hydrateProfileAfterFirestoreError(user, err);
                    }
                }

                if (!this.user || this.user.uid !== user.uid) return;

                this.profileUnsub = onSnapshot(
                    profileRef,
                    async (snap) => {
                        if (this._rtdbProfileUnsub) {
                            try { this._rtdbProfileUnsub(); } catch (e) { /* ignore */ }
                            this._rtdbProfileUnsub = null;
                        }

                        if (!snap.exists()) {
                            const fromRtdb = await this._loadProfileFromRtdb(user.uid);
                            if (fromRtdb) {
                                await this._applyLiveProfile(user, fromRtdb);
                                this._attachRtdbLiveProfile(user);
                                return;
                            }
                            this.profile = { _missing: true, uid: user.uid, email: user.email };
                            console.warn('⚠️ No Firestore profile for current user');
                            this._notify();
                            if (!this._initialized) this._markReady();
                            return;
                        }

                        const data = { id: snap.id, ...snap.data() };
                        await this._applyLiveProfile(user, data);
                    },
                    (error) => {
                        console.error('❌ Session profile listener error:', error);
                        void this._hydrateProfileAfterFirestoreError(user, error);
                    }
                );
            })();
        });
    }

    async _loadProfileFromRtdb(uid) {
        if (!isRtdbConfigured || !rtdb) return null;
        try {
            const snap = await rtdbGet(rtdbRef(rtdb, `users/${uid}`));
            const val = snap.val();
            if (val && typeof val === 'object' && (val.email || val.fullName || val.role)) {
                return { id: uid, ...val };
            }
        } catch (e) {
            console.warn('⚠️ Realtime Database profile read failed:', e?.message || e);
        }
        return null;
    }

    async _applyLiveProfile(user, data) {
        if (data.status && data.status !== 'active') {
            console.warn('🛑 Account is not active:', data.status);
            this.profile = data;
            this._notify();
            try { await signOut(auth); } catch (e) { /* ignore */ }
            try {
                window.location.href = 'index.html?error=disabled';
            } catch (e) { /* ignore */ }
            return;
        }

        this.profile = data;
        try {
            localStorage.setItem('currentUser', JSON.stringify({
                id: user.uid,
                uid: user.uid,
                email: data.email || user.email,
                name: data.fullName || user.displayName || (user.email || '').split('@')[0],
                displayName: data.fullName || user.displayName || (user.email || '').split('@')[0],
                role: data.role || 'viewer',
                branchIds: this._normalizeBranchIds(data),
                primaryBranchId: data.primaryBranchId || data.branchId || null,
                permissions: Array.isArray(data.permissions) ? data.permissions : []
            }));
        } catch (e) { /* ignore */ }

        this._notify();
        this._markReady();
    }

    async _hydrateProfileAfterFirestoreError(user, error) {
        const fromRtdb = await this._loadProfileFromRtdb(user.uid);
        if (fromRtdb) {
            await this._applyLiveProfile(user, fromRtdb);
            this._attachRtdbLiveProfile(user);
            return;
        }
        this.profile = {
            _missing: true,
            _error: error?.message || String(error),
            uid: user.uid,
            email: user.email
        };
        this._notify();
        this._markReady();
    }

    _attachRtdbLiveProfile(user) {
        if (this._rtdbProfileUnsub || !isRtdbConfigured || !rtdb) return;

        const r = rtdbRef(rtdb, `users/${user.uid}`);
        const handler = (snap) => {
            const val = snap.val();
            if (!val || typeof val !== 'object') return;
            const data = { id: user.uid, ...val };
            void this._applyLiveProfile(user, data);
        };

        rtdbOnValue(r, handler, (err) => {
            console.warn('RTDB profile stream error:', err?.message || err);
        });

        this._rtdbProfileUnsub = () => {
            try { rtdbOff(r, 'value', handler); } catch (e) { /* ignore */ }
        };
    }

    // Convert single legacy `branchId` or new `branchIds` array into a normalized list.
    _normalizeBranchIds(data) {
        if (Array.isArray(data.branchIds) && data.branchIds.length > 0) return data.branchIds.slice();
        if (data.branchId) return [data.branchId];
        return [];
    }

    // ---------- Public API ----------

    isSignedIn() { return !!this.user; }
    isProfileMissing() { return !!(this.profile && this.profile._missing); }
    isProfileLoaded() { return !!(this.profile && !this.profile._missing); }

    getUser() { return this.profile; }
    getAuthUser() { return this.user; }

    getRole() { return this.profile?.role || null; }
    isAdmin() { return this.getRole() === 'admin'; }
    isManager() { return this.getRole() === 'manager'; }
    isCashier() { return this.getRole() === 'cashier'; }
    isViewer() { return this.getRole() === 'viewer'; }
    isActive() { return this.profile?.status === 'active'; }

    getAllowedBranchIds() {
        if (!this.profile || this.profile._missing) return [];
        if (this.isAdmin()) return null; // null = no restriction (all branches)
        return this._normalizeBranchIds(this.profile);
    }

    canAccessAllBranches() {
        return this.isAdmin();
    }

    canAccessBranch(branchId) {
        if (this.canAccessAllBranches()) return true;
        const ids = this.getAllowedBranchIds();
        if (!ids) return true;
        return ids.includes(branchId);
    }

    hasPermission(perm) {
        if (!perm) return true;
        if (this.isAdmin()) return true;
        const list = Array.isArray(this.profile?.permissions) ? this.profile.permissions : [];
        return list.includes(perm);
    }

    /**
     * Stable signature of the caller's RBAC state. Changes only when
     * role / status / branchIds / permissions change — so other profile
     * updates (e.g. lastActive) don't trigger redundant UI re-gating.
     */
    getPermissionsSignature() {
        if (!this.profile || this.profile._missing) return 'none';
        const role = this.profile.role || 'viewer';
        const status = this.profile.status || 'active';
        const branchIds = Array.isArray(this.profile.branchIds) ? [...this.profile.branchIds].sort() : [];
        const perms = Array.isArray(this.profile.permissions) ? [...this.profile.permissions].sort() : [];
        return `${role}|${status}|${branchIds.join(',')}|${perms.join(',')}`;
    }

    hasAnyPermission(perms) {
        if (!Array.isArray(perms) || perms.length === 0) return true;
        return perms.some((p) => this.hasPermission(p));
    }

    hasAllPermissions(perms) {
        if (!Array.isArray(perms) || perms.length === 0) return true;
        return perms.every((p) => this.hasPermission(p));
    }

    // Subscribe to session changes (called whenever profile/role/branch/permissions change).
    onChange(cb) {
        if (typeof cb === 'function') this.callbacks.push(cb);
        return () => {
            const idx = this.callbacks.indexOf(cb);
            if (idx >= 0) this.callbacks.splice(idx, 1);
        };
    }

    _notify() {
        this.callbacks.forEach((cb) => {
            try { cb(this.profile); } catch (e) { console.error('session callback error', e); }
        });
        try {
            window.dispatchEvent(new CustomEvent('sessionChanged', { detail: this.profile }));
        } catch (e) { /* ignore */ }
    }

    // ---------- Bootstrap-first-admin ----------
    // Allowed only when /system/config doc does not exist yet. Atomically creates the
    // user's profile as admin and the bootstrap marker so this path closes forever.
    async bootstrapFirstAdmin({ fullName } = {}) {
        if (!this.user) throw new Error('Not signed in');
        const systemRef = doc(db, 'system', 'config');
        const systemSnap = await getDoc(systemRef);
        if (systemSnap.exists()) {
            throw new Error('System has already been bootstrapped. Contact your administrator to be added.');
        }

        const userRef = doc(db, 'users', this.user.uid);
        const profile = {
            uid: this.user.uid,
            email: this.user.email,
            fullName: fullName || this.user.displayName || (this.user.email || '').split('@')[0],
            role: 'admin',
            branchIds: [],
            primaryBranchId: null,
            branchId: null,
            permissions: [],
            phone: '',
            status: 'active',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            createdBy: this.user.uid
        };

        const batch = writeBatch(db);
        batch.set(userRef, profile);
        batch.set(systemRef, {
            bootstrapped: true,
            bootstrappedBy: this.user.uid,
            bootstrappedByEmail: this.user.email,
            bootstrappedAt: new Date().toISOString()
        });
        await batch.commit();
        try {
            await mirrorUserProfileToRtdb(this.user.uid, profile);
        } catch (e) {
            console.warn('⚠️ Could not mirror bootstrap admin profile to Realtime Database:', e?.message || e);
        }
        console.log('✅ First admin bootstrapped:', this.user.email);
        return profile;
    }
}

const sessionManager = new SessionManager();

// Expose globally for legacy code paths that don't use ES modules.
if (typeof window !== 'undefined') {
    window.sessionManager = sessionManager;
}

export default sessionManager;
