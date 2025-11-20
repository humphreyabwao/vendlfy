// Activity Tracker System
import { db, isFirebaseConfigured, collection, addDoc, getDocs, query, where, orderBy, limit, onSnapshot } from './firebase-config.js';
import branchManager from './branch-manager.js';

class ActivityTracker {
    constructor() {
        this.activities = [];
        this.listeners = [];
        this.useLocalStorage = !isFirebaseConfigured;
        this.currentFilters = {
            date: 'today',
            type: 'all'
        };
        this.currentPage = 1;
        this.itemsPerPage = 20;
        
        if (this.useLocalStorage) {
            this.loadFromLocalStorage();
        }
    }

    // Load activities from localStorage
    loadFromLocalStorage() {
        try {
            const data = localStorage.getItem('vendlfy_activities');
            if (data) {
                this.activities = JSON.parse(data);
            }
        } catch (error) {
            console.error('Error loading activities from localStorage:', error);
        }
    }

    // Save activities to localStorage
    saveToLocalStorage() {
        try {
            localStorage.setItem('vendlfy_activities', JSON.stringify(this.activities));
        } catch (error) {
            console.error('Error saving activities to localStorage:', error);
        }
    }

    // Log a new activity
    async logActivity(type, action, details = {}, metadata = {}) {
        const currentBranch = branchManager.getCurrentBranch();
        const user = this.getCurrentUser();

        const activity = {
            type,           // 'inventory', 'sale', 'b2b', 'order', 'customer', 'expense', 'user'
            action,         // 'added', 'updated', 'deleted', 'created', 'completed', etc.
            details,        // Specific details about the activity
            metadata,       // Additional metadata
            branchId: currentBranch ? currentBranch.id : null,
            branchName: currentBranch ? currentBranch.name : null,
            userId: user.id,
            userName: user.name,
            timestamp: new Date().toISOString(),
            id: this.generateId()
        };

        try {
            if (this.useLocalStorage) {
                // Save to localStorage
                this.activities.unshift(activity);
                // Keep only last 1000 activities in localStorage
                if (this.activities.length > 1000) {
                    this.activities = this.activities.slice(0, 1000);
                }
                this.saveToLocalStorage();
                console.log('✅ Activity logged to localStorage:', activity);
            } else {
                // Save to Firestore
                const activitiesRef = collection(db, 'activities');
                const docRef = await addDoc(activitiesRef, activity);
                activity.id = docRef.id;
                console.log('✅ Activity logged to Firestore:', activity);
            }

            // Notify listeners
            this.notifyListeners(activity);
            
            return activity;
        } catch (error) {
            console.error('❌ Error logging activity:', error);
            throw error;
        }
    }

    // Get current user (you can integrate with your auth system)
    getCurrentUser() {
        // Default user - replace with actual user from auth system
        const savedUser = localStorage.getItem('currentUser');
        if (savedUser) {
            return JSON.parse(savedUser);
        }
        return {
            id: 'admin',
            name: 'Admin User'
        };
    }

