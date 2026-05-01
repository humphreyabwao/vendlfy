// User UI Handlers — production RBAC version
// Multi-branch picker, permissions saved properly, real-time updates.

import userManager from './user-manager.js';
import branchManager from './branch-manager.js';
import { setBtnState, friendlyError } from './ui-feedback.js';

// Global exports
window.openUserModal = openUserModal;
window.closeUserModal = closeUserModal;
window.saveUser = saveUser;
window.editUser = editUser;
window.deleteUser = deleteUser;
window.loadUsersList = loadUsersList;
window.createNewUser = createNewUser;
window.cancelNewUser = cancelNewUser;
window.updateRoleDescription = updateRoleDescription;
window.updateRolePermissions = updateRolePermissions;
window.getSelectedPermissions = getSelectedPermissions;
window.updateUserModalRolePermissions = updateUserModalRolePermissions;

document.addEventListener('DOMContentLoaded', () => {
    initializePermissionCheckboxes();
    _ensureUserModalPermissionsMatrix();
});

// ---------- Modal: edit/add (lightweight) ----------

function openUserModal(userId = null) {
    _ensureUserModalPermissionsMatrix();

    const modal = document.getElementById('userModal');
    const form = document.getElementById('userForm');
    const title = document.getElementById('userModalTitle');
    const passwordGroup = document.getElementById('userPasswordGroup');
    const passwordInput = document.getElementById('userPassword');

    form.reset();
    populateUserBranchSelect();
    _buildModalBranchCheckboxes(userId);

    if (userId) {
        const user = userManager.getUserById(userId) || userManager.getUserById(String(userId));
        if (!user) {
            showNotification('User not found. Try refreshing the list.', 'error');
            return;
        }
        title.textContent = 'Edit User';
        const resolvedId = user.id || user.uid;
        document.getElementById('userId').value = resolvedId;
        document.getElementById('userEmail').value = user.email || '';
        document.getElementById('userFullName').value = user.fullName || '';
        document.getElementById('userPhone').value = user.phone || '';
        document.getElementById('userStatus').value = user.status || 'active';

        const perms =
            Array.isArray(user.permissions) && user.permissions.length > 0
                ? user.permissions.slice()
                : _getRolePermissions(user.role || 'viewer');
        _applyUserModalPermissionsFromList(perms);
        if (user.role === 'custom') {
            document.getElementById('userRole').value = 'custom';
        } else {
            _syncUserModalRoleSelectFromCheckboxes();
        }
        _updateUserModalRoleHelp();

        if (passwordGroup) passwordGroup.style.display = 'none';
        if (passwordInput) passwordInput.required = false;
    } else {
        title.textContent = 'Add New User';
        document.getElementById('userId').value = '';
        _applyUserModalPermissionsFromList([]);
        const rs = document.getElementById('userRole');
        if (rs) rs.value = '';
        _updateUserModalRoleHelp();

        if (passwordGroup) passwordGroup.style.display = '';
        if (passwordInput) passwordInput.required = true;
    }

    modal.classList.add('active');
}

function closeUserModal() {
    document.getElementById('userModal').classList.remove('active');
}

async function saveUser(event) {
    event.preventDefault();
    const form = event.target;
    const submitBtn = form.querySelector('button[type="submit"]') || event.submitter || null;
    const formData = new FormData(form);
    const userId = formData.get('userId');

    const branchIds = _getModalBranchIds(form);
    const roleVal = formData.get('role');

    let permissions = getUserModalSelectedPermissions();
    if (roleVal && roleVal !== 'custom' && permissions.length === 0) {
        permissions = _getRolePermissions(roleVal);
    }
    if (roleVal === 'custom' && permissions.length === 0) {
        showNotification('Choose at least one permission or pick a role template.', 'error');
        return;
    }
    if (!roleVal) {
        showNotification('Please select a role.', 'error');
        return;
    }

    const userData = {
        email: formData.get('email'),
        fullName: formData.get('fullName'),
        role: roleVal,
        branchIds,
        branchId: branchIds[0] || null,
        primaryBranchId: branchIds[0] || null,
        phone: formData.get('phone'),
        status: formData.get('status'),
        permissions
    };

    setBtnState(submitBtn, 'loading', userId ? 'Updating…' : 'Creating…');
    try {
        if (userId) {
            delete userData.password;
            await userManager.updateUser(userId, userData);
            setBtnState(submitBtn, 'success', 'Updated!');
            showNotification('User updated successfully', 'success');
        } else {
            userData.password = formData.get('password');
            await userManager.createUser(userData);
            setBtnState(submitBtn, 'success', 'Created!');
            showNotification('User created successfully', 'success');
        }
        void loadUsersList().catch(() => {});
        setTimeout(() => closeUserModal(), 700);
    } catch (error) {
        console.error('Error saving user:', error);
        setBtnState(submitBtn, 'error', 'Failed');
        showNotification(friendlyError(error, userId ? 'update user' : 'create user'), 'error');
    }
}

