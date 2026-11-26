// The screensaver's card and drawer (app 0.4.83): the card lists the steps with one line each, a step opens in the
// drawer, and the choice of the screen changes as it did.
import { flushPromises, mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SaverClock from "../src/components/SaverClock.vue";
import SaverInspector from "../src/components/SaverInspector.vue";
import SaverSensorInspector from "../src/components/SaverSensorInspector.vue";
import ScreensaverCard from "../src/components/ScreensaverCard.vue";
import type { Inventory, ScreensaverView } from "../src/types";
import { useScreenStore } from "../src/stores/screen";
import { useScreensaverStore } from "../src/stores/screensaver";
import { useInventoryStore } from "../src/stores/inventory";
import { useUiStore } from "../src/stores/ui";
import { useInspectorStore } from "../src/stores/inspector";

let insp: ReturnType<typeof useInspectorStore>;
beforeEach(() => { insp = useInspectorStore(); });

let ui: ReturnType<typeof useUiStore>;
beforeEach(() => { ui = useUiStore(); });

const saver = (patch: Partial<ScreensaverView> = {}): ScreensaverView => ({
  show: true, media: "media_player.tv", more: ["media_player.speaker"], camera: "", order: ["media", "camera", "clock"], off: ["camera"],
  weather: "auto", items: [], ready: true, pictures: true, standby: true, ...patch,
});

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
  useInventoryStore().inventory = {
    screens: [{ id: "living", name: "Living", virtual: true, shape: { width: 480, height: 480 }, screensaver: saver() }],
    entities: [
      { id: "media_player.tv", name: "Apple TV", area: "Living room" }, { id: "media_player.speaker", name: "Speaker", area: "Living room" },
      { id: "media_player.kitchen", name: "Kitchen", area: "Kitchen" }, { id: "camera.door", name: "Front door", area: "Outside" },
      { id: "weather.home", name: "Home" }, { id: "lock.front", name: "Front lock" },
    ],
    builtin: [], header: { max_items: 6, builtin: [] },
  } as unknown as Inventory;
  useScreenStore().selected = "living";
  insp.inspector = null;
  ui.tab = "settings";
});

const rows = (wrapper: ReturnType<typeof mount>) => wrapper.findAll(".saver-row").map((row) => `${row.find("b").text()}: ${row.find("small").text()}`);

describe("the screensaver card", () => {
  it("lists the steps in their order, each with one line of what it shows", () => {
    const wrapper = mount(ScreensaverCard);
    expect(wrapper.findAll(".saver-row").map((row) => row.attributes("data-kind"))).toEqual(["media", "camera", "clock"]);
    expect(rows(wrapper)).toEqual(["Music playing: Apple TV, Speaker", "Camera: Off", "Clock: Outside temperature"]);
    // No field in the card: the choices live in the drawer, so nothing can push the rows past a narrow card.
    expect(wrapper.find(".ui-select").exists()).toBe(false);
  });

  it("says what a step still lacks, and names the clock's temperature and entities", () => {
    useScreenStore().currentScreen!.screensaver = saver({ media: "", more: [], off: [], weather: "", items: [{ type: "entity", entity: "lock.front", content: "state", icon: "auto", show: "always" }] });
    expect(useScreensaverStore().summary("media")).toEqual({ text: "No player yet", missing: true });
    expect(useScreensaverStore().summary("camera")).toEqual({ text: "No camera yet", missing: true });
    expect(useScreensaverStore().summary("clock").text).toBe("Time and date, Front lock");
  });

  it("opens a step in the drawer on a click, and its switch turns it off without opening it", async () => {
    const wrapper = mount(ScreensaverCard);
    await wrapper.find('.saver-row[data-kind="media"] [role="switch"]').trigger("click");
    await flushPromises();
    expect(useScreenStore().currentScreen!.screensaver!.off).toEqual(["camera", "media"]);
    expect(insp.inspector).toBeNull();
    await wrapper.find('.saver-row[data-kind="clock"]').trigger("click");
    expect(insp.inspector).toEqual({ kind: "saver", step: "clock" });
    expect(wrapper.find('.saver-row[data-kind="clock"]').classes()).toContain("opened");
  });

  it("moves a focused row with the arrow keys", async () => {
    const wrapper = mount(ScreensaverCard, { attachTo: document.body });
    const clock = wrapper.find('.saver-row[data-kind="clock"]');
    await clock.trigger("keydown", { key: "ArrowUp" });
    expect(useScreenStore().currentScreen!.screensaver!.order).toEqual(["media", "clock", "camera"]);
  });

  it("shows the clock alone on a screen without pictures", () => {
    useScreenStore().currentScreen!.screensaver = saver({ pictures: false });
    const wrapper = mount(ScreensaverCard);
    expect(wrapper.findAll(".saver-row").map((row) => row.attributes("data-kind"))).toEqual(["clock"]);
  });
});

