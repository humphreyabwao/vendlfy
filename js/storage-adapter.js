// Storage adapter
// ----------------
// Wraps Firestore writes with a timeout so the UI can never hang forever, and
// transparently falls back to Realtime Database when Firestore is unavailable
// (e.g. quota exhausted, offline, transient errors).
//
// All callers receive a uniform { id, source } envelope:
//   - source === 'firestore'  → doc lives in Firestore
//   - source === 'rtdb'       → doc lives in Realtime Database
//
// Reads are served by `streamDual()` which subscribes to BOTH stores in parallel
// and returns a merged, de-duplicated list. This means data written during a
// quota outage stays visible (and writable) until the Firestore quota resets,
// at which point you can replay any RTDB-only docs back into Firestore offline.

import {
    db, rtdb, isFirebaseConfigured, isRtdbConfigured,
    collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, getDocs,
    rtdbRef, rtdbPush, rtdbSet, rtdbUpdate, rtdbRemove, rtdbOnValue, rtdbOff, rtdbGet
} from './firebase-config.js';

// ---------- Utilities ----------

const DEFAULT_TIMEOUT_MS = 8000;
/** User profile writes can be slower on flaky networks; keep UI responsive with a slightly higher cap. */
const USER_PROFILE_TIMEOUT_MS = 15000;

function withTimeout(promise, ms = DEFAULT_TIMEOUT_MS, label = 'firestore-op') {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => {
            const err = new Error(`${label} timed out after ${ms}ms`);
            err.code = 'timeout';
            reject(err);
        }, ms))
    ]);
}

/** RTDB does not accept `undefined`; strip recursively. */
function stripUndefinedDeep(value) {
    if (value === undefined) return undefined;
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) {
        return value
            .map((v) => stripUndefinedDeep(v))
            .filter((v) => v !== undefined);
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) {
        if (v === undefined) continue;
        const nv = stripUndefinedDeep(v);
        if (nv !== undefined) out[k] = nv;
    }
    return out;
}

// Heuristics for when a Firestore failure should trigger an RTDB fallback.
// Quota exhaustion, deadline-exceeded, network failures and our own timeouts.
function shouldFallback(err) {
    if (!err) return false;
    const code = (err.code || '').toLowerCase();
    if (
        code === 'timeout' ||
        code === 'resource-exhausted' ||
        code === 'deadline-exceeded' ||
        code === 'unavailable' ||
        code === 'cancelled' ||
        code === 'aborted'
    ) return true;
    const msg = (err.message || '').toLowerCase();
    if (msg.includes('quota') || msg.includes('exhausted') || msg.includes('exceeded') || msg.includes('rate limit')) return true;
    // Firestore doc missing (e.g. record exists only in RTDB fallback) — still mirror to RTDB.
    if (code === 'not-found') return true;
    return false;
}

// ---------- User profiles (/users/{uid}) — Firestore primary + RTDB mirror ----------

/**
 * Save full user profile to Firestore and Realtime DB in parallel.
 * Succeeds if at least one backend persists (covers Firestore downtime / delays).
 */
export async function saveUserProfileDuplex(uid, profile, opts = {}) {
    const timeoutMs = opts.timeoutMs ?? USER_PROFILE_TIMEOUT_MS;
    if (!uid) throw new Error('User id required');
    const rtdbPayload = stripUndefinedDeep(profile);

    let fsErr = null;
    let rtdbErr = null;

    const fsTask =
        isFirebaseConfigured && db
            ? withTimeout(
                  setDoc(doc(db, 'users', uid), profile),
                  timeoutMs,
                  `setDoc(users/${uid})`
              ).catch((e) => {
                  fsErr = e;
              })
            : Promise.resolve();

    const rtdbTask = isRtdbConfigured
        ? withTimeout(
              rtdbSet(rtdbRef(rtdb, `users/${uid}`), rtdbPayload),
              timeoutMs,
              `rtdbSet(users/${uid})`
          ).catch((e) => {
              rtdbErr = e;
          })
        : Promise.resolve();

    await Promise.all([fsTask, rtdbTask]);

    if (fsErr && rtdbErr) {
        const err = new Error(
            `Failed to save user profile. Firestore: ${fsErr.message || fsErr}. RTDB: ${rtdbErr.message || rtdbErr}.`
        );
        err.firestoreError = fsErr;
        err.rtdbError = rtdbErr;
        throw err;
    }
    if (fsErr) {
        console.warn('[users] Firestore save failed; profile is available from Realtime Database.', fsErr.code || fsErr.message);
    }
    if (rtdbErr) {
        console.warn('[users] Realtime Database mirror failed; profile is on Firestore only.', rtdbErr.code || rtdbErr.message);
    }
    return { firestoreOk: !fsErr, rtdbOk: !rtdbErr };
}