function editUser(userId) { openUserModal(userId); }

async function deleteUser(userId) {
    const user = userManager.getUserById(userId);
    if (!user) return;
    const ok = await window.uiConfirm?.({
        title: 'Delete user?',
        message: `Are you sure you want to delete "${user.fullName}" (${user.email})? This cannot be undone.`,
        tone: 'danger',
        okLabel: 'Delete'
    });
    if (!ok) return;
    try {
        await userManager.deleteUser(userId);
        showNotification('User deleted successfully', 'success');
        await loadUsersList();
    } catch (error) {
        showNotification('Error deleting user: ' + error.message, 'error');
    }
}

// ---------- Users list ----------

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
                </div>`;
            return;
        }
        container.innerHTML = users.map(renderUserCard).join('');
    } catch (error) {
        container.innerHTML = `<div class="error-state"><p>Error loading users: ${error.message}</p></div>`;
    }
}

function renderUserCard(user) {
    const branchIds = _getUserBranchIds(user);
    const branchNames = branchIds.length === 0
        ? 'All Branches'
        : branchIds.map((id) => {
            const b = branchManager.getBranchById(id);
            return b ? b.name : id;
        }).join(', ');

    const isOnline    = userManager.isUserOnline(user);
    const lastSeenTxt = userManager.getLastSeenText(user);

    return `
    <div class="user-card">
        <div class="user-card-header">
            <div class="user-info">
                <div class="user-avatar" style="position:relative;">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                        <circle cx="12" cy="7" r="4"></circle>
                    </svg>
                    ${isOnline ? '<span style="position:absolute;bottom:-2px;right:-2px;width:10px;height:10px;background:#10b981;border:2px solid var(--bg-primary);border-radius:50%;animation:pulse 2s infinite;"></span>' : ''}
                </div>
                <div class="user-details">
                    <h4 class="user-name">${user.fullName || 'N/A'}</h4>
                    <p class="user-email">${user.email || 'N/A'}</p>
                    <small style="font-size:11px;color:${isOnline ? '#10b981' : 'var(--text-tertiary)'};margin-top:2px;display:block;font-weight:500;">
                        ${isOnline ? '🟢 Online' : '⚪ ' + lastSeenTxt}
                    </small>
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
                        <path d="M9 12l2 2 4-4"></path><path d="M21 12c-1 0-3-1-3-3s2-3 3-3 3 1 3 3-2 3-3 3"></path>
                        <path d="M3 12c1 0 3-1 3-3s-2-3-3-3-3 1-3 3 2 3 3 3"></path>
                    </svg>
                    <span class="role-badge role-${user.role || 'viewer'}">${formatRole(user.role)}</span>
                </div>
                <div class="meta-item">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                        <circle cx="12" cy="10" r="3"></circle>
                    </svg>
                    <span>${branchNames}</span>
                </div>
                ${user.phone ? `
                <div class="meta-item">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
                    </svg>
                    <span>${user.phone}</span>
                </div>` : ''}
            </div>
        </div>
        <div class="user-card-footer">
            <small class="text-muted">Created: ${formatDate(user.createdAt)}</small>
            <div class="user-actions">
                <button class="btn-icon btn-edit" onclick="editUser('${user.id || user.uid}')" title="Edit User">
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
                </button>` : '<span style="flex:1;"></span>'}
            </div>
        </div>
    </div>`;
}

// ---------- Branch pickers ----------

function populateUserBranchSelect() {
    const select = document.getElementById('userBranch');
    if (!select) return;
    const branches = branchManager.getAllBranches().filter((b) => b.status === 'active');
    select.innerHTML = '<option value="">All Branches</option>';
    branches.forEach((b) => {
        const o = document.createElement('option');
        o.value = b.id; o.textContent = b.name;
        select.appendChild(o);
    });
}

