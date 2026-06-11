import { APP_CONFIG, COLLECTIONS } from "./config.js";
import { db, getCurrentUser } from "./auth.js";
import { get, ref, set, update } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const LINK_MODAL_NAME = "link-parent";

const state = {
  scanner: null,
  scannerActive: false,
  activeTab: "scan",
  activeRequest: null,
  showToast: () => {},
  setLoading: () => {}
};

function getElements() {
  return {
    modal: document.querySelector(`[data-modal="${LINK_MODAL_NAME}"]`),
    openButton: document.querySelector('[data-action="open-link-parent"]'),
    closeButton: document.querySelector('[data-action="close-link-parent"]'),
    tabButtons: document.querySelectorAll("[data-child-linking-tab]"),
    tabPanels: document.querySelectorAll("[data-child-linking-panel]"),
    qrReader: document.getElementById("child-parent-qr-reader"),
    scannerOverlay: document.querySelector("[data-child-scanner-overlay]"),
    status: document.querySelector("[data-child-linking-status]"),
    otpInputs: document.querySelectorAll(".child-otp-input"),
    verifyOtpButton: document.querySelector('[data-action="verify-parent-link-otp"]'),
    regenerateButton: document.querySelector('[data-action="regenerate-child-link-code"]'),
    qrContainer: document.querySelector("[data-child-link-qr-code]"),
    codeValue: document.querySelector("[data-child-link-code]"),
    expiryValue: document.querySelector("[data-child-link-expiry]"),
    parentList: document.querySelector("[data-parent-list]")
  };
}

function generateRequestId(prefix = "link") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function generateOtp() {
  return Array.from({ length: APP_CONFIG.linking.otpLength }, () => Math.floor(Math.random() * 10)).join("");
}

function parseParentQRCode(rawValue) {
  try {
    const parsed = JSON.parse(rawValue);
    if (!parsed?.code || !parsed?.parentId || !parsed?.parentName) {
      throw new Error("invalid-format");
    }
    return parsed;
  } catch {
    const error = new Error("Invalid QR code format");
    error.code = "invalid-format";
    throw error;
  }
}

async function findActiveRequestByOtp(otp) {
  const snapshot = await get(ref(db, COLLECTIONS.LINK_REQUESTS));
  if (!snapshot.exists()) {
    return null;
  }

  const now = Date.now();
  return (
    Object.entries(snapshot.val())
      .map(([requestId, value]) => ({ requestId, ...value }))
      .find(
        (request) =>
          request.otp === otp && request.status === "pending" && (!request.expiresAt || request.expiresAt > now)
      ) || null
  );
}

async function createChildLinkingRequest() {
  const currentUser = getCurrentUser();
  if (!currentUser) {
    throw new Error("Sign in before linking a parent.");
  }

  const userSnapshot = await get(ref(db, `${COLLECTIONS.USERS}/${currentUser.uid}`));
  const profile = userSnapshot.exists() ? userSnapshot.val() : {};
  const requestId = generateRequestId("child");
  const createdAt = Date.now();
  const expiresAt = createdAt + APP_CONFIG.linking.requestExpiryMs;
  const otp = generateOtp();
  const requestPayload = {
    requestId,
    code: otp,
    otp,
    childUid: currentUser.uid,
    childId: currentUser.uid,
    childName: profile.name || currentUser.displayName || currentUser.email || "Child",
    initiatorRole: "child",
    status: "pending",
    createdAt,
    expiresAt
  };

  await set(ref(db, `${COLLECTIONS.LINK_REQUESTS}/${requestId}`), requestPayload);
  state.activeRequest = requestPayload;
  renderChildLinkCode(requestPayload);
  return requestPayload;
}

