import { MathUtils, Matrix4, Quaternion, Vector3 } from 'three';
import { easeInOutCubic, easeOutCubic, smoothstep } from '@1337exp/pkt-threejs-blueprint/ease';
import { tuning } from '../tuning';
import { faceNormal, orientationWithTop } from './faces';

const { clamp, lerp } = MathUtils;

const UP = new Vector3(0, 1, 0);
const AXES = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)];

/** Половина ребра: на столько центр кубика над полом, когда он лежит на грани. */
export const HALF = 0.5;
/** Скорость основного броска: к ней привязаны вытягивание и сила удара. */
export const V_REF = 16;
/** За сколько после взлёта сжатие «выстреливает» в вытягивание. */
const LAUNCH_BLEND = 0.06;
/** Шаг по времени полёта (доля 0…1) для численной скорости и кривизны траектории. */
const EPS = 0.015;
/** Больше этого угла (радиан) на длину кубика не гнём: иначе он сворачивается в кольцо. */
const MAX_BEND_ANGLE = 1.4;

/** Поза кубика в момент времени: где он, как повёрнут и как мультяшно деформирован. */
export interface DiePose {
    /** Центр кубика. */
    pos: Vector3;
    /** Настоящий поворот куба. */
    quat: Quaternion;
    /** Ось деформации, единичная. */
    axis: Vector3;
    /** Вытягивание вдоль axis: больше 1 — вытянут, меньше — сплющен. */
    stretch: number;
    airborne: boolean;
    /** Изгиб вдоль axis: кривизна (1 / радиус дуги), 0 — прямой. */
    bend: number;
    /** В какую сторону гнётся (перпендикулярно axis). */
    bendDir: Vector3;
    /** Угловая скорость кубика (рад/с, вектор вдоль оси вращения): от неё закрутка геометрии и линии за углами. */
    spin: Vector3;
}

export const createPose = (): DiePose => ({
    pos: new Vector3(0, HALF, 0),
    quat: new Quaternion(),
    axis: UP.clone(),
    stretch: 1,
    airborne: false,
    bend: 0,
    bendDir: new Vector3(0, 0, 1),
    spin: new Vector3(),
});

export function copyPose(from: DiePose, to: DiePose): void {
    to.pos.copy(from.pos);
    to.quat.copy(from.quat);
    to.axis.copy(from.axis);
    to.stretch = from.stretch;
    to.airborne = from.airborne;
    to.bend = from.bend;
    to.bendDir.copy(from.bendDir);
    to.spin.copy(from.spin);
}

/** Где кубик лежит: центр и поворот на грани. */
export interface DieRest {
    pos: Vector3;
    quat: Quaternion;
}

/** Удар об пол: когда, куда и насколько сильный (1 — основной бросок). */
export interface Impact {
    time: number;
    at: Vector3;
    intensity: number;
    final: boolean;
}

export interface ThrowPlan {
    value: number;
    duration: number;
    /** Когда кубик перестаёт быть «в игре» и можно бросать снова: начало покачивания. */
    settleStart: number;
    impacts: Impact[];
    /** Где кубик окажется в конце. */
    final: DieRest;
    sample(t: number, out: DiePose): DiePose;
}

interface Phase {
    t0: number;
    t1: number;
    fn(k: number, pose: DiePose): void;
}

const tmpMatrix = new Matrix4();

/** Половина высоты куба над его центром при данном повороте: на столько центр должен быть над полом. */
function supportY(q: Quaternion): number {
    const e = tmpMatrix.makeRotationFromQuaternion(q).elements;
    return HALF * (Math.abs(e[1]!) + Math.abs(e[5]!) + Math.abs(e[9]!));
}

/** Высота центра, при которой деформированный кубик ровно касается пола. */
function floorY(pose: DiePose): number {
    const f = pose.stretch;
    const across = 1 / Math.sqrt(f);
    const ay = pose.axis.y;
    return supportY(pose.quat) * (across + (f - across) * ay * ay);
}

