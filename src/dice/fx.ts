import {
    Group,
    Mesh,
    MeshBasicMaterial,
    type Object3D,
    PerspectiveCamera,
    PlaneGeometry,
    Scene,
    Sprite,
    SpriteMaterial,
    Vector3,
    type Texture,
} from 'three';
import { clamp, easeOutBack, easeOutCubic, lerp, linear, smoothstep } from '../anim/ease';
import type { Ticker } from '../anim/ticker';
import { tuning } from '../tuning';
import { MAX_SAMPLES, Ribbon } from './ribbon';
import { V_REF } from './throwPlan';
import { createBurstTexture, createPuffTexture, createRingTexture } from './textures';

const UP = new Vector3(0, 1, 0);
const AXIS_X = new Vector3(1, 0, 0);

/** Овальная тень на полу: без стола она одна говорит глазу, где пол и как высоко кубик. */
export class FloorShadow {
    readonly mesh: Mesh<PlaneGeometry, MeshBasicMaterial>;

    constructor(map: Texture) {
        this.mesh = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ map, transparent: true, depthWrite: false }));
        this.mesh.rotation.x = -Math.PI / 2;
        this.mesh.renderOrder = -1;
    }

    /** height — над полом; spread — как шире кубик у земли (при сплющивании тень растекается). */
    update(pos: Vector3, height: number, spread: number): void {
        // Чем выше кубик, тем тень меньше и бледнее: так прыжок читается лучше, чем с растущей тенью.
        const size = 1.7 * spread * (1 - Math.min(0.4, height * 0.1));
        this.mesh.scale.set(size, size, 1);
        this.mesh.position.set(pos.x, 0.004, pos.z);
        this.mesh.material.opacity = tuning.shadowOpacity / (1 + height * 0.8);
    }

    dispose(): void {
        this.mesh.geometry.dispose();
        this.mesh.material.dispose();
    }
}

interface Sample {
    pos: Vector3;
    dir: Vector3;
    power: number;
    age: number;
}

const MAX_STRANDS = 3;

/**
 * Завихрения за кубиком: несколько лент, закрученных винтом вокруг траектории. Каждый кадр кубик
 * оставляет точку следа; ленты строятся по этим точкам, сужаются к хвосту и гаснут со временем.
 */
export class SwirlTrail {
    readonly object = new Group();
    private readonly samples: Sample[] = [];
    private readonly ribbons = Array.from({ length: MAX_STRANDS }, () => new Ribbon());
    private readonly points: Vector3[] = Array.from({ length: MAX_SAMPLES }, () => new Vector3());
    private readonly toCamera = new Vector3();
    private readonly b1 = new Vector3();
    private readonly b2 = new Vector3();

    constructor() {
        for (const ribbon of this.ribbons) this.object.add(ribbon.mesh);
    }

    /** След за кубиком: вызывать каждый кадр, пока он летит. */
    push(pos: Vector3, vel: Vector3): void {
        const speed = vel.length();
        if (speed < 1e-4) return;
        this.samples.unshift({
            pos: pos.clone(),
            dir: vel.clone().divideScalar(speed),
            power: smoothstep(0.2, 0.85, speed / V_REF),
            age: 0,
        });
        if (this.samples.length > MAX_SAMPLES) this.samples.pop();
    }

    update(dt: number, camera: PerspectiveCamera): void {
        const life = Math.max(0.05, tuning.trailLife);
        for (const s of this.samples) s.age += dt;
        while (this.samples.length && this.samples[this.samples.length - 1]!.age > life) this.samples.pop();

        const strands = Math.round(clamp(tuning.trailStrands, 0, MAX_STRANDS));
        for (let s = 0; s < MAX_STRANDS; s++) {
            if (s >= strands) this.ribbons[s]!.hide();
            else this.buildStrand(this.ribbons[s]!, s, strands, life, camera);
        }
    }