/**
 * Patch user fields on both backends (partial update).
 */
export async function updateUserProfileDuplex(uid, updates, opts = {}) {
    const timeoutMs = opts.timeoutMs ?? USER_PROFILE_TIMEOUT_MS;
    if (!uid) throw new Error('User id required');
    const patch = stripUndefinedDeep(updates);
    if (!patch || Object.keys(patch).length === 0) return { firestoreOk: true, rtdbOk: true };

    let fsErr = null;
    let rtdbErr = null;

    const fsTask =
        isFirebaseConfigured && db
            ? withTimeout(updateDoc(doc(db, 'users', uid), updates), timeoutMs, `updateDoc(users/${uid})`).catch(
                  (e) => {
                      fsErr = e;
                  }
              )
            : Promise.resolve();

    const rtdbTask = isRtdbConfigured
        ? withTimeout(
              rtdbUpdate(rtdbRef(rtdb, `users/${uid}`), patch),
              timeoutMs,
              `rtdbUpdate(users/${uid})`
          ).catch((e) => {
              rtdbErr = e;
          })
        : Promise.resolve();

    await Promise.all([fsTask, rtdbTask]);

    if (fsErr && rtdbErr) {
        const err = new Error(
            `Failed to update user profile. Firestore: ${fsErr.message || fsErr}. RTDB: ${rtdbErr.message || rtdbErr}.`
        );
        err.firestoreError = fsErr;
        err.rtdbError = rtdbErr;
        throw err;
    }
    if (fsErr) console.warn('[users] Firestore update failed; RTDB updated.', fsErr.code || fsErr.message);
    if (rtdbErr) console.warn('[users] RTDB update failed; Firestore updated.', rtdbErr.code || rtdbErr.message);
    return { firestoreOk: !fsErr, rtdbOk: !rtdbErr };
}

/**
 * Remove profile doc from both stores (Auth user must be deleted separately).
 */
export async function deleteUserProfileDuplex(uid, opts = {}) {
    const timeoutMs = opts.timeoutMs ?? USER_PROFILE_TIMEOUT_MS;
    if (!uid) throw new Error('User id required');

    let fsErr = null;
    let rtdbErr = null;

    const fsTask =
        isFirebaseConfigured && db
            ? withTimeout(deleteDoc(doc(db, 'users', uid)), timeoutMs, `deleteDoc(users/${uid})`).catch((e) => {
                  fsErr = e;
              })
            : Promise.resolve();

    const rtdbTask = isRtdbConfigured
        ? withTimeout(rtdbRemove(rtdbRef(rtdb, `users/${uid}`)), timeoutMs, `rtdbRemove(users/${uid})`).catch((e) => {
              rtdbErr = e;
          })
        : Promise.resolve();

    await Promise.all([fsTask, rtdbTask]);

    if (fsErr && rtdbErr) {
        const err = new Error(
            `Failed to delete user profile. Firestore: ${fsErr.message || fsErr}. RTDB: ${rtdbErr.message || rtdbErr}.`
        );
        err.firestoreError = fsErr;
        err.rtdbError = rtdbErr;
        throw err;
    }
    if (fsErr) console.warn('[users] Firestore delete failed; removed from RTDB.', fsErr.code || fsErr.message);
    if (rtdbErr) console.warn('[users] RTDB delete failed; removed from Firestore.', rtdbErr.code || rtdbErr.message);
    return { firestoreOk: !fsErr, rtdbOk: !rtdbErr };
}

/** After a Firestore-only write (e.g. batch), mirror profile into RTDB without touching Firestore again. */
export async function mirrorUserProfileToRtdb(uid, profile, opts = {}) {
    const timeoutMs = opts.timeoutMs ?? USER_PROFILE_TIMEOUT_MS;
    if (!isRtdbConfigured) return { rtdbOk: false };
    if (!uid) throw new Error('User id required');
    await withTimeout(
        rtdbSet(rtdbRef(rtdb, `users/${uid}`), stripUndefinedDeep(profile)),
        timeoutMs,
        `rtdbSet(users/${uid})`
    );
    return { rtdbOk: true };
}

