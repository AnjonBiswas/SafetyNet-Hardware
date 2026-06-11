import { COLLECTIONS } from "./config.js";
import { db } from "./auth.js";
import { get, onValue, ref, set, update } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

function normalizeRelationship(childUid, parentUid, value = {}) {
  return {
    childUid,
    parentUid,
    status: value.status || "unknown",
    linkedAt: value.linkedAt || null,
    linkedBy: value.linkedBy || null
  };
}

function generateRequestId(prefix = "link") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function generateOtpCode(length = 6) {
  return Array.from({ length }, () => Math.floor(Math.random() * 10)).join("");
}

async function findActiveRequestByField(field, value) {
  const snapshot = await get(ref(db, COLLECTIONS.LINK_REQUESTS));
  if (!snapshot.exists()) {
    return null;
  }

  const now = Date.now();
  const requests = Object.entries(snapshot.val())
    .map(([requestId, requestValue]) => ({ requestId, ...requestValue }))
    .filter((request) => request.status === "pending")
    .filter((request) => !request.expiresAt || request.expiresAt > now);

  return requests.find((request) => request[field] === value) || null;
}

async function createParentLinkingRequest(parentUser, expiryMs = 300000) {
  const requestId = generateRequestId("parent");
  const createdAt = Date.now();
  const expiresAt = createdAt + expiryMs;
  const otp = generateOtpCode();
  const requestPayload = {
    requestId,
    code: otp,
    otp,
    parentUid: parentUser.userId,
    parentName: parentUser.name || parentUser.email || "Parent",
    initiatorRole: "parent",
    status: "pending",
    createdAt,
    expiresAt
  };

  await set(ref(db, `${COLLECTIONS.LINK_REQUESTS}/${requestId}`), requestPayload);
  return requestPayload;
}

async function verifyLinkingCode(code, parentUid) {
  if (!code) {
    const error = new Error("Invalid code");
    error.code = "invalid-code";
    throw error;
  }

  const request = await findActiveRequestByField("otp", code.trim());
  if (!request) {
    const error = new Error("Invalid code");
    error.code = "invalid-code";
    throw error;
  }

  if (request.initiatorRole === "parent") {
    const error = new Error("This code must be used from the child app");
    error.code = "wrong-direction";
    throw error;
  }

  const timestamp = Date.now();
  await Promise.all([
    update(ref(db, `${COLLECTIONS.RELATIONSHIPS}/${request.childUid}/${parentUid}`), {
      status: "linked",
      linkedAt: timestamp,
      linkedBy: parentUid,
      linkedVia: "otp"
    }),
    update(ref(db, `${COLLECTIONS.LINK_REQUESTS}/${request.requestId}`), {
      status: "linked",
      linkedAt: timestamp,
      linkedBy: parentUid,
      parentUid
    }),
    update(ref(db, `${COLLECTIONS.PARENTS}/${parentUid}`), {
      lastLinkedAt: timestamp
    }).catch(() => null),
    update(ref(db, `${COLLECTIONS.CHILDREN}/${request.childUid}`), {
      updatedAt: timestamp,
      parentLinkedAt: timestamp
    }).catch(() => null)
  ]);

  return {
    childId: request.childUid,
    childName: request.childName || "Linked Child",
    linkedAt: timestamp
  };
}

async function getLinkedChildIds(parentUid) {
  const snapshot = await get(ref(db, COLLECTIONS.RELATIONSHIPS));
  if (!snapshot.exists()) {
    return [];
  }

  const relationships = snapshot.val();
  return Object.entries(relationships)
    .map(([childUid, parents]) => normalizeRelationship(childUid, parentUid, parents?.[parentUid]))
    .filter((relationship) => relationship.status === "linked")
    .map((relationship) => relationship.childUid);
}