/** Горизонтальные направления вдоль рёбер куба: по ним он перекатывается и остаётся на грани. */
function horizontalDirs(q: Quaternion): Vector3[] {
    const dirs: Vector3[] = [];
    for (const axis of AXES) {
        const v = axis.clone().applyQuaternion(q);
        if (Math.abs(v.y) < 0.5) dirs.push(v.clone().setY(0).normalize(), v.clone().setY(0).normalize().negate());
    }
    return dirs;
}

const randomHorizontal = (): Vector3 => {
    const a = Math.random() * Math.PI * 2;
    return new Vector3(Math.cos(a), 0, Math.sin(a));
};

/** Где кубик в момент u (0…1) полёта. Скорость и кривизна берутся из неё численно, так что формула любая. */
type PosAt = (u: number, out: Vector3) => void;

interface Flight {
    dur: number;
    posAt: PosAt;
    /** Вытягивание в конце предыдущей фазы: от него плавно переходим к вытягиванию от скорости. */
    fStart: number;
    quatAt(u: number, out: Quaternion): void;
}

/** Обычная дуга: прямая от точки к точке и парабола вверх. */
function parabola(from: Vector3, to: Vector3, apex: number): PosAt {
    return (u, out) => {
        out.lerpVectors(from, to, u);
        out.y += 4 * apex * u * (1 - u);
    };
}

/**
 * Резкая траектория: быстрый взлёт, спираль вокруг линии полёта, которая сжимается к точке над целью,
 * и последняя часть полёта (slam) — прямое падение с ускорением, без спирали.
 */
function slamPath(from: Vector3, to: Vector3, apex: number): PosAt {
    const { pathRadius, pathTurns } = tuning;
    const slam = clamp(tuning.slam, 0.05, 0.6);
    const drop = 1 - slam;
    const phase = Math.random() * Math.PI * 2;
    return (u, out) => {
        const k = Math.min(u / drop, 1);
        const h = easeInOutCubic(k);
        out.set(lerp(from.x, to.x, h), lerp(from.y, to.y, u), lerp(from.z, to.z, h));
        // Радиус спирали растёт с нуля и снова сходит на нет к началу падения.
        const radius = pathRadius * Math.sin(Math.PI * k);
        const angle = phase + pathTurns * Math.PI * 2 * k;
        out.x += Math.cos(angle) * radius;
        out.z += Math.sin(angle) * radius;
        // Высота: быстрый взлёт к вершине, чуть оседает, потом падает по степенной кривой — всё быстрее.
        let profile: number;
        if (u < drop) {
            const rise = Math.min(1, u / (0.45 * drop));
            const sag = Math.max(0, (u - 0.45 * drop) / (0.55 * drop));
            profile = Math.sin((rise * Math.PI) / 2) * (1 - 0.12 * sag * sag);
        } else {
            profile = 0.88 * (1 - ((u - drop) / slam) ** 2.2);
        }
        out.y += apex * profile;
    };
}

/** Скорость в момент удара: по ней сила удара и глубина сжатия. */
function landingSpeed(f: Flight): number {
    const a = new Vector3();
    const b = new Vector3();
    f.posAt(1 - EPS, a);
    f.posAt(1, b);
    return a.distanceTo(b) / (EPS * f.dur);
}

