import { firebaseConfig, COLLECTIONS } from "./config.js";
import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { get, getDatabase, ref, set, update } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const AUTH_STORAGE_KEYS = ["safetynet:parent-user", "safetynet:parent-session", "safetynet:parent-sound"];

function authError(code, fallback) {
  const messages = {
    "auth/email-already-in-use": "A parent account already exists for that email.",
    "auth/invalid-email": "Enter a valid email address.",
    "auth/weak-password": "Password must be at least 6 characters long.",
    "auth/user-not-found": "No parent account was found for that email.",
    "auth/wrong-password": "Incorrect password.",
    "auth/invalid-credential": "Incorrect email or password."
  };

  const error = new Error(messages[code] || fallback);
  error.code = code;
  return error;
}

async function getParentProfile(uid) {
  const [userSnapshot, parentSnapshot] = await Promise.all([
    get(ref(db, `${COLLECTIONS.USERS}/${uid}`)),
    get(ref(db, `${COLLECTIONS.PARENTS}/${uid}`))
  ]);

  return {
    userId: uid,
    ...(userSnapshot.exists() ? userSnapshot.val() : {}),
    ...(parentSnapshot.exists() ? parentSnapshot.val() : {})
  };
}

function clearParentStorage() {
  AUTH_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
  sessionStorage.removeItem("safetynet:parent-user");
}

async function signUp(email, password, name, phone) {
  try {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    const { uid } = credential.user;
    const timestamp = Date.now();

    const baseProfile = {
      userId: uid,
      email: email.trim().toLowerCase(),
      name: name.trim(),
      phone: phone.trim(),
      role: "parent",
      createdAt: timestamp,
      lastSeen: timestamp,
      isActive: true
    };

    await Promise.all([
      set(ref(db, `${COLLECTIONS.USERS}/${uid}`), baseProfile),
      set(ref(db, `${COLLECTIONS.PARENTS}/${uid}`), {
        ...baseProfile,
        linkedChildrenCount: 0,
        soundEnabled: true
      })
    ]);

    const profile = await getParentProfile(uid);
    localStorage.setItem(
      "safetynet:parent-user",
      JSON.stringify({ uid, email: profile.email, role: profile.role })
    );
    return profile;
  } catch (error) {
    throw authError(error.code, "Unable to create the parent account.");
  }
}

async function signIn(email, password) {
  try {
    const credential = await signInWithEmailAndPassword(auth, email, password);
    const { uid } = credential.user;
    const updates = { lastSeen: Date.now(), isActive: true };

    await Promise.all([
      update(ref(db, `${COLLECTIONS.USERS}/${uid}`), updates),
      update(ref(db, `${COLLECTIONS.PARENTS}/${uid}`), updates).catch(() => null)
    ]);

    const profile = await getParentProfile(uid);
    if (profile.role && profile.role !== "parent") {
      await firebaseSignOut(auth);
      throw authError("auth/not-parent-role", "This account is not registered as a parent.");
    }

    localStorage.setItem(
      "safetynet:parent-user",
      JSON.stringify({ uid, email: profile.email, role: profile.role })
    );
    return profile;
  } catch (error) {
    throw authError(error.code, "Unable to sign in right now.");
  }
}

async function signOut() {
  const currentUser = auth.currentUser;

  if (currentUser) {
    const updates = { lastSeen: Date.now(), isActive: false };
    await Promise.all([
      update(ref(db, `${COLLECTIONS.USERS}/${currentUser.uid}`), updates).catch(() => null),
      update(ref(db, `${COLLECTIONS.PARENTS}/${currentUser.uid}`), updates).catch(() => null)
    ]);
  }

  try {
    await firebaseSignOut(auth);
  } finally {
    clearParentStorage();
    if (typeof window !== "undefined") {
      window.location.hash = "#login";
    }
  }
}

function getCurrentUser() {
  return auth.currentUser || null;
}

function initAuthObserver(onChange) {
  return onAuthStateChanged(auth, async (user) => {
    if (!user) {
      onChange(null);
      return;
    }

    onChange(await getParentProfile(user.uid));
  });
}

async function sendPasswordReset(email) {
  await sendPasswordResetEmail(auth, email.trim().toLowerCase());
}

export { app, auth, db, getCurrentUser, getParentProfile, initAuthObserver, sendPasswordReset, signIn, signOut, signUp };
