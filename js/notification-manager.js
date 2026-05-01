// Notification Manager — in-app alerts with local persistence (no Firestore writes here).
// Inventory alerts (low / out / expiry) are reconciled against current stock: one row per
// item+condition until it clears, not recreated every poll.
import dataManager from './data-manager.js';

const INVENTORY_ALERT_TYPES = ['low_stock', 'out_of_stock', 'expired', 'expiring_soon'];
// Poll cadence raised from 2 min → 5 min. Inventory alerts are also reconciled
// reactively via the `inventoryDataChanged` event, so the timer is only a
// safety net.
const POLL_MS = 300000;
const NOTIFY_DEDUPE_MS = 3500;
const INVENTORY_RECONCILE_DEBOUNCE_MS = 1000;
const MAX_NOTIFICATIONS = 50;

function itemStableKey(data) {
    if (!data || typeof data !== 'object') return '';
    return String(data.id || data.sku || data.name || '').trim();
}

function stableInventoryAlertId(type, itemKey) {
    const safe = String(itemKey).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
    return `invalert_${type}_${safe}`;
}

class NotificationManager {
    constructor() {
        this.notifications = [];
        this.unreadCount = 0;
        this.listeners = [];
        this.checkInterval = null;
        this.notificationPanel = null;
        this.notificationBtn = null;
        this.notificationBadge = null;
        this.notificationList = null;
        this._notifyDedupe = new Map();
        this._inventoryDebounceTimer = null;
        this._liveEventsBound = false;
    }

    init() {
        this.notificationPanel = document.getElementById('notificationPanel');
        this.notificationBtn = document.getElementById('notificationBtn');
        this.notificationBadge = document.getElementById('notificationBadge');
        this.notificationList = document.getElementById('notificationList');

        if (!this.notificationBtn) {
            console.warn('Notification elements not found');
            return;
        }

        this.loadNotifications();
        this.attachEventListeners();
        this._bindLiveInventoryTriggers();
        this.startPeriodicCheck();

        console.log('✅ Notification system initialized');
    }

    _bindLiveInventoryTriggers() {
        if (this._liveEventsBound) return;
        this._liveEventsBound = true;

        window.addEventListener('inventoryDataChanged', () => {
            clearTimeout(this._inventoryDebounceTimer);
            this._inventoryDebounceTimer = setTimeout(() => this.checkForNotifications(), INVENTORY_RECONCILE_DEBOUNCE_MS);
        });

        window.addEventListener('branchChanged', () => {
            clearTimeout(this._inventoryDebounceTimer);
            this._inventoryDebounceTimer = setTimeout(() => this.checkForNotifications(), 400);
        });
    }

