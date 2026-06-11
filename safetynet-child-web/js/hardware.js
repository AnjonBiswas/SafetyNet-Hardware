import { ALERT_STATUS, ALERT_TYPES, APP_CONFIG, COLLECTIONS } from "./config.js";
import { db } from "./auth.js";
import { onValue, ref, set, update } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

function normalizeDeviceStatus(deviceSnapshotValue = {}, locationSnapshotValue = null) {
  const location = locationSnapshotValue || deviceSnapshotValue.location || null;
  const lastSeen = deviceSnapshotValue.lastSeen || null;
  const isRecentlyOnline = lastSeen
    ? Date.now() - lastSeen <= APP_CONFIG.hardware.heartbeatTimeoutMs
    : Boolean(deviceSnapshotValue.isOnline);

  return {
    deviceId: deviceSnapshotValue.deviceId || null,
    isOnline: Boolean(deviceSnapshotValue.isOnline ?? isRecentlyOnline),
    lastSeen,
    battery: deviceSnapshotValue.battery ?? deviceSnapshotValue?.sensors?.battery ?? null,
    location,
    sensors: deviceSnapshotValue.sensors || {},
    source: deviceSnapshotValue.source || "hardware"
  };
}

function sortAlerts(alerts) {
  return alerts.sort((left, right) => (right.createdAt || right.timestamp || 0) - (left.createdAt || left.timestamp || 0));
}

function createAlertId(prefix = "alert") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getDeviceId(user) {
  return user?.deviceId || user?.userId || null;
}

function getBaseLocation(user) {
  return user?.lastKnownLocation || { lat: 23.8103, lng: 90.4125 };
}

function createNearbyLocation(location = { lat: 23.8103, lng: 90.4125 }) {
  const latOffset = (Math.random() - 0.5) * 0.01;
  const lngOffset = (Math.random() - 0.5) * 0.01;
  return {
    lat: Number((location.lat + latOffset).toFixed(6)),
    lng: Number((location.lng + lngOffset).toFixed(6))
  };
}

function listenToChildHardware(user, onChange) {
  const deviceId = user?.deviceId || user?.userId || null;
  const deviceRef = ref(
    db,
    deviceId ? `${COLLECTIONS.DEVICE_STATUS}/${deviceId}` : `${COLLECTIONS.DEVICES}/${user.userId}`
  );
  const fallbackDeviceRef = ref(db, `${COLLECTIONS.DEVICES}/${deviceId || user.userId}`);
  const locationRef = ref(db, `${COLLECTIONS.LOCATIONS}/${user.userId}`);

  let latestDeviceStatus = {};
  let latestLocation = null;

  const emit = () => {
    onChange(normalizeDeviceStatus(latestDeviceStatus, latestLocation));
  };

  const unsubscribePrimary = onValue(deviceRef, (snapshot) => {
    latestDeviceStatus = snapshot.exists() ? snapshot.val() : latestDeviceStatus;
    emit();
  });

  const unsubscribeFallback = onValue(fallbackDeviceRef, (snapshot) => {
    if ((!latestDeviceStatus || !Object.keys(latestDeviceStatus).length) && snapshot.exists()) {
      latestDeviceStatus = snapshot.val();
      emit();
    }
  });

  const unsubscribeLocation = onValue(locationRef, (snapshot) => {
    latestLocation = snapshot.exists() ? snapshot.val() : null;
    emit();
  });

  emit();

  return () => {
    unsubscribePrimary();
    unsubscribeFallback();
    unsubscribeLocation();
  };
}

function listenToChildAlerts(childUid, onChange) {
  return onValue(ref(db, COLLECTIONS.ALERTS), (snapshot) => {
    if (!snapshot.exists()) {
      onChange([]);
      return;
    }

    const alerts = Object.entries(snapshot.val())
      .map(([alertId, value]) => ({ alertId, ...value }))
      .filter((alert) => alert.childUid === childUid)
      .filter((alert) => alert.status !== ALERT_STATUS.CANCELLED)
      .map((alert) => ({
        ...alert,
        createdAt: alert.createdAt || alert.timestamp || Date.now(),
        source: alert.source || "hardware"
      }));

    onChange(sortAlerts(alerts));
  });
}

async function writeMockDeviceStatus(user, overrides = {}) {
  const deviceId = getDeviceId(user);
  if (!deviceId || !user?.userId) {
    throw new Error("Bind a device before running hardware tests.");
  }

  const timestamp = Date.now();
  const location = overrides.location || createNearbyLocation(getBaseLocation(user));
  const payload = {
    deviceId,
    childUid: user.userId,
    isOnline: overrides.isOnline ?? true,
    lastSeen: timestamp,
    battery: overrides.battery ?? Math.max(20, Math.floor(55 + Math.random() * 40)),
    location,
    sensors: {
      accelerometer: overrides.accelerometer || {
        ax: Number((Math.random() * 2 - 1).toFixed(2)),
        ay: Number((Math.random() * 2 - 1).toFixed(2)),
        az: Number((0.8 + Math.random() * 0.4).toFixed(2))
      },
      soundLevel: overrides.soundLevel ?? Math.floor(35 + Math.random() * 20),
      gpsFix: overrides.gpsFix ?? true,
      buttonPressed: overrides.buttonPressed ?? false
    },
    source: "hardware"
  };

  await Promise.all([
    set(ref(db, `${COLLECTIONS.DEVICE_STATUS}/${deviceId}`), payload),
    update(ref(db, `${COLLECTIONS.CHILDREN}/${user.userId}`), {
      deviceId,
      updatedAt: timestamp
    }),
    set(ref(db, `${COLLECTIONS.LOCATIONS}/${user.userId}`), {
      ...location,
      updatedAt: timestamp,
      source: "hardware"
    })
  ]);

  return payload;
}

async function triggerMockHardwareAlert(user, type = ALERT_TYPES.SOS) {
  const deviceId = getDeviceId(user);
  if (!deviceId || !user?.userId) {
    throw new Error("Bind a device before triggering test alerts.");
  }

  const createdAt = Date.now();
  const location = createNearbyLocation(getBaseLocation(user));
  const alertId = createAlertId(type);
  const payload = {
    alertId,
    childUid: user.userId,
    deviceId,
    type,
    createdAt,
    timestamp: createdAt,
    location,
    source: "hardware",
    status: ALERT_STATUS.ACTIVE
  };

  const sensorOverrides =
    type === ALERT_TYPES.SCREAM
      ? { soundLevel: APP_CONFIG.hardware.screamThreshold + 12 }
      : type === ALERT_TYPES.SOS
        ? { buttonPressed: true }
        : {};

  await Promise.all([
    set(ref(db, `${COLLECTIONS.ALERTS}/${alertId}`), payload),
    writeMockDeviceStatus(user, {
      location,
      ...sensorOverrides
    }),
    update(ref(db, `${COLLECTIONS.CHILDREN}/${user.userId}`), {
      lastAlertAt: createdAt,
      lastKnownStatus: type,
      updatedAt: createdAt
    })
  ]);

  return payload;
}

export { listenToChildAlerts, listenToChildHardware, triggerMockHardwareAlert, writeMockDeviceStatus };