function populateNewUserBranchSelect() {
    // Used on the full Create User page — builds a multi-checkbox list.
    // Preserves any branches the user has already ticked when branches stream in late.
    const container = document.getElementById('newUserBranchContainer');
    if (container) {
        const previouslyChecked = [
            ...container.querySelectorAll('input[name="newUserBranchIds"]:checked')
        ].map((cb) => cb.value);
        _buildBranchCheckboxList(container, 'newUserBranchIds', previouslyChecked);
        return;
    }
    // Fallback: single select
    const select = document.getElementById('newUserBranch');
    if (!select) return;
    const previousValue = select.value;
    const branches = branchManager.getAllBranches().filter((b) => b.status === 'active');
    select.innerHTML = '<option value="">🏢 All Branches (Central Access)</option>';
    branches.forEach((b) => {
        const o = document.createElement('option');
        o.value = b.id; o.textContent = b.name;
        select.appendChild(o);
    });
    if (previousValue && [...select.options].some((o) => o.value === previousValue)) {
        select.value = previousValue;
    }
}

function _buildModalBranchCheckboxes(userId) {
    const container = document.getElementById('userModalBranchContainer');
    if (!container) return; // modal uses old single-select, fine
    const user = userId ? userManager.getUserById(userId) : null;
    const selected = user ? _getUserBranchIds(user) : [];
    _buildBranchCheckboxList(container, 'userModalBranchIds', selected);
}

function _buildBranchCheckboxList(container, inputName, selected) {
    const branches = branchManager.getAllBranches().filter((b) => b.status === 'active');
    container.innerHTML = '';

    if (branches.length === 0) {
        container.innerHTML = '<p style="font-size:13px;color:var(--text-secondary);">No branches yet. Create a branch first.</p>';
        return;
    }

    // "All Branches" option
    const allLabel = document.createElement('label');
    allLabel.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer;padding:6px 0;';
    allLabel.innerHTML = `
        <input type="checkbox" id="${inputName}_all" style="cursor:pointer;"
            onchange="window._handleAllBranchesToggle(this, '${inputName}')">
        <span style="font-weight:600;">All Branches (Central Access)</span>`;
    container.appendChild(allLabel);

    const divider = document.createElement('hr');
    divider.style.cssText = 'margin:6px 0;border:none;border-top:1px solid var(--border-color);';
    container.appendChild(divider);

    branches.forEach((b) => {
        const label = document.createElement('label');
        label.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer;padding:4px 0;';
        label.innerHTML = `
            <input type="checkbox" name="${inputName}" value="${b.id}" style="cursor:pointer;"
                ${selected.includes(b.id) ? 'checked' : ''}
                onchange="window._handleBranchCheckboxChange('${inputName}')">
            <span>${b.name} <small style="color:var(--text-secondary);">(${b.code || b.id})</small></span>`;
        container.appendChild(label);
    });

    // If empty selection, check "All"
    if (selected.length === 0) {
        const allCb = document.getElementById(`${inputName}_all`);
        if (allCb) allCb.checked = true;
    }
}

window._handleAllBranchesToggle = (allCheckbox, inputName) => {
    if (allCheckbox.checked) {
        // Uncheck all individual branches
        document.querySelectorAll(`input[name="${inputName}"]`).forEach((cb) => { cb.checked = false; });
    }
};

window._handleBranchCheckboxChange = (inputName) => {
    const anyChecked = [...document.querySelectorAll(`input[name="${inputName}"]`)].some((cb) => cb.checked);
    const allCb = document.getElementById(`${inputName}_all`);
    if (allCb) allCb.checked = !anyChecked;
};

function _ensureUserModalPermissionsMatrix() {
    const wrap = document.getElementById('userModalPermissionsWrap');
    if (!wrap) return;
    if (wrap.querySelector('.permissions-grid')) return;

    const source = document.querySelector('#permissionsMatrix .permissions-grid');
    if (!source) {
        wrap.innerHTML =
            '<p style="font-size:13px;color:var(--text-secondary);">Permission list unavailable. Open the <strong>New User</strong> page on this dashboard once, then open this modal again.</p>';
        return;
    }

    wrap.innerHTML = '';
    const clone = source.cloneNode(true);
    clone.querySelectorAll('input[type="checkbox"]').forEach((inp) => {
        inp.name = 'userModalPermissions[]';
    });
    wrap.appendChild(clone);
    wrap.dataset.bound = '';
    _bindUserModalPermissionInputsOnce();
}

