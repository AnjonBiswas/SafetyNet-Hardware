import { getCurrentUser, initAuthObserver, sendPasswordReset, signIn, signOut, signUp } from "./auth.js";
import { playAlertTone } from "./alerts.js";
import { initLinkingModule } from "./qr-linking.js";
import {
  acknowledgeAlert,
  getLinkedChildren,
  listenToAlerts,
  listenToChildren,
  listenToNotifications,
  resolveAlert
} from "./realtime-db.js";
import {
  createToast,
  initUIHelpers,
  renderAlerts,
  renderChildren,
  renderHistory,
  setActiveAuthTab,
  setAuthMode,
  setLoading
} from "./ui.js";

const authScreen = document.querySelector("[data-auth-screen]");
const appShellNodes = document.querySelectorAll("[data-app-shell]");
const authMessage = document.querySelector("[data-auth-message]");
const loadingOverlay = document.querySelector("[data-loading-overlay]");
const toastRegion = document.querySelector("[data-toast-region]");
const toastTemplate = document.getElementById("toast-template");
const tabButtons = document.querySelectorAll("[data-auth-tab]");
const tabPanels = document.querySelectorAll("[data-auth-panel]");
const loginForm = document.querySelector('[data-auth-form="login"]');
const signupForm = document.querySelector('[data-auth-form="signup"]');
const childrenList = document.querySelector("[data-children-list]");
const alertFeed = document.querySelector("[data-alert-feed]");
const historyList = document.querySelector("[data-history-list]");
const childCardTemplate = document.getElementById("child-card-template");
const alertCardTemplate = document.getElementById("alert-card-template");
const historyCardTemplate = document.getElementById("history-card-template");
const logoutButton = document.querySelector('[data-action="logout"]');
const forgotPasswordButton = document.querySelector('[data-action="forgot-password"]');
const parentName = document.querySelector("[data-parent-name]");
const parentAvatar = document.querySelector("[data-parent-avatar]");
const linkedChildCount = document.querySelector("[data-linked-child-count]");
const activeAlertCount = document.querySelector("[data-active-alert-count]");
const lastAlertSummary = document.querySelector("[data-last-alert-summary]");
const notificationCount = document.querySelector("[data-notification-count]");
const networkStatus = document.querySelector("[data-network-status]");
const soundToggle = document.querySelector("[data-sound-toggle]");
const linkResult = document.querySelector("[data-link-result]");
const refreshAlertsButton = document.querySelector('[data-action="refresh-alerts"]');

let currentParent = null;
let childrenUnsubscribe = null;
let alertsUnsubscribe = null;
let notificationsUnsubscribe = null;
let alertSoundEnabled = true;
let latestChildren = [];
let lastAlertSignature = "";

function showMessage(message, type = "info") {
  authMessage.textContent = message;
  authMessage.className = `auth-message text-${type === "error" ? "danger" : type === "success" ? "success" : "primary"}`;
}

function showToast(message, type = "info") {
  createToast(toastRegion, toastTemplate, message, type);
}

function updateHeader(user) {
  const displayName = user?.name || "Parent Account";
  if (parentName) {
    parentName.textContent = displayName;
  }

  if (parentAvatar) {
    parentAvatar.textContent = displayName
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "PA";
  }
}

function updateNetworkStatus() {
  if (networkStatus) {
    networkStatus.textContent = navigator.onLine ? "Online" : "Offline";
  }
}

function enrichAlerts(alerts) {
  return alerts.map((alert) => {
    const matchingChild = latestChildren.find((child) => child.childUid === alert.childUid);
    return {
      ...alert,
      childName: matchingChild?.name || matchingChild?.email || alert.childUid,
      locationText: alert.location
        ? `${alert.location.lat}, ${alert.location.lng}`
        : matchingChild?.location
          ? `${matchingChild.location.lat}, ${matchingChild.location.lng}`
          : "Location unavailable"
    };
  });
}

async function refreshChildren() {
  if (!currentParent) {
    return;
  }

  latestChildren = await getLinkedChildren(currentParent.userId);
  renderChildren(childrenList, childCardTemplate, latestChildren);
  linkedChildCount.textContent = String(latestChildren.length);
}

