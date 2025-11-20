// Add Item Module
import dataManager from './data-manager.js';
import branchManager from './branch-manager.js';

class AddItemManager {
    constructor() {
        this.currentBarcode = null;
        this.barcodeStream = null;
        this.initialized = false;
        this.isSaving = false; // Prevent multiple simultaneous submissions
    }

    // Initialize add item functionality
    init() {
        // Prevent multiple initializations
        if (this.initialized) {
            console.log('⚠️ AddItemManager already initialized, skipping...');
            return;
        }
        this.attachEventListeners();
        this.initialized = true;
        console.log('✅ AddItemManager initialized');
    }

    // Attach event listeners
    attachEventListeners() {
        const form = document.getElementById('addItemForm');
        if (form) {
            form.addEventListener('submit', (e) => this.handleSubmit(e));
        }

        // Generate SKU
        const generateSKUBtn = document.getElementById('generateSKUBtn');
        if (generateSKUBtn) {
            generateSKUBtn.addEventListener('click', () => this.generateSKU());
        }

        // Generate Barcode
        const generateBarcodeBtn = document.getElementById('generateBarcodeBtn');
        if (generateBarcodeBtn) {
            generateBarcodeBtn.addEventListener('click', () => this.generateBarcode());
        }

        // Print Barcode
        const printBarcodeBtn = document.getElementById('printBarcodeBtn');
        if (printBarcodeBtn) {
            printBarcodeBtn.addEventListener('click', () => this.printBarcode());
        }

        // Barcode size change
        const barcodeSizeSelect = document.getElementById('barcodeSizeSelect');
        if (barcodeSizeSelect) {
            barcodeSizeSelect.addEventListener('change', () => {
                if (this.currentBarcode) {
                    this.generateBarcode();
                }
            });
        }

        // Scan Barcode
        const scanBarcodeBtn = document.getElementById('scanBarcodeBtn');
        if (scanBarcodeBtn) {
            scanBarcodeBtn.addEventListener('click', () => this.openBarcodeScanner());
        }

        // Close Scanner
        const closeScannerBtn = document.getElementById('closeScannerBtn');
        if (closeScannerBtn) {
            closeScannerBtn.addEventListener('click', () => this.closeBarcodeScanner());
        }

        // Cancel button
        const cancelBtn = document.getElementById('cancelAddItemBtn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => this.cancelForm());
        }

        // Save and New button
        const saveAndNewBtn = document.getElementById('saveAndNewBtn');
        if (saveAndNewBtn) {
            saveAndNewBtn.addEventListener('click', () => this.handleSaveAndNew());
        }

        // Auto-generate SKU when name is entered
        const itemName = document.getElementById('itemName');
        if (itemName) {
            itemName.addEventListener('blur', () => {
                const skuInput = document.getElementById('itemSKU');
                if (skuInput && !skuInput.value) {
                    this.generateSKU();
                }
            });
        }
    }

    // Generate SKU
    generateSKU() {
        const name = document.getElementById('itemName')?.value || '';
        const category = document.getElementById('itemCategory')?.value || 'GEN';
        
        const prefix = category.substring(0, 3).toUpperCase();
        const namePart = name.substring(0, 3).toUpperCase().replace(/[^A-Z]/g, '') || 'ITM';
        const randomPart = Math.random().toString(36).substring(2, 8).toUpperCase();
        const timestamp = Date.now().toString().slice(-4);
        
        const sku = `${prefix}-${namePart}-${timestamp}-${randomPart}`;
        
        const skuInput = document.getElementById('itemSKU');
        if (skuInput) {
            skuInput.value = sku;
        }

        window.showNotification('SKU generated successfully', 'success');
    }