const BRAND_SETTINGS_TIMEOUT_MS = 12000;

/**
 * Brand settings: Firestore `system/brand` + optional mirror `settings/brand` in Realtime Database.
 * Succeeds if at least one backend persists. RTDB errors are non-fatal when Firestore succeeds.
 */
export async function saveBrandSettingsDuplex(merged, opts = {}) {
    const timeoutMs = opts.timeoutMs ?? BRAND_SETTINGS_TIMEOUT_MS;
    const payload = stripUndefinedDeep(merged);

    const fsAttempted = !!(isFirebaseConfigured && db);
    const rtdbAttempted = !!isRtdbConfigured;

    if (!fsAttempted && !rtdbAttempted) {
        return { firestoreOk: false, rtdbOk: false };
    }

    let fsErr = null;
    let rtdbErr = null;

    const fsTask = fsAttempted
        ? withTimeout(
              setDoc(doc(db, 'system', 'brand'), merged, { merge: true }),
              timeoutMs,
              'setDoc(system/brand)'
          ).catch((e) => {
              fsErr = e;
          })
        : Promise.resolve();

    const rtdbTask = rtdbAttempted
        ? withTimeout(
              rtdbSet(rtdbRef(rtdb, 'settings/brand'), payload),
              timeoutMs,
              'rtdbSet(settings/brand)'
          ).catch((e) => {
              rtdbErr = e;
          })
        : Promise.resolve();

    await Promise.all([fsTask, rtdbTask]);

    const firestoreOk = fsAttempted && !fsErr;
    const rtdbOk = rtdbAttempted && !rtdbErr;

    if (!firestoreOk && !rtdbOk) {
        const parts = [];
        if (fsAttempted && fsErr) parts.push(`Firestore: ${fsErr.message || fsErr}`);
        if (rtdbAttempted && rtdbErr) parts.push(`RTDB: ${rtdbErr.message || rtdbErr}`);
        const err = new Error(`Failed to save brand settings. ${parts.join('. ')}`);
        if (fsErr) err.firestoreError = fsErr;
        if (rtdbErr) err.rtdbError = rtdbErr;
        throw err;
    }
    if (fsErr) {
        console.warn(
            '[settings/brand] Firestore save failed; values may load from Realtime Database copy.',
            fsErr.code || fsErr.message
        );
    }
    if (rtdbErr) {
        console.warn(
            '[settings/brand] Realtime Database mirror failed (optional). Brand still saved to Firestore if that succeeded.',
            rtdbErr.code || rtdbErr.message
        );
    }
    return { firestoreOk, rtdbOk };
}

const BRANCH_DUPLEX_TIMEOUT_MS = 12000;

/**
 * Branches: Firestore `branches/{id}` is authoritative; Realtime Database
 * `branches/{id}` is a parallel mirror that *also* serves as a fallback if
 * Firestore is unavailable (slow, quota-blocked, transient errors). This
 * matches the resilience pattern used for user profiles.
 *
 * Succeeds if at least one backend persists the record.
 * Throws a single unified error only if BOTH backends fail.
 */
