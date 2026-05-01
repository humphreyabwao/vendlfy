// Import Inventory from Excel
import dataManager from './data-manager.js';
import auditLogger from './audit-logger.js';
import brandManager from './brand-manager.js';

class InventoryImporter {
    constructor() {
        this.importedData = [];
        this.validItems = [];
        this.invalidItems = [];
        this.requiredFields = ['name', 'category', 'price', 'quantity'];
        this.fieldMappings = {
            'product name': 'name',
            'name': 'name',
            'item name': 'name',
            'product': 'name',
            'category': 'category',
            'description': 'description',
            'price': 'price',
            'selling price': 'price',
            'sale price': 'price',
            'cost': 'cost',
            'cost price': 'cost',
            'purchase price': 'cost',
            'quantity': 'quantity',
            'qty': 'quantity',
            'stock': 'quantity',
            'stock quantity': 'quantity',
            'reorder level': 'reorderLevel',
            'reorder': 'reorderLevel',
            'min stock': 'reorderLevel',
            'supplier': 'supplier',
            'supplier name': 'supplier',
            'vendor': 'supplier',
            'unit': 'unit',
            'unit of measure': 'unit',
            'uom': 'unit',
            'expiry date': 'expiryDate',
            'expiry': 'expiryDate',
            'expiration date': 'expiryDate',
            'location': 'location',
            'storage location': 'location',
            'warehouse location': 'location'
        };
    }

    // Initialize importer
    init() {
        this.attachEventListeners();
        console.log('✅ InventoryImporter initialized');
    }

    // Attach event listeners
    attachEventListeners() {
        const importBtn = document.getElementById('importInventoryBtn');
        if (importBtn) {
            importBtn.addEventListener('click', () => this.openImportModal());
        }

        const closeModalBtn = document.getElementById('closeImportModal');
        if (closeModalBtn) {
            closeModalBtn.addEventListener('click', () => this.closeImportModal());
        }

        const fileInput = document.getElementById('importFileInput');
        if (fileInput) {
            fileInput.addEventListener('change', (e) => this.handleFileSelect(e));
        }

        const downloadTemplateBtn = document.getElementById('downloadTemplateBtn');
        if (downloadTemplateBtn) {
            downloadTemplateBtn.addEventListener('click', () => this.downloadTemplate());
        }

        const cancelImportBtn = document.getElementById('cancelImportBtn');
        if (cancelImportBtn) {
            cancelImportBtn.addEventListener('click', () => this.closeImportModal());
        }

        const confirmImportBtn = document.getElementById('confirmImportBtn');
        if (confirmImportBtn) {
            confirmImportBtn.addEventListener('click', () => this.processImport());
        }
    }

    // Open import modal
    openImportModal() {
        const modal = document.getElementById('importInventoryModal');
        if (modal) {
            modal.classList.add('active');
            this.resetImportState();
        }
    }

    // Close import modal
    closeImportModal() {
        const modal = document.getElementById('importInventoryModal');
        if (modal) {
            modal.classList.remove('active');
            this.resetImportState();
        }
    }

    // Reset import state
    resetImportState() {
        this.importedData = [];
        this.validItems = [];
        this.invalidItems = [];
        
        const fileInput = document.getElementById('importFileInput');
        if (fileInput) fileInput.value = '';
        
        const previewSection = document.getElementById('importPreviewSection');
        if (previewSection) previewSection.style.display = 'none';
        
        const uploadSection = document.getElementById('importUploadSection');
        if (uploadSection) uploadSection.style.display = 'block';
    }

    // Handle file selection
    async handleFileSelect(e) {
        const file = e.target.files[0];
        if (!file) return;

        // Check file type
        const validTypes = [
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'text/csv'
        ];

        if (!validTypes.includes(file.type) && !file.name.match(/\.(xlsx|xls|csv)$/i)) {
            window.showNotification('Please select a valid Excel or CSV file', 'error');
            e.target.value = '';
            return;
        }

        // Show loading
        this.showLoading(true);

        try {
            await this.readExcelFile(file);
            this.validateAndPreviewData();
        } catch (error) {
            console.error('Error reading file:', error);
            window.showNotification('Error reading file: ' + error.message, 'error');
        } finally {
            this.showLoading(false);
        }
    }

