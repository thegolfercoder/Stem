// =============================================================================
//  Stem launch monitor - SHAFT MOTION POD firmware
//  Board : ESP32-C3 SuperMini   (Arduino-ESP32 core 3.x, "ESP32C3 Dev Module",
//          USB CDC On Boot: Enabled)
//  IMU   : Adafruit LSM6DS3TR-C (#4503) or LSM6DSOX (#4438), I2C
//  Radio : BLE 5.0 peripheral, NimBLE-Arduino 2.x
// =============================================================================
//
//  WHAT IT DOES
//  1. Samples the IMU at 1.66 kHz, gyro +/-2000 dps and accel +/-16 g, each
//     sample timestamped in the data-ready interrupt.
//  2. Keeps the last 2.4 s in RAM. When the shaft's angular rate passes a
//     swing threshold it streams that swing, starting 1.2 s before the trigger
//     so the takeaway is included, to the ground unit as raw counts over BLE
//     notifications. Raw, so the ground unit and any later replay can apply a
//     different calibration to the same data.
//  3. Sends a status packet once a second: measured sample period, IMU
//     identity, dropped-sample count. Its battery field is 0 ("not read"): the
//     pod has no battery sense.
//  4. After a few minutes without motion, arms the IMU's wake-up interrupt and
//     goes into deep sleep. Picking the club up wakes it.
//
//  POWER (docs/wiring_schematic.md 2.1)
//  Micro LiPo -> charger (BAT) and, through one Schottky, the SuperMini's 5V
//  pin. The pod charges through the SuperMini's own USB-C. It cannot read its
//  cell: charge it after each session.
//
//  WHAT IT DOES NOT DO
//  It derives nothing. The pod reports what the sensor read and flags where
//  the sensor was out of its depth: a clipped axis, a dropped sample, a timing
//  gap. Turning that into tempo or rates happens on the ground unit, which can
//  line it up with the radar, and again offline from the raw stream.
//
//  SENSOR LIMITS, STATED UP FRONT
//  +/-2000 dps and +/-16 g are the top ranges of both IMUs. A pod on the shaft
//  of a fast swing can exceed both through the downswing. Clipped samples are
//  flagged packet by packet, and anything computed from a clipped window is
//  refused downstream. Values beyond full scale are never extrapolated.
//
//  PINS (SuperMini)                 see docs/wiring_schematic.md
//      GPIO6  SDA  -> IMU SDA       (Adafruit board has 10k pull-ups)
//      GPIO7  SCL  -> IMU SCL
//      GPIO3  INT1 <- IMU INT1      data-ready while awake, wake-up in deep sleep
//      GPIO8  on-board blue LED (active low; also a strapping pin, driven only after boot)
// =============================================================================

#include <Arduino.h>
#include <Wire.h>
#include <NimBLEDevice.h>
#include <algorithm>
#include <atomic>
#include "esp_sleep.h"
#include "esp_timer.h"

#if !defined(ESP_ARDUINO_VERSION_MAJOR) || ESP_ARDUINO_VERSION_MAJOR < 3
#error "This sketch needs the Arduino-ESP32 core 3.x (ESP-IDF 5.x)."
#endif

