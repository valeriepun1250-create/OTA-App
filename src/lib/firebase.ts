import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "AIzaSyC6xM44RiCxw8E9c-mb79H3vy32WifqBzk",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "ota-app-cbdc2.firebaseapp.com",
  databaseURL:
    process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL ??
    "https://ota-app-cbdc2-default-rtdb.firebaseio.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "ota-app-cbdc2",
  storageBucket:
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "ota-app-cbdc2.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "478224605139",
  appId:
    process.env.NEXT_PUBLIC_FIREBASE_APP_ID ??
    "1:478224605139:web:d0916f056f4ae6e7fc1926",
};

export const firebaseApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const firebaseAuth = getAuth(firebaseApp);
export const firebaseDb = getDatabase(firebaseApp);

let anonymousSignIn: Promise<void> | null = null;

/** Anonymous auth is used for the prototype so Realtime Database rules can require auth. */
export function ensureAnonymousAuth(): Promise<void> {
  if (firebaseAuth.currentUser) return Promise.resolve();
  anonymousSignIn ??= signInAnonymously(firebaseAuth).then(() => undefined);
  return anonymousSignIn;
}
