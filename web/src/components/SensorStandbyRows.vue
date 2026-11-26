<script setup lang="ts">
// Standby from a sensor, as three rows of the Standby card (docs/SCREENSAVER.md): the Sensor (the one entity whose word
// starts and ends the standby), and once one is chosen how long the screen waits after it turns off, and Screen off
// (the empty room goes dark instead of showing the screensaver). The store holds the rules (sensorChoices, sensorMissing,
// setSensor); the add-on watches the entity and sends its word to the screen. Same row markup as SettingRows.
import { computed } from "vue";
import { t } from "../i18n";
import Icon from "./ui/Icon.vue";
import UiPicker from "./ui/UiPicker.vue";
import UiSelect from "./ui/UiSelect.vue";
import UiSwitch from "./ui/UiSwitch.vue";
import { useEntitiesStore } from "../stores/entities";
import { SENSOR_DELAYS, useScreensaverStore } from "../stores/screensaver";

const entities = useEntitiesStore();
const screensaver = useScreensaverStore();
const T = (name: string) => t(`editor.screen_settings.screensaver.sensor.${name}`);

const saver = computed(() => screensaver.saver);
const shown = computed(() => Boolean(saver.value?.standby));
const ready = computed(() => Boolean(saver.value?.sensor_ready));
const sensor = computed(() => saver.value?.sensor || "");
const items = computed(() => screensaver.sensorChoices.filter((item) => item.id !== sensor.value));
const delays = computed<[number, string][]>(() => SENSOR_DELAYS.map((seconds) => [seconds, screensaver.sensorDelayLabel(seconds)]));
const screenOff = computed(() => saver.value?.sensor_off === "off");
</script>

<template>
  <template v-if="saver && shown">
    <div class="srow sensor-standby" :class="{ inactive: !ready }" data-setting="sensor-standby">
      <span class="s-label" id="saver-sensor-label">{{ T("entity") }}</span>
      <div class="s-control">
        <UiPicker :items="items" :placeholder="T('search')" :empty="T('empty')" align="end" @pick="(id: string) => screensaver.setSensor({ sensor: id })">
          <template #trigger>
            <!-- Its name is what it shows (the sensor, or Choose a sensor); the row's label describes it. Chosen, it reads as
                 a setting's value, as a select of the next row does. -->
            <button v-if="sensor" type="button" class="ui-select sensor-pick" id="saver-sensor-entity" aria-describedby="saver-sensor-label"
              :disabled="!ready"><span class="sensor-name">{{ entities.entityName(sensor) }}</span><Icon name="chevron-down" /></button>
            <button v-else type="button" class="ghost-btn sensor-pick" id="saver-sensor-entity" aria-describedby="saver-sensor-label"
              :disabled="!ready"><Icon name="plus" /><span class="sensor-name">{{ T("choose") }}</span></button>
          </template>
        </UiPicker>
        <button v-if="sensor" type="button" class="sensor-clear" :aria-label="T('clear')" :disabled="!ready" @click="screensaver.setSensor({ sensor: '' })"><Icon name="close" /></button>
      </div>
    </div>
    <p v-if="screensaver.sensorMissing" class="hint missing" id="saver-sensor-missing">{{ T("missing") }}</p>
    <p v-if="!ready" class="hint" id="saver-sensor-firmware">{{ T("needs_firmware") }}</p>
    <template v-if="sensor">
      <div class="srow" :class="{ inactive: !ready }" data-setting="sensor-delay">
        <label class="s-label" for="saver-sensor-after">{{ T("delay") }}</label>
        <div class="s-control">
          <UiSelect id="saver-sensor-after" :model-value="saver.sensor_delay ?? 60" :options="delays" :disabled="!ready"
            @update:model-value="(value: number) => screensaver.setSensor({ sensor_delay: value })" />
        </div>
      </div>
      <div class="srow setting-toggle" :class="{ inactive: !ready }" data-setting="sensor-off">
        <span class="s-label" id="saver-sensor-off-label">{{ T("screen_off") }}</span>
        <div class="s-control">
          <UiSwitch id="saver-sensor-off" :model-value="screenOff" :disabled="!ready" aria-labelledby="saver-sensor-off-label"
            @update:model-value="(value: boolean) => screensaver.setSensor({ sensor_off: value ? 'off' : 'saver' })" />
        </div>
      </div>
      <p class="hint">{{ T("hint") }}</p>
    </template>
  </template>
</template>

<style scoped>
.sensor-name { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.s-control { display: flex; align-items: center; gap: 6px; min-width: 0; }
.sensor-pick { width: auto; min-width: 0; }
.ghost-btn.sensor-pick { padding: 7px 11px; }
/* The clear button, as a chip's own (.item .x in app.css). */
.sensor-clear { color: var(--muted); width: 24px; height: 24px; display: grid; place-items: center; border-radius: 6px; flex: none; font-size: 15px; }
.sensor-clear:hover:not(:disabled) { color: var(--danger); background: var(--danger-soft); }
.hint.missing { color: var(--danger); }
</style>