function _bindUserModalPermissionInputsOnce() {
    const wrap = document.getElementById('userModalPermissionsWrap');
    if (!wrap || wrap.dataset.bound === '1') return;
    wrap.dataset.bound = '1';
    wrap.addEventListener('change', (e) => {
        const t = e.target;
        if (t.type !== 'checkbox') return;
        const item = t.closest('.permission-item');
        if (item) {
            item.classList.toggle('has-permission', t.checked);
            item.classList.toggle('no-permission', !t.checked);
        }
        const roleSelect = document.getElementById('userRole');
        if (!roleSelect || roleSelect.value === 'custom') {
            _updateUserModalRoleHelp();
            return;
        }
        const cur = getUserModalSelectedPermissions().sort().join('|');
        const template = _getRolePermissions(roleSelect.value).sort().join('|');
        if (cur !== template) roleSelect.value = 'custom';
        _updateUserModalRoleHelp();
    });
}

function getUserModalSelectedPermissions() {
    const wrap = document.getElementById('userModalPermissionsWrap');
    if (!wrap) return [];
    return [...wrap.querySelectorAll('input[type="checkbox"]:checked')].map((cb) => cb.value);
}

function _applyUserModalPermissionsFromList(keys) {
    const wrap = document.getElementById('userModalPermissionsWrap');
    if (!wrap) return;
    const set = new Set(keys || []);
    wrap.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
        cb.checked = set.has(cb.value);
        const item = cb.closest('.permission-item');
        if (item) {
            item.classList.toggle('has-permission', cb.checked);
            item.classList.toggle('no-permission', !cb.checked);
        }
    });
}

function _syncUserModalRoleSelectFromCheckboxes() {
    const roleSelect = document.getElementById('userRole');
    if (!roleSelect) return;
    const perms = getUserModalSelectedPermissions();
    const norm = [...perms].sort().join('|');
    const templates = ['admin', 'manager', 'cashier', 'viewer'];
    for (const role of templates) {
        const t = _getRolePermissions(role).sort().join('|');
        if (t === norm && norm.length > 0) {
            roleSelect.value = role;
            _updateUserModalRoleHelp();
            return;
        }
    }
    if (perms.length === 0) roleSelect.value = '';
    else roleSelect.value = 'custom';
    _updateUserModalRoleHelp();
}

function _updateUserModalRoleHelp() {
    const roleSelect = document.getElementById('userRole');
    const help = document.getElementById('userModalRoleHelp');
    if (!roleSelect || !help) return;
    const descriptions = {
        admin: 'Full system access — branches, users, settings, all modules.',
        manager: 'Branch operations — inventory, sales, expenses, reports (no admin.users / admin.settings).',
        cashier: 'POS, sales, limited inventory and customer access.',
        viewer: 'Read-only where you enable checks below.',
        custom: 'Permissions below are saved as-is; role is stored as Custom.'
    };
    const d = descriptions[roleSelect.value];
    if (d) {
        help.textContent = d;
        help.style.display = 'block';
    } else {
        help.textContent = '';
        help.style.display = 'none';
    }
}

function updateUserModalRolePermissions() {
    const roleSelect = document.getElementById('userRole');
    if (!roleSelect) return;
    _ensureUserModalPermissionsMatrix();
    const wrap = document.getElementById('userModalPermissionsWrap');
    if (!wrap) return;

    if (!roleSelect.value) {
        wrap.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
            cb.checked = false;
            const item = cb.closest('.permission-item');
            if (item) {
                item.classList.remove('has-permission');
                item.classList.add('no-permission');
            }
        });
        _updateUserModalRoleHelp();
        return;
    }
    if (roleSelect.value === 'custom') {
        _updateUserModalRoleHelp();
        return;
    }
    const permissions = _getRolePermissions(roleSelect.value);
    _applyUserModalPermissionsFromList(permissions);
    _updateUserModalRoleHelp();
}

function _getModalBranchIds(form) {
    // Try multi-checkbox first (new-user page)
    const checkedBoxes = form.querySelectorAll('input[name="newUserBranchIds"]:checked, input[name="userModalBranchIds"]:checked');
    if (checkedBoxes.length > 0) {
        return [...checkedBoxes].map((cb) => cb.value).filter(Boolean);
    }
    // Fallback to legacy single select
    const val = form.querySelector('[name="branchId"]')?.value;
    return val ? [val] : [];
}

function _getUserBranchIds(user) {
    if (Array.isArray(user.branchIds) && user.branchIds.length > 0) return user.branchIds.filter(Boolean);
    if (user.branchId) return [user.branchId];
    return [];
}

