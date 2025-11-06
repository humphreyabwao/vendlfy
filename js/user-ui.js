// User UI Handlers
import userManager from './user-manager.js';
import branchManager from './branch-manager.js';

// Global functions for user management
window.openUserModal = openUserModal;
window.closeUserModal = closeUserModal;
window.saveUser = saveUser;
window.editUser = editUser;
window.deleteUser = deleteUser;
window.loadUsersList = loadUsersList;
window.createNewUser = createNewUser;
window.cancelNewUser = cancelNewUser;
window.updateRoleDescription = updateRoleDescription;

// Open user modal for adding/editing
function openUserModal(userId = null) {
    const modal = document.getElementById('userModal');
    const form = document.getElementById('userForm');
    const title = document.getElementById('userModalTitle');
    const passwordInput = document.getElementById('userPassword');
    
    form.reset();
    
    // Populate branch dropdown
    populateUserBranchSelect();
    
    if (userId) {
        // Edit mode
        const user = userManager.getUserById(userId);
        if (user) {
            title.textContent = 'Edit User';
            document.getElementById('userId').value = user.id;
            document.getElementById('userEmail').value = user.email || '';
            document.getElementById('userFullName').value = user.fullName || '';
            document.getElementById('userRole').value = user.role || '';
            document.getElementById('userBranch').value = user.branchId || '';
            document.getElementById('userPhone').value = user.phone || '';
            document.getElementById('userStatus').value = user.status || 'active';
            
            // Hide password field for editing
            passwordInput.style.display = 'none';
            passwordInput.required = false;
            passwordInput.parentElement.style.display = 'none';
        }
    } else {
        // Add mode
        title.textContent = 'Add New User';
        passwordInput.style.display = 'block';
        passwordInput.required = true;
        passwordInput.parentElement.style.display = 'block';
    }
    
    modal.classList.add('active');
}

// Close user modal
function closeUserModal() {
    const modal = document.getElementById('userModal');
    modal.classList.remove('active');
}

// Save user (add or update)
async function saveUser(event) {
    event.preventDefault();
    
    const form = event.target;
    const formData = new FormData(form);
    const userId = formData.get('userId');
    
    const userData = {
        email: formData.get('email'),
        fullName: formData.get('fullName'),
        role: formData.get('role'),
        branchId: formData.get('branchId'),
        phone: formData.get('phone'),
        status: formData.get('status')
    };

    // Add password for new users
    if (!userId) {
        userData.password = formData.get('password');
    }
    
    try {
        if (userId) {
            // Update existing user (exclude password)
            delete userData.password;
            await userManager.updateUser(userId, userData);
            showNotification('User updated successfully', 'success');
        } else {
            // Create new user
            await userManager.createUser(userData);
            showNotification('User created successfully', 'success');
        }
        
        closeUserModal();
        await loadUsersList();
        
    } catch (error) {
        console.error('Error saving user:', error);
        showNotification('Error saving user: ' + error.message, 'error');
    }
}

// Edit user
function editUser(userId) {
    openUserModal(userId);
}

// Delete user
async function deleteUser(userId) {
    const user = userManager.getUserById(userId);
    
    if (!user) return;
    
    if (!confirm(`Are you sure you want to delete user "${user.fullName}" (${user.email})?`)) {
        return;
    }
    
    try {
        await userManager.deleteUser(userId);
        showNotification('User deleted successfully', 'success');
        await loadUsersList();
    } catch (error) {
        console.error('Error deleting user:', error);
        showNotification('Error deleting user: ' + error.message, 'error');
    }
}