// -----------------------------------------------------------------------------
//  Configuration
// -----------------------------------------------------------------------------
namespace cfg {
// 0.3: the original parts only. No charging contacts and no battery sense
// (those were 0.2); the status packet is back to 28 bytes.
constexpr uint8_t  FW_MAJOR = 0, FW_MINOR = 3;

constexpr int      PIN_SDA      = 6;
constexpr int      PIN_SCL      = 7;
constexpr int      PIN_IMU_INT1 = 3;     // must be GPIO0-5: only those wake a C3 from deep sleep
constexpr int      PIN_LED      = 8;     // active low
constexpr uint32_t I2C_HZ       = 400000;

// Sampling. ODR code 0b1000 = 1.66 kHz on both chips.
constexpr uint8_t  ODR_CODE         = 0x8;
constexpr uint32_t ODR_NOMINAL_HZ   = 1666;
constexpr uint8_t  ACCEL_FS_G       = 16;
constexpr uint16_t GYRO_FS_DPS      = 2000;
constexpr float    GYRO_DPS_PER_LSB = 0.070f;   // at +/-2000 dps, datasheet sensitivity
constexpr int16_t  CLIP_COUNTS      = 32700;    // |raw| at or above this is treated as clipped

// Swing gating. Thresholds act on |omega|, the magnitude of the gyro vector.
// They decide only which stretch of data is sent. They change no number.
constexpr float    SWING_START_DPS  = 300.0f;   // a backswing gets here, a waggle does not
constexpr float    SWING_QUIET_DPS  = 80.0f;
constexpr uint32_t SWING_QUIET_MS   = 400;      // this long below quiet ends the swing
constexpr uint32_t SWING_MIN_MS     = 900;
constexpr uint32_t SWING_MAX_MS     = 4000;
constexpr uint32_t PRETRIGGER_MS    = 1200;     // takeaway happens before the trigger
constexpr uint32_t RING_SAMPLES     = 4096;     // 2.46 s at 1.66 kHz, 64 KB with timestamps

constexpr float    MOTION_DPS       = 20.0f;    // any motion at all, for the sleep timer
constexpr uint32_t SLEEP_AFTER_MS   = 5UL * 60UL * 1000UL;

const char* const  BLE_NAME = "STEMPOD";
// 128-bit UUIDs for this project. The ground unit uses the same values.
const char* const  UUID_SVC  = "7d2a0001-5b1c-4f6e-9c1e-3a6f1f0c2b10";
const char* const  UUID_DATA = "7d2a0002-5b1c-4f6e-9c1e-3a6f1f0c2b10";   // notify: IMU and status packets
const char* const  UUID_CTRL = "7d2a0003-5b1c-4f6e-9c1e-3a6f1f0c2b10";   // write: commands
}  // namespace cfg

// BLE 5 2M PHY: twice the air rate, so each notification is on air for half as
// long. The peer may refuse it, and the link then stays on 1M. Set to 0 if your
// NimBLE-Arduino build lacks NimBLEServer::updatePhy().
#define STEM_USE_2M_PHY 1

// -----------------------------------------------------------------------------
//  Wire format, shared with the ground unit (docs/wiring_schematic.md, "BLE packets").
//  Little-endian, packed. Raw IMU counts in the chip's own register order.
// -----------------------------------------------------------------------------
namespace proto {
constexpr uint8_t MAGIC       = 0xA7;
constexpr uint8_t TYPE_IMU    = 1;
constexpr uint8_t TYPE_STATUS = 2;

enum Flags : uint8_t {
  SWING_ACTIVE  = 1 << 0,
  ACCEL_CLIPPED = 1 << 1,   // at least one accel sample in this packet at full scale
  GYRO_CLIPPED  = 1 << 2,   // at least one gyro sample in this packet at full scale
  OVERFLOW      = 1 << 3,   // samples were dropped before this packet (link too slow)
  TIMING_GAP    = 1 << 4,   // a gap of more than 1.5 sample periods inside this packet
  SWING_END     = 1 << 5,   // last packet of this swing
};

struct __attribute__((packed)) Header {
  uint8_t  magic;
  uint8_t  type;
  uint16_t seq;        // per packet, wraps
  uint16_t swing_id;   // increments per detected swing
  uint8_t  flags;
  uint8_t  n;          // IMU samples that follow (0 for status)
  uint32_t t0_us;      // pod clock, timestamp of the first sample (wraps every ~71 min)
};

struct __attribute__((packed)) ImuRaw {
  int16_t gx, gy, gz;  // OUTX_L_G .. OUTZ_H_G
  int16_t ax, ay, az;  // OUTX_L_XL .. OUTZ_H_XL
};

struct __attribute__((packed)) Status {
  Header   h;
  uint16_t battery_mv;         // 0 = not read: the pod has no battery sense (fw 0.3)
  uint32_t sample_period_ns;   // measured from interrupt timestamps, not the nominal ODR
  uint8_t  imu_who_am_i;       // 0x6A LSM6DS3TR-C, 0x6C LSM6DSOX
  uint8_t  accel_fs_g;
  uint16_t gyro_fs_dps;
  uint32_t dropped_samples;    // since boot
  uint8_t  fw_major, fw_minor;
};

static_assert(sizeof(Header) == 12, "header layout is part of the protocol");
static_assert(sizeof(Status) == 28, "status layout is part of the protocol");
static_assert(sizeof(ImuRaw) == 12, "sample layout is part of the protocol");
constexpr size_t MAX_SAMPLES_PER_PACKET = (244 - sizeof(Header)) / sizeof(ImuRaw);   // 19 at MTU 247
}  // namespace proto