    private buildStrand(ribbon: Ribbon, index: number, strands: number, life: number, camera: PerspectiveCamera): void {
        const count = this.samples.length;
        const phase = (index / strands) * Math.PI * 2;
        for (let i = 0; i < count; i++) {
            const s = this.samples[i]!;
            const age = s.age / life;
            if (tuning.trailParallel > 0.5) {
                // Параллельные штрихи: расходятся веером в стороны от линии полёта, как скоростные линии в комиксе.
                this.toCamera.subVectors(camera.position, s.pos);
                this.b1.crossVectors(s.dir, this.toCamera).normalize();
                const spread = strands > 1 ? (index / (strands - 1)) * 2 - 1 : 0;
                this.points[i]!.copy(s.pos).addScaledVector(this.b1, spread * tuning.swirlRadius * lerp(0.25, 1, age ** 0.7));
                continue;
            }
            // Винт: базис, перпендикулярный направлению полёта в этой точке, по нему ходит лента.
            this.b1.crossVectors(s.dir, Math.abs(s.dir.y) < 0.9 ? UP : AXIS_X).normalize();
            this.b2.crossVectors(s.dir, this.b1);
            const angle = phase + tuning.swirlTurns * Math.PI * 2 * age;
            const radius = lerp(0.6, tuning.swirlRadius, age ** 0.7) * (0.5 + 0.5 * s.power);
            this.points[i]!
                .copy(s.pos)
                .addScaledVector(this.b1, Math.cos(angle) * radius)
                .addScaledVector(this.b2, Math.sin(angle) * radius);
        }
        ribbon.build(
            this.points,
            count,
            (i) => {
                const s = this.samples[i]!;
                const age = s.age / life;
                return tuning.trailWidth * s.power * (1 - age) * smoothstep(0, 0.12, age);
            },
            (i) => {
                const s = this.samples[i]!;
                const age = s.age / life;
                return Math.min(1, s.power * 1.6) * (1 - age) ** 0.8 * smoothstep(0, 0.08, age);
            },
            camera,
        );
    }

    dispose(): void {
        for (const ribbon of this.ribbons) ribbon.dispose();
    }
}

const CORNERS = 8;
const EDGES = 12;
/**
 * Какие углы пускают линии, если выбор не по заднему положению: парами соседних углов (по ребру). Противоположные углы
 * всегда по разные стороны кубика: пока один сзади, второй спереди, и его линия вылетает из нижней части кубика.
 */
const CORNER_ORDER = [0, 1, 6, 7, 2, 3, 4, 5];

interface AnchorSample {
    points: Vector3[];
    /** Сила линии каждой опорной точки в этот кадр: 1 — точка среди самых задних, 0 — спереди. */
    weights: number[];
    /** Усиление от поворота пути: больше 1 на внешней стороне поворота, меньше на внутренней. */
    gains: number[];
    power: number;
    age: number;
}

/**
 * Линии за вращающимся кубиком. Кубик на лету слегка наклонён вперёд, и сзади у него есть углы и рёбра:
 * именно они пускают линии, а те, что ушли вперёд, перестают. Какие точки «задние», выбирается каждый кадр по
 * направлению полёта; линия точки включается и гаснет мягко, поэтому дуга начинается там, где точка ушла назад.
 * Чем быстрее вращение, тем темнее и толще линии; когда кубик перестаёт крутиться, они гаснут.
 */
export class SpinTrail {
    readonly object = new Group();
    private readonly samples: AnchorSample[] = [];
    private readonly ribbons = Array.from({ length: CORNERS + EDGES }, () => new Ribbon());
    private readonly line: Vector3[] = new Array(MAX_SAMPLES);
    private readonly offset = new Vector3();
    private readonly traits = Array.from({ length: CORNERS + EDGES }, () => ({ life: 1, width: 1, delay: 0, dash: 0, freq: 3, phase: 0 }));

    constructor() {
        for (const ribbon of this.ribbons) this.object.add(ribbon.mesh);
        this.reseed();
    }

    /**
     * Каждой линии — свой характер на этот бросок: длина, толщина, на сколько позже она начинается и пунктир с
     * собственным шагом. Без этого линии получаются одинаковыми, и за кубиком летит гребёнка.
     * Сила разброса — tuning.trailVariety (0 — все одинаковые).
     */
    reseed(): void {
        const v = clamp(tuning.trailVariety, 0, 1);
        const rand = (min: number, max: number) => lerp(min, max, Math.random());
        for (const t of this.traits) {
            t.life = lerp(1, rand(0.4, 1.15), v);
            t.width = lerp(1, rand(0.45, 1.5), v);
            t.delay = v * rand(0, 0.2);
            t.dash = rand(0.3, 0.95);
            t.freq = rand(1.5, 5.5);
            t.phase = Math.random();
        }
    }

