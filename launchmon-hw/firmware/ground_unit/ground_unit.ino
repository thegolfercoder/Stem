// =============================================================================
//  Stem launch monitor - GROUND RADAR UNIT firmware
//  Board : ESP32-C3 SuperMini   (Arduino-ESP32 core 3.x, "ESP32C3 Dev Module",
//          USB CDC On Boot: Enabled)
//  Radar : Infineon BGT24LTR11 24 GHz CW Doppler, I and Q IF outputs through
//          an optional LM358 pre-amp into ADC1
//  Radio : BLE central to the shaft pod and BLE peripheral to a phone, at the
//          same time (NimBLE-Arduino 2.x)
// =============================================================================
//
//  SIGNAL PATH
//    BGT24LTR11 IFI/IFQ -> pre-amp (AC-coupled 200 Hz - 15 kHz, biased at
//    0.9 V) -> GPIO0 / GPIO1 -> ADC1 in continuous DMA mode, 80 kS/s
//    interleaved, i.e. 40 kS/s per channel.
//
//  WHAT HAPPENS TO A SHOT
//  1. A 0.7 s ring buffer of I/Q pairs is always filling. This is the same
//     window launchmon-py's hardware.yaml uses for capture_window_s.
//  2. The trigger watches a signed Doppler metric, sum(Im(z[n] conj z[n-1])).
//     It is large only for fast targets moving AWAY from the radar: the
//     clubhead in the downswing and the ball after impact. A backswing or a
//     golfer stepping toward the unit has the opposite sign and does not fire
//     it. The I/Q front end is what buys this; a single-channel module cannot
//     tell the two apart.
//  3. On trigger, 0.2 s before and 0.5 s after are frozen and analysed: 1024-
//     point complex FFTs with Hann windows, hop 512 (25.6 ms frames, 39 Hz bins).
//  4. Club speed is the upper edge of the club's band just before impact.
//     Ball speed is the strongest tone above that edge after impact. The ratio
//     is checked against the same plausibility bounds launchmon-py uses. These
//     numbers are a PREVIEW: tagged low_confidence, because the drag-decay
//     fit and cross-checks that make the reference reading live in
//     launchmon-py, not here. The raw capture is streamed over USB so that
//     pipeline can be run on exactly the samples this unit saw.
//  5. If the pod is connected, its samples around impact give the peak shaft
//     angular rate (measured; refused if the gyro clipped) and the backswing to
//     downswing tempo ratio (derived; refused if the swing events are not found).
//  6. Output: one JSON line per shot on USB serial, one binary summary as a
//     BLE notification, and optionally the raw I/Q capture on USB.
//
//  WHAT IT WILL NOT REPORT
//  Spin rate, spin axis, face angle, club path, attack angle and swing plane.
//  This hardware cannot measure them. See the repository README.
//
//  SPEEDS ARE RADIAL
//  The radar measures speed along its own line of sight. The cosine correction
//  to true ball speed needs a launch angle, and is fusion's job. It is not
//  applied here.
//
//  PINS (SuperMini)                   see docs/wiring_schematic.md
//      GPIO0  ADC1_CH0 <- I channel (pre-amp output)
//      GPIO1  ADC1_CH1 <- Q channel
//      GPIO3  ADC1_CH3 <- DOCK+ (pod charging contact) via 470k/330k (read between shots)
//      GPIO4  ADC1_CH4 <- battery via 100k/100k divider (read between shots)
//      GPIO5           -> radar enable, if the module has one (optional)
//      GPIO6           -> pod charging switch: 2N7002 gate, AO3401 high side (high = on)
//      GPIO7           -> piezo disc through 470 R, LEDC square wave
//      GPIO10          -> 5 mm status LED through 330 R
//      GPIO9           <- BOOT button: short press toggles raw USB streaming
//      GPIO20/21       UART0 RX/TX, auxiliary serial (Serial1)
//      GPIO2, GPIO8 are strapping pins and are left alone.
//
//  BUZZER AND POD CHARGING (docs/wiring_schematic.md, "Buzzer", "Dock charging")
//  The piezo never sounds while a capture is triggered or being analysed, and
//  the trigger stays disarmed until it has been silent for BUZZER_SETTLE_MS.
//  The pod's charging contacts are dead until a check, made with the radar
//  stream paused, finds a parked pod's beacon on them. Checks and non-urgent
//  beeps wait for the radar to be quiet (nothing moving in the beam for 1 s).
//  A swing keeps the beam busy through the backswing and downswing, so that
//  quiet does not come in the 0.2 s a capture keeps from before its trigger.
// =============================================================================

#include <Arduino.h>
#include <NimBLEDevice.h>
#include <algorithm>
#include <atomic>
#include <cmath>
#include "esp_idf_version.h"
#include "esp_adc/adc_continuous.h"
#include "esp_adc/adc_oneshot.h"
#include "esp_adc/adc_cali.h"
#include "esp_adc/adc_cali_scheme.h"
#include "esp_timer.h"

#if !defined(ESP_ARDUINO_VERSION_MAJOR) || ESP_ARDUINO_VERSION_MAJOR < 3
#error "This sketch needs the Arduino-ESP32 core 3.x (ESP-IDF 5.x)."
#endif
#if !CONFIG_IDF_TARGET_ESP32C3
#error "Written for the ESP32-C3: ADC1 channel numbers, the TYPE2 DMA format and the sample-rate limits are C3-specific."
#endif

// Optional parts. Set either to 0 if that part is not fitted; its GPIOs are
// then left untouched.
#ifndef STEM_BUZZER
#define STEM_BUZZER 1      // piezo disc on GPIO7
#endif
#ifndef STEM_POD_DOCK
#define STEM_POD_DOCK 1    // pod charging contacts: switch on GPIO6, sense on GPIO3
#endif

// -----------------------------------------------------------------------------
//  Configuration
// -----------------------------------------------------------------------------
namespace cfg {
constexpr uint8_t  FW_MAJOR = 0, FW_MINOR = 2;

constexpr int      PIN_I         = 0;     // ADC1_CH0
constexpr int      PIN_Q         = 1;     // ADC1_CH1
constexpr int      PIN_BATT      = 4;     // ADC1_CH4
constexpr int      PIN_RADAR_EN  = -1;    // set to 5 if your module has an enable pin
constexpr bool     RADAR_EN_ACTIVE_HIGH = true;
constexpr int      PIN_LED       = 10;
constexpr int      PIN_BUTTON    = 9;     // BOOT button, active low
constexpr int      PIN_AUX_RX    = 20;
constexpr int      PIN_AUX_TX    = 21;
constexpr uint32_t AUX_BAUD      = 115200;
constexpr int      PIN_DOCK_SENSE = 3;    // ADC1_CH3
constexpr int      PIN_DOCK_EN   = 6;     // high turns the pod charging contacts on
constexpr int      PIN_BUZZER    = 7;

constexpr adc_channel_t CH_I    = ADC_CHANNEL_0;
constexpr adc_channel_t CH_Q    = ADC_CHANNEL_1;
constexpr adc_channel_t CH_DOCK = ADC_CHANNEL_3;
constexpr adc_channel_t CH_BATT = ADC_CHANNEL_4;
#if ESP_IDF_VERSION >= ESP_IDF_VERSION_VAL(5, 2, 0)
constexpr adc_atten_t ADC_ATTEN = ADC_ATTEN_DB_12;   // ~0-2.5 V usable on the C3
#else
constexpr adc_atten_t ADC_ATTEN = ADC_ATTEN_DB_11;
#endif

// Sampling. The C3's continuous ADC tops out at 83.3 kS/s in total, and two
// channels share it.
constexpr uint32_t ADC_TOTAL_HZ  = 80000;
constexpr uint32_t FS_HZ         = ADC_TOTAL_HZ / 2;         // per channel
constexpr size_t   ADC_FRAME_BYTES = 256 * SOC_ADC_DIGI_RESULT_BYTES;

// Capture window, as in launchmon-py config/hardware.yaml (capture_window_s).
constexpr size_t   CAPTURE_PAIRS    = 28000;    // 0.7 s
constexpr size_t   PRETRIGGER_PAIRS = 8000;     // 0.2 s kept from before the trigger

// Radar
constexpr double   RADAR_TX_HZ   = 24.125e9;    // nominal; a module's real carrier differs
constexpr double   C_MPS         = 299792458.0;
constexpr float    MPS_PER_HZ    = float(C_MPS / (2.0 * RADAR_TX_HZ));   // 6.21 mm/s per Hz
// Which sign of Doppler frequency means "moving away". It depends on which IF
// output is wired to which pin. Set it with the bench check in
// docs/build_instructions.md: move a hand AWAY from the window and watch the
// trigger metric printed with 'd'. It should go strongly positive.
constexpr int      RECEDING_SIGN = +1;

// Front-end passband, as configured in launchmon-py hardware.yaml. A tone
// outside it has been attenuated by an unknown amount and is refused.
constexpr float    BAND_LOW_HZ   = 200.0f;
constexpr float    BAND_HIGH_HZ  = 15000.0f;

// Analysis. These mirror launchmon-py/launchmon/dsp/presets.py where a
// counterpart exists. They are calibrations, not measurements.
constexpr size_t   FFT_N         = 1024;
constexpr size_t   HOP           = 512;
constexpr float    MIN_SNR_DB    = 15.0f;    // peak over median floor; ridge min_snr_db
// The largest of ~380 noise-only bins sits about 9.4 dB over their median simply
// because it is the largest (launchmon-py README). 15 dB keeps clear of that.
constexpr float    EDGE_DROP_DB  = 12.0f;    // club band upper edge; edge_drop_db
constexpr int      FRAMES_BEFORE_IMPACT = 4; // n_frames_before_impact
constexpr int      MIN_FRAMES    = 3;        // min_frames
constexpr float    BALL_ABOVE_CLUB = 1.15f;  // a ball candidate must be this far above the club edge
constexpr float    SMASH_MIN = 1.05f, SMASH_MAX = 1.60f;   // implied_smash_bounds

// Trigger: signed Doppler power over the idle noise level, per 256-pair block.
constexpr size_t   TRIG_BLOCK    = 256;
constexpr float    TRIG_RATIO    = 25.0f;    // ~14 dB; raise it if wind or a flag sets it off

// Pod (must match firmware/shaft_pod)
const char* const  UUID_POD_SVC  = "7d2a0001-5b1c-4f6e-9c1e-3a6f1f0c2b10";
const char* const  UUID_POD_DATA = "7d2a0002-5b1c-4f6e-9c1e-3a6f1f0c2b10";
constexpr float    POD_GYRO_DPS_PER_LSB = 0.070f;
constexpr int16_t  POD_CLIP_COUNTS = 32700;
constexpr size_t   POD_RING      = 4096;     // ~2.5 s at 1.66 kHz

// Phone telemetry service
const char* const  BLE_NAME      = "STEM-RADAR";
const char* const  UUID_GND_SVC  = "7d2a0101-5b1c-4f6e-9c1e-3a6f1f0c2b10";
const char* const  UUID_GND_SHOT = "7d2a0102-5b1c-4f6e-9c1e-3a6f1f0c2b10";

constexpr uint32_t BATT_PERIOD_MS = 30000;
constexpr float    BATT_DIVIDER   = 2.0f;
constexpr uint16_t BATT_LOW_MV    = 3500;

// "Quiet": no Doppler of either sign above QUIET_RATIO x the trigger's noise
// level for QUIET_MS, and no pod swing. The backswing and downswing keep the
// beam busy for about a second before impact, so anything that waits for quiet
// happens well before a trigger, outside the 0.2 s a capture keeps from before it.
constexpr float    QUIET_RATIO   = 4.0f;     // the noise learner's own "quiet" test
constexpr uint32_t QUIET_MS      = 1000;

// Buzzer: a bare 15 mm piezo disc bonded inside the case, driven single-ended
// with a 50% square wave. A mounted disc is loudest at its mounted resonance,
// which is lower than the free disc's: tune BUZZER_HZ by ear on the built unit.
constexpr uint32_t BUZZER_HZ        = 4000;
constexpr uint8_t  BUZZER_RES_BITS  = 8;
constexpr uint32_t BUZZER_DUTY      = 1u << (BUZZER_RES_BITS - 1);   // 50%
constexpr uint32_t BUZZER_SETTLE_MS = 30;      // silent this long before the trigger may arm
constexpr uint32_t BEEP_MAX_WAIT_MS = 30000;   // a non-urgent beep that found no quiet by then is dropped
constexpr uint32_t BATT_LOW_REPEAT_MS = 5UL * 60UL * 1000UL;

// Pod charging contacts (DOCK+ / DOCK-). Voltages are at DOCK+.
constexpr float    DOCK_DIVIDER      = (470.0f + 330.0f) / 330.0f;
constexpr uint16_t DOCK_PRESENT_MV   = 1600;   // switch off: a parked pod's beacon reads 2.2-2.8 V
constexpr uint16_t DOCK_KEEP_MV      = 1200;   // while charging, the beacon must stay above this
constexpr uint16_t DOCK_FOREIGN_MV   = 4300;   // switch off and this high: something powered is on the contacts
constexpr uint16_t DOCK_ON_MIN_MV    = 4000;   // switch on and below this: overload
constexpr uint32_t DOCK_POLL_MS      = 3000;   // look for a pod this often, when quiet
constexpr uint32_t DOCK_CONFIRM_MS   = 300;    // a second look before switching on
constexpr uint32_t DOCK_CHECK_MS     = 5000;   // while charging, check the pod is still there, when quiet
constexpr uint32_t DOCK_CHECK_MAX_MS = 60000;  // and at least this often, quiet or not
constexpr uint32_t DOCK_OFF_SETTLE_MS = 30;    // switch off -> beacon readable: gate RC 4.7 ms, sense RC 1.9 ms
constexpr uint32_t DOCK_ON_SETTLE_MS = 20;     // switch on -> DOCK+ up: soft start ~0.5 ms
constexpr uint32_t DOCK_ARM_SETTLE_MS = 100;   // no trigger this long after the switch changes the 5 V load
constexpr uint32_t DOCK_LOCKOUT_MS   = 30000;  // after a fault; doubles on each repeat
constexpr uint32_t DOCK_LOCKOUT_MAX_MS = 600000;
constexpr uint32_t DOCK_POD_TRUST_MS = 2500;   // a pod status this long after a switch change reflects it
constexpr uint16_t DOCK_MIN_BATT_MV  = 3550;   // stop charging the pod below this: the unit's own run time first
constexpr uint16_t DOCK_RESUME_BATT_MV = 3700;
}  // namespace cfg