// -----------------------------------------------------------------------------
//  LSM6DS3TR-C / LSM6DSOX register-level driver.
//  The two chips share every register used here except where noted.
// -----------------------------------------------------------------------------
namespace imu {
constexpr uint8_t WHO_AM_I   = 0x0F;
constexpr uint8_t INT1_CTRL  = 0x0D;
constexpr uint8_t CTRL1_XL   = 0x10;
constexpr uint8_t CTRL2_G    = 0x11;
constexpr uint8_t CTRL3_C    = 0x12;
constexpr uint8_t CTRL6_C    = 0x15;
constexpr uint8_t CTRL9_XL   = 0x18;
constexpr uint8_t STATUS_REG = 0x1E;
constexpr uint8_t OUTX_L_G   = 0x22;   // gyro then accel, 12 bytes contiguous
constexpr uint8_t TAP_CFG0   = 0x56;   // DSOX only: LIR lives here
constexpr uint8_t TAP_CFG    = 0x58;   // DS3TR-C: TAP_CFG, DSOX: TAP_CFG2 (INTERRUPTS_ENABLE in both)
constexpr uint8_t WAKE_UP_THS = 0x5B;
constexpr uint8_t WAKE_UP_DUR = 0x5C;
constexpr uint8_t MD1_CFG    = 0x5E;

constexpr uint8_t ID_LSM6DS3TRC = 0x6A;
constexpr uint8_t ID_LSM6DSOX   = 0x6C;

uint8_t addr = 0;
uint8_t who  = 0;

bool write(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(addr);
  Wire.write(reg);
  Wire.write(val);
  return Wire.endTransmission() == 0;
}

bool read(uint8_t reg, uint8_t* buf, size_t len) {
  Wire.beginTransmission(addr);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(addr, len) != len) return false;
  for (size_t i = 0; i < len; ++i) buf[i] = Wire.read();
  return true;
}

uint8_t read8(uint8_t reg) {
  uint8_t v = 0;
  read(reg, &v, 1);
  return v;
}

bool probe() {
  for (uint8_t a : {uint8_t(0x6A), uint8_t(0x6B)}) {   // SDO low / high
    addr = a;
    who = read8(WHO_AM_I);
    if (who == ID_LSM6DS3TRC || who == ID_LSM6DSOX) return true;
  }
  addr = 0;
  return false;
}

// High-rate swing capture: both sensors at ODR_CODE, data-ready on INT1.
bool configureCapture() {
  write(CTRL3_C, 0x01);                       // SW_RESET
  for (int i = 0; i < 50 && (read8(CTRL3_C) & 0x01); ++i) delay(1);
  bool ok = true;
  ok &= write(CTRL3_C, 0x44);                 // BDU | IF_INC
  if (who == ID_LSM6DSOX) ok &= write(CTRL9_XL, read8(CTRL9_XL) | 0x02);   // I3C off, plain I2C
  ok &= write(CTRL1_XL, (cfg::ODR_CODE << 4) | (0b01 << 2));   // FS_XL = 01 -> +/-16 g
  ok &= write(CTRL2_G,  (cfg::ODR_CODE << 4) | (0b11 << 2));   // FS_G  = 11 -> +/-2000 dps
  ok &= write(CTRL6_C, 0x00);                 // accel high-performance mode
  ok &= write(MD1_CFG, 0x00);
  ok &= write(INT1_CTRL, 0x01);               // INT1_DRDY_XL
  return ok;
}