    /**
     * points — опорные точки кубика в мире (углы, потом середины рёбер); center — его центр; travel — направление полёта;
     * target — куда он летит (точка приземления): угол между полётом и направлением на неё усиливает линии.
     */
    push(points: Vector3[], spin: number, center: Vector3, travel: Vector3, target: Vector3): void {
        const rear = points.map((p) => -this.offset.subVectors(p, center).normalize().dot(travel));
        const weights = new Array<number>(points.length).fill(0);
        if (tuning.cornerRear > 0.5) this.pickRear(rear, 0, CORNERS, tuning.cornerTrails, weights);
        // Иначе углы фиксированные и линия каждого сплошная: настоящая дуга, которую рисует вращающийся угол.
        else for (const c of CORNER_ORDER.slice(0, Math.round(clamp(tuning.cornerTrails, 0, CORNERS)))) weights[c] = 1;
        this.pickRear(rear, CORNERS, EDGES, tuning.edgeTrails, weights);
        const gains = this.turnGains(points, center, travel, target);
        // Прямота линий (у углов и рёбер своя): реальный путь вращающейся точки — дуга-крючок (циклоида). Смешиваем его с «параллельным штрихом»:
        // центр плюс только поперечное смещение точки. Он плавно меняется при вращении и даёт сплошные линии вдоль полёта.
        const shaped = points.map((p, a) => {
            const straight = clamp(a < CORNERS ? tuning.cornerStraight : tuning.edgeStraight, 0, 1);
            if (straight === 0) return p.clone();
            const o = this.offset.subVectors(p, center);
            const streak = center.clone().add(o.addScaledVector(travel, -o.dot(travel)));
            return p.clone().lerp(streak, straight);
        });
        this.samples.unshift({ points: shaped, weights, gains, power: smoothstep(6, 26, spin), age: 0 });
        if (this.samples.length > MAX_SAMPLES) this.samples.pop();
    }

    /**
     * Усиление линий от поворота пути. Угол между направлением полёта и направлением на цель — насколько круто
     * путь сейчас поворачивает; точки на внешней стороне поворота (противоположной той, куда он гнётся) получают
     * усиление, на внутренней — ослабление. Прямой путь (угол 0) ничего не меняет.
     */
    private turnGains(points: Vector3[], center: Vector3, travel: Vector3, target: Vector3): number[] {
        const gains = new Array<number>(points.length).fill(1);
        if (tuning.turnGain <= 0) return gains;
        const toTarget = new Vector3().subVectors(target, center);
        if (toTarget.lengthSq() < 1e-6) return gains;
        toTarget.normalize();
        const angle = Math.acos(clamp(travel.dot(toTarget), -1, 1));
        // Куда гнётся путь: составляющая направления на цель поперёк полёта.
        const bend = toTarget.addScaledVector(travel, -travel.dot(toTarget));
        if (bend.lengthSq() < 1e-8) return gains;
        bend.normalize();
        const strength = smoothstep(0.05, 0.9, angle) * tuning.turnGain;
        for (let a = 0; a < points.length; a++) {
            const outer = -this.offset.subVectors(points[a]!, center).normalize().dot(bend);
            gains[a] = Math.max(0, 1 + strength * outer);
        }
        return gains;
    }

    /** Из группы точек [from, from + size) берёт count самых задних: вес 1 у них и плавно к 0 у тех, что чуть дальше. */
    private pickRear(rear: number[], from: number, size: number, count: number, weights: number[]): void {
        const n = Math.round(clamp(count, 0, size));
        if (n === 0) return;
        const sorted = Array.from({ length: size }, (_, i) => from + i).sort((a, b) => rear[b]! - rear[a]!);
        // Граница между последней взятой точкой и первой не взятой; от неё мягкий переход.
        const soft = Math.max(0.02, tuning.rearSoftness);
        const cut = n >= size ? -Infinity : (rear[sorted[n - 1]!]! + rear[sorted[n]!]!) / 2;
        for (const a of sorted) weights[a] = smoothstep(-soft, soft, rear[a]! - cut);
    }

    update(dt: number, camera: PerspectiveCamera): void {
        const life = Math.max(0.05, tuning.trailLife);
        for (const s of this.samples) s.age += dt;
        while (this.samples.length && this.samples[this.samples.length - 1]!.age > life) this.samples.pop();

        const count = this.samples.length;
        for (let a = 0; a < this.ribbons.length; a++) {
            if (!this.samples.some((s) => s.weights[a]! > 0.01)) {
                this.ribbons[a]!.hide();
                continue;
            }
            // Толщина линий от рёбер относительно угловых — ручка edgeLineScale.
            const kind = a < CORNERS ? 1 : tuning.edgeLineScale;
            const alphaKind = a < CORNERS ? tuning.cornerLineAlpha : tuning.edgeLineAlpha;
            const trait = this.traits[a]!;
            for (let i = 0; i < count; i++) this.line[i] = this.samples[i]!.points[a]!;
            // Возраст точки в долях жизни именно этой линии: у короткой она гаснет раньше.
            const age = (i: number) => this.samples[i]!.age / (life * trait.life);
            this.ribbons[a]!.build(
                this.line,
                count,
                (i) => {
                    const s = this.samples[i]!;
                    const k = age(i);
                    return tuning.trailWidth * kind * trait.width * s.weights[a]! * s.gains[a]! * s.power * Math.max(0, 1 - k) * smoothstep(trait.delay, trait.delay + 0.1, k);
                },
                (i) => {
                    const s = this.samples[i]!;
                    const k = age(i);
                    // Пунктир: на своём шаге линия то густеет, то рвётся.
                    const gap = 0.5 + 0.5 * Math.sin(Math.PI * 2 * (trait.freq * k + trait.phase));
                    return Math.min(1, s.power * 1.4 * alphaKind * s.weights[a]! * s.gains[a]!) * Math.max(0, 1 - k) ** 0.8 * smoothstep(trait.delay, trait.delay + 0.06, k) * (1 - tuning.trailDash * trait.dash * gap * gap);
                },
                camera,
            );
        }
    }

