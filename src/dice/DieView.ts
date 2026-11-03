import { Group, Mesh, Vector3 } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { tuning } from '../tuning';
import { BEVEL, DieMaterials } from './materials';

/** Опорные точки в осях куба: 8 углов (по x, y, z от меньшего к большему), потом 12 середин рёбер. */
const ANCHORS: Vector3[] = [];
for (const x of [-0.5, 0.5]) for (const y of [-0.5, 0.5]) for (const z of [-0.5, 0.5]) ANCHORS.push(new Vector3(x, y, z));
// Рёбра вдоль x, вдоль y, вдоль z: по четыре.
for (const a of [-0.5, 0.5]) for (const b of [-0.5, 0.5]) ANCHORS.push(new Vector3(0, a, b));
for (const a of [-0.5, 0.5]) for (const b of [-0.5, 0.5]) ANCHORS.push(new Vector3(a, 0, b));
for (const a of [-0.5, 0.5]) for (const b of [-0.5, 0.5]) ANCHORS.push(new Vector3(a, b, 0));
export const ANCHOR_COUNT = ANCHORS.length;
import type { DiePose } from './throwPlan';

const AXIS_X = new Vector3(1, 0, 0);

/**
 * Кубик на сцене. Устроен в три слоя, чтобы мультяшная деформация шла «по миру», а не по граням куба:
 *   object   — место в мире;
 *   deformer — выравнен по оси растяжения (вдоль полёта или вверх) и растягивается вдоль неё;
 *   cube     — настоящий поворот куба, из которого убран поворот deformer'а.
 * Итог: куб крутится как хочет, а вытягивается и сплющивается строго вдоль движения.
 */
export class DieView {
    readonly object = new Group();
    private readonly deformer = new Group();
    private readonly cube = new Group();
    private readonly materials = new DieMaterials();
    private readonly twistAxis = new Vector3();
    private readonly geometry = new RoundedBoxGeometry(1, 1, 1, 5, BEVEL);

    constructor() {
        const hull = new Mesh(this.geometry, this.materials.outline);
        const body = new Mesh(this.geometry, this.materials.face);
        this.cube.add(hull, body);
        this.deformer.add(this.cube);
        this.object.add(this.deformer);
    }

    apply(pose: DiePose): void {
        this.object.position.copy(pose.pos);
        // Объём сохраняется: вытянулся вдоль оси в f раз — поперёк стал уже в sqrt(f) раз.
        const across = 1 / Math.sqrt(pose.stretch);
        this.deformer.quaternion.setFromUnitVectors(AXIS_X, pose.axis);
        this.deformer.scale.set(pose.stretch, across, across);
        this.cube.quaternion.copy(this.deformer.quaternion).invert().multiply(pose.quat);
        this.materials.setDeform(pose.pos, pose.axis, pose.bendDir, pose.bend, pose.spin);
    }

    /**
     * Где в мире опорные точки кубика (ANCHORS): с растяжением и закруткой, как их рисует шейдер (изгиб не учитываем).
     * Линии за вращающимся кубиком идут именно по этим точкам, поэтому тянутся от настоящих углов и рёбер на экране.
     */
    anchorPoints(pose: DiePose, out: Vector3[]): void {
        const speed = pose.spin.length();
        const twist = Math.min(tuning.twist * speed, 1.3);
        const across = 1 / Math.sqrt(pose.stretch);
        for (let i = 0; i < ANCHORS.length; i++) {
            const r = out[i]!.copy(ANCHORS[i]!).applyQuaternion(pose.quat);
            // Растяжение вдоль оси: поперёк в across раз, вдоль в stretch раз.
            r.multiplyScalar(across).addScaledVector(pose.axis, ((pose.stretch - across) * r.dot(pose.axis)) / across);
            if (twist > 1e-4) r.applyAxisAngle(this.twistAxis.copy(pose.spin).divideScalar(speed), -twist * Math.min(r.length() / 0.87, 1.5));
            r.add(pose.pos);
        }
    }

    updateLook(): void {
        this.materials.update();
    }

    dispose(): void {
        this.geometry.dispose();
        this.materials.dispose();
    }
}
