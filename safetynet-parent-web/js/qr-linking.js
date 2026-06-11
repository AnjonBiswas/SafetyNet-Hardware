import { createParentLinkingRequest, verifyLinkingCode } from "./realtime-db.js";
import { getCurrentUser } from "./auth.js";
import { closeModal, showModal, showToast } from "./ui.js";

const LINK_MODAL_NAME = "link-child";

const linkingState = {
  scanner: null,
  scannerActive: false,
  activeTab: "qr",
  activeRequest: null,
  onSuccess: null
};

function getElements() {
  return {
    modal: document.querySelector(`[data-modal="${LINK_MODAL_NAME}"]`),
    qrReader: document.getElementById("parent-qr-reader"),
    qrCanvas: document.querySelector("[data-parent-qr-code]"),
    qrCodeValue: document.querySelector("[data-parent-link-code]"),
    qrExpires: document.querySelector("[data-parent-link-expiry]"),
    qrInstructions: document.querySelector("[data-qr-instructions]"),
    otpInstructions: document.querySelector("[data-otp-instructions]"),
    overlay: document.querySelector("[data-scanner-overlay]"),
    linkingStatus: document.querySelector("[data-linking-status]"),
    scanToggleButton: document.querySelector('[data-action="toggle-child-scanner"]'),
    tabButtons: document.querySelectorAll("[data-linking-tab]"),
    tabPanels: document.querySelectorAll("[data-linking-panel]"),
    otpInputs: document.querySelectorAll(".otp-input"),
    openButtons: document.querySelectorAll('[data-action="open-link-child"]'),
    regenerateButton: document.querySelector('[data-action="regenerate-parent-code"]'),
    verifyOtpButton: document.querySelector('[data-action="verify-parent-otp"]'),
    closeButtons: document.querySelectorAll('[data-action="close-link-child"]')
  };
}

function parseQRCode(qrData) {
  let parsed;

  try {
    parsed = JSON.parse(qrData);
  } catch {
    const error = new Error("Invalid QR code format");
    error.code = "invalid-format";
    throw error;
  }

  if (!parsed?.code || !parsed?.childId || !parsed?.childName) {
    const error = new Error("Invalid QR code format");
    error.code = "invalid-format";
    throw error;
  }

  return parsed;
}

function checkCameraPermission() {
  if (!navigator.permissions?.query) {
    return Promise.resolve(false);
  }

  return navigator.permissions
    .query({ name: "camera" })
    .then((result) => result.state === "granted")
    .catch(() => false);
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
    showToast(
      "Camera access is required to scan QR codes. Please enable it in your browser settings or use OTP instead.",
      "error"
    );
    return false;
  }
}

function updateScannerOverlay(state) {
  const { overlay } = getElements();
  if (!overlay) {
    return;
  }

  overlay.dataset.scannerState = state;
  const labels = {
    scanning: "Scanning for a child QR code…",
    found: "QR code detected. Validating…",
    verifying: "Verifying link request…",
    success: "Child linked successfully.",
    error: "Unable to verify this QR code."
  };

  overlay.textContent = labels[state] || labels.scanning;
}

function showQRScannerInstructions() {
  const { qrInstructions } = getElements();
  if (qrInstructions) {
    qrInstructions.textContent =
      "Ask your child to show the QR code from their SafetyNet Child app, then point your camera at it.";
  }
}

function showOTPInstructions() {
  const { otpInstructions } = getElements();
  if (otpInstructions) {
    otpInstructions.textContent =
      "Ask your child for the 6-digit code from their app. Codes expire in 5 minutes.";
  }
}

function mapLinkingError(error) {
  const normalizedCode = error?.code || error?.message;
  const messageMap = {
    "invalid-code": "The code is invalid or has expired.",
    "code-already-used": "This code has already been used.",
    "code-expired": "This code has expired. Please generate a new one.",
    "network-error": "Network error. Please check your connection.",
    "wrong-direction": "This code must be scanned from the child app."
  };

  return {
    code: normalizedCode,
    message: messageMap[normalizedCode] || error?.message || "Unable to link child right now."
  };
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

function handleLinkingSuccess(childData) {
  stopQRScanner();
  clearOTPInputs();
  closeModal(LINK_MODAL_NAME);
  showToast(`Successfully linked to ${childData.childName}!`, "success");
  linkingState.onSuccess?.(childData);
  window.dispatchEvent(new CustomEvent("parent-linking:success", { detail: childData }));
}

function handleLinkingError(error) {
  const mappedError = mapLinkingError(error);
  const { linkingStatus, otpInputs } = getElements();

  if (linkingStatus) {
    linkingStatus.textContent = mappedError.message;
    linkingStatus.dataset.state = "error";
  }

  otpInputs.forEach((input) => input.classList.add("is-error"));
  updateScannerOverlay("error");
  showToast(mappedError.message, "error");
  console.error("Linking error:", error);
}

async function verifyOTP() {
  const otp = getOTPValue();
  const currentUser = getCurrentUser();

  if (!otp || !currentUser) {
    handleLinkingError({ code: "invalid-code" });
    return null;
  }

  const { linkingStatus } = getElements();
  if (linkingStatus) {
    linkingStatus.textContent = "Verifying code…";
    linkingStatus.dataset.state = "verifying";
  }

  try {
    const result = await verifyLinkingCode(otp, currentUser.uid);
    handleLinkingSuccess(result);
    return result;
  } catch (error) {
    handleLinkingError(error);
    return null;
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

      if (index === otpInputs.length - 1 && event.target.value) {
        const completeOtp = getOTPValue();
        if (completeOtp) {
          verifyOTP();
        }
      }
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Backspace" && !event.target.value && index > 0) {
        otpInputs[index - 1].focus();
      }
    });
  });

  verifyOtpButton?.addEventListener("click", () => {
    verifyOTP();
  });
}

