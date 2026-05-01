// Brand Manager — single source of truth for brand info used on receipts,
// invoices, exports and the UI shell. Loads from /system/brand in real time.

import {
    db, isFirebaseConfigured, isRtdbConfigured, rtdb,
    doc, getDoc, onSnapshot,
    rtdbRef, rtdbGet, rtdbOnValue
} from './firebase-config.js';
import { saveBrandSettingsDuplex } from './storage-adapter.js';

const STORAGE_KEY = 'vendify_brand';

// Bundled default logo shipped with the app
const DEFAULT_LOGO = 'images/logo/logo_page-0001.jpg';

const DEFAULT_BRAND = Object.freeze({
    name: 'Vendify',
    tagline: 'Point of Sale System',
    address: '',
    phone: '',
    email: '',
    website: '',
    receiptHeader: '',
    receiptFooter: 'Thank you for your business!',
    currency: 'KES',
    taxId: '',
    logoUrl: DEFAULT_LOGO
});

class BrandManager {
    constructor() {
        this.brand = { ...DEFAULT_BRAND };
        this._unsub = null;
        this._callbacks = [];
        this._loadFromCache();
    }

    _loadFromCache() {
        try {
            const cached = localStorage.getItem(STORAGE_KEY);
            if (cached) this.brand = { ...DEFAULT_BRAND, ...JSON.parse(cached) };
        } catch (e) { /* ignore */ }
    }

