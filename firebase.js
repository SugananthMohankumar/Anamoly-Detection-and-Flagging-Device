import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDoc,
  addDoc,
  getDocs,
  query,
  orderBy,
  limit,
  writeBatch,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyDxp4ooYUc_CgJAp8cmO_7g6WTQc_C98_c",
  authDomain: "anamoly-f3986.firebaseapp.com",
  projectId: "anamoly-f3986",
  storageBucket: "anamoly-f3986.firebasestorage.app",
  messagingSenderId: "574966130176",
  appId: "1:574966130176:web:3ae30a6eb726c49dc79ae5"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Expose Firebase services and functions cleanly on window for app.js
window.fb = {
  app,
  auth,
  db,
  // Auth methods
  createUser: (email, pass) => createUserWithEmailAndPassword(auth, email, pass),
  signIn: (email, pass) => signInWithEmailAndPassword(auth, email, pass),
  resetPassword: (email) => sendPasswordResetEmail(auth, email),
  signOut: () => signOut(auth),
  onAuthStateChanged: (cb) => onAuthStateChanged(auth, cb),

  // Firestore methods
  collection,
  doc,
  setDoc,
  getDoc,
  addDoc,
  getDocs,
  query,
  orderBy,
  limit,
  writeBatch,
  serverTimestamp
};

// Dispatch a custom event to notify app.js that Firebase SDK is initialized and ready
window.dispatchEvent(new CustomEvent('firebase-ready'));