// -----------------------------------------------------------------------------
//  Readings: a number, or a refusal with a reason. Mirrors launchmon.quantity.
// -----------------------------------------------------------------------------
enum class Prov : uint8_t { NONE = 0, MEASURED = 1, DERIVED = 2, LOW_CONFIDENCE = 3, MODELLED = 4 };

enum class Refusal : uint8_t {
  OK = 0,
  NO_TRIGGER_DATA,        // capture did not contain a usable shot
  CLUB_NOT_RESOLVED,      // fewer than MIN_FRAMES valid club frames before impact
  NO_IMPACT,              // no tone appeared above the club band
  BALL_TRACK_SHORT,       // fewer than MIN_FRAMES valid ball frames
  BALL_TRACK_INCONSISTENT,
  OUT_OF_PASSBAND,        // tone outside the analogue passband
  SMASH_IMPLAUSIBLE,      // ball/club outside the plausibility bounds
  POD_NOT_CONNECTED,
  POD_NO_DATA,            // no pod samples covering the impact
  GYRO_CLIPPED,           // gyro at full scale in the window: the peak is unknown
  SWING_EVENTS_NOT_FOUND,
  DEPENDS_ON_REFUSED,     // derived from a reading that was refused
};

static const char* refusalText(Refusal r) {
  switch (r) {
    case Refusal::OK: return "";
    case Refusal::NO_TRIGGER_DATA: return "capture held no usable shot";
    case Refusal::CLUB_NOT_RESOLVED: return "club band not resolved before impact";
    case Refusal::NO_IMPACT: return "no tone appeared above the club band";
    case Refusal::BALL_TRACK_SHORT: return "ball tracked in too few frames";
    case Refusal::BALL_TRACK_INCONSISTENT: return "ball track rose after launch";
    case Refusal::OUT_OF_PASSBAND: return "tone outside the front-end passband";
    case Refusal::SMASH_IMPLAUSIBLE: return "implied smash factor outside plausible bounds";
    case Refusal::POD_NOT_CONNECTED: return "pod not connected";
    case Refusal::POD_NO_DATA: return "no pod samples cover the impact";
    case Refusal::GYRO_CLIPPED: return "gyro at full scale (2000 dps) during the downswing";
    case Refusal::SWING_EVENTS_NOT_FOUND: return "takeaway or top of swing not found";
    case Refusal::DEPENDS_ON_REFUSED: return "depends on a refused reading";
  }
  return "unknown";
}

struct Reading {
  float   value = NAN;
  Prov    prov = Prov::NONE;
  Refusal refusal = Refusal::NO_TRIGGER_DATA;
  static Reading of(float v, Prov p) { Reading r; r.value = v; r.prov = p; r.refusal = Refusal::OK; return r; }
  static Reading no(Refusal why) { Reading r; r.refusal = why; return r; }
  bool ok() const { return refusal == Refusal::OK; }
};

static const char* provText(Prov p) {
  switch (p) {
    case Prov::MEASURED: return "measured";
    case Prov::DERIVED: return "derived";
    case Prov::LOW_CONFIDENCE: return "low_confidence";
    case Prov::MODELLED: return "modelled";
    default: return "none";
  }
}

// Binary summary sent to the phone. Little-endian, packed.
struct __attribute__((packed)) WireReading { float value; uint8_t prov; uint8_t refusal; };
struct __attribute__((packed)) ShotSummary {
  uint8_t     magic = 0x5A, version = 1;
  uint16_t    shot_seq;
  uint32_t    impact_ms;              // ground clock
  WireReading ball_speed_radial;      // m/s along the radar's line of sight
  WireReading club_speed_radial;      // m/s
  WireReading smash;                  // ratio
  WireReading peak_shaft_rate;        // deg/s, pod
  WireReading tempo_ratio;            // backswing / downswing duration
  uint16_t    battery_mv_ground, battery_mv_pod;
};

// -----------------------------------------------------------------------------
//  I/Q capture ring (heap; 112 KB).
// -----------------------------------------------------------------------------
static int16_t (*g_iq)[2] = nullptr;
static std::atomic<uint32_t> g_iq_written{0};       // pairs written, runs forever
static std::atomic<bool>     g_armed{true};
static std::atomic<bool>     g_triggered{false};
static std::atomic<uint32_t> g_trigger_at{0};       // pair index of the trigger
static std::atomic<bool>     g_capture_ready{false};
static std::atomic<uint32_t> g_capture_end{0};      // pair index one past the frozen capture
static volatile int64_t      g_capture_end_us = 0;  // ground clock when the last pair was stored
static std::atomic<bool>     g_user_armed{true};    // serial 'a' toggles
static std::atomic<uint32_t> g_desync{0};           // Q without a preceding I (should stay 0)
static volatile float        g_trig_metric = 0, g_trig_noise = 0;
static volatile bool         g_debug_trigger = false;

static adc_continuous_handle_t g_adc = nullptr;
static TaskHandle_t            g_adc_task = nullptr;
static SemaphoreHandle_t       g_adc_lock = nullptr;   // held while reading DMA, and while stopping/starting

static bool IRAM_ATTR onAdcFrame(adc_continuous_handle_t, const adc_continuous_evt_data_t*, void*) {
  BaseType_t woken = pdFALSE;
  vTaskNotifyGiveFromISR(g_adc_task, &woken);
  return woken == pdTRUE;
}

static bool adcStreamStart() {
  adc_continuous_handle_cfg_t hcfg = {};
  hcfg.max_store_buf_size = 4 * cfg::ADC_FRAME_BYTES;
  hcfg.conv_frame_size = cfg::ADC_FRAME_BYTES;
  if (adc_continuous_new_handle(&hcfg, &g_adc) != ESP_OK) return false;

  // Pattern order sets sampling order: I, then Q one conversion (12.5 us) later.
  // analyse() corrects for that half-sample skew.
  adc_digi_pattern_config_t pattern[2] = {};
  const adc_channel_t chans[2] = {cfg::CH_I, cfg::CH_Q};
  for (int i = 0; i < 2; ++i) {
    pattern[i].atten = cfg::ADC_ATTEN;
    pattern[i].channel = chans[i];
    pattern[i].unit = ADC_UNIT_1;
    pattern[i].bit_width = SOC_ADC_DIGI_MAX_BITWIDTH;
  }
  adc_continuous_config_t dcfg = {};
  dcfg.pattern_num = 2;
  dcfg.adc_pattern = pattern;
  dcfg.sample_freq_hz = cfg::ADC_TOTAL_HZ;
  dcfg.conv_mode = ADC_CONV_SINGLE_UNIT_1;
  dcfg.format = ADC_DIGI_OUTPUT_FORMAT_TYPE2;
  if (adc_continuous_config(g_adc, &dcfg) != ESP_OK) return false;

  adc_continuous_evt_cbs_t cbs = {};
  cbs.on_conv_done = onAdcFrame;
  if (adc_continuous_register_event_callbacks(g_adc, &cbs, nullptr) != ESP_OK) return false;
  return adc_continuous_start(g_adc) == ESP_OK;
}