    _saveCache() {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.brand)); } catch (e) { /* ignore */ }
    }

    // Subscribe to live updates: Firestore `system/brand`, with optional RTDB mirror `settings/brand`.
    init() {
        if (isFirebaseConfigured && db) {
            const brandRef = doc(db, 'system', 'brand');
            this._unsub = onSnapshot(
                brandRef,
                (snap) => {
                    if (snap.exists()) {
                        this.brand = { ...DEFAULT_BRAND, ...snap.data() };
                        this._saveCache();
                        this._notify();
                    } else {
                        this.brand = { ...DEFAULT_BRAND };
                        this._notify();
                    }
                },
                (err) => {
                    console.warn('Brand listener error:', err.message);
                    if (isRtdbConfigured && rtdb) {
                        rtdbGet(rtdbRef(rtdb, 'settings/brand'))
                            .then((s) => {
                                const v = s.val();
                                if (v && typeof v === 'object') {
                                    this.brand = { ...DEFAULT_BRAND, ...v };
                                    this._saveCache();
                                    this._notify();
                                }
                            })
                            .catch(() => {});
                    }
                }
            );
            return;
        }

        if (isRtdbConfigured && rtdb) {
            const ref = rtdbRef(rtdb, 'settings/brand');
            this._unsub = rtdbOnValue(ref, (snap) => {
                const v = snap.val();
                if (v && typeof v === 'object') {
                    this.brand = { ...DEFAULT_BRAND, ...v };
                    this._saveCache();
                    this._notify();
                } else {
                    this.brand = { ...DEFAULT_BRAND };
                    this._notify();
                }
            });
            return;
        }

        this._notify();
    }

    // Sync helper — used by receipt templates that run during render
    getBrand() { return { ...this.brand }; }

    // Convenience getters for common fields
    name()    { return this.brand.name || DEFAULT_BRAND.name; }
    tagline() { return this.brand.tagline || ''; }
    footer()  { return this.brand.receiptFooter || ''; }
    currency() { return this.brand.currency || DEFAULT_BRAND.currency; }

    // Returns an absolute logo URL (works inside print popups / about:blank windows)
    getLogoUrl() {
        const raw = (this.brand.logoUrl || DEFAULT_LOGO || '').trim();
        if (!raw) return '';
        if (/^https?:\/\//i.test(raw) || raw.startsWith('data:') || raw.startsWith('blob:')) return raw;
        try { return new URL(raw, window.location.href).href; }
        catch (e) { return raw; }
    }

    // Convenience: logo HTML snippet used by receipt / invoice templates
    getLogoHTML(opts = {}) {
        const { maxWidth = 80, maxHeight = 80, marginBottom = 8, alt } = opts;
        const url = this.getLogoUrl();
        if (!url) return '';
        const altText = (alt || this.brand.name || 'Logo')
            .replace(/"/g, '&quot;');
        return `<img src="${url}" alt="${altText}"
            style="max-width:${maxWidth}px;max-height:${maxHeight}px;margin:0 auto ${marginBottom}px;display:block;object-fit:contain;"
            onerror="this.style.display='none'">`;
    }

    async saveBrand(updates) {
        const merged = {
            ...this.brand,
            ...updates,
            updatedAt: new Date().toISOString()
        };

        if (isFirebaseConfigured || isRtdbConfigured) {
            await saveBrandSettingsDuplex(merged);
        }

        this.brand = merged;
        this._saveCache();
        this._notify();
        return this.brand;
    }

    async loadOnce() {
        if (!isFirebaseConfigured && !isRtdbConfigured) return this.brand;
        try {
            if (isFirebaseConfigured) {
                const snap = await getDoc(doc(db, 'system', 'brand'));
                if (snap.exists()) {
                    this.brand = { ...DEFAULT_BRAND, ...snap.data() };
                    this._saveCache();
                    this._notify();
                    return this.brand;
                }
            }
        } catch (e) { /* ignore */ }

        if (isRtdbConfigured && rtdb) {
            try {
                const s = await rtdbGet(rtdbRef(rtdb, 'settings/brand'));
                const v = s.val();
                if (v && typeof v === 'object' && (v.name != null || v.updatedAt)) {
                    this.brand = { ...DEFAULT_BRAND, ...v };
                    this._saveCache();
                    this._notify();
                }
            } catch (e) { /* ignore */ }
        }
        return this.brand;
    }

    onChange(cb) {
        if (typeof cb === 'function') this._callbacks.push(cb);
        return () => {
            const i = this._callbacks.indexOf(cb);
            if (i >= 0) this._callbacks.splice(i, 1);
        };
    }

    _notify() {
        this._callbacks.forEach((cb) => {
            try { cb(this.brand); } catch (e) { /* ignore */ }
        });
        try {
            window.dispatchEvent(new CustomEvent('brandChanged', { detail: this.brand }));
        } catch (e) { /* ignore */ }
        // Auto-update UI shell elements
        this._applyToShell();
    }

    _applyToShell() {
        const name    = this.brand.name || DEFAULT_BRAND.name;
        const logoSrc = this.getLogoUrl();

        // Topbar — render <img class="topbar-logo-img"> + brand name text
        const logoEl = document.querySelector('.topbar .logo');
        if (logoEl) {
            let img = logoEl.querySelector('.topbar-logo-img');
            if (logoSrc) {
                if (!img) {
                    img = document.createElement('img');
                    img.className = 'topbar-logo-img';
                    img.alt = name;
                    img.style.cssText = 'height:32px;width:auto;max-width:120px;object-fit:contain;margin-right:10px;vertical-align:middle;';
                    img.onerror = function () { this.style.display = 'none'; };
                    logoEl.prepend(img);
                }
                if (img.getAttribute('src') !== logoSrc) img.src = logoSrc;
                img.alt = name;
            } else if (img) {
                img.remove();
            }

            // Keep brand name as the text part of the .logo
            let nameSpan = logoEl.querySelector('.topbar-logo-name');
            if (!nameSpan) {
                // Replace any raw text nodes with a dedicated span so we can update only the name
                Array.from(logoEl.childNodes).forEach((n) => { if (n.nodeType === Node.TEXT_NODE) n.remove(); });
                nameSpan = document.createElement('span');
                nameSpan.className = 'topbar-logo-name';
                nameSpan.style.cssText = 'vertical-align:middle;';
                logoEl.appendChild(nameSpan);
            }
            nameSpan.textContent = name;
        }

        // Document title — keep any " - Page" suffix
        try {
            const parts = document.title.split(' - ');
            const suffix = parts.length > 1 ? parts.slice(1).join(' - ') : 'POS';
            document.title = `${name} - ${suffix}`;
        } catch (e) { /* ignore */ }

        // Favicon — point at the brand logo
        try {
            if (logoSrc) {
                let link = document.querySelector('link[rel="icon"]');
                if (!link) {
                    link = document.createElement('link');
                    link.rel = 'icon';
                    document.head.appendChild(link);
                }
                if (link.href !== logoSrc) link.href = logoSrc;
            }
        } catch (e) { /* ignore */ }

        // Login page logo (if present)
        const loginLogo = document.querySelector('.logo-text');
        if (loginLogo) loginLogo.textContent = name;

        // Login page logo image (replaces SVG inside .logo-icon when present)
        try {
            const loginIcon = document.querySelector('.login-left .logo-icon');
            if (loginIcon && logoSrc) {
                let img = loginIcon.querySelector('img.login-brand-logo');
                if (!img) {
                    // Hide the inner SVG (kept as fallback) and inject the brand logo
                    const svg = loginIcon.querySelector('svg');
                    if (svg) svg.style.display = 'none';
                    img = document.createElement('img');
                    img.className = 'login-brand-logo';
                    img.alt = name;
                    img.style.cssText = 'max-width:80%;max-height:80%;object-fit:contain;display:block;';
                    img.onerror = function () {
                        this.style.display = 'none';
                        if (svg) svg.style.display = '';
                    };
                    loginIcon.appendChild(img);
                }
                if (img.getAttribute('src') !== logoSrc) img.src = logoSrc;
                img.alt = name;
            }
        } catch (e) { /* ignore */ }

        // Any element with [data-brand="name"] etc.
        document.querySelectorAll('[data-brand]').forEach((el) => {
            const key = el.getAttribute('data-brand');
            if (key && key in this.brand) el.textContent = this.brand[key] || '';
        });

        // Any element with [data-brand-logo] becomes an <img src=brandLogo>
        document.querySelectorAll('[data-brand-logo]').forEach((el) => {
            if (el.tagName === 'IMG' && logoSrc) el.src = logoSrc;
        });
    }
}

const brandManager = new BrandManager();

if (typeof window !== 'undefined') {
    window.brandManager = brandManager;
}

export default brandManager;
export { DEFAULT_BRAND };
