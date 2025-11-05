# Expense Management Module

## Overview
Clean, simple expense tracking module with real-time functionality for managing business expenses.

## Features

### 📊 Dashboard Statistics
- **Today's Expenses**: Real-time total of expenses added today
- **This Month**: Monthly expense total
- **Pending Approval**: Count of expenses awaiting approval
- **Approved (Month)**: Count of approved expenses this month

### 🔍 Search & Filter
- **Search Bar**: Search by description, category, or vendor
- **Filter Buttons**: 
  - All
  - Pending
  - Approved
  - Rejected

### ➕ Add Expense
Simple form to record new expenses:
- Date
- Category (Rent, Utilities, Salaries, Inventory, Marketing, etc.)
- Description
- Amount (KES)
- Vendor
- Reference (Invoice #, Receipt #)
- Payment Method (Cash, M-Pesa, Bank Transfer, Card, Cheque)
- Status (Pending, Approved, Rejected)
- Notes

### 📋 Expense List
Real-time table showing:
- Date
- Description with reference
- Category
- Vendor
- Amount
- Status badge
- Actions (View, Edit, Delete)

### 🔧 Actions
- **View**: Modal displaying all expense details
- **Edit**: Update expense information
- **Delete**: Remove expense with confirmation

## Design Principles
- ✅ Clean and minimal interface
- ✅ Simple color scheme (no excessive colors)
- ✅ Real-time data updates
- ✅ Responsive design
- ✅ Easy navigation
- ✅ Clear visual hierarchy

## Database Integration
- Real-time sync with Firestore
- LocalStorage fallback for offline support
- Branch-aware (multi-branch support)
- Automatic timestamps (createdAt, updatedAt)

## Usage

### Navigate to Expenses
Click "Expenses" in the sidebar navigation

### Add New Expense
1. Click "Add Expense" button
2. Fill in the form
3. Submit

### Search Expenses
Type in the search bar to filter by description, category, or vendor

### Filter by Status
Click filter buttons: All, Pending, Approved, or Rejected

### View/Edit Expense
Click the eye icon to view details or pencil icon to edit

### Delete Expense
Click the trash icon and confirm deletion

## Technical Details

### Files
- `js/expenses.js` - Main expense management logic
- `js/data-manager.js` - Database operations (create, read, update, delete)
- `css/style.css` - Expense module styles
- `index.html` - Expenses page and Add Expense page

### Real-time Updates
- Stats automatically refresh when data changes
- Table updates instantly after add/edit/delete
- Search and filter work in real-time

### Status Colors
- **Pending**: Yellow/Orange
- **Approved**: Green
- **Rejected**: Red

## Notes
- All dates are in ISO format for consistency
- Amounts are stored as floats for precise calculations
- Form validation ensures required fields are filled
- Modals close automatically after successful operations