static void adcStreamStop() {
  if (!g_adc) return;
  adc_continuous_stop(g_adc);
  adc_continuous_deinit(g_adc);
  g_adc = nullptr;
}

// One-shot readings (battery, pod charging contact). The continuous driver owns
// ADC1 while it runs, so it is stopped, fn runs with a one-shot unit open, and
// the stream is started again. Only done between shots.
// The stream pauses for a few milliseconds here, which leaves a gap in the
// ring. It only runs while nothing is triggered, and the next shot's 0.2 s
// pre-trigger is refilled within 0.2 s of restarting.
template <typename F> static void withAdcPaused(F&& fn) {
  if (g_adc_lock) xSemaphoreTake(g_adc_lock, portMAX_DELAY);
  bool was_streaming = g_adc != nullptr;
  adcStreamStop();
  adc_oneshot_unit_handle_t unit = nullptr;
  adc_oneshot_unit_init_cfg_t ucfg = {};
  ucfg.unit_id = ADC_UNIT_1;
  if (adc_oneshot_new_unit(&ucfg, &unit) == ESP_OK) {
    fn(unit);
    adc_oneshot_del_unit(unit);
  }
  if (was_streaming && !adcStreamStart()) Serial.println("{\"type\":\"error\",\"msg\":\"ADC restart failed\"}");
  if (g_adc_lock) xSemaphoreGive(g_adc_lock);
}

// Calibrated millivolts at the pin, averaged over 16 conversions.
static int oneshotMv(adc_oneshot_unit_handle_t unit, adc_channel_t ch) {
  adc_oneshot_chan_cfg_t ccfg = {};
  ccfg.atten = cfg::ADC_ATTEN;
  ccfg.bitwidth = ADC_BITWIDTH_DEFAULT;
  adc_oneshot_config_channel(unit, ch, &ccfg);
  adc_cali_handle_t cali = nullptr;
  adc_cali_curve_fitting_config_t cc = {};
  cc.unit_id = ADC_UNIT_1;
  cc.chan = ch;
  cc.atten = cfg::ADC_ATTEN;
  cc.bitwidth = ADC_BITWIDTH_DEFAULT;
  bool have_cali = adc_cali_create_scheme_curve_fitting(&cc, &cali) == ESP_OK;
  int sum = 0, raw = 0, mv = 0;
  for (int i = 0; i < 16; ++i) { adc_oneshot_read(unit, ch, &raw); sum += raw; }
  raw = sum / 16;
  if (have_cali) adc_cali_raw_to_voltage(cali, raw, &mv);
  else mv = raw * 2500 / 4095;
  if (have_cali) adc_cali_delete_scheme_curve_fitting(cali);
  return mv;
}

static uint16_t readBatteryMv() {
  int mv = 0;
  withAdcPaused([&](adc_oneshot_unit_handle_t unit) { mv = oneshotMv(unit, cfg::CH_BATT); });
  return uint16_t(mv * cfg::BATT_DIVIDER);
}

// Reads DMA frames, pairs I with Q, fills the ring and runs the trigger.
static void adcTask(void*) {
  static uint8_t buf[cfg::ADC_FRAME_BYTES];
  bool have_i = false;
  int16_t pending_i = 0;
  // Trigger state, per block.
  float mean_i = 2048, mean_q = 2048, prev_i = 0, prev_q = 0;
  float acc_s = 0, acc_i = 0, acc_q = 0;
  size_t block_n = 0;
  float noise = 0;
  int warmup_blocks = 64;

  for (;;) {
    ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(20));
    xSemaphoreTake(g_adc_lock, portMAX_DELAY);
    uint32_t got = 0;
    while (g_adc && adc_continuous_read(g_adc, buf, sizeof buf, &got, 0) == ESP_OK) {
      for (uint32_t i = 0; i + SOC_ADC_DIGI_RESULT_BYTES <= got; i += SOC_ADC_DIGI_RESULT_BYTES) {
        auto* p = reinterpret_cast<adc_digi_output_data_t*>(&buf[i]);
        uint32_t ch = p->type2.channel;
        int16_t v = int16_t(p->type2.data);
        if (ch == cfg::CH_I) { pending_i = v; have_i = true; continue; }
        if (ch != cfg::CH_Q) continue;
        if (!have_i) { g_desync.fetch_add(1); continue; }
        have_i = false;

        // Store the pair, unless a capture is frozen waiting for analysis.
        if (g_capture_ready) continue;
        uint32_t w = g_iq_written.load(std::memory_order_relaxed);
        g_iq[w % cfg::CAPTURE_PAIRS][0] = pending_i;
        g_iq[w % cfg::CAPTURE_PAIRS][1] = v;
        g_iq_written.store(w + 1, std::memory_order_release);

        if (g_triggered) {
          if (w + 1 - g_trigger_at.load() >= cfg::CAPTURE_PAIRS - cfg::PRETRIGGER_PAIRS) {
            g_capture_end = w + 1;
            g_capture_end_us = esp_timer_get_time();
            g_triggered = false;
            g_capture_ready = true;
          }
          continue;
        }

        // Signed Doppler metric: Im(z[n] * conj(z[n-1])) with z = I + jQ, DC
        // removed using the previous block's means.
        float ci = pending_i - mean_i, cq = v - mean_q;
        acc_s += cq * prev_i - ci * prev_q;
        prev_i = ci; prev_q = cq;
        acc_i += pending_i; acc_q += v;
        if (++block_n == cfg::TRIG_BLOCK) {
          float s = cfg::RECEDING_SIGN * acc_s / cfg::TRIG_BLOCK;
          mean_i = acc_i / cfg::TRIG_BLOCK; mean_q = acc_q / cfg::TRIG_BLOCK;
          acc_s = acc_i = acc_q = 0; block_n = 0;
          float mag = fabsf(s);
          if (warmup_blocks > 0) { noise = noise == 0 ? mag : 0.9f * noise + 0.1f * mag; --warmup_blocks; }
          else if (mag < 4 * noise) noise = 0.995f * noise + 0.005f * mag;   // learn only from quiet
          g_trig_metric = s; g_trig_noise = noise;
          if (g_armed && warmup_blocks == 0 && noise > 0 && s > cfg::TRIG_RATIO * noise &&
              w + 1 >= cfg::PRETRIGGER_PAIRS) {
            g_trigger_at = w + 1;
            g_triggered = true;
          }
        }
      }
    }
    xSemaphoreGive(g_adc_lock);
  }
}

// -----------------------------------------------------------------------------
//  FFT: iterative radix-2, in place, float. The C3 has no FPU, so a 1024-point
//  transform costs some tens of milliseconds. Only frames inside a capture are
//  transformed, never the live stream.
// -----------------------------------------------------------------------------
static float g_re[cfg::FFT_N], g_im[cfg::FFT_N];
static float g_win[cfg::FFT_N], g_cos[cfg::FFT_N / 2], g_sin[cfg::FFT_N / 2];
static float g_qc_cos[cfg::FFT_N / 2 + 1], g_qc_sin[cfg::FFT_N / 2 + 1];   // Q skew correction
static float g_mag[cfg::FFT_N / 2];   // |Z|^2 on the receding side, by bin index
static float g_tmp[cfg::FFT_N / 2];

static void fftInit() {
  for (size_t n = 0; n < cfg::FFT_N; ++n) g_win[n] = 0.5f - 0.5f * cosf(2.0f * float(M_PI) * n / cfg::FFT_N);
  for (size_t k = 0; k < cfg::FFT_N / 2; ++k) {
    g_cos[k] = cosf(2.0f * float(M_PI) * k / cfg::FFT_N);
    g_sin[k] = -sinf(2.0f * float(M_PI) * k / cfg::FFT_N);
  }
  // exp(-j*pi*k/N) for k = 0..N/2 (k = N/2 is the Nyquist bin: left alone).
  for (size_t k = 0; k <= cfg::FFT_N / 2; ++k) {
    float ph = (k == cfg::FFT_N / 2) ? 0.0f : -float(M_PI) * float(k) / float(cfg::FFT_N);
    g_qc_cos[k] = cosf(ph);
    g_qc_sin[k] = sinf(ph);
  }
}

static void fft(float* re, float* im) {
  const size_t N = cfg::FFT_N;
  for (size_t i = 1, j = 0; i < N; ++i) {           // bit reversal
    size_t bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { std::swap(re[i], re[j]); std::swap(im[i], im[j]); }
  }
  for (size_t len = 2; len <= N; len <<= 1) {
    size_t step = N / len;
    for (size_t i = 0; i < N; i += len) {
      for (size_t k = 0; k < len / 2; ++k) {
        float wr = g_cos[k * step], wi = g_sin[k * step];
        size_t a = i + k, b = a + len / 2;
        float tr = re[b] * wr - im[b] * wi;
        float ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr;        im[a] += ti;
      }
    }
  }
}