describe("a step in the drawer", () => {
  it("lists the players in the order they are tried, and takes one out", async () => {
    const wrapper = mount(SaverInspector, { props: { step: "media" } });
    expect(wrapper.findAll(".saver-player").map((row) => row.find(".tx b").text())).toEqual(["Apple TV", "Speaker"]);
    expect(wrapper.findAll(".saver-rank").map((rank) => rank.text())).toEqual(["1", "2"]);
    await wrapper.findAll(".saver-player")[0].find("button.x").trigger("click");
    expect(useScreenStore().currentScreen!.screensaver).toMatchObject({ media: "media_player.speaker", more: [] });
  });

  it("turns its step off and moves it a place later", async () => {
    const wrapper = mount(SaverInspector, { props: { step: "media" } });
    expect(wrapper.text()).toContain("1 of 3");
    await wrapper.find('.switch-row [role="switch"]').trigger("click");
    await flushPromises();
    expect(useScreenStore().currentScreen!.screensaver!.off).toContain("media");
    await wrapper.find('button[aria-label="Try later"]').trigger("click");
    expect(useScreenStore().currentScreen!.screensaver!.order).toEqual(["camera", "media", "clock"]);
  });

  it("shows the clock in the glass's own shape, without a temperature when none is chosen", async () => {
    useScreenStore().currentScreen!.screensaver = saver({ weather: "" });
    const wrapper = mount(SaverClock, { props: { index: -1 } });
    const glass = wrapper.find(".saver-glass");
    expect((glass.element as HTMLElement).style.aspectRatio).toBe("480 / 480");
    expect(glass.find(".saver-glass-time").text()).toMatch(/\d/);
    expect(glass.find(".saver-glass-line").text()).toBe("");
  });

  it("closes when the layout comes back", async () => {
    // The inspector closes the screensaver's drawers itself: nothing has to be started for it.
    insp.openSaverStep("clock");
    ui.tab = "layout";
    await nextTick();
    expect(insp.inspector).toBeNull();
  });
});

