<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import { toast } from '@1337exp/taoui';
import { STYLE_DEFAULTS, TUNING_GROUPS, tuning, type StyleName, type TuningKey } from '../tuning';

/**
 * Ползунки для tuning.ts. reactive() пишет сквозь Proxy в тот же объект, который сцена читает каждый кадр,
 * поэтому изменения действуют сразу. Значения запоминаются в браузере; «Скопировать» — чтобы перенести в код.
 * Панель же и переключает стиль: при смене стиля в tuning заливаются его значения плюс сохранённые правки.
 * В браузере хранится только то, что отличается от значений по умолчанию стиля.
 */
const props = defineProps<{ look: StyleName }>();

// Мультяшный стиль хранится под прежним ключом, чтобы не потерять уже подобранное.
const storageKey = (style: StyleName) => (style === 'toon' ? 'pkt-dice:tuning' : `pkt-dice:tuning:${style}`);
const keys = Object.keys(STYLE_DEFAULTS.toon) as TuningKey[];

const values = reactive(tuning);
let loading = false;

function load(style: StyleName) {
    loading = true;
    Object.assign(values, STYLE_DEFAULTS[style]);
    try {
        const saved = JSON.parse(localStorage.getItem(storageKey(style)) ?? 'null') as Partial<typeof tuning> | null;
        for (const key of keys) {
            if (typeof saved?.[key] === 'number') values[key] = saved[key];
        }
    } catch {
        // Хранилище недоступно (приватный режим) — просто работаем со значениями по умолчанию.
    }
    loading = false;
}

watch(() => props.look, load, { immediate: true });

// flush: 'sync' — чтобы загрузка стиля (loading) гарантированно не записывалась обратно.
watch(
    values,
    () => {
        if (loading) return;
        const defaults = STYLE_DEFAULTS[props.look];
        const changed = Object.fromEntries(keys.filter((key) => values[key] !== defaults[key]).map((key) => [key, values[key]]));
        try {
            localStorage.setItem(storageKey(props.look), JSON.stringify(changed));
        } catch {
            // см. выше
        }
    },
    { deep: true, flush: 'sync' },
);

const defaults = computed(() => STYLE_DEFAULTS[props.look]);
const groups = computed(() =>
    TUNING_GROUPS.map((group) => ({ ...group, knobs: group.knobs.filter((knob) => !knob.only || knob.only.includes(props.look)) })).filter((group) => group.knobs.length),
);

function reset() {
    Object.assign(values, defaults.value);
}

async function copy() {
    const lines = keys.map((key) => `    ${key}: ${+values[key].toFixed(3)},`);
    try {
        await navigator.clipboard.writeText(`export const tuning = {\n${lines.join('\n')}\n};\n`);
        toast().success().message('Значения скопированы — вставь в src/tuning.ts');
    } catch {
        toast().danger().message('Буфер обмена недоступен');
    }
}

const format = (v: number, step: number, unit = '') => `${v.toFixed(step < 0.01 ? 3 : step < 1 ? 2 : 0)}${unit ? ' ' + unit : ''}`;
</script>

<template>
    <TaoBlock class="tuning tao-size-small" surface="glass" :padding="14">
        <div class="tuning__scroll">
            <section v-for="group in groups" :key="group.title" class="tuning__group">
                <div class="tuning__title">{{ group.title }}</div>
                <label v-for="knob in group.knobs" :key="knob.key" class="tuning__knob">
                    <span class="tuning__head">
                        <span>{{ knob.label }}</span>
                        <b :class="{ 'tuning__changed': values[knob.key] !== defaults[knob.key] }">
                            {{ format(values[knob.key], knob.step, knob.unit) }}
                        </b>
                    </span>
                    <TaoSlider v-model="values[knob.key]" :min="knob.min" :max="knob.max" :step="knob.step" variant="thin" :aria-label="knob.label" />
                </label>
            </section>
        </div>
        <TaoFlex class="tuning__actions" gap="6">
            <TaoButton variant="secondary" @click="copy">Скопировать</TaoButton>
            <TaoButton variant="ghost" tone="neutral" @click="reset">Сбросить</TaoButton>
        </TaoFlex>
    </TaoBlock>
</template>

<style scoped>
.tuning {
    position: absolute;
    top: 16px;
    right: 16px;
    bottom: 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 280px;
    max-height: calc(100% - 32px);
}

.tuning__scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding-right: 4px;
}

.tuning__group + .tuning__group {
    margin-top: 14px;
}

.tuning__title {
    margin-bottom: 6px;
    color: var(--tao-color-text);
    font-weight: 600;
    font-size: 13px;
}

.tuning__knob {
    display: block;
    margin-bottom: 8px;
}

.tuning__head {
    display: flex;
    justify-content: space-between;
    margin-bottom: 4px;
    color: var(--tao-color-text-muted);
    font-size: 12px;
}

.tuning__head b {
    color: var(--tao-color-text);
    font-weight: 500;
    font-variant-numeric: tabular-nums;
}

.tuning__head b.tuning__changed {
    color: var(--tao-color-accent);
}
</style>