// Spectrum of one frame of the capture, starting at pair k0 (0 = oldest).
// Leaves |Z(f)|^2 for receding frequencies in g_mag[0 .. N/2).
static void spectrumFrame(size_t k0, uint32_t first) {
  const size_t N = cfg::FFT_N;
  float mi = 0, mq = 0;
  for (size_t n = 0; n < N; ++n) {
    const int16_t* s = g_iq[(first + k0 + n) % cfg::CAPTURE_PAIRS];
    mi += s[0]; mq += s[1];
  }
  mi /= N; mq /= N;
  for (size_t n = 0; n < N; ++n) {
    const int16_t* s = g_iq[(first + k0 + n) % cfg::CAPTURE_PAIRS];
    g_re[n] = g_win[n] * (s[0] - mi);   // I and Q packed into one complex transform
    g_im[n] = g_win[n] * (s[1] - mq);
  }
  fft(g_re, g_im);

  // Separate the I and Q spectra, delay-correct Q, recombine as Z = I + jQ.
  // Q is converted half a per-channel sample after I, so Q's spectrum carries
  // a phase of +pi*f/fs. At 15 kHz that is 67 degrees: enough to wreck the
  // separation of receding from approaching targets if left in. Multiplying by
  // exp(-j*pi*k/N), with k signed, removes it exactly, with no amplitude loss.
  for (size_t k = 0; k <= N / 2; ++k) {
    size_t m = (N - k) % N;
    float xr_k = g_re[k], xi_k = g_im[k], xr_m = g_re[m], xi_m = g_im[m];
    float ir_k = 0.5f * (xr_k + xr_m), ii_k = 0.5f * (xi_k - xi_m);   // I(k)
    float qr_k = 0.5f * (xi_k + xi_m), qi_k = -0.5f * (xr_k - xr_m);  // Q(k)
    // Bins k and N-k are conjugate partners for real I and Q.
    float ir_m = ir_k, ii_m = -ii_k, qr_m = qr_k, qi_m = -qi_k;
    // Bin k is frequency +k, bin N-k is frequency -k: opposite phases.
    float c = g_qc_cos[k], sn = g_qc_sin[k];
    float qcr_k = qr_k * c - qi_k * sn, qci_k = qr_k * sn + qi_k * c;
    float qcr_m = qr_m * c + qi_m * sn, qci_m = -qr_m * sn + qi_m * c;
    // Z = I + jQc
    g_re[k] = ir_k - qci_k; g_im[k] = ii_k + qcr_k;
    if (m != k) { g_re[m] = ir_m - qci_m; g_im[m] = ii_m + qcr_m; }
  }
  for (size_t k = 0; k < N / 2; ++k) {
    size_t idx = (cfg::RECEDING_SIGN > 0) ? k : (N - k) % N;
    g_mag[k] = g_re[idx] * g_re[idx] + g_im[idx] * g_im[idx];
  }
}

static constexpr float HZ_PER_BIN = float(cfg::FS_HZ) / float(cfg::FFT_N);
static constexpr int   K_LO = int(cfg::BAND_LOW_HZ / HZ_PER_BIN) + 1;
static constexpr int   K_HI = int(cfg::BAND_HIGH_HZ / HZ_PER_BIN);

// Median of g_mag over the band: the noise floor for this frame.
static float bandFloor() {
  int n = 0;
  for (int k = K_LO; k <= K_HI; ++k) g_tmp[n++] = g_mag[k];
  std::nth_element(g_tmp, g_tmp + n / 2, g_tmp + n);
  return g_tmp[n / 2];
}

static int strongestBin(int k_from, int k_to) {
  int best = -1;
  float bm = 0;
  for (int k = std::max(k_from, K_LO); k <= std::min(k_to, K_HI); ++k)
    if (g_mag[k] > bm) { bm = g_mag[k]; best = k; }
  return best;
}

// Parabolic interpolation on log magnitude: sub-bin peak position in bins.
static float interpolatedBin(int k) {
  if (k <= 0 || k >= int(cfg::FFT_N / 2) - 1) return float(k);
  float a = logf(g_mag[k - 1] + 1e-12f), b = logf(g_mag[k] + 1e-12f), c = logf(g_mag[k + 1] + 1e-12f);
  float den = a - 2 * b + c;
  return den < 0 ? k + 0.5f * (a - c) / den : float(k);
}

// Upper edge of the band around peak bin k: walk up while within EDGE_DROP_DB.
static int upperEdge(int k) {
  float thr = g_mag[k] * powf(10.0f, -cfg::EDGE_DROP_DB / 10.0f);
  while (k + 1 <= K_HI && g_mag[k + 1] >= thr) ++k;
  return k;
}

static inline float snrDb(float peak, float floor) { return 10.0f * log10f((peak + 1e-12f) / (floor + 1e-12f)); }

// -----------------------------------------------------------------------------
//  Pod link: BLE central. Samples are stored with ground-clock timestamps.
// -----------------------------------------------------------------------------
struct __attribute__((packed)) PodHeader { uint8_t magic, type; uint16_t seq, swing_id; uint8_t flags, n; uint32_t t0_us; };
struct __attribute__((packed)) PodImu { int16_t gx, gy, gz, ax, ay, az; };
struct __attribute__((packed)) PodStatus {
  PodHeader h; uint16_t battery_mv; uint32_t sample_period_ns; uint8_t who, accel_fs_g;
  uint16_t gyro_fs_dps; uint32_t dropped; uint8_t fw_major, fw_minor;
};
// Appended to the status packet by pod firmware 0.2 and later. Older pods send
// the 28-byte status alone, and these stay unknown (0).
struct __attribute__((packed)) PodPower { uint8_t flags; uint16_t dock_pad_mv; };
namespace podpower {
constexpr uint8_t DOCK_POWER = 1 << 0;   // the pod sees the dock's 5 V on its DOCK+ pad
constexpr uint8_t USB_HOST   = 1 << 1;   // its own USB-C is plugged into a computer
constexpr uint8_t CHARGING   = 1 << 2;   // on dock power and not yet judged full (an estimate)
constexpr uint8_t CHARGED    = 1 << 3;   // cell held at the charger's 4.2 V long enough to call full (an estimate)
}
static_assert(sizeof(PodHeader) == 12 && sizeof(PodImu) == 12, "must match the pod");
static_assert(sizeof(PodStatus) == 28 && sizeof(PodPower) == 3, "must match the pod");

struct PodSample { PodImu s; uint32_t t_ground_us; uint32_t t_pod_us; };   // 20 bytes, as streamed
static_assert(sizeof(PodImu) + 8 == 20, "IMU block record layout is part of the USB format");
static PodSample*             g_pod = nullptr;
static std::atomic<uint32_t>  g_pod_written{0};
static portMUX_TYPE           g_pod_mux = portMUX_INITIALIZER_UNLOCKED;
static int64_t                g_pod_offset_us = INT64_MAX;   // ground - pod, minimum-latency estimate
static volatile uint32_t      g_pod_period_ns = 600240;      // updated from status packets
static volatile uint16_t      g_pod_batt_mv = 0;
static volatile uint32_t      g_pod_dropped = 0;
static volatile uint32_t      g_pod_swing_ms = 0;            // last packet flagged SWING_ACTIVE
static volatile bool          g_pod_hold = false;            // set while the ring is streamed to USB
static volatile uint32_t      g_pod_dropped_held = 0;        // packets refused while held
static std::atomic<uint8_t>   g_pod_power{0};                // PodPower flags from the latest status
static std::atomic<uint16_t>  g_pod_pad_mv{0};
static std::atomic<uint32_t>  g_pod_power_ms{0};             // millis() of that status
static std::atomic<uint32_t>  g_pod_power_seq{0};            // counts statuses that carried PodPower
static std::atomic<bool>      g_pod_evt_connect{false};      // set in BLE callbacks, consumed by loop()
static std::atomic<bool>      g_pod_evt_disconnect{false};

static NimBLEClient*          g_pod_client = nullptr;
static NimBLEAddress          g_pod_addr;
static std::atomic<bool>      g_pod_found{false};

static void onPodNotify(NimBLERemoteCharacteristic*, uint8_t* data, size_t len, bool) {
  if (len < sizeof(PodHeader)) return;
  const auto* h = reinterpret_cast<const PodHeader*>(data);
  if (h->magic != 0xA7) return;
  int64_t rx_us = esp_timer_get_time();
  if (h->type == 2 && len >= sizeof(PodStatus)) {
    const auto* st = reinterpret_cast<const PodStatus*>(data);
    g_pod_batt_mv = st->battery_mv;
    if (st->sample_period_ns > 100000 && st->sample_period_ns < 10000000) g_pod_period_ns = st->sample_period_ns;
    g_pod_dropped = st->dropped;
    if (len >= sizeof(PodStatus) + sizeof(PodPower)) {
      const auto* pw = reinterpret_cast<const PodPower*>(data + sizeof(PodStatus));
      g_pod_power = pw->flags;
      g_pod_pad_mv = pw->dock_pad_mv;
      g_pod_power_ms = millis();
      g_pod_power_seq.fetch_add(1);
    }
    return;
  }
  if (h->type != 1 || len < sizeof(PodHeader) + h->n * sizeof(PodImu)) return;
  if (h->flags & 0x01) g_pod_swing_ms = millis();
  if (g_pod_hold) { g_pod_dropped_held = g_pod_dropped_held + 1; return; }

  // Clock alignment. rx time minus the last sample's pod time is the offset
  // plus that packet's transport delay. The smallest value seen is the best
  // estimate of the offset; it is allowed to creep up 1 us per packet to
  // follow crystal drift between the two boards. What remains is up to
  // about one connection interval (7.5 ms) and is stated, not hidden.
  uint32_t period_us = g_pod_period_ns / 1000;
  uint32_t t_last_pod = h->t0_us + (h->n ? (h->n - 1) * period_us : 0);
  int64_t candidate = rx_us - int64_t(t_last_pod);
  g_pod_offset_us = (g_pod_offset_us == INT64_MAX) ? candidate : std::min(g_pod_offset_us + 1, candidate);

  const auto* s = reinterpret_cast<const PodImu*>(data + sizeof(PodHeader));
  portENTER_CRITICAL(&g_pod_mux);
  uint32_t w = g_pod_written.load();
  for (uint8_t i = 0; i < h->n; ++i, ++w) {
    PodSample& d = g_pod[w % cfg::POD_RING];
    d.s = s[i];
    d.t_pod_us = h->t0_us + uint32_t(i) * period_us;
    d.t_ground_us = uint32_t(int64_t(d.t_pod_us) + g_pod_offset_us);
  }
  g_pod_written.store(w);
  portEXIT_CRITICAL(&g_pod_mux);
}

class PodScanCallbacks : public NimBLEScanCallbacks {
  void onResult(const NimBLEAdvertisedDevice* dev) override {
    if (dev->isAdvertisingService(NimBLEUUID(cfg::UUID_POD_SVC))) {
      g_pod_addr = dev->getAddress();
      g_pod_found = true;
      NimBLEDevice::getScan()->stop();
    }
  }
};

class PodClientCallbacks : public NimBLEClientCallbacks {
  void onConnect(NimBLEClient*) override {
    Serial.println("{\"type\":\"event\",\"msg\":\"pod connected\"}");
    g_pod_evt_connect = true;
  }
  void onDisconnect(NimBLEClient*, int reason) override {
    Serial.printf("{\"type\":\"event\",\"msg\":\"pod disconnected\",\"reason\":%d}\n", reason);
    g_pod_offset_us = INT64_MAX;
    g_pod_power = 0;
    g_pod_evt_disconnect = true;
  }
};

