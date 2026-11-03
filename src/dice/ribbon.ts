import { BufferAttribute, BufferGeometry, DoubleSide, DynamicDrawUsage, Mesh, MeshBasicMaterial, Vector3, type PerspectiveCamera } from 'three';

/** Больше точек в одной ленте не бывает: хватает на секунду следа при 60 кадрах. */
export const MAX_SAMPLES = 64;
const INK: [number, number, number] = [0.02, 0.02, 0.03];

const index: number[] = [];
for (let i = 0; i < MAX_SAMPLES - 1; i++) {
    const a = i * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
}

/** Одна чёрная линия-лента по точкам: всегда плоскостью к камере, с переменной шириной и прозрачностью по длине. */
export class Ribbon {
    readonly mesh: Mesh<BufferGeometry, MeshBasicMaterial>;
    private readonly position = new BufferAttribute(new Float32Array(MAX_SAMPLES * 2 * 3), 3);
    private readonly color = new BufferAttribute(new Float32Array(MAX_SAMPLES * 2 * 4), 4);
    private readonly side = new Vector3();
    private readonly toCamera = new Vector3();
    private readonly tangent = new Vector3();

    constructor() {
        const geometry = new BufferGeometry();
        this.position.setUsage(DynamicDrawUsage);
        this.color.setUsage(DynamicDrawUsage);
        geometry.setAttribute('position', this.position);
        geometry.setAttribute('color', this.color);
        geometry.setIndex(index);
        geometry.setDrawRange(0, 0);
        this.mesh = new Mesh(geometry, new MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: DoubleSide }));
        this.mesh.frustumCulled = false;
    }

    hide(): void {
        this.mesh.geometry.setDrawRange(0, 0);
    }

    /** points[0] — самая свежая точка; half(i) — полуширина ленты в точке i, alpha(i) — непрозрачность. */
    build(points: Vector3[], count: number, half: (i: number) => number, alpha: (i: number) => number, camera: PerspectiveCamera): void {
        if (count < 2) return this.hide();
        const pos = this.position.array as Float32Array;
        const col = this.color.array as Float32Array;
        for (let i = 0; i < count; i++) {
            const p = points[i]!;
            this.tangent.subVectors(points[Math.max(0, i - 1)]!, points[Math.min(count - 1, i + 1)]!);
            this.toCamera.subVectors(camera.position, p);
            // Ширина поперёк направления линии и взгляда: лента всегда видна плашмя.
            if (this.tangent.lengthSq() > 1e-10) this.side.crossVectors(this.tangent, this.toCamera).normalize();
            const w = half(i);
            const a = alpha(i);
            for (let k = 0; k < 2; k++) {
                const sign = k === 0 ? 1 : -1;
                const v = (i * 2 + k) * 3;
                pos[v] = p.x + this.side.x * w * sign;
                pos[v + 1] = p.y + this.side.y * w * sign;
                pos[v + 2] = p.z + this.side.z * w * sign;
                const c = (i * 2 + k) * 4;
                col[c] = INK[0];
                col[c + 1] = INK[1];
                col[c + 2] = INK[2];
                col[c + 3] = a;
            }
        }
        this.position.needsUpdate = true;
        this.color.needsUpdate = true;
        this.mesh.geometry.setDrawRange(0, (count - 1) * 6);
    }

    dispose(): void {
        this.mesh.geometry.dispose();
        this.mesh.material.dispose();
    }
}