async function stopQRScanner() {
  if (!linkingState.scanner || !linkingState.scannerActive) {
    return;
  }

  try {
    await linkingState.scanner.stop();
    await linkingState.scanner.clear();
  } catch {
    // Scanner cleanup should not block UI recovery.
  } finally {
    linkingState.scannerActive = false;
    updateScannerOverlay("scanning");
  }
}

async function initQRScanner() {
  const { qrReader, linkingStatus } = getElements();
  const currentUser = getCurrentUser();

  if (!qrReader || !currentUser) {
    return () => {};
  }

  if (linkingState.scannerActive) {
    return () => stopQRScanner();
  }

  const hasPermission = (await checkCameraPermission()) || (await requestCameraPermission());
  if (!hasPermission) {
    return () => {};
  }

  if (!window.Html5Qrcode) {
    handleLinkingError({ message: "QR scanner library is not available.", code: "scanner-unavailable" });
    return () => {};
  }

  if (!linkingState.scanner) {
    linkingState.scanner = new window.Html5Qrcode(qrReader.id);
  }

  const qrCodeSuccessCallback = async (decodedText) => {
    updateScannerOverlay("found");

    try {
      const parsed = parseQRCode(decodedText);
      await stopQRScanner();
      updateScannerOverlay("verifying");
      const result = await verifyLinkingCode(parsed.code, currentUser.uid);
      handleLinkingSuccess({
        ...result,
        childId: result.childId || parsed.childId,
        childName: result.childName || parsed.childName
      });
    } catch (error) {
      if (linkingStatus) {
        linkingStatus.textContent = mapLinkingError(error).message;
      }
      handleLinkingError(error);
    }
  };

  const config = { fps: 10, qrbox: { width: 250, height: 250 } };
  await linkingState.scanner.start({ facingMode: "environment" }, config, qrCodeSuccessCallback);
  linkingState.scannerActive = true;
  updateScannerOverlay("scanning");

  return () => stopQRScanner();
}

function renderQRCodePayload(request) {
  const { qrCanvas, qrCodeValue, qrExpires, linkingStatus } = getElements();
  const payload = JSON.stringify({
    code: request.code,
    parentId: request.parentUid,
    parentName: request.parentName,
    requestId: request.requestId,
    timestamp: request.createdAt,
    expiresAt: request.expiresAt
  });

  if (qrCanvas && window.QRCode) {
    qrCanvas.innerHTML = "";
    new window.QRCode(qrCanvas, {
      text: payload,
      width: 220,
      height: 220,
      colorDark: "#0f4f9a",
      colorLight: "#ffffff",
      correctLevel: window.QRCode.CorrectLevel.M
    });
  }

  if (qrCodeValue) {
    qrCodeValue.textContent = request.code;
  }

  if (qrExpires) {
    qrExpires.textContent = new Date(request.expiresAt).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  if (linkingStatus) {
    linkingStatus.textContent = "Show this QR code or OTP to your child.";
    linkingStatus.dataset.state = "ready";
  }
}

async function ensureParentLinkRequest() {
  const currentUser = getCurrentUser();
  if (!currentUser) {
    throw new Error("You need to be signed in to link a child.");
  }

  linkingState.activeRequest = await createParentLinkingRequest({
    userId: currentUser.uid,
    name: currentUser.displayName || currentUser.email || "Parent"
  });

  renderQRCodePayload(linkingState.activeRequest);
  return linkingState.activeRequest;
}

async function switchLinkingTab(tab) {
  const { tabButtons, tabPanels, otpInputs, linkingStatus } = getElements();
  linkingState.activeTab = tab;

  tabButtons.forEach((button) => {
    const active = button.dataset.linkingTab === tab;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });

  tabPanels.forEach((panel) => {
    panel.hidden = panel.dataset.linkingPanel !== tab;
  });

  if (linkingStatus && tab !== "qr") {
    linkingStatus.textContent = "";
    linkingStatus.dataset.state = "idle";
  }

  if (tab === "qr") {
    await stopQRScanner();
    await ensureParentLinkRequest();
    showQRScannerInstructions();
    updateScannerOverlay("scanning");
    return;
  }

  if (tab === "scan") {
    showQRScannerInstructions();
    await initQRScanner();
    return;
  }

  await stopQRScanner();
  showOTPInstructions();
  otpInputs[0]?.focus();
}

async function openLinkingModal(options = {}) {
  linkingState.onSuccess = options.onSuccess || linkingState.onSuccess;
  showModal(LINK_MODAL_NAME);
  clearOTPInputs();
  await switchLinkingTab("qr");
}

function initLinkingModule(options = {}) {
  const { openButtons, regenerateButton, closeButtons, tabButtons, scanToggleButton, modal } = getElements();
  linkingState.onSuccess = options.onSuccess || null;

  openButtons.forEach((button) => {
    button.addEventListener("click", () => {
      openLinkingModal(options);
    });
  });

  regenerateButton?.addEventListener("click", async () => {
    await ensureParentLinkRequest();
    showToast("New parent linking code generated.", "info");
  });

  closeButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      await stopQRScanner();
      closeModal(LINK_MODAL_NAME);
    });
  });

  scanToggleButton?.addEventListener("click", async () => {
    await switchLinkingTab("scan");
  });

  tabButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      await switchLinkingTab(button.dataset.linkingTab);
    });
  });

  modal?.addEventListener("close", () => {
    stopQRScanner();
  });

  setupOTPInput();
}

export {
  clearOTPInputs,
  initLinkingModule,
  initQRScanner,
  openLinkingModal,
  parseQRCode,
  setupOTPInput,
  stopQRScanner,
  switchLinkingTab,
  verifyOTP
};