static PodScanCallbacks   g_scan_cb;
static PodClientCallbacks g_client_cb;

static bool podConnected() { return g_pod_client && g_pod_client->isConnected(); }

static void podService() {
  if (podConnected()) return;
  NimBLEScan* scan = NimBLEDevice::getScan();
  if (g_pod_found) {
    g_pod_found = false;
    if (!g_pod_client) {
      g_pod_client = NimBLEDevice::createClient();
      g_pod_client->setClientCallbacks(&g_client_cb, false);
      g_pod_client->setConnectionParams(6, 6, 0, 100);   // 7.5 ms, matches the pod's request
      g_pod_client->setConnectTimeout(5000);
    }
    if (!g_pod_client->connect(g_pod_addr)) return;
    NimBLERemoteService* svc = g_pod_client->getService(cfg::UUID_POD_SVC);
    NimBLERemoteCharacteristic* chr = svc ? svc->getCharacteristic(cfg::UUID_POD_DATA) : nullptr;
    if (!chr || !chr->canNotify() || !chr->subscribe(true, onPodNotify)) g_pod_client->disconnect();
    return;
  }
  if (!scan->isScanning()) scan->start(0, false);
}

// -----------------------------------------------------------------------------
//  Phone telemetry: BLE peripheral
// -----------------------------------------------------------------------------
static NimBLEServer*         g_server = nullptr;
static NimBLECharacteristic* g_chr_shot = nullptr;

class PhoneServerCallbacks : public NimBLEServerCallbacks {
  void onDisconnect(NimBLEServer*, NimBLEConnInfo&, int) override { NimBLEDevice::startAdvertising(); }
};
static PhoneServerCallbacks g_phone_cb;

static void bleInit() {
  NimBLEDevice::init(cfg::BLE_NAME);
  NimBLEDevice::setMTU(247);

  g_server = NimBLEDevice::createServer();
  g_server->setCallbacks(&g_phone_cb, false);
  NimBLEService* svc = g_server->createService(cfg::UUID_GND_SVC);
  g_chr_shot = svc->createCharacteristic(cfg::UUID_GND_SHOT, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);
  svc->start();
  NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
  adv->setName(cfg::BLE_NAME);
  adv->addServiceUUID(cfg::UUID_GND_SVC);
  adv->enableScanResponse(true);
  adv->start();

  NimBLEScan* scan = NimBLEDevice::getScan();
  scan->setScanCallbacks(&g_scan_cb, false);
  scan->setActiveScan(true);
  scan->setInterval(100);
  scan->setWindow(50);
}

// -----------------------------------------------------------------------------
//  Shot analysis
// -----------------------------------------------------------------------------
struct RadarResult {
  Reading ball, club, smash;
  uint32_t impact_pair = 0;     // pair index within the capture (0 = oldest)
  bool impact_found = false;
};

static RadarResult analyseRadar(uint32_t first) {
  RadarResult r;
  r.ball = r.club = r.smash = Reading::no(Refusal::NO_TRIGGER_DATA);
  const int n_frames = int((cfg::CAPTURE_PAIRS - cfg::FFT_N) / cfg::HOP) + 1;
  static int   edge[64];
  static bool  valid[64];
  static float ball_hz[64];
  if (n_frames > 64) return r;

  int impact = -1;
  int prev_edge = -1, club_ref = -1;
  for (int f = 0; f < n_frames; ++f) {
    spectrumFrame(size_t(f) * cfg::HOP, first);
    float floor = bandFloor();
    int pk = strongestBin(K_LO, K_HI);
    valid[f] = pk > 0 && snrDb(g_mag[pk], floor) >= cfg::MIN_SNR_DB;
    edge[f] = valid[f] ? upperEdge(pk) : -1;
    ball_hz[f] = NAN;

    // The reference for "above the club" is the club edge before impact,
    // frozen once impact is found.
    int ref = (impact < 0) ? prev_edge : club_ref;
    if (ref > 0) {
      int from = int(ceilf(ref * cfg::BALL_ABOVE_CLUB)) + 1;
      int b = strongestBin(from, K_HI);
      if (b > 0 && snrDb(g_mag[b], floor) >= cfg::MIN_SNR_DB) {
        if (impact < 0) { impact = f; club_ref = prev_edge; }
        ball_hz[f] = interpolatedBin(b) * HZ_PER_BIN;
      }
    }
    if (impact < 0 && valid[f]) prev_edge = edge[f];
  }

  if (impact < 0) {
    r.ball = r.smash = Reading::no(Refusal::NO_IMPACT);
  } else {
    r.impact_found = true;
    r.impact_pair = uint32_t(impact) * cfg::HOP + cfg::FFT_N / 2;
  }

  // Club: highest upper edge over the frames just before impact.
  if (impact >= 0) {
    int n_ok = 0, best = -1;
    for (int f = std::max(0, impact - cfg::FRAMES_BEFORE_IMPACT); f < impact; ++f)
      if (valid[f]) { ++n_ok; best = std::max(best, edge[f]); }
    if (n_ok < cfg::MIN_FRAMES) r.club = Reading::no(Refusal::CLUB_NOT_RESOLVED);
    else if (best >= K_HI) r.club = Reading::no(Refusal::OUT_OF_PASSBAND);
    else r.club = Reading::of(best * HZ_PER_BIN * cfg::MPS_PER_HZ, Prov::LOW_CONFIDENCE);
  }

  // Ball: the earliest frame wholly after impact, confirmed by the next two
  // not rising. Drag only slows a ball, so a track that climbs is not a ball.
  if (impact >= 0) {
    float track[cfg::MIN_FRAMES];
    int got = 0;
    for (int f = impact + 1; f < n_frames && got < cfg::MIN_FRAMES; ++f)
      if (!std::isnan(ball_hz[f])) track[got++] = ball_hz[f];
    if (got < cfg::MIN_FRAMES) {
      r.ball = Reading::no(Refusal::BALL_TRACK_SHORT);
    } else {
      bool falling = true;
      for (int i = 1; i < got; ++i) if (track[i] > track[i - 1] * 1.02f) falling = false;
      if (!falling) r.ball = Reading::no(Refusal::BALL_TRACK_INCONSISTENT);
      else if (track[0] >= cfg::BAND_HIGH_HZ) r.ball = Reading::no(Refusal::OUT_OF_PASSBAND);
      else r.ball = Reading::of(track[0] * cfg::MPS_PER_HZ, Prov::LOW_CONFIDENCE);
    }
  }

  // Smash, and the cross-check it provides.
  if (r.ball.ok() && r.club.ok()) {
    float sm = r.ball.value / r.club.value;
    if (sm < cfg::SMASH_MIN || sm > cfg::SMASH_MAX) {
      r.smash = Reading::no(Refusal::SMASH_IMPLAUSIBLE);
      r.ball = Reading::no(Refusal::SMASH_IMPLAUSIBLE);   // the ball reading is what is suspect
    } else {
      r.smash = Reading::of(sm, Prov::DERIVED);
    }
  } else if (impact >= 0) {
    r.smash = Reading::no(Refusal::DEPENDS_ON_REFUSED);
  }
  return r;
}

struct ImuResult { Reading peak_rate, tempo; };

static ImuResult analyseImu(uint32_t impact_ground_us) {
  ImuResult r;
  if (!podConnected() && g_pod_written == 0) {
    r.peak_rate = r.tempo = Reading::no(Refusal::POD_NOT_CONNECTED);
    return r;
  }
  // Copy out the samples from 2.4 s before impact to 0.1 s after.
  static float w_dps[cfg::POD_RING];
  static uint32_t t_us[cfg::POD_RING];
  static bool clipped[cfg::POD_RING];
  int n = 0;
  portENTER_CRITICAL(&g_pod_mux);
  uint32_t end = g_pod_written.load();
  uint32_t start = end > cfg::POD_RING ? end - cfg::POD_RING : 0;
  for (uint32_t i = start; i < end; ++i) {
    const PodSample& p = g_pod[i % cfg::POD_RING];
    int32_t dt = int32_t(p.t_ground_us - impact_ground_us);
    if (dt < -2400000 || dt > 100000) continue;
    float gx = p.s.gx, gy = p.s.gy, gz = p.s.gz;
    w_dps[n] = sqrtf(gx * gx + gy * gy + gz * gz) * cfg::POD_GYRO_DPS_PER_LSB;
    clipped[n] = abs(p.s.gx) >= cfg::POD_CLIP_COUNTS || abs(p.s.gy) >= cfg::POD_CLIP_COUNTS ||
                 abs(p.s.gz) >= cfg::POD_CLIP_COUNTS;
    t_us[n] = p.t_ground_us;
    ++n;
  }
  portEXIT_CRITICAL(&g_pod_mux);
  if (n < 100) { r.peak_rate = r.tempo = Reading::no(Refusal::POD_NO_DATA); return r; }

  auto rel = [&](int i) { return int32_t(t_us[i] - impact_ground_us); };

  // Peak shaft rate in the last 400 ms before impact.
  int pk = -1; bool any_clip = false;
  for (int i = 0; i < n; ++i) {
    if (rel(i) < -400000 || rel(i) > 50000) continue;
    any_clip |= clipped[i];
    if (pk < 0 || w_dps[i] > w_dps[pk]) pk = i;
  }
  if (pk < 0) r.peak_rate = Reading::no(Refusal::POD_NO_DATA);
  else if (any_clip) r.peak_rate = Reading::no(Refusal::GYRO_CLIPPED);
  else r.peak_rate = Reading::of(w_dps[pk], Prov::MEASURED);

  // Tempo. Top of the backswing = slowest point between 1.5 s and 0.15 s
  // before impact. Takeaway = walking back from the backswing's fastest point
  // until the shaft is nearly still.
  int top = -1;
  for (int i = 0; i < n; ++i) {
    if (rel(i) < -1500000 || rel(i) > -150000) continue;
    if (top < 0 || w_dps[i] < w_dps[top]) top = i;
  }
  int bs_peak = -1;
  for (int i = top - 1; top > 0 && i >= 0; --i) {
    if (bs_peak < 0 || w_dps[i] > w_dps[bs_peak]) bs_peak = i;
    if (rel(i) < rel(top) - 1500000) break;
  }
  int takeaway = -1;
  if (bs_peak >= 0 && w_dps[bs_peak] > 150.0f)
    for (int i = bs_peak; i >= 0; --i) if (w_dps[i] < 40.0f) { takeaway = i; break; }
  bool top_ok = top >= 0 && pk >= 0 && w_dps[top] < 0.5f * w_dps[pk];
  if (!top_ok || takeaway < 0) {
    r.tempo = Reading::no(Refusal::SWING_EVENTS_NOT_FOUND);
  } else {
    float back = float(t_us[top] - t_us[takeaway]);
    float down = float(impact_ground_us - t_us[top]);
    r.tempo = Reading::of(back / down, Prov::DERIVED);
  }
  return r;
}