// Deep-sleep watch: gyro off, accel at 26 Hz low-power, wake-up event on INT1,
// latched so the level is still there when the C3 samples it on wake.
bool configureWake(uint8_t threshold_lsb) {
  bool ok = true;
  ok &= write(INT1_CTRL, 0x00);
  ok &= write(CTRL2_G, 0x00);                         // gyro power-down
  ok &= write(CTRL1_XL, (0x2 << 4) | (0b00 << 2));    // 26 Hz, +/-2 g: 1 LSB of WK_THS = 31 mg
  ok &= write(CTRL6_C, 0x10);                         // XL_HM_MODE = 1: low-power accel
  ok &= write(WAKE_UP_DUR, 0x00);
  ok &= write(WAKE_UP_THS, threshold_lsb & 0x3F);
  if (who == ID_LSM6DSOX) {
    ok &= write(TAP_CFG0, 0x01);                      // LIR
    ok &= write(TAP_CFG, 0x80);                       // TAP_CFG2.INTERRUPTS_ENABLE
  } else {
    ok &= write(TAP_CFG, 0x81);                       // INTERRUPTS_ENABLE | LIR
  }
  ok &= write(MD1_CFG, 0x20);                         // INT1_WU
  return ok;
}
}  // namespace imu

// -----------------------------------------------------------------------------
//  Sample ring. One producer (imuTask), one consumer (loop). Counters run
//  forever; index = counter % RING_SAMPLES.
// -----------------------------------------------------------------------------
static proto::ImuRaw*        g_ring   = nullptr;
static uint32_t*             g_ring_t = nullptr;   // pod micros at data-ready
static std::atomic<uint32_t> g_write{0};           // samples written
static std::atomic<uint32_t> g_send{0};            // next sample to send
static std::atomic<uint32_t> g_dropped{0};
static std::atomic<bool>     g_overflow_pending{false};

// Swing state, owned by the producer, read by the consumer.
static std::atomic<bool>     g_swing_active{false};
static std::atomic<uint32_t> g_swing_end_idx{UINT32_MAX};   // sample index where the swing ended
static std::atomic<uint16_t> g_swing_id{0};
static std::atomic<uint32_t> g_last_motion_ms{0};
static std::atomic<uint32_t> g_period_ns{1000000000UL / cfg::ODR_NOMINAL_HZ};
static volatile bool         g_stream_always = false;      // debug: stream everything
static volatile bool         g_stop_imu = false;           // set before sleep; the task parks itself

static TaskHandle_t          g_imu_task = nullptr;
static volatile uint32_t     g_drdy_us = 0;

static void IRAM_ATTR onImuDataReady() {
  g_drdy_us = (uint32_t)esp_timer_get_time();
  BaseType_t woken = pdFALSE;
  vTaskNotifyGiveFromISR(g_imu_task, &woken);
  portYIELD_FROM_ISR(woken);
}

static inline uint32_t omegaSq(const proto::ImuRaw& s) {
  // |omega|^2 in raw counts. Each square is under 2^30, the sum under 2^32.
  return uint32_t(int32_t(s.gx) * s.gx) + uint32_t(int32_t(s.gy) * s.gy) + uint32_t(int32_t(s.gz) * s.gz);
}

static constexpr uint32_t countsSq(float dps) {
  return uint32_t((dps / cfg::GYRO_DPS_PER_LSB) * (dps / cfg::GYRO_DPS_PER_LSB));
}

