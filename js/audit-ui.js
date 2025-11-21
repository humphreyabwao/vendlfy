// Audit Trail UI Handler
import auditLogger from './audit-logger.js';
import userManager from './user-manager.js';

// Global functions
window.refreshAuditLogs = refreshAuditLogs;
window.filterAuditLogs = filterAuditLogs;

let currentFilter = '';

// Initialize audit trail
export async function initializeAuditTrail() {
    try {
        console.log('🔍 Initializing audit trail...');
        
        // Load initial logs
        await loadAuditLogs();
        
        // Start real-time listener
        auditLogger.startRealtimeListener(handleRealtimeUpdate);
        
        console.log('✅ Audit trail initialized');
    } catch (error) {
        console.error('❌ Error initializing audit trail:', error);
    }
}

// Load audit logs
async function loadAuditLogs(filters = {}) {
    try {
        const logs = await auditLogger.loadLogs(filters);
        renderAuditLogs(logs);
        updateAuditStats(logs);
    } catch (error) {
        console.error('❌ Error loading audit logs:', error);
        showError('Failed to load audit logs');
    }
}

// Render audit logs table
function renderAuditLogs(logs) {
    const tbody = document.getElementById('auditLogsTableBody');
    if (!tbody) return;

    if (logs.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; padding: 40px;">
                    <div style="color: var(--text-secondary);">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" style="margin-bottom: 12px;">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                            <polyline points="14 2 14 8 20 8"></polyline>
                            <line x1="16" y1="13" x2="8" y2="13"></line>
                            <line x1="16" y1="17" x2="8" y2="17"></line>
                            <polyline points="10 9 9 9 8 9"></polyline>
                        </svg>
                        <div>No audit logs found</div>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = logs.map(log => {
        const timestamp = formatTimestamp(log.timestamp);
        const category = formatCategory(log.actionCategory);
        const action = formatAction(log.actionType);
        const details = formatDetails(log.details);
        const device = log.deviceInfo?.type || 'Unknown';
        const ip = log.ipAddress || 'Unknown';

        return `
            <tr>
                <td>
                    <div style="font-weight: 500;">${timestamp.date}</div>
                    <div style="font-size: 11px; color: var(--text-tertiary);">${timestamp.time}</div>
                </td>
                <td>
                    <div style="font-weight: 500;">${log.userName || 'Unknown'}</div>
                    <div style="font-size: 11px; color: var(--text-tertiary);">${log.userEmail || ''}</div>
                </td>
                <td>
                    <span class="category-badge category-${log.actionCategory.toLowerCase()}">${category}</span>
                </td>
                <td>
                    <span class="action-badge">${action}</span>
                </td>
                <td>
                    <div style="font-size: 13px;">${details}</div>
                </td>
                <td>
                    <div style="font-size: 13px;">${device}</div>
                    <div style="font-size: 11px; color: var(--text-tertiary);">${log.browserInfo?.name || ''}</div>
                </td>
                <td>
                    <div style="font-size: 13px; font-family: monospace;">${ip}</div>
                </td>
            </tr>
        `;
    }).join('');
}

// Update audit statistics
function updateAuditStats(logs) {
    // Total count
    const totalCount = document.getElementById('auditTotalCount');
    if (totalCount) {
        totalCount.textContent = logs.length;
    }

    // Active users today
    const today = new Date().toISOString().split('T')[0];
    const todayLogs = logs.filter(log => log.timestamp.startsWith(today));
    const uniqueUsers = new Set(todayLogs.map(log => log.userId));
    
    const activeUsers = document.getElementById('auditActiveUsers');
    if (activeUsers) {
        activeUsers.textContent = uniqueUsers.size;
    }

    // Last activity
    const lastActivity = document.getElementById('auditLastActivity');
    if (lastActivity && logs.length > 0) {
        const lastLog = logs[0];
        const time = formatRelativeTime(lastLog.timestamp);
        lastActivity.textContent = time;
    }
}

// Format timestamp
function formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    return {
        date: date.toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric', 
            year: 'numeric' 
        }),
        time: date.toLocaleTimeString('en-US', { 
            hour: '2-digit', 
            minute: '2-digit',
            second: '2-digit'
        })
    };
}

// Format relative time
function formatRelativeTime(timestamp) {
    const now = new Date();
    const date = new Date(timestamp);
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
}

// Format category
function formatCategory(category) {
    const categories = {
        'AUTH': 'Authentication',
        'SALES': 'Sales',
        'INVENTORY': 'Inventory',
        'EXPENSES': 'Expenses',
        'USER_MANAGEMENT': 'User Mgmt',
        'REPORTS': 'Reports'
    };
    return categories[category] || category;
}

// Format action type
function formatAction(action) {
    return action.replace(/_/g, ' ').toLowerCase()
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

// Format details
function formatDetails(details) {
    if (!details) return '-';
    
    if (details.message) {
        return details.message;
    }
    
    // Build a summary from details object
    const parts = [];
    if (details.amount) parts.push(`Amount: $${details.amount}`);
    if (details.itemCount) parts.push(`Items: ${details.itemCount}`);
    if (details.customer) parts.push(`Customer: ${details.customer}`);
    if (details.itemName) parts.push(`Item: ${details.itemName}`);
    if (details.quantity) parts.push(`Qty: ${details.quantity}`);
    
    return parts.join(', ') || JSON.stringify(details);
}

// Handle real-time updates
function handleRealtimeUpdate(logs) {
    console.log('🔄 Audit logs updated in real-time');
    renderAuditLogs(logs);
    updateAuditStats(logs);
}

// Refresh audit logs
async function refreshAuditLogs() {
    console.log('🔄 Refreshing audit logs...');
    const filter = document.getElementById('auditCategoryFilter')?.value || '';
    await loadAuditLogs(filter ? { actionCategory: filter } : {});
}

// Filter audit logs
async function filterAuditLogs() {
    const category = document.getElementById('auditCategoryFilter')?.value || '';
    currentFilter = category;
    
    console.log('🔍 Filtering by category:', category || 'All');
    await loadAuditLogs(category ? { actionCategory: category } : {});
}

// Show error message
function showError(message) {
    const tbody = document.getElementById('auditLogsTableBody');
    if (tbody) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; padding: 40px;">
                    <div style="color: var(--error-color);">${message}</div>
                </td>
            </tr>
        `;
    }
}

// Export functions
export { refreshAuditLogs, filterAuditLogs };
