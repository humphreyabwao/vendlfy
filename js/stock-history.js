// Stock history submodule (My Orders) — append-only log in Realtime Database when stock is added.
import {
    rtdb, isRtdbConfigured,
    rtdbRef, rtdbPush, rtdbSet, rtdbOnValue, rtdbOff
} from './firebase-config.js';
import branchManager from './branch-manager.js';
import sessionManager from './session-manager.js';

const MAX_ROWS = 250;

const SOURCE_LABELS = {
    add_stock: 'Add stock',
    new_item: 'New item',
    edit_increase: 'Manual edit'
};

function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
}

function branchScopeFilter() {
    if (sessionManager.canAccessAllBranches?.()) {
        const current = branchManager.getCurrentBranch?.();
        const viewingAll = branchManager.isViewingAllBranches?.();
        if (!current || viewingAll) return () => true;
        return (row) => row.branchId === current.id;
    }
    const allowed = sessionManager.getAllowedBranchIds?.();
    if (!allowed || allowed.length === 0) return () => false;
    return (row) => allowed.includes(row.branchId);
}

/**
 * Write one stock-increase event to RTDB (non-throwing on failure).
 */
export async function appendStockHistoryRecord({
    itemId,
    itemName,
    sku,
    branchId,
    branchName,
    quantityBefore,
    quantityAdded,
    quantityAfter,
    source = 'unknown'
}) {
    if (!isRtdbConfigured) return;
    try {
        const auth = sessionManager.getAuthUser?.();
        const me = sessionManager.getUser?.() || {};
        const node = rtdbPush(rtdbRef(rtdb, 'stockHistory'));
        await rtdbSet(node, {
            itemId: itemId || '',
            itemName: itemName || '',
            sku: sku || '',
            branchId: branchId || '',
            branchName: branchName || null,
            quantityBefore: Number(quantityBefore) || 0,
            quantityAdded: Number(quantityAdded) || 0,
            quantityAfter: Number(quantityAfter) || 0,
            source: String(source),
            recordedById: auth?.uid || null,
            recordedByName: me.fullName || me.name || me.email || auth?.email || 'Unknown',
            createdAt: new Date().toISOString()
        });
    } catch (e) {
        console.warn('[stock-history] RTDB append failed:', e?.message || e);
    }
}

const stockHistorySubmodule = {
    entries: [],
    _wired: false,
    _tabBindingsDone: false,
    _rtdbRef: null,
    _rtdbHandler: null,

    init() {
        this._bindTabs();
        if (!this._wired) {
            this._wired = true;
            window.addEventListener('branchChanged', () => this._restartStream());
        }
        this._restartStream();
    },

    _bindTabs() {
        if (this._tabBindingsDone) return;
        const tabOrders = document.getElementById('ordersSubmoduleTabOrders');
        const tabStock = document.getElementById('ordersSubmoduleTabStock');
        const panelOrders = document.getElementById('ordersSubmodulePanelOrders');
        const panelStock = document.getElementById('ordersSubmodulePanelStock');
        if (!tabOrders || !tabStock || !panelOrders || !panelStock) return;

        tabOrders.addEventListener('click', () => {
            tabOrders.classList.add('active');
            tabStock.classList.remove('active');
            panelOrders.style.display = '';
            panelStock.style.display = 'none';
        });
        tabStock.addEventListener('click', () => {
            tabStock.classList.add('active');
            tabOrders.classList.remove('active');
            panelStock.style.display = '';
            panelOrders.style.display = 'none';
        });
        this._tabBindingsDone = true;
    },

    _stopStream() {
        try {
            if (this._rtdbRef && this._rtdbHandler) {
                rtdbOff(this._rtdbRef, 'value', this._rtdbHandler);
            }
        } catch (e) { /* ignore */ }
        this._rtdbRef = null;
        this._rtdbHandler = null;
    },

    _restartStream() {
        this._stopStream();

        const table = document.getElementById('stockHistoryTable');
        const offline = document.getElementById('stockHistoryRtdbOffline');
        const empty = document.getElementById('stockHistoryEmpty');

        if (!isRtdbConfigured) {
            this.entries = [];
            if (offline) offline.style.display = 'block';
            if (table) table.style.display = 'none';
            if (empty) empty.style.display = 'none';
            this._renderBody();
            return;
        }

        if (offline) offline.style.display = 'none';
        if (table) table.style.display = '';

        const filterFn = branchScopeFilter();
        const r = rtdbRef(rtdb, 'stockHistory');
        this._rtdbRef = r;
        this._rtdbHandler = (snap) => {
            const val = snap.val();
            const list = [];
            if (val && typeof val === 'object') {
                Object.entries(val).forEach(([id, row]) => {
                    const item = { id, ...row };
                    if (filterFn(item)) list.push(item);
                });
            }
            list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
            this.entries = list.slice(0, MAX_ROWS);
            this._renderBody();
        };
        rtdbOnValue(r, this._rtdbHandler, (err) => {
            console.error('[stock-history] RTDB listener error:', err);
        });
    },

    _formatWhen(iso) {
        if (!iso) return '—';
        const d = new Date(iso);
        return isNaN(d.getTime()) ? '—' : d.toLocaleString();
    },

    _renderBody() {
        const tbody = document.getElementById('stockHistoryTableBody');
        const empty = document.getElementById('stockHistoryEmpty');
        const table = document.getElementById('stockHistoryTable');
        if (!tbody) return;

        tbody.innerHTML = '';

        if (!isRtdbConfigured) {
            if (empty) empty.style.display = 'none';
            return;
        }

        if (this.entries.length === 0) {
            if (empty) empty.style.display = 'block';
            if (table) table.style.display = 'none';
            return;
        }

        if (empty) empty.style.display = 'none';
        if (table) table.style.display = '';

        const label = (src) => SOURCE_LABELS[src] || String(src || '').replace(/_/g, ' ') || '—';

        this.entries.forEach((row) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${esc(this._formatWhen(row.createdAt))}</td>
                <td><strong>${esc(row.itemName)}</strong></td>
                <td>${esc(row.sku || '—')}</td>
                <td>${esc(row.branchName || row.branchId || '—')}</td>
                <td>${esc(String(row.quantityBefore ?? 0))}</td>
                <td style="color:#16a34a;font-weight:600;">+${esc(String(row.quantityAdded ?? 0))}</td>
                <td>${esc(String(row.quantityAfter ?? 0))}</td>
                <td>${esc(row.recordedByName || '—')}</td>
                <td>${esc(label(row.source))}</td>
            `;
            tbody.appendChild(tr);
        });
    }
};

export { stockHistorySubmodule };
export default stockHistorySubmodule;

window.stockHistorySubmodule = stockHistorySubmodule;
