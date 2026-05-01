// Import branch and data managers
import branchManager from './branch-manager.js';
import dataManager from './data-manager.js';
import inventoryManager from './inventory.js';
import addItemManager from './add-item.js';
import inventoryImporter from './import-inventory.js';
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
import sessionManager from './session-manager.js';
import permissionGuard from './permission-guard.js';
import brandManager from './brand-manager.js';
import brandUI from './brand-ui.js';
import tenantsManager from './tenants.js';
import cashInjectionsManager from './cash-injections.js';
import venturesManager from './ventures.js';
import hrManager from './hr.js';
import { auth, signOut } from './firebase-config.js';
import { setBtnState, friendlyError } from './ui-feedback.js';

// Make managers globally available
window.branchManager = branchManager;
window.dataManager = dataManager;
window.inventoryManager = inventoryManager;
window.addItemManager = addItemManager;
window.inventoryImporter = inventoryImporter;
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
window.sessionManager = sessionManager;
window.permissionGuard = permissionGuard;
window.brandManager = brandManager;
window.brandUI = brandUI;
window.tenantsManager = tenantsManager;
window.cashInjectionsManager = cashInjectionsManager;
window.venturesManager = venturesManager;
window.hrManager = hrManager;
// populateBranchSelector is set on window after definition below

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
    brandManager.init();
    brandUI.init();
    await initBranchSystem();
    globalSearch.init();
    notificationManager.init();
    await initializeAuditTrail();
    initInitialPageGuard();
}

/**
 * After the session profile is ready, ensure the user's landing page is one
 * they can actually access. Without this, a non-admin without dashboard.view
 * would see the dashboard markup on first load (because the dashboard is the
 * default .page.active in the HTML, even after their nav link is hidden).
 *
 * Live updates after this point are handled by permissionGuard.onSessionChanged().
 */
