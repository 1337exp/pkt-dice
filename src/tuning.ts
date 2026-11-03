/**
 * Все ручки анимации в одном месте. Это обычный объект: сцена читает его каждый кадр,
 * поэтому значения можно менять на лету (панель настроек в демо так и делает).
 * Подобрал значения — перенеси их сюда как значения по умолчанию.
 * Параметры броска (полёт, отскоки) читаются в момент броска, остальное — каждый кадр.
 *
 * Стилей два: «мультяшный» (завихрения, дым, пыль) и «резкий» (спираль, изгиб, штрихи, резкий удар).
 * Это просто два набора значений для одного и того же объекта; переключает их панель настроек.
 */
const base = {
    /** Общая скорость игрового времени. */
    speed: 1,

    // Бросок
    flightTime: 0.85,
    /** Высота дуги над линией «откуда — куда». */
    apex: 2.4,
    /** Сколько полных оборотов кубик делает в полёте. */
    spinTurns: 3,
    /** Как рано кубик перестаёт крутиться перед ударом: 1 — крутится до самого удара, больше — раньше успокаивается. */
    spinSettle: 1.8,
    /**
     * Режим «по одной оси» (0 или 1): кубик в начале подъёма разворачивается ребром по броску, потом кувыркается
     * вокруг одной оси и ложится нужной гранью. Без отскоков: bounces в этом режиме не используются.
     */
    aimTurn: 0,
    /** С какой доли полёта начинается кувырок (в режиме aimTurn). Курс доворачивается только вместе с кувырком. */
    spinStart: 0,
    /** За какую долю кувырка вращение разгоняется с нуля (в режиме aimTurn): больше — мягче старт. */
    spinRamp: 0.15,
    /** Дуга пути (в режиме aimTurn): на сколько путь выгибается вбок, в долях его длины. Курс кубика идёт за касательной. */
    curve: 0,
    /** Вращение вокруг вертикали вместо кувырка: 0 — кувыркается вбок, 1 — крутится волчком. */
    spinUp: 0,
    /** Обороты по второй горизонтальной оси: сложение двух вращений даёт «вертушку». 0 — только одна ось. */
    spinTurns2: 0,
    /** Когда кончается вращение, в долях полёта: 1 — перед самым ударом, меньше — кубик успевает повисеть ровно. */
    spinEnd: 1,
    /** Замах: присесть перед броском. */
    windupTime: 0.22,
    windupSquash: 0.4,

    // Траектория «спираль и удар сверху»
    /** Какую долю полёта занимает вертикальное падение; 0 — обычная дуга без спирали. */
    slam: 0,
    /** Размах спирали вокруг линии полёта. */
    pathRadius: 0,
    pathTurns: 2,
    /** Изгиб кубика вдоль поворота траектории: 0 — не гнётся, 1 — как идёт траектория. */
    bend: 0,
    /** Закрутка геометрии от вращения: углы кубика отстают по дуге. 0 — кубик твёрдый. */
    twist: 0,

    // Отскоки
    bounces: 2,
    /** Высота первого отскока в долях от высоты броска; каждый следующий ниже. */
    bounceHeight: 0.2,
    /** Насколько кубик перекатывается за один отскок. */
    hopDistance: 1.1,

    // Мультяшность
    /** Вытягивание вдоль полёта: от скорости. */
    stretch: 0.6,
    maxStretch: 1.7,
    /** Во сколько раз сжимается при самом сильном ударе: меньше — сплющивается сильнее. */
    squashMin: 0.42,
    contactTime: 0.1,
    /** Покачивание после последнего удара: частота (Гц) и затухание (меньше — дольше). */
    wobbleFreq: 3.2,
    wobbleDamping: 0.2,
    settleTime: 0.9,

    // Линии и удар
    trailStrands: 2,
    trailWidth: 0.11,
    trailLife: 0.5,
    /** Винт: размах завихрений. Параллельные штрихи: на сколько они расходятся в стороны. */
    swirlRadius: 0.85,
    swirlTurns: 2.5,
    /** 0 — ленты закручены винтом вокруг траектории, 1 — параллельные штрихи вдоль неё. */
    trailParallel: 0,
    /** Сколько задних углов кубика (до 8) пускают линии: рисуют дуги вращения. Какие углы задние — решается каждый кадр по направлению полёта. */
    cornerTrails: 0,
    /** Сколько задних рёбер (до 12) пускают линии из середины: тоньше угловых, дополняют картину вращения. */
    edgeTrails: 0,
    /** Толщина линий от рёбер относительно линий от углов: 1 — такие же, меньше — тоньше, больше — толще. */
    edgeLineScale: 0.7,
    /** Разнообразие линий (0…1): у каждой своя длина, толщина и начало, выбираются заново на каждый бросок. 0 — все одинаковые. */
    trailVariety: 0,
    /** Пунктир линий (0…1): линии рвутся на отдельные штрихи, у каждой свой шаг. 0 — линии сплошные. */
    trailDash: 0,
    /**
     * Прямота линий от углов (0…1): 0 — реальный путь угла, при вращении это дуги и завихрения в пространстве;
     * 1 — параллельный штрих вдоль полёта.
     */
    cornerStraight: 0,
    /** Прямота линий от рёбер (0…1): 1 — ровный поток вдоль полёта, как воздух позади кубика. */
    edgeStraight: 0,
    /** 0 — линии пускают одни и те же углы, и каждая линия сплошная; 1 — пускают самые задние, и линии рвутся на штрихи. */
    cornerRear: 0,
    /** Прозрачность линий от рёбер относительно угловых: 1 — такие же, меньше — бледнее. */
    edgeLineAlpha: 1,
    /** Прозрачность линий от углов: 1 — непрозрачные, меньше — бледнее. */
    cornerLineAlpha: 1,
    /** Мягкость выбора задних точек (0…1): чем больше, тем дольше линия точки держится, когда та ушла вперёд, и тем цельнее линии. */
    rearSoftness: 0.12,
    /**
     * Усиление линий от поворота пути: угол между полётом и направлением на точку приземления делает линии
     * толще и темнее на внешней стороне поворота и слабее на внутренней. 0 — не влияет.
     */
    turnGain: 0,
    burstSize: 2.1,
    dust: 5,
    /** Кольцо ударной волны по полу. */
    shockwave: 0,
    /** Замирание времени на ударе: как в комиксе, кадр «бам» держится чуть дольше. */
    hitStop: 0.06,
    shake: 1,
    shadowOpacity: 0.4,

    // Вид
    outline: 0.045,
    /** Толщина чёрной каймы на гранях, в долях грани. */
    edge: 0.08,
    pipSize: 0.085,
    /** Насколько темнее грани, отвёрнутые от света. */
    shade: 0.6,
    camElevation: 52,
    camFov: 30,
    camDistance: 10.5,
    /** Яркость серого фона. */
    background: 0.55,
};

