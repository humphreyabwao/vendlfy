// Activity Tracker - real-time activity stream backed by Firestore /activities
// All modules call activityTracker.logActivity(...). The tracker keeps a live
// in-memory cache of the most recent activities (via onSnapshot) so the
// dashboard, activity log page and any other UI stay in sync instantly.

import {
    db, isFirebaseConfigured,
    collection, addDoc,
    query, orderBy, limit,
    onSnapshot
} from './firebase-config.js';
import branchManager from './branch-manager.js';
import sessionManager from './session-manager.js';

const STREAM_LIMIT = 500;          // how many recent activities to keep in memory
const LOCAL_KEY    = 'vendlfy_activities';

class ActivityTracker {
    constructor() {
        this.activities = [];                 // newest first, capped at STREAM_LIMIT
        this.useLocalStorage = !isFirebaseConfigured;
        this._streamUnsub = null;
        this._streamStarted = false;
        this._changeCallbacks = [];           // (activities, change) => void
        this._newCallbacks = [];              // (activity) => void  (single new activity)
        this._initialLoaded = false;

        if (this.useLocalStorage) this._loadLocal();
    }

    // ---------- Lifecycle ----------

    start() {
        if (this._streamStarted) return;
        this._streamStarted = true;

        if (this.useLocalStorage) {
            this._initialLoaded = true;
            this._emitChange({ type: 'initial' });
            return;
        }

        try {
            const q = query(
                collection(db, 'activities'),
                orderBy('timestamp', 'desc'),
                limit(STREAM_LIMIT)
            );

            this._streamUnsub = onSnapshot(
                q,
                (snap) => {
                    const list = [];
                    snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
                    this.activities = list;

                    // Detect newly-added (not just initial load) so we can fire spotlight notifications
                    const isInitial = !this._initialLoaded;
                    this._initialLoaded = true;

                    if (!isInitial) {
                        snap.docChanges().forEach((change) => {
                            if (change.type === 'added') {
                                const activity = { id: change.doc.id, ...change.doc.data() };
                                this._newCallbacks.forEach((cb) => {
                                    try { cb(activity); } catch (e) { /* ignore */ }
                                });
                            }
                        });
                    }

                    this._emitChange({ type: isInitial ? 'initial' : 'snapshot' });
                },
                (err) => {
                    console.warn('Activity stream error:', err.message);
                }
            );
        } catch (err) {
            console.error('Failed to start activity stream:', err);
        }
    }

    stop() {
        if (this._streamUnsub) {
            try { this._streamUnsub(); } catch (e) { /* ignore */ }
            this._streamUnsub = null;
        }
        this._streamStarted = false;
        this._initialLoaded = false;
    }

    // ---------- Local cache (offline / no-firebase fallback) ----------

    _loadLocal() {
        try {
            const data = localStorage.getItem(LOCAL_KEY);
            if (data) this.activities = JSON.parse(data);
        } catch (e) { /* ignore */ }
    }

    _saveLocal() {
        try { localStorage.setItem(LOCAL_KEY, JSON.stringify(this.activities.slice(0, STREAM_LIMIT))); } catch (e) { /* ignore */ }
    }

    // ---------- Logging ----------

    async logActivity(type, action, details = {}, metadata = {}) {
        const currentBranch = branchManager.getCurrentBranch();
        const user = this.getCurrentUser();

        const activity = {
            type,
            action,
            details,
            metadata,
            branchId:   currentBranch ? currentBranch.id : null,
            branchName: currentBranch ? currentBranch.name : null,
            userId:     user.id,
            userName:   user.name,
            userEmail:  user.email || null,
            timestamp:  new Date().toISOString()
        };

        try {
            if (this.useLocalStorage) {
                activity.id = this._generateId();
                this.activities.unshift(activity);
                if (this.activities.length > STREAM_LIMIT) this.activities.length = STREAM_LIMIT;
                this._saveLocal();
                this._newCallbacks.forEach((cb) => { try { cb(activity); } catch (e) { /* ignore */ } });
                this._emitChange({ type: 'local-add' });
            } else {
                const docRef = await addDoc(collection(db, 'activities'), activity);
                activity.id = docRef.id;
                // Stream will pick it up automatically via onSnapshot — no manual notify needed.
            }
            return activity;
        } catch (error) {
            console.error('Failed to log activity:', error);
            return null;
        }
    }