    attachEventListeners() {
        this.notificationBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.togglePanel();
        });

        const markAllReadBtn = document.getElementById('markAllReadBtn');
        if (markAllReadBtn) {
            markAllReadBtn.addEventListener('click', () => {
                this.markAllAsRead();
            });
        }

        const viewAllBtn = document.getElementById('viewAllNotificationsBtn');
        if (viewAllBtn) {
            viewAllBtn.addEventListener('click', () => {
                this.viewAllNotifications();
            });
        }

        document.addEventListener('click', (e) => {
            const notificationDropdown = document.querySelector('.notification-dropdown');
            if (notificationDropdown && !notificationDropdown.contains(e.target)) {
                this.closePanel();
            }
        });
    }

    startPeriodicCheck() {
        this.checkForNotifications();

        if (this.checkInterval) clearInterval(this.checkInterval);
        this.checkInterval = setInterval(() => {
            this.checkForNotifications();
        }, POLL_MS);
    }

    /** Collapse duplicate inventory rows (same type + item) to a single entry. */
    _collectInventoryAlertsMap() {
        const m = new Map();
        for (const n of this.notifications) {
            if (!INVENTORY_ALERT_TYPES.includes(n.type)) continue;
            const ik = itemStableKey(n.data);
            if (!ik) continue;
            const key = `${n.type}:${ik}`;
            const prev = m.get(key);
            if (!prev) {
                m.set(key, n);
                continue;
            }
            if (!prev.read && n.read) m.set(key, prev);
            else if (!n.read && prev.read) m.set(key, n);
            else if (new Date(n.timestamp) > new Date(prev.timestamp)) m.set(key, n);
            else m.set(key, prev);
        }
        return m;
    }

    async checkForNotifications() {
        try {
            // Skip work when the tab is in the background — every cycle here
            // fetches the entire inventory collection.
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
                return;
            }

            // Fetch inventory ONCE and run all four filters against the same
            // in-memory list. Previously each filter helper did its own
            // `dataManager.getInventory()` round-trip = 4× full collection
            // reads per poll cycle.
            let items;
            try {
                items = await dataManager.getInventory();
            } catch (e) {
                console.error('Notification inventory fetch failed:', e);
                return;
            }
            const [lowStockItems, outOfStockItems, expiredItems, expiringItems] = [
                this._filterLowStock(items),
                this._filterOutOfStock(items),
                this._filterExpired(items),
                this._filterExpiring(items)
            ];

            const desired = new Map();

            const putDesired = (type, items, build) => {
                for (const item of items) {
                    const ik = itemStableKey(item);
                    if (!ik) continue;
                    desired.set(`${type}:${ik}`, build(item));
                }
            };

            putDesired('low_stock', lowStockItems, (item) => ({
                type: 'low_stock',
                title: 'Low stock',
                message: `${item.name} is running low (${item.quantity} left)`,
                priority: 'medium',
                icon: 'warning',
                data: item
            }));

            putDesired('out_of_stock', outOfStockItems, (item) => ({
                type: 'out_of_stock',
                title: 'Out of stock',
                message: `${item.name} is out of stock`,
                priority: 'high',
                icon: 'error',
                data: item
            }));

            putDesired('expired', expiredItems, (item) => ({
                type: 'expired',
                title: 'Item expired',
                message: `${item.name} has expired`,
                priority: 'high',
                icon: 'error',
                data: item
            }));

            putDesired('expiring_soon', expiringItems, (item) => ({
                type: 'expiring_soon',
                title: 'Expiring soon',
                message: `${item.name} expires in ${this.getDaysUntilExpiry(item.expiryDate)} days`,
                priority: 'medium',
                icon: 'warning',
                data: item
            }));

            const nonInventory = this.notifications.filter((n) => !INVENTORY_ALERT_TYPES.includes(n.type));
            const prevInv = this._collectInventoryAlertsMap();

            const nextInv = [];
            let changed = false;

            for (const [key, payload] of desired) {
                const existing = prevInv.get(key);
                if (existing) {
                    prevInv.delete(key);
                    const same =
                        existing.message === payload.message &&
                        existing.title === payload.title &&
                        existing.priority === payload.priority &&
                        existing.icon === payload.icon;

                    existing.id = stableInventoryAlertId(payload.type, itemStableKey(payload.data));
                    existing.title = payload.title;
                    existing.message = payload.message;
                    existing.priority = payload.priority;
                    existing.icon = payload.icon;
                    existing.data = payload.data;

                    if (!same) changed = true;

                    nextInv.push(existing);
                } else {
                    nextInv.push({
                        id: stableInventoryAlertId(payload.type, itemStableKey(payload.data)),
                        ...payload,
                        timestamp: new Date().toISOString(),
                        read: false
                    });
                    changed = true;
                }
            }

            if (prevInv.size > 0) changed = true;

            const combined = [...nonInventory, ...nextInv].sort(
                (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
            );

            if (combined.length > MAX_NOTIFICATIONS) {
                this.notifications = combined.slice(0, MAX_NOTIFICATIONS);
            } else {
                this.notifications = combined;
            }

            this.updateUnreadCount();

            if (changed) {
                this.saveNotifications();
                this.updateUI();
            } else {
                this.updateBadge();
            }
        } catch (error) {
            console.error('Error checking notifications:', error);
        }
    }

    // Synchronous filters that operate on an already-fetched inventory array.
    // `checkForNotifications()` fetches inventory once and runs all four. The
    // async wrappers below are kept for external callers (if any).
    _filterLowStock(items) {
        return items.filter(
            (item) =>
                item.quantity > 0 && item.quantity <= (item.reorderLevel || 5)
        );
    }

    _filterOutOfStock(items) {
        return items.filter((item) => item.quantity <= 0);
    }

    _filterExpired(items) {
        const now = new Date();
        return items.filter((item) => {
            if (!item.expiryDate) return false;
            const expiryDate = new Date(item.expiryDate);
            return expiryDate < now;
        });
    }

    _filterExpiring(items) {
        const now = new Date();
        const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        return items.filter((item) => {
            if (!item.expiryDate) return false;
            const expiryDate = new Date(item.expiryDate);
            return expiryDate > now && expiryDate <= sevenDaysFromNow;
        });
    }

    async checkLowStock() {
        try {
            const items = await dataManager.getInventory();
            return this._filterLowStock(items);
        } catch (error) {
            console.error('Error checking low stock:', error);
            return [];
        }
    }

    async checkOutOfStock() {
        try {
            const items = await dataManager.getInventory();
            return this._filterOutOfStock(items);
        } catch (error) {
            console.error('Error checking out of stock:', error);
            return [];
        }
    }

    async checkExpiredItems() {
        try {
            const items = await dataManager.getInventory();
            return this._filterExpired(items);
        } catch (error) {
            console.error('Error checking expired items:', error);
            return [];
        }
    }

    async checkExpiringItems() {
        try {
            const items = await dataManager.getInventory();
            return this._filterExpiring(items);
        } catch (error) {
            console.error('Error checking expiring items:', error);
            return [];
        }
    }

    getDaysUntilExpiry(expiryDate) {
        const now = new Date();
        const expiry = new Date(expiryDate);
        const diffTime = expiry - now;
        return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }

    addNotification(notification) {
        const ik = itemStableKey(notification.data);
        let id = notification.id;

        if (ik && INVENTORY_ALERT_TYPES.includes(notification.type)) {
            id = stableInventoryAlertId(notification.type, ik);
        } else if (!id) {
            id = this.generateId();
        }

        const incoming = {
            ...notification,
            id,
            timestamp: notification.timestamp || new Date().toISOString(),
            read: notification.read ?? false
        };

        if (ik && INVENTORY_ALERT_TYPES.includes(incoming.type)) {
            const j = this.notifications.findIndex(
                (n) => n.type === incoming.type && itemStableKey(n.data) === ik
            );
            if (j !== -1) {
                const n = this.notifications[j];
                n.id = incoming.id;
                n.title = incoming.title;
                n.message = incoming.message;
                n.priority = incoming.priority;
                n.icon = incoming.icon;
                n.data = incoming.data;
                this.updateUnreadCount();
                return;
            }
        } else {
            const dup = this.notifications.some(
                (n) =>
                    !INVENTORY_ALERT_TYPES.includes(n.type) &&
                    n.type === incoming.type &&
                    n.title === incoming.title &&
                    n.message === incoming.message
            );
            if (dup) return;
        }

        this.notifications.unshift(incoming);
        if (this.notifications.length > MAX_NOTIFICATIONS) {
            this.notifications = this.notifications.slice(0, MAX_NOTIFICATIONS);
        }
        this.updateUnreadCount();
    }

    notify(type, title, message, priority = 'info', data = null) {
        const sig = `${type}\x00${title}\x00${message}`;
        const now = Date.now();
        const last = this._notifyDedupe.get(sig);
        if (last != null && now - last < NOTIFY_DEDUPE_MS) return;
        this._notifyDedupe.set(sig, now);
        if (this._notifyDedupe.size > 100) {
            for (const [k, t] of this._notifyDedupe) {
                if (now - t > 60000) this._notifyDedupe.delete(k);
            }
        }

        this.addNotification({
            type,
            title,
            message,
            priority,
            icon: this.getIconForType(type),
            data
        });

        this.saveNotifications();
        this.updateUI();
    }

    /** Short toast-style entry (used by user-ui / brand-ui). */
    add(message, type = 'info') {
        const title =
            type === 'error' ? 'Error' :
                type === 'success' ? 'Success' :
                    type === 'warning' ? 'Warning' : 'Notice';
        const priority =
            type === 'error' ? 'high' :
                type === 'success' ? 'medium' :
                    type === 'warning' ? 'medium' : 'info';
        this.notify(type, title, String(message), priority, null);
    }

    markAsRead(notificationId) {
        const notification = this.notifications.find((n) => n.id === notificationId);
        if (notification && !notification.read) {
            notification.read = true;
            this.unreadCount--;
            this.saveNotifications();
            this.updateUI();
        }
    }

    markAllAsRead() {
        this.notifications.forEach((n) => (n.read = true));
        this.unreadCount = 0;
        this.saveNotifications();
        this.updateUI();
    }

    deleteNotification(notificationId) {
        const index = this.notifications.findIndex((n) => n.id === notificationId);
        if (index !== -1) {
            const notification = this.notifications[index];
            if (!notification.read) {
                this.unreadCount--;
            }
            this.notifications.splice(index, 1);
            this.saveNotifications();
            this.updateUI();
        }
    }

    updateUnreadCount() {
        this.unreadCount = this.notifications.filter((n) => !n.read).length;
    }

    updateUI() {
        this.updateBadge();
        this.renderNotifications();
    }

    updateBadge() {
        if (this.notificationBadge) {
            if (this.unreadCount > 0) {
                this.notificationBadge.textContent = this.unreadCount > 99 ? '99+' : this.unreadCount;
                this.notificationBadge.style.display = 'block';
            } else {
                this.notificationBadge.style.display = 'none';
            }
        }
    }

    renderNotifications() {
        if (!this.notificationList) return;

        if (this.notifications.length === 0) {
            this.notificationList.innerHTML = `
                <div class="notification-empty">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                        <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
                    </svg>
                    <p>No notifications</p>
                    <span>You're all caught up!</span>
                </div>
            `;
            return;
        }

        const html = this.notifications
            .slice(0, 10)
            .map((notification) => {
                const timeAgo = this.getTimeAgo(notification.timestamp);
                const icon = this.getIconSVG(notification.icon);
                const priorityClass = `notification-${notification.priority}`;
                const readClass = notification.read ? 'read' : '';

                return `
                <div class="notification-item ${priorityClass} ${readClass}" data-id="${notification.id}">
                    <div class="notification-icon">${icon}</div>
                    <div class="notification-content">
                        <div class="notification-title">${notification.title}</div>
                        <div class="notification-message">${notification.message}</div>
                        <div class="notification-time">${timeAgo}</div>
                    </div>
                    <div class="notification-actions">
                        ${!notification.read ? `<button class="notification-mark-read" data-id="${notification.id}" title="Mark as read">●</button>` : ''}
                        <button class="notification-delete" data-id="${notification.id}" title="Dismiss">×</button>
                    </div>
                </div>
            `;
            })
            .join('');

        this.notificationList.innerHTML = html;
        this.attachNotificationItemHandlers();
    }

    attachNotificationItemHandlers() {
        const markReadButtons = this.notificationList.querySelectorAll('.notification-mark-read');
        markReadButtons.forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.getAttribute('data-id');
                this.markAsRead(id);
            });
        });

        const deleteButtons = this.notificationList.querySelectorAll('.notification-delete');
        deleteButtons.forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.getAttribute('data-id');
                this.deleteNotification(id);
            });
        });

        const items = this.notificationList.querySelectorAll('.notification-item');
        items.forEach((item) => {
            item.addEventListener('click', () => {
                const id = item.getAttribute('data-id');
                this.handleNotificationClick(id);
            });
        });
    }

    handleNotificationClick(notificationId) {
        const notification = this.notifications.find((n) => n.id === notificationId);
        if (!notification) return;

        this.markAsRead(notificationId);

        switch (notification.type) {
            case 'low_stock':
            case 'out_of_stock':
            case 'expired':
            case 'expiring_soon': {
                const inventoryLink = document.querySelector('[data-page="inventory"]');
                if (inventoryLink) inventoryLink.click();
                break;
            }
        }

        this.closePanel();
    }

    togglePanel() {
        if (this.notificationPanel) {
            this.notificationPanel.classList.toggle('active');
        }
    }

    closePanel() {
        if (this.notificationPanel) {
            this.notificationPanel.classList.remove('active');
        }
    }

    viewAllNotifications() {
        console.log('View all notifications');
        this.closePanel();
    }

    getIconSVG(icon) {
        const icons = {
            warning:
                '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
            error:
                '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>',
            success:
                '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>',
            info:
                '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>'
        };
        return icons[icon] || icons.info;
    }

    getIconForType(type) {
        const typeIcons = {
            low_stock: 'warning',
            out_of_stock: 'error',
            expired: 'error',
            expiring_soon: 'warning',
            item_added: 'success',
            sale_completed: 'success',
            order_received: 'info'
        };
        return typeIcons[type] || 'info';
    }

    getTimeAgo(timestamp) {
        const now = new Date();
        const notificationTime = new Date(timestamp);
        const diffMs = now - notificationTime;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) {
            return 'Just now';
        } else if (diffMins < 60) {
            return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
        } else if (diffHours < 24) {
            return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
        } else if (diffDays < 7) {
            return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
        } else {
            return notificationTime.toLocaleDateString();
        }
    }

    generateId() {
        return 'notif_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    loadNotifications() {
        try {
            const stored = localStorage.getItem('vendlfy_notifications');
            if (stored) {
                const data = JSON.parse(stored);
                this.notifications = data.notifications || [];
                this.updateUnreadCount();
            }
        } catch (error) {
            console.error('Error loading notifications:', error);
        }
    }

    saveNotifications() {
        try {
            const data = {
                notifications: this.notifications,
                lastUpdated: new Date().toISOString()
            };
            localStorage.setItem('vendlfy_notifications', JSON.stringify(data));
        } catch (error) {
            console.error('Error saving notifications:', error);
        }
    }

    destroy() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
        }
        clearTimeout(this._inventoryDebounceTimer);
    }
}

const notificationManager = new NotificationManager();

window.notificationManager = notificationManager;

export default notificationManager;
