// Import branch and data managers
import branchManager from './branch-manager.js';
import dataManager from './data-manager.js';
import inventoryManager from './inventory.js';
import addItemManager from './add-item.js';
import posSystem from './pos.js';
import salesManager from './sales.js';
import expenseManager from './expenses.js';
import customerManager from './customers.js';
import b2bSalesManager from './b2b-sales.js';
import newB2BSaleManager from './new-b2b-sale.js';
import ordersManager from './orders.js';
import supplierManager from './suppliers.js';
import newOrderManager from './new-order.js';
import accountsManager from './accounts.js';
import reportsManager from './reports.js';
import userManager from './user-manager.js';
import activityTracker from './activity-tracker.js';
import activityUI from './activity-ui.js';
import globalSearch from './global-search.js';
import notificationManager from './notification-manager.js';
import auditLogger from './audit-logger.js';
import { initializeAuditTrail } from './audit-ui.js';

// Make managers globally available
window.branchManager = branchManager;
window.dataManager = dataManager;
window.inventoryManager = inventoryManager;
window.addItemManager = addItemManager;
window.posSystem = posSystem;
window.salesManager = salesManager;
window.expenseManager = expenseManager;
window.customerManager = customerManager;
window.b2bSalesManager = b2bSalesManager;
window.newB2BSaleManager = newB2BSaleManager;
window.ordersManager = ordersManager;
window.supplierManager = supplierManager;
window.newOrderManager = newOrderManager;
window.accountsManager = accountsManager;
window.reportsManager = reportsManager;
window.userManager = userManager;
window.activityTracker = activityTracker;
window.activityUI = activityUI;
window.globalSearch = globalSearch;
window.auditLogger = auditLogger;

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
    initSystemSettingsTabs();
    await initBranchSystem();
    globalSearch.init();
    notificationManager.init();
    await initializeAuditTrail();
}

// Initialize Branch System
async function initBranchSystem() {
    try {
        // Initialize branches
        await branchManager.initializeBranches();
        
        // Start real-time listeners
        branchManager.startRealtimeListener();
        
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
    await initDashboardActivities();
    
    // Set up periodic refresh for dashboard stats (every 30 seconds)
    setInterval(async () => {
        const dashboardPage = document.getElementById('dashboard-page');
        if (dashboardPage && dashboardPage.classList.contains('active')) {
            await refreshDashboardStats();
            await activityUI.updateDashboardActivity();
        }
    }, 30000);
}

// Make refreshDashboardStats globally available
window.refreshDashboardStats = async function() {
    await refreshDashboardStats();
};

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
    
    // Get user name from localStorage or Firebase
    let userName = 'User';
    
    // Try to get from localStorage first (faster)
    const storedUser = localStorage.getItem('currentUser');
    if (storedUser) {
        try {
            const user = JSON.parse(storedUser);
            userName = user.displayName || user.name || user.email?.split('@')[0] || 'User';
        } catch (e) {
            userName = storedUser;
        }
    }
    
    // Capitalize first letter
    userName = userName.charAt(0).toUpperCase() + userName.slice(1);
    
    greetingElement.textContent = `${greeting}, ${userName}`;
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
    const navLinks = document.querySelectorAll('[data-page]');
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
                
                // Initialize add-item page (init checks if already initialized)
                if (pageId === 'add-item') {
                    addItemManager.init();
                    // Reset form when navigating to add-item page
                    const form = document.getElementById('addItemForm');
                    if (form && addItemManager.initialized) {
                        form.reset();
                        // Focus on first input
                        document.getElementById('itemName')?.focus();
                    }
                }
                
                // Initialize POS page
                if (pageId === 'pos') {
                    posSystem.init();
                }
                
                // Initialize All Sales page
                if (pageId === 'all-sales') {
                    salesManager.init();
                }
                
                // Initialize Expenses page
                if (pageId === 'expenses') {
                    expenseManager.init();
                }
                
                // Initialize Reports page
                if (pageId === 'reports') {
                    reportsManager.init();
                    // Dispatch custom event to trigger data refresh
                    window.dispatchEvent(new CustomEvent('reportsPageShown'));
                }
                
                // Initialize Add Expense page
                if (pageId === 'add-expense') {
                    // Set default date to today
                    const dateInput = document.querySelector('#addExpenseForm input[name="date"]');
                    if (dateInput && !dateInput.value) {
                        dateInput.value = new Date().toISOString().split('T')[0];
                    }
                }
                
                // Initialize Customers page
                if (pageId === 'customers') {
                    customerManager.init();
                }
                
                // Initialize Add Customer page
                if (pageId === 'add-customer') {
                    // Clear form if it exists
                    const form = document.querySelector('#addCustomerForm');
                    if (form) {
                        form.reset();
                    }
                }
                
                // Initialize B2B Sales page
                if (pageId === 'b2b-sales') {
                    b2bSalesManager.init();
                }
                
                // Initialize New B2B Sale page
                if (pageId === 'new-b2b-sale') {
                    newB2BSaleManager.init();
                }

                // Initialize Orders page
                if (pageId === 'orders') {
                    ordersManager.init();
                }

                // Initialize Add Supplier page
                if (pageId === 'add-supplier') {
                    supplierManager.init();
                }

                // Initialize New Order page
                if (pageId === 'new-order') {
                    newOrderManager.init();
                }

                // Initialize Accounts page
                if (pageId === 'accounts') {
                    accountsManager.init();
                }

                // Initialize Reports page
                if (pageId === 'reports') {
                    reportsManager.init();
                }

                // Initialize Activities page
                if (pageId === 'activities') {
                    activityUI.init();
                }
                
                // Initialize New User page
                if (pageId === 'new-user') {
                    // Populate branch select dropdown
                    setTimeout(() => {
                        if (window.populateNewUserBranchSelect) {
                            window.populateNewUserBranchSelect();
                        }
                    }, 100);
                    // Clear form
                    const form = document.getElementById('newUserForm');
                    if (form) {
                        form.reset();
                    }
                    // Focus on email input
                    setTimeout(() => {
                        document.getElementById('newUserEmail')?.focus();
                    }, 150);
                }
                
                // Initialize Admin page
                if (pageId === 'admin') {
                    // Load branches and users lists
                    setTimeout(() => {
                        if (window.loadBranchesList) {
                            window.loadBranchesList();
                        }
                        if (window.loadUsersList) {
                            window.loadUsersList();
                        }
                    }, 100);
                }
            }
            
            // Close sidebar on mobile after selection
            if (window.innerWidth <= 768) {
                sidebar.classList.remove('active');
            }
        });
    });
}