static void imuTask(void*) {
  const uint32_t start_sq  = countsSq(cfg::SWING_START_DPS);
  const uint32_t quiet_sq  = countsSq(cfg::SWING_QUIET_DPS);
  const uint32_t motion_sq = countsSq(cfg::MOTION_DPS);
  const uint32_t pre_n     = cfg::PRETRIGGER_MS * cfg::ODR_NOMINAL_HZ / 1000;
  uint32_t trigger_ms = 0, quiet_since_ms = 0;
  uint32_t period_t0 = 0, period_n = 0;

  for (;;) {
    if (g_stop_imu) vTaskSuspend(nullptr);   // parks between I2C transactions, never inside one
    // Wait for data-ready. A 5 ms timeout recovers if an edge was missed:
    // INT1 is latched, so a missed read would otherwise stall it high forever.
    bool notified = ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(5)) > 0;
    uint32_t t_us = notified ? g_drdy_us : (uint32_t)esp_timer_get_time();
    if (!notified && !(imu::read8(imu::STATUS_REG) & 0x01)) continue;

    proto::ImuRaw s;
    if (!imu::read(imu::OUTX_L_G, reinterpret_cast<uint8_t*>(&s), sizeof s)) continue;

    // Ring write. If the consumer is a full ring behind, drop its oldest
    // sample and say so in the next packet. Data is never lost silently.
    uint32_t w = g_write.load(std::memory_order_relaxed);
    g_ring[w % cfg::RING_SAMPLES]   = s;
    g_ring_t[w % cfg::RING_SAMPLES] = t_us;
    g_write.store(w + 1, std::memory_order_release);
    uint32_t snd = g_send.load(std::memory_order_acquire);
    if (w + 1 - snd > cfg::RING_SAMPLES) {
      g_send.compare_exchange_strong(snd, w + 1 - cfg::RING_SAMPLES);
      g_dropped.fetch_add(1);
      g_overflow_pending = true;
    }

    // Measured sample period, over blocks of 2048 interrupts.
    if (period_n == 0) period_t0 = t_us;
    if (++period_n == 2049) {
      g_period_ns = uint32_t((uint64_t)(t_us - period_t0) * 1000ULL / 2048ULL);
      period_n = 0;
    }

    // Swing gating.
    uint32_t now_ms = millis();
    uint32_t w2 = omegaSq(s);
    if (w2 > motion_sq) g_last_motion_ms = now_ms;

    if (!g_swing_active) {
      if (w2 > start_sq) {
        g_swing_id.fetch_add(1);
        g_swing_end_idx = UINT32_MAX;
        // Start sending from the pre-trigger point, or the oldest sample held.
        uint32_t first = (w + 1 > pre_n) ? w + 1 - pre_n : 0;
        uint32_t oldest = (w + 1 > cfg::RING_SAMPLES) ? w + 1 - cfg::RING_SAMPLES : 0;
        g_send = std::max(first, oldest);
        g_swing_active = true;
        trigger_ms = now_ms;
        quiet_since_ms = 0;
      }
    } else {
      if (w2 < quiet_sq) {
        if (quiet_since_ms == 0) quiet_since_ms = now_ms;
      } else {
        quiet_since_ms = 0;
      }
      bool quiet_long = quiet_since_ms && (now_ms - quiet_since_ms >= cfg::SWING_QUIET_MS);
      bool long_enough = now_ms - trigger_ms >= cfg::SWING_MIN_MS;
      if ((quiet_long && long_enough) || now_ms - trigger_ms >= cfg::SWING_MAX_MS) {
        g_swing_end_idx = w + 1;
        g_swing_active = false;
      }
    }
  }
}

// -----------------------------------------------------------------------------
//  BLE
// -----------------------------------------------------------------------------
static NimBLEServer*         g_server   = nullptr;
static NimBLECharacteristic* g_chr_data = nullptr;
static std::atomic<uint16_t> g_mtu{23};
static uint16_t              g_seq = 0;

class ServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer* server, NimBLEConnInfo& info) override {
    // 7.5 ms interval, no slave latency, 1 s supervision timeout: the lowest
    // latency BLE offers, which is what a swing stream needs.
    server->updateConnParams(info.getConnHandle(), 6, 6, 0, 100);
#if STEM_USE_2M_PHY
    server->updatePhy(info.getConnHandle(), BLE_GAP_LE_PHY_2M_MASK, BLE_GAP_LE_PHY_2M_MASK, 0);
#endif
    Serial.printf("[ble] connected %s\n", info.getAddress().toString().c_str());
  }
  void onDisconnect(NimBLEServer*, NimBLEConnInfo&, int reason) override {
    g_mtu = 23;
    Serial.printf("[ble] disconnected (reason %d), advertising\n", reason);
    NimBLEDevice::startAdvertising();
  }
  void onMTUChange(uint16_t mtu, NimBLEConnInfo&) override { g_mtu = mtu; }
};

class ControlCallbacks : public NimBLECharacteristicCallbacks {
  // One-byte commands from the ground unit.
  void onWrite(NimBLECharacteristic* chr, NimBLEConnInfo&) override {
    NimBLEAttValue v = chr->getValue();
    if (v.length() < 1) return;
    switch (v.data()[0]) {
      case 'A': g_stream_always = true;  break;   // stream continuously (bench testing)
      case 'G': g_stream_always = false; break;   // swing-gated (default)
      case 'Z': g_last_motion_ms = millis() - cfg::SLEEP_AFTER_MS; break;   // sleep now
      default: break;
    }
  }
};

static ServerCallbacks  g_server_cb;
static ControlCallbacks g_ctrl_cb;

static void bleInit() {
  NimBLEDevice::init(cfg::BLE_NAME);
  NimBLEDevice::setMTU(247);
  g_server = NimBLEDevice::createServer();
  g_server->setCallbacks(&g_server_cb, false);
  NimBLEService* svc = g_server->createService(cfg::UUID_SVC);
  g_chr_data = svc->createCharacteristic(cfg::UUID_DATA, NIMBLE_PROPERTY::NOTIFY);
  NimBLECharacteristic* ctrl =
      svc->createCharacteristic(cfg::UUID_CTRL, NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR);
  ctrl->setCallbacks(&g_ctrl_cb);
  svc->start();
  NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
  adv->setName(cfg::BLE_NAME);
  adv->addServiceUUID(cfg::UUID_SVC);
  adv->enableScanResponse(true);
  adv->start();
}

static bool connected() { return g_server && g_server->getConnectedCount() > 0; }

// Send one packet of up to MAX_SAMPLES_PER_PACKET samples from the ring.
// Returns false if there was nothing to send or the stack had no buffer free.
static bool sendImuPacket(uint32_t end_idx, bool swing_closing) {
  uint32_t snd = g_send.load(std::memory_order_acquire);
  uint32_t avail = end_idx - snd;
  if (avail == 0 || avail > cfg::RING_SAMPLES) return false;

  size_t per_packet = std::min(proto::MAX_SAMPLES_PER_PACKET,
                          size_t((g_mtu.load() - 3 - sizeof(proto::Header)) / sizeof(proto::ImuRaw)));
  size_t n = std::min<size_t>(avail, per_packet);
  if (n == 0) return false;

  uint8_t buf[sizeof(proto::Header) + proto::MAX_SAMPLES_PER_PACKET * sizeof(proto::ImuRaw)];
  auto* h = reinterpret_cast<proto::Header*>(buf);
  auto* out = reinterpret_cast<proto::ImuRaw*>(buf + sizeof(proto::Header));
  uint8_t flags = 0;
  uint32_t period_us = g_period_ns.load() / 1000;
  uint32_t prev_t = 0;
  for (size_t i = 0; i < n; ++i) {
    uint32_t k = (snd + i) % cfg::RING_SAMPLES;
    out[i] = g_ring[k];
    uint32_t t = g_ring_t[k];
    if (i > 0 && (t - prev_t) * 2 > period_us * 3) flags |= proto::TIMING_GAP;
    prev_t = t;
    const proto::ImuRaw& s = out[i];
    if (abs(s.gx) >= cfg::CLIP_COUNTS || abs(s.gy) >= cfg::CLIP_COUNTS || abs(s.gz) >= cfg::CLIP_COUNTS)
      flags |= proto::GYRO_CLIPPED;
    if (abs(s.ax) >= cfg::CLIP_COUNTS || abs(s.ay) >= cfg::CLIP_COUNTS || abs(s.az) >= cfg::CLIP_COUNTS)
      flags |= proto::ACCEL_CLIPPED;
  }
  if (g_swing_active) flags |= proto::SWING_ACTIVE;
  if (g_overflow_pending.exchange(false)) flags |= proto::OVERFLOW;
  if (swing_closing && snd + n == end_idx) flags |= proto::SWING_END;

  h->magic = proto::MAGIC;
  h->type = proto::TYPE_IMU;
  h->seq = g_seq;
  h->swing_id = g_swing_id;
  h->flags = flags;
  h->n = uint8_t(n);
  h->t0_us = g_ring_t[snd % cfg::RING_SAMPLES];

  g_chr_data->setValue(buf, sizeof(proto::Header) + n * sizeof(proto::ImuRaw));
  if (!g_chr_data->notify()) return false;   // no buffer: try again next loop
  ++g_seq;
  // Only advance if the producer has not already pushed g_send past us.
  g_send.compare_exchange_strong(snd, snd + n);
  return true;
}