/** Полёт: позиция из posAt, поворот из quatAt, деформация — от скорости и поворота траектории. */
function flightPhase(t0: number, f: Flight): Phase {
    const a = new Vector3();
    const b = new Vector3();
    const c = new Vector3();
    const vel = new Vector3();
    const turn = new Vector3();
    const qLo = new Quaternion();
    const qHi = new Quaternion();
    return {
        t0,
        t1: t0 + f.dur,
        fn(u, pose) {
            f.posAt(u, pose.pos);
            f.quatAt(u, pose.quat);

            const lo = Math.max(0, u - EPS);
            const hi = Math.min(1, u + EPS);

            // Угловая скорость: на сколько и вокруг чего повернулся кубик за шаг по времени.
            f.quatAt(lo, qLo);
            f.quatAt(hi, qHi);
            qHi.multiply(qLo.invert());
            if (qHi.w < 0) qHi.set(-qHi.x, -qHi.y, -qHi.z, -qHi.w);
            const sinHalf = Math.hypot(qHi.x, qHi.y, qHi.z);
            if (sinHalf > 1e-6) pose.spin.set(qHi.x, qHi.y, qHi.z).multiplyScalar((2 * Math.atan2(sinHalf, qHi.w)) / (sinHalf * (hi - lo) * f.dur));
            else pose.spin.set(0, 0, 0);

            f.posAt(lo, a);
            f.posAt(hi, c);
            vel.subVectors(c, a).divideScalar((hi - lo) * f.dur);
            const speed = vel.length();
            const flying = clamp(1 + (tuning.stretch * speed) / V_REF, 1, tuning.maxStretch);
            pose.stretch = lerp(f.fStart, flying, smoothstep(0, 1, (u * f.dur) / LAUNCH_BLEND));
            if (speed > 1e-4) pose.axis.copy(vel).divideScalar(speed);
            else pose.axis.copy(UP);

            // Изгиб: как быстро поворачивается направление полёта на единицу пути.
            pose.bend = 0;
            if (tuning.bend > 0) {
                const mid = clamp(u, EPS, 1 - EPS);
                f.posAt(mid - EPS, a);
                f.posAt(mid, b);
                f.posAt(mid + EPS, c);
                const ds = (a.distanceTo(b) + b.distanceTo(c)) / 2;
                turn.subVectors(c.sub(b).normalize(), b.sub(a).normalize());
                const angle = turn.length();
                if (angle > 1e-5 && ds > 1e-5) {
                    pose.bendDir.copy(turn).divideScalar(angle);
                    pose.bend = Math.min(angle / ds, MAX_BEND_ANGLE / pose.stretch) * tuning.bend;
                }
            }

            pose.pos.y = Math.max(pose.pos.y, floorY(pose));
            pose.airborne = true;
        },
    };
}

/** Кубик стоит на полу и сжимается, потом (если дальше отскок) отпускает пружину. */
function contactPhase(t0: number, dur: number, at: Vector3, quat: Quaternion, fIn: number, axisIn: Vector3, fMin: number): Phase {
    return {
        t0,
        t1: t0 + dur,
        fn(k, pose) {
            pose.quat.copy(quat);
            pose.stretch = lerp(fIn, fMin, easeOutCubic(k));
            // Ось плавно поворачивается от направления падения к вертикали.
            pose.axis.lerpVectors(axisIn, UP, smoothstep(0, 0.35, k)).normalize();
            pose.bend = 0;
            pose.spin.set(0, 0, 0);
            pose.pos.set(at.x, 0, at.z);
            pose.pos.y = floorY(pose);
            pose.airborne = false;
        },
    };
}

/** Курс — угол вокруг вертикали, на который надо повернуть ось +X, чтобы она смотрела в (x, z). */
const yawOf = (x: number, z: number) => Math.atan2(-z, x);
const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** В системе пути «вперёд» — это +X, а ось кувырка перпендикулярна ему: положительный поворот катит кубик вперёд. */
const ROLL_AXIS = new Vector3(0, 0, -1);

/** Горизонтальный путь броска: прямая от старта к цели, выгнутая дугой. */
interface GroundPath {
    /** Точка пути на доле g (0…1): пишет только x и z. */
    at(g: number, out: Vector3): void;
    /** Курс касательной на доле g; непрерывный, считается от курса в начале пути. */
    heading(g: number): number;
}

/**
 * Дуга длиной tuning.curve от длины пути, в случайную сторону. На почти вертикальном прыжке (цель рядом) дуге
 * не из чего получиться, курс там гулял бы, поэтому путь прямой, а курс по base.
 */
