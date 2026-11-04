// src/lib/firebase.ts

import { initializeApp, getApp, getApps } from "firebase/app";
import { initializeFirestore, persistentLocalCache, connectFirestoreEmulator } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";
import { firebaseConfig } from "./firebase.config";

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

// Firestore with offline persistence (IndexedDB) for the PWA.
const db = initializeFirestore(app, {
  localCache: persistentLocalCache(),
});

const storage = getStorage(app);
const auth = getAuth(app);

// Local development against the Firebase Emulator Suite (`pnpm emulators`).
// getFunctions() returns the same instance everywhere, so connecting it here
// also covers the callable functions used in the users pages.
if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true" && typeof window !== "undefined") {
  const globalFlag = globalThis as typeof globalThis & { __tempotrackEmulators?: boolean };
  if (!globalFlag.__tempotrackEmulators) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
    connectFunctionsEmulator(getFunctions(app), "127.0.0.1", 5001);
    globalFlag.__tempotrackEmulators = true;
  }
}

export { app, db, storage, auth };
