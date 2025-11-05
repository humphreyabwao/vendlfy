# Vendify POS - Multi-Branch System

## Overview
Vendify POS is a clean, lightweight Point of Sale system with comprehensive multi-branch support. It allows you to manage multiple branches independently while syncing all data to a central branch for unified reporting and management.

## Multi-Branch Architecture

### How It Works

#### 1. **Branch Management**
- **Central Branch**: Automatically created on first run. This is the main branch that receives aggregated data from all other branches.
- **Sub-Branches**: You can create unlimited branches, each operating independently.
- **Branch Switching**: Users can switch between branches using the dropdown in the dashboard header.
- **All Branches View**: Select "All Branches" to see aggregated data across all locations.

#### 2. **Data Structure**

Each transaction (sale, expense, inventory item, etc.) includes:
```javascript
{
  branchId: "branch123",      // ID of the branch
  branchCode: "BR001",        // Branch code
  branchName: "Downtown",     // Branch name
  // ... other data fields
}
```

#### 3. **Data Sync System**

**Independent Operation:**
- Each branch stores its data in the main collections (sales, inventory, customers, etc.)
- Data is automatically tagged with branch information

**Central Sync:**
- When a transaction is created in any branch, it's automatically synced to `central_{collection}` collections
- Central collections store copies of all branch data for aggregated reporting
- Sync happens in real-time when online

**Collections Structure:**
```
branches/              - Branch configurations
sales/                 - Branch-specific sales
central_sales/         - All sales from all branches
inventory/             - Branch-specific inventory
central_inventory/     - All inventory from all branches
customers/             - Branch-specific customers
central_customers/     - All customers from all branches
expenses/              - Branch-specific expenses
central_expenses/      - All expenses from all branches
orders/                - Branch-specific orders
central_orders/        - All orders from all branches
```

## Firebase/Firestore Setup

### 1. Create Firebase Project
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click "Add Project"
3. Enter project name (e.g., "vendify-pos")
4. Follow the setup wizard

### 2. Enable Firestore Database
1. In Firebase Console, click "Firestore Database"
2. Click "Create Database"
3. Choose "Start in production mode" (or test mode for development)
4. Select your region
5. Click "Enable"

### 3. Configure Firestore Rules

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Branches - Read for all authenticated users, write for admins only
    match /branches/{branchId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.auth.token.admin == true;
    }
    
    // All other collections - Read/write for authenticated users
    match /{collection}/{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

### 4. Get Firebase Configuration
1. In Firebase Console, go to Project Settings (gear icon)
2. Scroll to "Your apps" section
3. Click the web icon (</>)
4. Register your app
5. Copy the configuration object

### 5. Update Firebase Config
Open `js/firebase-config.js` and replace the configuration:

```javascript
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_AUTH_DOMAIN",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_STORAGE_BUCKET",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID"
};
```

## Usage Guide

### Managing Branches

#### Add New Branch
1. Go to **Admin Panel** in the sidebar
2. Click **Add Branch** button
3. Fill in the form:
   - Branch Name (required)
   - Branch Code (required, e.g., BR001)
   - Address (optional)
   - Phone (optional)
   - Manager Name (optional)
   - Status (Active/Inactive)
4. Click **Save Branch**

#### Edit Branch
1. Go to Admin Panel
2. Click **Edit** on any branch card
3. Update the information
4. Click **Save Branch**

#### Delete Branch
1. Go to Admin Panel
2. Click **Delete** on any branch card (except Central Branch)
3. Confirm deletion

**Note:** Central Branch cannot be deleted.

### Switching Branches

#### From Dashboard
- Use the "Branch" dropdown in the dashboard header
- Select a specific branch to see only that branch's data
- Select "All Branches" to see aggregated data

#### Automatic Features
- Dashboard stats automatically update when you switch branches
- All data entry (sales, expenses, etc.) is automatically tagged with the current branch
- Switching branches triggers a refresh of all statistics

### Data Flow Example

**Scenario: Recording a Sale**

1. User switches to "Downtown Branch"
2. Creates a new sale for $100
3. System automatically:
   - Adds sale to `sales` collection with `branchId: "downtown"`
   - Syncs copy to `central_sales` collection
   - Updates dashboard stats for Downtown Branch

4. User switches to "All Branches"
5. Dashboard now shows:
   - Aggregated sales from all branches
   - Combined statistics

6. User switches to "Central Branch"
7. Central Branch view shows:
   - All synced data from all branches
   - Complete business overview

## API Reference

### Branch Manager

```javascript
// Get current branch
const branch = branchManager.getCurrentBranch();

// Get all branches
const branches = branchManager.getAllBranches();

// Switch branch
branchManager.switchBranch(branchId);

// View all branches
branchManager.setViewAllBranches();

// Create branch
await branchManager.createBranch({
    name: "New Branch",
    code: "BR002",
    address: "123 Main St",
    phone: "555-0123",
    manager: "John Doe",
    status: "active"
});

// Update branch
await branchManager.updateBranch(branchId, {
    name: "Updated Name",
    status: "inactive"
});

// Delete branch
await branchManager.deleteBranch(branchId);
```

### Data Manager

```javascript
// Create sale (automatically tagged with current branch)
await dataManager.createSale({
    items: [...],
    total: 100,
    customer: "John Doe"
});

// Get sales for current branch
const sales = await dataManager.getSales();

// Get today's sales
const todaySales = await dataManager.getTodaysSales();

// Get inventory
const inventory = await dataManager.getInventory();

// Create customer
await dataManager.createCustomer({
    name: "Jane Doe",
    phone: "555-0123",
    email: "jane@example.com"
});

// Get dashboard stats (branch-specific)
const stats = await dataManager.getDashboardStats();
```

## Features

### ✅ Implemented
- Multi-branch support with independent operations
- Automatic data sync to central branch
- Branch switching with real-time data updates
- Branch management UI (add, edit, delete)
- Dashboard with branch-specific statistics
- Clean, minimal UI with dark/light mode
- Responsive design for all devices

### 🚀 Ready for Implementation
- Sales module with branch tracking
- Inventory management per branch
- Customer management
- Expense tracking
- B2B orders
- Reports with branch filtering
- User authentication
- Role-based access control

## Best Practices

1. **Always Set a Branch**: Ensure users select a branch before creating transactions
2. **Regular Backups**: Use Firestore's built-in backup features
3. **Monitor Sync**: Check central collections regularly to ensure data is syncing
4. **Access Control**: Implement authentication before production use
5. **Data Validation**: Validate all inputs before saving to Firestore

## Troubleshooting

### Data Not Syncing
- Check Firebase configuration in `js/firebase-config.js`
- Verify Firestore rules allow read/write access
- Check browser console for errors

### Branch Not Appearing
- Ensure branch was created successfully
- Refresh the page
- Check Firestore database for the branch document

### Stats Not Updating
- Switch to a different branch and back
- Check if data has the correct branchId field
- Verify date filters in queries

## License
MIT License - Free to use and modify

## Support
For issues and questions, please check the Firebase documentation or open an issue in the repository.