static void sendStatus() {
  proto::Status st{};
  st.h.magic = proto::MAGIC;
  st.h.type = proto::TYPE_STATUS;
  st.h.seq = g_seq++;
  st.h.swing_id = g_swing_id;
  st.h.flags = g_swing_active ? proto::SWING_ACTIVE : 0;
  st.h.n = 0;
  st.h.t0_us = (uint32_t)esp_timer_get_time();
  st.battery_mv = 0;   // not read
  st.sample_period_ns = g_period_ns;
  st.imu_who_am_i = imu::who;
  st.accel_fs_g = cfg::ACCEL_FS_G;
  st.gyro_fs_dps = cfg::GYRO_FS_DPS;
  st.dropped_samples = g_dropped;
  st.fw_major = cfg::FW_MAJOR;
  st.fw_minor = cfg::FW_MINOR;
  g_chr_data->setValue(reinterpret_cast<uint8_t*>(&st), sizeof st);
  g_chr_data->notify();
}

// -----------------------------------------------------------------------------
//  Sleep
// -----------------------------------------------------------------------------
[[noreturn]] static void goToSleep(const char* why) {
  Serial.printf("[pod] sleeping: %s\n", why);
  Serial.flush();
  digitalWrite(cfg::PIN_LED, HIGH);
  detachInterrupt(cfg::PIN_IMU_INT1);
  g_stop_imu = true;
  delay(20);   // the IMU task checks the flag at least every 5 ms
  NimBLEDevice::deinit(true);
  if (imu::addr) {
    imu::configureWake(8);   // 8 x 31 mg = 0.25 g of change: picking the club up, not a breeze
    imu::read8(0x1B);        // read WAKE_UP_SRC (same address on both chips) to clear a pending event
  }
  esp_deep_sleep_enable_gpio_wakeup(1ULL << cfg::PIN_IMU_INT1, ESP_GPIO_WAKEUP_GPIO_HIGH);
  esp_deep_sleep_start();
  for (;;) {}
}

