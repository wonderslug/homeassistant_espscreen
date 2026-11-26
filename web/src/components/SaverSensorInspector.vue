<script setup lang="ts">
// Standby from a sensor in the drawer: the one entity whose word starts and ends the standby (a presence sensor, a door, a
// helper switch), what the empty room shows (the screensaver or the glass off) and how long the screen waits after the
// sensor turns off. The add-on watches the entity and sends its word to the screen (docs/SCREENSAVER.md).
import { computed } from "vue";
import { t } from "../i18n";
import Icon from "./ui/Icon.vue";
import InspectorHead from "./ui/InspectorHead.vue";
import PropRow from "./ui/PropRow.vue";
import Section from "./ui/Section.vue";
import UiPicker from "./ui/UiPicker.vue";
import UiSegmented from "./ui/UiSegmented.vue";
import UiSelect from "./ui/UiSelect.vue";
import { useEntitiesStore } from "../stores/entities";
import { SENSOR_DELAYS, useScreensaverStore } from "../stores/screensaver";
import { useInspectorStore } from "../stores/inspector";

const entities = useEntitiesStore();
const screensaver = useScreensaverStore();
const insp = useInspectorStore();
const T = (name: string) => t(`editor.screen_settings.screensaver.sensor.${name}`);
const crumbs = computed(() => [{ text: t("editor.screen_settings.screensaver.title"), open: insp.closeInspector }]);

const sensor = computed(() => screensaver.saver?.sensor || "");
const items = computed(() => screensaver.sensorChoices.filter((item) => item.id !== sensor.value));
const kinds = computed(() => [{ value: "saver", label: T("saver") }, { value: "off", label: T("off") }]);
const delays = computed<[number, string][]>(() => SENSOR_DELAYS.map((seconds) => [seconds, screensaver.sensorDelayLabel(seconds)]));
</script>

<template>
  <InspectorHead :title="T('title')" code="F0D91" :crumbs="crumbs" />
  <div v-if="screensaver.saver" class="dr-body saver-drawer">
    <Section :title="T('entity')">
      <div v-if="sensor" class="item saver-player single">
        <span class="tx"><b>{{ entities.entityName(sensor) }}</b><small v-if="screensaver.entityPlace(sensor)">{{ screensaver.entityPlace(sensor) }}</small></span>
        <button type="button" class="x" :aria-label="T('clear')" @click="screensaver.setSensor({ sensor: '' })"><Icon name="close" /></button>
      </div>
      <UiPicker :items="items" :placeholder="T('search')" :empty="T('empty')" @pick="(id: string) => screensaver.setSensor({ sensor: id })">
        <template #trigger>
          <button type="button" class="ghost-btn" id="saver-sensor-entity"><Icon name="plus" />{{ sensor ? T("change") : T("choose") }}</button>
        </template>
      </UiPicker>
      <small class="help">{{ T("hint") }}</small>
    </Section>
    <Section v-if="sensor" :title="T('when_off')">
      <PropRow :label="T('when_off')" icon="monitor-eye" stack>
        <UiSegmented :label="T('when_off')" :segments="kinds" :model-value="screensaver.saver.sensor_off || 'saver'"
          @update:model-value="(value: string) => screensaver.setSensor({ sensor_off: value as 'saver' | 'off' })" />
      </PropRow>
      <PropRow :label="T('after')" icon="clock-outline" for="saver-sensor-after">
        <UiSelect id="saver-sensor-after" :model-value="screensaver.saver.sensor_delay ?? 60" :options="delays"
          @update:model-value="(value: number) => screensaver.setSensor({ sensor_delay: value })" />
      </PropRow>
    </Section>
  </div>
</template>

<style scoped>
.saver-player { cursor: default; }
</style>