    // Reads the *real* signed-in user from sessionManager. Falls back gracefully.
    getCurrentUser() {
        try {
            const profile = sessionManager.getUser?.();
            const auth    = sessionManager.getAuthUser?.();
            if (profile && !profile._missing) {
                return {
                    id:    profile.uid || auth?.uid || profile.id || 'unknown',
                    name:  profile.fullName || profile.name || profile.email || auth?.email || 'Unknown User',
                    email: profile.email || auth?.email || null
                };
            }
            if (auth) {
                return { id: auth.uid, name: auth.email || 'Unknown User', email: auth.email };
            }
        } catch (e) { /* ignore */ }
        return { id: 'system', name: 'System', email: null };
    }

    _generateId() {
        return 'act_' + Date.now() + '_' + Math.random().toString(36).slice(2, 11);
    }

    // ---------- Reading & filtering ----------

    // Returns a filtered, sorted, branch-scoped slice of the in-memory cache.
    // This is *synchronous* now — kept async-shaped for backwards compatibility.
    async getActivities(filters = {}) {
        if (!this._streamStarted) this.start();

        let list = this.activities.slice();

        // Branch scoping: non-admins only see their assigned branches.
        // Admins see the active branch (or all branches if "all" is selected).
        const allowed = sessionManager.getAllowedBranchIds?.();
        const currentBranch = branchManager.getCurrentBranch?.();
        const viewingAll = branchManager.isViewingAllBranches?.();

        if (Array.isArray(allowed)) {
            // Non-admin: hard filter to their branch list
            list = list.filter((a) => !a.branchId || allowed.includes(a.branchId));
        } else if (!viewingAll && currentBranch) {
            // Admin viewing a specific branch
            list = list.filter((a) => !a.branchId || a.branchId === currentBranch.id);
        }

        // Type
        if (filters.type && filters.type !== 'all') {
            list = list.filter((a) => a.type === filters.type);
        }

        // Date
        if (filters.date) list = this.filterByDate(list, filters.date);

        // Search
        if (filters.search) {
            const s = String(filters.search).toLowerCase();
            list = list.filter((a) => {
                if (a.action?.toLowerCase().includes(s)) return true;
                if (a.type?.toLowerCase().includes(s)) return true;
                if (a.userName?.toLowerCase().includes(s)) return true;
                if (this.getActivityDescription(a).toLowerCase().includes(s)) return true;
                return false;
            });
        }

        if (filters.limit) list = list.slice(0, filters.limit);
        return list;
    }

    filterByDate(activities, dateFilter) {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        return activities.filter((activity) => {
            const t = new Date(activity.timestamp);
            switch (dateFilter) {
                case 'today':
                    return t >= today;
                case 'yesterday': {
                    const y = new Date(today); y.setDate(y.getDate() - 1);
                    return t >= y && t < today;
                }
                case 'week': {
                    const w = new Date(today); w.setDate(w.getDate() - 7);
                    return t >= w;
                }
                case 'month': {
                    const m = new Date(today); m.setDate(m.getDate() - 30);
                    return t >= m;
                }
                case 'all':
                default:
                    return true;
            }
        });
    }

    // ---------- Subscriptions ----------

    // Fired whenever the underlying activity list changes (initial load, snapshot update, local add)
    onChange(cb) {
        if (typeof cb === 'function') this._changeCallbacks.push(cb);
        return () => {
            const i = this._changeCallbacks.indexOf(cb);
            if (i >= 0) this._changeCallbacks.splice(i, 1);
        };
    }

    _emitChange(change) {
        this._changeCallbacks.forEach((cb) => {
            try { cb(this.activities, change); } catch (e) { /* ignore */ }
        });
    }

    // Legacy: keep for back-compat (modules calling addListener / startRealtimeListener)
    addListener(cb) {
        if (typeof cb === 'function') this._newCallbacks.push(cb);
    }
    startRealtimeListener(cb) {
        this.start();
        if (typeof cb === 'function') this._newCallbacks.push(cb);
        return () => {
            const i = this._newCallbacks.indexOf(cb);
            if (i >= 0) this._newCallbacks.splice(i, 1);
        };
    }

    // ---------- Stats ----------

    async getActivityStats(dateFilter = 'today') {
        const list = await this.getActivities({ date: dateFilter });
        const stats = { total: list.length, byType: {}, byUser: {}, mostActive: null };
        list.forEach((a) => {
            stats.byType[a.type]      = (stats.byType[a.type]      || 0) + 1;
            stats.byUser[a.userName]  = (stats.byUser[a.userName]  || 0) + 1;
        });
        if (Object.keys(stats.byType).length > 0) {
            stats.mostActive = Object.keys(stats.byType).reduce((a, b) =>
                stats.byType[a] > stats.byType[b] ? a : b
            );
        }
        return stats;
    }

    // ---------- Display helpers ----------

