<script setup lang="ts">
// Standby from a sensor, as three rows of the Standby card (docs/SCREENSAVER.md): the Sensor (the one entity whose word
// starts and ends the standby), and once one is chosen how long the screen waits after it turns off, and Screen off
// (the empty room goes dark instead of showing the screensaver). The store holds the rules (sensorChoices, sensorSummary,
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
const line = computed(() => screensaver.sensorSummary());
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
            <button type="button" class="ghost-btn" id="saver-sensor-entity" aria-labelledby="saver-sensor-label" :disabled="!ready">
              <Icon v-if="!sensor" name="plus" /><span class="sensor-name">{{ sensor ? entities.entityName(sensor) : T("choose") }}</span>
            </button>
          </template>
        </UiPicker>
        <button v-if="sensor" type="button" class="x" :aria-label="T('clear')" :disabled="!ready" @click="screensaver.setSensor({ sensor: '' })"><Icon name="close" /></button>
      </div>
    </div>
    <p v-if="sensor && line.missing" class="hint missing" id="saver-sensor-missing">{{ line.text }}</p>
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
.s-control { gap: 6px; }
.hint.missing { color: var(--danger, #c0392b); }
</style>
