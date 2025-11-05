# POS System - Complete Guide

## Overview
The Vendify POS (Point of Sale) system is a real-time sales processing module that allows you to quickly search for products, add them to a cart, apply discounts and taxes, and complete sales transactions.

## Features

### 📊 Real-Time Dashboard Stats
- **Today's Revenue**: Total sales amount for the current day
- **Today's Profit**: Calculated profit from today's sales
- **Items Sold**: Total number of items sold today
- **Transactions**: Number of completed sales transactions

### 🔍 Smart Product Search
- **Real-time search** with 300ms debounce for smooth performance
- Search by:
  - Product name
  - Barcode
  - SKU
  - Category
- Shows up to 10 matching results
- Displays product details: stock level, barcode, SKU, and price

### 🛒 Shopping Cart Management
- Add items from search results
- **Quantity controls**:
  - Increment/decrement buttons
  - Direct input for specific quantities
  - Auto-validation against available stock
- Real-time price calculation
- Remove individual items
- Clear entire cart with confirmation

### 💰 Flexible Pricing
- **Editable Discount**:
  - Percentage-based (%)
  - Fixed amount (KES)
  - Real-time calculation
  
- **Editable Tax**:
  - Percentage-based (%)
  - Fixed amount (KES)
  - Real-time calculation

- **Live Totals**:
  - Subtotal
  - Discount amount
  - Tax amount
  - Grand total

### ➕ Manual Item Entry
- Add items not in inventory
- Quick custom pricing
- Optional barcode entry
- Useful for one-time sales or services

### 🧾 Receipt Generation
- Professional receipt design
- Includes:
  - Transaction details
  - Itemized list
  - Price breakdown
  - Totals with discount and tax
- Print functionality
- Unique receipt number

### 📦 Automatic Inventory Updates
- Real-time stock deduction after sale
- Prevents overselling with stock validation
- Syncs with inventory module

## How to Use

### Starting a Sale

1. **Navigate to POS**
   - Click on "POS / Sales" in the sidebar
   - The POS system will initialize automatically

2. **Search for Products**
   - Type in the search bar (minimum 2 characters)
   - Search by name, barcode, or SKU
   - Press Enter or wait for auto-search

3. **Add Items to Cart**
   - Click on any search result
   - Item will be added to cart with quantity 1
   - Duplicate items will increase quantity

### Managing Cart Items

1. **Adjust Quantities**
   - Use + / - buttons for increment/decrement
   - Or type directly in the quantity field
   - System prevents exceeding available stock

2. **Remove Items**
   - Click the red X button on any cart item
   - Or set quantity to 0

3. **Clear Cart**
   - Click "Clear All" button
   - Confirm the action

### Adding Manual Items

1. **Click the + Icon** next to search bar
2. **Enter Details**:
   - Item name (required)
   - Price (required)
   - Quantity
   - Barcode (optional)
3. **Add to Cart**

### Applying Discounts and Tax

1. **Discount Section**:
   - Enter discount value
   - Select % or KES
   - See immediate deduction in totals

2. **Tax Section**:
   - Enter tax value
   - Select % or KES
   - See immediate addition in totals

### Completing a Sale

1. **Review Cart** - Ensure all items and quantities are correct
2. **Apply Discount/Tax** - If needed
3. **Click "Complete Sale"**
4. **View Receipt** - Review transaction details
5. **Print** (optional) - Use print button

### After Sale Completion

- Cart is automatically cleared
- Inventory is updated
- Stats are refreshed
- Receipt can be printed
- Ready for next transaction

## Features Breakdown

### Stats Cards
```
┌─────────────┬─────────────┬─────────────┬─────────────┐
│  Revenue    │   Profit    │ Items Sold  │ Transactions│
│  KES 0.00   │  KES 0.00   │     0       │      0      │
└─────────────┴─────────────┴─────────────┴─────────────┘
```

### Search Interface
- Clean, minimal design
- Icon-based search indicator
- Manual entry quick access
- Real-time results dropdown

### Cart Display
- Compact item cards
- Clear product information
- Intuitive quantity controls
- Prominent pricing
- Easy item removal

### Summary Panel
- Fixed right sidebar
- Always visible totals
- Editable fields for discount/tax
- Large, clear action buttons
- Quick actions (Hold, Quote)

## Keyboard Shortcuts

- **Enter** in search: Execute search immediately
- **Escape**: Clear search results
- **Tab**: Navigate between input fields

## Best Practices

### For Cashiers
1. Always verify quantities before completing sale
2. Double-check applied discounts
3. Ensure correct tax calculation
4. Review receipt before printing
5. Clear cart between customers

### For Managers
1. Monitor daily stats regularly
2. Review completed transactions
3. Check inventory levels after busy periods
4. Verify discount usage
5. Reconcile end-of-day totals

## Technical Details

### Real-Time Sync
- Stats refresh every 30 seconds
- Inventory updates immediately after sale
- Cross-branch data synchronization

### Performance Optimization
- Debounced search (300ms)
- Limited search results (10 items)
- Efficient cart rendering
- Lazy-loaded components

### Data Storage
- Sales data saved to Firestore
- Inventory updates atomic
- Branch-specific tracking
- Audit trail for all transactions

### Calculations

**Subtotal**: Sum of (price × quantity) for all items

**Discount Amount**:
- Percentage: `subtotal × (discount / 100)`
- Fixed: `discount value`

**After Discount**: `subtotal - discount amount`

**Tax Amount**:
- Percentage: `after_discount × (tax / 100)`
- Fixed: `tax value`

**Total**: `after_discount + tax amount`

**Profit**: `total - (sum of cost prices)`

## Responsive Design

### Desktop (> 1024px)
- Two-column layout
- Cart on left, summary on right
- Full stats grid (4 columns)

### Tablet (768px - 1024px)
- Single column layout
- Stats in 2 columns
- Sticky summary panel

### Mobile (< 768px)
- Full-width components
- Single column stats
- Scrollable cart
- Fixed summary at bottom

## Error Handling

### Out of Stock
- Prevents adding items with 0 stock
- Shows notification
- Validates against max stock

### Invalid Inputs
- Prevents negative quantities
- Validates discount/tax values
- Shows clear error messages

### Network Issues
- Graceful degradation
- Local caching
- Retry mechanisms

## Future Enhancements

- [ ] Multiple payment methods (Cash, M-Pesa, Card)
- [ ] Hold/Park sales for later
- [ ] Generate quotations
- [ ] Customer selection
- [ ] Loyalty points integration
- [ ] Split payments
- [ ] Return/refund processing
- [ ] Barcode scanner integration
- [ ] Offline mode with sync

## Support

For issues or questions:
- Check browser console for errors
- Verify Firestore connection
- Ensure inventory has items with stock
- Clear browser cache if needed

---

**Version**: 1.0.0  
**Last Updated**: November 2025  
**Module**: pos.js  
**Dependencies**: Firebase, data-manager.js, branch-manager.js