// Load and render users list
async function loadUsersList() {
    const container = document.getElementById('usersListContainer');
    if (!container) return;

    try {
        const users = await userManager.loadUsers();
        
        if (users.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                        <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                        <circle cx="8.5" cy="7" r="4"></circle>
                    </svg>
                    <h3>No Users Found</h3>
                    <p>Click "Add User" to create your first user account.</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = generateUsersHTML(users);
    } catch (error) {
        console.error('Error loading users:', error);
        container.innerHTML = `
            <div class="error-state">
                <p>Error loading users: ${error.message}</p>
            </div>
        `;
    }
}

// Generate HTML for users list
function generateUsersHTML(users) {
    return users.map(user => {
        const branch = user.branchId ? branchManager.getBranchById(user.branchId) : null;
        const branchName = branch ? branch.name : 'All Branches';
        
        return `
        <div class="user-card">
            <div class="user-card-header">
                <div class="user-info">
                    <div class="user-avatar">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                            <circle cx="12" cy="7" r="4"></circle>
                        </svg>
                    </div>
                    <div class="user-details">
                        <h4 class="user-name">${user.fullName || 'N/A'}</h4>
                        <p class="user-email">${user.email || 'N/A'}</p>
                    </div>
                </div>
                <div class="user-status">
                    <span class="status-badge status-${user.status || 'active'}">${user.status || 'Active'}</span>
                </div>
            </div>
            
            <div class="user-card-body">
                <div class="user-meta">
                    <div class="meta-item">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M9 12l2 2 4-4"></path>
                            <path d="M21 12c-1 0-3-1-3-3s2-3 3-3 3 1 3 3-2 3-3 3"></path>
                            <path d="M3 12c1 0 3-1 3-3s-2-3-3-3-3 1-3 3 2 3 3 3"></path>
                        </svg>
                        <span class="role-badge role-${user.role || 'viewer'}">${formatRole(user.role || 'viewer')}</span>
                    </div>
                    <div class="meta-item">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                            <circle cx="12" cy="10" r="3"></circle>
                        </svg>
                        <span>${branchName}</span>
                    </div>
                    ${user.phone ? `
                    <div class="meta-item">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
                        </svg>
                        <span>${user.phone}</span>
                    </div>
                    ` : ''}
                </div>
            </div>
            
            <div class="user-card-footer">
                <small class="text-muted">Created: ${formatDate(user.createdAt)}</small>
                <div class="user-actions">
                    <button class="btn-icon btn-edit" onclick="editUser('${user.id}')" title="Edit User">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="m18.5 2.5 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                    </button>
                    ${user.role !== 'admin' ? `
                    <button class="btn-icon btn-delete" onclick="deleteUser('${user.id}')" title="Delete User">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="m19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                    </button>
                    ` : '<span style="flex: 1;"></span>'}
                </div>
            </div>
        </div>
    `}).join('');
}

// Populate branch select in user form
function populateUserBranchSelect() {
    const select = document.getElementById('userBranch');
    if (!select) return;

    const branches = branchManager.getAllBranches();
    const activeBranches = branches.filter(branch => branch.status === 'active');

    select.innerHTML = '<option value="">All Branches</option>';
    
    activeBranches.forEach(branch => {
        const option = document.createElement('option');
        option.value = branch.id;
        option.textContent = branch.name;
        select.appendChild(option);
    });
}

// Helper functions
function formatRole(role) {
    const roles = {
        admin: 'Administrator',
        manager: 'Manager',
        cashier: 'Cashier',
        viewer: 'Viewer'
    };
    return roles[role] || role;
}

function formatDate(dateString) {
    if (!dateString) return 'N/A';
    try {
        return new Date(dateString).toLocaleDateString();
    } catch {
        return 'Invalid Date';
    }
}

// Helper function for notifications
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        top: 80px;
        right: 20px;
        padding: 16px 24px;
        background: ${type === 'success' ? 'var(--primary-green)' : type === 'error' ? 'var(--primary-red)' : 'var(--primary-blue)'};
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

// Initialize real-time updates
function initRealtimeUpdates() {
    // Start real-time listener for users
    userManager.startRealtimeListener();
    
    // Add callback for UI updates
    userManager.onUsersUpdated((users) => {
        console.log('🔄 UI: Users updated, refreshing list...');
        loadUsersList();
    });
}

// Initialize when DOM is loaded
window.addEventListener('DOMContentLoaded', () => {
    // Initialize real-time updates
    initRealtimeUpdates();
    
    // Load users when admin page is accessed
    const navLinks = document.querySelectorAll('[data-page="admin"]');
    navLinks.forEach(link => {
        link.addEventListener('click', () => {
            setTimeout(() => {
                loadUsersList();
                populateUserBranchSelect();
            }, 100);
        });
    });
    
    // Populate branch select when new user page is accessed
    const newUserLinks = document.querySelectorAll('[data-page="new-user"]');
    newUserLinks.forEach(link => {
        link.addEventListener('click', () => {
            setTimeout(() => {
                populateNewUserBranchSelect();
            }, 100);
        });
    });
});

// Create new user from dedicated page
async function createNewUser(event) {
    event.preventDefault();
    
    const form = event.target;
    const formData = new FormData(form);
    
    const userData = {
        email: formData.get('email'),
        password: formData.get('password'),
        fullName: formData.get('fullName'),
        role: formData.get('role'),
        branchId: formData.get('branchId'),
        phone: formData.get('phone'),
        status: formData.get('status') || 'active'
    };
    
    try {
        await userManager.createUser(userData);
        showNotification('User created successfully!', 'success');
        
        // Clear form
        form.reset();
        
        // Navigate back to admin panel
        document.querySelector('[data-page="admin"]').click();
        
    } catch (error) {
        console.error('Error creating user:', error);
        showNotification('Error creating user: ' + error.message, 'error');
    }
}

// Cancel new user creation
function cancelNewUser() {
    // Clear form
    const form = document.getElementById('newUserForm');
    if (form) {
        form.reset();
    }
    
    // Navigate back to admin panel
    document.querySelector('[data-page="admin"]').click();
}

// Update role description
function updateRoleDescription() {
    const roleSelect = document.getElementById('newUserRole');
    const roleDescription = document.getElementById('roleDescription');
    
    if (!roleSelect || !roleDescription) return;
    
    const role = roleSelect.value;
    const descriptions = {
        admin: '🔑 Full system access - Can manage branches, users, and all data',
        manager: '👨‍💼 Branch management - Can manage inventory, sales, and reports for assigned branch',
        cashier: '💰 Point of Sale - Can process sales and view basic inventory',
        viewer: '👀 Read-only access - Can view reports and data but cannot make changes'
    };
    
    if (descriptions[role]) {
        roleDescription.innerHTML = `<small class="role-help">${descriptions[role]}</small>`;
        roleDescription.style.display = 'block';
    } else {
        roleDescription.style.display = 'none';
    }
}

// Populate branch select in new user form
function populateNewUserBranchSelect() {
    const select = document.getElementById('newUserBranch');
    if (!select) return;

    const branches = branchManager.getAllBranches();
    const activeBranches = branches.filter(branch => branch.status === 'active');

    // Keep the default "All Branches" option and add branches
    const defaultOption = select.querySelector('option[value=""]');
    select.innerHTML = '';
    if (defaultOption) {
        select.appendChild(defaultOption);
    }
    
    activeBranches.forEach(branch => {
        const option = document.createElement('option');
        option.value = branch.id;
        option.textContent = branch.name;
        select.appendChild(option);
    });
}

// Export for use in other modules
export { openUserModal, closeUserModal, saveUser, editUser, deleteUser, loadUsersList, createNewUser, cancelNewUser };