// -----------------------------------------------------------------------------
//  Arduino entry points
// -----------------------------------------------------------------------------
void setup() {
  pinMode(cfg::PIN_LED, OUTPUT);
  digitalWrite(cfg::PIN_LED, LOW);
  Serial.begin(115200);
  uint32_t t0 = millis();
  while (!Serial && millis() - t0 < 500) delay(10);   // do not wait for USB on battery
  Serial.printf("\n[pod] Stem shaft pod fw %u.%u, wake cause %d\n", cfg::FW_MAJOR, cfg::FW_MINOR,
                int(esp_sleep_get_wakeup_cause()));

  g_ring   = static_cast<proto::ImuRaw*>(malloc(cfg::RING_SAMPLES * sizeof(proto::ImuRaw)));
  g_ring_t = static_cast<uint32_t*>(malloc(cfg::RING_SAMPLES * sizeof(uint32_t)));
  if (!g_ring || !g_ring_t) {
    Serial.println("[pod] FATAL: no RAM for the sample ring");
    for (;;) { digitalWrite(cfg::PIN_LED, !digitalRead(cfg::PIN_LED)); delay(100); }
  }

  Wire.begin(cfg::PIN_SDA, cfg::PIN_SCL, cfg::I2C_HZ);
  if (!imu::probe()) {
    Serial.println("[pod] FATAL: no LSM6DS3TR-C / LSM6DSOX on I2C (0x6A/0x6B). Check SDA=6, SCL=7, 3V3.");
    for (;;) { digitalWrite(cfg::PIN_LED, !digitalRead(cfg::PIN_LED)); delay(250); }
  }
  Serial.printf("[pod] IMU 0x%02X at 0x%02X (%s)\n", imu::who, imu::addr,
                imu::who == imu::ID_LSM6DSOX ? "LSM6DSOX" : "LSM6DS3TR-C");
  if (!imu::configureCapture()) Serial.println("[pod] WARNING: an IMU register write failed");

  // Read once to clear a latched data-ready before the task owns the bus.
  imu::read(imu::OUTX_L_G, reinterpret_cast<uint8_t*>(&g_ring[0]), sizeof(proto::ImuRaw));

  g_last_motion_ms = millis();
  xTaskCreate(imuTask, "imu", 4096, nullptr, configMAX_PRIORITIES - 2, &g_imu_task);
  pinMode(cfg::PIN_IMU_INT1, INPUT);
  attachInterrupt(cfg::PIN_IMU_INT1, onImuDataReady, RISING);

  bleInit();
  Serial.println("[pod] advertising as STEMPOD");
}

void loop() {
  static uint32_t last_status_ms = 0, last_led_ms = 0;
  uint32_t now = millis();

  // Stream everything in bench mode; otherwise the swing in progress, then the
  // tail of the one that just ended. Between swings the send pointer follows
  // the write pointer, so the ring always holds the most recent 2.4 s and an
  // idle pod never reports dropped samples.
  uint32_t end_idx = g_swing_end_idx;
  bool closing = !g_swing_active && end_idx != UINT32_MAX;
  bool idle = !g_stream_always && !g_swing_active && !closing;
  if (idle) {
    g_send = g_write.load();
  } else if (connected()) {
    uint32_t target = (g_stream_always || g_swing_active) ? g_write.load() : end_idx;
    for (int burst = 0; burst < 8; ++burst)
      if (!sendImuPacket(target, closing)) break;
    if (closing && int32_t(g_send.load() - end_idx) >= 0) g_swing_end_idx = UINT32_MAX;
  } else if (closing) {
    g_swing_end_idx = UINT32_MAX;   // swing ended with nobody listening
  }

  if (now - last_status_ms >= 1000) {
    last_status_ms = now;
    if (connected()) sendStatus();
  }

  if (!g_swing_active && now - g_last_motion_ms >= cfg::SLEEP_AFTER_MS) goToSleep("no motion");

  // LED: slow blink advertising, short flash every 2 s when connected, solid
  // during a swing.
  uint32_t led_period = connected() ? 2000u : 500u;
  if (g_swing_active) {
    digitalWrite(cfg::PIN_LED, LOW);
  } else if (now - last_led_ms >= led_period) {
    last_led_ms = now;
    digitalWrite(cfg::PIN_LED, LOW);
    delay(connected() ? 20 : 2);
    digitalWrite(cfg::PIN_LED, HIGH);
  }

  delay(2);   // yields to the BLE host task; the IMU task runs at higher priority
}