function groundPath(from: Vector3, to: Vector3, base: Vector3): GroundPath {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const dist = Math.hypot(dx, dz);
    const straight = dist < 0.3;
    const side = new Vector3().crossVectors(UP, straight ? base : new Vector3(dx / dist, 0, dz / dist));
    const bow = straight ? 0 : tuning.curve * dist * (Math.random() < 0.5 ? 1 : -1);
    const tangent = (g: number) => {
        const k = bow * Math.PI * Math.cos(Math.PI * g);
        return { x: dx + side.x * k, z: dz + side.z * k };
    };
    const first = straight ? yawOf(base.x, base.z) : yawOf(tangent(0).x, tangent(0).z);
    return {
        at(g, out) {
            const k = bow * Math.sin(Math.PI * g);
            out.x = from.x + dx * g + side.x * k;
            out.z = from.z + dz * g + side.z * k;
        },
        heading(g) {
            if (straight) return first;
            const t = tangent(g);
            return first + wrapPi(yawOf(t.x, t.z) - first);
        },
    };
}

/**
 * Как набирается кувырок за полёт: доля проделанного поворота (0…1) от доли времени k. Скорость плавно нарастает
 * за первую ramp долю (кубик не получает вращение рывком) и сходит на нет к концу (settle — как рано). Считается
 * таблицей: скорость интегрируется и нормируется, так что в конце поворот ровно 1.
 */
function spinProgress(settle: number, ramp: number): (k: number) => number {
    const steps = 96;
    const table = [0];
    for (let i = 1; i <= steps; i++) {
        const k = i / steps;
        table.push(table[i - 1]! + smoothstep(0, ramp, k) * Math.max(0, 1 - k) ** Math.max(0, settle - 1));
    }
    const total = table[steps]!;
    return (k) => {
        const x = clamp(k, 0, 1) * steps;
        const i = Math.min(steps - 1, Math.floor(x));
        return lerp(table[i]!, table[i + 1]!, x - i) / total;
    };
}

/** Бросок «по одной оси»: как выровняться и как кувыркнуться, чтобы нужная грань оказалась сверху. */
interface AimedSpin {
    /** Поворот вокруг вертикали, которым ребро кубика встаёт по курсу в начале пути. */
    delta: number;
    /** Угол кувырка вокруг ROLL_AXIS: целые обороты плюс четверти до нужной грани. */
    turn: number;
    /** Кубик в системе пути (курс 0), выровненный ребром, до кувырка. */
    local: Quaternion;
    /** Поворот кубика при приземлении: нужное число сверху, рёбра вдоль курса в конце пути. */
    landing: Quaternion;
}

/**
 * Кубик кувыркается вокруг СВОЕГО ребра, а само это ребро поворачивается вместе с курсом пути.
 * Поэтому ось всегда одна. Доворот курса к направлению броска привязан к прогрессу кувырка (см. quatAt в planThrow):
 * пока кубик не крутится, курс не двигается, а когда крутится быстро, поправка теряется в его вращении. Выбирается, каким ребром кубик встанет по курсу и вокруг какого другого он кувыркнётся:
 * нужная грань не должна лежать на оси кувырка (иначе её наверх не вывести), из допустимых — ближайший по углу.
 * К целым оборотам дописываются четверти оборота, на которых нужная грань встаёт вверх.
 */
function planAimed(q: Quaternion, psi0: number, psi1: number, value: number, turns: number): AimedSpin {
    const wanted = faceNormal(value);
    const dir = new Vector3(Math.cos(psi0), 0, -Math.sin(psi0));
    const world = AXES.map((a) => a.clone().applyQuaternion(q));
    const horizontal = [0, 1, 2].filter((i) => Math.abs(world[i]!.y) < 0.5);
    let best = { delta: Infinity };
    for (const i of horizontal) {
        const tumble = horizontal.find((n) => n !== i)!;
        if (Math.abs(AXES[tumble]!.dot(wanted)) > 0.5) continue;
        for (const sign of [1, -1]) {
            const edge = world[i]!.clone().setY(0).normalize().multiplyScalar(sign);
            const delta = Math.atan2(UP.dot(new Vector3().crossVectors(edge, dir)), edge.dot(dir));
            if (Math.abs(delta) < Math.abs(best.delta)) best = { delta };
        }
    }
    const local = new Quaternion().setFromAxisAngle(UP, best.delta - psi0).multiply(q);
    let quarter = 0;
    for (let k = 0; k < 4; k++) {
        const up = wanted.clone().applyQuaternion(new Quaternion().setFromAxisAngle(ROLL_AXIS, (k * Math.PI) / 2).multiply(local));
        if (up.y > 0.9) quarter = k;
    }
    const landing = new Quaternion()
        .setFromAxisAngle(UP, psi1)
        .multiply(new Quaternion().setFromAxisAngle(ROLL_AXIS, (quarter * Math.PI) / 2))
        .multiply(local);
    return { delta: best.delta, turn: turns * Math.PI * 2 + (quarter * Math.PI) / 2, local, landing };
}

