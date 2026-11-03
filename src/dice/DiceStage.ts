import { Color, MathUtils, PerspectiveCamera, Plane, Raycaster, Scene, SRGBColorSpace, Vector2, Vector3, WebGLRenderer } from 'three';
import { smoothstep } from '../anim/ease';
import { Ticker } from '../anim/ticker';
import { tuning } from '../tuning';
import { ANCHOR_COUNT, DieView, MAX_GHOSTS } from './DieView';
import { orientationWithTop } from './faces';
import { SpinTrail, FloorShadow, ImpactFx, SwirlTrail } from './fx';
import { createBlobTexture } from './textures';
import { copyPose, createPose, HALF, planThrow, type DieRest, type Impact, type ThrowPlan } from './throwPlan';

export interface StageEvents {
    /** Бросок начался. */
    onThrow?: () => void;
    /** Последний удар: кубик лёг, можно показывать, что выпало. */
    onResult?: (value: number) => void;
}

export interface ThrowOptions {
    /** Что должно выпасть; без него — случайно. */
    value?: number;
    /** Куда бросить, в координатах экрана −1…1; без него — случайное место ближе к центру. */
    ndc?: { x: number; y: number };
}

/** Куда можно бросать: часть экрана, которая на полу точно видна. */
const NDC_LIMITS = { x: 0.7, yMin: -0.55, yMax: 0.3 };
const FLOOR = new Plane(new Vector3(0, 1, 0), 0);
const LOOK_AT = new Vector3(0, 0.4, 0);

/**
 * Сцена кубика: рендерер, камера с наклоном вниз, кубик, тень, эффекты. Стола нет — только серый фон
 * и пятно тени, по которому видно, где пол. Бросок — заранее посчитанный сценарий (throwPlan.ts),
 * сцена проигрывает его по игровому времени и в моменты ударов запускает эффекты.
 */
export class DiceStage {
    readonly renderer: WebGLRenderer;
    readonly scene = new Scene();
    readonly camera: PerspectiveCamera;
    readonly ticker = new Ticker();
    readonly die = new DieView();
    /** Что показывает кубик сейчас; до первого броска — null. */
    value: number | null = null;

    private readonly shadow = new FloorShadow(createBlobTexture());
    private readonly trail = new SwirlTrail();
    private readonly spinTrail = new SpinTrail();
    private readonly anchors = Array.from({ length: ANCHOR_COUNT }, () => new Vector3());
    /** Кольцо последних поз кубика: по нему призраки показывают, где он был чуть раньше. */
    private readonly history = Array.from({ length: 64 }, () => ({ t: 0, pose: createPose() }));
    private historyHead = 0;
    private historyCount = 0;
    private readonly fx: ImpactFx;
    private readonly pose = createPose();
    private readonly prevPos = new Vector3();
    private readonly raycaster = new Raycaster();
    private readonly observer: ResizeObserver;
    private rest: DieRest = { pos: new Vector3(0, HALF, 0), quat: orientationWithTop(1) };
    private plan: ThrowPlan | null = null;
    private planTime = 0;
    private nextImpact = 0;
    /** Сколько ещё реального времени игра стоит на замирании. */
    private hold = 0;
    private shake = 0;
    private fov = 0;
    private frame = 0;
    private last = 0;
    private readonly onPointerDown = (e: PointerEvent) => {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.throwDie({ ndc: { x: ((e.clientX - rect.left) / rect.width) * 2 - 1, y: -(((e.clientY - rect.top) / rect.height) * 2 - 1) } });
    };

