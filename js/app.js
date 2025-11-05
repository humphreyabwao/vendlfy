// Import branch and data managers
import branchManager from './branch-manager.js';
import dataManager from './data-manager.js';
import inventoryManager from './inventory.js';
import addItemManager from './add-item.js';
import posSystem from './pos.js';

// Make managers globally available
window.branchManager = branchManager;
window.dataManager = dataManager;
window.inventoryManager = inventoryManager;
window.addItemManager = addItemManager;
window.posSystem = posSystem;

// App Initialization
document.addEventListener('DOMContentLoaded', async function() {
    await initializeApp();
    await initializeDashboard();
});

async function initializeApp() {
    initTheme();
    initSidebar();
    initNavigation();
    initProfileDropdown();
    await initBranchSystem();
}

// Initialize Branch System
async function initBranchSystem() {
    try {
        // Initialize branches
        await branchManager.initializeBranches();
        
        // Populate branch selector
        await populateBranchSelector();
        
        // Listen for branch changes
        window.addEventListener('branchChanged', handleBranchChange);
        
        console.log('Branch system initialized');
    } catch (error) {
        console.error('Error initializing branch system:', error);
    }
}

// Populate branch selector dropdown
async function populateBranchSelector() {
    const branchSelect = document.getElementById('branchSelect');
    if (!branchSelect) return;
    
    const branches = branchManager.getAllBranches();
    const currentBranch = branchManager.getCurrentBranch();
    
    // Clear existing options
    branchSelect.innerHTML = '';
    
    // Add "All Branches" option
    const allOption = document.createElement('option');
    allOption.value = 'all';
    allOption.textContent = 'All Branches';
    branchSelect.appendChild(allOption);
    
    // Add branch options
    branches.forEach(branch => {
        const option = document.createElement('option');
        option.value = branch.id;
        option.textContent = branch.name;
        branchSelect.appendChild(option);
    });
    
    // Set current branch
    if (currentBranch) {
        branchSelect.value = currentBranch.id === 'all' ? 'all' : currentBranch.id;
    }
    
    // Handle branch change
    branchSelect.addEventListener('change', function() {
        if (this.value === 'all') {
            branchManager.setViewAllBranches();
        } else {
            branchManager.switchBranch(this.value);
        }
    });
}

// Handle branch change event
async function handleBranchChange(event) {
    const branch = event.detail;
    console.log('Branch changed to:', branch.name);
    
    // Refresh dashboard stats
    await refreshDashboardStats();
    
    // Refresh inventory if on inventory page
    const inventoryPage = document.getElementById('inventory-page');
    if (inventoryPage && inventoryPage.classList.contains('active')) {
        await inventoryManager.refresh();
    }
    
    // Show notification
    window.showNotification(`Switched to ${branch.name}`, 'success');
}

// Dashboard Initialization
async function initializeDashboard() {
    updateGreeting();
    updateDate();
    initQuickActions();
    await refreshDashboardStats();
}

function updateGreeting() {
    const greetingElement = document.getElementById('greetingText');
    if (!greetingElement) return;
    
    const hour = new Date().getHours();
    let greeting = 'Good Evening';
    
    if (hour < 12) {
        greeting = 'Good Morning';
    } else if (hour < 18) {
        greeting = 'Good Afternoon';
    }
    
    greetingElement.textContent = `${greeting}, User`;
}

function updateDate() {
    const dateElement = document.getElementById('currentDate');
    if (!dateElement) return;
    
    const now = new Date();
    const options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
    const formattedDate = now.toLocaleDateString('en-US', options);
    
    dateElement.textContent = formattedDate;
}

function initQuickActions() {
    const actionCards = document.querySelectorAll('.action-card[data-page]');
    
    actionCards.forEach(card => {
        card.addEventListener('click', function() {
            const pageId = this.getAttribute('data-page');
            
            // Update active link
            const navLinks = document.querySelectorAll('.nav-link[data-page], .submenu a[data-page]');
            navLinks.forEach(l => l.classList.remove('active'));
            
            const targetNavLink = document.querySelector(`[data-page="${pageId}"]`);
            if (targetNavLink) {
                targetNavLink.classList.add('active');
            }
            
            // Show selected page
            const pages = document.querySelectorAll('.page');
            pages.forEach(page => page.classList.remove('active'));
            const targetPage = document.getElementById(pageId + '-page');
            if (targetPage) {
                targetPage.classList.add('active');
            }
        });
    });
}

// Theme Management
function initTheme() {
    const themeToggle = document.getElementById('themeToggle');
    const savedTheme = localStorage.getItem('theme') || 'light';
    
    document.documentElement.setAttribute('data-theme', savedTheme);
    
    themeToggle.addEventListener('click', function() {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
    });
}