export async function createBranchDuplex(newBranch, opts = {}) {
    const timeoutMs = opts.timeoutMs ?? BRANCH_DUPLEX_TIMEOUT_MS;
    if (!isFirebaseConfigured && !isRtdbConfigured) {
        throw new Error('No Firebase backend configured');
    }

    const fsPayload = stripUndefinedDeep({ ...newBranch });
    let id = null;
    let fsErr = null;
    let rtdbErr = null;
    let firestoreOk = false;
    let rtdbOk = false;

    // Generate the id up front so both backends can use the same id.
    if (isFirebaseConfigured && db) {
        try {
            const docRef = doc(collection(db, 'branches'));
            id = docRef.id;
            await withTimeout(setDoc(docRef, fsPayload), timeoutMs, 'setDoc(branches)');
            firestoreOk = true;
        } catch (e) {
            fsErr = e;
            console.warn('[branches] Firestore write failed:', e.code || e.message);
        }
    }

    if (!id) id = `b_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    if (isRtdbConfigured && rtdb) {
        try {
            const rtdbPayload = stripUndefinedDeep({ id, ...fsPayload });
            await withTimeout(
                rtdbSet(rtdbRef(rtdb, `branches/${id}`), rtdbPayload),
                timeoutMs,
                `rtdbSet(branches/${id})`
            );
            rtdbOk = true;
        } catch (e) {
            rtdbErr = e;
            console.warn('[branches] Realtime Database mirror failed:', e.code || e.message);
        }
    }

    if (!firestoreOk && !rtdbOk) {
        const err = fsErr || rtdbErr || new Error('Branch create failed in both backends');
        if (fsErr) err.code = err.code || fsErr.code;
        throw err;
    }

    return { id, ...fsPayload, _source: firestoreOk ? 'firestore' : 'rtdb' };
}

export async function updateBranchDuplex(branchId, updates, opts = {}) {
    if (!branchId) throw new Error('Branch id required');
    const timeoutMs = opts.timeoutMs ?? BRANCH_DUPLEX_TIMEOUT_MS;
    const patch = stripUndefinedDeep(updates);
    if (!patch || Object.keys(patch).length === 0) return;

    let fsErr = null;
    let rtdbErr = null;
    let firestoreOk = false;
    let rtdbOk = false;

    if (isFirebaseConfigured && db) {
        try {
            await withTimeout(
                updateDoc(doc(db, 'branches', branchId), patch),
                timeoutMs,
                'updateDoc(branches)'
            );
            firestoreOk = true;
        } catch (e) {
            fsErr = e;
            console.warn('[branches] Firestore update failed:', e.code || e.message);
        }
    }

    if (isRtdbConfigured && rtdb) {
        try {
            await withTimeout(
                rtdbUpdate(rtdbRef(rtdb, `branches/${branchId}`), patch),
                timeoutMs,
                `rtdbUpdate(branches/${branchId})`
            );
            rtdbOk = true;
        } catch (e) {
            rtdbErr = e;
            console.warn('[branches] Realtime Database mirror update failed:', e.code || e.message);
        }
    }

    if (!firestoreOk && !rtdbOk) {
        const err = fsErr || rtdbErr || new Error('Branch update failed in both backends');
        if (fsErr) err.code = err.code || fsErr.code;
        throw err;
    }
}

export async function deleteBranchDuplex(branchId, opts = {}) {
    if (!branchId) throw new Error('Branch id required');
    const timeoutMs = opts.timeoutMs ?? BRANCH_DUPLEX_TIMEOUT_MS;

    let fsErr = null;
    let rtdbErr = null;
    let firestoreOk = false;
    let rtdbOk = false;

    if (isFirebaseConfigured && db) {
        try {
            await withTimeout(deleteDoc(doc(db, 'branches', branchId)), timeoutMs, 'deleteDoc(branches)');
            firestoreOk = true;
        } catch (e) {
            fsErr = e;
            console.warn('[branches] Firestore delete failed:', e.code || e.message);
        }
    }

    if (isRtdbConfigured && rtdb) {
        try {
            await withTimeout(
                rtdbRemove(rtdbRef(rtdb, `branches/${branchId}`)),
                timeoutMs,
                `rtdbRemove(branches/${branchId})`
            );
            rtdbOk = true;
        } catch (e) {
            rtdbErr = e;
            console.warn('[branches] Realtime Database mirror delete failed:', e.code || e.message);
        }
    }

    if (!firestoreOk && !rtdbOk) {
        const err = fsErr || rtdbErr || new Error('Branch delete failed in both backends');
        if (fsErr) err.code = err.code || fsErr.code;
        throw err;
    }
}

// ---------- Writes ----------

export async function addWithFallback(collectionName, data, opts = {}) {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    if (!isFirebaseConfigured) {
        if (!isRtdbConfigured) throw new Error('No Firestore / RTDB available');
        return _rtdbAdd(collectionName, data);
    }

    // Pre-generate the document id so if Firestore is slow and we hit the timeout,
    // the RTDB fallback uses the SAME key. Otherwise addDoc can still complete
    // after a timeout + rtdbPush — two different ids / duplicate rows (e.g. ventures).
    const docRef = doc(collection(db, collectionName));

    try {
        await withTimeout(
            setDoc(docRef, data),
            timeoutMs,
            `setDoc(${collectionName})`
        );
        return { id: docRef.id, source: 'firestore' };
    } catch (err) {
        if (shouldFallback(err) && isRtdbConfigured) {
            console.warn(`[storage] Firestore add failed for ${collectionName} (${err.code || 'error'}): falling back to Realtime DB.`, err.message);
            return _rtdbAdd(collectionName, data, docRef.id);
        }
        throw err;
    }
}

export async function updateWithFallback(collectionName, id, data, source = 'firestore', opts = {}) {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    if (source === 'rtdb') {
        if (!isRtdbConfigured) throw new Error('Realtime DB not available');
        await withTimeout(rtdbUpdate(rtdbRef(rtdb, `${collectionName}/${id}`), data), timeoutMs, `rtdb.update(${collectionName})`);
        return;
    }

    if (!isFirebaseConfigured) {
        if (!isRtdbConfigured) throw new Error('No Firestore / RTDB available');
        await withTimeout(rtdbUpdate(rtdbRef(rtdb, `${collectionName}/${id}`), data), timeoutMs);
        return;
    }

    try {
        await withTimeout(
            updateDoc(doc(db, collectionName, id), data),
            timeoutMs,
            `updateDoc(${collectionName})`
        );
    } catch (err) {
        if (shouldFallback(err) && isRtdbConfigured) {
            console.warn(`[storage] Firestore update failed for ${collectionName}/${id} (${err.code || 'error'}): mirroring to Realtime DB.`);
            await withTimeout(rtdbUpdate(rtdbRef(rtdb, `${collectionName}/${id}`), data), timeoutMs);
            return;
        }
        throw err;
    }
}

export async function deleteWithFallback(collectionName, id, source = 'firestore', opts = {}) {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    if (source === 'rtdb') {
        if (!isRtdbConfigured) throw new Error('Realtime DB not available');
        await withTimeout(rtdbRemove(rtdbRef(rtdb, `${collectionName}/${id}`)), timeoutMs);
        return;
    }

    if (!isFirebaseConfigured) {
        if (!isRtdbConfigured) throw new Error('No Firestore / RTDB available');
        await withTimeout(rtdbRemove(rtdbRef(rtdb, `${collectionName}/${id}`)), timeoutMs);
        return;
    }

    try {
        await withTimeout(deleteDoc(doc(db, collectionName, id)), timeoutMs, `deleteDoc(${collectionName})`);
    } catch (err) {
        if (shouldFallback(err) && isRtdbConfigured) {
            console.warn(`[storage] Firestore delete failed for ${collectionName}/${id} (${err.code || 'error'}): mirroring to Realtime DB.`);
            await withTimeout(rtdbRemove(rtdbRef(rtdb, `${collectionName}/${id}`)), timeoutMs);
            return;
        }
        throw err;
    }
}

async function _rtdbAdd(collectionName, data, fixedId = null) {
    if (!isRtdbConfigured) throw new Error('Realtime DB not available');
    if (fixedId != null && fixedId !== '') {
        const r = rtdbRef(rtdb, `${collectionName}/${fixedId}`);
        await rtdbSet(r, data);
        return { id: fixedId, source: 'rtdb' };
    }
    const node = rtdbPush(rtdbRef(rtdb, collectionName));
    await rtdbSet(node, data);
    return { id: node.key, source: 'rtdb' };
}

// ---------- One-shot read (merge Firestore + RTDB, same semantics as streamDual) ----------

/**
 * Fetch a merged list: Firestore query result + RTDB path, de-duplicated (Firestore wins on id).
 * Use when modules use getDocs() today but still need RTDB fallback rows (e.g. quota).
 */
export async function readMerged({
    firestoreQuery,
    rtdbPath,
    rtdbFilter = () => true,
    timeoutMs = DEFAULT_TIMEOUT_MS
}) {
    let firestoreItems = [];

    if (isFirebaseConfigured && firestoreQuery) {
        try {
            const snap = await withTimeout(
                getDocs(firestoreQuery),
                timeoutMs,
                'getDocs(merged)'
            );
            snap.forEach((d) => firestoreItems.push({ id: d.id, ...d.data() }));
        } catch (err) {
            console.warn('[storage] Firestore read in readMerged failed:', err?.code || err?.message, err);
        }
    }

    let rtdbItems = [];
    if (isRtdbConfigured && rtdbPath) {
        try {
            const snap = await withTimeout(
                rtdbGet(rtdbRef(rtdb, rtdbPath)),
                timeoutMs,
                'rtdbGet(merged)'
            );
            const val = snap.val();
            if (val && typeof val === 'object') {
                Object.entries(val).forEach(([id, payload]) => {
                    const item = { id, ...payload };
                    if (rtdbFilter(item)) rtdbItems.push(item);
                });
            }
        } catch (err) {
            console.warn('[storage] RTDB read in readMerged failed:', err?.code || err?.message, err);
        }
    }

    const map = new Map();
    firestoreItems.forEach((it) => map.set(it.id, { ...it, _source: 'firestore' }));
    rtdbItems.forEach((it) => {
        if (!map.has(it.id)) map.set(it.id, { ...it, _source: 'rtdb' });
    });
    return Array.from(map.values());
}

// ---------- Reads (dual-source streaming) ----------
//
// `streamDual` subscribes to both Firestore (via the caller-supplied query) AND
// the matching RTDB path. The callback is invoked whenever either side updates,
// with a merged, de-duplicated list. Each item is tagged with `_source` so
// callers know which store to update later.

export function streamDual({
    firestoreQuery,           // Firestore Query (with `where(...)` already applied)
    rtdbPath,                 // Top-level RTDB collection name
    rtdbFilter = () => true,  // Client-side filter for RTDB items (e.g. branch scope)
    onUpdate,                 // Called with the merged array
    onError                   // Called with errors from either side (non-fatal)
}) {
    let firestoreItems = [];
    let rtdbItems = [];
    let firestoreReady = !isFirebaseConfigured || !firestoreQuery;
    let rtdbReady = !isRtdbConfigured || !rtdbPath;

    const emit = () => {
        const map = new Map();
        firestoreItems.forEach((it) => map.set(it.id, { ...it, _source: 'firestore' }));
        rtdbItems.forEach((it) => {
            // Firestore wins when the same id exists in both (rare).
            if (!map.has(it.id)) map.set(it.id, { ...it, _source: 'rtdb' });
        });
        onUpdate?.(Array.from(map.values()), { firestoreReady, rtdbReady });
    };

    let unsubFs = null;
    let rtdbHandlerPath = null;
    let rtdbHandler = null;

    if (isFirebaseConfigured && firestoreQuery) {
        try {
            unsubFs = onSnapshot(
                firestoreQuery,
                (snap) => {
                    firestoreItems = [];
                    snap.forEach((d) => firestoreItems.push({ id: d.id, ...d.data() }));
                    firestoreReady = true;
                    emit();
                },
                (err) => {
                    firestoreReady = true;
                    onError?.(err, 'firestore');
                    // Even on error, emit so RTDB-only data is visible.
                    emit();
                }
            );
        } catch (err) {
            firestoreReady = true;
            onError?.(err, 'firestore');
        }
    }

    if (isRtdbConfigured && rtdbPath) {
        try {
            const r = rtdbRef(rtdb, rtdbPath);
            rtdbHandlerPath = r;
            rtdbHandler = (snap) => {
                rtdbItems = [];
                const val = snap.val();
                if (val && typeof val === 'object') {
                    Object.entries(val).forEach(([id, payload]) => {
                        const item = { id, ...payload };
                        if (rtdbFilter(item)) rtdbItems.push(item);
                    });
                }
                rtdbReady = true;
                emit();
            };
            rtdbOnValue(r, rtdbHandler, (err) => {
                rtdbReady = true;
                onError?.(err, 'rtdb');
                emit();
            });
        } catch (err) {
            rtdbReady = true;
            onError?.(err, 'rtdb');
        }
    }

    // Initial emit if neither store is configured (so caller gets at least an empty array).
    if (firestoreReady && rtdbReady) emit();

    // Returns an unsubscribe function for both streams.
    return () => {
        try { unsubFs?.(); } catch (e) { /* ignore */ }
        try {
            if (rtdbHandlerPath && rtdbHandler) rtdbOff(rtdbHandlerPath, 'value', rtdbHandler);
        } catch (e) { /* ignore */ }
    };
}

export const storageAdapter = {
    addWithFallback,
    updateWithFallback,
    deleteWithFallback,
    readMerged,
    streamDual,
    shouldFallback,
    withTimeout,
    saveUserProfileDuplex,
    updateUserProfileDuplex,
    deleteUserProfileDuplex,
    mirrorUserProfileToRtdb,
    saveBrandSettingsDuplex,
    createBranchDuplex,
    updateBranchDuplex,
    deleteBranchDuplex
};

export default storageAdapter;
