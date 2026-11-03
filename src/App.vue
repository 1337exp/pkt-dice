<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { DiceStage } from './dice/DiceStage';
import { STYLES, type StyleName } from './tuning';
import TuningPanel from './ui/TuningPanel.vue';

const STYLE_KEY = 'pkt-dice:style';

const host = ref<HTMLElement>();
const tuningOpen = ref(false);
const look = ref<StyleName>('toon');

try {
    const saved = localStorage.getItem(STYLE_KEY);
    if (STYLES.some((s) => s.name === saved)) look.value = saved as StyleName;
} catch {
    // Хранилище недоступно — остаёмся на мультяшном.
}
watch(look, (value) => {
    try {
        localStorage.setItem(STYLE_KEY, value);
    } catch {
        // см. выше
    }
});
const ui = reactive<{ value: number | null }>({ value: null });

// Сцена — обычный объект вне реактивности: Vue не должен оборачивать three.js в Proxy.
let stage: DiceStage | null = null;

onMounted(() => {
    stage = new DiceStage(host.value!, {
        // Пока кубик летит, результата ещё нет: число появляется на последнем ударе.
        onThrow: () => (ui.value = null),
        onResult: (value) => (ui.value = value),
    });
    // В консоли: __dice.ticker.speed = 0.2 — замедлить всё и рассмотреть анимацию; __dice.step() — один кадр вручную.
    if (import.meta.env.DEV) Object.assign(window, { __dice: stage });
    window.addEventListener('keydown', onKey);
});

onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKey);
    stage?.dispose();
});

function onKey(e: KeyboardEvent) {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === ' ' || key === 'enter') {
        e.preventDefault();
        stage?.throwDie();
    } else if (key >= '1' && key <= '6') stage?.throwDie({ value: Number(key) });
    else if (key === 'q' || key === 'й') look.value = STYLES[(STYLES.findIndex((s) => s.name === look.value) + 1) % STYLES.length]!.name;
    else if (key === 't' || key === 'е') tuningOpen.value = !tuningOpen.value;
}
</script>

<template>
    <div class="app">
        <div ref="host" class="stage" />
        <div class="vignette" />

        <TaoBlock class="hud tao-size-small" surface="glass" :padding="12">
            <div class="hud__result">
                Выпало <b>{{ ui.value ?? '–' }}</b>
            </div>
            <TaoFlex gap="6" wrap="wrap">
                <TaoButton shortcut="Space" @click="stage?.throwDie()">Бросить</TaoButton>
                <TaoButton v-model:pressed="tuningOpen" variant="ghost" tone="neutral" shortcut="T">Настройки анимации</TaoButton>
            </TaoFlex>
            <TaoFlex gap="6" wrap="wrap" align="center">
                <span class="hint">Стиль</span>
                <TaoButton
                    v-for="s in STYLES"
                    :key="s.name"
                    :variant="look === s.name ? undefined : 'secondary'"
                    @click="look = s.name"
                >
                    {{ s.label }}
                </TaoButton>
            </TaoFlex>
            <div class="hint">
                Клик по экрану — бросить кубик туда.<br />
                Пробел — бросить случайно. 1–6 — чтобы выпало именно это число. Q — сменить стиль.
            </div>
        </TaoBlock>

        <!-- v-show, а не v-if: панель при запуске поднимает сохранённые значения, даже закрытая. -->
        <TuningPanel v-show="tuningOpen" :look="look" />
    </div>
</template>

<style scoped>
.app {
    position: relative;
    height: 100%;
    overflow: hidden;
    user-select: none;
}

.stage {
    position: absolute;
    inset: 0;
}

/* Виньетка поверх сцены: дешевле постобработки и не трогает кубик в центре. */
.vignette {
    position: absolute;
    inset: 0;
    background: radial-gradient(ellipse 80% 75% at 50% 48%, transparent 55%, rgb(0 0 0 / 0.28) 100%);
    pointer-events: none;
}

.hud {
    position: absolute;
    top: 16px;
    left: 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.hud__result {
    color: var(--tao-color-text-muted);
    font-size: 13px;
}

.hud__result b {
    margin-left: 4px;
    color: var(--tao-color-text);
    font-size: 22px;
}

.hint {
    color: var(--tao-color-text-muted);
    font-size: 12px;
    line-height: 1.5;
}
</style>