// -----------------------------------------------------------------------------
//  Output
// -----------------------------------------------------------------------------
static void printReading(const char* name, const char* unit, const Reading& r, const char* source, bool last = false) {
  if (r.ok())
    Serial.printf("\"%s\":{\"value\":%.4g,\"unit\":\"%s\",\"provenance\":\"%s\",\"source\":\"%s\"}%s",
                  name, r.value, unit, provText(r.prov), source, last ? "" : ",");
  else
    Serial.printf("\"%s\":{\"no_reading\":\"%s\",\"source\":\"%s\"}%s", name, refusalText(r.refusal), source,
                  last ? "" : ",");
}

static WireReading wire(const Reading& r) {
  return WireReading{r.ok() ? r.value : NAN, uint8_t(r.prov), uint8_t(r.refusal)};
}

// Raw capture as a framed binary block on USB. A host splits it out of the
// JSON lines by the RAW_BEGIN header, which gives the exact byte count.
static void streamRaw(uint32_t first, uint16_t shot_seq) {
  // capture_end_us is the ground clock (32-bit microseconds) when the last pair
  // was stored; the IMU block below is on the same clock, which is what lets
  // launchmon-py's fusion put the two on one timeline.
  Serial.printf("RAW_BEGIN {\"shot_seq\":%u,\"pairs\":%u,\"fs_hz\":%u,\"format\":\"int16le I,Q; 12-bit ADC codes\","
                "\"q_lag_samples\":0.5,\"receding_sign\":%d,\"capture_end_us\":%lu,\"bytes\":%u}\n",
                shot_seq, unsigned(cfg::CAPTURE_PAIRS), unsigned(cfg::FS_HZ), cfg::RECEDING_SIGN,
                (unsigned long)uint32_t(g_capture_end_us), unsigned(cfg::CAPTURE_PAIRS * 4));
  static int16_t chunk[256][2];
  for (size_t k = 0; k < cfg::CAPTURE_PAIRS; k += 256) {
    size_t m = std::min<size_t>(256, cfg::CAPTURE_PAIRS - k);
    for (size_t j = 0; j < m; ++j) {
      chunk[j][0] = g_iq[(first + k + j) % cfg::CAPTURE_PAIRS][0];
      chunk[j][1] = g_iq[(first + k + j) % cfg::CAPTURE_PAIRS][1];
    }
    Serial.write(reinterpret_cast<uint8_t*>(chunk), m * 4);
  }
  Serial.println("\nRAW_END");
}

// The pod's samples held for this shot, as a framed binary block after the
// radar capture: 20 bytes each, int16 gx gy gz ax ay az (raw counts), then the
// sample's time on the ground clock and on the pod's own clock (uint32 us).
// Pod packets arriving while it is written are refused and counted, so the
// ring cannot change under the copy.
static void streamImu(uint16_t shot_seq) {
  g_pod_hold = true;
  portENTER_CRITICAL(&g_pod_mux);
  uint32_t end = g_pod_written.load();
  portEXIT_CRITICAL(&g_pod_mux);
  uint32_t start = end > cfg::POD_RING ? end - cfg::POD_RING : 0;
  uint32_t n = end - start;
  Serial.printf("IMU_BEGIN {\"shot_seq\":%u,\"n\":%lu,\"format\":\"int16le gx gy gz ax ay az, uint32le t_ground_us, "
                "uint32le t_pod_us\",\"gyro_dps_per_lsb\":%.4f,\"accel_g_per_lsb\":0.000488,\"clip_counts\":%d,"
                "\"bytes\":%lu}\n",
                shot_seq, (unsigned long)n, cfg::POD_GYRO_DPS_PER_LSB, int(cfg::POD_CLIP_COUNTS),
                (unsigned long)(n * sizeof(PodSample)));
  for (uint32_t k = start; k < end; ++k)
    Serial.write(reinterpret_cast<const uint8_t*>(&g_pod[k % cfg::POD_RING]), sizeof(PodSample));
  Serial.println("\nIMU_END");
  g_pod_hold = false;
}

// -----------------------------------------------------------------------------
//  Status LED
// -----------------------------------------------------------------------------
enum class LedMode { IDLE, POD_LINKED, ANALYSING, LOW_BATTERY, FAULT };
static LedMode g_led = LedMode::IDLE;

static void ledService() {
  uint32_t t = millis();
  bool on = false;
  switch (g_led) {
    case LedMode::IDLE:        on = (t % 2000) < 60; break;                              // brief blip
    case LedMode::POD_LINKED:  on = true; break;                                         // steady: armed with pod
    case LedMode::ANALYSING:   on = (t % 200) < 100; break;                              // fast
    case LedMode::LOW_BATTERY: on = (t % 1000) < 60 || ((t % 1000) > 200 && (t % 1000) < 260); break;
    case LedMode::FAULT:       on = (t % 400) < 200; break;
  }
  digitalWrite(cfg::PIN_LED, on ? HIGH : LOW);
}

// -----------------------------------------------------------------------------
//  Buzzer: piezo disc on GPIO7 through 470 R, LEDC square wave at BUZZER_HZ.
//  Non-blocking: a pattern is a list of tone-on / tone-off times, advanced from
//  loop(). Urgent patterns (ready, shot read) play as soon as no capture is in
//  progress; the rest wait for quiet. Silence is duty 0: no edges at all.
// -----------------------------------------------------------------------------
enum class Beep : uint8_t { READY, SHOT, POD_PARKED, POD_CONNECTED, POD_DISCONNECTED, LOW_BATTERY, DOCK_FAULT, COUNT };

struct BeepPattern { uint8_t steps; bool urgent; uint16_t ms[6]; };   // on, off, on, ...
static const BeepPattern kBeeps[size_t(Beep::COUNT)] = {
    {1, true,  {60}},                         // READY: one short chirp
    {3, true,  {60, 90, 60}},                 // SHOT: two short chirps
    {5, false, {40, 60, 40, 60, 40}},         // POD_PARKED: three quick chirps
    {3, false, {200, 80, 60}},                // POD_CONNECTED: long, short
    {3, false, {60, 80, 200}},                // POD_DISCONNECTED: short, long
    {5, false, {300, 200, 300, 200, 300}},    // LOW_BATTERY: three long
    {1, false, {800}},                        // DOCK_FAULT: one very long
};

struct BeepRequest { bool pending; uint32_t at_ms; };
static BeepRequest g_beep_req[size_t(Beep::COUNT)] = {};
static bool        g_buzzer_on = true;        // serial 'b' toggles
static int         g_beep_playing = -1;       // index into kBeeps; -1 = silent
static uint32_t    g_beep_silent_ms = 0;
#if STEM_BUZZER
static uint8_t     g_beep_step = 0;
static uint32_t    g_beep_step_ms = 0;
#endif

static void beep(Beep b) {
#if STEM_BUZZER
  if (g_buzzer_on) g_beep_req[size_t(b)] = BeepRequest{true, millis()};
#else
  (void)b;
#endif
}

static void buzzerStop(uint32_t now) {
#if STEM_BUZZER
  if (g_beep_playing < 0) return;
  ledcWrite(cfg::PIN_BUZZER, 0);
  g_beep_playing = -1;
  g_beep_silent_ms = now;
#else
  (void)now;
#endif
}

static bool buzzerSilentFor(uint32_t now, uint32_t ms) { return g_beep_playing < 0 && now - g_beep_silent_ms >= ms; }

// may_sound is false while a capture is triggered or being analysed, or a pod
// swing has begun (the radar is about to arm): a tone is cut off and nothing
// new starts.
static void buzzerService(uint32_t now, bool may_sound, bool quiet) {
#if STEM_BUZZER
  if (!may_sound) { buzzerStop(now); return; }
  if (g_beep_playing >= 0) {
    const BeepPattern& p = kBeeps[g_beep_playing];
    if (now - g_beep_step_ms < p.ms[g_beep_step]) return;
    g_beep_step_ms = now;
    if (++g_beep_step >= p.steps) { buzzerStop(now); return; }
    ledcWrite(cfg::PIN_BUZZER, (g_beep_step % 2 == 0) ? cfg::BUZZER_DUTY : 0);
    return;
  }
  for (size_t i = 0; i < size_t(Beep::COUNT); ++i) {   // enum order is priority order
    BeepRequest& r = g_beep_req[i];
    if (!r.pending) continue;
    if (!kBeeps[i].urgent) {
      if (now - r.at_ms > cfg::BEEP_MAX_WAIT_MS) { r.pending = false; continue; }
      if (!quiet) continue;
    }
    // Disarm before the first edge, then check that no trigger slipped in.
    g_armed = false;
    if (g_triggered || g_capture_ready) return;
    r.pending = false;
    g_beep_playing = int(i);
    g_beep_step = 0;
    g_beep_step_ms = now;
    ledcWrite(cfg::PIN_BUZZER, cfg::BUZZER_DUTY);
    return;
  }
#else
  (void)now; (void)may_sound; (void)quiet;
#endif
}

// -----------------------------------------------------------------------------
//  Pod charging contacts (docs/wiring_schematic.md, "Dock charging").
//  GPIO6 drives a 2N7002 that pulls the gate of an AO3401 high-side switch from
//  the 5 V rail to DOCK+, through a 0.2 A PTC. The contacts are dead until a
//  check finds the pod's beacon: with the switch off, a parked pod drives DOCK+
//  to 2.2-2.8 V through its own 220k from its 3.3 V rail, against the 800k
//  divider to ground here. Water across the contacts can only pull DOCK+ down,
//  so wet contacts never look like a pod. While charging, each check reads
//  DOCK+ with the switch on (overload test), turns it off for 30 ms and reads
//  the beacon again (is the pod still there?). Every check runs inside one
//  pause of the radar stream.
// -----------------------------------------------------------------------------
static uint16_t g_batt_mv = 0;

enum class DockState : uint8_t { OFF, CONFIRMING, CHARGING, LOCKOUT, LOW_BATTERY };
static DockState g_dock = DockState::OFF;
static uint32_t  g_dock_changed_ms = 0;        // last time the switch changed state