async function getChildBundle(childUid) {
  const [childSnapshot, userSnapshot, locationSnapshot] = await Promise.all([
    get(ref(db, `${COLLECTIONS.CHILDREN}/${childUid}`)),
    get(ref(db, `${COLLECTIONS.USERS}/${childUid}`)),
    get(ref(db, `${COLLECTIONS.LOCATIONS}/${childUid}`))
  ]);

  const userValue = userSnapshot.exists() ? userSnapshot.val() : {};
  const childValue = childSnapshot.exists() ? childSnapshot.val() : {};
  const resolvedDeviceId = childValue.deviceId || userValue.deviceId || childUid;
  const [deviceStatusSnapshot, deviceSnapshot] = await Promise.all([
    get(ref(db, `${COLLECTIONS.DEVICE_STATUS}/${resolvedDeviceId}`)),
    get(ref(db, `${COLLECTIONS.DEVICES}/${resolvedDeviceId}`))
  ]);

  const mergedDevice = {
    ...(deviceSnapshot.exists() ? deviceSnapshot.val() : {}),
    ...(deviceStatusSnapshot.exists() ? deviceStatusSnapshot.val() : {}),
    deviceId: resolvedDeviceId
  };
  const mergedLocation = locationSnapshot.exists()
    ? locationSnapshot.val()
    : mergedDevice.location || null;

  return {
    childUid,
    ...userValue,
    ...childValue,
    location: mergedLocation,
    device: Object.keys(mergedDevice).length ? mergedDevice : null
  };
}

async function getLinkedChildren(parentUid) {
  const childIds = await getLinkedChildIds(parentUid);
  const children = await Promise.all(childIds.map((childUid) => getChildBundle(childUid)));
  return children.sort((left, right) => {
    const rightTime = right.updatedAt || right.lastSeen || 0;
    const leftTime = left.updatedAt || left.lastSeen || 0;
    return rightTime - leftTime;
  });
}

async function getAlertsForParent(parentUid) {
  const [childIds, alertsSnapshot] = await Promise.all([
    getLinkedChildIds(parentUid),
    get(ref(db, COLLECTIONS.ALERTS))
  ]);

  if (!alertsSnapshot.exists()) {
    return [];
  }

  const childIdSet = new Set(childIds);
  return Object.entries(alertsSnapshot.val())
    .map(([alertId, value]) => ({ alertId, ...value }))
    .filter((alert) => childIdSet.has(alert.childUid))
    .sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0));
}

function listenToChildren(parentUid, onChange) {
  const refresh = async () => {
    const children = await getLinkedChildren(parentUid);
    await update(ref(db, `${COLLECTIONS.PARENTS}/${parentUid}`), {
      linkedChildrenCount: children.length,
      updatedAt: Date.now()
    }).catch(() => null);
    onChange(children);
  };

  const unsubscribers = [
    onValue(ref(db, COLLECTIONS.RELATIONSHIPS), refresh),
    onValue(ref(db, COLLECTIONS.USERS), refresh),
    onValue(ref(db, COLLECTIONS.CHILDREN), refresh),
    onValue(ref(db, COLLECTIONS.LOCATIONS), refresh),
    onValue(ref(db, COLLECTIONS.DEVICE_STATUS), refresh),
    onValue(ref(db, COLLECTIONS.DEVICES), refresh)
  ];

  return () => {
    unsubscribers.forEach((unsubscribe) => unsubscribe());
  };
}

function listenToAlerts(parentUid, onChange) {
  return onValue(ref(db, COLLECTIONS.ALERTS), async () => {
    onChange(await getAlertsForParent(parentUid));
  });
}

async function updateAlertStatus(alertId, status, parentUid) {
  await update(ref(db, `${COLLECTIONS.ALERTS}/${alertId}`), {
    status,
    updatedAt: Date.now(),
    updatedBy: parentUid
  });
}

function acknowledgeAlert(alertId, parentUid) {
  return updateAlertStatus(alertId, "acknowledged", parentUid);
}

function resolveAlert(alertId, parentUid) {
  return updateAlertStatus(alertId, "resolved", parentUid);
}

function listenToNotifications(parentUid, onChange) {
  return onValue(ref(db, `${COLLECTIONS.NOTIFICATIONS}/${parentUid}`), (snapshot) => {
    if (!snapshot.exists()) {
      onChange([]);
      return;
    }

    const notifications = Object.entries(snapshot.val())
      .map(([notificationId, value]) => ({ notificationId, ...value }))
      .sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0));

    onChange(notifications);
  });
}

export {
  acknowledgeAlert,
  createParentLinkingRequest,
  getAlertsForParent,
  getLinkedChildIds,
  getLinkedChildren,
  listenToAlerts,
  listenToChildren,
  listenToNotifications,
  resolveAlert,
  verifyLinkingCode
};
