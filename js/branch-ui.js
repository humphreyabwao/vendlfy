// Branch UI Handlers
import branchManager from './branch-manager.js';

// Global functions for branch management
window.openBranchModal = openBranchModal;
window.closeBranchModal = closeBranchModal;
window.saveBranch = saveBranch;
window.editBranch = editBranch;
window.deleteBranch = deleteBranch;
window.loadBranchesList = loadBranchesList;

// ---------- Save-button state helpers (loading / success / error) ----------

const BTN_SPINNER_SVG = '<svg class="hr-btn-spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>';
const BTN_CHECK_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
const BTN_X_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

function setBranchBtnState(btn, state, label) {
    if (!btn) return;
    if (!btn.dataset.brOriginalHtml) btn.dataset.brOriginalHtml = btn.innerHTML;
    clearTimeout(btn._brRestoreTimer);
    btn.classList.remove('is-loading', 'is-success', 'is-error');

    if (state === 'loading') {
        btn.disabled = true;
        btn.classList.add('is-loading');
        btn.innerHTML = `${BTN_SPINNER_SVG}<span> ${label || 'Saving…'}</span>`;
        return;
    }
    if (state === 'success') {
        btn.disabled = true;
        btn.classList.add('is-success');
        btn.innerHTML = `${BTN_CHECK_SVG}<span> ${label || 'Saved!'}</span>`;
        btn._brRestoreTimer = setTimeout(() => setBranchBtnState(btn, 'idle'), 1100);
        return;
    }
    if (state === 'error') {
        btn.disabled = false;
        btn.classList.add('is-error');
        btn.innerHTML = `${BTN_X_SVG}<span> ${label || 'Failed'}</span>`;
        btn._brRestoreTimer = setTimeout(() => setBranchBtnState(btn, 'idle'), 1800);
        return;
    }
    btn.disabled = false;
    btn.innerHTML = btn.dataset.brOriginalHtml || btn.innerHTML;
}

function branchErrorMessage(e, action = 'save branch') {
    if (!e) return `Could not ${action}.`;
    const code = e.code || e?.cause?.code || '';
    const msg = (e.message || '').toLowerCase();
    if (code === 'permission-denied' || msg.includes('permission')) {
        return `Permission denied. Only admins can ${action}, and the Firestore rules must be deployed (run: firebase deploy --only firestore:rules).`;
    }
    if (code === 'timeout') {
        return `Network is slow — could not ${action} within 12 seconds. Check your connection and retry.`;
    }
    if (code === 'unavailable' || msg.includes('offline') || msg.includes('network')) {
        return `You appear to be offline — could not ${action}. Reconnect and retry.`;
    }
    if (code === 'unauthenticated') {
        return `Your session has expired. Please sign in again.`;
    }
    return `Could not ${action}: ${e.message || e}`;
}

// Open branch modal for adding/editing
function openBranchModal(branchId = null) {
    const modal = document.getElementById('branchModal');
    const form = document.getElementById('branchForm');
    const title = document.getElementById('branchModalTitle');
    const codeInput = document.getElementById('branchCode');
    
    form.reset();
    
    if (branchId) {
        // Edit mode
        const branch = branchManager.getBranchById(branchId);
        if (branch) {
            title.textContent = 'Edit Branch';
            document.getElementById('branchId').value = branch.id;
            document.getElementById('branchName').value = branch.name || '';
            codeInput.value = branch.code || '';
            document.getElementById('branchAddress').value = branch.address || '';
            document.getElementById('branchPhone').value = branch.phone || '';
            document.getElementById('branchManager').value = branch.manager || '';
            document.getElementById('branchStatus').value = branch.status || 'active';
        }
    } else {
        // Add mode - generate preview code
        title.textContent = 'Add New Branch';
        const previewCode = branchManager.generateBranchCode();
        codeInput.value = previewCode;
        codeInput.placeholder = previewCode;
    }
    
    modal.classList.add('active');
}

// Close branch modal
function closeBranchModal() {
    const modal = document.getElementById('branchModal');
    modal.classList.remove('active');
}

// Save branch (add or update). Robust against load-order races: prevents
// the default form submit BEFORE awaiting anything, so the page never
// navigates even if some dependency is slow to load.
async function saveBranch(event) {
    if (event) {
        try { event.preventDefault(); } catch (_) {}
        try { event.stopPropagation(); } catch (_) {}
    }

    const form = (event && event.target) || document.getElementById('branchForm');
    if (!form) {
        console.error('[branches] No form found in saveBranch event');
        return false;
    }
    const submitBtn = form.querySelector('button[type="submit"]');
    const formData = new FormData(form);
    const branchId = (formData.get('branchId') || '').toString().trim();
    const name = (formData.get('name') || '').toString().trim();

    if (!name) {
        showNotification('Branch name is required', 'error');
        setBranchBtnState(submitBtn, 'error', 'Name required');
        return false;
    }

    const branchData = {
        name,
        address: (formData.get('address') || '').toString().trim(),
        phone: (formData.get('phone') || '').toString().trim(),
        manager: (formData.get('manager') || '').toString().trim(),
        status: formData.get('status') || 'active'
    };

    setBranchBtnState(submitBtn, 'loading', branchId ? 'Saving…' : 'Creating…');
    console.log('🏢 [branches] Saving branch', branchId ? `(edit ${branchId})` : '(new)', branchData);

    try {
        let saved;
        if (branchId) {
            await branchManager.updateBranch(branchId, branchData);
            console.log('✅ [branches] Branch updated:', branchId);
            saved = { id: branchId, ...branchData };
        } else {
            branchData.isCentral = false;
            saved = await branchManager.createBranch(branchData);
            console.log('✅ [branches] Branch created:', saved);
        }

        setBranchBtnState(submitBtn, 'success', branchId ? 'Saved!' : 'Created!');
        showNotification(
            branchId ? `Branch "${branchData.name}" updated` : `Branch "${branchData.name}" created`,
            'success'
        );

        // Always refresh the list immediately so the UI reflects the change
        // even if the realtime listener hasn't fired yet.
        try { await loadBranchesList(); } catch (_) {}
        try { if (typeof window.populateBranchSelector === 'function') await window.populateBranchSelector(); } catch (_) {}

        // Close after the success state has been visible for a moment.
        setTimeout(() => closeBranchModal(), 700);
    } catch (error) {
        console.error('❌ [branches] Save branch failed:', error);
        setBranchBtnState(submitBtn, 'error', 'Failed');
        showNotification(branchErrorMessage(error, branchId ? 'update branch' : 'create branch'), 'error');
    }

    return false; // belt-and-braces against legacy onsubmit returns
}