    dispose(): void {
        for (const ribbon of this.ribbons) ribbon.dispose();
    }
}

/** Звезда «бам» и облачка пыли в момент удара. Живут на игровом времени: на замирании кадра они тоже замирают. */
export class ImpactFx {
    private readonly burstMap = createBurstTexture();
    private readonly puffMap = createPuffTexture();
    private readonly ringMap = createRingTexture();
    private readonly away = new Vector3();

    constructor(
        private readonly scene: Scene,
        private readonly ticker: Ticker,
        private readonly camera: PerspectiveCamera,
    ) {}

    /**
     * Играет эффект: сначала выставляет его начальное состояние (k = 0) и только потом добавляет в сцену.
     * Иначе в первый кадр, до первого шага твина, объект рисуется со значениями по умолчанию — в нуле и в полный
     * размер, а на замирании кадра на ударе это видно особенно долго.
     */
    private play(object: Object3D, duration: number, update: (k: number) => void, done: () => void): void {
        update(0);
        this.scene.add(object);
        void this.ticker.tween(duration, update, linear).then(() => {
            object.removeFromParent();
            done();
        });
    }

    /** Звезда стоит за кубиком, а не перед ним: сплющенный кубик в момент удара — главное, его нельзя закрывать. */
    burst(at: Vector3, power: number): void {
        const size = tuning.burstSize * (0.4 + 0.6 * power);
        if (size < 0.05) return;
        const material = new SpriteMaterial({
            map: this.burstMap,
            transparent: true,
            depthWrite: false,
            rotation: (Math.random() - 0.5) * 0.7,
        });
        const sprite = new Sprite(material);
        sprite.position.copy(at).addScaledVector(this.away.subVectors(at, this.camera.position).normalize(), 0.9);
        sprite.position.y += 0.35;
        this.play(
            sprite,
            0.32,
            (k) => {
                sprite.scale.setScalar(size * lerp(0.25, 1, easeOutBack(Math.min(1, k * 2.2))) * (1 + 0.12 * k));
                material.opacity = 1 - smoothstep(0.6, 1, k);
            },
            () => material.dispose(),
        );
    }

    /** Кольцо ударной волны: плоское, на полу, быстро расходится и гаснет. */
    ring(at: Vector3, power: number): void {
        const size = tuning.shockwave * (0.5 + 0.5 * power);
        if (size < 0.05) return;
        const material = new MeshBasicMaterial({ map: this.ringMap, transparent: true, depthWrite: false });
        const mesh = new Mesh(new PlaneGeometry(1, 1), material);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(at.x, 0.006, at.z);
        this.play(
            mesh,
            0.4,
            (k) => {
                mesh.scale.setScalar(size * lerp(0.35, 1, easeOutCubic(k)));
                material.opacity = 1 - smoothstep(0.35, 1, k);
            },
            () => {
                mesh.geometry.dispose();
                material.dispose();
            },
        );
    }

    dust(at: Vector3, power: number): void {
        const count = Math.round(tuning.dust * (0.4 + 0.6 * power));
        for (let i = 0; i < count; i++) {
            const angle = ((i + Math.random() * 0.6) / count) * Math.PI * 2;
            const dx = Math.cos(angle);
            const dz = Math.sin(angle);
            const size = (0.3 + Math.random() * 0.18) * (0.55 + 0.45 * power);
            const reach = 0.4 + (0.6 + Math.random() * 0.4) * power;
            const material = new SpriteMaterial({ map: this.puffMap, transparent: true, depthWrite: false, rotation: Math.random() * 6.28 });
            const sprite = new Sprite(material);
            sprite.renderOrder = 5;
            this.play(
                sprite,
                0.6,
                (k) => {
                    const e = easeOutCubic(k);
                    const r = 0.45 + reach * e;
                    sprite.position.set(at.x + dx * r, 0.2 + 0.35 * e, at.z + dz * r);
                    sprite.scale.setScalar(size * (0.5 + 0.9 * e));
                    material.opacity = 1 - smoothstep(0.45, 1, k);
                },
                () => material.dispose(),
            );
        }
    }

    dispose(): void {
        this.burstMap.dispose();
        this.puffMap.dispose();
        this.ringMap.dispose();
    }
}