    formatActivity(activity) {
        return {
            ...activity,
            icon:        this.getActivityIcon(activity.type),
            color:       this.getActivityColor(activity.type),
            timeAgo:     this.getTimeAgo(activity.timestamp),
            description: this.getActivityDescription(activity)
        };
    }

    getActivityIcon(type) {
        const icons = {
            inventory: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path></svg>',
            sale:      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg>',
            b2b:       '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>',
            order:     '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>',
            customer:  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>',
            expense:   '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>',
            user:      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>',
            supplier:  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>',
            auth:      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>',
            branch:    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path></svg>'
        };
        return icons[type] || icons.inventory;
    }

    getActivityColor(type) {
        const colors = {
            inventory: 'blue',
            sale:      'green',
            b2b:       'purple',
            order:     'orange',
            customer:  'teal',
            expense:   'red',
            user:      'gray',
            supplier:  'indigo',
            auth:      'slate',
            branch:    'amber'
        };
        return colors[type] || 'blue';
    }

    getActivityDescription(activity) {
        const { type, action, details = {} } = activity;
        const safe = (v, f = 'Unknown') => (v == null || v === '' ? f : v);

        switch (type) {
            case 'inventory':
                if (action === 'added')   return `Added new item: <strong>${safe(details.itemName)}</strong>`;
                if (action === 'updated') return `Updated item: <strong>${safe(details.itemName)}</strong>`;
                if (action === 'deleted') return `Deleted item: <strong>${safe(details.itemName)}</strong>`;
                if (action === 'imported') return `Imported <strong>${safe(details.count, 0)}</strong> inventory items`;
                break;
            case 'sale':
                if (action === 'completed') return `Completed sale of <strong>${details.currency || 'KES'} ${safe(details.amount, 0)}</strong>`;
                if (action === 'refunded')  return `Refunded sale <strong>#${safe(details.saleNumber)}</strong>`;
                break;
            case 'b2b':
                if (action === 'created')  return `Created B2B sale for <strong>${safe(details.customerName)}</strong>`;
                if (action === 'paid')     return `Recorded payment on B2B sale <strong>#${safe(details.saleNumber)}</strong>`;
                break;
            case 'order':
                if (action === 'created')   return `Created purchase order from <strong>${safe(details.supplierName)}</strong>`;
                if (action === 'received')  return `Received order from <strong>${safe(details.supplierName)}</strong>`;
                if (action === 'cancelled') return `Cancelled order <strong>#${safe(details.orderNumber)}</strong>`;
                break;
            case 'customer':
                if (action === 'added')   return `Added new customer: <strong>${safe(details.customerName)}</strong>`;
                if (action === 'updated') return `Updated customer: <strong>${safe(details.customerName)}</strong>`;
                if (action === 'deleted') return `Deleted customer: <strong>${safe(details.customerName)}</strong>`;
                break;
            case 'expense':
                if (action === 'recorded') return `Recorded expense: <strong>${safe(details.category)}</strong> - ${details.currency || 'KES'} ${safe(details.amount, 0)}`;
                break;
            case 'user':
                if (action === 'created') return `Created new user: <strong>${safe(details.userName)}</strong>`;
                if (action === 'updated') return `Updated user: <strong>${safe(details.userName)}</strong>`;
                if (action === 'deleted') return `Deleted user: <strong>${safe(details.userName)}</strong>`;
                break;
            case 'supplier':
                if (action === 'added')   return `Added new supplier: <strong>${safe(details.supplierName)}</strong>`;
                if (action === 'updated') return `Updated supplier: <strong>${safe(details.supplierName)}</strong>`;
                break;
            case 'auth':
                if (action === 'login')  return `Signed in`;
                if (action === 'logout') return `Signed out`;
                break;
            case 'branch':
                if (action === 'created') return `Created branch <strong>${safe(details.branchName)}</strong>`;
                if (action === 'updated') return `Updated branch <strong>${safe(details.branchName)}</strong>`;
                break;
        }
        return `${action || 'updated'} ${type || 'item'}`;
    }

    getTimeAgo(timestamp) {
        const now = new Date();
        const t   = new Date(timestamp);
        const ms  = now - t;
        const m   = Math.floor(ms / 60000);
        const h   = Math.floor(ms / 3600000);
        const d   = Math.floor(ms / 86400000);

        if (m < 1)   return 'Just now';
        if (m < 60)  return `${m} min${m > 1 ? 's' : ''} ago`;
        if (h < 24)  return `${h} hour${h > 1 ? 's' : ''} ago`;
        if (d < 7)   return `${d} day${d > 1 ? 's' : ''} ago`;
        return t.toLocaleDateString();
    }
}

const activityTracker = new ActivityTracker();

if (typeof window !== 'undefined') {
    window.activityTracker = activityTracker;
}

export default activityTracker;
