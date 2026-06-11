#include <WiFi.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <time.h>
#include <math.h>
#include <esp_camera.h>
#include <TinyGPSPlus.h>

#include "../secrets.h"

// ---------------------------------------------------------------------------
// Hardware pin configuration
// Review these values before upload.
// ---------------------------------------------------------------------------

// I2C for MPU6050
static const int PIN_I2C_SDA = 14;
static const int PIN_I2C_SCL = 15;

// SOS button
static const int PIN_SOS_BUTTON = 13;

// Sound sensor
static const int PIN_SOUND_SENSOR = 33;

// GPS UART
static const int PIN_GPS_RX = 12;
static const int PIN_GPS_TX = 2;

// Optional battery ADC
static const int PIN_BATTERY_ADC = 34;

// ---------------------------------------------------------------------------
// Timing and thresholds
// ---------------------------------------------------------------------------

static const unsigned long HEARTBEAT_INTERVAL_MS = 15000;
static const unsigned long FIREBASE_AUTH_REFRESH_MS = 45UL * 60UL * 1000UL;
static const unsigned long ALERT_DEBOUNCE_MS = 10000;
static const int SOUND_THRESHOLD = 2800;
static const float FALL_THRESHOLD_G = 2.4f;

// ---------------------------------------------------------------------------
// AI Thinker ESP32-CAM pins
// ---------------------------------------------------------------------------

#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0
#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27

#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM        5
#define VSYNC_GPIO_NUM    25
#define HREF_GPIO_NUM     23
#define PCLK_GPIO_NUM     22

TinyGPSPlus gps;
HardwareSerial gpsSerial(1);

String firebaseIdToken;
unsigned long lastHeartbeatAt = 0;
unsigned long lastFirebaseAuthAt = 0;
unsigned long lastAlertAt = 0;
bool clockSynced = false;

struct LocationData {
  bool hasFix;
  double lat;
  double lng;
};

struct AccelerometerData {
  float ax;
  float ay;
  float az;
};

String jsonEscape(const String& value) {
  String result = value;
  result.replace("\\", "\\\\");
  result.replace("\"", "\\\"");
  result.replace("\n", "\\n");
  result.replace("\r", "\\r");
  return result;
}

String extractJsonString(const String& body, const String& key) {
  String needle = "\"" + key + "\":\"";
  int start = body.indexOf(needle);
  if (start < 0) {
    return "";
  }

  start += needle.length();
  int end = body.indexOf("\"", start);
  if (end < 0) {
    return "";
  }

  return body.substring(start, end);
}

String createAlertId(const String& type) {
  return type + "_" + String(millis()) + "_" + String(random(100000, 999999));
}

bool connectToWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.print("Connecting to WiFi");
  unsigned long startedAt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startedAt < 20000) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("WiFi connected. IP: ");
    Serial.println(WiFi.localIP());
    return true;
  }

  Serial.println("WiFi connection failed.");
  return false;
}

bool syncClock() {
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");

  Serial.print("Syncing clock");
  time_t now = time(nullptr);
  unsigned long startedAt = millis();
  while (now < 1700000000 && millis() - startedAt < 15000) {
    delay(500);
    Serial.print(".");
    now = time(nullptr);
  }
  Serial.println();

  clockSynced = now >= 1700000000;
  if (clockSynced) {
    Serial.println("Clock synced.");
  } else {
    Serial.println("Clock sync failed. Firebase timestamps may be inaccurate.");
  }

  return clockSynced;
}

unsigned long long currentTimestampMs() {
  time_t now = time(nullptr);
  if (now > 1700000000) {
    return static_cast<unsigned long long>(now) * 1000ULL;
  }

  return static_cast<unsigned long long>(millis());
}

bool initCamera() {
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;
  config.frame_size = FRAMESIZE_QVGA;
  config.jpeg_quality = 12;
  config.fb_count = 1;
  config.grab_mode = CAMERA_GRAB_LATEST;

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("Camera init failed: 0x%x\n", err);
    return false;
  }

  Serial.println("Camera initialized.");
  return true;
}

bool initMPU6050() {
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);

  Wire.beginTransmission(0x68);
  Wire.write(0x6B);
  Wire.write(0);
  if (Wire.endTransmission(true) != 0) {
    Serial.println("MPU6050 not detected.");
    return false;
  }

  Serial.println("MPU6050 initialized.");
  return true;
}