    // Read Excel file
    async readExcelFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = (e) => {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    
                    // Get first sheet
                    const firstSheetName = workbook.SheetNames[0];
                    const worksheet = workbook.Sheets[firstSheetName];
                    
                    // Convert to JSON
                    const jsonData = XLSX.utils.sheet_to_json(worksheet, { 
                        raw: false,
                        defval: ''
                    });

                    console.log('📊 Parsed Excel data:', jsonData);
                    this.importedData = jsonData;
                    resolve(jsonData);
                } catch (error) {
                    reject(error);
                }
            };

            reader.onerror = (error) => reject(error);
            reader.readAsArrayBuffer(file);
        });
    }

    // Validate and preview data
    validateAndPreviewData() {
        if (!this.importedData || this.importedData.length === 0) {
            window.showNotification('No data found in the file', 'error');
            return;
        }

        this.validItems = [];
        this.invalidItems = [];

        // Process each row
        this.importedData.forEach((row, index) => {
            const mappedItem = this.mapFields(row);
            const validation = this.validateItem(mappedItem, index + 2); // +2 for header row and 1-based index

            if (validation.isValid) {
                // Generate SKU if not provided
                if (!mappedItem.sku || mappedItem.sku.trim() === '') {
                    mappedItem.sku = this.generateSKU(mappedItem.name, mappedItem.category);
                }
                this.validItems.push(mappedItem);
            } else {
                this.invalidItems.push({
                    row: index + 2,
                    data: mappedItem,
                    errors: validation.errors
                });
            }
        });

        // Show preview
        this.showPreview();
    }

    // Map fields from Excel to internal format
    mapFields(row) {
        const mappedItem = {
            name: '',
            category: '',
            description: '',
            sku: '',
            price: 0,
            cost: 0,
            quantity: 0,
            reorderLevel: 5,
            supplier: '',
            unit: 'piece',
            expiryDate: null,
            location: ''
        };

        // Map each field
        Object.keys(row).forEach(key => {
            const normalizedKey = key.toLowerCase().trim();
            const mappedKey = this.fieldMappings[normalizedKey];
            
            if (mappedKey) {
                let value = row[key];
                
                // Handle numeric fields
                if (['price', 'cost', 'quantity', 'reorderLevel'].includes(mappedKey)) {
                    value = parseFloat(String(value).replace(/[^0-9.-]/g, '')) || 0;
                    if (mappedKey === 'quantity' || mappedKey === 'reorderLevel') {
                        value = parseInt(value) || 0;
                    }
                }
                
                // Handle date fields
                if (mappedKey === 'expiryDate' && value) {
                    try {
                        const date = new Date(value);
                        if (!isNaN(date.getTime())) {
                            value = date.toISOString().split('T')[0];
                        } else {
                            value = null;
                        }
                    } catch {
                        value = null;
                    }
                }

                mappedItem[mappedKey] = value;
            }
        });

        // Normalize category
        if (mappedItem.category) {
            mappedItem.category = this.normalizeCategory(mappedItem.category);
        }

        // Normalize unit
        if (mappedItem.unit) {
            mappedItem.unit = this.normalizeUnit(mappedItem.unit);
        }

        return mappedItem;
    }

    // Normalize category to match form options
    normalizeCategory(category) {
        const categoryMap = {
            'vodka': 'vodka',
            'whisky': 'whisky',
            'whiskey': 'whisky',
            'whisky / whiskey': 'whisky',
            'gin': 'gin',
            'rum': 'rum',
            'brandy': 'brandy',
            'cognac': 'brandy',
            'brandy & cognac': 'brandy',
            'tequila': 'tequila',
            'mezcal': 'tequila',
            'tequila & mezcal': 'tequila',
            'wine': 'wine',
            'wines': 'wine',
            'beer': 'beer',
            'cider': 'beer',
            'beer & cider': 'beer',
            'liqueurs': 'liqueurs',
            'liqueur': 'liqueurs',
            'creams': 'liqueurs',
            'liqueurs & creams': 'liqueurs',
            'rtd': 'rtd',
            'ready-to-drink': 'rtd',
            'flavored alcohol': 'rtd',
            'ready-to-drink (rtd) & flavored alcohol': 'rtd',
            'non-alcoholic': 'non-alcoholic',
            'non alcoholic': 'non-alcoholic',
            'soft drinks': 'non-alcoholic',
            'non-alcoholic drinks': 'non-alcoholic',
            'others': 'others',
            'other': 'others'
        };

        const normalized = category.toLowerCase().trim();
        return categoryMap[normalized] || 'others';
    }

    // Normalize unit to match form options
    normalizeUnit(unit) {
        const unitMap = {
            'piece': 'piece',
            'pcs': 'piece',
            'pc': 'piece',
            'pieces': 'piece',
            'kg': 'kg',
            'kilogram': 'kg',
            'kilograms': 'kg',
            'g': 'g',
            'gram': 'g',
            'grams': 'g',
            'liter': 'liter',
            'litre': 'liter',
            'l': 'liter',
            'liters': 'liter',
            'ml': 'ml',
            'milliliter': 'ml',
            'milliliters': 'ml',
            'box': 'box',
            'boxes': 'box',
            'pack': 'pack',
            'packs': 'pack',
            'packet': 'pack',
            'dozen': 'dozen',
            'doz': 'dozen'
        };

        const normalized = unit.toLowerCase().trim();
        return unitMap[normalized] || 'piece';
    }

    // Validate item
    validateItem(item, rowNumber) {
        const errors = [];

        // Check required fields
        if (!item.name || item.name.trim() === '') {
            errors.push('Product name is required');
        }

        if (!item.category || item.category.trim() === '') {
            errors.push('Category is required');
        }

        if (isNaN(item.price) || item.price <= 0) {
            errors.push('Valid price is required (must be greater than 0)');
        }

        if (isNaN(item.quantity) || item.quantity < 0) {
            errors.push('Valid quantity is required (cannot be negative)');
        }

        return {
            isValid: errors.length === 0,
            errors: errors
        };
    }

    // Generate SKU
    generateSKU(name, category) {
        const prefix = (category || 'GEN').substring(0, 3).toUpperCase();
        const namePart = (name || 'ITM').substring(0, 3).toUpperCase().replace(/[^A-Z]/g, '') || 'ITM';
        const timestamp = Date.now().toString().slice(-4);
        const randomPart = Math.random().toString(36).substring(2, 8).toUpperCase();
        
        return `${prefix}-${namePart}-${timestamp}-${randomPart}`;
    }

    // Show preview
    showPreview() {
        const uploadSection = document.getElementById('importUploadSection');
        const previewSection = document.getElementById('importPreviewSection');
        const summaryDiv = document.getElementById('importSummary');
        const validTableBody = document.getElementById('validItemsTableBody');
        const invalidTableBody = document.getElementById('invalidItemsTableBody');
        const validSection = document.getElementById('validItemsSection');
        const invalidSection = document.getElementById('invalidItemsSection');
        const confirmBtn = document.getElementById('confirmImportBtn');

        if (!previewSection) return;

        // Hide upload, show preview
        if (uploadSection) uploadSection.style.display = 'none';
        previewSection.style.display = 'block';

        // Show summary
        if (summaryDiv) {
            summaryDiv.innerHTML = `
                <div class="import-summary-grid">
                    <div class="import-summary-item success">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                        <div>
                            <div class="import-summary-value">${this.validItems.length}</div>
                            <div class="import-summary-label">Valid Items</div>
                        </div>
                    </div>
                    <div class="import-summary-item error">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"></circle>
                            <line x1="15" y1="9" x2="9" y2="15"></line>
                            <line x1="9" y1="9" x2="15" y2="15"></line>
                        </svg>
                        <div>
                            <div class="import-summary-value">${this.invalidItems.length}</div>
                            <div class="import-summary-label">Invalid Items</div>
                        </div>
                    </div>
                    <div class="import-summary-item info">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                            <polyline points="14 2 14 8 20 8"></polyline>
                        </svg>
                        <div>
                            <div class="import-summary-value">${this.importedData.length}</div>
                            <div class="import-summary-label">Total Rows</div>
                        </div>
                    </div>
                </div>
            `;
        }

        // Show valid items
        if (validTableBody && validSection) {
            if (this.validItems.length > 0) {
                validSection.style.display = 'block';
                validTableBody.innerHTML = this.validItems.map(item => `
                    <tr>
                        <td>${this.escapeHtml(item.name)}</td>
                        <td><span class="badge badge-${item.category}">${this.escapeHtml(item.category)}</span></td>
                        <td><code>${this.escapeHtml(item.sku)}</code></td>
                        <td>KSh ${item.price.toFixed(2)}</td>
                        <td>${item.quantity}</td>
                        <td>${this.escapeHtml(item.supplier || '-')}</td>
                    </tr>
                `).join('');
            } else {
                validSection.style.display = 'none';
            }
        }

        // Show invalid items
        if (invalidTableBody && invalidSection) {
            if (this.invalidItems.length > 0) {
                invalidSection.style.display = 'block';
                invalidTableBody.innerHTML = this.invalidItems.map(item => `
                    <tr>
                        <td>${item.row}</td>
                        <td>${this.escapeHtml(item.data.name || 'N/A')}</td>
                        <td>
                            <ul class="error-list">
                                ${item.errors.map(error => `<li>${this.escapeHtml(error)}</li>`).join('')}
                            </ul>
                        </td>
                    </tr>
                `).join('');
            } else {
                invalidSection.style.display = 'none';
            }
        }

        // Enable/disable confirm button
        if (confirmBtn) {
            confirmBtn.disabled = this.validItems.length === 0;
        }
    }

    // Process import
    async processImport() {
        if (this.validItems.length === 0) {
            window.showNotification('No valid items to import', 'error');
            return;
        }

        const confirmBtn = document.getElementById('confirmImportBtn');
        const cancelBtn = document.getElementById('cancelImportBtn');
        
        if (confirmBtn) {
            confirmBtn.disabled = true;
            confirmBtn.innerHTML = `
                <svg class="spinning" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" fill="none" stroke-dasharray="60" stroke-dashoffset="15" />
                </svg>
                Importing...
            `;
        }
        if (cancelBtn) cancelBtn.disabled = true;

        let successCount = 0;
        let failCount = 0;
        const errors = [];

        try {
            // Get existing inventory to check for duplicates
            console.log('📋 Checking for existing items...');
            const existingItems = await dataManager.getInventory();
            const existingSKUs = new Set(existingItems.map(item => (item.sku || '').toLowerCase().trim()));
            const existingNames = new Set(existingItems.map(item => (item.name || '').toLowerCase().trim()));
            
            console.log(`📊 Found ${existingItems.length} existing items in database`);
            
            // Import items one by one
            for (let i = 0; i < this.validItems.length; i++) {
                const item = this.validItems[i];
                
                try {
                    // Check for duplicate SKU or Name
                    const itemSKU = (item.sku || '').toLowerCase().trim();
                    const itemName = (item.name || '').toLowerCase().trim();
                    
                    if (existingSKUs.has(itemSKU)) {
                        console.warn(`⚠️ Skipping duplicate SKU: ${item.sku} (${item.name})`);
                        failCount++;
                        errors.push(`${item.name}: Item with SKU "${item.sku}" already exists`);
                        continue;
                    }
                    
                    if (existingNames.has(itemName)) {
                        console.warn(`⚠️ Skipping duplicate name: ${item.name}`);
                        failCount++;
                        errors.push(`${item.name}: Item with this name already exists`);
                        continue;
                    }
                    
                    // Add timestamp and default values
                    const itemData = {
                        ...item,
                        dateAdded: new Date().toISOString(),
                        salesLastMonth: 0
                    };

                    // Save to database
                    await dataManager.createInventoryItem(itemData);
                    
                    // Add to tracking sets to prevent duplicates within the same import
                    existingSKUs.add(itemSKU);
                    existingNames.add(itemName);
                    
                    successCount++;

                    // Update progress
                    if (confirmBtn) {
                        const progress = Math.round(((i + 1) / this.validItems.length) * 100);
                        confirmBtn.innerHTML = `
                            <svg class="spinning" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" fill="none" stroke-dasharray="60" stroke-dashoffset="15" />
                            </svg>
                            Importing... ${progress}%
                        `;
                    }
                } catch (error) {
                    console.error('Error importing item:', item.name, error);
                    failCount++;
                    errors.push(`${item.name}: ${error.message}`);
                }
            }

            // Log activity
            if (window.activityTracker) {
                window.activityTracker.logActivity('inventory', 'bulk_import', {
                    totalItems: this.validItems.length,
                    successCount: successCount,
                    failCount: failCount
                });
            }

            // Log audit
            if (window.auditLogger) {
                await auditLogger.logActivity('BULK_IMPORT', 'INVENTORY', {
                    message: `Imported ${successCount} items from Excel`,
                    totalItems: this.validItems.length,
                    successCount: successCount,
                    failCount: failCount
                });
            }

            // Show results
            if (successCount > 0) {
                window.showNotification(
                    `Successfully imported ${successCount} item${successCount > 1 ? 's' : ''}` +
                    (failCount > 0 ? `, ${failCount} skipped (duplicates or errors)` : ''),
                    failCount > 0 ? 'warning' : 'success'
                );
            } else if (failCount > 0) {
                window.showNotification(
                    `Import failed: All ${failCount} items were duplicates or had errors`,
                    'error'
                );
            }

            if (failCount > 0) {
                console.warn('Import issues:', errors);
                console.log('📋 Items skipped:', errors.slice(0, 5).join(', ') + (errors.length > 5 ? `... and ${errors.length - 5} more` : ''));
            }

            // Refresh inventory
            if (window.inventoryManager) {
                await window.inventoryManager.refresh();
            }

            // Close modal
            this.closeImportModal();

        } catch (error) {
            console.error('Error during import:', error);
            window.showNotification('Import failed: ' + error.message, 'error');
        } finally {
            // Restore buttons
            if (confirmBtn) {
                confirmBtn.disabled = false;
                confirmBtn.innerHTML = `
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                        <polyline points="17 8 12 3 7 8"></polyline>
                        <line x1="12" y1="3" x2="12" y2="15"></line>
                    </svg>
                    Confirm Import
                `;
            }
            if (cancelBtn) cancelBtn.disabled = false;
        }
    }

    // Download template
    downloadTemplate() {
        const template = [
            {
                'Product Name': 'Sample Product',
                'Category': 'Vodka',
                'Description': 'Product description',
                'Price': '100.00',
                'Cost': '80.00',
                'Quantity': '50',
                'Reorder Level': '10',
                'Supplier': 'Supplier Name',
                'Unit': 'piece',
                'Expiry Date': '',
                'Location': 'Shelf A'
            }
        ];

        const ws = XLSX.utils.json_to_sheet(template);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Inventory Template');

        // Set column widths
        ws['!cols'] = [
            { wch: 20 }, // Product Name
            { wch: 15 }, // Category
            { wch: 30 }, // Description
            { wch: 10 }, // Price
            { wch: 10 }, // Cost
            { wch: 10 }, // Quantity
            { wch: 12 }, // Reorder Level
            { wch: 20 }, // Supplier
            { wch: 10 }, // Unit
            { wch: 12 }, // Expiry Date
            { wch: 15 }  // Location
        ];

        const brandName = (brandManager.getBrand().name || 'Inventory').replace(/[^a-z0-9]+/gi, '_');
        XLSX.writeFile(wb, `${brandName}_Inventory_Template.xlsx`);
        window.showNotification('Template downloaded successfully', 'success');
    }

    // Show loading state
    showLoading(show) {
        const fileInput = document.getElementById('importFileInput');
        if (fileInput) fileInput.disabled = show;
    }

    // Escape HTML to prevent XSS
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Export singleton instance
const inventoryImporter = new InventoryImporter();
export default inventoryImporter;
