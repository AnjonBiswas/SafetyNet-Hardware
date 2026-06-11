const ALERT_LABELS = {
  sos: "SOS Alert",
  fall: "Fall Alert",
  scream: "Scream Alert",
  manual: "Manual Alert"
};

const STATUS_LABELS = {
  active: "Active",
  acknowledged: "Acknowledged",
  resolved: "Resolved",
  cancelled: "Cancelled"
};

function formatAlertType(type) {
  return ALERT_LABELS[type] || "Emergency Alert";
}

function formatAlertStatus(status) {
  return STATUS_LABELS[status] || "Unknown";
}

function formatTimestamp(value) {
  if (!value) {
    return "Unknown time";
  }

  return new Date(value).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function playAlertTone() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    return;
  }

  const context = new AudioContextClass();
  const oscillator = context.createOscillator();
  const gainNode = context.createGain();

  oscillator.type = "sine";
  oscillator.frequency.value = 880;
  gainNode.gain.value = 0.04;

  oscillator.connect(gainNode);
  gainNode.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.25);
}

export { formatAlertStatus, formatAlertType, formatTimestamp, playAlertTone };