    constructor(
        private readonly container: HTMLElement,
        private readonly events: StageEvents = {},
    ) {
        this.renderer = new WebGLRenderer({ antialias: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.domElement.style.display = 'block';
        this.renderer.domElement.style.touchAction = 'none';
        container.appendChild(this.renderer.domElement);
        this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);

        this.camera = new PerspectiveCamera(tuning.camFov, 1, 0.1, 80);
        this.scene.add(this.camera, this.die.root, this.shadow.mesh, this.trail.object, this.spinTrail.object);
        this.fx = new ImpactFx(this.scene, this.ticker, this.camera);

        this.pose.pos.copy(this.rest.pos);
        this.pose.quat.copy(this.rest.quat);
        this.die.apply(this.pose);
        this.prevPos.copy(this.pose.pos);

        this.observer = new ResizeObserver(() => this.resize());
        this.observer.observe(container);
        this.resize();

        this.last = performance.now();
        const loop = (now: number) => {
            this.frame = requestAnimationFrame(loop);
            this.update(Math.min(1 / 30, (now - this.last) / 1000));
            this.last = now;
        };
        this.frame = requestAnimationFrame(loop);
    }

    get rolling(): boolean {
        return this.plan !== null;
    }

    /**
     * Бросить кубик. Пока он катится, новый бросок не принимается; на покачивании после последнего удара — уже можно.
     * Возвращает false, если бросок не принят.
     */
    throwDie(opts: ThrowOptions = {}): boolean {
        if (this.plan && this.planTime < this.plan.settleStart) return false;
        const value = opts.value ?? 1 + Math.floor(Math.random() * 6);
        const ndc = opts.ndc ?? { x: (Math.random() - 0.5) * 0.8, y: MathUtils.lerp(-0.3, 0.15, Math.random()) };
        this.plan = planThrow(this.rest, this.floorPoint(ndc), value);
        this.rest = this.plan.final;
        this.planTime = 0;
        this.nextImpact = 0;
        this.spinTrail.reseed();
        this.historyCount = 0;
        this.events.onThrow?.();
        return true;
    }

    /** Один кадр вручную: для отладки и тестов, когда requestAnimationFrame не идёт (вкладка в фоне). */
    step(dt = 1 / 60): void {
        this.update(dt);
    }

    /** Точка пола под точкой экрана; экран ограничен областью, где пол точно виден. */
    private floorPoint(ndc: { x: number; y: number }): Vector3 {
        const clamped = new Vector2(MathUtils.clamp(ndc.x, -NDC_LIMITS.x, NDC_LIMITS.x), MathUtils.clamp(ndc.y, NDC_LIMITS.yMin, NDC_LIMITS.yMax));
        this.updateCamera();
        this.raycaster.setFromCamera(clamped, this.camera);
        return this.raycaster.ray.intersectPlane(FLOOR, new Vector3()) ?? new Vector3();
    }

    private impact(impact: Impact): void {
        const power = impact.intensity;
        this.fx.burst(impact.at, power);
        this.fx.dust(impact.at, power);
        this.fx.ring(impact.at, power);
        this.shake = Math.max(this.shake, tuning.shake * power);
        this.hold = Math.max(this.hold, tuning.hitStop * power);
        if (impact.final && this.plan) {
            this.value = this.plan.value;
            this.events.onResult?.(this.plan.value);
        }
    }

    private update(realDt: number): void {
        this.ticker.speed = this.hold > 0 ? 0 : tuning.speed;
        const dt = this.ticker.update(realDt);
        this.hold = Math.max(0, this.hold - realDt);

        if (this.plan) this.advance(dt);
        this.updateGhosts();

        this.die.updateLook();
        this.trail.update(dt, this.camera);
        this.spinTrail.update(dt, this.camera);
        const height = Math.max(0, this.pose.pos.y - HALF);
        this.shadow.update(this.pose.pos, height, this.pose.airborne ? 1 : 1 / Math.sqrt(this.pose.stretch));

        this.scene.background = new Color().setRGB(tuning.background, tuning.background, tuning.background, SRGBColorSpace);
        this.updateCamera();
        if (this.shake > 0.001) {
            const a = this.shake * 0.12;
            this.camera.position.x += (Math.random() - 0.5) * a;
            this.camera.position.y += (Math.random() - 0.5) * a;
            this.shake *= Math.exp(-realDt * 10);
        }
        this.renderer.render(this.scene, this.camera);
    }

    private record(): void {
        const entry = this.history[this.historyHead]!;
        entry.t = this.planTime;
        copyPose(this.pose, entry.pose);
        this.historyHead = (this.historyHead + 1) % this.history.length;
        this.historyCount = Math.min(this.historyCount + 1, this.history.length);
    }

    /** Поза кубика в момент time (последняя запись не позже него) или null, если записей ещё нет. */
    private poseAt(time: number) {
        for (let k = 0; k < this.historyCount; k++) {
            const entry = this.history[(this.historyHead - 1 - k + this.history.length) % this.history.length]!;
            if (entry.t <= time) return entry.pose;
        }
        return null;
    }

    /**
     * Призрачные копии (смаз): кубик в прошлых позах, всё бледнее. Видны только пока он быстро крутится,
     * поэтому на замедлении перед ударом пропадают сами.
     */
    private updateGhosts(): void {
        const count = Math.round(MathUtils.clamp(tuning.ghostCount, 0, MAX_GHOSTS));
        const power = this.plan ? smoothstep(6, 26, this.pose.spin.length()) : 0;
        for (let i = 0; i < MAX_GHOSTS; i++) {
            const pose = i < count && power > 0 ? this.poseAt(this.planTime - (i + 1) * tuning.ghostStep) : null;
            if (pose) this.die.applyGhost(i, pose, tuning.ghostAlpha * (1 - i / count) * power);
            else this.die.applyGhost(i, this.pose, 0);
        }
    }

    private advance(dt: number): void {
        const plan = this.plan!;
        this.planTime += dt;
        plan.sample(this.planTime, this.pose);
        this.die.apply(this.pose);
        if (dt > 0) this.record();

        while (this.nextImpact < plan.impacts.length && plan.impacts[this.nextImpact]!.time <= this.planTime) {
            this.impact(plan.impacts[this.nextImpact]!);
            this.nextImpact++;
        }

        if (this.pose.airborne && dt > 0) {
            const velocity = this.pose.pos.clone().sub(this.prevPos).divideScalar(dt);
            this.trail.push(this.pose.pos, velocity);
            if ((tuning.cornerTrails > 0 || tuning.edgeTrails > 0) && velocity.lengthSq() > 1e-6) {
                this.die.anchorPoints(this.pose, this.anchors);
                this.spinTrail.push(this.anchors, this.pose.spin.length(), this.pose.pos, velocity.normalize(), plan.final.pos);
            }
        }
        this.prevPos.copy(this.pose.pos);

        if (this.planTime >= plan.duration) this.plan = null;
    }

    /** Камера смотрит на пол сверху под углом; на узком экране отодвигается, чтобы кубик не вылезал за края. */
    private updateCamera(): void {
        if (this.fov !== tuning.camFov) {
            this.fov = tuning.camFov;
            this.camera.fov = this.fov;
            this.camera.updateProjectionMatrix();
        }
        const elevation = MathUtils.degToRad(tuning.camElevation);
        const distance = tuning.camDistance * Math.max(1, 1.3 / this.camera.aspect);
        this.camera.position.set(0, Math.sin(elevation) * distance, Math.cos(elevation) * distance).add(LOOK_AT);
        this.camera.lookAt(LOOK_AT);
    }

    private resize(): void {
        const w = this.container.clientWidth;
        const h = this.container.clientHeight;
        if (!w || !h) return;
        this.renderer.setSize(w, h);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
    }

    dispose(): void {
        cancelAnimationFrame(this.frame);
        this.observer.disconnect();
        this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
        this.die.dispose();
        this.shadow.dispose();
        this.trail.dispose();
        this.spinTrail.dispose();
        this.fx.dispose();
        this.renderer.dispose();
        this.renderer.domElement.remove();
    }
}
