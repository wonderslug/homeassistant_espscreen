# Standby from a sensor: design

## Intent

A screen should be lit while someone is in the room and go to standby once the room is empty, the way espcontrol's
presence screensaver works. Today a screen goes to standby only when nobody has touched it for the standby time (at
least 600 s), and a sensor can only wake it through an automation the user writes that presses the screen's Motion
button. Nothing puts a screen to standby because a room emptied, and a person who stands in front of the screen
without touching it sees it dim.

This is a control of the Screensaver card in the editor, not a screensaver step. The screensaver steps (cover, photos,
camera, clock) keep deciding what standby shows; the sensor decides when standby starts and ends. Like espcontrol, the
user picks per screen whether the empty room shows the screensaver or turns the glass off.

## Goals

- One entity per screen, picked in the editor, drives its standby. Any entity with an on and off state:
  `binary_sensor` of any device class (occupancy, presence, motion, door), `input_boolean`, `switch`.
- While the entity is `on`, the screen stays lit at its brightness and the touch timer does not run.
- When it turns `off`, a delay starts (counted from the later of the turn to off and the last touch). When the delay
  runs out, the screen goes to standby, either as today's standby with its screensaver, or with the glass off.
- When it turns `on` again, a screen in either kind of standby wakes at once.
- No automation, no reflash and no reconnect when the user picks or changes the entity.

## Non-goals

- More than one sensor per screen. A Home Assistant group or template binary sensor combines several.
- Entities without an on and off state (`person`, `device_tracker`, a numeric lux sensor). A template binary sensor
  covers them.
- A schedule (screen off at night). Night hours and night brightness stay as they are.
- Changing the Motion and Wake buttons or what an automation pressing them does.
- Working without the add-on running.

## Anti-goals

- A broken or unavailable sensor must never leave a screen stuck lit or stuck dark: it falls back to today's timer.
- The sensor must never wake a screen straight back up after someone sent it to standby by hand.
- No widening of the eleven-key `settings` block, no new screen setting entity: this lives in the add-on's screensaver
  choice.
- Older firmware and older layouts keep working unchanged.

## Approaches

1. **The add-on follows the sensor and tells the screen (chosen).** The choice is stored with the screensaver
   choice, the add-on watches the entity as it watches the screensaver's players and camera, and sends the screen a
   short message when it changes. The screen's standby (`screen_standby.h`) holds the rules. It reuses the editor's
   picker, the storage and the entity watching, needs no reconnect, and a screen that hears nothing falls back to its
   timer. It needs the add-on running, which every screen needs for its tiles already, and it adds one hop (well under a
   second).
2. **The screen subscribes to the entity in Home Assistant itself** (espcontrol's way). It works without the add-on,
   but ESPHome subscribes to Home Assistant states when it connects, so a new entity means a reconnect; it needs a new
   screen setting through `settings_screen.h`, `SETTING_RULES` and `SETTING_ENTITIES`; and it is a second way for
   entity states to reach a screen.
3. **No firmware change: the add-on presses Wake and Sleep.** Dropped. It cannot hold a screen lit while someone is
   there, its Sleep is a standby by hand with that one's rules, and "glass off" would mean rewriting Standby
   brightness.

Chosen: 1, because a screen already depends on the add-on for every tile, and falling back to the timer when the add-on
is gone is the safe failure.

## What was decided

### Behaviour on the screen

The sensor's word is one of: `on`, `off`, unknown. Unknown is: no sensor chosen, the entity `unavailable` or `unknown`
or missing, no word from the add-on in this session, or older add-on.

- **Unknown**: everything is as today (Auto standby with its time, or no standby when it is off).
- **On**: the screen does not go to standby by time, whatever Auto standby says. Something that holds the glass lit
  today (calibration, an alert, a ring) still does.
- **Off**: the screen goes to standby when `delay` has passed since the later of the turn to off and the last touch.
  This works whether Auto standby is on or off: picking a sensor takes over from the Auto standby switch and its time
  for that screen. Auto standby turned off must not light a screen the sensor put in standby (today `show()` lights a
  timer standby when Auto standby is off; a sensor standby is exempt).
- **The turn to on** wakes a screen in a sensor standby or a timer standby, at once, as `wake_from` does, but it is not
  held by the 60 s quiet rule (`waits_for_quiet`). On a lit screen it only starts the standby time again.
- **A standby by hand** (Home Assistant's Sleep, the board's key, the home key held) stays until a touch, or until the
  sensor has been `off` for the whole `delay` and then turns `on`. A turn to on before the sensor has been off that
  long is ignored, because a motion sensor goes on, off and on again within seconds while the
  person who pressed Sleep walks away, and that must not light the screen again. It takes the place of the 60 s quiet
  rule for this sensor and reuses the delay the user already set. A turn to off that comes during a standby by hand
  starts that count. If the sensor was already off when the standby by hand began, the count starts at the standby.
- **The first word, or a word after unknown, is no turn** (builder check, my call). Unknown to `on` wakes nothing: a
  screen in standby stays there, and a lit one is held lit from then on. Unknown to `off` starts the delay from the
  moment the screen hears it. The message carries no time of the change, so this is the simplest honest rule. The cost:
  a screen put in standby while the add-on was away stays dark until a touch or the next real turn to on.
- **The word lost** (it becomes unknown: the entity unavailable, a new session, the add-on gone) (builder check, my
  call): a screen in standby stays in standby as it is, at the level it has, until a touch or a wake. That includes a
  sensor standby with Auto standby off: `show()` does not light it then. A lit screen falls back to the timer counting
  from that moment (`stir`), so it does not go dark at once because the last touch was hours ago.
- **The kind of standby**, chosen per screen:
  - `saver`: today's standby, at Standby brightness (night brightness at night), with the screensaver when Show in
    standby is on and a step is available, else the dimmed tiles. With Standby brightness 0 it is dark, as today.
  - `off`: the backlight at 0 and the power saving of a dark screen (`screen_power`), no screensaver, whatever Standby
    brightness says. This is the existing "level 0" path in `Standby::show()`.
  The kind applies to a standby the sensor started. A standby by time (sensor unknown) or by hand keeps today's level.
- Back to page 1 on standby, the closing of cards and the settings page, and the power saving work as for any standby.

### The choice, in the add-on

Three new optional fields in the screensaver choice (`screen_manager/app/screen_saver.py`, `DEFAULT` and
`validate`), stored in `screensavers.json` per Home Assistant device:

- `sensor`: an entity id in `binary_sensor`, `input_boolean` or `switch`, or `''` (none, the default).
- `sensor_off`: `'saver'` (default) or `'off'`.
- `sensor_delay`: seconds, one of `0, 15, 30, 60, 120, 300, 600`; default `60`. The delay is its own and not Auto
  standby's 600 s minimum: that time means "nobody touched it", and sensors already wait a while of their own before
  they report clear.

The sensor is watched whether or not Show in standby is on (`screen_saver.entities` today follows the steps' entities
only with `show` on; the sensor is followed whenever it is set).

### On the wire

Negotiated like every extension: a screen whose hello lists the feature `sensor_standby` gets, in its session, as the
screensaver's word goes (`_sync_saver` in `server.py`: once in every new session and whenever it changes, again on the
next pass when the answer did not come):

