// Firebase Configuration
// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, doc, updateDoc, deleteDoc, query, where, orderBy, limit, Timestamp, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-analytics.js";

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
let auth;
let analytics;
let isFirebaseConfigured = false;

try {
    console.log('🔥 Initializing Firebase...');
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    auth = getAuth(app);
    analytics = getAnalytics(app);
    isFirebaseConfigured = true;
    
    // Make db globally available
    window.db = db;
    window.firebase = { app, db, auth, analytics };
    
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
    auth,
    analytics,
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
    Timestamp,
    serverTimestamp,
    // Auth functions
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged
};
