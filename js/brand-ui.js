// Brand Settings UI — populate / save / live-preview the Brand tab

import brandManager from './brand-manager.js';
import sessionManager from './session-manager.js';
import { setBtnState, friendlyError } from './ui-feedback.js';

const FIELDS = [
    'name', 'tagline', 'phone', 'email', 'website', 'taxId',
    'address', 'currency', 'logoUrl', 'receiptHeader', 'receiptFooter'
];

class BrandUI {
    constructor() {
        this._wired = false;
    }

    init() {
        if (this._wired) {
            this.populateForm();
            return;
        }
        this._wired = true;

        // Populate when the user opens the brand tab
        document.querySelectorAll('.settings-tab[data-tab="brand"]').forEach((btn) => {
            btn.addEventListener('click', () => this.populateForm());
        });

        // Live preview as the user types
        FIELDS.forEach((field) => {
            const el = document.getElementById(this._inputId(field));
            if (el) el.addEventListener('input', () => this.renderPreview());
        });

        // Real-time updates from Firestore
        brandManager.onChange(() => {
            // Only refresh form if not actively edited (cheap heuristic — refresh anyway)
            if (this._isBrandTabActive()) this.populateForm();
        });

        this.populateForm();
    }

    _inputId(field) {
        // brandName, brandTagline, brandPhone, etc.
        return 'brand' + field.charAt(0).toUpperCase() + field.slice(1);
    }

    _isBrandTabActive() {
        const panel = document.getElementById('brand-tab');
        return panel && panel.classList.contains('active');
    }

    populateForm() {
        const brand = brandManager.getBrand();
        FIELDS.forEach((field) => {
            const el = document.getElementById(this._inputId(field));
            if (el) el.value = brand[field] || '';
        });

        // Disable form for non-admins (display-only)
        const isAdmin = sessionManager.isAdmin();
        const form = document.getElementById('brandForm');
        if (form) {
            form.querySelectorAll('input, textarea, button').forEach((el) => {
                if (el.tagName === 'BUTTON' && !el.classList.contains('btn-primary') && !el.classList.contains('btn-secondary')) return;
                el.disabled = !isAdmin;
            });
        }

        this.renderPreview();
    }

    resetBrandForm() {
        this.populateForm();
        this._toast('Reverted to saved brand settings', 'info');
    }

    async saveBrandForm() {
        const saveBtn = document.querySelector('#brandForm button.btn-primary')
            || document.querySelector('#brand-tab button.btn-primary')
            || null;

        if (!sessionManager.isAdmin()) {
            this._toast('Only administrators can change brand settings.', 'error');
            return;
        }

        const updates = {};
        FIELDS.forEach((field) => {
            const el = document.getElementById(this._inputId(field));
            if (el) updates[field] = (el.value || '').trim();
        });

        if (!updates.name) {
            this._toast('Business name is required.', 'error');
            return;
        }

        if (updates.currency) updates.currency = updates.currency.toUpperCase();

        setBtnState(saveBtn, 'loading', 'Saving…');
        try {
            await brandManager.saveBrand(updates);
            setBtnState(saveBtn, 'success', 'Saved!');
            this._toast('Brand settings saved. Changes apply to all receipts and users in real time.', 'success');
        } catch (e) {
            console.error('Brand save error:', e);
            setBtnState(saveBtn, 'error', 'Failed');
            this._toast(friendlyError(e, 'save brand settings'), 'error');
        }
    }

    renderPreview() {
        const preview = document.getElementById('brandReceiptPreview');
        if (!preview) return;

        const draft = {};
        FIELDS.forEach((field) => {
            const el = document.getElementById(this._inputId(field));
            draft[field] = el ? (el.value || '').trim() : '';
        });

        const c = (draft.currency || 'KES').toUpperCase();
        const name = draft.name || 'Business Name';

        // Resolve a preview logo URL from the draft input or the saved brand
        let previewLogo = (draft.logoUrl || '').trim();
        if (!previewLogo) previewLogo = brandManager.getLogoUrl();
        else if (!/^https?:\/\//i.test(previewLogo) && !previewLogo.startsWith('data:') && !previewLogo.startsWith('blob:')) {
            try { previewLogo = new URL(previewLogo, window.location.href).href; } catch (e) { /* ignore */ }
        }

        preview.innerHTML = `
            <div style="text-align:center;border-bottom:2px dashed #000;padding-bottom:8px;margin-bottom:8px;">
                ${previewLogo ? `<img src="${previewLogo}" alt="${this._escape(name)}" style="max-width:70px;max-height:70px;object-fit:contain;display:block;margin:0 auto 6px;" onerror="this.style.display='none'">` : ''}
                <div style="font-size:15px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;">${this._escape(name)}</div>
                ${draft.tagline ? `<div style="font-size:11px;font-style:italic;margin-top:2px;">${this._escape(draft.tagline)}</div>` : ''}
                ${draft.address ? `<div style="font-size:11px;margin-top:4px;">${this._escape(draft.address)}</div>` : ''}
                ${draft.phone ? `<div style="font-size:11px;">Tel: ${this._escape(draft.phone)}</div>` : ''}
                ${draft.email ? `<div style="font-size:11px;">${this._escape(draft.email)}</div>` : ''}
                ${draft.website ? `<div style="font-size:11px;">${this._escape(draft.website)}</div>` : ''}
                ${draft.taxId ? `<div style="font-size:11px;">PIN: ${this._escape(draft.taxId)}</div>` : ''}
            </div>
            ${draft.receiptHeader ? `<div style="text-align:center;font-size:11px;margin-bottom:8px;">${this._escape(draft.receiptHeader)}</div>` : ''}
            <div style="font-size:11px;margin-bottom:6px;">Receipt #SAMPLE-001</div>
            <div style="font-size:11px;margin-bottom:8px;">${new Date().toLocaleString()}</div>
            <div style="border-top:1px dashed #000;border-bottom:1px dashed #000;padding:6px 0;">
                <div style="display:flex;justify-content:space-between;"><span>Sample Item × 2</span><span>${c} 200.00</span></div>
                <div style="display:flex;justify-content:space-between;"><span>Other Item × 1</span><span>${c} 150.00</span></div>
            </div>
            <div style="display:flex;justify-content:space-between;font-weight:bold;font-size:13px;margin-top:8px;border-top:2px solid #000;padding-top:6px;">
                <span>TOTAL:</span><span>${c} 350.00</span>
            </div>
            <div style="text-align:center;margin-top:10px;padding-top:8px;border-top:1px dashed #000;font-size:11px;">
                ${this._escape(draft.receiptFooter || 'Thank you for your business!')}
            </div>`;
    }

    _escape(str) {
        return String(str).replace(/[&<>"']/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[c]);
    }

    _toast(msg, type = 'info') {
        if (window.notificationManager?.add) {
            window.notificationManager.add(msg, type);
            return;
        }
        const n = document.createElement('div');
        n.textContent = msg;
        n.style.cssText = `
            position:fixed;top:80px;right:20px;padding:14px 20px;border-radius:8px;
            background:${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
            color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.18);z-index:99999;
            font-family:'Montserrat',sans-serif;font-size:13px;font-weight:500;`;
        document.body.appendChild(n);
        setTimeout(() => n.remove(), 3500);
    }
}

const brandUI = new BrandUI();

if (typeof window !== 'undefined') {
    window.brandUI = brandUI;
}

export default brandUI;