/**
 * Сценарий броска. Это не физика, а раскадровка: заранее известно, где кубик приземлится
 * и какой гранью, поэтому его можно вывести ровно в нужный результат. Строится от конца к началу:
 * известна финальная поза (нужное число сверху), от неё назад — перекаты отскоков, а в самом начале
 * вращение подгоняется под приземление.
 *
 * Фазы по порядку: замах (присел) → полёт с вращением → [удар → отскок]… → удар → покачивание.
 * Полёт — обычная дуга или (tuning.slam > 0) спираль с ударом сверху.
 * pose.stretch/axis/bend — мультяшная деформация, которую потом применяет DieView.
 */
export function planThrow(rest: DieRest, target: Vector3, value: number): ThrowPlan {
    // Куда бежать: направление броска. Отскоки продолжают его, но катятся только вдоль рёбер куба.
    const toTarget = new Vector3(target.x - rest.pos.x, 0, target.z - rest.pos.z);
    const base = toTarget.lengthSq() > 0.01 ? toTarget.normalize() : randomHorizontal();

    // aimTurn — режим «по одной оси»: кубик выравнивается и кувыркается ровно, без отскоков (отскоки ломают расчёт).
    const ground = tuning.aimTurn > 0.5 ? groundPath(rest.pos, target, base) : null;
    const aimed = ground ? planAimed(rest.quat, ground.heading(0), ground.heading(1), value, Math.round(tuning.spinTurns)) : null;
    const hops = aimed ? 0 : Math.round(clamp(tuning.bounces, 0, 3));

    // Поворот вокруг вертикали при приземлении: на четверть оборота (чтобы боковые грани каждый раз были разные) и чуть вкось.
    const yaw = Math.floor(Math.random() * 4) * (Math.PI / 2) + (Math.random() - 0.5) * 0.9;
    const qFinal = aimed ? aimed.landing : new Quaternion().setFromAxisAngle(UP, yaw).multiply(orientationWithTop(value));
    const dirs = horizontalDirs(qFinal);

    // Приземления L0…Ln считаем с конца: Ln — финал, каждый предыдущий — на перекат назад.
    const landAt: Vector3[] = [];
    const landQ: Quaternion[] = [];
    const rollAxis: Vector3[] = [];
    landAt[hops] = new Vector3(target.x, 0, target.z);
    landQ[hops] = qFinal.clone();
    for (let k = hops; k >= 1; k--) {
        const want = base.clone().applyAxisAngle(UP, (Math.random() - 0.5) * 0.9);
        const dir = dirs.reduce((best, d) => (d.dot(want) > best.dot(want) ? d : best), dirs[0]!);
        const length = tuning.hopDistance * 0.55 ** (k - 1);
        landAt[k - 1] = landAt[k]!.clone().addScaledVector(dir, -length);
        const axis = new Vector3().crossVectors(UP, dir);
        rollAxis[k] = axis;
        landQ[k - 1] = new Quaternion().setFromAxisAngle(axis, -Math.PI / 2).multiply(landQ[k]!);
    }

    const phases: Phase[] = [];
    const impacts: Impact[] = [];
    let t = 0;
    let fPrev = 1;

    // Замах: кубик приседает перед броском.
    if (tuning.windupTime > 0 && tuning.windupSquash > 0) {
        const fWind = 1 - tuning.windupSquash;
        phases.push({
            t0: 0,
            t1: tuning.windupTime,
            fn(k, pose) {
                pose.quat.copy(rest.quat);
                pose.axis.copy(UP);
                pose.stretch = lerp(1, fWind, easeInOutCubic(k));
                pose.bend = 0;
                pose.spin.set(0, 0, 0);
                pose.pos.set(rest.pos.x, 0, rest.pos.z);
                pose.pos.y = floorY(pose);
                pose.airborne = false;
            },
        });
        t = tuning.windupTime;
        fPrev = fWind;
    }

    // Основной бросок.
    const start = new Vector3(rest.pos.x, HALF, rest.pos.z);
    const first = new Vector3(landAt[0]!.x, HALF, landAt[0]!.z);
    const settle = tuning.spinSettle;
    const qa = new Quaternion();
    const qb = new Quaternion();
    let quatAt: Flight['quatAt'];
    let groundAt: PosAt | undefined;

    if (aimed && ground) {
        // Путь идёт дугой с плавным стартом: сначала кубик почти только поднимается. Кувырок вокруг своего ребра
        // начинается на spinStart (по умолчанию сразу) и плавно разгоняется. Курс кубика следует за касательной к пути,
        // а начальный перекос ребра гасится строго по мере кувырка: без вращения курс не двигается, а в быстром
        // вращении поправка не видна. К приземлению кувырок и поправка заканчиваются вместе.
        const spinStart = clamp(tuning.spinStart, 0, 0.9);
        const progress = spinProgress(settle, clamp(tuning.spinRamp, 0.02, 0.6));
        const glide = (u: number) => smoothstep(0, 1, u);
        groundAt = (u, out) => {
            ground.at(glide(u), out);
            out.y = HALF + 4 * tuning.apex * u * (1 - u);
        };
        quatAt = (u, out) => {
            const done = progress((u - spinStart) / (1 - spinStart));
            qa.setFromAxisAngle(UP, ground.heading(glide(u)) - aimed.delta * (1 - done));
            qb.setFromAxisAngle(ROLL_AXIS, aimed.turn * done);
            out.copy(qa).multiply(qb).multiply(aimed.local);
        };
    } else {
        // Вращение вокруг оси + доворот к нужному приземлению.
        const delta = landQ[0]!.clone().multiply(rest.quat.clone().invert());
        if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w);
        const trim = new Vector3(delta.x, delta.y, delta.z);
        const trimAngle = trim.lengthSq() > 1e-10 ? 2 * Math.acos(clamp(delta.w, -1, 1)) : 0;
        if (trimAngle > 0) trim.normalize();
        else trim.copy(UP);

        const heading = new Vector3(first.x - start.x, 0, first.z - start.z);
        const tumble = new Vector3().crossVectors(UP, heading.lengthSq() > 0.01 ? heading.normalize() : base);
        tumble.add(randomHorizontal().multiplyScalar(0.25)).y += (Math.random() - 0.5) * 0.4;
        tumble.normalize().lerp(UP, clamp(tuning.spinUp, 0, 1)).normalize();
        const spin = Math.round(tuning.spinTurns) * Math.PI * 2 * (Math.random() < 0.2 ? -1 : 1);
        // Вторая ось — другая горизонтальная: два вращения вместе дают «вертушку».
        const tumble2 = new Vector3().crossVectors(UP, tumble).normalize();
        const spin2 = Math.round(tuning.spinTurns2) * Math.PI * 2 * (Math.random() < 0.5 ? -1 : 1);
        const spinEnd = clamp(tuning.spinEnd, 0.1, 1);
        const qc = new Quaternion();
        quatAt = (u, out) => {
            // Вращение заканчивается на spinEnd-й доле полёта; дальше кубик уже лёг как надо и только падает.
            const k = Math.min(1, u / spinEnd);
            const eased = 1 - (1 - k) ** settle;
            qa.setFromAxisAngle(trim, trimAngle * easeInOutCubic(k));
            qb.setFromAxisAngle(tumble, spin * eased);
            qc.setFromAxisAngle(tumble2, spin2 * eased);
            out.copy(qa).multiply(qb).multiply(qc).multiply(rest.quat);
        };
    }

    const main: Flight = {
        dur: tuning.flightTime,
        posAt: tuning.slam > 0 ? slamPath(start, first, tuning.apex) : (groundAt ?? parabola(start, first, tuning.apex)),
        fStart: fPrev,
        quatAt,
    };
    phases.push(flightPhase(t, main));
    t += main.dur;
    let speed = landingSpeed(main);
    const mainSpeed = speed;
    let flightPhaseRef = phases[phases.length - 1]!;

    const pose = createPose();
    let fMin = 1;
    for (let k = 0; k <= hops; k++) {
        // Удар: насколько сильный — по скорости относительно основного броска.
        const intensity = clamp(speed / mainSpeed, 0.15, 1);
        flightPhaseRef.fn(1, pose);
        const fIn = pose.stretch;
        const axisIn = pose.axis.clone();
        fMin = 1 - (1 - tuning.squashMin) * intensity ** 0.8;
        const dur = tuning.contactTime * (0.6 + 0.4 * intensity);
        const at = landAt[k]!;
        impacts.push({ time: t, at: at.clone(), intensity, final: k === hops });
        phases.push(contactPhase(t, dur, at, landQ[k]!, fIn, axisIn, fMin));
        t += dur;
        if (k === hops) break;

        // Отскок: низкая дуга и перекат на 90° вдоль ребра.
        const ratio = tuning.bounceHeight * 0.4 ** k;
        const roll = rollAxis[k + 1]!;
        const qFrom = landQ[k]!;
        const hop: Flight = {
            dur: Math.max(0.14, tuning.flightTime * Math.sqrt(ratio)),
            posAt: parabola(new Vector3(at.x, HALF, at.z), new Vector3(landAt[k + 1]!.x, HALF, landAt[k + 1]!.z), tuning.apex * ratio),
            fStart: fMin,
            quatAt: (u, out) => out.copy(qa.setFromAxisAngle(roll, (Math.PI / 2) * easeInOutCubic(u))).multiply(qFrom),
        };
        flightPhaseRef = flightPhase(t, hop);
        phases.push(flightPhaseRef);
        t += hop.dur;
        speed = landingSpeed(hop);
    }

    // Покачивание после последнего удара: затухающая пружина, начинает со сплющенного.
    const settleStart = t;
    const x0 = fMin - 1;
    const zeta = tuning.wobbleDamping;
    const omega = Math.PI * 2 * tuning.wobbleFreq;
    const omegaD = omega * Math.sqrt(1 - zeta * zeta);
    const settleAt = landAt[hops]!;
    phases.push({
        t0: t,
        t1: t + tuning.settleTime,
        fn(k, p) {
            const tau = k * tuning.settleTime;
            p.quat.copy(qFinal);
            p.axis.copy(UP);
            p.stretch = 1 + x0 * Math.exp(-zeta * omega * tau) * (Math.cos(omegaD * tau) + ((zeta * omega) / omegaD) * Math.sin(omegaD * tau));
            p.bend = 0;
            p.spin.set(0, 0, 0);
            p.pos.set(settleAt.x, 0, settleAt.z);
            p.pos.y = floorY(p);
            p.airborne = false;
        },
    });
    const duration = t + tuning.settleTime;

    const final: DieRest = { pos: new Vector3(settleAt.x, HALF, settleAt.z), quat: qFinal.clone() };
    return {
        value,
        duration,
        settleStart,
        impacts,
        final,
        sample(time, out) {
            if (time >= duration) {
                out.pos.copy(final.pos);
                out.quat.copy(final.quat);
                out.axis.copy(UP);
                out.stretch = 1;
                out.bend = 0;
                out.spin.set(0, 0, 0);
                out.airborne = false;
                return out;
            }
            for (const phase of phases) {
                if (time < phase.t1) {
                    phase.fn(clamp((time - phase.t0) / (phase.t1 - phase.t0), 0, 1), out);
                    return out;
                }
            }
            return out;
        },
    };
}