```json
{"op": "sensor", "on": 1, "m": "off", "d": 60}
```

`on` is `1`, `0`, or `null` for unknown (no sensor is `null` too). `m` is `saver` or `off`, `d` the delay in seconds.
Only `on` changes with the sensor. A screen without the feature never gets the message, and the editor tells the user
the screen needs new firmware, as the screensaver card does with `SAVER_MIN_FIRMWARE`.

### On the screen

- The message is read beside `op == "saver"` in `page_receiver.cpp` and hands the word to `screen_standby`.
- `screen_standby.h` keeps the state and every rule above, free of LVGL and ESPHome as it is today, with its cases in
  `tests/test_screen_standby.cpp`: on holds off the timer, off and the delay, the turn to on wakes from each standby,
  no wake by the quiet rule, standby by hand stays until off for the delay and then on (and a quick off and on is
  ignored), the first word and a word after unknown are no turn, the word lost keeps a standby and stirs a lit
  screen, unknown is today's behaviour, Auto standby off
  does not light a sensor standby, the `off` kind gives level 0.
- The word lasts for the session it came in. A new session, or the add-on gone, makes it unknown, so a sensor stuck at
  `on` in a dead add-on cannot keep a screen lit for ever. The screen already knows when the add-on is gone:
  `runtime_tiles::feed_alive()` (about 300 s, with the add-on's 120 s keepalive). The sensor's word is unknown once
  that runs out.
- `packages/core.yaml` adds `sensor_standby` to the hello's features where the board can go to standby.

### In the editor

- The Screensaver card gets one row, "Standby from a sensor", above the steps, as calm as the steps: its line says the
  entity and what happens ("Screen off after 1 min", or "Off"). The row opens a drawer, as a step does, with the
  entity (a searchable `UiPicker` of the user's on and off entities), "When it turns off" (Screensaver or Screen off)
  and "After" (the delay).
- The row is there only for a screen that can go to standby (the inventory's `standby`), and says it needs new firmware
  for a screen whose hello lacks `sensor_standby`.
- It reads and writes through `web/src/stores/screensaver.ts` and `PUT api/screens/<inbox>/screensaver`, as the steps do.

### Text and docs

- Every text in `screen_manager/translations/en.json`.
- docs/SCREENSAVER.md gets a section "Standby from a sensor" (using it, and how it works), and docs/ARCHITECTURE.md's
  "The standby" one line on the sensor's word.
- A line under `## Unreleased` in `screen_manager/CHANGELOG.md`.

## Left to the builder

- The names in the code, the exact state and methods added to `Standby`, and how the session's end reaches it.
- Whether the delay is a wait on the standby's one timer or checked in `tick()` (the timer standby is checked in
  `tick()` every second, which is precise enough).
- The drawer's layout and words, within the card's look.
- Tests in `tests/test_screen_saver.py` for the fields, the watching and the message, and the editor's tests.

## Compatibility

- An older add-on reading a `screensavers.json` with the new fields drops that device's choice (its `validate`
  refuses unknown fields), as with every field added to the choice before (photos, plugins). A downgrade loses that
  screen's screensaver choice; this has been accepted for earlier fields and is accepted here.
- Older firmware never gets the message. Layouts and the settings block do not change.