static bool podDocked(uint32_t now) {
  return g_dock == DockState::CHARGING ||
         ((g_pod_power.load() & podpower::DOCK_POWER) && now - g_pod_power_ms.load() < 5000);
}

#if STEM_POD_DOCK
static uint32_t  g_dock_check_ms = 0;          // last check
static uint32_t  g_dock_on_ms = 0;             // start of this charging session
static uint32_t  g_dock_lockout_until = 0, g_dock_lockout_ms = cfg::DOCK_LOCKOUT_MS;
static bool      g_dock_check_now = false;     // the pod says it lost dock power: look now
static bool      g_dock_pod_confirmed = false; // the pod reported dock power since the last switch change

static const char* dockStateText(DockState d) {
  switch (d) {
    case DockState::OFF: case DockState::CONFIRMING: return "off";
    case DockState::CHARGING: return "charging";
    case DockState::LOCKOUT: return "fault";
    case DockState::LOW_BATTERY: return "low_battery";
  }
  return "unknown";
}

static void dockReport(const char* reason, uint16_t off_mv, uint16_t on_mv) {
  Serial.printf("{\"type\":\"pod_dock\",\"state\":\"%s\",\"reason\":\"%s\",\"off_mv\":%u,\"on_mv\":%u}\n",
                dockStateText(g_dock), reason, off_mv, on_mv);
}

static void dockSwitch(bool on) {
  digitalWrite(cfg::PIN_DOCK_EN, on ? HIGH : LOW);
  g_dock_changed_ms = millis();
  g_dock_pod_confirmed = false;
}

static uint16_t dockMv(adc_oneshot_unit_handle_t unit) {
  return uint16_t(float(oneshotMv(unit, cfg::CH_DOCK)) * cfg::DOCK_DIVIDER);
}

static void dockFault(uint32_t now, const char* reason, uint16_t off_mv, uint16_t on_mv) {
  g_dock = DockState::LOCKOUT;
  g_dock_lockout_until = now + g_dock_lockout_ms;
  g_dock_lockout_ms = std::min(g_dock_lockout_ms * 2, cfg::DOCK_LOCKOUT_MAX_MS);
  dockReport(reason, off_mv, on_mv);
  beep(Beep::DOCK_FAULT);
}

static void dockCheck(uint32_t now) {
  const bool was_on = g_dock == DockState::CHARGING;
  uint16_t on_mv = 0, off_mv = 0;
  bool overload = false, switched_on = false;
  g_armed = false;   // the switch is about to change the 5 V load
  withAdcPaused([&](adc_oneshot_unit_handle_t unit) {
    // The radar stream is stopped for the whole check, so no capture can be
    // running while it waits for the switch to settle.
    if (was_on) {
      on_mv = dockMv(unit);
      dockSwitch(false);
      if (on_mv < cfg::DOCK_ON_MIN_MV) { overload = true; return; }
      delay(cfg::DOCK_OFF_SETTLE_MS);
    }
    off_mv = dockMv(unit);
    uint16_t need = was_on ? cfg::DOCK_KEEP_MV : cfg::DOCK_PRESENT_MV;
    bool want = (was_on || g_dock == DockState::CONFIRMING) && off_mv >= need && off_mv < cfg::DOCK_FOREIGN_MV;
    if (!want) return;
    dockSwitch(true);
    delay(cfg::DOCK_ON_SETTLE_MS);
    on_mv = dockMv(unit);
    if (on_mv < cfg::DOCK_ON_MIN_MV) { dockSwitch(false); overload = true; return; }
    switched_on = true;
  });
  if (g_debug_trigger)
    Serial.printf("{\"type\":\"dock_debug\",\"state\":\"%s\",\"off_mv\":%u,\"on_mv\":%u}\n", dockStateText(g_dock),
                  off_mv, on_mv);

  if (overload) {
    dockFault(now, "overload: DOCK+ sagged with the switch on", off_mv, on_mv);
    return;
  }
  if (off_mv >= cfg::DOCK_FOREIGN_MV) {
    dockFault(now, "voltage on the contacts with the switch off", off_mv, 0);
    return;
  }
  switch (g_dock) {
    case DockState::OFF:
      if (off_mv >= cfg::DOCK_PRESENT_MV) g_dock = DockState::CONFIRMING;
      else if (off_mv < cfg::DOCK_KEEP_MV) g_dock_lockout_ms = cfg::DOCK_LOCKOUT_MS;   // contacts clear
      break;
    case DockState::CONFIRMING:
      if (switched_on) {
        g_dock = DockState::CHARGING;
        g_dock_on_ms = now;
        dockReport("pod parked", off_mv, on_mv);
        beep(Beep::POD_PARKED);
      } else {
        g_dock = DockState::OFF;
      }
      break;
    case DockState::CHARGING:
      if (!switched_on) {
        g_dock = DockState::OFF;
        dockReport("no pod on the contacts (lifted, or contacts wet)", off_mv, on_mv);
      } else if (now - g_dock_on_ms > 60000) {
        g_dock_lockout_ms = cfg::DOCK_LOCKOUT_MS;   // a session that ran a minute clears past faults
      }
      break;
    default:
      break;
  }
}
#endif

// may_check is false while a capture is in progress, a tone plays or a pod
// swing has begun.
static void dockService(uint32_t now, bool may_check, bool quiet) {
#if STEM_POD_DOCK
  // The pod's own view. Once it has reported dock power since the switch last
  // changed, a later report without it means it was lifted: check at once
  // rather than waiting for the next scheduled look.
  static uint32_t seen_seq = 0;
  uint32_t seq = g_pod_power_seq.load();
  if (seq != seen_seq) {
    seen_seq = seq;
    if (g_dock == DockState::CHARGING && podConnected() &&
        int32_t(g_pod_power_ms.load() - g_dock_changed_ms) >= int32_t(cfg::DOCK_POD_TRUST_MS)) {
      if (g_pod_power.load() & podpower::DOCK_POWER) g_dock_pod_confirmed = true;
      else if (g_dock_pod_confirmed) g_dock_check_now = true;
    }
  }

  if (!may_check) return;   // never step the 5 V load during a capture, a tone or a swing

  // The ground unit's own cell comes first.
  bool batt_known = g_batt_mv > 1000;
  if (g_dock == DockState::LOW_BATTERY) {
    if (batt_known && g_batt_mv >= cfg::DOCK_RESUME_BATT_MV) {
      g_dock = DockState::OFF;
      dockReport("ground unit battery recovered", 0, 0);
    }
    return;
  }
  if (batt_known && g_batt_mv < cfg::DOCK_MIN_BATT_MV) {
    if (g_dock == DockState::CHARGING) dockSwitch(false);
    g_dock = DockState::LOW_BATTERY;
    dockReport("ground unit battery low", 0, 0);
    return;
  }
  if (g_dock == DockState::LOCKOUT) {
    if (int32_t(now - g_dock_lockout_until) < 0) return;
    g_dock = DockState::OFF;
  }
  // A pod whose own USB-C is on a computer has power already. The SuperMini
  // ties VBUS straight to its 5V pin, so charging it from here too could push
  // current up the cable into a sagging host port: leave the contacts off.
  bool pod_on_usb = podConnected() && (g_pod_power.load() & podpower::USB_HOST) && now - g_pod_power_ms.load() < 5000;
  if (pod_on_usb) {
    bool was_on = g_dock == DockState::CHARGING;
    g_dock = DockState::OFF;
    if (was_on) {
      dockSwitch(false);
      dockReport("pod is on its own USB power", 0, 0);
    }
    return;
  }

  uint32_t since = now - g_dock_check_ms;
  uint32_t period = g_dock == DockState::CONFIRMING ? cfg::DOCK_CONFIRM_MS
                    : g_dock == DockState::CHARGING ? cfg::DOCK_CHECK_MS
                                                    : cfg::DOCK_POLL_MS;
  bool due = g_dock_check_now || since >= cfg::DOCK_CHECK_MAX_MS ||
             (since >= period && (quiet || g_dock == DockState::CONFIRMING));
  if (!due) return;
  g_dock_check_now = false;
  g_dock_check_ms = now;
  dockCheck(now);
#else
  (void)now; (void)may_check; (void)quiet;
#endif
}

// Prints the pod's power state when it changes.
static void podPowerReport() {
  static uint8_t last = 0xFF;
  if (g_pod_power_seq.load() == 0) return;   // no pod has reported power state yet
  uint8_t f = g_pod_power.load();
  if (f == last) return;
  last = f;
  const char* charge = (f & podpower::CHARGED) ? "charged" : (f & podpower::CHARGING) ? "charging" : "not_charging";
  Serial.printf("{\"type\":\"pod_power\",\"dock_power\":%s,\"usb_host\":%s,\"charge\":\"%s\",\"battery_mv\":%u,"
                "\"dock_pad_mv\":%u}\n",
                (f & podpower::DOCK_POWER) ? "true" : "false", (f & podpower::USB_HOST) ? "true" : "false", charge,
                g_pod_batt_mv, g_pod_pad_mv.load());
}

// -----------------------------------------------------------------------------
//  Arduino entry points
// -----------------------------------------------------------------------------
static uint16_t g_shot_seq = 0;
static bool     g_stream_raw = false;

static uint32_t g_ready_beep_ms = 0;   // when to sound the ready chirp; 0 = not pending

