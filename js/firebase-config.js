// Firebase Configuration
// Import the functions you need from the SDKs you need
import { initializeApp, deleteApp, getApps } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, doc, updateDoc, deleteDoc, setDoc, getDoc, query, where, orderBy, limit, Timestamp, serverTimestamp, onSnapshot, writeBatch } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail, setPersistence, browserSessionPersistence, browserLocalPersistence, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-analytics.js";
import {
    getDatabase, ref as rtdbRef, push as rtdbPush, set as rtdbSet,
    update as rtdbUpdate, remove as rtdbRemove, onValue as rtdbOnValue,
    off as rtdbOff, child as rtdbChild, get as rtdbGet
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";


// Your web app's Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyDbvIhKGTFr7zQZt9AH4tJvIYtRv7HBbio",
    authDomain: "vendly-pos.firebaseapp.com",
    projectId: "vendly-pos",
    storageBucket: "vendly-pos.firebasestorage.app",
    messagingSenderId: "88852599749",
    appId: "1:88852599749:web:5b33b45d61e5515913f1ac",
    measurementId: "G-4QL8JB1D3M"
};

// Initialize Firebase
let app;
let db;
let rtdb;
let auth;
let storage;
let analytics;
let isFirebaseConfigured = false;
let isRtdbConfigured = false;

try {
    console.log('🔥 Initializing Firebase...');
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    auth = getAuth(app);
    storage = getStorage(app);
    analytics = getAnalytics(app);
    isFirebaseConfigured = true;

    // Realtime Database (used as a fallback when Firestore quota is exhausted).
    // Default URL pattern is "https://<projectId>-default-rtdb.firebaseio.com".
    try {
        rtdb = getDatabase(app);
        isRtdbConfigured = true;
        window.rtdb = rtdb;
        console.log('✅ Realtime Database connected (fallback for quota events)');
    } catch (e) {
        console.warn('⚠️ Realtime Database not available:', e?.message);
        isRtdbConfigured = false;
    }

    // Make db globally available
    window.db = db;
    window.firebase = { app, db, rtdb, auth, storage, analytics };
    
    console.log('✅ Firebase initialized successfully');
    console.log('✅ Firestore database connected');
    console.log('✅ Project:', firebaseConfig.projectId);
    console.log('✅ Ready for real-time data sync');
} catch (error) {
    console.error('❌ Error initializing Firebase:', error);
    console.error('Error details:', error.message);
    isFirebaseConfigured = false;
}

// Export for use in other modules
export { 
    app, 
    db, 
    rtdb,
    auth,
    storage,
    analytics,
    isFirebaseConfigured,
    isRtdbConfigured,
    firebaseConfig,
    // Realtime Database functions
    getDatabase,
    rtdbRef,
    rtdbPush,
    rtdbSet,
    rtdbUpdate,
    rtdbRemove,
    rtdbOnValue,
    rtdbOff,
    rtdbChild,
    rtdbGet,
    // App lifecycle
    initializeApp,
    deleteApp,
    getApps,
    getAuth,
    getFirestore,
    // Firestore functions
    collection,
    addDoc,
    getDocs,
    doc,
    updateDoc,
    deleteDoc,
    setDoc,
    getDoc,
    query,
    where,
    orderBy,
    limit,
    Timestamp,
    serverTimestamp,
    onSnapshot,
    writeBatch,
    // Storage functions
    ref,
    uploadBytes,
    getDownloadURL,
    deleteObject,
    // Auth functions
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    sendPasswordResetEmail,
    setPersistence,
    browserSessionPersistence,
    browserLocalPersistence,
    createUserWithEmailAndPassword
};
