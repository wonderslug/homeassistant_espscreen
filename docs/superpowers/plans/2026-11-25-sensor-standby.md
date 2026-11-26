# Standby from a sensor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A screen's standby follows an on and off entity picked in the Screensaver card: held lit while it is on, to
standby (screensaver or glass off) a delay after it turns off, awake at the next turn to on.

**Architecture:** The add-on keeps the choice in the screensaver choice, follows the entity and sends the screen
`{"op": "sensor", ...}` (negotiated feature `sensor_standby`). The screen's standby state machine
(`screen_standby.h`, free of LVGL and ESPHome) holds every rule; the firmware only parses the message and binds the
add-on's liveness. The editor adds one row to the Screensaver card that opens a drawer.

**Tech Stack:** C++17 (ESPHome firmware, host tests with clang++), Python 3 (add-on, unittest), Vue 3 + TypeScript
(editor, vitest).

**Spec:** `docs/superpowers/specs/2026-11-25-sensor-standby-design.md`

## Global Constraints

- Entity domains: `binary_sensor`, `input_boolean`, `switch`. One entity per screen.
- `sensor_off`: `'saver'` (default) or `'off'`. `sensor_delay` seconds, one of `0, 15, 30, 60, 120, 300, 600`, default `60`.
- Wire: `{"op": "sensor", "on": 1 | 0 | null, "m": "saver" | "off", "d": <seconds>}`, only to a screen whose hello lists `sensor_standby`.
- Entity state `on` is 1, `off` is 0, anything else (`unavailable`, `unknown`, missing, no sensor chosen) is null.
- Never widen the eleven-key `settings` block; no new screen setting entity.
- Work on this branch (`presence-standby`, from upstream `dev`). Bump no app version and no firmware number.
- Docs under `docs/` are public: plain English, no em dashes, generic entity ids (`binary_sensor.hall_presence`).
- Commit messages carry no Claude attribution (the user's global rule).
- Every text goes in `screen_manager/translations/en.json`; `python3 tools/i18n.py check` passes.
- After a change under `web/src`: `cd web && npm test && npm run build`, and commit `screen_manager/app/static` with it.

## Review Focus

1. A motion sensor that flaps on and off while someone uses the screen: the delay counts from the last turn to off, the screen never dims mid-use. (Task 1, `the_sensor_holds_and_lets_go`.)
2. A touch while the sensor is off: the delay counts from the later of the touch and the turn to off. (Task 1, same case.)
3. An alert, a ring or a calibration up when the delay runs out: no standby until it ends. (Task 1, `the_sensor_respects_what_holds_the_glass`.)
4. The chosen entity removed or renamed in Home Assistant: its state is missing, the word is null, the screen is back on its timer. (Task 3, `test_the_sensor_word`.)
5. Show in standby off with a sensor set: the sensor is still followed and sent, and the empty room gives the dimmed tiles or a dark glass. (Task 3, `test_the_sensor_is_followed_without_the_screensaver`.)

---

### Task 1: The sensor's rules in the standby

**Files:**
- Modify: `components/smart_display/screen_standby.h` (head comment, `Glass`, `Standby` public API, `show()`, `lit()`, `tick()`, private state)
- Test: `tests/test_screen_standby.cpp`

**Interfaces:**
- Produces, in namespace `screen_standby`:
  - `enum class Sensor : uint8_t { UNKNOWN, OFF, ON };`
  - `enum class Empty : uint8_t { SAVER, DARK };`
  - `Glass::app_alive`: `bool (*app_alive)() = []() { return true; };` (the add-on's feed is alive)
  - `void Standby::sensor(Sensor word, Empty kind, uint32_t delay_ms, uint32_t now);`
  - `void Standby::sensor_lost(uint32_t now);` (same as `sensor(Sensor::UNKNOWN, ...)` with the kind and delay kept)
  - `Sensor Standby::sensor_word() const;`
  - `bool Standby::by_sensor() const;` (the standby now was started by the sensor)

Rules to implement (the spec's "Behaviour on the screen"):
- `tick()`: with the word `ON`, no standby by time. With `OFF`, enter a sensor standby when `!dimmed_ && !finger_ && !glass.owned()` and `now - max(off_at_, last_touch_) >= delay_ms_`, whatever `standby_enabled` says. With `UNKNOWN`, today's rule. Also in `tick()`: a known word and `!glass.app_alive()` is `sensor_lost(now)`.
- `sensor()`: from `UNKNOWN` to a known word is no turn (to `OFF` sets `off_at_ = now`). `ON` to `OFF` sets `off_at_ = now`. `OFF` to `ON` is the turn: a lit screen `stir(now)`s; a standby not by hand wakes (`wake(now)`, logged `"Wake from the sensor, screen in standby"`); a standby by hand wakes only when `now - max(off_at_, hand_at) >= delay_ms_`, where `hand_at` is when the standby by hand began, else it is logged `"Wake from the sensor held: standby by hand"` and ignored. The quiet rule (`waits_for_quiet`, `sensed_at_`) is not used for it.
- A known word to `UNKNOWN`: a lit screen `stir(now)`s; a standby stays as it is, `by_sensor_` kept.
- `show()`: Auto standby off lights a timer standby but not one with `by_sensor_`. The level of a standby with `by_sensor_ && kind == DARK` is 0 (the existing dark path: power saving, no saver); every other standby keeps `glass.standby_level()`.
- `lit()` clears `by_sensor_`.
- A new kind or delay while in a sensor standby takes effect at the next standby (no re-show).

- [ ] **Step 1: Write the failing tests**

Add four cases to `tests/test_screen_standby.cpp`, called from `main()`, in the file's style (`fresh()`, `after()`, `s.tick(now_ms)`, `has()`, `logged()`). `fresh()` also binds `s.glass.app_alive = []() { return alive; };` with `static bool alive = true;` reset there.

```cpp
static void the_sensor_holds_and_lets_go() {
  // On: no standby by time, however long.
  fresh();
  s.sensor(Sensor::OFF, Empty::SAVER, 60000, now_ms);  // the first word: no turn, the delay counts from now
  s.sensor(Sensor::ON, Empty::SAVER, 60000, now_ms);
  after(3600 * 1000); s.tick(now_ms);
  assert(!s.in_standby());
  // Off: standby one delay later, not before; a touch in between counts the delay from the touch.
  s.sensor(Sensor::OFF, Empty::SAVER, 60000, now_ms);
  after(30000); s.touch(now_ms);
  after(59999); s.tick(now_ms);
  assert(!s.in_standby());
  after(1); s.tick(now_ms); pass();
  assert(s.in_standby() && s.by_sensor() && has("light 20 in 1500"));
  // The turn to on wakes it at once.
  s.sensor(Sensor::ON, Empty::SAVER, 60000, now_ms);
  assert(!s.in_standby() && !s.by_sensor());
  // A flapping sensor while in use: the delay counts from the last turn to off.
  s.sensor(Sensor::OFF, Empty::SAVER, 60000, now_ms); after(50000);
  s.sensor(Sensor::ON, Empty::SAVER, 60000, now_ms); after(5000);
  s.sensor(Sensor::OFF, Empty::SAVER, 60000, now_ms); after(59000); s.tick(now_ms);
  assert(!s.in_standby());
  // Auto standby off: the sensor still sends it to standby, and show() does not light it again.
  fresh();
  screen_settings::current.standby_enabled = false;
  s.sensor(Sensor::OFF, Empty::SAVER, 0, now_ms);
  after(1); s.tick(now_ms); pass(); s.show();
  assert(s.in_standby());
}

static void the_empty_room_can_be_dark() {
  fresh();
  s.sensor(Sensor::OFF, Empty::DARK, 0, now_ms);
  after(1); s.tick(now_ms); pass();
  assert(s.in_standby() && has("light 0 in 1500") && !saver_up);
  // A standby by hand keeps the standby level, whatever the kind.
  fresh();
  s.sensor(Sensor::OFF, Empty::DARK, 60000, now_ms);
  s.standby_by_hand("Home Assistant's Sleep", now_ms); pass();
  assert(has("light 20 in 1500"));
}

static void a_standby_by_hand_and_the_sensor() {
  // Sleep while someone is there: the sensor's quick off and on as they walk away is ignored.
  fresh();
  s.sensor(Sensor::OFF, Empty::SAVER, 60000, now_ms);
  s.sensor(Sensor::ON, Empty::SAVER, 60000, now_ms);
  s.standby_by_hand("Home Assistant's Sleep", now_ms); pass();
  after(3000); s.sensor(Sensor::OFF, Empty::SAVER, 60000, now_ms);
  after(4000); s.sensor(Sensor::ON, Empty::SAVER, 60000, now_ms);
  assert(s.in_standby() && logged("Wake from the sensor held: standby by hand"));
  // Off for the whole delay, then on: someone came.
  s.sensor(Sensor::OFF, Empty::SAVER, 60000, now_ms);
  after(60000); s.sensor(Sensor::ON, Empty::SAVER, 60000, now_ms);
  assert(!s.in_standby());
  // Already off when the standby by hand began: the count starts at the standby.
  fresh();
  s.sensor(Sensor::OFF, Empty::SAVER, 60000, now_ms);
  after(120000); s.standby_by_hand("the board's key", now_ms); pass();
  after(10000); s.sensor(Sensor::ON, Empty::SAVER, 60000, now_ms);
  assert(s.in_standby());
}

static void the_sensor_word_lost() {
  // Unknown to on wakes nothing.
  fresh();
  s.standby_by_time(now_ms); pass();
  s.sensor(Sensor::ON, Empty::SAVER, 60000, now_ms);
  assert(s.in_standby());
  // A lit screen held by on falls back to the timer, counted from the loss, not from the last touch.
  fresh();
  s.sensor(Sensor::OFF, Empty::SAVER, 60000, now_ms);
  s.sensor(Sensor::ON, Empty::SAVER, 60000, now_ms);
  after(3600 * 1000);
  alive = false; s.tick(now_ms);
  assert(s.sensor_word() == Sensor::UNKNOWN && !s.in_standby() && touch_at() == now_ms);
  after(600 * 1000 + 1); s.tick(now_ms); pass();
  assert(s.in_standby() && !s.by_sensor());
  // A dark sensor standby stays dark when the word is lost.
  fresh();
  s.sensor(Sensor::OFF, Empty::DARK, 0, now_ms);
  after(1); s.tick(now_ms); pass();
  s.sensor_lost(now_ms); s.show();
  assert(s.in_standby() && s.by_sensor() && trail.back() != "light 20 in 1500");
}

static void the_sensor_respects_what_holds_the_glass() {
  fresh();
  s.sensor(Sensor::OFF, Empty::SAVER, 0, now_ms);
  owners = ALERT;
  after(10000); s.tick(now_ms);
  assert(!s.in_standby());
  owners = 0; s.tick(now_ms); pass();
  assert(s.in_standby());
}
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `clang++ -std=c++17 -Wall -Wextra -Werror -I. tests/test_screen_standby.cpp -o /tmp/tss && /tmp/tss`
Expected: compile errors naming `Sensor`, `Empty`, `sensor`, `by_sensor`, `app_alive`.

- [ ] **Step 3: Implement the interfaces above in `components/smart_display/screen_standby.h`**

Private state: `Sensor sensor_ = Sensor::UNKNOWN; Empty empty_ = Empty::SAVER; uint32_t delay_ms_ = 60000, off_at_ = 0, hand_at_ = 0; bool by_sensor_ = false;`. `enter()` takes whether the sensor started it (`enter(bool hand, uint32_t now, bool sensor = false)`) and sets `hand_at_` with a standby by hand. Add the sensor's rules to the file's head comment, in its voice, under "The ways out" and the two clocks.

- [ ] **Step 4: Run the tests to see them pass**

Run: `clang++ -std=c++17 -Wall -Wextra -Werror -I. tests/test_screen_standby.cpp -o /tmp/tss && /tmp/tss`
Expected: `screen_standby ok`. The older cases still pass unchanged.

- [ ] **Step 5: Commit**

```bash
git add components/smart_display/screen_standby.h tests/test_screen_standby.cpp
git commit -m "The standby follows a sensor's word: held lit while on, to standby a delay after off (screensaver or dark), awake at the next on; a standby by hand waits for the delay off; the word lost keeps a standby and starts the time of a lit screen again."
```

---

### Task 2: The firmware hears the sensor

**Files:**
- Modify: `components/smart_display/page_receiver.cpp` (beside `if (op == "saver")`, and in `if (op == "hello")`)
- Modify: `packages/core.yaml` (the hello's `features`, and the glass bindings near `glass.standby_level`)

**Interfaces:**
- Consumes: `screen_standby::the().sensor(Sensor, Empty, uint32_t delay_ms, uint32_t now)`, `sensor_lost(uint32_t now)`, `Glass::app_alive` (Task 1).

- [ ] **Step 1: Parse `op == "sensor"` in `page_receiver.cpp`**

`root["on"]`: null is `Sensor::UNKNOWN`, the int 1 is `ON`, 0 is `OFF`, anything else refuses the message (`return false`). `root["m"]`: `"saver"` is `Empty::SAVER`, `"off"` is `Empty::DARK`, else refuse. `root["d"]`: an int from 0 to 600, else refuse. Then `screen_standby::the().sensor(word, kind, d * 1000, esphome::millis())`, and `result` and the return as the `saver` op sets them. Comment it in the saver op's style (app and firmware "next", `screen_saver.py`).

- [ ] **Step 2: A hello is a new session: the word is lost**

In `op == "hello"`, before the session is granted: `screen_standby::the().sensor_lost(esphome::millis());`.

- [ ] **Step 3: Bind and announce in `packages/core.yaml`**

Beside `glass.standby_level`: `glass.app_alive = []() { return runtime_tiles::feed_alive(); };`. In the hello's features, after `saver_photos`, with its comment line: `if (settings_screen::can_standby) features.add("sensor_standby");`.

- [ ] **Step 4: Run the C++ tests and build one board**

Run: `clang++ -std=c++17 -Wall -Wextra -Werror -I. tests/test_screen_standby.cpp -o /tmp/tss && /tmp/tss`
Expected: `screen_standby ok`.
Then compile the one board the user has on the bench (ask which; `esphome compile checkout/<key>.yaml`). Expected: `SUCCESS`. Do not build other boards (AGENTS.md, Checks on dev).

- [ ] **Step 5: Commit**

```bash
git add components/smart_display/page_receiver.cpp packages/core.yaml
git commit -m "The screen takes the op sensor (feature sensor_standby) and hands its word to the standby; a hello and an add-on that went silent lose it."
```

---

### Task 3: The add-on follows the sensor

**Files:**
- Modify: `screen_manager/app/screen_saver.py` (constants, `DEFAULT`, `validate`, `entities`, new `sensor_message`)
- Modify: `screen_manager/app/server.py` (`__init__`'s `self.saver_sent`, the pass that calls `sync_saver`, new `sync_sensor`, the inventory's `screen['screensaver']`)
- Test: `tests/test_screen_saver.py`

**Interfaces:**
- Produces, in `screen_saver`:
  - `SENSOR_FEATURE = 'sensor_standby'`, `SENSOR_DOMAINS = ('binary_sensor', 'input_boolean', 'switch')`, `SENSOR_OFF = ('saver', 'off')`, `SENSOR_DELAYS = (0, 15, 30, 60, 120, 300, 600)`
  - `DEFAULT` gains `'sensor': '', 'sensor_off': 'saver', 'sensor_delay': 60`
  - `sensor_message(choice: dict, states: dict) -> dict`: `{'op': 'sensor', 'on': 1 | 0 | None, 'm': choice['sensor_off'], 'd': choice['sensor_delay']}`
- Produces, in `Manager` (`server.py`): `async def sync_sensor(self, inbox, screen)`, `self.sensor_sent = {}`; the inventory's `screen['screensaver']['sensor_ready']: bool` (the screen's sender lists `SENSOR_FEATURE`).

- [ ] **Step 1: Write the failing tests**

In `tests/test_screen_saver.py`, in the file's classes and fixtures (`Manager`, `with_screen_grid`, `seed_layout`, the `Sender` stand-in of `test_the_screen_hears_once_per_change_and_per_session`):

```python
def test_a_sensor_is_checked(self):
    choice = screen_saver.validate({'sensor': 'binary_sensor.hall_presence', 'sensor_off': 'off', 'sensor_delay': 120})
    self.assertEqual((choice['sensor'], choice['sensor_off'], choice['sensor_delay']), ('binary_sensor.hall_presence', 'off', 120))
    self.assertEqual((screen_saver.DEFAULT['sensor'], screen_saver.DEFAULT['sensor_off'], screen_saver.DEFAULT['sensor_delay']), ('', 'saver', 60))
    for bad in ({'sensor': 'sensor.hall_lux'}, {'sensor': 'person.someone'}, {'sensor_off': 'dark'},
                {'sensor_delay': 45}, {'sensor_delay': True}, {'sensor': 'Binary_Sensor.x'}):
        with self.assertRaises(ValueError):
            screen_saver.validate(bad)
    for entity in ('input_boolean.guest_mode', 'switch.tv_power'):
        self.assertEqual(screen_saver.validate({'sensor': entity})['sensor'], entity)

def test_the_sensor_word(self):
    choice = screen_saver.validate({'sensor': 'binary_sensor.hall_presence'})
    word = lambda state: screen_saver.sensor_message(choice, {'binary_sensor.hall_presence': {'state': state}} if state else {})['on']
    self.assertEqual([word('on'), word('off'), word('unavailable'), word('unknown'), word(None)], [1, 0, None, None, None])
    self.assertEqual(screen_saver.sensor_message(dict(screen_saver.DEFAULT), {}), {'op': 'sensor', 'on': None, 'm': 'saver', 'd': 60})

def test_the_sensor_is_followed_without_the_screensaver(self):
    choice = screen_saver.validate({'show': False, 'sensor': 'binary_sensor.hall_presence'})
    self.assertIn('binary_sensor.hall_presence', screen_saver.entities(choice, {}))

async def test_the_screen_hears_the_sensor_once_per_change_and_per_session(self):
    # As test_the_screen_hears_once_per_change_and_per_session, with features {screen_saver.FEATURE, screen_saver.SENSOR_FEATURE}
    # and the choice {'sensor': 'binary_sensor.hall_presence'}: two sync_sensor calls send one {'op': 'sensor', 'on': 1, ...};
    # the state to 'off' sends one with 'on': 0; a new session ('S2') sends it again; a sender without SENSOR_FEATURE gets nothing;
    # an auxiliary that raises sends it again on the next call; m.watched_entities() holds the sensor;
    # the inventory's screen['screensaver']['sensor_ready'] is True with the feature and False without.
```

- [ ] **Step 2: Run them to see them fail**

Run: `python3 -m unittest tests.test_screen_saver -v`
Expected: the four new tests FAIL (unknown fields, no `sensor_message`, no `sync_sensor`).

- [ ] **Step 3: Implement in `screen_saver.py`**

`validate`: `sensor` is `''` or a lowercase entity id (`ENTITY`, at most 120 characters) whose domain is in `SENSOR_DOMAINS`; `sensor_off` in `SENSOR_OFF`; `sensor_delay` an int (not a bool) in `SENSOR_DELAYS`. `entities`: adds `choice['sensor']` when set, whatever `show` says. `sensor_message`: the state `on` is 1, `off` is 0, everything else and no sensor is None.

- [ ] **Step 4: Implement in `server.py`**

`sync_sensor` copies `_sync_saver`'s guard (protocol 2, confirmed, the feature in `sender.features`), key (`(sender.session, json.dumps(message, sort_keys=True))`), delivery and its failure path, with `self.sensor_sent` and the log line `'Sensor standby on %s: %s'` (the word). Call it right after `await self.sync_saver(inbox, screen)` in the pass. In the inventory, beside `photos_step`: `'sensor_ready': screen_saver.SENSOR_FEATURE in (getattr(manager.page_senders.get(screen['id']), 'features', None) or ())`.

- [ ] **Step 5: Run the tests to see them pass**

Run: `python3 -m unittest tests.test_screen_saver tests.test_compat_0431 -v`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add screen_manager/app/screen_saver.py screen_manager/app/server.py tests/test_screen_saver.py
git commit -m "The app follows a screen's standby sensor (binary_sensor, input_boolean or switch) and sends its word, op sensor, to a screen that takes it: once per change and per session, also with Show in standby off."
```

---

### Task 4: The editor's row and drawer

**Files:**
- Modify: `web/src/types.ts` (`ScreensaverChoice`, `ScreensaverView`)
- Modify: `web/src/stores/screensaver.ts` (constants, `sensorSummary`, `setSensor`, `standbyOn`'s hint)
- Modify: `web/src/stores/inspector.ts` (kind `"saver-sensor"`, `openSaverSensor()`)
- Create: `web/src/components/SaverSensorInspector.vue`
- Modify: `web/src/components/Drawer.vue`, `web/src/components/ScreensaverCard.vue`
- Modify: `screen_manager/translations/en.json` (under `editor.screen_settings.screensaver.sensor`)
- Modify: `screen_manager/app/static` (build output)
- Test: `web/tests/screensaver.spec.ts`

**Interfaces:**
- Consumes: the inventory's `screensaver.sensor`, `sensor_off`, `sensor_delay`, `sensor_ready`, `standby` (Task 3); `PUT api/screens/<inbox>/screensaver` through the existing `changeSaver`.
- Produces:
  - `ScreensaverChoice` gains `sensor?: string; sensor_off?: "saver" | "off"; sensor_delay?: number`; `ScreensaverView` gains `sensor_ready?: boolean`.
  - `export const SENSOR_DOMAINS = ["binary_sensor", "input_boolean", "switch"] as const; export const SENSOR_DELAYS = [0, 15, 30, 60, 120, 300, 600] as const;`
  - store: `sensorSummary(): { text: string; missing?: boolean }`, `setSensor(patch: Pick<Partial<ScreensaverChoice>, "sensor" | "sensor_off" | "sensor_delay">)`, `sensorChoices` (the user's entities in `SENSOR_DOMAINS`, as `UiPicker` items).
  - inspector: `{ kind: "saver-sensor" }` and `openSaverSensor()`.

- [ ] **Step 1: Write the failing tests**

In `web/tests/screensaver.spec.ts`, with its `saver()` fixture:

```ts
describe("standby from a sensor", () => {
  it("has a row above the steps that says what it does", () => {
    // saver({ sensor: "binary_sensor.hall_presence", sensor_off: "off", sensor_delay: 60, sensor_ready: true })
    // the card's first row is [data-setting="saver-sensor"], its line names the entity and "Screen off after 1 min";
    // with sensor: "" its line says "Off".
  });
  it("opens the drawer, picks an entity, the kind and the delay", async () => {
    // a click on the row: insp.inspector is { kind: "saver-sensor" }; SaverSensorInspector's picker lists only
    // binary_sensor, input_boolean and switch entities; picking one, choosing "Screensaver" and 5 min calls
    // scr.setScreensaver with { sensor }, { sensor_off: "saver" }, { sensor_delay: 300 }.
  });
  it("says the screen needs new firmware, and is not there on a screen without standby", () => {
    // sensor_ready: false: the row is inactive with the firmware hint; standby: false: no row.
  });
  it("drops the Auto standby hint while a sensor is set", () => {
    // standby_enabled false and sensor set: no "Turn on Auto standby to use it." under Show in standby.
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd web && npx vitest run tests/screensaver.spec.ts`
Expected: the new cases FAIL.

- [ ] **Step 3: Implement**

The row follows the step rows' markup and look (`.saver-row`, its line from `sensorSummary`), stands above `#screensaver-steps`, is not draggable, and shows only with `screensaver.saver.standby`. The drawer uses `InspectorHead`, a searchable `UiPicker` of `sensorChoices` with a way to clear the entity, `UiSegmented` for "When it turns off" (Screensaver, Screen off) and `UiSelect` for "After" (`SENSOR_DELAYS`, words like "Right away", "15 s", "1 min"). Texts in `en.json` under `editor.screen_settings.screensaver.sensor` (`title`, `none`, `search`, `empty`, `when_off`, `saver`, `off`, `after`, `now`, `summary`, `needs_firmware`); the hint `standby_off` shows only without a sensor.

- [ ] **Step 4: Run the editor's tests, the translations and the build**

Run: `cd web && npm test && npm run build && cd .. && python3 tools/i18n.py check && python3 tools/i18n.py lint`
Expected: all PASS, the build writes `screen_manager/app/static`.

- [ ] **Step 5: Commit**

```bash
git add web/src web/tests screen_manager/translations/en.json screen_manager/app/static
git commit -m "The editor: Standby from a sensor in the Screensaver card, a row that opens its drawer with the entity, what the empty room shows and the delay."
```

---

### Task 5: The docs and the changelog

**Files:**
- Modify: `docs/SCREENSAVER.md` (a section "Standby from a sensor", using it and how it works)
- Modify: `docs/ARCHITECTURE.md` ("13. The standby": one line on the sensor's word)
- Modify: `screen_manager/CHANGELOG.md` (a line under `## Unreleased`; add the heading when it is missing)

- [ ] **Step 1: Write the section in `docs/SCREENSAVER.md`**

Using it: the row, the entity kinds, the two choices, the delay, what Sleep and an unavailable sensor do, that it needs firmware with `sensor_standby` and a board that goes into standby. How it works: the three fields, `sensor_message`, the op and its fields, `Standby::sensor` and its test. Plain English, no em dashes, generic entity ids, no versions invented (name "the next release").

- [ ] **Step 2: Check**

Run: `grep -c "—" docs/SCREENSAVER.md docs/ARCHITECTURE.md screen_manager/CHANGELOG.md`
Expected: the same counts as before the change (no new em dashes).

- [ ] **Step 3: Commit**

```bash
git add docs/SCREENSAVER.md docs/ARCHITECTURE.md screen_manager/CHANGELOG.md
git commit -m "Docs: Standby from a sensor."
```

---

## After the tasks

On real glass (AGENTS.md: on dev the proof is the bench): flash the board from Task 2, pick a sensor, and check by hand: lit while on, standby a delay after off in each kind, awake at on, Sleep while present holds. Only a person can do this; report which checks ran.