// Sidebar Management
function initSidebar() {
    const toggleBtn = document.getElementById('toggleSidebar');
    const sidebar = document.getElementById('sidebar');
    
    toggleBtn.addEventListener('click', function() {
        sidebar.classList.toggle('collapsed');
        
        // On mobile, toggle active class instead
        if (window.innerWidth <= 768) {
            sidebar.classList.toggle('active');
        }
    });
    
    // Handle submenu toggles
    const hasSubmenuItems = document.querySelectorAll('.nav-item.has-submenu');
    
    hasSubmenuItems.forEach(item => {
        const link = item.querySelector('.nav-link');
        
        link.addEventListener('click', function(e) {
            // Don't prevent default if sidebar is collapsed
            if (!sidebar.classList.contains('collapsed')) {
                e.preventDefault();
                item.classList.toggle('active');
            }
        });
    });
}

// Navigation Management
function initNavigation() {
    const navLinks = document.querySelectorAll('.nav-link[data-page], .submenu a[data-page]');
    const pages = document.querySelectorAll('.page');
    const sidebar = document.getElementById('sidebar');
    
    navLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            
            const pageId = this.getAttribute('data-page');
            
            // Update active link
            navLinks.forEach(l => l.classList.remove('active'));
            this.classList.add('active');
            
            // Show selected page
            pages.forEach(page => page.classList.remove('active'));
            const targetPage = document.getElementById(pageId + '-page');
            if (targetPage) {
                targetPage.classList.add('active');
                
                // Initialize inventory page if that's what we're navigating to
                if (pageId === 'inventory') {
                    inventoryManager.init();
                }
                
                // Initialize add-item page
                if (pageId === 'add-item') {
                    addItemManager.init();
                }
                
                // Initialize POS page
                if (pageId === 'pos') {
                    posSystem.init();
                }
            }
            
            // Close sidebar on mobile after selection
            if (window.innerWidth <= 768) {
                sidebar.classList.remove('active');
            }
        });
    });
}

// Profile Dropdown Management
function initProfileDropdown() {
    const profileBtn = document.getElementById('profileBtn');
    const profileDropdown = profileBtn.closest('.profile-dropdown');
    
    profileBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        profileDropdown.classList.toggle('active');
    });
    
    // Close dropdown when clicking outside
    document.addEventListener('click', function(e) {
        if (!profileDropdown.contains(e.target)) {
            profileDropdown.classList.remove('active');
        }
    });
}

// Refresh Dashboard Stats
async function refreshDashboardStats() {
    try {
        const stats = await dataManager.getDashboardStats();
        
        // Update stat values
        updateStatValue('todaysSales', stats.todaysSales);
        updateStatValue('todaysExpenses', stats.todaysExpenses);
        updateStatValue('profitLoss', stats.profitLoss, stats.profitLoss >= 0 ? 'profit' : 'loss');
        updateStatValue('totalCustomers', stats.totalCustomers, null, false);
        updateStatValue('stockValue', stats.stockValue);
        updateStatValue('pendingB2BOrders', stats.pendingB2BOrders, null, false);
        updateStatValue('activeBranches', stats.activeBranches, null, false);
        updateStatValue('outOfStock', stats.outOfStock, 'warning', false);
        
    } catch (error) {
        console.error('Error refreshing dashboard stats:', error);
    }
}

// Update individual stat value
function updateStatValue(statId, value, className = null, isCurrency = true) {
    const elements = document.querySelectorAll(`.stat-card .stat-value`);
    const statLabels = {
        'todaysSales': "Today's Sales",
        'todaysExpenses': "Today's Expenses",
        'profitLoss': 'Profit/Loss',
        'totalCustomers': 'Total Customers',
        'stockValue': 'Stock Value',
        'pendingB2BOrders': 'Pending B2B Orders',
        'activeBranches': 'Active Branches',
        'outOfStock': 'Out of Stock'
    };
    
    elements.forEach(element => {
        const card = element.closest('.stat-card');
        const label = card.querySelector('.stat-label').textContent;
        
        if (label === statLabels[statId]) {
            element.textContent = isCurrency ? formatCurrency(value) : value;
            
            // Update class for profit/loss/warning
            if (className) {
                element.className = 'stat-value';
                element.classList.add(className);
            }
        }
    });
}

// Utility Functions - Make them global
window.showNotification = function showNotification(message, type = 'info') {
    // Simple notification display
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        top: 80px;
        right: 20px;
        padding: 16px 24px;
        background: ${type === 'success' ? 'var(--primary-green)' : type === 'info' ? 'var(--primary-blue)' : 'var(--primary-orange)'};
        color: white;
        border-radius: 8px;
        box-shadow: var(--shadow-lg);
        z-index: 10000;
        animation: slideIn 0.3s ease;
        font-family: 'Montserrat', sans-serif;
        font-size: 14px;
        font-weight: 500;
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

window.formatCurrency = function formatCurrency(amount) {
    return `KSh ${amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

window.formatDate = function formatDate(date) {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

window.formatDateTime = function formatDateTime(date) {
    return new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    }).format(new Date(date));
}

// Local function that uses global formatCurrency
function formatCurrency(amount) {
    return window.formatCurrency(amount);
}

function formatDate(date) {
    return new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    }).format(new Date(date));
}
