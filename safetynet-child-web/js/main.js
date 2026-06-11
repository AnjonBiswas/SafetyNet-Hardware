import {
  getCurrentUser,
  initAuthObserver,
  sendPasswordReset,
  signIn,
  signOut,
  signUp,
  updateChildDeviceBinding
} from "./auth.js";
import { listenToChildAlerts, listenToChildHardware, triggerMockHardwareAlert, writeMockDeviceStatus } from "./hardware.js";
import { initChildLinkingModule } from "./linking.js";

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
const logoutButton = document.querySelector('[data-action="logout"]');
const forgotPasswordButton = document.querySelector('[data-action="forgot-password"]');
const profileName = document.querySelector(".profile-name");
const profileRole = document.querySelector(".profile-role");
const profileCard = document.querySelector(".profile-card");
const profileAvatar = document.querySelector(".avatar");
const statusText = document.querySelector("[data-status-text]");
const connectionStatus = document.querySelector("[data-connection-status]");
const lastSync = document.querySelector("[data-last-sync]");
const deviceStatus = document.querySelector("[data-device-status]");
const batteryLevel = document.querySelector("[data-battery-level]");
const locationStatus = document.querySelector("[data-location-status]");
const locationDisplay = document.querySelector("[data-location-display]");
const alertList = document.querySelector("[data-alert-list]");
const deviceForm = document.querySelector("[data-device-form]");
const deviceIdInput = document.getElementById("device-id-input");
const deviceBindingStatus = document.querySelector("[data-device-binding-status]");
const hardwareTestStatus = document.querySelector("[data-hardware-test-status]");
const simulateHeartbeatButton = document.querySelector('[data-action="simulate-heartbeat"]');
const simulateSosButton = document.querySelector('[data-action="simulate-sos"]');
const simulateFallButton = document.querySelector('[data-action="simulate-fall"]');
const simulateScreamButton = document.querySelector('[data-action="simulate-scream"]');

let hardwareUnsubscribe = null;
let alertUnsubscribe = null;
let latestHardwareAlertSignature = "";
let currentChildProfile = null;

function setLoadingState(isLoading) {
  if (!loadingOverlay) {
    return;
  }

  loadingOverlay.hidden = !isLoading;
  loadingOverlay.setAttribute("aria-hidden", String(!isLoading));
}

function showToast(message, type = "info") {
  if (!toastRegion || !toastTemplate) {
    return;
  }

  const toastNode = toastTemplate.content.firstElementChild.cloneNode(true);
  toastNode.dataset.toastType = type;
  toastNode.className = `toast toast-${type}`;
  const messageField = toastNode.querySelector('[data-field="message"]');

  if (messageField) {
    messageField.textContent = message;
  }

  toastRegion.appendChild(toastNode);
  window.setTimeout(() => {
    toastNode.remove();
  }, 3000);
}

function updateNetworkStatus() {
  const isOnline = navigator.onLine;

  if (statusText) {
    statusText.textContent = isOnline ? "Online" : "Offline";
  }

  if (connectionStatus) {
    connectionStatus.textContent = isOnline ? "Connected" : "Disconnected";
  }
}

function formatLocation(location) {
  if (!location || location.lat === undefined || location.lng === undefined) {
    return "Location unavailable";
  }

  return `${location.lat}, ${location.lng}`;
}

function renderAlertHistory(alerts) {
  if (!alertList) {
    return;
  }

  if (!alerts.length) {
    alertList.innerHTML = `
      <article class="alert-card">
        <header class="alert-card-header">
          <h3>No Active Hardware Alerts</h3>
          <span class="alert-status is-resolved">Safe</span>
        </header>
        <p><strong>Time:</strong> Waiting for device updates</p>
        <p><strong>Location:</strong> Device and app alerts will appear here.</p>
      </article>
    `;
    return;
  }

  alertList.innerHTML = alerts
    .map((alert) => {
      const statusClass =
        alert.status === "active"
          ? "is-active"
          : alert.status === "acknowledged"
            ? "is-acknowledged"
            : "is-resolved";

      return `
        <article class="alert-card" data-alert-id="${alert.alertId}">
          <header class="alert-card-header">
            <h3>${String(alert.type || "alert").toUpperCase()} Alert</h3>
            <span class="alert-status ${statusClass}">${alert.status || "active"}</span>
          </header>
          <p><strong>Time:</strong> ${new Date(alert.createdAt).toLocaleString()}</p>
          <p><strong>Location:</strong> ${formatLocation(alert.location)}</p>
          <p><strong>Source:</strong> ${alert.source || "hardware"}</p>
        </article>
      `;
    })
    .join("");
}

