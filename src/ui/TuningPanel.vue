<script setup lang="ts">
import { shallowRef, watch } from 'vue';
import { TuningPanel as TuningSliders } from '@1337exp/pkt-threejs-blueprint/vue/tuning-panel';
import { createStyleTuning, type StyleName } from '../tuning';

/**
 * Ползунки рисует панель библиотеки по схеме выбранного стиля. Значения живут в том же объекте tuning, который сцена читает
 * каждый кадр; сохранение и «скопировать как код» делает хранилище. При смене стиля создаётся хранилище этого стиля:
 * в tuning заливаются его умолчания плюс сохранённые правки.
 */
const props = defineProps<{ look: StyleName }>();

const labels = { copy: 'Скопировать', reset: 'Сбросить', copied: 'Скопировано', copyFailed: 'Буфер обмена недоступен' };
const tuner = shallowRef(createStyleTuning(props.look));
watch(
    () => props.look,
    (style) => {
        tuner.value = createStyleTuning(style);
    },
);
</script>

<template>
    <TuningSliders :tuning="tuner" floating :labels="labels" />
</template>