function wireRealtime(parentUid) {
  childrenUnsubscribe?.();
  alertsUnsubscribe?.();
  notificationsUnsubscribe?.();

  childrenUnsubscribe = listenToChildren(parentUid, async (children) => {
    latestChildren = children;
    renderChildren(childrenList, childCardTemplate, children);
    linkedChildCount.textContent = String(children.length);
  });

  alertsUnsubscribe = listenToAlerts(parentUid, (alerts) => {
    const enriched = enrichAlerts(alerts);
    const activeAlerts = enriched.filter((alert) => alert.status === "active");
    const historyAlerts = enriched.filter((alert) => alert.status !== "active");
    const currentSignature = activeAlerts.map((alert) => `${alert.alertId}:${alert.updatedAt || alert.createdAt}`).join("|");

    renderAlerts(
      alertFeed,
      alertCardTemplate,
      activeAlerts,
      async (alert) => {
        await acknowledgeAlert(alert.alertId, parentUid);
        showToast("Alert acknowledged.", "info");
      },
      async (alert) => {
        await resolveAlert(alert.alertId, parentUid);
        showToast("Alert resolved.", "success");
      }
    );

    renderHistory(historyList, historyCardTemplate, historyAlerts);
    activeAlertCount.textContent = `${activeAlerts.length} Active Alerts`;
    lastAlertSummary.textContent = activeAlerts.length
      ? `${activeAlerts[0].childName}: ${activeAlerts[0].type || "alert"}`
      : "No active emergencies right now.";

    if (activeAlerts.length && alertSoundEnabled && currentSignature !== lastAlertSignature) {
      playAlertTone();
    }

    lastAlertSignature = currentSignature;
  });

  notificationsUnsubscribe = listenToNotifications(parentUid, (notifications) => {
    const unreadCount = notifications.filter((notification) => !notification.read).length;
    notificationCount.textContent = `${unreadCount} Unread`;
  });
}

async function handleLogin(event) {
  event.preventDefault();
  const formData = new FormData(loginForm);
  setLoading(loadingOverlay, true);

  try {
    await signIn(String(formData.get("email")), String(formData.get("password")));
    showMessage("Signed in successfully.", "success");
  } catch (error) {
    showMessage(error.message, "error");
    showToast(error.message, "error");
  } finally {
    setLoading(loadingOverlay, false);
  }
}

async function handleSignup(event) {
  event.preventDefault();
  const formData = new FormData(signupForm);
  setLoading(loadingOverlay, true);

  try {
    await signUp(
      String(formData.get("email")),
      String(formData.get("password")),
      String(formData.get("name")),
      String(formData.get("phone"))
    );
    showMessage("Parent account created successfully.", "success");
    showToast("Parent account created.", "success");
  } catch (error) {
    showMessage(error.message, "error");
    showToast(error.message, "error");
  } finally {
    setLoading(loadingOverlay, false);
  }
}

async function handleForgotPassword() {
  const emailField = loginForm?.querySelector('input[name="email"]');
  if (!emailField?.value) {
    showToast("Enter your email first.", "error");
    return;
  }

  setLoading(loadingOverlay, true);
  try {
    await sendPasswordReset(emailField.value);
    showToast("Password reset email sent.", "success");
  } catch (error) {
    showToast(error.message || "Unable to send password reset email.", "error");
  } finally {
    setLoading(loadingOverlay, false);
  }
}

async function handleLogout() {
  setLoading(loadingOverlay, true);
  try {
    await signOut();
  } finally {
    setLoading(loadingOverlay, false);
  }
}

function setAuthenticatedState(user) {
  currentParent = user;
  setAuthMode(authScreen, appShellNodes, Boolean(user));

  if (!user) {
    childrenUnsubscribe?.();
    alertsUnsubscribe?.();
    notificationsUnsubscribe?.();
    latestChildren = [];
    lastAlertSignature = "";
    setLoading(loadingOverlay, false);
    return;
  }

  updateHeader(user);
  wireRealtime(user.userId);
  setLoading(loadingOverlay, false);
}

function initAuthTabs() {
  tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setActiveAuthTab(tabButtons, tabPanels, button.dataset.authTab);
    });
  });
}

function init() {
  initUIHelpers({ toastRegion, toastTemplate });
  setActiveAuthTab(tabButtons, tabPanels, "login");
  setAuthMode(authScreen, appShellNodes, false);
  setLoading(loadingOverlay, false);
  updateNetworkStatus();

  alertSoundEnabled = Boolean(soundToggle?.checked);
  soundToggle?.addEventListener("change", () => {
    alertSoundEnabled = Boolean(soundToggle.checked);
    localStorage.setItem("safetynet:parent-sound", String(alertSoundEnabled));
  });

  loginForm?.addEventListener("submit", handleLogin);
  signupForm?.addEventListener("submit", handleSignup);
  forgotPasswordButton?.addEventListener("click", handleForgotPassword);
  logoutButton?.addEventListener("click", handleLogout);
  refreshAlertsButton?.addEventListener("click", async () => {
    if (!currentParent) {
      return;
    }

    setLoading(loadingOverlay, true);
    try {
      await refreshChildren();
      showToast("Dashboard refreshed.", "info");
    } finally {
      setLoading(loadingOverlay, false);
    }
  });
  window.addEventListener("online", updateNetworkStatus);
  window.addEventListener("offline", updateNetworkStatus);

  initAuthTabs();
  initLinkingModule({
    onSuccess: async (childData) => {
      if (linkResult) {
        linkResult.textContent = `Successfully linked to ${childData.childName}.`;
      }
      await refreshChildren();
    }
  });
  initAuthObserver(setAuthenticatedState);

  const savedSoundPreference = localStorage.getItem("safetynet:parent-sound");
  if (savedSoundPreference !== null && soundToggle) {
    soundToggle.checked = savedSoundPreference === "true";
    alertSoundEnabled = soundToggle.checked;
  }
}

init();