function updateHardwareUI(deviceSnapshot) {
  if (deviceStatus) {
    deviceStatus.textContent = deviceSnapshot.isOnline ? "Hardware Connected" : "Hardware Offline";
  }

  if (batteryLevel) {
    batteryLevel.textContent =
      deviceSnapshot.battery === null || deviceSnapshot.battery === undefined
        ? "Unknown"
        : `${deviceSnapshot.battery}%`;
  }

  if (locationStatus) {
    locationStatus.textContent = deviceSnapshot.isOnline
      ? "Live hardware location"
      : "Waiting for hardware GPS";
  }

  if (locationDisplay) {
    locationDisplay.textContent = formatLocation(deviceSnapshot.location);
  }

  if (lastSync && deviceSnapshot.lastSeen) {
    lastSync.textContent = new Date(deviceSnapshot.lastSeen).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  if (deviceBindingStatus && deviceSnapshot.deviceId) {
    deviceBindingStatus.textContent = deviceSnapshot.isOnline
      ? `Bound to ${deviceSnapshot.deviceId} • hardware online`
      : `Bound to ${deviceSnapshot.deviceId} • waiting for hardware`;
  }
}

function wireHardware(user) {
  hardwareUnsubscribe?.();
  alertUnsubscribe?.();

  hardwareUnsubscribe = listenToChildHardware(user, (snapshot) => {
    updateHardwareUI(snapshot);
  });

  alertUnsubscribe = listenToChildAlerts(user.userId, (alerts) => {
    renderAlertHistory(alerts);

    const activeAlerts = alerts.filter((alert) => alert.status === "active");
    const currentSignature = activeAlerts.map((alert) => `${alert.alertId}:${alert.createdAt}`).join("|");

    if (activeAlerts.length && currentSignature !== latestHardwareAlertSignature) {
      const newestAlert = activeAlerts[0];
      showToast(
        `${String(newestAlert.type || "emergency").toUpperCase()} alert detected from hardware.`,
        "error"
      );
    }

    latestHardwareAlertSignature = currentSignature;
  });
}

function openAppShell() {
  document.body.classList.remove("auth-locked");
  document.body.classList.add("auth-ready");
  authScreen?.setAttribute("hidden", "");
  appShellNodes.forEach((node) => node.removeAttribute("hidden"));
}

function closeAppShell() {
  document.body.classList.add("auth-locked");
  document.body.classList.remove("auth-ready");
  authScreen?.removeAttribute("hidden");
  appShellNodes.forEach((node) => node.setAttribute("hidden", ""));
  hardwareUnsubscribe?.();
  alertUnsubscribe?.();
  latestHardwareAlertSignature = "";
  currentChildProfile = null;
}

function updateProfileUI(user) {
  if (!user) {
    return;
  }

  const displayName = user.name || user.displayName || "SafetyNet Child";
  const displayRole = user.role || "Child Account";
  const initials = displayName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "SC";

  if (profileName) {
    profileName.textContent = displayName;
  }

  if (profileRole) {
    profileRole.textContent = displayRole === "child" ? "Child Account" : displayRole;
  }

  if (profileAvatar) {
    profileAvatar.textContent = initials;
  }

  if (profileCard) {
    profileCard.innerHTML = `
      <h3>${displayName}</h3>
      <p>Email: ${user.email || "Not available"}</p>
      <p>Phone: ${user.phone || "Not available"}</p>
      <p>Primary safety mode: SOS + guardian alerts</p>
      <button type="button" data-action="open-settings">Open Settings</button>
    `;
  }

  if (deviceIdInput) {
    deviceIdInput.value = user.deviceId || "child-001";
  }

  if (deviceBindingStatus) {
    deviceBindingStatus.textContent = user.deviceId
      ? `Bound to device ${user.deviceId}`
      : "No device bound yet.";
  }
}

function setAuthMessage(message, type = "info") {
  if (!authMessage) {
    return;
  }

  authMessage.textContent = message;
  authMessage.classList.remove("text-danger", "text-success", "text-primary");

  if (type === "error") {
    authMessage.classList.add("text-danger");
  } else if (type === "success") {
    authMessage.classList.add("text-success");
  } else {
    authMessage.classList.add("text-primary");
  }
}

function setActiveAuthTab(tabName) {
  tabButtons.forEach((button) => {
    const isActive = button.dataset.authTab === tabName;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });

  tabPanels.forEach((panel) => {
    const isActive = panel.dataset.authPanel === tabName;
    panel.classList.toggle("is-active", isActive);
    panel.hidden = !isActive;
  });
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  const formData = new FormData(loginForm);
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");

  setLoadingState(true);

  try {
    const user = await signIn(email, password);
    updateProfileUI(user);
    setAuthMessage("Signed in successfully.", "success");
    showToast("Welcome back to SafetyNet Child.", "success");
  } catch (error) {
    setAuthMessage(error.message, "error");
    showToast(error.message, "error");
  } finally {
    setLoadingState(false);
  }
}

async function handleSignupSubmit(event) {
  event.preventDefault();
  const formData = new FormData(signupForm);
  const name = String(formData.get("name") || "").trim();
  const phone = String(formData.get("phone") || "").trim();
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");

  setLoadingState(true);

  try {
    const user = await signUp(email, password, name, phone);
    updateProfileUI(user);
    setAuthMessage("Account created successfully.", "success");
    showToast("Your child account is ready.", "success");
  } catch (error) {
    setAuthMessage(error.message, "error");
    showToast(error.message, "error");
  } finally {
    setLoadingState(false);
  }
}

async function handlePasswordReset() {
  const emailInput = document.getElementById("auth-login-email");
  const email = emailInput?.value?.trim();

  if (!email) {
    const message = "Enter your email address first, then try password reset.";
    setAuthMessage(message, "error");
    showToast(message, "error");
    return;
  }

  setLoadingState(true);

  try {
    await sendPasswordReset(email);
    setAuthMessage("Password reset email sent.", "success");
    showToast("Password reset email sent.", "success");
  } catch (error) {
    setAuthMessage(error.message, "error");
    showToast(error.message, "error");
  } finally {
    setLoadingState(false);
  }
}

async function handleLogout() {
  setLoadingState(true);

  try {
    await signOut();
    setActiveAuthTab("login");
    setAuthMessage("You have been signed out.", "info");
    showToast("Signed out successfully.", "info");
  } catch (error) {
    showToast(error.message || "Unable to sign out right now.", "error");
  } finally {
    setLoadingState(false);
  }
}

async function handleDeviceBindingSubmit(event) {
  event.preventDefault();
  const deviceId = deviceIdInput?.value?.trim();

  if (!currentChildProfile?.userId || !deviceId) {
    showToast("Enter a valid device ID first.", "error");
    return;
  }

  setLoadingState(true);
  try {
    const updatedProfile = await updateChildDeviceBinding(currentChildProfile.userId, deviceId);
    currentChildProfile = { ...currentChildProfile, ...updatedProfile };
    updateProfileUI(currentChildProfile);
    wireHardware(currentChildProfile);
    showToast(`Device ${deviceId} bound successfully.`, "success");
  } catch (error) {
    showToast(error.message || "Unable to bind device right now.", "error");
  } finally {
    setLoadingState(false);
  }
}

async function runHardwareSimulation(task, successMessage) {
  if (!currentChildProfile?.userId) {
    showToast("Sign in first before running hardware simulator actions.", "error");
    return;
  }

  setLoadingState(true);
  try {
    await task();
    if (hardwareTestStatus) {
      hardwareTestStatus.textContent = successMessage;
    }
    showToast(successMessage, "success");
  } catch (error) {
    const message = error.message || "Hardware simulator action failed.";
    if (hardwareTestStatus) {
      hardwareTestStatus.textContent = message;
    }
    showToast(message, "error");
  } finally {
    setLoadingState(false);
  }
}

function updateAuthState(user) {
  if (user) {
    currentChildProfile = user;
    openAppShell();
    updateProfileUI(user);
    wireHardware(user);

    if (lastSync) {
      lastSync.textContent = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
      });
    }

    return;
  }

  closeAppShell();
}