    // Generate Barcode
    async generateBarcode() {
        const skuInput = document.getElementById('itemSKU');
        const sku = skuInput?.value;

        if (!sku) {
            window.showNotification('Please enter or generate a SKU first', 'info');
            return;
        }

        // Load JsBarcode library if not loaded
        if (typeof JsBarcode === 'undefined') {
            await this.loadJsBarcode();
        }

        const canvas = document.getElementById('barcodeCanvas');
        const preview = document.getElementById('barcodePreview');
        const printBtn = document.getElementById('printBarcodeBtn');
        const sizeSelect = document.getElementById('barcodeSizeSelect');
        
        if (!canvas) return;

        // Get size settings
        const size = sizeSelect?.value || 'medium';
        const sizeSettings = {
            small: { width: 1.5, height: 40, fontSize: 12 },
            medium: { width: 2, height: 60, fontSize: 14 },
            large: { width: 2.5, height: 80, fontSize: 16 }
        };

        const settings = sizeSettings[size];

        try {
            JsBarcode(canvas, sku, {
                format: 'CODE128',
                width: settings.width,
                height: settings.height,
                fontSize: settings.fontSize,
                textMargin: 5,
                margin: 10,
                displayValue: true
            });

            this.currentBarcode = sku;
            preview.style.display = 'block';
            if (printBtn) printBtn.disabled = false;

            window.showNotification('Barcode generated successfully', 'success');
        } catch (error) {
            console.error('Error generating barcode:', error);
            window.showNotification('Failed to generate barcode', 'error');
        }
    }