function renderChildLinkCode(request) {
  const { qrContainer, codeValue, expiryValue, status } = getElements();
  const payload = JSON.stringify({
    code: request.code,
    childId: request.childUid,
    childName: request.childName,
    requestId: request.requestId,
    timestamp: request.createdAt,
    expiresAt: request.expiresAt
  });

  if (qrContainer && window.QRCode) {
    qrContainer.innerHTML = "";
    new window.QRCode(qrContainer, {
      text: payload,
      width: 220,
      height: 220,
      colorDark: "#0f5aa9",
      colorLight: "#ffffff",
      correctLevel: window.QRCode.CorrectLevel.M
    });
  }

  if (codeValue) {
    codeValue.textContent = request.code;
  }

  if (expiryValue) {
    expiryValue.textContent = new Date(request.expiresAt).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  if (status) {
    status.textContent = "Show this code to your parent or let them scan the QR code.";
    status.dataset.state = "ready";
  }
}

function mapError(error) {
  const code = error?.code || error?.message;
  const messages = {
    "invalid-code": "The code is invalid or has expired.",
    "code-expired": "This code has expired. Please generate a new one.",
    "wrong-direction": "This code must be used from the parent app.",
    "invalid-format": "This QR code is not a valid SafetyNet parent link."
  };

  return {
    code,
    message: messages[code] || error?.message || "Unable to link parent right now."
  };
}

function updateScannerOverlay(stateName) {
  const { scannerOverlay } = getElements();
  if (!scannerOverlay) {
    return;
  }

  scannerOverlay.dataset.scannerState = stateName;
  const labels = {
    scanning: "Scanning for a parent QR code…",
    found: "Parent QR detected. Verifying…",
    verifying: "Verifying parent code…",
    success: "Parent linked successfully.",
    error: "Unable to verify parent QR code."
  };
  scannerOverlay.textContent = labels[stateName] || labels.scanning;
}

async function requestCameraPermission() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
      audio: false
    });
    stream.getTracks().forEach((track) => track.stop());
    return true;
  } catch {
    state.showToast(
      "Camera access is required to scan parent QR codes. Please enable it or use the OTP tab instead.",
      "error"
    );
    return false;
  }
}

async function verifyParentCode(code) {
  const currentUser = getCurrentUser();
  if (!currentUser) {
    throw new Error("Sign in before linking a parent.");
  }

  const request = await findActiveRequestByOtp(code);
  if (!request) {
    const error = new Error("Invalid code");
    error.code = "invalid-code";
    throw error;
  }

  if (request.initiatorRole !== "parent") {
    const error = new Error("This code must be used from the parent app.");
    error.code = "wrong-direction";
    throw error;
  }

  const userSnapshot = await get(ref(db, `${COLLECTIONS.USERS}/${currentUser.uid}`));
  const profile = userSnapshot.exists() ? userSnapshot.val() : {};
  const linkedAt = Date.now();

  await Promise.all([
    update(ref(db, `${COLLECTIONS.RELATIONSHIPS}/${currentUser.uid}/${request.parentUid}`), {
      status: "linked",
      linkedAt,
      linkedBy: currentUser.uid,
      linkedVia: "child-app"
    }),
    update(ref(db, `${COLLECTIONS.LINK_REQUESTS}/${request.requestId}`), {
      status: "linked",
      linkedAt,
      childUid: currentUser.uid,
      childName: profile.name || currentUser.displayName || currentUser.email || "Child"
    }),
    update(ref(db, `${COLLECTIONS.CHILDREN}/${currentUser.uid}`), {
      updatedAt: linkedAt,
      parentLinkedAt: linkedAt
    }).catch(() => null)
  ]);

  return {
    parentId: request.parentUid,
    parentName: request.parentName || "Parent",
    linkedAt
  };
}

async function stopQRScanner() {
  if (!state.scanner || !state.scannerActive) {
    return;
  }

  try {
    await state.scanner.stop();
    await state.scanner.clear();
  } catch {
    // Ignore cleanup failures.
  } finally {
    state.scannerActive = false;
  }
}

async function initQRScanner() {
  const { qrReader, status } = getElements();

  if (!qrReader || !window.Html5Qrcode) {
    return;
  }

  if (state.scannerActive) {
    return;
  }

  const hasPermission = await requestCameraPermission();
  if (!hasPermission) {
    return;
  }

  if (!state.scanner) {
    state.scanner = new window.Html5Qrcode(qrReader.id);
  }

  const qrCodeSuccessCallback = async (decodedText) => {
    updateScannerOverlay("found");
    try {
      const parsed = parseParentQRCode(decodedText);
      await stopQRScanner();
      updateScannerOverlay("verifying");
      const result = await verifyParentCode(parsed.code);
      handleLinkingSuccess(result.parentName);
    } catch (error) {
      const mappedError = mapError(error);
      if (status) {
        status.textContent = mappedError.message;
        status.dataset.state = "error";
      }
      updateScannerOverlay("error");
      state.showToast(mappedError.message, "error");
    }
  };

  await state.scanner.start(
    { facingMode: "environment" },
    { fps: 10, qrbox: { width: 250, height: 250 } },
    qrCodeSuccessCallback
  );
  state.scannerActive = true;
  updateScannerOverlay("scanning");
}