function initInitialPageGuard() {
    const enforce = () => {
        if (!sessionManager.isProfileLoaded()) return;
        permissionGuard.enforceCurrentPage({ silent: true });
    };
    enforce();
    sessionManager.ready?.().then(enforce).catch(() => {});
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

function _bindBranchSelectChangeOnce(branchSelect) {
    if (branchSelect.dataset.vendifyBranchListener === '1') return;
    branchSelect.dataset.vendifyBranchListener = '1';
    branchSelect.addEventListener('change', function () {
        const val = this.value;
        if (!val) return;
        const allowedIds = sessionManager.getAllowedBranchIds();
        const canSeeAll = sessionManager.canAccessAllBranches();
        if (!canSeeAll && allowedIds && !allowedIds.includes(val) && val !== 'all') {
            window.showNotification('You are not authorized to access that branch.', 'error');
            const cur = branchManager.getCurrentBranch();
            const all = branchManager.getAllBranches();
            const vis = canSeeAll
                ? all
                : all.filter((b) => allowedIds && allowedIds.includes(b.id));
            if (cur?.code === 'ALL' && canSeeAll) this.value = 'all';
            else this.value = cur?.id || vis[0]?.id || '';
            return;
        }
        if (val === 'all') {
            branchManager.setViewAllBranches();
        } else {
            branchManager.switchBranch(val);
        }
    });
}

// Populate branch selector dropdown — respects session RBAC
async function populateBranchSelector() {
    const branchSelect = document.getElementById('branchSelect');
    if (!branchSelect) return;

    const profileReady = sessionManager.isProfileLoaded();
    const allBranches = branchManager.getAllBranches();
    const currentBranch = branchManager.getCurrentBranch();

    const allowedIds = sessionManager.getAllowedBranchIds();
    const canSeeAll = sessionManager.canAccessAllBranches();

    // Defer: don't bake in "No branch assigned" before profile or branches finish loading.
    // Without this guard, non-admin staff briefly see "No branch assigned" even after branches
    // were assigned correctly — because populateBranchSelector ran before the profile arrived.
    if (!profileReady || (!canSeeAll && allBranches.length === 0)) {
        const mark = 'loading';
        if (branchSelect.dataset.branchPopulateMark !== mark) {
            branchSelect.dataset.branchPopulateMark = mark;
            branchSelect.innerHTML = '<option value="">Loading branches…</option>';
        }
        branchSelect.disabled = true;
        return;
    }

    const visibleBranches = canSeeAll
        ? allBranches
        : allBranches.filter((b) => allowedIds && allowedIds.includes(b.id));

    // Profile loaded + branches loaded, but the user's branchIds don't match any existing branch.
    // Flag it loudly in the console so we can tell "really no branch" from a stale id mismatch.
    if (
        !canSeeAll &&
        Array.isArray(allowedIds) &&
        allowedIds.length > 0 &&
        visibleBranches.length === 0
    ) {
        const allIds = allBranches.map((b) => b.id);
        console.warn(
            '[branchSelector] User has assigned branches but none match loaded branch ids.',
            { assigned: allowedIds, available: allIds }
        );
    }

    const optSig = `${canSeeAll ? 1 : 0}:${visibleBranches.map((b) => b.id).join(',')}`;

    let desired = '';
    if (currentBranch) {
        if (currentBranch.code === 'ALL' && canSeeAll) {
            desired = 'all';
        } else if (canSeeAll || (allowedIds && allowedIds.includes(currentBranch.id))) {
            desired = currentBranch.id;
        } else if (visibleBranches.length > 0) {
            desired = visibleBranches[0].id;
        }
    } else if (canSeeAll) {
        desired = 'all';
    } else if (visibleBranches.length > 0) {
        desired = visibleBranches[0].id;
    }

    // Single allowed branch — locked control
    if (!canSeeAll && visibleBranches.length === 1) {
        const onlyId = visibleBranches[0].id;
        const mark = `one:${onlyId}`;
        if (branchSelect.dataset.branchPopulateMark !== mark) {
            branchSelect.dataset.branchPopulateMark = mark;
            branchSelect.innerHTML = '';
            const opt = document.createElement('option');
            opt.value = onlyId;
            opt.textContent = visibleBranches[0].name;
            branchSelect.appendChild(opt);
        }
        branchSelect.disabled = true;
        branchSelect.value = onlyId;
        if (branchManager.getCurrentBranch()?.id !== onlyId) {
            branchManager.switchBranch(onlyId);
        }
        _bindBranchSelectChangeOnce(branchSelect);
        return;
    }

    if (!canSeeAll && visibleBranches.length === 0) {
        const hasMismatch =
            Array.isArray(allowedIds) && allowedIds.length > 0 && allBranches.length > 0;
        const mark = hasMismatch ? 'mismatch' : 'none';
        if (branchSelect.dataset.branchPopulateMark !== mark) {
            branchSelect.dataset.branchPopulateMark = mark;
            branchSelect.innerHTML = hasMismatch
                ? '<option value="">Assigned branch not found — contact admin</option>'
                : '<option value="">No branch assigned</option>';
        }
        branchSelect.disabled = true;
        _bindBranchSelectChangeOnce(branchSelect);
        return;
    }

    const multiMark = `multi:${optSig}`;
    const needOptionRebuild = branchSelect.dataset.branchPopulateMark !== multiMark;

    branchSelect.disabled = false;
    if (needOptionRebuild) {
        branchSelect.dataset.branchPopulateMark = multiMark;
        branchSelect.innerHTML = '';
        if (canSeeAll) {
            const allOpt = document.createElement('option');
            allOpt.value = 'all';
            allOpt.textContent = 'All Branches';
            branchSelect.appendChild(allOpt);
        }
        visibleBranches.forEach((branch) => {
            const opt = document.createElement('option');
            opt.value = branch.id;
            opt.textContent = branch.name;
            branchSelect.appendChild(opt);
        });
    }

    const hasDesired =
        desired && [...branchSelect.options].some((o) => o.value === String(desired));
    if (!hasDesired) {
        desired = canSeeAll ? 'all' : visibleBranches[0]?.id || '';
    }
    if (desired && branchSelect.value !== desired) {
        branchSelect.value = desired;
    }

    if (
        visibleBranches.length > 0 &&
        currentBranch &&
        !canSeeAll &&
        allowedIds &&
        !allowedIds.includes(currentBranch.id) &&
        currentBranch.code !== 'ALL'
    ) {
        const firstId = visibleBranches[0].id;
        if (branchManager.getCurrentBranch()?.id !== firstId) {
            branchManager.switchBranch(firstId);
        }
    } else if (!currentBranch && visibleBranches.length > 0 && !canSeeAll) {
        const firstId = visibleBranches[0].id;
        if (branchManager.getCurrentBranch()?.id !== firstId) {
            branchManager.switchBranch(firstId);
        }
    }

    _bindBranchSelectChangeOnce(branchSelect);
}

// Expose populateBranchSelector globally (used by session-manager and permission-guard callbacks)
window.populateBranchSelector = populateBranchSelector;

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
    
    // Periodic dashboard refresh — only when the dashboard page is visible
    // and the tab is in the foreground. Each call fans out to ~5 collection
    // reads (sales×2 + expenses + customers + inventory) so we keep this on
    // a long cadence to avoid Firestore quota drain.
    setInterval(async () => {
        if (document.visibilityState !== 'visible') return;
        const dashboardPage = document.getElementById('dashboard-page');
        if (dashboardPage && dashboardPage.classList.contains('active')) {
            await refreshDashboardStats();
            await activityUI.updateDashboardActivity();
        }
    }, 120000);
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

            // Permission guard check
            const denial = permissionGuard.guardNavigation(pageId);
            if (denial) {
                window.showNotification(denial, 'error');
                return;
            }
            
            // Update active link
            navLinks.forEach(l => l.classList.remove('active'));
            this.classList.add('active');

            // Tear down reports' 6 long-lived Firestore onSnapshot listeners
            // when leaving the reports page. Otherwise they stay subscribed
            // for the lifetime of the tab and consume reads on every doc change.
            if (pageId !== 'reports' && window.reportsManager?.initialized) {
                try { window.reportsManager.destroy(); } catch (_) {}
            }

            // Show selected page
            pages.forEach(page => page.classList.remove('active'));
            const targetPage = document.getElementById(pageId + '-page');
            if (targetPage) {
                targetPage.classList.add('active');
                
                // Initialize inventory page if that's what we're navigating to
                if (pageId === 'inventory') {
                    inventoryManager.init();
                    inventoryImporter.init();
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

                // Initialize HR / Staff pages
                if (pageId === 'hr-staff') {
                    hrManager.init();
                }
                if (pageId === 'add-staff') {
                    if (!hrManager.initialized) hrManager.init();
                    else hrManager.bindEventListeners();
                    const form = document.getElementById('addStaffForm');
                    if (form && !hrManager._editingIntent) {
                        form.reset();
                        form.dataset.editingId = '';
                        const header = document.getElementById('addStaffHeader');
                        if (header) header.textContent = 'Add Staff';
                        const submitSpan = form.querySelector('button[type="submit"] span');
                        if (submitSpan) submitSpan.textContent = ' Add Staff';
                        const hireDate = form.querySelector('input[name="hireDate"]');
                        if (hireDate && !hireDate.value) hireDate.value = new Date().toISOString().split('T')[0];
                    }
                    hrManager._editingIntent = false;
                    hrManager._onSalaryTypeChange?.();
                }
                if (pageId === 'pay-staff') {
                    if (!hrManager.initialized) hrManager.init();
                    else { hrManager.bindEventListeners(); hrManager.populateStaffSelectors(); }
                    hrManager._setDefaultPaymentDate?.();
                    hrManager._recalcPaymentTotal?.();
                }
                if (pageId === 'salary-history') {
                    (async () => {
                        if (!hrManager.initialized) await hrManager.init();
                        else { hrManager.bindEventListeners(); hrManager.populateStaffSelectors(); hrManager.renderPaymentHistory(); }
                    })();
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
                    // Refresh account stats to show real-time data
                    if (window.refreshAccountStats) {
                        window.refreshAccountStats();
                    }
                }

                // Initialize Activities page
                if (pageId === 'activities') {
                    activityUI.init();
                }

                // Initialize Tenants page
                if (pageId === 'tenants') {
                    tenantsManager.init();
                    // Submenu shortcuts: open the right modal/view
                    const action = this.getAttribute('data-action');
                    setTimeout(() => {
                        if (action === 'add-tenant') {
                            tenantsManager.openTenantModal();
                        } else if (action === 'rent-payments') {
                            if (tenantsManager.currentView !== 'payments') tenantsManager.toggleView();
                        }
                    }, 50);
                }

                // Initialize Ventures page (always reset to list view when nav is clicked)
                if (pageId === 'ventures') {
                    venturesManager.init();
                    venturesManager.backToList();
                    const action = this.getAttribute('data-action');
                    if (action === 'create-venture') {
                        setTimeout(() => venturesManager.openVentureModal(), 60);
                    }
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
        // Kick off the real-time activity stream (one shared listener for the whole app)
        activityTracker.start();

        // Render the dashboard panel once the stream has data
        await activityUI.updateDashboardActivity();

        // Live-refresh the dashboard panel on every stream change
        activityTracker.onChange(() => {
            const dashboardPage = document.getElementById('dashboard-page');
            if (dashboardPage && dashboardPage.classList.contains('active')) {
                activityUI.updateDashboardActivity();
            }
        });

        // Set up View All button
        const viewAllBtn = document.getElementById('viewAllActivitiesBtn');
        if (viewAllBtn) {
            viewAllBtn.addEventListener('click', function() {
                const activitiesLink = document.querySelector('[data-page="activities"]');
                if (activitiesLink) activitiesLink.click();
            });
        }

        console.log('Dashboard activities initialized with real-time updates');
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

    const logoutBtn = document.getElementById('dashboardLogoutBtn');
    if (logoutBtn && logoutBtn.dataset.logoutBound !== '1') {
        logoutBtn.dataset.logoutBound = '1';
        // Capture: run before any other handler can swallow the click (staff / touch / hash links).
        logoutBtn.addEventListener(
            'click',
            (e) => {
                e.preventDefault();
                e.stopPropagation();
                profileDropdown.classList.remove('active');
                const user = sessionManager.getAuthUser();
                if (user && auditLogger?.logLogout) {
                    void auditLogger.logLogout(user.email, user.displayName || user.email).catch(() => {});
                }
                void signOut(auth).catch(() => {});
                window.location.replace('index.html');
            },
            true
        );
    }
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

            // Refresh brand form when its tab opens
            if (targetTab === 'brand' && window.brandUI) {
                window.brandUI.populateForm();
            }
        });
    });

    // Settings form submissions — drive the submit button through
    // loading → success states so users get visible feedback. These forms
    // currently persist to localStorage / show a success notification only;
    // when wired to a backend they'll surface real errors via setBtnState.
    const wireSettingsForm = (id, label, save) => {
        const form = document.getElementById(id);
        if (!form) return;
        form.addEventListener('submit', async function(e) {
            e.preventDefault();
            const btn = form.querySelector('button[type="submit"]') || e.submitter || null;
            setBtnState(btn, 'loading', 'Saving…');
            try {
                const result = await save(form);
                if (result === false) {
                    setBtnState(btn, 'idle');
                    return;
                }
                setBtnState(btn, 'success', 'Saved!');
            } catch (err) {
                console.error(`[settings] ${label} save failed:`, err);
                setBtnState(btn, 'error', 'Failed');
                showNotification(friendlyError(err, `save ${label.toLowerCase()}`), 'error');
            }
        });
    };

    wireSettingsForm('profileForm', 'profile', () => {
        showNotification('Profile updated successfully!', 'success');
    });

    wireSettingsForm('passwordForm', 'password', (form) => {
        const newPassword = document.getElementById('newPassword').value;
        const confirmPassword = document.getElementById('confirmPassword').value;
        if (newPassword !== confirmPassword) {
            showNotification('Passwords do not match!', 'warning');
            return false;
        }
        showNotification('Password updated successfully!', 'success');
        form.reset();
    });

    wireSettingsForm('preferencesForm', 'preferences', () => {
        showNotification('Preferences saved successfully!', 'success');
    });

    wireSettingsForm('notificationsForm', 'notification settings', () => {
        showNotification('Notification settings saved!', 'success');
    });

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
    fileInput.addEventListener('change', async function(e) {
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
        
        // Show uploading state
        showNotification('Uploading profile picture...', 'info');
        
        try {
            // Upload to Firebase Storage first
            const imageUrl = await uploadProfilePictureToFirebase(file);
            
            // Display the image
            displayProfilePicture(imageUrl);
            
            // Save URL to localStorage as cache
            localStorage.setItem('profilePicture', imageUrl);
            
            // Update profile avatar in header
            updateHeaderProfileAvatar(imageUrl);
            
            // Show remove button
            if (removeBtn) removeBtn.style.display = 'inline-flex';
            
            showNotification('Profile picture updated successfully!', 'success');
        } catch (error) {
            console.error('Error uploading profile picture:', error);
            
            // Fallback to localStorage only if Firebase fails
            const reader = new FileReader();
            reader.onload = function(event) {
                const imageData = event.target.result;
                displayProfilePicture(imageData);
                localStorage.setItem('profilePicture', imageData);
                updateHeaderProfileAvatar(imageData);
                if (removeBtn) removeBtn.style.display = 'inline-flex';
                showNotification('Profile picture saved locally', 'warning');
            };
            reader.readAsDataURL(file);
        }
    });
    
    // Remove button click
    if (removeBtn) {
        removeBtn.addEventListener('click', async () => {
            const ok = await window.uiConfirm?.({
                title: 'Remove profile picture?',
                message: 'Your current profile photo will be removed.',
                tone: 'warning',
                okLabel: 'Remove'
            });
            if (!ok) return;
            await removeProfilePicture();
            removeBtn.style.display = 'none';
            showNotification('Profile picture removed', 'info');
        });
    }
}