// Initialize Dashboard Activities
async function initDashboardActivities() {
    try {
        // Load recent activities on dashboard
        await activityUI.updateDashboardActivity();
        
        // Start real-time listener for dashboard activities
        activityTracker.addListener((newActivity) => {
            console.log('📢 New activity detected on dashboard:', newActivity);
            // Update dashboard activity section in real-time
            activityUI.updateDashboardActivity();
        });
        
        // Set up View All button
        const viewAllBtn = document.getElementById('viewAllActivitiesBtn');
        if (viewAllBtn) {
            viewAllBtn.addEventListener('click', function() {
                const activitiesLink = document.querySelector('[data-page="activities"]');
                if (activitiesLink) {
                    activitiesLink.click();
                }
            });
        }
        
        console.log('✅ Dashboard activities initialized with real-time updates');
    } catch (error) {
        console.error('Error initializing dashboard activities:', error);
    }
}

// Profile Dropdown Management
function initProfileDropdown() {
    const profileBtn = document.getElementById('profileBtn');
    const profileDropdown = profileBtn.closest('.profile-dropdown');
    const profileMenuItems = profileDropdown.querySelectorAll('.profile-menu-item');
    
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

    // Handle profile menu item clicks
    profileMenuItems.forEach(item => {
        if (item.hasAttribute('data-page')) {
            item.addEventListener('click', function(e) {
                e.preventDefault();
                const page = this.getAttribute('data-page');
                showPage(page);
                profileDropdown.classList.remove('active');
            });
        }
    });
}

