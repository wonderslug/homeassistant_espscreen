// Standby from a sensor in the Standby card (docs/SCREENSAVER.md): a Sensor row, and once one is chosen the delay and a
// Screen off switch. The store holds the logic (sensorChoices, sensorSummary, setSensor); the rows only draw it.
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import UiSelect from "../src/components/ui/UiSelect.vue";
import SensorStandbyRows from "../src/components/SensorStandbyRows.vue";
import SettingsTab from "../src/components/SettingsTab.vue";
import ScreensaverCard from "../src/components/ScreensaverCard.vue";
import { router } from "../src/router";
import type { Inventory, ScreensaverView } from "../src/types";
import { useInventoryStore } from "../src/stores/inventory";
import { useScreenStore } from "../src/stores/screen";

const saver = (patch: Partial<ScreensaverView> = {}): ScreensaverView => ({
  show: true, media: "", more: [], camera: "", order: ["media", "camera", "clock"], off: [],
  weather: "auto", items: [], ready: true, pictures: true, standby: true, sensor: "", sensor_ready: true, ...patch,
});
const sensor = { sensor: "binary_sensor.hall_presence", sensor_off: "off" as const, sensor_delay: 60, sensor_ready: true };

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
  useInventoryStore().inventory = {
    csrf: "t", connected: true,
    screens: [{ id: "living", name: "Living", online: true, firmware: "0.62.0", board: "guition", shape: { width: 480, height: 480 }, screensaver: saver(),
      settings: { owner: "screen", keys: ["standby_enabled", "standby_seconds"], values: { standby_enabled: true, standby_seconds: 600 }, unavailable: [] } }],
    entities: [
      { id: "binary_sensor.hall_presence", name: "Hall presence", area: "Hall" }, { id: "input_boolean.guest", name: "Guest mode" },
      { id: "switch.fan", name: "Fan" }, { id: "lock.front", name: "Front lock" },
    ],
    builtin: [], header: { max_items: 6, builtin: [] },
  } as unknown as Inventory;
  useScreenStore().selected = "living";
});

const spy = () => vi.spyOn(useScreenStore(), "setScreensaver").mockResolvedValue(undefined);
const give = (patch: Partial<ScreensaverView>) => { useScreenStore().currentScreen!.screensaver = saver(patch); };
const written = (set: ReturnType<typeof spy>) => set.mock.calls.map((call) => call[1]);

describe("standby from a sensor in the Standby card", () => {
  it("sits in the Standby card, not in the Screensaver card", async () => {
    await router.push("/screens/living?settings=standby");
    const tab = mount(SettingsTab, { attachTo: document.body });
    const card = tab.findAll(".set-card").find((c) => c.find('[data-setting="standby_enabled"]').exists())!;
    expect(card.find('[data-setting="sensor-standby"]').exists()).toBe(true);
    expect(card.find('[data-setting="sensor-standby"]').text()).toContain("Sensor");
    expect(mount(ScreensaverCard).find('[data-setting="sensor-standby"]').exists()).toBe(false);
    expect(mount(ScreensaverCard).find('[data-setting="saver-sensor"]').exists()).toBe(false);
    tab.unmount();
  });

  it("picks a sensor, its delay and Screen off", async () => {
    const set = spy();
    const wrapper = mount(SensorStandbyRows, { attachTo: document.body });
    // Only the Sensor row with no sensor.
    expect(wrapper.find('[data-setting="sensor-standby"]').exists()).toBe(true);
    expect(wrapper.find('[data-setting="sensor-delay"]').exists()).toBe(false);
    expect(wrapper.find('[data-setting="sensor-off"]').exists()).toBe(false);
    await wrapper.find("#saver-sensor-entity").trigger("click");
    await flushPromises();
    const options = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')];
    expect(options.map((o) => o.textContent)).toEqual(expect.arrayContaining([expect.stringContaining("Hall presence")]));
    expect(options.some((o) => o.textContent?.includes("Front lock"))).toBe(false);
    options.find((o) => o.textContent?.includes("Hall presence"))!.click();
    await flushPromises();
    expect(written(set)).toEqual([{ sensor: "binary_sensor.hall_presence" }]);

    give(sensor);
    await flushPromises();
    expect(wrapper.find('[data-setting="sensor-delay"]').exists()).toBe(true);
    expect(wrapper.find("#saver-sensor-after").text()).toContain("1 min");
    const off = wrapper.find('[data-setting="sensor-off"] [role="switch"]');
    expect(off.attributes("aria-checked")).toBe("true");
    await off.trigger("click");
    expect(written(set)).toContainEqual({ sensor_off: "saver" });
    give({ ...sensor, sensor_off: "saver" });
    await flushPromises();
    await wrapper.find('[data-setting="sensor-off"] [role="switch"]').trigger("click");
    expect(written(set)).toContainEqual({ sensor_off: "off" });

    // The select itself is Reka's (jsdom cannot open it); its choice of 5 min reaches the store as a number.
    expect((wrapper.findComponent(UiSelect).props() as { options: unknown }).options).toContainEqual([300, "5 min"]);
    wrapper.findComponent(UiSelect).vm.$emit("update:modelValue", 300);
    await flushPromises();
    expect(written(set)).toContainEqual({ sensor_delay: 300 });
    wrapper.unmount();
  });

  it("clears the sensor", async () => {
    give(sensor);
    const set = spy();
    const wrapper = mount(SensorStandbyRows, { attachTo: document.body });
    expect(wrapper.text()).toContain("Hall presence");
    await wrapper.find('button[aria-label="Remove the sensor"]').trigger("click");
    expect(written(set)).toEqual([{ sensor: "" }]);
    give({ sensor: "" });
    await flushPromises();
    expect(wrapper.find('[data-setting="sensor-delay"]').exists()).toBe(false);
    expect(wrapper.find('[data-setting="sensor-off"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("marks a sensor Home Assistant no longer has", () => {
    give({ ...sensor, sensor: "binary_sensor.gone" });
    const wrapper = mount(SensorStandbyRows);
    expect(wrapper.find(".missing").text()).toBe("The sensor no longer exists. Choose another.");
  });

  it("needs new firmware, and is not there on a screen without standby", () => {
    give({ ...sensor, sensor_ready: false });
    let wrapper = mount(SensorStandbyRows);
    expect(wrapper.find("#saver-sensor-firmware").text()).toBe("Update this screen to use a sensor for its standby.");
    expect(wrapper.find("#saver-sensor-entity").attributes("disabled")).toBeDefined();
    expect(wrapper.find('[role="switch"]').attributes("disabled")).toBeDefined();
    give({ ...sensor, standby: false });
    wrapper = mount(SensorStandbyRows);
    expect(wrapper.find('[data-setting="sensor-standby"]').exists()).toBe(false);
    expect(wrapper.find("#saver-sensor-firmware").exists()).toBe(false);
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
});
