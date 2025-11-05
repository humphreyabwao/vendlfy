# Hold & Quote Features - Quick Guide 🚀

## Quick Reference

### Hold Sale ⏸️
**Purpose:** Save current cart for later  
**Button Location:** POS page → Bottom of checkout panel  
**Action:** Click "Hold" button  
**Result:** Cart saved to database, current cart cleared  

**When to Use:**
- Customer needs to check something
- Switch between multiple customers
- Temporary interruptions
- Customer not ready to complete purchase

**What Gets Saved:**
✓ All cart items (name, price, quantity, barcode)  
✓ Discount (amount & type)  
✓ Tax (amount & type)  
✓ Timestamp  
✓ Branch information  

---

### Generate Quote 📄
**Purpose:** Create quotation without completing sale  
**Button Location:** POS page → Bottom of checkout panel  
**Action:** Click "Quote" button  
**Result:** Quote generated, saved, and displayed for printing  

**When to Use:**
- Customer requests price estimate
- Formal quotation needed
- Pre-sale documentation
- Price negotiation

**Quote Includes:**
✓ Unique quote number (Q-timestamp)  
✓ All items with prices  
✓ Subtotal, discount, tax, total  
✓ Valid until date (30 days)  
✓ Branch information  
✓ Professional footer  

---

## Visual Layout

```
┌─────────────────────────────────────────┐
│         POS CHECKOUT PANEL              │
├─────────────────────────────────────────┤
│                                         │
│  Cart Items                             │
│  • Product A  x2  .........  KES 1,000  │
│  • Product B  x1  .........  KES 500    │
│                                         │
│  Discount: [50] [Fixed ▼]              │
│  Tax:      [16] [% ▼]                  │
│                                         │
│  Subtotal:           KES 1,500         │
│  Discount (-):       KES 50            │
│  Tax (+):            KES 232           │
│  ────────────────────────────────────  │
│  TOTAL:              KES 1,682         │
│                                         │
│  ┌──────────────────────────────────┐  │
│  │ [✓] Complete Sale (KES 1,682)    │  │
│  └──────────────────────────────────┘  │
│                                         │
│  Quick Actions:                         │
│  [⏸ Hold]          [📄 Quote]          │
│   ↑                  ↑                  │
│   Save for later     Generate quote    │
│                                         │
└─────────────────────────────────────────┘
```

---

## User Flows

### Hold Sale Flow
```
1. Add items to cart
   ↓
2. Click "Hold" button
   ↓
3. Confirm hold (automatic)
   ↓
4. Cart saved to database
   ↓
5. Success message: "Sale held successfully!"
   ↓
6. Cart cleared
   ↓
7. Ready for next customer
```

### Generate Quote Flow
```
1. Add items to cart
   ↓
2. Set discount/tax (optional)
   ↓
3. Click "Quote" button
   ↓
4. Quote generated
   ↓
5. Quote saved to database
   ↓
6. Quote dialog appears
   ↓
7. Print or close
   ↓
8. Cart remains unchanged
```

---

## Sample Quote Output

```
╔═══════════════════════════════════════╗
║            QUOTATION                  ║
╠═══════════════════════════════════════╣
║ Quote #: Q-1705320000000              ║
║ Valid Until: February 14, 2025        ║
║ Date: January 15, 2025 10:30 AM       ║
║ Branch: Main Branch                   ║
╠═══════════════════════════════════════╣
║                                       ║
║ Item          Qty  Price      Total   ║
║ ───────────────────────────────────   ║
║ Product A      2   KES 500   KES 1000 ║
║ Product B      1   KES 500   KES 500  ║
║                                       ║
╠═══════════════════════════════════════╣
║ Subtotal:              KES 1,500      ║
║ Discount (Fixed KES 50): -KES 50      ║
║ Tax (16%):             KES 232        ║
║ ───────────────────────────────────   ║
║ TOTAL:                 KES 1,682      ║
╠═══════════════════════════════════════╣
║ This is a quotation, not an invoice.  ║
║ Valid for 30 days from date of issue. ║
║ Terms and conditions apply.           ║
╚═══════════════════════════════════════╝

         [Print Quote]  [Close]
```