export type TuningKey = keyof typeof base;
export type StyleName = 'toon' | 'sharp' | 'spin';

export const STYLES: { name: StyleName; label: string }[] = [
    { name: 'toon', label: 'Мультяшный' },
    { name: 'sharp', label: 'Резкий' },
    { name: 'spin', label: 'Вертушка' },
];

/** Значения по умолчанию для каждого стиля. */
export const STYLE_DEFAULTS: Record<StyleName, Readonly<typeof base>> = {
    toon: base,
    sharp: {
        ...base,
        flightTime: 1,
        apex: 2,
        spinTurns: 2,
        spinSettle: 3,
        spinUp: 0.8,
        windupTime: 0.14,
        windupSquash: 0.5,
        slam: 0.22,
        pathRadius: 0.9,
        pathTurns: 2,
        bend: 1,
        bounces: 1,
        bounceHeight: 0.12,
        hopDistance: 0.7,
        stretch: 0.9,
        maxStretch: 2.1,
        squashMin: 0.3,
        contactTime: 0.15,
        wobbleFreq: 4.5,
        wobbleDamping: 0.14,
        settleTime: 1.1,
        trailStrands: 3,
        trailWidth: 0.04,
        trailLife: 0.9,
        swirlRadius: 0.5,
        trailParallel: 1,
        burstSize: 0,
        dust: 0,
        shockwave: 3,
        hitStop: 0.12,
        shake: 2.2,
    },
    spin: {
        ...base,
        flightTime: 0.4,
        apex: 2.2,
        spinTurns: 1,
        spinSettle: 1.3,
        aimTurn: 1,
        curve: 0.05,
        windupTime: 0.18,
        twist: 0.035,
        bounces: 0,
        stretch: 0.35,
        maxStretch: 1.5,
        squashMin: 0.45,
        contactTime: 0.12,
        wobbleFreq: 3.8,
        wobbleDamping: 0.5,
        settleTime: 1,
        trailStrands: 0,
        trailWidth: 0.04,
        trailLife: 0.15,
        cornerTrails: 2,
        edgeTrails: 6,
        edgeLineScale: 0.15,
        trailVariety: 0.1,
        edgeStraight: 0.85,
        cornerRear: 1,
        edgeLineAlpha: 0.09,
        cornerLineAlpha: 0.15,
        rearSoftness: 0.2,
        turnGain: 1,
        burstSize: 0,
        hitStop: 0,
        shake: 0,
        outline: 0.02,
        edge: 0,
        shade: 0.76,
        camDistance: 15.2,
        background: 0.4,
    },
};