// System Settings Tab Management
function initSystemSettingsTabs() {
    const tabs = document.querySelectorAll('.settings-tab');
    const contents = document.querySelectorAll('.settings-content');

    tabs.forEach(tab => {
        tab.addEventListener('click', function() {
            const targetTab = this.getAttribute('data-tab');
            
            // Remove active class from all tabs
            tabs.forEach(t => t.classList.remove('active'));
            
            // Add active class to clicked tab
            this.classList.add('active');
            
            // Hide all content
            contents.forEach(content => content.classList.remove('active'));
            
            // Show target content
            const targetContent = document.getElementById(`${targetTab}-tab`);
            if (targetContent) {
                targetContent.classList.add('active');
            }
        });
    });

    // Handle form submissions
    const profileForm = document.getElementById('profileForm');
    if (profileForm) {
        profileForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            showNotification('Profile updated successfully!', 'success');
        });
    }

    const passwordForm = document.getElementById('passwordForm');
    if (passwordForm) {
        passwordForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            const newPassword = document.getElementById('newPassword').value;
            const confirmPassword = document.getElementById('confirmPassword').value;
            
            if (newPassword !== confirmPassword) {
                showNotification('Passwords do not match!', 'warning');
                return;
            }
            
            showNotification('Password updated successfully!', 'success');
            passwordForm.reset();
        });
    }

    const preferencesForm = document.getElementById('preferencesForm');
    if (preferencesForm) {
        preferencesForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            showNotification('Preferences saved successfully!', 'success');
        });
    }

    const notificationsForm = document.getElementById('notificationsForm');
    if (notificationsForm) {
        notificationsForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            showNotification('Notification settings saved!', 'success');
        });
    }

    // Dark mode toggle
    const darkModeToggle = document.getElementById('darkModeToggle');
    if (darkModeToggle) {
        // Set initial state based on current theme
        const currentTheme = document.documentElement.getAttribute('data-theme');
        darkModeToggle.checked = currentTheme === 'dark';
        
        darkModeToggle.addEventListener('change', function() {
            const themeToggleBtn = document.getElementById('themeToggle');
            if (themeToggleBtn) {
                themeToggleBtn.click();
            }
        });
    }

    // Load user data into profile form
    loadUserProfileData();
    
    // Initialize profile picture upload
    initProfilePictureUpload();
}

// Initialize Profile Picture Upload
function initProfilePictureUpload() {
    const uploadBtn = document.getElementById('uploadProfilePictureBtn');
    const removeBtn = document.getElementById('removeProfilePictureBtn');
    const fileInput = document.getElementById('profilePictureInput');
    const preview = document.getElementById('profilePicturePreview');
    const overlay = document.getElementById('profilePictureOverlay');
    
    if (!uploadBtn || !fileInput || !preview) return;
    
    // Load saved profile picture
    const savedPhoto = localStorage.getItem('profilePicture');
    if (savedPhoto) {
        displayProfilePicture(savedPhoto);
        if (removeBtn) removeBtn.style.display = 'inline-flex';
    }
    
    // Upload button click
    uploadBtn.addEventListener('click', () => {
        fileInput.click();
    });
    
    // Overlay click
    if (overlay) {
        overlay.addEventListener('click', () => {
            fileInput.click();
        });
    }
    
    // File input change
    fileInput.addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (!file) return;
        
        // Validate file type
        if (!file.type.startsWith('image/')) {
            showNotification('Please select an image file', 'warning');
            return;
        }
        
        // Validate file size (5MB max)
        if (file.size > 5 * 1024 * 1024) {
            showNotification('Image size must be less than 5MB', 'warning');
            return;
        }
        
        // Read and display image
        const reader = new FileReader();
        reader.onload = function(event) {
            const imageData = event.target.result;
            displayProfilePicture(imageData);
            
            // Save to localStorage
            localStorage.setItem('profilePicture', imageData);
            
            // Update profile avatar in header
            updateHeaderProfileAvatar(imageData);
            
            // Show remove button
            if (removeBtn) removeBtn.style.display = 'inline-flex';
            
            showNotification('Profile picture updated successfully!', 'success');
        };
        reader.readAsDataURL(file);
    });
    
    // Remove button click
    if (removeBtn) {
        removeBtn.addEventListener('click', () => {
            if (confirm('Are you sure you want to remove your profile picture?')) {
                removeProfilePicture();
                removeBtn.style.display = 'none';
                showNotification('Profile picture removed', 'info');
            }
        });
    }
}