// Edit branch
function editBranch(branchId) {
    openBranchModal(branchId);
}

// Delete branch
async function deleteBranch(branchId) {
    const branch = branchManager.getBranchById(branchId);

    if (!branch) return;

    if (branch.isCentral) {
        showNotification('Cannot delete central branch', 'error');
        return;
    }

    const ok = await window.uiConfirm?.({
        title: 'Delete branch?',
        message: `Are you sure you want to delete "${branch.name}"? This cannot be undone.`,
        tone: 'danger',
        okLabel: 'Delete'
    });
    if (!ok) return;

    console.log('🗑️  [branches] Deleting branch', branchId, branch.name);
    showNotification(`Deleting "${branch.name}"…`, 'info');

    try {
        await branchManager.deleteBranch(branchId);
        console.log('✅ [branches] Branch deleted:', branchId);
        showNotification(`Branch "${branch.name}" deleted`, 'success');
        try { await loadBranchesList(); } catch (_) {}
        try { if (typeof window.populateBranchSelector === 'function') await window.populateBranchSelector(); } catch (_) {}
    } catch (error) {
        console.error('❌ [branches] Delete branch failed:', error);
        showNotification(branchErrorMessage(error, 'delete branch'), 'error');
    }
}

// Load and display branches list
async function loadBranchesList() {
    const container = document.getElementById('branchesListContainer');
    if (!container) return;
    
    const branches = branchManager.getAllBranches();
    
    if (branches.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
                <p>No branches found</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = branches.map(branch => `
        <div class="branch-card">
            <div class="branch-card-header">
                <div>
                    <div class="branch-card-title">${branch.name}</div>
                    <div class="branch-card-code">${branch.code}</div>
                </div>
                <div>
                    ${branch.isCentral ? 
                        '<span class="branch-badge central">Central</span>' :
                        `<span class="branch-badge ${branch.status}">${branch.status}</span>`
                    }
                </div>
            </div>
            
            <div class="branch-card-info">
                ${branch.address ? `
                    <div class="branch-info-item">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                            <circle cx="12" cy="10" r="3"></circle>
                        </svg>
                        <span>${branch.address}</span>
                    </div>
                ` : ''}
                
                ${branch.phone ? `
                    <div class="branch-info-item">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
                        </svg>
                        <span>${branch.phone}</span>
                    </div>
                ` : ''}
                
                ${branch.manager ? `
                    <div class="branch-info-item">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                            <circle cx="12" cy="7" r="4"></circle>
                        </svg>
                        <span>${branch.manager}</span>
                    </div>
                ` : ''}
            </div>
            
            <div class="branch-card-actions">
                <button class="btn btn-secondary" onclick="editBranch('${branch.id}')">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                    </svg>
                    Edit
                </button>
                ${!branch.isCentral ? `
                    <button class="btn btn-danger" onclick="deleteBranch('${branch.id}')">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                        Delete
                    </button>
                ` : '<span style="flex: 1;"></span>'}
            </div>
        </div>
    `).join('');
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
    // Start real-time listener for branches
    branchManager.startRealtimeListener();
    
    // Add callback for UI updates
    branchManager.onBranchesUpdated((branches) => {
        console.log('🔄 UI: Branches updated, refreshing list...');
        loadBranchesList();
    });
    
    // Listen for custom events
    window.addEventListener('branchesUpdated', (event) => {
        console.log('🔄 UI: Received branches updated event');
        // UI is already updated by the callback above
    });
}

// Listen for navigation to admin page
window.addEventListener('DOMContentLoaded', () => {
    // Initialize real-time updates
    initRealtimeUpdates();

    // Bind the branch form submit explicitly via JS so the handler runs
    // reliably even if module load order or a stale cache means the inline
    // onsubmit="saveBranch(event)" attribute fires before window.saveBranch
    // is defined (which would let the form submit via default GET and look
    // like the modal "stays for a moment and disappears").
    const branchForm = document.getElementById('branchForm');
    if (branchForm) {
        branchForm.addEventListener('submit', (e) => {
            // Always block default first — even if our handler then errors.
            e.preventDefault();
            e.stopPropagation();
            void saveBranch(e);
        });
        // Also clear the inline attribute so it can't fire twice / fight us.
        branchForm.removeAttribute('onsubmit');
    } else {
        console.warn('[branches] #branchForm not found at DOMContentLoaded');
    }

    // Load branches when admin page is accessed
    const navLinks = document.querySelectorAll('[data-page="admin"]');
    navLinks.forEach(link => {
        link.addEventListener('click', () => {
            setTimeout(() => loadBranchesList(), 100);
        });
    });
});

// Export for use in other modules
export { openBranchModal, closeBranchModal, saveBranch, editBranch, deleteBranch, loadBranchesList };
