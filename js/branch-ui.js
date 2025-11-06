// Branch UI Handlers
import branchManager from './branch-manager.js';

// Global functions for branch management
window.openBranchModal = openBranchModal;
window.closeBranchModal = closeBranchModal;
window.saveBranch = saveBranch;
window.editBranch = editBranch;
window.deleteBranch = deleteBranch;
window.loadBranchesList = loadBranchesList;

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

// Save branch (add or update)
async function saveBranch(event) {
    event.preventDefault();
    
    const form = event.target;
    const formData = new FormData(form);
    const branchId = formData.get('branchId');
    
    const branchData = {
        name: formData.get('name'),
        address: formData.get('address'),
        phone: formData.get('phone'),
        manager: formData.get('manager'),
        status: formData.get('status')
    };
    
    try {
        if (branchId) {
            // Update existing branch (don't change code)
            await branchManager.updateBranch(branchId, branchData);
            showNotification('Branch updated successfully', 'success');
        } else {
            // Create new branch (code will be auto-generated)
            branchData.isCentral = false;
            await branchManager.createBranch(branchData);
            showNotification('Branch created successfully', 'success');
        }
        
        closeBranchModal();
        await loadBranchesList();
        await window.populateBranchSelector();
        
    } catch (error) {
        console.error('Error saving branch:', error);
        showNotification('Error saving branch: ' + error.message, 'error');
    }
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
    
    if (confirm(`Are you sure you want to delete "${branch.name}"? This action cannot be undone.`)) {
        try {
            await branchManager.deleteBranch(branchId);
            showNotification('Branch deleted successfully', 'success');
            await loadBranchesList();
            await window.populateBranchSelector();
        } catch (error) {
            console.error('Error deleting branch:', error);
            showNotification('Error deleting branch: ' + error.message, 'error');
        }
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