// Display Profile Picture
function displayProfilePicture(imageData) {
    const preview = document.getElementById('profilePicturePreview');
    if (!preview) return;
    
    // Create or update image element
    let img = preview.querySelector('img');
    if (!img) {
        // Remove SVG if exists
        const svg = preview.querySelector('svg');
        if (svg) svg.remove();
        
        img = document.createElement('img');
        preview.appendChild(img);
    }
    
    img.src = imageData;
    img.alt = 'Profile Picture';
}

// Remove Profile Picture
function removeProfilePicture() {
    const preview = document.getElementById('profilePicturePreview');
    if (!preview) return;
    
    // Remove image
    const img = preview.querySelector('img');
    if (img) img.remove();
    
    // Add back SVG
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '80');
    svg.setAttribute('height', '80');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.5');
    
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2');
    svg.appendChild(path);
    
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', '12');
    circle.setAttribute('cy', '7');
    circle.setAttribute('r', '4');
    svg.appendChild(circle);
    
    preview.appendChild(svg);
    
    // Remove from localStorage
    localStorage.removeItem('profilePicture');
    
    // Update header avatar
    updateHeaderProfileAvatar(null);
}

// Update Header Profile Avatar
function updateHeaderProfileAvatar(imageData) {
    const profileAvatar = document.querySelector('.profile-avatar');
    if (!profileAvatar) return;
    
    if (imageData) {
        // Add image
        let img = profileAvatar.querySelector('img');
        if (!img) {
            const svg = profileAvatar.querySelector('svg');
            if (svg) svg.style.display = 'none';
            
            img = document.createElement('img');
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.objectFit = 'cover';
            img.style.borderRadius = '50%';
            profileAvatar.appendChild(img);
        }
        img.src = imageData;
    } else {
        // Remove image, show SVG
        const img = profileAvatar.querySelector('img');
        if (img) img.remove();
        
        const svg = profileAvatar.querySelector('svg');
        if (svg) svg.style.display = 'block';
    }
}

// Load User Profile Data
function loadUserProfileData() {
    const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
    
    const emailInput = document.getElementById('profileEmail');
    const nameInput = document.getElementById('profileFullName');
    const roleInput = document.getElementById('profileRole');
    
    if (emailInput) emailInput.value = currentUser.email || '';
    if (nameInput) nameInput.value = currentUser.displayName || currentUser.name || '';
    if (roleInput) roleInput.value = currentUser.role || 'Administrator';
    
    // Load profile picture in header if exists
    const savedPhoto = localStorage.getItem('profilePicture');
    if (savedPhoto) {
        updateHeaderProfileAvatar(savedPhoto);
    }
    
    // Update last login time
    const lastLoginTime = document.getElementById('lastLoginTime');
    if (lastLoginTime) {
        const now = new Date();
        lastLoginTime.textContent = now.toLocaleString();
    }
}

// Refresh Dashboard Stats
async function refreshDashboardStats() {
    try {
        const stats = await dataManager.getDashboardStats();
        
        // Update dashboard stat cards directly by ID
        const todaysSalesEl = document.getElementById('dashboardTodaysSales');
        const todaysExpensesEl = document.getElementById('dashboardTodaysExpenses');
        const profitLossEl = document.getElementById('dashboardProfitLoss');
        const totalCustomersEl = document.getElementById('dashboardTotalCustomers');
        const pendingB2BEl = document.getElementById('dashboardPendingB2B');
        
        if (todaysSalesEl) {
            todaysSalesEl.textContent = formatCurrency(stats.todaysSales);
        }
        
        if (todaysExpensesEl) {
            todaysExpensesEl.textContent = formatCurrency(stats.todaysExpenses);
        }
        
        if (profitLossEl) {
            profitLossEl.textContent = formatCurrency(stats.profitLoss);
            // Update class based on profit or loss
            profitLossEl.className = 'stat-value';
            if (stats.profitLoss >= 0) {
                profitLossEl.classList.add('profit');
            } else {
                profitLossEl.classList.add('loss');
            }
        }
        
        if (totalCustomersEl) {
            totalCustomersEl.textContent = stats.totalCustomers;
        }
        
        if (pendingB2BEl) {
            pendingB2BEl.textContent = stats.pendingB2BOrders;
        }
        
        // Also update using the old method for other stats
        updateStatValue('stockValue', stats.stockValue);
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
