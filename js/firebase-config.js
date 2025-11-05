// Firebase Configuration
// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, doc, updateDoc, deleteDoc, query, where, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// Your Firebase project configuration
// IMPORTANT: Replace these values with your actual Firebase config
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_AUTH_DOMAIN",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_STORAGE_BUCKET",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID"
};

// Initialize Firebase
let app;
let db;
let auth;
let isFirebaseConfigured = false;

try {
    // Check if Firebase is configured
    if (firebaseConfig.apiKey === "YOUR_API_KEY") {
        console.warn('⚠️ Firebase is not configured yet!');
        console.warn('Please update js/firebase-config.js with your Firebase credentials');
        console.warn('Get your config from: https://console.firebase.google.com/');
        isFirebaseConfigured = false;
    } else {
        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        isFirebaseConfigured = true;
        console.log('✅ Firebase and Firestore initialized successfully');
        console.log('✅ Firestore database ready for real-time use');
    }
} catch (error) {
    console.error('❌ Error initializing Firebase:', error);
    isFirebaseConfigured = false;
}

// Export for use in other modules
export { 
    app, 
    db, 
    auth,
    isFirebaseConfigured,
    // Firestore functions
    collection,
    addDoc,
    getDocs,
    doc,
    updateDoc,
    deleteDoc,
    query,
    where,
    orderBy,
    limit,
    // Auth functions
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged
};