function initAuthTabs() {
  tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setActiveAuthTab(button.dataset.authTab);
      setAuthMessage("Use your child account email and password to enter the app.", "info");
    });
  });
}

function initApp() {
  closeAppShell();
  setActiveAuthTab("login");
  updateNetworkStatus();

  window.addEventListener("online", updateNetworkStatus);
  window.addEventListener("offline", updateNetworkStatus);

  loginForm?.addEventListener("submit", handleLoginSubmit);
  signupForm?.addEventListener("submit", handleSignupSubmit);
  forgotPasswordButton?.addEventListener("click", handlePasswordReset);
  logoutButton?.addEventListener("click", handleLogout);
  deviceForm?.addEventListener("submit", handleDeviceBindingSubmit);
  simulateHeartbeatButton?.addEventListener("click", () =>
    runHardwareSimulation(
      () => writeMockDeviceStatus(currentChildProfile),
      "Heartbeat sent. Hardware status updated in Firebase."
    )
  );
  simulateSosButton?.addEventListener("click", () =>
    runHardwareSimulation(
      () => triggerMockHardwareAlert(currentChildProfile, "sos"),
      "Test SOS alert sent from simulated hardware."
    )
  );
  simulateFallButton?.addEventListener("click", () =>
    runHardwareSimulation(
      () => triggerMockHardwareAlert(currentChildProfile, "fall"),
      "Test fall alert sent from simulated hardware."
    )
  );
  simulateScreamButton?.addEventListener("click", () =>
    runHardwareSimulation(
      () => triggerMockHardwareAlert(currentChildProfile, "scream"),
      "Test scream alert sent from simulated hardware."
    )
  );

  initAuthTabs();
  initChildLinkingModule({
    showToast,
    setLoading: setLoadingState
  });

  initAuthObserver((user) => {
    updateAuthState(user);
  });

  const existingUser = getCurrentUser();
  if (existingUser) {
    updateAuthState(existingUser);
  }
}

initApp();