function clearOTPInputs() {
  const { otpInputs } = getElements();
  otpInputs.forEach((input, index) => {
    input.value = "";
    input.classList.remove("is-error");
    if (index === 0) {
      input.focus();
    }
  });
}

function getOTPValue() {
  const { otpInputs } = getElements();
  const otp = Array.from(otpInputs)
    .map((input) => input.value.trim())
    .join("");

  return /^\d{6}$/.test(otp) ? otp : null;
}

async function verifyOTP() {
  const { status, otpInputs } = getElements();
  const otp = getOTPValue();

  if (!otp) {
    otpInputs.forEach((input) => input.classList.add("is-error"));
    state.showToast("Enter the full 6-digit parent code first.", "error");
    return;
  }

  state.setLoading(true);
  try {
    const result = await verifyParentCode(otp);
    handleLinkingSuccess(result.parentName);
  } catch (error) {
    const mappedError = mapError(error);
    otpInputs.forEach((input) => input.classList.add("is-error"));
    if (status) {
      status.textContent = mappedError.message;
      status.dataset.state = "error";
    }
    state.showToast(mappedError.message, "error");
  } finally {
    state.setLoading(false);
  }
}

function setupOTPInput() {
  const { otpInputs, verifyOtpButton } = getElements();

  otpInputs.forEach((input, index) => {
    input.addEventListener("input", (event) => {
      event.target.value = event.target.value.replace(/\D/g, "").slice(0, 1);
      event.target.classList.remove("is-error");

      if (event.target.value && index < otpInputs.length - 1) {
        otpInputs[index + 1].focus();
      }

      if (index === otpInputs.length - 1 && event.target.value && getOTPValue()) {
        verifyOTP();
      }
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Backspace" && !event.target.value && index > 0) {
        otpInputs[index - 1].focus();
      }
    });
  });

  verifyOtpButton?.addEventListener("click", () => verifyOTP());
}

async function switchLinkingTab(tab) {
  const { tabButtons, tabPanels, otpInputs, status } = getElements();
  state.activeTab = tab;

  tabButtons.forEach((button) => {
    const active = button.dataset.childLinkingTab === tab;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });

  tabPanels.forEach((panel) => {
    panel.hidden = panel.dataset.childLinkingPanel !== tab;
  });

  if (status) {
    status.textContent = "";
    status.dataset.state = "idle";
  }

  if (tab === "scan") {
    await initQRScanner();
    return;
  }

  await stopQRScanner();

  if (tab === "otp") {
    otpInputs[0]?.focus();
    return;
  }

  await createChildLinkingRequest();
}

function handleLinkingSuccess(parentName) {
  const { modal, parentList, status } = getElements();

  if (status) {
    status.textContent = `Successfully linked to ${parentName}.`;
    status.dataset.state = "success";
  }

  if (parentList && !parentList.querySelector(`[data-linked-parent="${parentName}"]`)) {
    const card = document.createElement("article");
    card.className = "parent-card";
    card.dataset.linkedParent = parentName;
    card.innerHTML = `
      <div>
        <h3>${parentName}</h3>
        <p>Linked just now</p>
      </div>
      <button type="button" data-action="remove-parent">Remove</button>
    `;
    parentList.prepend(card);
  }

  state.showToast(`Successfully linked to ${parentName}!`, "success");
  clearOTPInputs();
  stopQRScanner();
  modal?.close();
}

function openLinkParentModal() {
  const { modal } = getElements();
  modal?.showModal();
  clearOTPInputs();
  switchLinkingTab("scan");
}

function initChildLinkingModule({ showToast, setLoading } = {}) {
  state.showToast = showToast || state.showToast;
  state.setLoading = setLoading || state.setLoading;

  const { openButton, closeButton, tabButtons, regenerateButton, modal } = getElements();

  openButton?.addEventListener("click", openLinkParentModal);
  closeButton?.addEventListener("click", () => {
    stopQRScanner();
    modal?.close();
  });

  regenerateButton?.addEventListener("click", async () => {
    await createChildLinkingRequest();
    state.showToast("New child linking code generated.", "info");
  });

  tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      switchLinkingTab(button.dataset.childLinkingTab);
    });
  });

  modal?.addEventListener("close", () => {
    stopQRScanner();
  });

  setupOTPInput();
}

export { clearOTPInputs, initChildLinkingModule, initQRScanner, setupOTPInput, stopQRScanner, switchLinkingTab, verifyOTP };