    // Load JsBarcode library
    loadJsBarcode() {
        return new Promise((resolve, reject) => {
            if (typeof JsBarcode !== 'undefined') {
                resolve();
                return;
            }

            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js';
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    // Print Barcode
    printBarcode() {
        const canvas = document.getElementById('barcodeCanvas');
        if (!canvas || !this.currentBarcode) {
            window.showNotification('No barcode to print', 'info');
            return;
        }

        const itemName = document.getElementById('itemName')?.value || 'Product';
        const price = document.getElementById('itemPrice')?.value || '0.00';
        const sizeSelect = document.getElementById('barcodeSizeSelect');
        const size = sizeSelect?.value || 'medium';

        // Create print window
        const printWindow = window.open('', '_blank');
        const dataUrl = canvas.toDataURL('image/png');

        // Size dimensions in mm
        const dimensions = {
            small: { width: '40mm', height: '20mm' },
            medium: { width: '50mm', height: '30mm' },
            large: { width: '70mm', height: '40mm' }
        };

        const dim = dimensions[size];

        printWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Print Barcode - ${this.currentBarcode}</title>
                <style>
                    @page {
                        size: ${dim.width} ${dim.height};
                        margin: 0;
                    }
                    body {
                        margin: 0;
                        padding: 0;
                        width: ${dim.width};
                        height: ${dim.height};
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        justify-content: center;
                        font-family: Arial, sans-serif;
                    }
                    .label {
                        width: 100%;
                        height: 100%;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        justify-content: center;
                        padding: 2mm;
                        box-sizing: border-box;
                    }
                    .product-name {
                        font-size: ${size === 'small' ? '8px' : size === 'medium' ? '10px' : '12px'};
                        font-weight: bold;
                        text-align: center;
                        margin-bottom: 1mm;
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
                        max-width: 100%;
                    }
                    .barcode {
                        max-width: 100%;
                        height: auto;
                    }
                    .price {
                        font-size: ${size === 'small' ? '10px' : size === 'medium' ? '12px' : '14px'};
                        font-weight: bold;
                        margin-top: 1mm;
                    }
                </style>
            </head>
            <body>
                <div class="label">
                    <div class="product-name">${itemName}</div>
                    <img src="${dataUrl}" class="barcode" alt="Barcode">
                    <div class="price">KSh ${parseFloat(price).toFixed(2)}</div>
                </div>
                <script>
                    window.onload = function() {
                        window.print();
                        setTimeout(function() {
                            window.close();
                        }, 100);
                    }
                </script>
            </body>
            </html>
        `);
        printWindow.document.close();
    }

    // Open Barcode Scanner
    async openBarcodeScanner() {
        const modal = document.getElementById('barcodeScannerModal');
        const video = document.getElementById('barcodeScannerVideo');
        const result = document.getElementById('scannerResult');

        if (!modal || !video) return;

        modal.classList.add('active');
        result.style.display = 'none';

        try {
            // Load QuaggaJS for barcode scanning
            if (typeof Quagga === 'undefined') {
                await this.loadQuagga();
            }

            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { facingMode: 'environment' } 
            });
            
            video.srcObject = stream;
            this.barcodeStream = stream;

            // Initialize Quagga
            Quagga.init({
                inputStream: {
                    name: 'Live',
                    type: 'LiveStream',
                    target: video,
                    constraints: {
                        facingMode: 'environment'
                    }
                },
                decoder: {
                    readers: ['code_128_reader', 'ean_reader', 'ean_8_reader', 'upc_reader']
                }
            }, (err) => {
                if (err) {
                    console.error('Error initializing Quagga:', err);
                    window.showNotification('Failed to start camera', 'error');
                    return;
                }
                Quagga.start();
            });

            // Listen for detected barcodes
            Quagga.onDetected((data) => {
                if (data && data.codeResult && data.codeResult.code) {
                    const barcode = data.codeResult.code;
                    this.handleScannedBarcode(barcode);
                }
            });

        } catch (error) {
            console.error('Error accessing camera:', error);
            window.showNotification('Camera access denied or not available', 'error');
            modal.classList.remove('active');
        }
    }

    // Handle scanned barcode
    handleScannedBarcode(barcode) {
        const resultDiv = document.getElementById('scannerResult');
        const resultValue = document.getElementById('scannedBarcodeValue');
        const skuInput = document.getElementById('itemSKU');

        if (resultDiv && resultValue) {
            resultValue.textContent = barcode;
            resultDiv.style.display = 'block';
        }

        if (skuInput) {
            skuInput.value = barcode;
        }

        // Stop scanner after 2 seconds
        setTimeout(() => {
            this.closeBarcodeScanner();
            window.showNotification('Barcode scanned successfully', 'success');
        }, 2000);
    }

    // Close Barcode Scanner
    closeBarcodeScanner() {
        const modal = document.getElementById('barcodeScannerModal');
        const video = document.getElementById('barcodeScannerVideo');

        if (this.barcodeStream) {
            this.barcodeStream.getTracks().forEach(track => track.stop());
            this.barcodeStream = null;
        }

        if (typeof Quagga !== 'undefined') {
            Quagga.stop();
        }

        if (video) {
            video.srcObject = null;
        }

        if (modal) {
            modal.classList.remove('active');
        }
    }

    // Load QuaggaJS library
    loadQuagga() {
        return new Promise((resolve, reject) => {
            if (typeof Quagga !== 'undefined') {
                resolve();
                return;
            }

            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/quagga@0.12.1/dist/quagga.min.js';
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    // Handle form submission
    async handleSubmit(e) {
        e.preventDefault();
        await this.saveItem(false);
    }

    // Handle save and new
    async handleSaveAndNew() {
        await this.saveItem(true);
    }

    // Save item
    async saveItem(addNew = false) {
        // Prevent multiple simultaneous submissions
        if (this.isSaving) {
            console.log('⚠️ Save already in progress, ignoring duplicate request');
            return;
        }

        const formData = this.getFormData();

        if (!this.validateForm(formData)) {
            return;
        }

        this.isSaving = true;
        const saveBtn = document.getElementById('saveItemBtn');
        const saveAndNewBtn = document.getElementById('saveAndNewBtn');
        const saveIcon = document.getElementById('saveItemIcon');
        const saveText = document.getElementById('saveItemText');
        
        // Disable buttons and show spinning animation
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.style.opacity = '0.7';
            saveBtn.style.cursor = 'not-allowed';
        }
        if (saveAndNewBtn) {
            saveAndNewBtn.disabled = true;
        }
        
        // Change to spinner icon and update text
        if (saveIcon) {
            saveIcon.innerHTML = '<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" fill="none" stroke-dasharray="60" stroke-dashoffset="15" />';
            saveIcon.classList.add('spinning');
        }
        if (saveText) {
            saveText.textContent = 'Saving...';
        }

        try {
            // Add timestamp - let Firebase generate the ID
            const itemData = {
                ...formData,
                dateAdded: new Date().toISOString(),
                salesLastMonth: 0
            };

            // Save to database - Firebase will generate the ID
            const savedItem = await dataManager.createInventoryItem(itemData);

            // Log activity
            if (window.activityTracker) {
                window.activityTracker.logActivity('inventory', 'added', {
                    itemName: savedItem.name,
                    sku: savedItem.sku,
                    quantity: savedItem.quantity,
                    price: savedItem.price,
                    itemId: savedItem.id
                });
            }

            // Add notification for new item
            if (window.notificationManager) {
                window.notificationManager.notify(
                    'item_added',
                    'New Item Added',
                    `${savedItem.name} has been added to inventory`,
                    'info',
                    savedItem
                );
            }

            window.showNotification('Item added successfully!', 'success');

            if (addNew) {
                this.resetForm();
            } else {
                this.navigateToInventory();
            }

            // Refresh inventory if on inventory page
            if (window.inventoryManager) {
                await window.inventoryManager.refresh();
            }

        } catch (error) {
            console.error('Error saving item:', error);
            window.showNotification('Failed to save item', 'error');
        } finally {
            this.isSaving = false;
            
            // Restore button state
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.style.opacity = '1';
                saveBtn.style.cursor = 'pointer';
            }
            if (saveAndNewBtn) {
                saveAndNewBtn.disabled = false;
            }
            
            // Restore original icon and text
            if (saveIcon) {
                saveIcon.classList.remove('spinning');
                saveIcon.innerHTML = '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline>';
            }
            if (saveText) {
                saveText.textContent = 'Save Item';
            }
        }
    }

    // Get form data
    getFormData() {
        return {
            name: document.getElementById('itemName')?.value || '',
            category: document.getElementById('itemCategory')?.value || '',
            description: document.getElementById('itemDescription')?.value || '',
            sku: document.getElementById('itemSKU')?.value || '',
            price: parseFloat(document.getElementById('itemPrice')?.value) || 0,
            cost: parseFloat(document.getElementById('itemCost')?.value) || 0,
            quantity: parseInt(document.getElementById('itemQuantity')?.value) || 0,
            reorderLevel: parseInt(document.getElementById('itemReorderLevel')?.value) || 5,
            supplier: document.getElementById('itemSupplier')?.value || '',
            expiryDate: document.getElementById('itemExpiryDate')?.value || null,
            location: document.getElementById('itemLocation')?.value || '',
            unit: document.getElementById('itemUnit')?.value || 'piece'
        };
    }

    // Validate form
    validateForm(data) {
        // Check for required fields
        if (!data.name || !data.name.trim()) {
            window.showNotification('Please enter product name', 'error');
            document.getElementById('itemName')?.focus();
            return false;
        }

        // Validate name is not just whitespace or placeholder text
        if (data.name.trim().toLowerCase() === 'unnamed' || 
            data.name.trim().toLowerCase() === 'unidentified' ||
            data.name.trim().toLowerCase() === 'undefined') {
            window.showNotification('Please enter a valid product name', 'error');
            document.getElementById('itemName')?.focus();
            return false;
        }

        if (!data.category || data.category.trim() === '') {
            window.showNotification('Please select a category', 'error');
            document.getElementById('itemCategory')?.focus();
            return false;
        }

        if (!data.sku || !data.sku.trim()) {
            window.showNotification('Please enter or generate SKU', 'error');
            document.getElementById('itemSKU')?.focus();
            return false;
        }

        if (isNaN(data.price) || data.price <= 0) {
            window.showNotification('Please enter a valid price greater than 0', 'error');
            document.getElementById('itemPrice')?.focus();
            return false;
        }

        if (isNaN(data.quantity) || data.quantity < 0) {
            window.showNotification('Quantity cannot be negative', 'error');
            document.getElementById('itemQuantity')?.focus();
            return false;
        }

        // Validate reorder level
        if (isNaN(data.reorderLevel) || data.reorderLevel < 0) {
            window.showNotification('Reorder level must be a valid positive number', 'error');
            document.getElementById('itemReorderLevel')?.focus();
            return false;
        }

        return true;
    }

    // Generate unique ID
    generateId() {
        return 'item_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    // Reset form
    resetForm() {
        const form = document.getElementById('addItemForm');
        if (form) {
            form.reset();
        }

        const preview = document.getElementById('barcodePreview');
        if (preview) {
            preview.style.display = 'none';
        }

        const printBtn = document.getElementById('printBarcodeBtn');
        if (printBtn) {
            printBtn.disabled = true;
        }

        this.currentBarcode = null;

        // Focus on first input
        document.getElementById('itemName')?.focus();
    }

    // Cancel form
    cancelForm() {
        const confirmed = confirm('Are you sure you want to cancel? All unsaved changes will be lost.');
        if (confirmed) {
            this.resetForm();
            this.navigateToInventory();
        }
    }

    // Navigate to inventory
    navigateToInventory() {
        const inventoryLink = document.querySelector('[data-page="inventory"]');
        if (inventoryLink) {
            inventoryLink.click();
        }
    }
}

// Create and export singleton instance
const addItemManager = new AddItemManager();
export default addItemManager;
