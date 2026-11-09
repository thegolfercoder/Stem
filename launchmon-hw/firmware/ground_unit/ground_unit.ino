// =============================================================================
//  Stem launch monitor - GROUND RADAR UNIT firmware
//  Board : ESP32-C3 SuperMini   (Arduino-ESP32 core 3.x, "ESP32C3 Dev Module",
//          USB CDC On Boot: Enabled)
//  Radar : Infineon BGT24LTR11 24 GHz CW Doppler, I and Q IF outputs through
//          an LM358 pre-amp into ADC1
//  Radio : BLE central to the shaft pod and BLE peripheral to a phone, at the
//          same time (NimBLE-Arduino 2.x)
// =============================================================================
//
//  SIGNAL PATH
//    BGT24LTR11 IFI/IFQ -> LM358 pre-amp (x20, AC-coupled 200 Hz - 14 kHz,
//    biased at 0.9 V, run from 3.3 V: docs/wiring_schematic.md 1.4) ->
//    GPIO0 / GPIO1 -> ADC1 in continuous DMA mode, 80 kS/s interleaved, i.e.
//    40 kS/s per channel. Each channel's DC level is removed in software, so
//    any bias inside the ADC's range works.
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
//  Battery voltages: no part on this unit or the pod measures a cell. The
//  shot summary's two battery fields and the shot line's battery_mv are sent
//  as 0, which means "not read".
//
//  SPEEDS ARE RADIAL
//  The radar measures speed along its own line of sight. The cosine correction
//  to true ball speed needs a launch angle, and is fusion's job. It is not
//  applied here.
//
//  PINS (SuperMini)                   see docs/wiring_schematic.md
//      GPIO0  ADC1_CH0 <- I channel (pre-amp output, radar IFI)
//      GPIO1  ADC1_CH1 <- Q channel (pre-amp output, radar IFQ)
//      GPIO5           -> radar enable, if the module has one (optional, off by default)
//      GPIO10          -> 5 mm status LED through 330 R
//      GPIO9           <- BOOT button: short press toggles raw USB streaming
//      GPIO20/21       UART0 RX/TX, auxiliary serial (Serial1)
//      GPIO2, GPIO8 are strapping pins and are left alone.
//
//  POWER
//  LiPo -> TP4056 -> slide switch -> MT3608 (5 V) -> SuperMini 5V pin and the
//  radar module; the SuperMini's 3V3 feeds the pre-amp. The switch cuts
//  everything after the TP4056: off is off.
// =============================================================================

#include <Arduino.h>
#include <NimBLEDevice.h>
#include <algorithm>
#include <atomic>
#include <cmath>
#include "esp_idf_version.h"
#include "esp_adc/adc_continuous.h"
#include "esp_timer.h"

#if !defined(ESP_ARDUINO_VERSION_MAJOR) || ESP_ARDUINO_VERSION_MAJOR < 3
#error "This sketch needs the Arduino-ESP32 core 3.x (ESP-IDF 5.x)."
#endif
#if !CONFIG_IDF_TARGET_ESP32C3
#error "Written for the ESP32-C3: ADC1 channel numbers, the TYPE2 DMA format and the sample-rate limits are C3-specific."
#endif

// -----------------------------------------------------------------------------
//  Configuration
// -----------------------------------------------------------------------------
namespace cfg {
// 0.5: the original parts only. No buzzer, pod charging, soft power, battery
// sense or UnitStatus characteristic (those were 0.2-0.4).
constexpr uint8_t  FW_MAJOR = 0, FW_MINOR = 5;

constexpr int      PIN_I         = 0;     // ADC1_CH0
constexpr int      PIN_Q         = 1;     // ADC1_CH1
constexpr int      PIN_RADAR_EN  = -1;    // set to 5 if your module has an enable pin
constexpr bool     RADAR_EN_ACTIVE_HIGH = true;
constexpr int      PIN_LED       = 10;
constexpr int      PIN_BUTTON    = 9;     // BOOT button, active low
constexpr int      PIN_AUX_RX    = 20;
constexpr int      PIN_AUX_TX    = 21;
constexpr uint32_t AUX_BAUD      = 115200;

constexpr adc_channel_t CH_I    = ADC_CHANNEL_0;
constexpr adc_channel_t CH_Q    = ADC_CHANNEL_1;
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
// outside it has been attenuated by an unknown amount and is refused. The
// LM358 pre-amp's corners (194 Hz, 14.2 kHz: docs/wiring_schematic.md 1.4)
// match it.
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

// Phone telemetry service: one characteristic, the shot summary.
const char* const  BLE_NAME      = "STEM-RADAR";
const char* const  UUID_GND_SVC  = "7d2a0101-5b1c-4f6e-9c1e-3a6f1f0c2b10";
const char* const  UUID_GND_SHOT = "7d2a0102-5b1c-4f6e-9c1e-3a6f1f0c2b10";
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
  uint16_t    battery_mv_ground, battery_mv_pod;   // 0 = not read: from fw 0.5 nothing measures either cell
};
static_assert(sizeof(ShotSummary) == 42, "the phone results screen (launchmon-hw/results) decodes 42 bytes");

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
static bool                    g_adc_fault = false;    // the stream failed to start (setup())

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
// battery_mv is 0 from pod firmware 0.3 (no battery sense) and is not used here.
// Pod firmware 0.2 appended 3 bytes of charging state; a longer status still
// parses, and the extra bytes are ignored.
struct __attribute__((packed)) PodStatus {
  PodHeader h; uint16_t battery_mv; uint32_t sample_period_ns; uint8_t who, accel_fs_g;
  uint16_t gyro_fs_dps; uint32_t dropped; uint8_t fw_major, fw_minor;
};
static_assert(sizeof(PodHeader) == 12 && sizeof(PodImu) == 12, "must match the pod");
static_assert(sizeof(PodStatus) == 28, "must match the pod");