// Upload Profile Picture to Firebase Storage
async function uploadProfilePictureToFirebase(file) {
    try {
        const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
        const userId = currentUser.uid || currentUser.id || 'default-user';
        
        // Check if Firebase Storage is available
        if (!window.firebase || !window.firebase.storage) {
            throw new Error('Firebase Storage not initialized');
        }
        
        // Import storage functions dynamically
        const { storage } = window.firebase;
        const { ref, uploadBytes, getDownloadURL } = await import('./firebase-config.js');
        
        // Create a reference to the profile picture location
        const timestamp = Date.now();
        const fileExtension = file.name.split('.').pop();
        const fileName = `profile-${userId}-${timestamp}.${fileExtension}`;
        const storageRef = ref(storage, `profile-pictures/${fileName}`);
        
        // Upload the file
        const snapshot = await uploadBytes(storageRef, file);
        console.log('✅ Profile picture uploaded to Firebase Storage');
        
        // Get the download URL
        const downloadURL = await getDownloadURL(snapshot.ref);
        console.log('✅ Profile picture URL:', downloadURL);
        
        // Save URL to Firestore user profile
        if (window.db && currentUser.uid) {
            const { doc, updateDoc } = await import('./firebase-config.js');
            const userRef = doc(window.db, 'users', currentUser.uid);
            await updateDoc(userRef, {
                profilePictureUrl: downloadURL,
                profilePictureUpdatedAt: new Date().toISOString()
            });
            console.log('✅ Profile picture URL saved to Firestore');
        }
        
        return downloadURL;
    } catch (error) {
        console.error('❌ Error uploading to Firebase Storage:', error);
        throw error;
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
async function removeProfilePicture() {
    const preview = document.getElementById('profilePicturePreview');
    if (!preview) return;
    
    try {
        // Try to delete from Firebase Storage
        const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
        const savedPictureUrl = localStorage.getItem('profilePicture');
        
        if (savedPictureUrl && savedPictureUrl.includes('firebase') && window.firebase && window.firebase.storage) {
            try {
                const { ref, deleteObject } = await import('./firebase-config.js');
                const { storage } = window.firebase;
                
                // Extract the storage path from the URL
                const urlObj = new URL(savedPictureUrl);
                const pathMatch = urlObj.pathname.match(/\/o\/(.+)\?/);
                if (pathMatch) {
                    const storagePath = decodeURIComponent(pathMatch[1]);
                    const fileRef = ref(storage, storagePath);
                    await deleteObject(fileRef);
                    console.log('✅ Profile picture deleted from Firebase Storage');
                }
                
                // Remove from Firestore
                if (window.db && currentUser.uid) {
                    const { doc, updateDoc } = await import('./firebase-config.js');
                    const userRef = doc(window.db, 'users', currentUser.uid);
                    await updateDoc(userRef, {
                        profilePictureUrl: null,
                        profilePictureUpdatedAt: new Date().toISOString()
                    });
                    console.log('✅ Profile picture URL removed from Firestore');
                }
            } catch (deleteError) {
                console.warn('Could not delete from Firebase:', deleteError);
            }
        }
    } catch (error) {
        console.error('Error during profile picture removal:', error);
    }
    
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
async function loadUserProfileData() {
    const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
    
    const emailInput = document.getElementById('profileEmail');
    const nameInput = document.getElementById('profileFullName');
    const roleInput = document.getElementById('profileRole');
    
    if (emailInput) emailInput.value = currentUser.email || '';
    if (nameInput) nameInput.value = currentUser.displayName || currentUser.name || '';
    if (roleInput) roleInput.value = currentUser.role || 'Administrator';
    
    // Load profile picture - try Firebase first, then localStorage
    let profilePictureUrl = null;
    
    try {
        // Try to load from Firestore
        if (window.db && currentUser.uid) {
            const { doc, getDoc } = await import('./firebase-config.js');
            const userRef = doc(window.db, 'users', currentUser.uid);
            const userDoc = await getDoc(userRef);
            
            if (userDoc.exists() && userDoc.data().profilePictureUrl) {
                profilePictureUrl = userDoc.data().profilePictureUrl;
                // Cache in localStorage
                localStorage.setItem('profilePicture', profilePictureUrl);
                console.log('✅ Profile picture loaded from Firestore');
            }
        }
    } catch (error) {
        console.warn('Could not load profile picture from Firestore:', error);
    }
    
    // Fallback to localStorage if Firebase didn't work
    if (!profilePictureUrl) {
        profilePictureUrl = localStorage.getItem('profilePicture');
        if (profilePictureUrl) {
            console.log('✅ Profile picture loaded from localStorage');
        }
    }
    
    // Display the profile picture if found
    if (profilePictureUrl) {
        updateHeaderProfileAvatar(profilePictureUrl);
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