void setup() {
#if STEM_POD_DOCK
  // First thing: the contacts stay dead. The 10k on the 2N7002 gate has held
  // them off through reset; this keeps them off.
  pinMode(cfg::PIN_DOCK_EN, OUTPUT);
  digitalWrite(cfg::PIN_DOCK_EN, LOW);
#endif
  pinMode(cfg::PIN_LED, OUTPUT);
  pinMode(cfg::PIN_BUTTON, INPUT_PULLUP);
  if (cfg::PIN_RADAR_EN >= 0) {
    pinMode(cfg::PIN_RADAR_EN, OUTPUT);
    digitalWrite(cfg::PIN_RADAR_EN, cfg::RADAR_EN_ACTIVE_HIGH ? HIGH : LOW);
  }
  Serial.begin(921600);   // USB CDC: the baud rate is ignored, kept for USB-UART adapters
  uint32_t t0 = millis();
  while (!Serial && millis() - t0 < 1000) delay(10);
  Serial1.begin(cfg::AUX_BAUD, SERIAL_8N1, cfg::PIN_AUX_RX, cfg::PIN_AUX_TX);
  Serial.printf("{\"type\":\"boot\",\"fw\":\"%u.%u\",\"fs_hz\":%u,\"fft_n\":%u,\"hz_per_bin\":%.3f,"
                "\"buzzer\":%s,\"pod_dock\":%s}\n",
                cfg::FW_MAJOR, cfg::FW_MINOR, unsigned(cfg::FS_HZ), unsigned(cfg::FFT_N), HZ_PER_BIN,
                STEM_BUZZER ? "true" : "false", STEM_POD_DOCK ? "true" : "false");
#if STEM_BUZZER
  // LEDC has its own timers and clock divider; it shares nothing with the ADC's
  // digital controller or its DMA. Duty 0 until a pattern plays.
  if (!ledcAttach(cfg::PIN_BUZZER, cfg::BUZZER_HZ, cfg::BUZZER_RES_BITS))
    Serial.println("{\"type\":\"error\",\"msg\":\"buzzer PWM failed to start\"}");
  ledcWrite(cfg::PIN_BUZZER, 0);
#endif

  g_iq  = static_cast<int16_t(*)[2]>(malloc(cfg::CAPTURE_PAIRS * sizeof(int16_t[2])));
  g_pod = static_cast<PodSample*>(malloc(cfg::POD_RING * sizeof(PodSample)));
  if (!g_iq || !g_pod) {
    Serial.println("{\"type\":\"error\",\"msg\":\"not enough RAM for capture buffers\"}");
    g_led = LedMode::FAULT;
    for (;;) { ledService(); delay(10); }
  }
  fftInit();

  g_adc_lock = xSemaphoreCreateMutex();
  g_batt_mv = readBatteryMv();   // before the stream starts: nothing to stop yet
  xTaskCreate(adcTask, "adc", 4096, nullptr, configMAX_PRIORITIES - 3, &g_adc_task);
  if (!adcStreamStart()) {
    Serial.println("{\"type\":\"error\",\"msg\":\"ADC continuous mode failed to start\"}");
    g_led = LedMode::FAULT;
  }
  bleInit();
  Serial.printf("{\"type\":\"ready\",\"battery_mv\":%u}\n", g_batt_mv);
  // Chirp once the trigger has learnt its noise level (64 blocks, 0.4 s), so
  // the chirp is not part of what it learns.
  g_ready_beep_ms = millis() + 1000;
}

void loop() {
  static uint32_t last_batt_ms = 0, last_debug_ms = 0, button_down_ms = 0;
  static uint32_t batt_low_beep_ms = 0, radar_busy_ms = 0;
  static bool     batt_low = false;
  uint32_t now = millis();

  podService();
  podPowerReport();
  // A pod sitting on the charging contacts is not on a club.
  bool pod_on_club = podConnected() && !podDocked(now);
  if (g_pod_evt_connect.exchange(false) && !podDocked(now)) beep(Beep::POD_CONNECTED);
  if (g_pod_evt_disconnect.exchange(false) && !podDocked(now)) beep(Beep::POD_DISCONNECTED);

  if (g_capture_ready) {
    buzzerStop(now);   // normally already silent: the trigger cannot arm while a tone plays
    g_led = LedMode::ANALYSING;
    ledService();
    uint32_t end = g_capture_end;
    uint32_t first = end - cfg::CAPTURE_PAIRS;
    uint32_t t_start = millis();
    RadarResult rr = analyseRadar(first);
    // Ground time of impact, counted back from when the last pair was stored.
    // DMA delivers in 256-result frames, so that stamp is up to 3.2 ms late.
    uint32_t impact_us = uint32_t(g_capture_end_us -
                                  int64_t(cfg::CAPTURE_PAIRS - rr.impact_pair) * 1000000 / cfg::FS_HZ);
    ImuResult ir;
    if (rr.impact_found) ir = analyseImu(impact_us);
    else ir.peak_rate = ir.tempo = Reading::no(Refusal::NO_IMPACT);
    ++g_shot_seq;

    Serial.printf("{\"type\":\"shot\",\"shot_seq\":%u,\"impact_ms\":%lu,\"analysis_ms\":%lu,",
                  g_shot_seq, (unsigned long)(impact_us / 1000), (unsigned long)(millis() - t_start));
    printReading("ball_speed_radial", "m/s", rr.ball, "radar-fw-preview");
    printReading("club_speed_radial", "m/s", rr.club, "radar-fw-preview");
    printReading("smash_factor", "ratio", rr.smash, "radar-fw-preview");
    printReading("peak_shaft_rate", "deg/s", ir.peak_rate, "imu");
    printReading("tempo_ratio", "ratio", ir.tempo, "imu+radar");
    Serial.printf("\"battery_mv\":{\"ground\":%u,\"pod\":%u},\"pod_dropped_samples\":%lu,\"adc_desync\":%lu}\n",
                  g_batt_mv, g_pod_batt_mv, (unsigned long)g_pod_dropped, (unsigned long)g_desync.load());

    ShotSummary sum{};
    sum.magic = 0x5A; sum.version = 1;
    sum.shot_seq = g_shot_seq;
    sum.impact_ms = impact_us / 1000;
    sum.ball_speed_radial = wire(rr.ball);
    sum.club_speed_radial = wire(rr.club);
    sum.smash = wire(rr.smash);
    sum.peak_shaft_rate = wire(ir.peak_rate);
    sum.tempo_ratio = wire(ir.tempo);
    sum.battery_mv_ground = g_batt_mv;
    sum.battery_mv_pod = g_pod_batt_mv;
    g_chr_shot->setValue(reinterpret_cast<uint8_t*>(&sum), sizeof sum);
    g_chr_shot->notify();

    if (g_stream_raw) {
      streamRaw(first, g_shot_seq);
      streamImu(g_shot_seq);
    }
    g_capture_ready = false;   // release the ring; capture resumes
    if (rr.impact_found) beep(Beep::SHOT);
    now = millis();            // the analysis took a while
  }

  // Battery, between shots only.
  if (!g_triggered && !g_capture_ready && now - last_batt_ms >= cfg::BATT_PERIOD_MS) {
    last_batt_ms = now;
    g_batt_mv = readBatteryMv();
    bool low = g_batt_mv > 1000 && g_batt_mv < cfg::BATT_LOW_MV;
    if (low && (!batt_low || now - batt_low_beep_ms >= cfg::BATT_LOW_REPEAT_MS)) {
      beep(Beep::LOW_BATTERY);
      batt_low_beep_ms = now;
    }
    if (low) batt_low = true;
    else if (g_batt_mv >= cfg::BATT_LOW_MV + 100) batt_low = false;
  }

  // Quiet: nothing moving in the beam for QUIET_MS, and no pod swing.
  bool pod_says_swing = now - g_pod_swing_ms < 2000;
  bool swing_coming = pod_on_club && pod_says_swing;
  bool capture_busy = g_triggered || g_capture_ready;
  float noise = g_trig_noise;
  if (noise <= 0 || fabsf(g_trig_metric) > cfg::QUIET_RATIO * noise || capture_busy || swing_coming)
    radar_busy_ms = now;
  bool quiet = now - radar_busy_ms >= cfg::QUIET_MS;

  // Pod charging contacts: never during a capture, a tone or a pod swing.
  dockService(now, !capture_busy && !swing_coming && buzzerSilentFor(now, cfg::BUZZER_SETTLE_MS), quiet);
  now = millis();              // a check pauses for up to ~60 ms

  if (g_ready_beep_ms && int32_t(now - g_ready_beep_ms) >= 0) {
    g_ready_beep_ms = 0;
    if (g_user_armed) beep(Beep::READY);
  }

  // Serial commands: r = raw streaming, d = trigger debug, a = arm/disarm,
  // b = buzzer on/off.
  while (Serial.available()) {
    switch (Serial.read()) {
      case 'r': g_stream_raw = !g_stream_raw; break;
      case 'd': g_debug_trigger = !g_debug_trigger; break;
      case 'a':
        g_user_armed = !g_user_armed;
        if (g_user_armed) beep(Beep::READY);
        break;
      case 'b':
        g_buzzer_on = !g_buzzer_on;
        if (!g_buzzer_on) {
          buzzerStop(now);
          for (auto& r : g_beep_req) r.pending = false;
        }
        Serial.printf("{\"type\":\"event\",\"msg\":\"buzzer %s\"}\n",
                      !STEM_BUZZER ? "not built (STEM_BUZZER 0)" : g_buzzer_on ? "on" : "off");
        break;
      default: break;
    }
  }
  // BOOT button short press toggles raw streaming.
  if (digitalRead(cfg::PIN_BUTTON) == LOW) {
    if (button_down_ms == 0) button_down_ms = now;
  } else if (button_down_ms) {
    if (now - button_down_ms > 30 && now - button_down_ms < 1000) {
      g_stream_raw = !g_stream_raw;
      Serial.printf("{\"type\":\"event\",\"msg\":\"raw streaming %s\"}\n", g_stream_raw ? "on" : "off");
    }
    button_down_ms = 0;
  }

  if (g_debug_trigger && now - last_debug_ms >= 100) {
    last_debug_ms = now;
    Serial.printf("{\"type\":\"trigger_debug\",\"metric\":%.1f,\"noise\":%.1f,\"ratio\":%.1f}\n", g_trig_metric,
                  g_trig_noise, g_trig_noise > 0 ? g_trig_metric / g_trig_noise : 0.0f);
  }

  // Buzzer, then arming. A pod swing starting silences any tone, so the radar
  // can arm; arming then waits BUZZER_SETTLE_MS after the last edge and
  // DOCK_ARM_SETTLE_MS after the charging switch last changed the 5 V load.
  buzzerService(now, !capture_busy && !swing_coming, quiet);
  // With a pod on the club, arm only while it reports a swing (and 2 s after),
  // so a passing cart or a practice waggle cannot fire a capture. Without one
  // (none linked, or it is parked on the charging contacts) the unit runs
  // radar-only and stays armed.
  g_armed = g_user_armed && (!pod_on_club || pod_says_swing) && buzzerSilentFor(now, cfg::BUZZER_SETTLE_MS) &&
            now - g_dock_changed_ms >= cfg::DOCK_ARM_SETTLE_MS;

  if (g_capture_ready || g_triggered) g_led = LedMode::ANALYSING;
  else if (g_batt_mv > 1000 && g_batt_mv < cfg::BATT_LOW_MV) g_led = LedMode::LOW_BATTERY;
  else g_led = podConnected() ? LedMode::POD_LINKED : LedMode::IDLE;
  ledService();
  delay(2);
}