struct PodSample { PodImu s; uint32_t t_ground_us; uint32_t t_pod_us; };   // 20 bytes, as streamed
static_assert(sizeof(PodImu) + 8 == 20, "IMU block record layout is part of the USB format");
static PodSample*             g_pod = nullptr;
static std::atomic<uint32_t>  g_pod_written{0};
static portMUX_TYPE           g_pod_mux = portMUX_INITIALIZER_UNLOCKED;
static int64_t                g_pod_offset_us = INT64_MAX;   // ground - pod, minimum-latency estimate
static volatile uint32_t      g_pod_period_ns = 600240;      // updated from status packets
static volatile uint32_t      g_pod_dropped = 0;
static volatile uint32_t      g_pod_swing_ms = 0;            // last packet flagged SWING_ACTIVE
static volatile bool          g_pod_hold = false;            // set while the ring is streamed to USB
static volatile uint32_t      g_pod_dropped_held = 0;        // packets refused while held

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
    if (st->sample_period_ns > 100000 && st->sample_period_ns < 10000000) g_pod_period_ns = st->sample_period_ns;
    g_pod_dropped = st->dropped;
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
  void onConnect(NimBLEClient*) override { Serial.println("{\"type\":\"event\",\"msg\":\"pod connected\"}"); }
  void onDisconnect(NimBLEClient*, int reason) override {
    Serial.printf("{\"type\":\"event\",\"msg\":\"pod disconnected\",\"reason\":%d}\n", reason);
    g_pod_offset_us = INT64_MAX;
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
//  Phone telemetry: BLE peripheral. One characteristic: the shot summary.
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
enum class LedMode { IDLE, POD_LINKED, ANALYSING, FAULT };
static LedMode g_led = LedMode::IDLE;

static void ledService() {
  uint32_t t = millis();
  bool on = false;
  switch (g_led) {
    case LedMode::IDLE:        on = (t % 2000) < 60; break;                              // brief blip
    case LedMode::POD_LINKED:  on = true; break;                                         // steady: armed with pod
    case LedMode::ANALYSING:   on = (t % 200) < 100; break;                              // fast
    case LedMode::FAULT:       on = (t % 400) < 200; break;
  }
  digitalWrite(cfg::PIN_LED, on ? HIGH : LOW);
}

// -----------------------------------------------------------------------------
//  Arduino entry points
// -----------------------------------------------------------------------------
static uint16_t g_shot_seq = 0;
static bool     g_stream_raw = false;

void setup() {
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
  Serial.printf("{\"type\":\"boot\",\"fw\":\"%u.%u\",\"fs_hz\":%u,\"fft_n\":%u,\"hz_per_bin\":%.3f}\n",
                cfg::FW_MAJOR, cfg::FW_MINOR, unsigned(cfg::FS_HZ), unsigned(cfg::FFT_N), HZ_PER_BIN);

  g_iq  = static_cast<int16_t(*)[2]>(malloc(cfg::CAPTURE_PAIRS * sizeof(int16_t[2])));
  g_pod = static_cast<PodSample*>(malloc(cfg::POD_RING * sizeof(PodSample)));
  if (!g_iq || !g_pod) {
    Serial.println("{\"type\":\"error\",\"msg\":\"not enough RAM for capture buffers\"}");
    g_led = LedMode::FAULT;
    for (;;) { ledService(); delay(10); }
  }
  fftInit();

  xTaskCreate(adcTask, "adc", 4096, nullptr, configMAX_PRIORITIES - 3, &g_adc_task);
  if (!adcStreamStart()) {
    Serial.println("{\"type\":\"error\",\"msg\":\"ADC continuous mode failed to start\"}");
    g_adc_fault = true;
  }
  bleInit();
  Serial.println("{\"type\":\"ready\"}");
}

void loop() {
  static uint32_t last_debug_ms = 0, button_down_ms = 0;
  uint32_t now = millis();

  podService();
  // With a pod linked, arm only while it reports a swing (and 2 s after), so a
  // passing cart or a practice waggle cannot fire a capture. Without a pod the
  // unit runs radar-only and stays armed.
  bool pod_says_swing = now - g_pod_swing_ms < 2000;
  g_armed = g_user_armed && (!podConnected() || pod_says_swing);

  if (g_capture_ready) {
    g_led = LedMode::ANALYSING;
    ledService();
    uint32_t end = g_capture_end;
    uint32_t first = end - cfg::CAPTURE_PAIRS;
    uint32_t t_start = millis();
    RadarResult rr = analyseRadar(first);
    // Ground time of impact, counted back from when the last pair was stored.
    // DMA delivers in 256-result frames, so that stamp is up to 3.2 ms late.
    // impact_ms comes from the 64-bit microsecond count, as millis() does, so
    // it is on the millis() clock and wraps with it after 49.7 days. Dividing
    // the 32-bit microseconds by 1000 would wrap every 71.6 minutes. The pod's
    // sample stamps are 32-bit microseconds, so the IMU analysis keeps using
    // impact_us.
    const int64_t impact_us64 =
        g_capture_end_us - int64_t(cfg::CAPTURE_PAIRS - rr.impact_pair) * 1000000 / cfg::FS_HZ;
    const uint32_t impact_us = uint32_t(impact_us64);
    const uint32_t impact_ms = uint32_t(impact_us64 / 1000);
    ImuResult ir;
    if (rr.impact_found) ir = analyseImu(impact_us);
    else ir.peak_rate = ir.tempo = Reading::no(Refusal::NO_IMPACT);
    ++g_shot_seq;

    // battery_mv stays in the line, as 0 = not read, so readers of the older
    // format still parse it: neither unit measures its cell.
    Serial.printf("{\"type\":\"shot\",\"shot_seq\":%u,\"impact_ms\":%lu,\"analysis_ms\":%lu,",
                  g_shot_seq, (unsigned long)impact_ms, (unsigned long)(millis() - t_start));
    printReading("ball_speed_radial", "m/s", rr.ball, "radar-fw-preview");
    printReading("club_speed_radial", "m/s", rr.club, "radar-fw-preview");
    printReading("smash_factor", "ratio", rr.smash, "radar-fw-preview");
    printReading("peak_shaft_rate", "deg/s", ir.peak_rate, "imu");
    printReading("tempo_ratio", "ratio", ir.tempo, "imu+radar");
    Serial.printf("\"battery_mv\":{\"ground\":0,\"pod\":0},\"pod_dropped_samples\":%lu,\"adc_desync\":%lu}\n",
                  (unsigned long)g_pod_dropped, (unsigned long)g_desync.load());

    ShotSummary sum{};
    sum.magic = 0x5A; sum.version = 1;
    sum.shot_seq = g_shot_seq;
    sum.impact_ms = impact_ms;
    sum.ball_speed_radial = wire(rr.ball);
    sum.club_speed_radial = wire(rr.club);
    sum.smash = wire(rr.smash);
    sum.peak_shaft_rate = wire(ir.peak_rate);
    sum.tempo_ratio = wire(ir.tempo);
    sum.battery_mv_ground = 0;   // not read
    sum.battery_mv_pod = 0;      // not read
    g_chr_shot->setValue(reinterpret_cast<uint8_t*>(&sum), sizeof sum);
    g_chr_shot->notify();

    if (g_stream_raw) {
      streamRaw(first, g_shot_seq);
      streamImu(g_shot_seq);
    }
    g_capture_ready = false;   // release the ring; capture resumes
    now = millis();            // the analysis took a while
  }

  // Serial commands: r = raw streaming, d = trigger debug, a = arm/disarm.
  while (Serial.available()) {
    switch (Serial.read()) {
      case 'r': g_stream_raw = !g_stream_raw; break;
      case 'd': g_debug_trigger = !g_debug_trigger; break;
      case 'a': g_user_armed = !g_user_armed; break;
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

  if (g_adc_fault) g_led = LedMode::FAULT;   // no radar stream: no shots will come
  else if (g_capture_ready || g_triggered) g_led = LedMode::ANALYSING;
  else g_led = podConnected() ? LedMode::POD_LINKED : LedMode::IDLE;
  ledService();
  delay(2);
}
