const firebaseConfig = {
  apiKey: "AIzaSyBBpVZwPcWTi7pUeNQBfUXcXDwoQV4a6sE",
  authDomain: "safetynet-61628-f0cd3.firebaseapp.com",
  databaseURL: "https://safetynet-61628-f0cd3-default-rtdb.firebaseio.com",
  projectId: "safetynet-61628-f0cd3",
  storageBucket: "safetynet-61628-f0cd3.firebasestorage.app",
  messagingSenderId: "835913186774",
  appId: "1:835913186774:web:4df4917eb727d29b76b877",
  measurementId: "G-Y4QVX2QVQP"
};

const APP_CONFIG = {
  name: "SafetyNet Parent",
  version: "1.0.0",
  environment: "development",
  features: {
    realtimeAlerts: true,
    childLinking: true,
    liveLocation: true,
    deviceMonitoring: true,
    browserAudio: true
  },
  notificationSound: true,
  autoRefreshInterval: 15000,
  linkRequestExpiryMs: 300000,
  maxHistoryItems: 50
};

const COLLECTIONS = {
  USERS: "users",
  CHILDREN: "children",
  PARENTS: "parents",
  RELATIONSHIPS: "relationships",
  LINK_REQUESTS: "linkRequests",
  ALERTS: "alerts",
  LOCATIONS: "locations",
  DEVICES: "devices",
  DEVICE_STATUS: "deviceStatus",
  NOTIFICATIONS: "notifications"
};

export { APP_CONFIG, COLLECTIONS, firebaseConfig };