/** Живые значения: сцена читает этот объект каждый кадр. */
export const tuning = { ...base };

export interface TuningKnob {
    key: TuningKey;
    label: string;
    min: number;
    max: number;
    step: number;
    /** Подпись единиц: «с», «×». */
    unit?: string;
    /** Ручка есть только у одного стиля: у другого она ничего не делает. */
    only?: StyleName[];
}

export const TUNING_GROUPS: { title: string; knobs: TuningKnob[] }[] = [
    { title: 'Общее', knobs: [{ key: 'speed', label: 'Скорость времени', min: 0.1, max: 2, step: 0.05, unit: '×' }] },
    {
        title: 'Бросок',
        knobs: [
            { key: 'flightTime', label: 'Время полёта', min: 0.4, max: 1.6, step: 0.01, unit: 'с' },
            { key: 'apex', label: 'Высота дуги', min: 0.5, max: 6, step: 0.05 },
            { key: 'spinTurns', label: 'Обороты', min: 0, max: 8, step: 1 },
            { key: 'spinSettle', label: 'Раннее успокоение', min: 1, max: 3.5, step: 0.05 },
            { key: 'aimTurn', label: 'Кувырок по одной оси', min: 0, max: 1, step: 1 },
            { key: 'spinStart', label: 'Кувырок начинается на', min: 0, max: 0.9, step: 0.01, unit: '×', only: ['spin'] },
            { key: 'spinRamp', label: 'Разгон кувырка', min: 0.02, max: 0.6, step: 0.01, unit: '×', only: ['spin'] },
            { key: 'curve', label: 'Дуга пути', min: 0, max: 0.8, step: 0.01, only: ['spin'] },
            { key: 'spinUp', label: 'Волчком вместо кувырка', min: 0, max: 1, step: 0.01 },
            { key: 'spinTurns2', label: 'Обороты по второй оси', min: 0, max: 6, step: 1, only: ['spin'] },
            { key: 'spinEnd', label: 'Вращение кончается на', min: 0.2, max: 1, step: 0.01, unit: '×', only: ['spin'] },
            { key: 'windupTime', label: 'Замах', min: 0, max: 0.6, step: 0.01, unit: 'с' },
            { key: 'windupSquash', label: 'Приседание', min: 0, max: 0.7, step: 0.01 },
        ],
    },
    {
        title: 'Спираль и удар сверху',
        knobs: [
            { key: 'slam', label: 'Доля падения', min: 0, max: 0.5, step: 0.01, only: ['sharp', 'spin'] },
            { key: 'pathRadius', label: 'Размах спирали', min: 0, max: 2.5, step: 0.05, only: ['sharp'] },
            { key: 'pathTurns', label: 'Витков спирали', min: 0.5, max: 5, step: 0.1, only: ['sharp'] },
            { key: 'bend', label: 'Изгиб кубика', min: 0, max: 2, step: 0.05, only: ['sharp'] },
        ],
    },
    {
        title: 'Отскоки',
        knobs: [
            { key: 'bounces', label: 'Сколько', min: 0, max: 3, step: 1 },
            { key: 'bounceHeight', label: 'Высота первого', min: 0.05, max: 0.5, step: 0.01, unit: '×' },
            { key: 'hopDistance', label: 'Перекат', min: 0.3, max: 2, step: 0.05 },
        ],
    },
    {
        title: 'Мультяшность',
        knobs: [
            { key: 'twist', label: 'Закрутка геометрии', min: 0, max: 0.05, step: 0.001, only: ['spin'] },
            { key: 'stretch', label: 'Вытягивание в полёте', min: 0, max: 1.4, step: 0.01 },
            { key: 'maxStretch', label: 'Предел вытягивания', min: 1, max: 2.4, step: 0.01, unit: '×' },
            { key: 'squashMin', label: 'Сжатие при ударе', min: 0.15, max: 0.95, step: 0.01, unit: '×' },
            { key: 'contactTime', label: 'Длина сжатия', min: 0.03, max: 0.3, step: 0.005, unit: 'с' },
            { key: 'wobbleFreq', label: 'Частота покачивания', min: 1, max: 8, step: 0.1, unit: 'Гц' },
            { key: 'wobbleDamping', label: 'Затухание покачивания', min: 0.05, max: 0.8, step: 0.01 },
            { key: 'settleTime', label: 'Время успокоения', min: 0.2, max: 1.6, step: 0.05, unit: 'с' },
        ],
    },
    {
        title: 'Линии и удар',
        knobs: [
            { key: 'trailStrands', label: 'Линий в шлейфе', min: 0, max: 3, step: 1, only: ['toon', 'sharp'] },
            { key: 'trailParallel', label: 'Штрихи вместо винта', min: 0, max: 1, step: 1, only: ['toon', 'sharp'] },
            { key: 'cornerTrails', label: 'Линий от задних углов', min: 0, max: 8, step: 1, only: ['spin'] },
            { key: 'edgeTrails', label: 'Линий от задних рёбер', min: 0, max: 12, step: 1, only: ['spin'] },
            { key: 'edgeLineScale', label: 'Толщина линий рёбер к углам', min: 0, max: 1.5, step: 0.05, unit: '×', only: ['spin'] },
            { key: 'trailVariety', label: 'Разнообразие линий', min: 0, max: 1, step: 0.01, only: ['spin'] },
            { key: 'trailDash', label: 'Пунктир линий', min: 0, max: 1, step: 0.01, only: ['spin'] },
            { key: 'cornerStraight', label: 'Прямота линий углов', min: 0, max: 1, step: 0.01, only: ['spin'] },
            { key: 'edgeStraight', label: 'Прямота линий рёбер', min: 0, max: 1, step: 0.01, only: ['spin'] },
            { key: 'cornerRear', label: 'Углы только задние', min: 0, max: 1, step: 1, only: ['spin'] },
            { key: 'cornerLineAlpha', label: 'Прозрачность линий углов', min: 0, max: 1, step: 0.01, only: ['spin'] },
            { key: 'edgeLineAlpha', label: 'Прозрачность линий рёбер', min: 0, max: 1, step: 0.01, only: ['spin'] },
            { key: 'rearSoftness', label: 'Мягкость задних точек', min: 0.02, max: 1, step: 0.01, only: ['spin'] },
            { key: 'turnGain', label: 'Усиление от поворота пути', min: 0, max: 3, step: 0.05, only: ['spin'] },
            { key: 'trailWidth', label: 'Толщина линий', min: 0, max: 0.2, step: 0.005 },
            { key: 'trailLife', label: 'Длина следа', min: 0.1, max: 1.2, step: 0.01, unit: 'с' },
            { key: 'swirlRadius', label: 'Размах линий', min: 0.1, max: 2.5, step: 0.05, only: ['toon', 'sharp'] },
            { key: 'swirlTurns', label: 'Витков винта', min: 0.5, max: 6, step: 0.1, only: ['toon'] },
            { key: 'burstSize', label: 'Звезда удара', min: 0, max: 4, step: 0.05 },
            { key: 'dust', label: 'Облачка', min: 0, max: 12, step: 1 },
            { key: 'shockwave', label: 'Кольцо удара', min: 0, max: 6, step: 0.1 },
            { key: 'hitStop', label: 'Замирание на ударе', min: 0, max: 0.2, step: 0.005, unit: 'с' },
            { key: 'shake', label: 'Тряска камеры', min: 0, max: 3, step: 0.05 },
            { key: 'shadowOpacity', label: 'Тень под кубиком', min: 0, max: 0.8, step: 0.01 },
        ],
    },
    {
        title: 'Вид',
        knobs: [
            { key: 'outline', label: 'Контур', min: 0, max: 0.15, step: 0.005 },
            { key: 'edge', label: 'Кайма граней', min: 0, max: 0.15, step: 0.005 },
            { key: 'pipSize', label: 'Размер точек', min: 0.04, max: 0.14, step: 0.005 },
            { key: 'shade', label: 'Тень на гранях', min: 0, max: 1, step: 0.01 },
            { key: 'camElevation', label: 'Наклон камеры', min: 15, max: 85, step: 1, unit: '°' },
            { key: 'camFov', label: 'Угол обзора', min: 12, max: 60, step: 1, unit: '°' },
            { key: 'camDistance', label: 'Дальность камеры', min: 5, max: 20, step: 0.1 },
            { key: 'background', label: 'Яркость фона', min: 0.2, max: 0.85, step: 0.01 },
        ],
    },
];