// ---------- New user (full-page form) ----------

async function createNewUser(event) {
    event.preventDefault();
    const form = event.target;
    const submitBtn = form.querySelector('button[type="submit"]') || event.submitter || null;
    const formData = new FormData(form);
    const permissions = getSelectedPermissions();
    const branchIds = _getModalBranchIds(form);

    const userData = {
        email:     formData.get('email'),
        password:  formData.get('password'),
        fullName:  formData.get('fullName'),
        role:      formData.get('role'),
        branchIds,
        branchId: branchIds[0] || null,
        primaryBranchId: branchIds[0] || null,
        phone:     formData.get('phone'),
        status:    formData.get('status') || 'active',
        permissions
    };

    setBtnState(submitBtn, 'loading', 'Creating…');
    try {
        await userManager.createUser(userData);
        setBtnState(submitBtn, 'success', 'Created!');
        showNotification('User created successfully!', 'success');
        form.reset();
        setTimeout(() => {
            document.querySelector('[data-page="admin"]')?.click();
        }, 700);
    } catch (error) {
        console.error('Error creating user:', error);
        setBtnState(submitBtn, 'error', 'Failed');
        showNotification(friendlyError(error, 'create user'), 'error');
    }
}

function cancelNewUser() {
    const form = document.getElementById('newUserForm');
    if (form) form.reset();
    document.querySelector('[data-page="admin"]').click();
}

// ---------- Role / Permissions ----------

function updateRoleDescription() {
    const roleSelect = document.getElementById('newUserRole');
    const roleDescription = document.getElementById('roleDescription');
    if (!roleSelect || !roleDescription) return;
    const descriptions = {
        admin:   '🔑 Full system access — manages branches, users, and all data',
        manager: '👨‍💼 Branch operations — manages inventory, sales, and reports for assigned branches',
        cashier: '💰 Point of Sale — processes sales, views basic inventory',
        viewer:  '👀 Read-only access — views reports and data without changes'
    };
    const d = descriptions[roleSelect.value];
    roleDescription.innerHTML = d ? `<small class="role-help">${d}</small>` : '';
    roleDescription.style.display = d ? 'block' : 'none';
}

function updateRolePermissions() {
    const roleSelect = document.getElementById('newUserRole');
    const permissionsMatrix = document.getElementById('permissionsMatrix');
    if (!roleSelect || !permissionsMatrix) return;

    if (!roleSelect.value) { permissionsMatrix.style.display = 'none'; return; }
    permissionsMatrix.style.display = 'block';

    const permissions = _getRolePermissions(roleSelect.value);
    permissionsMatrix.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
        const allowed = permissions.includes(cb.value);
        cb.checked = allowed;
        const item = cb.closest('.permission-item');
        if (item) {
            item.classList.toggle('has-permission', allowed);
            item.classList.toggle('no-permission', !allowed);
        }
    });
    updateRoleDescription();
}

function getSelectedPermissions() {
    return [...document.querySelectorAll('#permissionsMatrix input[type="checkbox"]:checked')]
        .map((cb) => cb.value);
}

function initializePermissionCheckboxes() {
    document.querySelectorAll('#permissionsMatrix input[type="checkbox"]').forEach((cb) => {
        cb.addEventListener('change', function () {
            const item = this.closest('.permission-item');
            if (item) {
                item.classList.toggle('has-permission', this.checked);
                item.classList.toggle('no-permission', !this.checked);
            }
            const roleSelect = document.getElementById('newUserRole');
            if (roleSelect && roleSelect.value !== 'custom') {
                const current = getSelectedPermissions().sort();
                const rolePerm = _getRolePermissions(roleSelect.value).sort();
                if (JSON.stringify(current) !== JSON.stringify(rolePerm)) {
                    roleSelect.value = 'custom';
                }
            }
        });
    });
}