---

## Database Storage

### Held Sales (Firestore: `heldSales` collection)
```javascript
{
  id: "held_1705320000000",
  cart: [
    {
      id: "item123",
      name: "Product A",
      price: 500,
      quantity: 2
    }
  ],
  discount: 50,
  discountType: "fixed",
  tax: 16,
  taxType: "percentage",
  heldAt: "2025-01-15T10:30:00.000Z",
  heldBy: "Main Branch",
  branchId: "branch_main",
  status: "held"
}
```

### Quotes (Firestore: `quotes` collection)
```javascript
{
  id: "quote_1705320000000",
  quoteNumber: "Q-1705320000000",
  items: [...],
  subtotal: 1500,
  discount: 50,
  tax: 232,
  total: 1682,
  status: "quote",
  validUntil: "2025-02-14T10:30:00.000Z",
  createdAt: "2025-01-15T10:30:00.000Z",
  branch: "Main Branch",
  branchId: "branch_main"
}
```

---

## Error Messages

### Hold Sale Errors
| Condition | Message |
|-----------|---------|
| Empty cart | ⚠️ Cart is empty. Add items before holding. |
| Success | ✅ Sale held successfully! Access from "Load Held Sales" |
| Database error | ❌ Error holding sale |

### Quote Errors
| Condition | Message |
|-----------|---------|
| Empty cart | ⚠️ Cart is empty. Add items before generating quote. |
| Success | ✅ Quote generated successfully! |
| Database error | ❌ Error generating quote |

---

## Features Comparison

| Feature | Hold Sale | Generate Quote |
|---------|-----------|----------------|
| Saves to DB | ✅ Yes | ✅ Yes |
| Clears cart | ✅ Yes | ❌ No |
| Printable | ❌ No | ✅ Yes |
| Validity period | ❌ N/A | ✅ 30 days |
| Unique number | ❌ No | ✅ Quote # |
| Professional format | ❌ No | ✅ Yes |
| Can be loaded | ✅ Yes (future) | ❌ N/A |

---

## Keyboard Shortcuts (Future)

**Planned shortcuts:**
- `Ctrl + H` - Hold Sale
- `Ctrl + Q` - Generate Quote
- `Ctrl + Enter` - Complete Sale

---

## Tips & Best Practices

### Hold Sales
✅ **DO:**
- Hold sale when customer steps away
- Hold sale to serve another customer
- Check held sales before closing

❌ **DON'T:**
- Hold empty cart
- Forget to load held sales later
- Leave too many held sales

### Quotes
✅ **DO:**
- Generate quotes for customer requests
- Use for price negotiation
- Print for customer records
- Follow up within 30 days

❌ **DON'T:**
- Generate quote without items
- Forget to convert quote to sale
- Let quotes expire

---

## Coming Soon

### Held Sales Management
- View all held sales
- Search/filter held sales
- Load held sale to cart
- Delete held sale
- Auto-cleanup after 24 hours

### Quote Management
- View all quotes
- Convert quote to sale
- Email quote to customer
- Quote templates
- Quote history

---

## Troubleshooting

**Hold button not working?**
- Check if cart has items
- Check console for errors
- Verify Firebase connection

**Quote not printing?**
- Use browser print dialog (Ctrl + P)
- Check printer settings
- Try "Save as PDF"

**Data not saving?**
- Check Firebase connection
- Data saves to localStorage as backup
- Check browser console for errors

---

## Quick Stats

⚡ **Hold Sale:** 1 click → Cart saved  
📄 **Generate Quote:** 1 click → Professional quote  
💾 **Storage:** Firestore + localStorage backup  
🔄 **Real-time:** Instant sync across devices  
🏢 **Multi-branch:** Automatic filtering  

---

**Status:** ✅ LIVE AND READY TO USE

**Need Help?** Check console logs (F12) for detailed debugging information.
