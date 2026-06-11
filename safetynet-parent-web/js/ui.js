import { formatAlertStatus, formatAlertType, formatTimestamp } from "./alerts.js";

const uiState = {
  toastRegion: null,
  toastTemplate: null
};

function initUIHelpers({ toastRegion, toastTemplate } = {}) {
  uiState.toastRegion = toastRegion || uiState.toastRegion;
  uiState.toastTemplate = toastTemplate || uiState.toastTemplate;
}

function createToast(region, template, message, type = "info") {
  if (!region || !template) {
    return;
  }

  const node = template.content.firstElementChild.cloneNode(true);
  node.className = `toast toast--${type}`;
  node.dataset.toastType = type;
  node.querySelector('[data-field="message"]').textContent = message;
  region.appendChild(node);
  window.setTimeout(() => node.remove(), 3200);
}

function showToast(message, type = "info") {
  createToast(uiState.toastRegion, uiState.toastTemplate, message, type);
}

function setLoading(overlay, isLoading) {
  if (!overlay) {
    return;
  }

  overlay.hidden = !isLoading;
  overlay.setAttribute("aria-hidden", String(!isLoading));
  overlay.style.display = isLoading ? "grid" : "none";
}

function showModal(target) {
  const modal = typeof target === "string" ? document.querySelector(`[data-modal="${target}"]`) : target;
  if (modal?.showModal) {
    modal.showModal();
  }
}

function closeModal(target) {
  const modal = typeof target === "string" ? document.querySelector(`[data-modal="${target}"]`) : target;
  if (modal?.open) {
    modal.close();
  }
}

function setAuthMode(authScreen, appShellNodes, authenticated) {
  document.body.classList.toggle("auth-locked", !authenticated);
  document.body.classList.toggle("auth-ready", authenticated);

  if (authenticated) {
    authScreen?.setAttribute("hidden", "");
    appShellNodes.forEach((node) => node.removeAttribute("hidden"));
    return;
  }

  authScreen?.removeAttribute("hidden");
  appShellNodes.forEach((node) => node.setAttribute("hidden", ""));
}

function setActiveAuthTab(tabButtons, tabPanels, tabName) {
  tabButtons.forEach((button) => {
    const active = button.dataset.authTab === tabName;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });

  tabPanels.forEach((panel) => {
    const active = panel.dataset.authPanel === tabName;
    panel.hidden = !active;
  });
}

function renderChildren(container, template, children) {
  container.innerHTML = "";
  if (!children.length) {
    container.innerHTML = '<p class="empty-state">No linked children yet.</p>';
    return;
  }

  children.forEach((child) => {
    const node = template.content.firstElementChild.cloneNode(true);
    node.querySelector('[data-field="name"]').textContent = child.name || "Unnamed Child";
    node.querySelector('[data-field="email"]').textContent = child.email || "No email available";
    node.querySelector('[data-field="location"]').textContent = child.location
      ? `${child.location.lat}, ${child.location.lng}`
      : "Location unavailable";
    node.querySelector('[data-field="device"]').textContent = child.device
      ? `Battery ${child.device.battery ?? "--"}%`
      : "Device Unknown";
    const statusField = node.querySelector('[data-field="status"]');
    const statusLabel = child.isActive === false ? "Offline" : child.lastKnownStatus || "Safe";
    statusField.textContent = statusLabel;
    statusField.className = `badge ${child.isActive === false ? "badge--warning" : "badge--success"}`;
    container.appendChild(node);
  });
}

function renderAlerts(container, template, alerts, onAcknowledge, onResolve) {
  container.innerHTML = "";
  if (!alerts.length) {
    container.innerHTML = '<p class="empty-state">No alerts yet. Linked child alerts appear here instantly.</p>';
    return;
  }

  alerts.forEach((alert) => {
    const node = template.content.firstElementChild.cloneNode(true);
    node.querySelector('[data-field="child"]').textContent = alert.childName || alert.childUid || "Linked Child";
    node.querySelector('[data-field="type"]').textContent = formatAlertType(alert.type);
    node.querySelector('[data-field="status"]').textContent = formatAlertStatus(alert.status);
    node.querySelector('[data-field="status"]').className = `badge ${
      alert.status === "active" ? "badge--danger" : alert.status === "resolved" ? "badge--success" : "badge--info"
    }`;
    node.querySelector('[data-field="time"]').textContent = formatTimestamp(alert.createdAt);
    node.querySelector('[data-field="location"]').textContent = alert.locationText || "Location unavailable";
    node.querySelector('[data-action="acknowledge-alert"]').addEventListener("click", () => onAcknowledge(alert));
    node.querySelector('[data-action="resolve-alert"]').addEventListener("click", () => onResolve(alert));
    container.appendChild(node);
  });
}

function renderHistory(container, template, alerts) {
  container.innerHTML = "";
  if (!alerts.length) {
    container.innerHTML = '<p class="empty-state">No alert history available yet.</p>';
    return;
  }

  alerts.forEach((alert) => {
    const node = template.content.firstElementChild.cloneNode(true);
    node.querySelector('[data-field="child"]').textContent = alert.childName || alert.childUid || "Linked Child";
    node.querySelector('[data-field="type"]').textContent = formatAlertType(alert.type);
    node.querySelector('[data-field="status"]').textContent = formatAlertStatus(alert.status);
    node.querySelector('[data-field="time"]').textContent = formatTimestamp(alert.createdAt);
    container.appendChild(node);
  });
}

export {
  closeModal,
  createToast,
  initUIHelpers,
  renderAlerts,
  renderChildren,
  renderHistory,
  setActiveAuthTab,
  setAuthMode,
  setLoading,
  showModal,
  showToast
};
