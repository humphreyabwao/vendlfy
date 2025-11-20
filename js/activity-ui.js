// Activity UI Manager
import activityTracker from './activity-tracker.js';

class ActivityUI {
    constructor() {
        this.currentFilters = {
            date: 'today',
            type: 'all',
            search: ''
        };
        this.currentPage = 1;
        this.itemsPerPage = 20;
        this.allActivities = [];
    }

    // Initialize activity log page
    async init() {
        console.log('🎯 Initializing Activity Log page...');
        
        // Set up filter buttons
        this.setupFilters();
        
        // Set up search
        this.setupSearch();
        
        // Set up pagination
        this.setupPagination();
        
        // Set up refresh button
        this.setupRefreshButton();
        
        // Set up export button
        this.setupExportButton();
        
        // Load activities
        await this.loadActivities();
        
        // Update stats
        await this.updateStats();
        
        // Start real-time updates
        this.startRealtimeUpdates();
    }

    // Setup filter buttons
    setupFilters() {
        const filterButtons = document.querySelectorAll('.activity-filter-btn');
        
        filterButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const filterType = btn.getAttribute('data-filter');
                const filterValue = btn.getAttribute('data-value');
                
                // Update active state
                document.querySelectorAll(`[data-filter="${filterType}"]`).forEach(b => {
                    b.classList.remove('active');
                });
                btn.classList.add('active');
                
                // Update filter
                this.currentFilters[filterType] = filterValue;
                this.currentPage = 1;
                
                // Reload activities
                this.loadActivities();
                this.updateStats();
            });
        });
    }

    // Setup search
    setupSearch() {
        const searchInput = document.getElementById('activitySearchInput');
        
        if (searchInput) {
            let searchTimeout;
            searchInput.addEventListener('input', (e) => {
                clearTimeout(searchTimeout);
                searchTimeout = setTimeout(() => {
                    this.currentFilters.search = e.target.value;
                    this.currentPage = 1;
                    this.loadActivities();
                }, 300);
            });
        }
    }

    // Setup pagination
    setupPagination() {
        const prevBtn = document.getElementById('prevActivitiesPage');
        const nextBtn = document.getElementById('nextActivitiesPage');
        
        if (prevBtn) {
            prevBtn.addEventListener('click', () => {
                if (this.currentPage > 1) {
                    this.currentPage--;
                    this.loadActivities();
                }
            });
        }
        
        if (nextBtn) {
            nextBtn.addEventListener('click', () => {
                const totalPages = Math.ceil(this.allActivities.length / this.itemsPerPage);
                if (this.currentPage < totalPages) {
                    this.currentPage++;
                    this.loadActivities();
                }
            });
        }
    }

    // Setup refresh button
    setupRefreshButton() {
        const refreshBtn = document.getElementById('refreshActivitiesBtn');
        
        if (refreshBtn) {
            refreshBtn.addEventListener('click', async () => {
                refreshBtn.classList.add('spinning');
                await this.loadActivities();
                await this.updateStats();
                setTimeout(() => {
                    refreshBtn.classList.remove('spinning');
                }, 500);
            });
        }
    }

    // Setup export button
    setupExportButton() {
        const exportBtn = document.getElementById('exportActivitiesBtn');
        
        if (exportBtn) {
            exportBtn.addEventListener('click', () => {
                this.exportActivities();
            });
        }
    }

    // Load activities
    async loadActivities() {
        try {
            // Get all activities with filters
            this.allActivities = await activityTracker.getActivities(this.currentFilters);
            
            // Apply search filter if needed
            if (this.currentFilters.search) {
                const searchLower = this.currentFilters.search.toLowerCase();
                this.allActivities = this.allActivities.filter(a => 
                    activityTracker.getActivityDescription(a).toLowerCase().includes(searchLower) ||
                    a.type.toLowerCase().includes(searchLower) ||
                    a.userName.toLowerCase().includes(searchLower)
                );
            }
            
            // Render activities
            this.renderActivities();
            
            // Update pagination
            this.updatePagination();
            
        } catch (error) {
            console.error('Error loading activities:', error);
        }
    }

    // Render activities
    renderActivities() {
        const timeline = document.getElementById('activitiesTimeline');
        if (!timeline) return;
        
        // Calculate pagination
        const startIdx = (this.currentPage - 1) * this.itemsPerPage;
        const endIdx = startIdx + this.itemsPerPage;
        const pageActivities = this.allActivities.slice(startIdx, endIdx);
        
        // Update count
        const countEl = document.getElementById('filteredActivityCount');
        if (countEl) {
            countEl.textContent = `${this.allActivities.length} activit${this.allActivities.length !== 1 ? 'ies' : 'y'}`;
        }
        
        if (pageActivities.length === 0) {
            timeline.innerHTML = `
                <div class="empty-state">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="8" x2="12" y2="12"></line>
                        <line x1="12" y1="16" x2="12.01" y2="16"></line>
                    </svg>
                    <p>No activities found</p>
                    <span>Try adjusting your filters</span>
                </div>
            `;
            return;
        }
        
        const html = pageActivities.map(activity => {
            const formatted = activityTracker.formatActivity(activity);
            return `
                <div class="activity-item" data-type="${activity.type}">
                    <div class="activity-icon activity-${formatted.color}">
                        ${formatted.icon}
                    </div>
                    <div class="activity-content">
                        <div class="activity-header">
                            <span class="activity-description">${formatted.description}</span>
                            <span class="activity-time">${formatted.timeAgo}</span>
                        </div>
                        <div class="activity-meta">
                            <span class="activity-user">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                                    <circle cx="12" cy="7" r="4"></circle>
                                </svg>
                                ${activity.userName}
                            </span>
                            ${activity.branchName ? `
                                <span class="activity-branch">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                                    </svg>
                                    ${activity.branchName}
                                </span>
                            ` : ''}
                            <span class="activity-type-badge badge-${formatted.color}">${activity.type}</span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        
        timeline.innerHTML = html;
    }

    // Update pagination
    updatePagination() {
        const totalPages = Math.ceil(this.allActivities.length / this.itemsPerPage);
        const pageInfo = document.getElementById('activitiesPageInfo');
        const prevBtn = document.getElementById('prevActivitiesPage');
        const nextBtn = document.getElementById('nextActivitiesPage');
        
        if (pageInfo) {
            pageInfo.textContent = `Page ${this.currentPage} of ${totalPages || 1}`;
        }
        
        if (prevBtn) {
            prevBtn.disabled = this.currentPage === 1;
        }
        
        if (nextBtn) {
            nextBtn.disabled = this.currentPage >= totalPages;
        }
    }

    // Update stats
    async updateStats() {
        try {
            const todayStats = await activityTracker.getActivityStats('today');
            const allStats = await activityTracker.getActivityStats('all');
            
            // Update total activities
            const totalEl = document.getElementById('totalActivitiesCount');
            if (totalEl) {
                totalEl.textContent = allStats.total;
            }
            
            // Update today's activities
            const todayEl = document.getElementById('todayActivitiesCount');
            if (todayEl) {
                todayEl.textContent = todayStats.total;
            }
            
            // Update most active module
            const moduleEl = document.getElementById('mostActiveModule');
            if (moduleEl) {
                moduleEl.textContent = todayStats.mostActive ? 
                    todayStats.mostActive.charAt(0).toUpperCase() + todayStats.mostActive.slice(1) : 
                    'N/A';
            }
            
            // Update active users
            const usersEl = document.getElementById('activeUsersCount');
            if (usersEl) {
                usersEl.textContent = Object.keys(todayStats.byUser).length || 1;
            }
            
        } catch (error) {
            console.error('Error updating stats:', error);
        }
    }

    // Start real-time updates
    startRealtimeUpdates() {
        activityTracker.startRealtimeListener((newActivity) => {
            console.log('📢 New activity received:', newActivity);
            
            // Check if activity page is active
            const activitiesPage = document.getElementById('activities-page');
            if (activitiesPage && activitiesPage.classList.contains('active')) {
                // Reload activities if on current page
                this.loadActivities();
                this.updateStats();
            }
        });
        
        // Also add a listener for manual updates
        activityTracker.addListener((newActivity) => {
            // Update dashboard recent activity
            this.updateDashboardActivity(newActivity);
        });
    }

    // Update dashboard recent activity
    async updateDashboardActivity(newActivity) {
        const container = document.getElementById('recentActivityContainer');
        if (!container) return;
        
        // Get today's activities
        const todayActivities = await activityTracker.getActivities({ 
            date: 'today', 
            limit: 10 
        });
        
        const emptyState = document.getElementById('activityEmptyState');
        
        if (todayActivities.length === 0) {
            if (emptyState) {
                emptyState.style.display = 'flex';
            }
            return;
        }
        
        if (emptyState) {
            emptyState.style.display = 'none';
        }
        
        // Render recent activities as table
        const html = `
            <table class="activity-table">
                <thead>
                    <tr>
                        <th>Type</th>
                        <th>Activity</th>
                        <th>User</th>
                        <th>Time</th>
                    </tr>
                </thead>
                <tbody>
                    ${todayActivities.slice(0, 10).map(activity => {
                        const formatted = activityTracker.formatActivity(activity);
                        return `
                            <tr class="activity-row">
                                <td>
                                    <div class="activity-type-cell">
                                        <div class="activity-icon-small activity-${formatted.color}">
                                            ${formatted.icon}
                                        </div>
                                        <span class="activity-type-label">${activity.type}</span>
                                    </div>
                                </td>
                                <td class="activity-description-cell">${formatted.description}</td>
                                <td class="activity-user-cell">${activity.userName}</td>
                                <td class="activity-time-cell">${formatted.timeAgo}</td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        `;
        
        container.innerHTML = html + (emptyState ? emptyState.outerHTML : '');
    }

    // Export activities
    exportActivities() {
        try {
            const data = this.allActivities.map(a => ({
                Date: new Date(a.timestamp).toLocaleString(),
                Type: a.type,
                Action: a.action,
                Description: activityTracker.getActivityDescription(a).replace(/<[^>]*>/g, ''),
                User: a.userName,
                Branch: a.branchName || 'N/A'
            }));
            
            // Convert to CSV
            const headers = Object.keys(data[0]);
            const csv = [
                headers.join(','),
                ...data.map(row => headers.map(h => `"${row[h] || ''}"`).join(','))
            ].join('\n');
            
            // Download
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `activities_${new Date().toISOString().split('T')[0]}.csv`;
            a.click();
            URL.revokeObjectURL(url);
            
            window.showNotification('Activities exported successfully', 'success');
        } catch (error) {
            console.error('Error exporting activities:', error);
            window.showNotification('Failed to export activities', 'error');
        }
    }
}

// Create singleton instance
const activityUI = new ActivityUI();

// Make it globally available
window.activityUI = activityUI;

export default activityUI;
