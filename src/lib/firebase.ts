import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyA_Dva3n8qrtjH8C1Mu2qne_MBYVnFkO_k",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "project-0e53c6ec-a59b-40b4-a2f.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "project-0e53c6ec-a59b-40b4-a2f",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "project-0e53c6ec-a59b-40b4-a2f.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "718641442025",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:718641442025:web:353c6dfc3a6f8cd19a1478",
};

// Initialize Firebase only once
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

export { app, auth, db, storage };