function _getRolePermissions(role) {
    const map = {
        admin: [
            'dashboard.view', 'dashboard.stats',
            'inventory.view', 'inventory.add', 'inventory.edit', 'inventory.delete',
            'pos.view', 'pos.create', 'sales.view', 'sales.delete',
            'b2b.view', 'b2b.create', 'b2b.edit',
            'customers.view', 'customers.add', 'customers.edit', 'customers.delete',
            'tenants.view', 'tenants.add', 'tenants.edit', 'tenants.delete', 'tenants.collect',
            'expenses.view', 'expenses.add', 'expenses.edit', 'expenses.delete',
            'hr.view', 'hr.add', 'hr.edit', 'hr.delete', 'hr.pay',
            'orders.view', 'orders.create', 'orders.edit',
            'suppliers.view', 'suppliers.add', 'suppliers.edit', 'suppliers.delete',
            'reports.view', 'reports.export', 'reports.financial',
            'accounts.view', 'accounts.export', 'accounts.cashin',
            'ventures.view', 'ventures.create', 'ventures.edit', 'ventures.entry',
            'admin.branches', 'admin.users', 'admin.settings'
        ],
        manager: [
            'dashboard.view', 'dashboard.stats',
            'inventory.view', 'inventory.add', 'inventory.edit',
            'pos.view', 'pos.create', 'sales.view',
            'b2b.view', 'b2b.create', 'b2b.edit',
            'customers.view', 'customers.add', 'customers.edit',
            'tenants.view', 'tenants.add', 'tenants.edit', 'tenants.collect',
            'expenses.view', 'expenses.add',
            'hr.view', 'hr.add', 'hr.edit', 'hr.pay',
            'orders.view', 'orders.create', 'orders.edit',
            'suppliers.view', 'suppliers.add', 'suppliers.edit',
            'reports.view', 'reports.export',
            'accounts.view', 'accounts.cashin',
            'ventures.view', 'ventures.create', 'ventures.edit', 'ventures.entry'
        ],
        cashier: [
            'dashboard.view',
            'inventory.view',
            'pos.view', 'pos.create', 'sales.view',
            'customers.view', 'customers.add',
            'tenants.view', 'tenants.collect',
            'orders.view',
            'accounts.cashin',
            'ventures.view', 'ventures.entry'
        ],
        viewer: [
            'dashboard.view',
            'inventory.view',
            'sales.view',
            'customers.view',
            'reports.view'
        ],
        custom: []
    };
    return map[role] || [];
}

// ---------- Real-time init ----------

function initRealtimeUpdates() {
    userManager.startRealtimeListener();
    userManager.onUsersUpdated(() => loadUsersList());
}

window.addEventListener('DOMContentLoaded', () => {
    initRealtimeUpdates();

    document.querySelectorAll('[data-page="admin"]').forEach((link) => {
        link.addEventListener('click', () => {
            setTimeout(() => {
                loadUsersList();
                populateUserBranchSelect();
            }, 100);
        });
    });

    document.querySelectorAll('[data-page="new-user"]').forEach((link) => {
        link.addEventListener('click', () => {
            // Run immediately so the picker is visible right away,
            // then once more after a tick in case branches finished loading mid-click.
            populateNewUserBranchSelect();
            setTimeout(populateNewUserBranchSelect, 120);
        });
    });

    // First paint: populate on load if the page is already attached.
    populateNewUserBranchSelect();

    // Auto-refresh the branch pickers whenever branches stream in or are edited.
    window.addEventListener('branchesUpdated', () => {
        if (document.getElementById('newUserBranchContainer')) {
            populateNewUserBranchSelect();
        }
        if (document.getElementById('userBranch')) {
            populateUserBranchSelect();
        }
        const modal = document.getElementById('userModal');
        if (modal && modal.classList.contains('active')) {
            const userId = document.getElementById('userId')?.value || null;
            _buildModalBranchCheckboxes(userId);
        }
    });
});

// ---------- Helpers ----------

function formatRole(role) {
    return { admin: 'Administrator', manager: 'Manager', cashier: 'Cashier', viewer: 'Viewer', custom: 'Custom' }[role] || (role || 'Viewer');
}

function formatDate(s) {
    if (!s) return 'N/A';
    try { return new Date(s).toLocaleDateString(); } catch { return 'N/A'; }
}

function showNotification(message, type = 'info') {
    if (window.notificationManager?.add) {
        window.notificationManager.add(message, type);
        return;
    }
    const n = document.createElement('div');
    n.className = `notification notification-${type}`;
    n.textContent = message;
    n.style.cssText = `
        position:fixed;top:80px;right:20px;padding:16px 24px;
        background:${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
        color:white;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,.2);
        z-index:10000;font-family:'Montserrat',sans-serif;font-size:14px;font-weight:500;`;
    document.body.appendChild(n);
    setTimeout(() => n.remove(), 3500);
}

export { openUserModal, closeUserModal, saveUser, editUser, deleteUser, loadUsersList, createNewUser, cancelNewUser };
