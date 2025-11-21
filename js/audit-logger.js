// Audit Logger - Track all user activities
import { db, collection, addDoc, query, orderBy, limit, onSnapshot, where, getDocs } from './firebase-config.js';

class AuditLogger {
    constructor() {
        this.logs = [];
        this.listeners = [];
        this.currentUser = null;
        this.sessionStartTime = null;
    }

    // Initialize with current user
    initialize(user) {
        this.currentUser = user;
        this.sessionStartTime = new Date().toISOString();
    }

    // Log an activity
    async logActivity(actionType, actionCategory, details = {}) {
        try {
            const userInfo = JSON.parse(localStorage.getItem('currentUser') || '{}');
            
            const logEntry = {
                userId: userInfo.id || 'unknown',
                userEmail: userInfo.email || 'unknown',
                userName: userInfo.name || 'Unknown User',
                actionType,
                actionCategory,
                details,
                timestamp: new Date().toISOString(),
                sessionId: this.getSessionId(),
                deviceInfo: this.getDeviceInfo(),
                ipAddress: await this.getIPAddress(),
                browserInfo: this.getBrowserInfo()
            };

            // Save to Firestore
            if (db) {
                const logsRef = collection(db, 'auditLogs');
                const docRef = await addDoc(logsRef, logEntry);
                logEntry.id = docRef.id;
                console.log('📋 Audit log saved:', actionType, actionCategory);
            } else {
                // Fallback to localStorage
                logEntry.id = 'local_' + Date.now();
                const localLogs = JSON.parse(localStorage.getItem('vendify_audit_logs') || '[]');
                localLogs.push(logEntry);
                // Keep only last 1000 logs in localStorage
                if (localLogs.length > 1000) {
                    localLogs.shift();
                }
                localStorage.setItem('vendify_audit_logs', JSON.stringify(localLogs));
            }

            this.logs.unshift(logEntry);
            this.notifyListeners();
            return logEntry;

        } catch (error) {
            console.error('❌ Error logging activity:', error);
            return null;
        }
    }

    // Get session ID from sessionStorage
    getSessionId() {
        let sessionId = sessionStorage.getItem('vendify_session_id');
        if (!sessionId) {
            sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            sessionStorage.setItem('vendify_session_id', sessionId);
        }
        return sessionId;
    }

    // Get device information
    getDeviceInfo() {
        const ua = navigator.userAgent;
        let deviceType = 'Desktop';
        
        if (/mobile/i.test(ua)) deviceType = 'Mobile';
        else if (/tablet|ipad/i.test(ua)) deviceType = 'Tablet';
        
        return {
            type: deviceType,
            platform: navigator.platform,
            language: navigator.language,
            screenResolution: `${screen.width}x${screen.height}`,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
        };
    }

    // Get browser information
    getBrowserInfo() {
        const ua = navigator.userAgent;
        let browser = 'Unknown';
        
        if (ua.includes('Firefox')) browser = 'Firefox';
        else if (ua.includes('Chrome')) browser = 'Chrome';
        else if (ua.includes('Safari')) browser = 'Safari';
        else if (ua.includes('Edge')) browser = 'Edge';
        else if (ua.includes('Opera')) browser = 'Opera';
        
        return {
            name: browser,
            userAgent: ua,
            cookieEnabled: navigator.cookieEnabled,
            onlineStatus: navigator.onLine
        };
    }

    // Get IP address (using public API)
    async getIPAddress() {
        try {
            const response = await fetch('https://api.ipify.org?format=json');
            const data = await response.json();
            return data.ip || 'Unknown';
        } catch (error) {
            return 'Unknown';
        }
    }

    // Load audit logs
    async loadLogs(filters = {}) {
        try {
            if (db) {
                const logsRef = collection(db, 'auditLogs');
                let q = query(logsRef, orderBy('timestamp', 'desc'), limit(filters.limit || 100));

                // Apply filters
                if (filters.userId) {
                    q = query(logsRef, where('userId', '==', filters.userId), orderBy('timestamp', 'desc'), limit(filters.limit || 100));
                }
                if (filters.actionCategory) {
                    q = query(logsRef, where('actionCategory', '==', filters.actionCategory), orderBy('timestamp', 'desc'), limit(filters.limit || 100));
                }
                if (filters.startDate) {
                    q = query(logsRef, where('timestamp', '>=', filters.startDate), orderBy('timestamp', 'desc'), limit(filters.limit || 100));
                }

                const snapshot = await getDocs(q);
                this.logs = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }));
                