    // Generate unique ID
    generateId() {
        return 'act_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    // Get activities with filters
    async getActivities(filters = {}) {
        try {
            if (this.useLocalStorage) {
                return this.filterActivities(this.activities, filters);
            } else {
                // Query from Firestore
                const activitiesRef = collection(db, 'activities');
                let conditions = [];
                
                // Apply branch filter
                const currentBranch = branchManager.getCurrentBranch();
                if (currentBranch && !branchManager.isViewingAllBranches()) {
                    conditions.push(where('branchId', '==', currentBranch.id));
                }

                // Apply type filter
                if (filters.type && filters.type !== 'all') {
                    conditions.push(where('type', '==', filters.type));
                }

                // Order by timestamp
                conditions.push(orderBy('timestamp', 'desc'));

                // Apply limit
                if (filters.limit) {
                    conditions.push(limit(filters.limit));
                }

                const q = query(activitiesRef, ...conditions);
                const querySnapshot = await getDocs(q);
                
                let activities = [];
                querySnapshot.forEach((doc) => {
                    activities.push({ id: doc.id, ...doc.data() });
                });

                // Apply date filter
                if (filters.date) {
                    activities = this.filterByDate(activities, filters.date);
                }

                return activities;
            }
        } catch (error) {
            console.error('Error getting activities:', error);
            return [];
        }
    }

    // Filter activities (for localStorage)
    filterActivities(activities, filters) {
        let filtered = [...activities];

        // Filter by type
        if (filters.type && filters.type !== 'all') {
            filtered = filtered.filter(a => a.type === filters.type);
        }

        // Filter by date
        if (filters.date) {
            filtered = this.filterByDate(filtered, filters.date);
        }

        // Filter by search term
        if (filters.search) {
            const searchLower = filters.search.toLowerCase();
            filtered = filtered.filter(a => 
                a.action.toLowerCase().includes(searchLower) ||
                a.type.toLowerCase().includes(searchLower) ||
                JSON.stringify(a.details).toLowerCase().includes(searchLower)
            );
        }

        // Apply limit
        if (filters.limit) {
            filtered = filtered.slice(0, filters.limit);
        }

        return filtered;
    }

    // Filter by date range
    filterByDate(activities, dateFilter) {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        
        return activities.filter(activity => {
            const activityDate = new Date(activity.timestamp);
            
            switch(dateFilter) {
                case 'today':
                    return activityDate >= today;
                    
                case 'yesterday':
                    const yesterday = new Date(today);
                    yesterday.setDate(yesterday.getDate() - 1);
                    return activityDate >= yesterday && activityDate < today;
                    
                case 'week':
                    const weekAgo = new Date(today);
                    weekAgo.setDate(weekAgo.getDate() - 7);
                    return activityDate >= weekAgo;
                    
                case 'month':
                    const monthAgo = new Date(today);
                    monthAgo.setDate(monthAgo.getDate() - 30);
                    return activityDate >= monthAgo;
                    
                case 'all':
                default:
                    return true;
            }
        });
    }

    // Start real-time listener (for Firestore)
    startRealtimeListener(callback) {
        if (this.useLocalStorage) {
            console.log('⚠️ Real-time listener not available in localStorage mode');
            return null;
        }

        try {
            const activitiesRef = collection(db, 'activities');
            const q = query(activitiesRef, orderBy('timestamp', 'desc'), limit(50));
            
            const unsubscribe = onSnapshot(q, (snapshot) => {
                snapshot.docChanges().forEach((change) => {
                    if (change.type === 'added') {
                        const activity = { id: change.doc.id, ...change.doc.data() };
                        if (callback) {
                            callback(activity);
                        }
                    }
                });
            });

            this.listeners.push(unsubscribe);
            console.log('✅ Real-time activity listener started');
            return unsubscribe;
        } catch (error) {
            console.error('Error starting real-time listener:', error);
            return null;
        }
    }

    // Add listener for new activities
    addListener(callback) {
        this.listeners.push(callback);
    }

    // Notify all listeners
    notifyListeners(activity) {
        this.listeners.forEach(listener => {
            if (typeof listener === 'function') {
                listener(activity);
            }
        });
    }

    // Get activity stats
    async getActivityStats(dateFilter = 'today') {
        const activities = await this.getActivities({ date: dateFilter });
        
        const stats = {
            total: activities.length,
            byType: {},
            byUser: {},
            mostActive: null
        };

        activities.forEach(activity => {
            // Count by type
            stats.byType[activity.type] = (stats.byType[activity.type] || 0) + 1;
            
            // Count by user
            stats.byUser[activity.userName] = (stats.byUser[activity.userName] || 0) + 1;
        });

        // Find most active type
        if (Object.keys(stats.byType).length > 0) {
            stats.mostActive = Object.keys(stats.byType).reduce((a, b) => 
                stats.byType[a] > stats.byType[b] ? a : b
            );
        }

        return stats;
    }

    // Format activity for display
    formatActivity(activity) {
        const icon = this.getActivityIcon(activity.type);
        const color = this.getActivityColor(activity.type);
        const timeAgo = this.getTimeAgo(activity.timestamp);
        const description = this.getActivityDescription(activity);

        return {
            ...activity,
            icon,
            color,
            timeAgo,
            description
        };
    }

    // Get icon for activity type
    getActivityIcon(type) {
        const icons = {
            inventory: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path></svg>',
            sale: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg>',
            b2b: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>',
            order: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>',
            customer: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>',
            expense: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>',
            user: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>',
            supplier: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>'
        };
        return icons[type] || icons.inventory;
    }

    // Get color for activity type
    getActivityColor(type) {
        const colors = {
            inventory: 'blue',
            sale: 'green',
            b2b: 'purple',
            order: 'orange',
            customer: 'teal',
            expense: 'red',
            user: 'gray',
            supplier: 'indigo'
        };
        return colors[type] || 'blue';
    }

    // Get activity description
    getActivityDescription(activity) {
        const { type, action, details } = activity;
        
        switch(type) {
            case 'inventory':
                if (action === 'added') {
                    return `Added new item: <strong>${details.itemName || 'Unknown'}</strong>`;
                } else if (action === 'updated') {
                    return `Updated item: <strong>${details.itemName || 'Unknown'}</strong>`;
                } else if (action === 'deleted') {
                    return `Deleted item: <strong>${details.itemName || 'Unknown'}</strong>`;
                }
                break;
                
            case 'sale':
                if (action === 'completed') {
                    return `Completed sale of <strong>KES ${details.amount || 0}</strong>`;
                }
                break;
                
            case 'b2b':
                if (action === 'created') {
                    return `Created B2B order for <strong>${details.customerName || 'Unknown'}</strong>`;
                }
                break;
                
            case 'order':
                if (action === 'created') {
                    return `Created purchase order from <strong>${details.supplierName || 'Unknown'}</strong>`;
                }
                break;
                
            case 'customer':
                if (action === 'added') {
                    return `Added new customer: <strong>${details.customerName || 'Unknown'}</strong>`;
                }
                break;
                
            case 'expense':
                if (action === 'recorded') {
                    return `Recorded expense: <strong>${details.category || 'Unknown'}</strong> - KES ${details.amount || 0}`;
                }
                break;
                
            case 'user':
                if (action === 'created') {
                    return `Created new user: <strong>${details.userName || 'Unknown'}</strong>`;
                }
                break;
                
            case 'supplier':
                if (action === 'added') {
                    return `Added new supplier: <strong>${details.supplierName || 'Unknown'}</strong>`;
                }
                break;
        }
        
        return `${action} ${type}`;
    }

    // Get time ago string
    getTimeAgo(timestamp) {
        const now = new Date();
        const activityTime = new Date(timestamp);
        const diffMs = now - activityTime;
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
            return activityTime.toLocaleDateString();
        }
    }
}

// Create singleton instance
const activityTracker = new ActivityTracker();

// Make it globally available
window.activityTracker = activityTracker;

export default activityTracker;
