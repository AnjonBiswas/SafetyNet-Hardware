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
import {
  get,
  getDatabase,
  ref,
  set,
  update
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

const AUTH_STORAGE_KEYS = [
  "safetynet:user",
  "safetynet:session",
  "safetynet:last-route",
  "safetynet:last-sync"
];

function createAuthError(code, fallbackMessage) {
  const authMessages = {
    "auth/email-already-in-use": "An account already exists for this email address.",
    "auth/invalid-email": "Please enter a valid email address.",
    "auth/weak-password": "Password must be at least 6 characters long.",
    "auth/user-not-found": "No account was found for this email address.",
    "auth/wrong-password": "The password you entered is incorrect.",
    "auth/invalid-credential": "The email or password is incorrect.",
    "auth/too-many-requests": "Too many attempts were made. Please try again later.",
    "auth/network-request-failed": "Network error. Check your internet connection and try again."
  };

  const error = new Error(authMessages[code] || fallbackMessage);
  error.code = code;
  return error;
}

function clearAuthStorage() {
  AUTH_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
  sessionStorage.removeItem("safetynet:user");
  sessionStorage.removeItem("safetynet:session");
}

function normalizeUserData(uid, userData = {}) {
  return {
    userId: uid,
    ...userData
  };
}

async function getUserData(uid) {
  const [userSnapshot, childSnapshot] = await Promise.all([
    get(ref(db, `${COLLECTIONS.USERS}/${uid}`)),
    get(ref(db, `${COLLECTIONS.CHILDREN}/${uid}`))
  ]);

  if (!userSnapshot.exists() && !childSnapshot.exists()) {
    return null;
  }

  return normalizeUserData(uid, {
    ...(userSnapshot.exists() ? userSnapshot.val() : {}),
    ...(childSnapshot.exists() ? childSnapshot.val() : {})
  });
}

async function updateChildDeviceBinding(uid, deviceId) {
  const normalizedDeviceId = deviceId.trim();
  const timestamp = Date.now();

  await Promise.all([
    update(ref(db, `${COLLECTIONS.USERS}/${uid}`), {
      deviceId: normalizedDeviceId,
      updatedAt: timestamp
    }),
    update(ref(db, `${COLLECTIONS.CHILDREN}/${uid}`), {
      deviceId: normalizedDeviceId,
      updatedAt: timestamp
    }),
    update(ref(db, `${COLLECTIONS.DEVICE_STATUS}/${normalizedDeviceId}`), {
      deviceId: normalizedDeviceId,
      childUid: uid,
      linkedAt: timestamp
    }).catch(() => null)
  ]);

  return getUserData(uid);
}

async function signUp(email, password, name, phone) {
  try {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    const { uid } = credential.user;
    const timestamp = Date.now();

    const userProfile = {
      userId: uid,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      role: "child",
      createdAt: timestamp,
      lastSeen: timestamp,
      profileImageUrl: null,
      deviceId: null,
      isActive: true
    };

    const childProfile = {
      userId: uid,
      guardianCount: 0,
      lastAlertAt: null,
      lastKnownStatus: "safe",
      locationSharingEnabled: true,
      updatedAt: timestamp
    };

    await Promise.all([
      set(ref(db, `${COLLECTIONS.USERS}/${uid}`), userProfile),
      set(ref(db, `${COLLECTIONS.CHILDREN}/${uid}`), childProfile)
    ]);

    const userData = await getUserData(uid);
    const mergedUser = { ...credential.user, ...userData };

    localStorage.setItem("safetynet:user", JSON.stringify({ uid, email: mergedUser.email }));

    return mergedUser;
  } catch (error) {
    throw createAuthError(error.code, "Unable to create your account right now.");
  }
}

async function signIn(email, password) {
  try {
    const credential = await signInWithEmailAndPassword(auth, email, password);
    const { uid } = credential.user;
    const sessionUpdates = {
      lastSeen: Date.now(),
      isActive: true
    };

    await Promise.all([
      update(ref(db, `${COLLECTIONS.USERS}/${uid}`), sessionUpdates),
      update(ref(db, `${COLLECTIONS.CHILDREN}/${uid}`), {
        isActive: true,
        updatedAt: Date.now()
      }).catch(() => null)
    ]);

    const userData = await getUserData(uid);
    const mergedUser = { ...credential.user, ...userData };

    localStorage.setItem("safetynet:user", JSON.stringify({ uid, email: mergedUser.email }));

    return mergedUser;
  } catch (error) {
    throw createAuthError(error.code, "Unable to sign you in right now.");
  }
}

async function signOut() {
  try {
    const currentUser = auth.currentUser;

    if (currentUser) {
      const sessionUpdates = {
        lastSeen: Date.now(),
        isActive: false
      };

      await Promise.all([
        update(ref(db, `${COLLECTIONS.USERS}/${currentUser.uid}`), sessionUpdates).catch(() => null),
        update(ref(db, `${COLLECTIONS.CHILDREN}/${currentUser.uid}`), {
          isActive: false,
          updatedAt: Date.now()
        }).catch(() => null)
      ]);
    }

    await firebaseSignOut(auth);
  } finally {
    clearAuthStorage();

    if (typeof window !== "undefined") {
      window.location.hash = "#login";
      window.dispatchEvent(new CustomEvent("auth:signed-out"));
    }
  }
}

function getCurrentUser() {
  return auth.currentUser || null;
}

function isAuthenticated() {
  return Boolean(auth.currentUser);
}

async function sendPasswordReset(email) {
  try {
    await sendPasswordResetEmail(auth, email.trim().toLowerCase());
    return true;
  } catch (error) {
    throw createAuthError(error.code, "Unable to send the password reset email.");
  }
}

function initAuthObserver(onUserChanged) {
  return onAuthStateChanged(auth, async (user) => {
    if (user) {
      const userDoc = await getUserData(user.uid);
      onUserChanged({ ...user, ...(userDoc || {}) });
      return;
    }

    onUserChanged(null);
  });
}

export {
  app,
  auth,
  db,
  getCurrentUser,
  getUserData,
  initAuthObserver,
  isAuthenticated,
  sendPasswordReset,
  signIn,
  signOut,
  signUp,
  updateChildDeviceBinding
};
