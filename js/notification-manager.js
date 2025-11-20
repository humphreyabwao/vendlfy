// Notification Manager System
import dataManager from './data-manager.js';
import branchManager from './branch-manager.js';

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
    }

    // Initialize notification system
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
        this.startPeriodicCheck();
        
        console.log('✅ Notification system initialized');
    }

    // Attach event listeners
    attachEventListeners() {
        // Toggle notification panel
        this.notificationBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.togglePanel();
        });

        // Mark all as read
        const markAllReadBtn = document.getElementById('markAllReadBtn');
        if (markAllReadBtn) {
            markAllReadBtn.addEventListener('click', () => {
                this.markAllAsRead();
            });
        }

        // View all notifications
        const viewAllBtn = document.getElementById('viewAllNotificationsBtn');
        if (viewAllBtn) {
            viewAllBtn.addEventListener('click', () => {
                this.viewAllNotifications();
            });
        }

        // Close panel when clicking outside
        document.addEventListener('click', (e) => {
            const notificationDropdown = document.querySelector('.notification-dropdown');
            if (notificationDropdown && !notificationDropdown.contains(e.target)) {
                this.closePanel();
            }
        });
    }

    // Start periodic check for new notifications
    startPeriodicCheck() {
        // Check immediately
        this.checkForNotifications();

        // Then check every 30 seconds
        this.checkInterval = setInterval(() => {
            this.checkForNotifications();
        }, 30000);
    }

    // Check for new notifications
    async checkForNotifications() {
        try {
            const [lowStockItems, outOfStockItems, expiredItems, expiringItems] = await Promise.all([
                this.checkLowStock(),
                this.checkOutOfStock(),
                this.checkExpiredItems(),
                this.checkExpiringItems()
            ]);

            // Clear old notifications of these types
            this.clearNotificationsByType(['low_stock', 'out_of_stock', 'expired', 'expiring_soon']);

            // Add new notifications
            lowStockItems.forEach(item => this.addNotification({
                type: 'low_stock',
                title: 'Low Stock Alert',
                message: `${item.name} is running low (${item.quantity} left)`,
                priority: 'medium',
                icon: 'warning',
                data: item
            }));

            outOfStockItems.forEach(item => this.addNotification({
                type: 'out_of_stock',
                title: 'Out of Stock',
                message: `${item.name} is out of stock`,
                priority: 'high',
                icon: 'error',
                data: item
            }));

            expiredItems.forEach(item => this.addNotification({
                type: 'expired',
                title: 'Item Expired',
                message: `${item.name} has expired`,
                priority: 'high',
                icon: 'error',
                data: item
            }));

            expiringItems.forEach(item => this.addNotification({
                type: 'expiring_soon',
                title: 'Expiring Soon',
                message: `${item.name} expires in ${this.getDaysUntilExpiry(item.expiryDate)} days`,
                priority: 'medium',
                icon: 'warning',
                data: item
            }));

            this.saveNotifications();
            this.updateUI();

        } catch (error) {
            console.error('Error checking notifications:', error);
        }
    }

    // Check for low stock items
    async checkLowStock() {
        try {
            const items = await dataManager.getInventory();
            return items.filter(item => 
                item.quantity > 0 && 
                item.quantity <= (item.reorderLevel || 5)
            );
        } catch (error) {
            console.error('Error checking low stock:', error);
            return [];
        }
    }

    // Check for out of stock items
    async checkOutOfStock() {
        try {
            const items = await dataManager.getInventory();
            return items.filter(item => item.quantity <= 0);
        } catch (error) {
            console.error('Error checking out of stock:', error);
            return [];
        }
    }

    // Check for expired items
    async checkExpiredItems() {
        try {
            const items = await dataManager.getInventory();
            const now = new Date();
            return items.filter(item => {
                if (!item.expiryDate) return false;
                const expiryDate = new Date(item.expiryDate);
                return expiryDate < now;
            });
        } catch (error) {
            console.error('Error checking expired items:', error);
            return [];
        }
    }

    // Check for items expiring soon (within 7 days)
    async checkExpiringItems() {
        try {
            const items = await dataManager.getInventory();
            const now = new Date();
            const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
            
            return items.filter(item => {
                if (!item.expiryDate) return false;
                const expiryDate = new Date(item.expiryDate);
                return expiryDate > now && expiryDate <= sevenDaysFromNow;
            });
        } catch (error) {
            console.error('Error checking expiring items:', error);
            return [];
        }
    }

    // Get days until expiry
    getDaysUntilExpiry(expiryDate) {
        const now = new Date();
        const expiry = new Date(expiryDate);
        const diffTime = expiry - now;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return diffDays;
    }

    // Add notification
    addNotification(notification) {
        const newNotification = {
            id: this.generateId(),
            ...notification,
            timestamp: new Date().toISOString(),
            read: false
        };

        // Check if similar notification already exists
        const exists = this.notifications.some(n => 
            n.type === newNotification.type && 
            n.data?.id === newNotification.data?.id
        );

        if (!exists) {
            this.notifications.unshift(newNotification);
            this.unreadCount++;
            
            // Keep only last 50 notifications
            if (this.notifications.length > 50) {
                this.notifications = this.notifications.slice(0, 50);
            }
        }
    }

    // Add custom notification (for manual calls)
    notify(type, title, message, priority = 'info', data = null) {
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

    // Clear notifications by type
    clearNotificationsByType(types) {
        this.notifications = this.notifications.filter(n => !types.includes(n.type));
        this.updateUnreadCount();
    }

    // Mark notification as read
    markAsRead(notificationId) {
        const notification = this.notifications.find(n => n.id === notificationId);
        if (notification && !notification.read) {
            notification.read = true;
            this.unreadCount--;
            this.saveNotifications();
            this.updateUI();
        }
    }

    // Mark all as read
    markAllAsRead() {
        this.notifications.forEach(n => n.read = true);
        this.unreadCount = 0;
        this.saveNotifications();
        this.updateUI();
    }

    // Delete notification
    deleteNotification(notificationId) {
        const index = this.notifications.findIndex(n => n.id === notificationId);
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

    // Update unread count
    updateUnreadCount() {
        this.unreadCount = this.notifications.filter(n => !n.read).length;
    }

    // Update UI
    updateUI() {
        this.updateBadge();
        this.renderNotifications();
    }

    // Update badge
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

    // Render notifications
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

        const html = this.notifications.slice(0, 10).map(notification => {
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
        }).join('');

        this.notificationList.innerHTML = html;
        this.attachNotificationItemHandlers();
    }

    // Attach handlers to notification items
    attachNotificationItemHandlers() {
        // Mark as read buttons
        const markReadButtons = this.notificationList.querySelectorAll('.notification-mark-read');
        markReadButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.getAttribute('data-id');
                this.markAsRead(id);
            });
        });

        // Delete buttons
        const deleteButtons = this.notificationList.querySelectorAll('.notification-delete');
        deleteButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.getAttribute('data-id');
                this.deleteNotification(id);
            });
        });

        // Click on notification item
        const items = this.notificationList.querySelectorAll('.notification-item');
        items.forEach(item => {
            item.addEventListener('click', () => {
                const id = item.getAttribute('data-id');
                this.handleNotificationClick(id);
            });
        });
    }

    // Handle notification click
    handleNotificationClick(notificationId) {
        const notification = this.notifications.find(n => n.id === notificationId);
        if (!notification) return;

        // Mark as read
        this.markAsRead(notificationId);

        // Navigate based on notification type
        switch (notification.type) {
            case 'low_stock':
            case 'out_of_stock':
            case 'expired':
            case 'expiring_soon':
                // Navigate to inventory
                const inventoryLink = document.querySelector('[data-page="inventory"]');
                if (inventoryLink) {
                    inventoryLink.click();
                }
                break;
        }

        this.closePanel();
    }

    // Toggle notification panel
    togglePanel() {
        if (this.notificationPanel) {
            this.notificationPanel.classList.toggle('active');
        }
    }

    // Close panel
    closePanel() {
        if (this.notificationPanel) {
            this.notificationPanel.classList.remove('active');
        }
    }

    // View all notifications (navigate to a dedicated page if exists)
    viewAllNotifications() {
        console.log('View all notifications');
        this.closePanel();
        // You can add navigation to a dedicated notifications page here
    }

    // Get icon SVG
    getIconSVG(icon) {
        const icons = {
            warning: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
            error: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>',
            success: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>',
            info: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>'
        };
        return icons[icon] || icons.info;
    }

    // Get icon for type
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

    // Get time ago string
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

    // Generate unique ID
    generateId() {
        return 'notif_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    // Load notifications from localStorage
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

    // Save notifications to localStorage
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

    // Cleanup
    destroy() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
        }
    }
}

// Create singleton instance
const notificationManager = new NotificationManager();

// Make it globally available
window.notificationManager = notificationManager;

export default notificationManager;