                console.log('📋 Loaded audit logs:', this.logs.length);
            } else {
                // Load from localStorage
                this.logs = JSON.parse(localStorage.getItem('vendify_audit_logs') || '[]');
                
                // Apply filters
                if (filters.userId) {
                    this.logs = this.logs.filter(log => log.userId === filters.userId);
                }
                if (filters.actionCategory) {
                    this.logs = this.logs.filter(log => log.actionCategory === filters.actionCategory);
                }
                
                this.logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
                this.logs = this.logs.slice(0, filters.limit || 100);
            }

            return this.logs;
        } catch (error) {
            console.error('❌ Error loading audit logs:', error);
            return [];
        }
    }

    // Start real-time listener
    startRealtimeListener(callback) {
        if (!db) {
            console.warn('⚠️ Firestore not available, real-time updates disabled');
            return;
        }

        try {
            const logsRef = collection(db, 'auditLogs');
            const q = query(logsRef, orderBy('timestamp', 'desc'), limit(50));

            const unsubscribe = onSnapshot(q, (snapshot) => {
                this.logs = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }));
                
                if (callback) callback(this.logs);
                this.notifyListeners();
            });

            this.listeners.push(unsubscribe);
            console.log('🔄 Audit log real-time listener started');
        } catch (error) {
            console.error('❌ Error starting real-time listener:', error);
        }
    }

    // Add listener for log updates
    addListener(callback) {
        this.listeners.push(callback);
    }

    // Notify all listeners
    notifyListeners() {
        this.listeners.forEach(listener => {
            if (typeof listener === 'function') {
                listener(this.logs);
            }
        });
    }

    // Get logs by category
    getLogsByCategory(category) {
        return this.logs.filter(log => log.actionCategory === category);
    }

    // Get logs by user
    getLogsByUser(userId) {
        return this.logs.filter(log => log.userId === userId);
    }

    // Get logs by date range
    getLogsByDateRange(startDate, endDate) {
        return this.logs.filter(log => {
            const logDate = new Date(log.timestamp);
            return logDate >= new Date(startDate) && logDate <= new Date(endDate);
        });
    }

    // Get activity summary
    getActivitySummary(userId = null) {
        const logsToAnalyze = userId ? this.getLogsByUser(userId) : this.logs;
        
        const summary = {
            totalActivities: logsToAnalyze.length,
            byCategory: {},
            byUser: {},
            recentActivities: logsToAnalyze.slice(0, 10)
        };

        logsToAnalyze.forEach(log => {
            // By category
            if (!summary.byCategory[log.actionCategory]) {
                summary.byCategory[log.actionCategory] = 0;
            }
            summary.byCategory[log.actionCategory]++;

            // By user
            if (!summary.byUser[log.userName]) {
                summary.byUser[log.userName] = 0;
            }
            summary.byUser[log.userName]++;
        });

        return summary;
    }

    // Log authentication events
    async logLogin(userEmail, userName) {
        return await this.logActivity('LOGIN', 'AUTH', {
            message: `User logged in: ${userName}`,
            email: userEmail,
            loginTime: new Date().toISOString()
        });
    }

    async logLogout(userEmail, userName) {
        return await this.logActivity('LOGOUT', 'AUTH', {
            message: `User logged out: ${userName}`,
            email: userEmail,
            logoutTime: new Date().toISOString(),
            sessionDuration: this.getSessionDuration()
        });
    }

    // Log sales activities
    async logSale(saleType, saleData) {
        return await this.logActivity('CREATE_SALE', 'SALES', {
            message: `New ${saleType} sale created`,
            saleType,
            totalAmount: saleData.total,
            itemCount: saleData.items?.length || 0,
            customer: saleData.customerName || 'Walk-in'
        });
    }

    // Log inventory activities
    async logInventoryUpdate(action, itemData) {
        return await this.logActivity(action, 'INVENTORY', {
            message: `Inventory ${action.toLowerCase()}: ${itemData.name}`,
            itemName: itemData.name,
            itemCode: itemData.code,
            quantity: itemData.quantity,
            action
        });
    }

    // Log user management activities
    async logUserManagement(action, userData) {
        return await this.logActivity(action, 'USER_MANAGEMENT', {
            message: `User ${action.toLowerCase()}: ${userData.fullName || userData.email}`,
            targetUser: userData.email,
            role: userData.role,
            action
        });
    }

    // Log expense activities
    async logExpense(action, expenseData) {
        return await this.logActivity(action, 'EXPENSES', {
            message: `Expense ${action.toLowerCase()}: ${expenseData.description}`,
            amount: expenseData.amount,
            category: expenseData.category,
            action
        });
    }

    // Log report activities
    async logReport(reportType) {
        return await this.logActivity('GENERATE_REPORT', 'REPORTS', {
            message: `Generated ${reportType} report`,
            reportType,
            generatedAt: new Date().toISOString()
        });
    }

    // Get session duration
    getSessionDuration() {
        if (!this.sessionStartTime) return 0;
        const duration = Date.now() - new Date(this.sessionStartTime).getTime();
        return Math.floor(duration / 1000); // seconds
    }

    // Clear logs (admin only)
    async clearLogs() {
        this.logs = [];
        localStorage.removeItem('vendify_audit_logs');
        console.log('🗑️ Audit logs cleared');
    }
}

// Create and export singleton instance
const auditLogger = new AuditLogger();
export default auditLogger;