describe("standby from a sensor", () => {
  const sensor = { sensor: "binary_sensor.hall_presence", sensor_off: "off" as const, sensor_delay: 60, sensor_ready: true };
  const withEntities = () => {
    useInventoryStore().inventory.entities.push(
      { id: "binary_sensor.hall_presence", name: "Hall presence", area: "Hall" }, { id: "input_boolean.guest", name: "Guest mode" },
      { id: "switch.fan", name: "Fan" },
    );
  };
  const spy = () => vi.spyOn(useScreenStore(), "setScreensaver").mockResolvedValue(undefined);

  it("has a row above the steps that says what it does", () => {
    withEntities();
    useScreenStore().currentScreen!.screensaver = saver(sensor);
    const wrapper = mount(ScreensaverCard);
    const row = wrapper.find('[data-setting="saver-sensor"]');
    expect(row.exists()).toBe(true);
    expect(row.find("b").text()).toBe("Standby from a sensor");
    expect(row.find("small").text()).toBe("Hall presence · Screen off after 1 min");
    // It stands above the steps, and is not one of them: no drag, no switch.
    const html = wrapper.html();
    expect(html.indexOf('data-setting="saver-sensor"')).toBeLessThan(html.indexOf('id="screensaver-steps"'));
    expect(wrapper.find("#screensaver-steps").find('[data-setting="saver-sensor"]').exists()).toBe(false);
    expect(row.find('[role="switch"]').exists()).toBe(false);
    const store = useScreensaverStore();
    useScreenStore().currentScreen!.screensaver = saver({ ...sensor, sensor_off: "saver", sensor_delay: 0 });
    expect(store.sensorSummary().text).toBe("Hall presence · Screensaver right away");
    useScreenStore().currentScreen!.screensaver = saver({ ...sensor, sensor_delay: 300 });
    expect(store.sensorSummary().text).toBe("Hall presence · Screen off after 5 min");
    useScreenStore().currentScreen!.screensaver = saver({ sensor: "", sensor_ready: true });
    expect(store.sensorSummary().text).toBe("Off");
  });

  it("says Off in the row with no sensor, also with Show in standby off", () => {
    useScreenStore().currentScreen!.screensaver = saver({ sensor: "", sensor_ready: true, show: false });
    const wrapper = mount(ScreensaverCard);
    expect(wrapper.find('[data-setting="saver-sensor"] small').text()).toBe("Off");
  });

  it("opens the drawer, picks an entity, the kind and the delay", async () => {
    withEntities();
    useScreenStore().currentScreen!.screensaver = saver({ sensor: "", sensor_ready: true });
    const card = mount(ScreensaverCard);
    await card.find('[data-setting="saver-sensor"]').trigger("click");
    expect(insp.inspector).toEqual({ kind: "saver-sensor" });
    expect(card.find('[data-setting="saver-sensor"]').classes()).toContain("opened");

    const set = spy();
    const store = useScreensaverStore();
    // Only the entities that have an on and off state.
    expect(store.sensorChoices.map((item) => item.id).sort()).toEqual(["binary_sensor.hall_presence", "input_boolean.guest", "switch.fan"]);
    const wrapper = mount(SaverSensorInspector, { attachTo: document.body });
    expect(wrapper.find("#saver-sensor-entity").exists()).toBe(true);
    store.setSensor({ sensor: "switch.fan" });
    store.setSensor({ sensor_off: "saver" });
    store.setSensor({ sensor_delay: 300 });
    expect(set.mock.calls.map((call) => call[1])).toEqual([{ sensor: "switch.fan" }, { sensor_off: "saver" }, { sensor_delay: 300 }]);
    wrapper.unmount();
  });

  it("writes through the drawer's own controls", async () => {
    withEntities();
    useScreenStore().currentScreen!.screensaver = saver({ ...sensor, sensor_off: "saver", sensor_delay: 60 });
    const set = spy();
    const wrapper = mount(SaverSensorInspector, { attachTo: document.body });
    expect(wrapper.text()).toContain("Hall presence");
    const buttons = wrapper.findAll(".ui-segmented button");
    expect(buttons.map((b) => b.text())).toEqual(["Screensaver", "Screen off"]);
    await buttons[1].trigger("click");
    expect(set.mock.calls.map((call) => call[1])).toContainEqual({ sensor_off: "off" });
    await wrapper.find('button[aria-label="Remove the sensor"]').trigger("click");
    expect(set.mock.calls.map((call) => call[1])).toContainEqual({ sensor: "" });
    expect(wrapper.find("#saver-sensor-after").text()).toContain("1 min");
    wrapper.unmount();
  });

  it("sends the sensor's fields to the add-on", async () => {
    useScreenStore().currentScreen!.virtual = false;
    const calls: any[] = [];
    vi.stubGlobal("fetch", vi.fn((url: string, init: any) => {
      calls.push([url, JSON.parse(init.body)]);
      return Promise.resolve(new Response(JSON.stringify({ screensaver: {} }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }));
    const screen = useScreenStore().currentScreen!;
    await useScreenStore().setScreensaver(screen, { sensor: "switch.fan", sensor_off: "off", sensor_delay: 120 });
    const sent = calls[0][1].screensaver;
    expect([sent.sensor, sent.sensor_off, sent.sensor_delay]).toEqual(["switch.fan", "off", 120]);
  });

  it("says the screen needs new firmware, and is not there on a screen without standby", () => {
    useScreenStore().currentScreen!.screensaver = saver({ ...sensor, sensor_ready: false });
    let wrapper = mount(ScreensaverCard);
    const row = wrapper.find('[data-setting="saver-sensor"]');
    expect(row.classes()).toContain("inactive");
    expect(wrapper.find("#saver-sensor-firmware").text()).toBe("Update this screen to use a sensor for its standby.");
    insp.inspector = null;
    row.trigger("click");
    expect(insp.inspector).toBeNull();
    useScreenStore().currentScreen!.screensaver = saver({ ...sensor, standby: false });
    wrapper = mount(ScreensaverCard);
    expect(wrapper.find('[data-setting="saver-sensor"]').exists()).toBe(false);
  });

  it("drops the Auto standby hint while a sensor is set", () => {
    const hint = "Turn on Auto standby to use it.";
    useScreenStore().currentScreen!.settings = { owner: "x", keys: ["standby_enabled"], values: { standby_enabled: false }, unavailable: [] };
    useScreenStore().currentScreen!.screensaver = saver({ sensor: "", sensor_ready: true });
    expect(mount(ScreensaverCard).text()).toContain(hint);
    useScreenStore().currentScreen!.screensaver = saver(sensor);
    expect(mount(ScreensaverCard).text()).not.toContain(hint);
  });
});