AccelerometerData readAccelerometer() {
  AccelerometerData data = {0.0f, 0.0f, 1.0f};

  Wire.beginTransmission(0x68);
  Wire.write(0x3B);
  if (Wire.endTransmission(false) != 0) {
    return data;
  }

  Wire.requestFrom(0x68, 6, true);
  if (Wire.available() >= 6) {
    int16_t rawAx = (Wire.read() << 8) | Wire.read();
    int16_t rawAy = (Wire.read() << 8) | Wire.read();
    int16_t rawAz = (Wire.read() << 8) | Wire.read();

    data.ax = rawAx / 16384.0f;
    data.ay = rawAy / 16384.0f;
    data.az = rawAz / 16384.0f;
  }

  return data;
}

float calculateAccelerationMagnitude(const AccelerometerData& data) {
  return sqrt((data.ax * data.ax) + (data.ay * data.ay) + (data.az * data.az));
}

int readSoundLevel() {
  return analogRead(PIN_SOUND_SENSOR);
}

int readBatteryPercent() {
  int raw = analogRead(PIN_BATTERY_ADC);
  if (raw <= 0) {
    return 0;
  }

  return constrain(map(raw, 1800, 3000, 0, 100), 0, 100);
}

LocationData readGPSLocation() {
  while (gpsSerial.available()) {
    gps.encode(gpsSerial.read());
  }

  LocationData location;
  location.hasFix = gps.location.isValid();
  location.lat = location.hasFix ? gps.location.lat() : 23.8103;
  location.lng = location.hasFix ? gps.location.lng() : 90.4125;
  return location;
}

bool firebaseSignIn() {
  HTTPClient http;
  String url = String("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=") + FIREBASE_API_KEY;
  String body = String("{\"email\":\"") + jsonEscape(FIREBASE_DEVICE_EMAIL) +
                "\",\"password\":\"" + jsonEscape(FIREBASE_DEVICE_PASSWORD) +
                "\",\"returnSecureToken\":true}";

  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  int statusCode = http.POST(body);
  String response = http.getString();
  http.end();

  if (statusCode < 200 || statusCode >= 300) {
    Serial.printf("Firebase sign-in failed: %d\n", statusCode);
    Serial.println(response);
    return false;
  }

  firebaseIdToken = extractJsonString(response, "idToken");
  if (firebaseIdToken.length() == 0) {
    Serial.println("Firebase sign-in succeeded but no idToken found.");
    return false;
  }

  lastFirebaseAuthAt = millis();
  Serial.println("Firebase device auth success.");
  return true;
}

bool firebaseRequest(const String& method, const String& path, const String& body) {
  if (WiFi.status() != WL_CONNECTED) {
    return false;
  }

  if (firebaseIdToken.length() == 0 || millis() - lastFirebaseAuthAt > FIREBASE_AUTH_REFRESH_MS) {
    if (!firebaseSignIn()) {
      return false;
    }
  }

  HTTPClient http;
  String url = String(FIREBASE_DATABASE_URL) + "/" + path + ".json?auth=" + firebaseIdToken;
  http.begin(url);
  http.addHeader("Content-Type", "application/json");

  int statusCode = -1;
  if (method == "PUT") {
    statusCode = http.PUT(body);
  } else if (method == "PATCH") {
    statusCode = http.sendRequest("PATCH", body);
  } else if (method == "POST") {
    statusCode = http.POST(body);
  }

  String response = http.getString();
  http.end();

  if (statusCode < 200 || statusCode >= 300) {
    Serial.printf("Firebase %s failed for %s: %d\n", method.c_str(), path.c_str(), statusCode);
    Serial.println(response);
    return false;
  }

  return true;
}

bool writeLocation(const LocationData& location, unsigned long long timestamp) {
  String body = String("{\"lat\":") + String(location.lat, 6) +
                ",\"lng\":" + String(location.lng, 6) +
                ",\"updatedAt\":" + String(timestamp) +
                ",\"source\":\"hardware\"}";

  return firebaseRequest("PUT", String("locations/") + CHILD_UID, body);
}

