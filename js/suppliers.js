// Supplier Manager
import { db, collection, addDoc, getDocs, doc, updateDoc, deleteDoc, query, where, orderBy as firestoreOrderBy, Timestamp, serverTimestamp } from './firebase-config.js';

const supplierManager = {
    suppliers: [],
    filteredSuppliers: [],
    currentFilter: 'all',
    editingId: null,
    initialized: false,
    refreshInterval: null,

    init() {
        if (this.initialized) {
            console.log('Supplier Manager already initialized, refreshing data...');
            this.loadSuppliers();
            return;
        }
        
        console.log('Initializing Supplier Manager...');
        this.initialized = true;
        
        this.waitForFirebase().then(() => {
            this.loadSuppliers();
            this.setupEventListeners();
            this.renderSuppliersTable();
            
            // Clear any existing interval
            if (this.refreshInterval) {
                clearInterval(this.refreshInterval);
            }
            
            // Auto-refresh every 30 seconds
            this.refreshInterval = setInterval(() => {
                this.loadSuppliers();
            }, 30000);
        });
    },

    async waitForFirebase() {
        let attempts = 0;
        while (!window.db && attempts < 50) {
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
        }
        if (!window.db) {
            console.error('Firebase not available after waiting');
        }
    },

    setupEventListeners() {
        // Form submission
        const form = document.getElementById('addSupplierForm');
        if (form) {
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                this.saveSupplier();
            });
        }

        // Search input
        const searchInput = document.getElementById('suppliersSearchInput');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.searchSuppliers(e.target.value);
            });
        }

        // Filter buttons
        const filterBtns = document.querySelectorAll('#add-supplier-page .b2b-filter-btn');
        filterBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                // Remove active class from all buttons
                filterBtns.forEach(b => b.classList.remove('active'));
                // Add active class to clicked button
                e.target.classList.add('active');
                // Filter suppliers
                this.currentFilter = e.target.dataset.status;
                this.filterSuppliers(this.currentFilter);
            });
        });
    },

    async loadSuppliers() {
        try {
            if (!window.db) {
                console.error('Firestore database not initialized');
                this.renderSuppliersTable(); // Render empty state
                return;
            }

            const branchId = window.branchManager?.currentBranch;
            if (!branchId) {
                console.log('No branch selected');
                this.suppliers = [];
                this.filteredSuppliers = [];
                this.renderSuppliersTable(); // Render empty state
                return;
            }

            console.log('Loading suppliers for branch:', branchId);

            const suppliersRef = collection(db, 'suppliers');
            
            // Try loading ALL suppliers first to see if any exist
            console.log('🔍 Attempting to load ALL suppliers from Firestore...');
            const allSnapshot = await getDocs(suppliersRef);
            console.log(`📊 Found ${allSnapshot.size} total suppliers in database (all branches)`);
            
            if (allSnapshot.size > 0) {
                const firstDoc = allSnapshot.docs[0].data();
                console.log('📄 Sample supplier data:', {
                    name: firstDoc.name,
                    company: firstDoc.company,
                    branchId: firstDoc.branchId,
                    status: firstDoc.status
                });
            }
            
            // Now filter by branch using simple query first (no ordering)
            console.log(`🔍 Loading suppliers for current branch: ${branchId}`);
            const simpleQuery = query(
                suppliersRef,
                where('branchId', '==', branchId)
            );
            
            const simpleSnapshot = await getDocs(simpleQuery);
            console.log(`📊 Found ${simpleSnapshot.size} suppliers for branch ${branchId} (without ordering)`);
            
            this.suppliers = [];
            simpleSnapshot.forEach(docSnap => {
                this.suppliers.push({
                    id: docSnap.id,
                    ...docSnap.data()
                });
            });
            
            // Sort in memory instead of using Firestore orderBy
            this.suppliers.sort((a, b) => {
                const dateA = a.createdAt?.toDate?.() || new Date(0);
                const dateB = b.createdAt?.toDate?.() || new Date(0);
                return dateB - dateA; // Descending order
            });

            console.log(`✅ Loaded ${this.suppliers.length} suppliers for branch ${branchId}`);
            
            // Apply current filter
            if (this.currentFilter === 'all') {
                this.filteredSuppliers = [...this.suppliers];
            } else {
                this.filteredSuppliers = this.suppliers.filter(s => s.status === this.currentFilter);
            }
            
            console.log(`Displaying ${this.filteredSuppliers.length} suppliers after filter: ${this.currentFilter}`);
            this.renderSuppliersTable();

            // Update orders manager if available
            if (window.ordersManager) {
                window.ordersManager.loadSuppliers();
            }
        } catch (error) {
            console.error('❌ Error loading suppliers:', error);
            console.error('Error details:', error.message);
            console.error('Error code:', error.code);
            
            // If it's an index error, show helpful message
            if (error.message && error.message.includes('index')) {
                console.error('⚠️ FIRESTORE INDEX REQUIRED:');
                console.error('Click the link above to create the required index, or create manually:');
                console.error('Collection: suppliers');
                console.error('Fields: branchId (Ascending), createdAt (Descending)');
            }
            
            this.renderSuppliersTable(); // Render what we have
        }
    },

    async saveSupplier() {
        if (!window.db) {
            this.showNotification('Database not available. Please refresh the page.', 'error');
            return;
        }

        const supplierData = {
            name: document.getElementById('supplierName').value.trim(),
            email: document.getElementById('supplierEmail').value.trim(),
            phone: document.getElementById('supplierPhone').value.trim(),
            company: document.getElementById('supplierCompany').value.trim(),
            category: document.getElementById('supplierCategory').value,
            status: document.getElementById('supplierStatus').value,
            address: document.getElementById('supplierAddress').value.trim(),
            city: document.getElementById('supplierCity').value.trim(),
            notes: document.getElementById('supplierNotes').value.trim(),
            branchId: window.branchManager?.currentBranch,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        };

        // Validation
        if (!supplierData.name || !supplierData.email || !supplierData.phone) {
            this.showNotification('Please fill in all required fields', 'error');
            return;
        }

        // Email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(supplierData.email)) {
            this.showNotification('Please enter a valid email address', 'error');
            return;
        }

        if (!supplierData.branchId) {
            this.showNotification('Please select a branch first', 'error');
            return;
        }

        try {
            console.log('Saving supplier:', supplierData);

            if (this.editingId) {
                // Update existing supplier
                const supplierRef = doc(db, 'suppliers', this.editingId);
                const updateData = {
                    name: supplierData.name,
                    email: supplierData.email,
                    phone: supplierData.phone,
                    company: supplierData.company,
                    category: supplierData.category,
                    status: supplierData.status,
                    address: supplierData.address,
                    city: supplierData.city,
                    notes: supplierData.notes,
                    branchId: supplierData.branchId,
                    updatedAt: serverTimestamp()
                };
                await updateDoc(supplierRef, updateData);
                console.log('✅ Supplier updated successfully');
                this.showNotification('Supplier updated successfully!', 'success');
                this.editingId = null;
            } else {
                // Add new supplier
                const suppliersRef = collection(db, 'suppliers');
                const docRef = await addDoc(suppliersRef, supplierData);
                console.log('✅ Supplier added successfully with ID:', docRef.id);
                this.showNotification('Supplier added successfully!', 'success');
            }

            // Reset form
            document.getElementById('addSupplierForm').reset();
            document.getElementById('saveSupplierBtn').innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                    <polyline points="17 21 17 13 7 13 7 21"></polyline>
                    <polyline points="7 3 7 8 15 8"></polyline>
                </svg>
                Save Supplier
            `;

            // Small delay to ensure Firestore write is complete
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Reload suppliers to show the new one
            console.log('Reloading suppliers table...');
            await this.loadSuppliers();
            
            console.log('✅ Table updated with new supplier');
        } catch (error) {
            console.error('❌ Error saving supplier:', error);
            console.error('Error details:', error.message);
            
            // Show specific error message
            if (error.code === 'permission-denied') {
                this.showNotification('Permission denied. Please check Firestore rules.', 'error');
            } else if (error.message && error.message.includes('index')) {
                this.showNotification('Database index required. Check console for details.', 'error');
                console.error('⚠️ Create composite index: branchId (Ascending) + createdAt (Descending)');
            } else {
                this.showNotification('Failed to save supplier: ' + error.message, 'error');
            }
        }
    },

    renderSuppliersTable() {
        const tbody = document.getElementById('suppliersTableBody');
        if (!tbody) {
            console.error('❌ Table body element not found: suppliersTableBody');
            return;
        }

        console.log(`📊 Rendering ${this.filteredSuppliers.length} suppliers to table...`);
        console.log('Current suppliers data:', this.filteredSuppliers);

        if (this.filteredSuppliers.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="9" style="text-align: center; padding: 3rem;">
                        <div class="empty-state-inline">
                            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                                <circle cx="9" cy="7" r="4"></circle>
                                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                            </svg>
                            <p>No suppliers found. Add your first supplier!</p>
                        </div>
                    </td>
                </tr>
            `;
            console.log('✅ Rendered empty state for suppliers table');
            return;
        }

        try {
            const rows = this.filteredSuppliers.map(supplier => {
                console.log('Rendering supplier:', supplier.name);
                return `
                <tr>
                    <td><strong>${this.escapeHtml(supplier.name)}</strong></td>
                    <td>${this.escapeHtml(supplier.company || 'N/A')}</td>
                    <td>${this.escapeHtml(supplier.email)}</td>
                    <td>${this.escapeHtml(supplier.phone)}</td>
                    <td style="text-align: center;">
                        ${supplier.category ? `<span class="category-badge">${this.capitalizeFirst(supplier.category)}</span>` : 'N/A'}
                    </td>
                    <td>${this.escapeHtml(supplier.city || supplier.address || 'N/A')}</td>
                    <td style="text-align: center;">
                        <span class="status-badge ${supplier.status === 'active' ? 'completed' : 'cancelled'}">
                            ${this.capitalizeFirst(supplier.status || 'active')}
                        </span>
                    </td>
                    <td>${this.formatDate(supplier.createdAt)}</td>
                    <td style="text-align: center;">
                        <div class="table-actions">
                            <button class="btn-icon" onclick="supplierManager.viewSupplier('${supplier.id}')" title="View Details">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                    <circle cx="12" cy="12" r="3"></circle>
                                </svg>
                            </button>
                            <button class="btn-icon" onclick="supplierManager.editSupplier('${supplier.id}')" title="Edit Supplier">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                                </svg>
                            </button>
                            <button class="btn-icon" onclick="supplierManager.deleteSupplier('${supplier.id}')" title="Delete Supplier">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <polyline points="3 6 5 6 21 6"></polyline>
                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                </svg>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
            }).join('');
            
            tbody.innerHTML = rows;
            console.log(`✅ Successfully rendered ${this.filteredSuppliers.length} suppliers to table`);
        } catch (error) {
            console.error('❌ Error rendering suppliers table:', error);
        }
    },

    filterSuppliers(status) {
        if (status === 'all') {
            this.filteredSuppliers = [...this.suppliers];
        } else {
            this.filteredSuppliers = this.suppliers.filter(s => s.status === status);
        }
        this.renderSuppliersTable();
    },

    searchSuppliers(query) {
        const searchTerm = query.toLowerCase().trim();
        
        if (!searchTerm) {
            this.filterSuppliers(this.currentFilter);
            return;
        }

        this.filteredSuppliers = this.suppliers.filter(supplier => {
            const name = (supplier.name || '').toLowerCase();
            const company = (supplier.company || '').toLowerCase();
            const email = (supplier.email || '').toLowerCase();
            const phone = (supplier.phone || '').toLowerCase();
            const category = (supplier.category || '').toLowerCase();
            const city = (supplier.city || '').toLowerCase();
            
            return name.includes(searchTerm) ||
                   company.includes(searchTerm) ||
                   email.includes(searchTerm) ||
                   phone.includes(searchTerm) ||
                   category.includes(searchTerm) ||
                   city.includes(searchTerm);
        });

        this.renderSuppliersTable();
    },

    viewSupplier(supplierId) {
        const supplier = this.suppliers.find(s => s.id === supplierId);
        if (!supplier) return;

        const modal = document.createElement('div');
        modal.className = 'pos-modal';
        modal.innerHTML = `
            <div class="pos-modal-content" style="max-width: 600px;">
                <div class="pos-modal-header">
                    <h3>Supplier Details</h3>
                    <button class="pos-modal-close" onclick="this.closest('.pos-modal').remove()">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
                <div class="pos-modal-body">
                    <div class="detail-section">
                        <h4>Contact Information</h4>
                        <div class="detail-row">
                            <span>Supplier Name:</span>
                            <strong>${this.escapeHtml(supplier.name)}</strong>
                        </div>
                        ${supplier.company ? `
                        <div class="detail-row">
                            <span>Company:</span>
                            <strong>${this.escapeHtml(supplier.company)}</strong>
                        </div>
                        ` : ''}
                        <div class="detail-row">
                            <span>Email:</span>
                            <strong>${this.escapeHtml(supplier.email)}</strong>
                        </div>
                        <div class="detail-row">
                            <span>Phone:</span>
                            <strong>${this.escapeHtml(supplier.phone)}</strong>
                        </div>
                        ${supplier.category ? `
                        <div class="detail-row">
                            <span>Category:</span>
                            <span class="category-badge">${this.capitalizeFirst(supplier.category)}</span>
                        </div>
                        ` : ''}
                        <div class="detail-row">
                            <span>Status:</span>
                            <span class="status-badge ${supplier.status === 'active' ? 'completed' : 'cancelled'}">
                                ${this.capitalizeFirst(supplier.status || 'active')}
                            </span>
                        </div>
                    </div>

                    ${supplier.address || supplier.city ? `
                    <div class="detail-section">
                        <h4>Location</h4>
                        ${supplier.address ? `
                        <div class="detail-row">
                            <span>Address:</span>
                            <strong>${this.escapeHtml(supplier.address)}</strong>
                        </div>
                        ` : ''}
                        ${supplier.city ? `
                        <div class="detail-row">
                            <span>City:</span>
                            <strong>${this.escapeHtml(supplier.city)}</strong>
                        </div>
                        ` : ''}
                    </div>
                    ` : ''}

                    ${supplier.notes ? `
                    <div class="detail-section">
                        <h4>Notes</h4>
                        <p>${this.escapeHtml(supplier.notes)}</p>
                    </div>
                    ` : ''}

                    <div class="detail-section">
                        <h4>Record Information</h4>
                        <div class="detail-row">
                            <span>Added On:</span>
                            <strong>${this.formatDate(supplier.createdAt)}</strong>
                        </div>
                        ${supplier.updatedAt ? `
                        <div class="detail-row">
                            <span>Last Updated:</span>
                            <strong>${this.formatDate(supplier.updatedAt)}</strong>
                        </div>
                        ` : ''}
                    </div>
                </div>
                <div class="pos-modal-footer">
                    <button class="btn btn-secondary" onclick="this.closest('.pos-modal').remove()">Close</button>
                    <button class="btn btn-primary" onclick="supplierManager.editSupplier('${supplier.id}'); this.closest('.pos-modal').remove();">
                        Edit Supplier
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    },

    editSupplier(supplierId) {
        const supplier = this.suppliers.find(s => s.id === supplierId);
        if (!supplier) return;

        // Populate form
        document.getElementById('supplierName').value = supplier.name || '';
        document.getElementById('supplierEmail').value = supplier.email || '';
        document.getElementById('supplierPhone').value = supplier.phone || '';
        document.getElementById('supplierCompany').value = supplier.company || '';
        document.getElementById('supplierCategory').value = supplier.category || '';
        document.getElementById('supplierStatus').value = supplier.status || 'active';
        document.getElementById('supplierAddress').value = supplier.address || '';
        document.getElementById('supplierCity').value = supplier.city || '';
        document.getElementById('supplierNotes').value = supplier.notes || '';

        // Update button text
        document.getElementById('saveSupplierBtn').innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                <polyline points="17 21 17 13 7 13 7 21"></polyline>
                <polyline points="7 3 7 8 15 8"></polyline>
            </svg>
            Update Supplier
        `;

        // Set editing ID
        this.editingId = supplierId;

        // Scroll to form
        document.querySelector('.form-card-compact').scrollIntoView({ behavior: 'smooth' });
    },

    async deleteSupplier(supplierId) {
        if (!confirm('Are you sure you want to delete this supplier? This action cannot be undone.')) {
            return;
        }

        try {
            const supplierRef = doc(db, 'suppliers', supplierId);
            await deleteDoc(supplierRef);
            console.log('✅ Supplier deleted successfully');
            this.showNotification('Supplier deleted successfully!', 'success');
            await this.loadSuppliers();
        } catch (error) {
            console.error('❌ Error deleting supplier:', error);
            console.error('Error details:', error.message);
            this.showNotification('Failed to delete supplier: ' + error.message, 'error');
        }
    },

    // Helper methods
    formatDate(timestamp) {
        if (!timestamp) return 'N/A';
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        return date.toLocaleDateString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric'
        });
    },

    capitalizeFirst(str) {
        if (!str) return '';
        return str.charAt(0).toUpperCase() + str.slice(1);
    },

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 1rem 1.5rem;
            background: ${type === 'success' ? '#22c55e' : type === 'error' ? '#ef4444' : '#3b82f6'};
            color: white;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 10000;
            animation: slideIn 0.3s ease;
        `;
        notification.textContent = message;

        document.body.appendChild(notification);

        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    },

    clearForm() {
        document.getElementById('addSupplierForm').reset();
        this.editingId = null;
        document.getElementById('saveSupplierBtn').innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                <polyline points="17 21 17 13 7 13 7 21"></polyline>
                <polyline points="7 3 7 8 15 8"></polyline>
            </svg>
            Save Supplier
        `;
    }
};

// Export as default
export default supplierManager;

// Make it globally available
window.supplierManager = supplierManager;
