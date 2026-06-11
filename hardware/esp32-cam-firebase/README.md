# ESP32-CAM Firebase Starter Guide

This guide explains this hardware folder in a simple, beginner-friendly way.

You said you use **VS Code + PlatformIO**, not Arduino IDE, so this guide is now written for **PlatformIO workflow first**.

Do not worry about making everything perfect yet. The goal of this step is just:

- connect the hardware to Wi-Fi
- connect the hardware to Firebase
- send test device status
- send test alerts
- confirm the child and parent web apps receive updates

---

## 1. What this folder is for

This folder is a small hardware project for your SafetyNet device.

It helps your ESP32-CAM send data to Firebase so both web apps can react in real time:

- `safetynet-child-web`
- `safetynet-parent-web`

---

## 2. Files in this folder

### `src/main.cpp`

This is now the **main firmware file**.

It handles:

- Wi-Fi connection
- Firebase login
- device heartbeat
- location update
- alert creation

### `esp32_cam_firebase.ino`

This is now only a small legacy pointer file.

The real code has been moved into:

- `src/main.cpp`

### `secrets.example.h`

This is where your real secret values are stored right now.

You said you already pasted all your data here.

### `secrets.h`

This is the real header used by the firmware.

It simply loads:

- `secrets.example.h`

So you do not need to copy the same values twice.

### `platformio.ini`

This makes the folder work as a **PlatformIO project** in VS Code.

### `src/main.cpp`

This is the real PlatformIO firmware entry point and source of truth.

---

## 3. Very important: this is a starter, not final production wiring

Right now, this code is a **testing starter**.

That means we are first proving:

- Wi-Fi works
- Firebase login works
- database writes work
- alerts appear in the apps

This is not yet the final safest hardware wiring design.

---

## 4. Recommended hardware architecture

Your hardware includes:

- Arduino Nano
- MPU6050
- sound sensor
- GPS
- SOS button
- ESP32-CAM

The best long-term setup is:

### Arduino Nano

Use it to read:

- MPU6050
- sound sensor
- SOS button
- GPS if needed

### ESP32-CAM

Use it to handle:

- Wi-Fi
- Firebase
- camera
- uploading alerts and device status

This is recommended because ESP32-CAM pins can be limited and tricky when the camera is active.

---

## 5. Firebase paths your web apps expect

Your web apps are already designed to use these paths:

- `children/{childUid}/deviceId`
- `deviceStatus/{deviceId}`
- `locations/{childUid}`
- `alerts/{alertId}`

For your current device:

- `deviceId = child-001`

---

## 6. Before building the firmware

Please make sure these are already done.

### Step 1: Bind the device in the child web app

Open:

- `safetynet-child-web/index.html`

Then:

1. Sign in as the child user
2. Go to **Status Dashboard**
3. Find **Hardware Pairing**
4. Enter `child-001`
5. Click bind

This should save something like:

```json
{
  "children": {
    "YOUR_CHILD_UID": {
      "deviceId": "child-001"
    }
  }
}
```

### Step 2: Create Firebase device login

In Firebase Console:

1. Open **Authentication**
2. Open **Users**
3. Click **Add user**

Example:

- email: `device.child001@safetynet.local`
- password: `StrongDevicePass123`

This login is used by the hardware.

### Step 3: Fill `secrets.example.h`

You said this is already done.

That means your values should already be in:

- Wi-Fi SSID
- Wi-Fi password
- Firebase API key
- Firebase database URL
- hardware device email
- hardware device password
- child UID
- device ID

### Step 4: `secrets.h` is now ready

I created:

- `hardware/esp32-cam-firebase/secrets.h`

It loads your filled:

- `hardware/esp32-cam-firebase/secrets.example.h`

So your firmware can use your values now.

---

## 7. How secrets work now

You do **not** need to paste the same values twice.

Current setup:

- `secrets.example.h` = contains your real values
- `secrets.h` = includes `secrets.example.h`

Later, if you want, we can move the real values directly into `secrets.h` and keep the example file clean.

---

## 8. PlatformIO project setup

This folder is now prepared for PlatformIO.

Files added:

- `platformio.ini`
- `src/main.cpp`

So now you can open this folder directly in VS Code as a PlatformIO project.

### Open the project

Open this folder in VS Code:

- `hardware/esp32-cam-firebase`

PlatformIO should detect:

- `platformio.ini`

### Selected board

The current config uses:

- `board = esp32cam`

### Library dependency

PlatformIO will install:

- `TinyGPSPlus`

automatically during build.

---

## 9. How to build and upload with PlatformIO

Open the terminal in:

- `hardware/esp32-cam-firebase`

Then use these commands.

### Build

```bash
pio run
```

### Upload

```bash
pio run -t upload
```

### Serial Monitor

```bash
pio device monitor -b 115200
```

---

## 10. What the firmware currently does

The current firmware tries to:

1. boot the ESP32-CAM
2. connect to Wi-Fi
3. sign in to Firebase
4. upload heartbeat data
5. upload location
6. create alerts for:
   - `sos`
   - `scream`
   - `fall`

---

## 11. Example Firebase data you should see

### Device heartbeat

Path:

- `deviceStatus/child-001`

Example:

```json
{
  "deviceId": "child-001",
  "childUid": "YOUR_CHILD_UID",
  "isOnline": true,
  "lastSeen": 1710000000000,
  "battery": 82,
  "location": {
    "lat": 23.8103,
    "lng": 90.4125
  },
  "sensors": {
    "soundLevel": 42,
    "gpsFix": true,
    "buttonPressed": false,
    "accelerometer": {
      "ax": 0.02,
      "ay": -0.01,
      "az": 0.98
    }
  },
  "source": "hardware"
}
```

### Alert

Path:

- `alerts/{alertId}`

Example:

```json
{
  "alertId": "sos_1710000000000_ab12cd",
  "childUid": "YOUR_CHILD_UID",
  "deviceId": "child-001",
  "type": "sos",
  "createdAt": 1710000000000,
  "timestamp": 1710000000000,
  "location": {
    "lat": 23.8103,
    "lng": 90.4125
  },
  "source": "hardware",
  "status": "active"
}
```

---

## 12. Beginner test flow

Follow this exact order.

### Phase 1: Web and Firebase

1. Open child web app
2. Sign in
3. Bind `child-001`
4. Open parent web app
5. Make sure both apps load

### Phase 2: PlatformIO firmware

1. Open `hardware/esp32-cam-firebase` in VS Code
2. Let PlatformIO load the project
3. Review `src/main.cpp`
4. Connect the ESP32-CAM
5. Run:
   - `pio run`
6. If build succeeds, run:
   - `pio run -t upload`

### Phase 3: Serial monitor

After upload, open:

- `pio device monitor -b 115200`

You want to see messages like:

- Wi-Fi connected
- Firebase device auth success
- Heartbeat uploaded

### Phase 4: Firebase check

Open Firebase Realtime Database and check for:

- `deviceStatus/child-001`
- `locations/YOUR_CHILD_UID`

### Phase 5: App check

Open:

- child web app
- parent web app

Then confirm they show new hardware status.

---

## 13. If something does not work

### If Wi-Fi fails

Check:

- SSID is correct
- password is correct
- Wi-Fi is 2.4 GHz

### If Firebase login fails

Check:

- API key is correct
- device email/password is correct
- Authentication is enabled in Firebase

### If database writes do not appear

Check:

- Realtime Database URL is correct
- `CHILD_UID` is correct
- `DEVICE_ID` is exactly `child-001`
- database rules allow the signed-in device user

### If web apps do not update

Check:

- child is bound to `child-001`
- data exists in `deviceStatus`
- data exists in `alerts`

---

## 14. Important note about pins

The current firmware in `src/main.cpp` still uses test-oriented pin assumptions.

Before real deployment, we should carefully validate:

- button pin
- sound sensor pin
- GPS pins
- MPU6050 pins

Because ESP32-CAM boards can have conflicts with camera-related pins.

---

## 15. Best next step after this

After this starter works, the best next implementation is:

1. create Arduino Nano firmware for sensor reading
2. create ESP32-CAM firmware only for Wi-Fi + Firebase + camera
3. send sensor events from Nano to ESP32-CAM
4. add camera snapshot support on emergency alerts

That will give you a much stronger and more stable hardware system.

---

## 16. What I can help you with next

I can help you with any of these next:

- check or improve `secrets.example.h`
- create Arduino Nano sensor firmware
- create ESP32-CAM bridge firmware
- define Nano -> ESP32-CAM serial messages
- help test `pio run` build errors