bool writeHeartbeat(const LocationData& location, const AccelerometerData& accel, int soundLevel, int batteryPercent, bool buttonPressed) {
  unsigned long long timestamp = currentTimestampMs();
  String body = String("{") +
                "\"deviceId\":\"" + jsonEscape(DEVICE_ID) + "\"," +
                "\"childUid\":\"" + jsonEscape(CHILD_UID) + "\"," +
                "\"isOnline\":true," +
                "\"lastSeen\":" + String(timestamp) + "," +
                "\"battery\":" + String(batteryPercent) + "," +
                "\"location\":{\"lat\":" + String(location.lat, 6) + ",\"lng\":" + String(location.lng, 6) + "}," +
                "\"sensors\":{" +
                  "\"soundLevel\":" + String(soundLevel) + "," +
                  "\"gpsFix\":" + String(location.hasFix ? "true" : "false") + "," +
                  "\"buttonPressed\":" + String(buttonPressed ? "true" : "false") + "," +
                  "\"accelerometer\":{" +
                    "\"ax\":" + String(accel.ax, 2) + "," +
                    "\"ay\":" + String(accel.ay, 2) + "," +
                    "\"az\":" + String(accel.az, 2) +
                  "}" +
                "}," +
                "\"source\":\"hardware\"" +
              "}";

  bool ok = firebaseRequest("PUT", String("deviceStatus/") + DEVICE_ID, body);
  if (ok) {
    writeLocation(location, timestamp);
  }
  return ok;
}

bool createAlert(const String& type, const LocationData& location) {
  String alertId = createAlertId(type);
  unsigned long long timestamp = currentTimestampMs();
  String body = String("{") +
                "\"alertId\":\"" + jsonEscape(alertId) + "\"," +
                "\"childUid\":\"" + jsonEscape(CHILD_UID) + "\"," +
                "\"deviceId\":\"" + jsonEscape(DEVICE_ID) + "\"," +
                "\"type\":\"" + jsonEscape(type) + "\"," +
                "\"createdAt\":" + String(timestamp) + "," +
                "\"timestamp\":" + String(timestamp) + "," +
                "\"location\":{\"lat\":" + String(location.lat, 6) + ",\"lng\":" + String(location.lng, 6) + "}," +
                "\"source\":\"hardware\"," +
                "\"status\":\"active\"" +
              "}";

  bool ok = firebaseRequest("PUT", String("alerts/") + alertId, body);
  if (ok) {
    Serial.printf("Alert created: %s\n", type.c_str());
  }
  return ok;
}

void handleTriggers() {
  if (millis() - lastAlertAt < ALERT_DEBOUNCE_MS) {
    return;
  }

  bool buttonPressed = digitalRead(PIN_SOS_BUTTON) == LOW;
  int soundLevel = readSoundLevel();
  AccelerometerData accel = readAccelerometer();
  float magnitude = calculateAccelerationMagnitude(accel);
  LocationData location = readGPSLocation();

  if (buttonPressed) {
    if (createAlert("sos", location)) {
      lastAlertAt = millis();
    }
    return;
  }

  if (soundLevel >= SOUND_THRESHOLD) {
    if (createAlert("scream", location)) {
      lastAlertAt = millis();
    }
    return;
  }

  if (magnitude >= FALL_THRESHOLD_G) {
    if (createAlert("fall", location)) {
      lastAlertAt = millis();
    }
  }
}

void sendHeartbeatIfDue() {
  if (millis() - lastHeartbeatAt < HEARTBEAT_INTERVAL_MS) {
    return;
  }

  LocationData location = readGPSLocation();
  AccelerometerData accel = readAccelerometer();
  int soundLevel = readSoundLevel();
  int batteryPercent = readBatteryPercent();
  bool buttonPressed = digitalRead(PIN_SOS_BUTTON) == LOW;

  if (writeHeartbeat(location, accel, soundLevel, batteryPercent, buttonPressed)) {
    lastHeartbeatAt = millis();
    Serial.println("Heartbeat uploaded.");
  }
}

void setupPins() {
  pinMode(PIN_SOS_BUTTON, INPUT_PULLUP);
  pinMode(PIN_SOUND_SENSOR, INPUT);
  pinMode(PIN_BATTERY_ADC, INPUT);
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  randomSeed(micros());

  Serial.println("SafetyNet ESP32-CAM Firebase starter booting...");

  setupPins();
  initCamera();
  initMPU6050();

  gpsSerial.begin(9600, SERIAL_8N1, PIN_GPS_RX, PIN_GPS_TX);

  connectToWiFi();
  syncClock();
  firebaseSignIn();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectToWiFi();
    syncClock();
  }

  handleTriggers();
  sendHeartbeatIfDue();
  delay(150);
}
