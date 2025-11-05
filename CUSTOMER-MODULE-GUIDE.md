# Customer Module Guide

## Overview
The Customer Module is a comprehensive customer relationship management (CRM) system integrated into Vendlfy. It allows you to manage customer information, track their status, and export customer data to PDF.

## Features

### 1. Customer Statistics Dashboard
The module displays three key metrics at the top:
- **Total Customers**: Total number of registered customers (Blue)
- **Active Customers**: Customers with active status (Green)  
- **Inactive Customers**: Customers with inactive status (Gray)

### 2. Search & Filter Capabilities
- **Search Bar**: Search by name, email, phone, or company
- **Date Filters**: 
  - All Time (default)
  - Today
  - This Month
  - This Year
- **Status Filters**: 
  - All
  - Active
  - Inactive

### 3. Customer Management

#### Add New Customer
Navigate to **Customers → Add Customer** and fill in:

**Basic Information:**
- Full Name* (required)
- Email Address
- Phone Number
- Company
- Status (Active/Inactive)

**Location Information:**
- Address
- City
- Country (default: Kenya)

**Additional Information:**
- Notes

#### View Customer Details
Click the **View** button (eye icon) to see:
- Customer avatar with initials
- Full contact information
- Location details
- Notes
- Registration date

#### Edit Customer
Click the **Edit** button (pencil icon) to modify customer information.

#### Delete Customer
Click the **Delete** button (trash icon) to remove a customer. This action requires confirmation.

### 4. Export to PDF
Click the **Export PDF** button to generate a professional customer report containing:
- Summary statistics (Total, Active, Inactive)
- Complete customer list with all details
- Generated timestamp and branch information

## Technical Details

### File Structure
```
js/
  ├── customers.js        # Customer manager class
  ├── data-manager.js     # CRUD operations
  └── app.js             # Integration

css/
  └── style.css          # Customer-specific styles
```

### Database Schema
Customers are stored in Firestore with the following structure:
```javascript
{
  name: string,           // Full name
  email: string,          // Email address
  phone: string,          // Phone number
  company: string,        // Company name
  address: string,        // Street address
  city: string,           // City
  country: string,        // Country
  status: string,         // 'active' or 'inactive'
  notes: string,          // Additional notes
  createdAt: timestamp,   // Registration date
  updatedAt: timestamp,   // Last modification
  branchId: string,       // Branch association
  centralCustomerId: string // Central customer reference
}
```

### Offline Support
The module includes full offline functionality:
- **localStorage Cache**: All customer data is cached locally
- **Automatic Sync**: Changes sync to Firestore when online
- **Fallback Mode**: Works completely offline when Firebase is unavailable

### Color-Coded Avatars
Each customer gets a unique color avatar based on their name:
- Colors: Purple, Blue, Green, Orange, Pink, Teal, Red, Indigo
- Displays initials (first letter of first and last name)

## Usage Tips

### Best Practices
1. **Regular Updates**: Keep customer information current
2. **Use Status**: Mark inactive customers to track engagement
3. **Add Notes**: Include important details about each customer
4. **Export Reports**: Regularly backup customer data via PDF export

### Search Tips
- Search by partial name: "john" finds "John Doe"
- Search by company: Finds all customers from a company
- Combine with filters: Search + Status filter for precise results

### Status Management
- **Active**: Current customers with ongoing transactions
- **Inactive**: Past customers or on-hold relationships

## Integration with Other Modules

### Dashboard Integration
Customer statistics automatically update on the main dashboard:
- Total customers displayed in real-time
- Auto-refresh every 30 seconds
- Manual refresh on customer creation/update

### Branch Integration
- Each customer is associated with the active branch
- Branch switching shows relevant customers
- Central customer tracking across all branches

## Troubleshooting

### Common Issues

**Customers not showing:**
- Check active branch selection
- Verify date filter settings
- Clear search bar

**PDF export not working:**
- Ensure pop-ups are enabled in browser
- Check printer/PDF settings in print dialog

**Changes not saving:**
- Check internet connection for Firebase sync
- Verify localStorage is enabled
- Check browser console for errors

## Future Enhancements
Potential features for future versions:
- Customer purchase history
- Loyalty points system
- Bulk import/export (CSV, Excel)
- Customer analytics and insights
- Email integration
- SMS notifications

## Support
For issues or questions about the Customer Module, check:
1. Browser console for error messages
2. Firebase connection status
3. localStorage availability

---

**Version**: 1.0  
**Last Updated**: 2024  
**Module**: Customer Management
