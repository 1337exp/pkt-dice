import { BackSide, Color, ShaderMaterial, Vector3 } from 'three';
import { tuning } from '../tuning';
import { FACE } from './faces';

/** Радиус скругления рёбер. Кайма на гранях (tuning.edge) по умолчанию ровно такой же ширины. */
export const BEVEL = 0.08;

/**
 * Деформации кубика, которые не умеют матрицы. Делаются уже в мире, после растяжения.
 *
 * Закрутка (twist): вращение «тянет» геометрию — каждая вершина поворачивается назад вокруг оси вращения
 * тем сильнее, чем дальше она от центра, так что углы отстают по дуге, а грани выгибаются, как при смазе.
 *
 * Изгиб (bend) вдоль траектории: точку раскладываем на
 * «вдоль полёта» (u), «в сторону изгиба» (w) и остальное (e) и сгибаем по дуге радиуса R = 1 / кривизна.
 * Нормаль поворачивается вместе с дугой, чтобы свет и контур шли за формой. Кривизна 0 — ничего не меняется.
 */
const DEFORM_GLSL = /* glsl */ `
uniform vec3 uBendCenter;
uniform vec3 uBendAxis;
uniform vec3 uBendDir;
uniform float uBendCurv;
uniform vec3 uTwistAxis;
uniform float uTwist;

void twist(inout vec3 p, inout vec3 n) {
    if (uTwist < 1e-4) return;
    vec3 r = p - uBendCenter;
    float angle = -uTwist * clamp(length(r) / 0.87, 0.0, 1.5);
    float s = sin(angle);
    float c = cos(angle);
    vec3 k = uTwistAxis;
    r = r * c + cross(k, r) * s + k * dot(k, r) * (1.0 - c);
    n = n * c + cross(k, n) * s + k * dot(k, n) * (1.0 - c);
    p = uBendCenter + r;
}

void bend(inout vec3 p, inout vec3 n) {
    if (uBendCurv < 1e-4) return;
    vec3 a = uBendAxis;
    vec3 d = normalize(uBendDir - a * dot(uBendDir, a));
    vec3 r = p - uBendCenter;
    float u = dot(r, a);
    float w = dot(r, d);
    vec3 e = r - a * u - d * w;
    float radius = 1.0 / uBendCurv;
    float theta = u * uBendCurv;
    float s = sin(theta);
    float c = cos(theta);
    p = uBendCenter + e + a * ((radius - w) * s) + d * (radius - (radius - w) * c);

    float nu = dot(n, a);
    float nw = dot(n, d);
    vec3 ne = n - a * nu - d * nw;
    n = normalize(ne + a * (nu * c - nw * s) + d * (nu * s + nw * c));
}

void deform(inout vec3 p, inout vec3 n) {
    twist(p, n);
    bend(p, n);
}
`;

const DIE_VERT = /* glsl */ `
${DEFORM_GLSL}

varying vec3 vLocal;
varying vec3 vNormal;

void main() {
    vLocal = position;
    vec3 world = (modelMatrix * vec4(position, 1.0)).xyz;
    vec3 n = normalize(transpose(inverse(mat3(modelMatrix))) * normal);
    deform(world, n);
    vNormal = normalize(mat3(viewMatrix) * n);
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

/**
 * Лицо кубика целиком из шейдера: белая грань, чёрная кайма и точки рисуются по положению на кубе,
 * без текстур и UV. Какая это грань — по самой большой координате (на скруглённом ребре она
 * переключается внутри каймы, шва не видно). Свет мультяшный: три ровные ступени на грань.
 */
const DIE_FRAG = /* glsl */ `
uniform vec3 uPaper;
uniform vec3 uShadow;
uniform vec3 uInk;
uniform vec3 uLight;
uniform float uEdge;
uniform float uPip;

varying vec3 vLocal;
varying vec3 vNormal;

const float PITCH = 0.27;

// Какие из девяти клеток 3x3 заняты точками (бит i — клетка i, слева направо, сверху вниз).
int pipMask(int v) {
    if (v == 1) return 16;
    if (v == 2) return 1 | 256;
    if (v == 3) return 1 | 16 | 256;
    if (v == 4) return 1 | 4 | 64 | 256;
    if (v == 5) return 1 | 4 | 16 | 64 | 256;
    return 1 | 4 | 8 | 32 | 64 | 256;
}

void main() {
    vec3 a = abs(vLocal);
    vec2 uv;
    int value;
    if (a.x >= a.y && a.x >= a.z) {
        uv = vec2(-vLocal.z * sign(vLocal.x), vLocal.y);
        value = vLocal.x > 0.0 ? ${FACE.px} : ${FACE.nx};
    } else if (a.y >= a.z) {
        uv = vec2(vLocal.x, -vLocal.z * sign(vLocal.y));
        value = vLocal.y > 0.0 ? ${FACE.py} : ${FACE.ny};
    } else {
        uv = vec2(vLocal.x * sign(vLocal.z), vLocal.y);
        value = vLocal.z > 0.0 ? ${FACE.pz} : ${FACE.nz};
    }

    // Ширина пикселя в координатах куба — для сглаживания краёв (она непрерывна и на рёбрах).
    float aa = length(fwidth(vLocal)) * 0.7;

    float edge = 0.5 - max(abs(uv.x), abs(uv.y));
    float ink = 1.0 - smoothstep(uEdge - aa, uEdge + aa, edge);

    int mask = pipMask(value);
    float d = 1e3;
    for (int i = 0; i < 9; i++) {
        if ((mask & (1 << i)) != 0) {
            vec2 c = vec2(float(i % 3) - 1.0, 1.0 - float(i / 3)) * PITCH;
            d = min(d, length(uv - c) - uPip);
        }
    }
    ink = max(ink, 1.0 - smoothstep(-aa, aa, d));

    float ndl = dot(normalize(vNormal), uLight);
    float band = step(0.1, ndl) * 0.5 + step(0.5, ndl) * 0.5;
    vec3 face = mix(uShadow, uPaper, band);

    gl_FragColor = vec4(mix(face, uInk, ink), 1.0);
    #include <colorspace_fragment>
}
`;

/**
 * Контур — «вывернутая оболочка»: тот же кубик, раздутый вдоль нормалей и видимый только изнанкой.
 * Раздувается в пространстве камеры, так что толщина линии не зависит от сплющивания кубика.
 */
const OUTLINE_VERT = /* glsl */ `
${DEFORM_GLSL}

uniform float uWidth;

void main() {
    vec3 world = (modelMatrix * vec4(position, 1.0)).xyz;
    vec3 n = normalize(transpose(inverse(mat3(modelMatrix))) * normal);
    deform(world, n);
    vec4 mv = viewMatrix * vec4(world, 1.0);
    mv.xyz += normalize(mat3(viewMatrix) * n) * uWidth;
    gl_Position = projectionMatrix * mv;
}
`;

const OUTLINE_FRAG = /* glsl */ `
uniform vec3 uInk;

void main() {
    gl_FragColor = vec4(uInk, 1.0);
    #include <colorspace_fragment>
}
`;

const INK = '#15151a';
const PAPER = '#fcfcfa';
const SHADOW_TINT = '#8d93a3';

export class DieMaterials {
    readonly face: ShaderMaterial;
    readonly outline: ShaderMaterial;
    private readonly paper = new Color(PAPER);
    private readonly shadowTint = new Color(SHADOW_TINT);
    /** Деформации общие для кубика и контура: у них одни и те же uniform'ы. */
    private readonly bend = {
        uBendCenter: { value: new Vector3() },
        uBendAxis: { value: new Vector3(1, 0, 0) },
        uBendDir: { value: new Vector3(0, 1, 0) },
        uBendCurv: { value: 0 },
        uTwistAxis: { value: new Vector3(0, 1, 0) },
        uTwist: { value: 0 },
    };

    constructor() {
        this.face = new ShaderMaterial({
            vertexShader: DIE_VERT,
            fragmentShader: DIE_FRAG,
            uniforms: {
                ...this.bend,
                uPaper: { value: this.paper.clone() },
                uShadow: { value: this.paper.clone() },
                uInk: { value: new Color(INK) },
                uLight: { value: new Vector3(-0.35, 0.75, 0.55).normalize() },
                uEdge: { value: tuning.edge },
                uPip: { value: tuning.pipSize },
            },
        });
        this.outline = new ShaderMaterial({
            vertexShader: OUTLINE_VERT,
            fragmentShader: OUTLINE_FRAG,
            side: BackSide,
            uniforms: {
                ...this.bend,
                uInk: { value: new Color(INK) },
                uWidth: { value: tuning.outline },
            },
        });
    }

    /** Центр, ось и направление изгиба, кривизна; угловая скорость — для закрутки. */
    setDeform(center: Vector3, axis: Vector3, dir: Vector3, curvature: number, spin: Vector3): void {
        this.bend.uBendCenter.value.copy(center);
        this.bend.uBendAxis.value.copy(axis);
        this.bend.uBendDir.value.copy(dir);
        this.bend.uBendCurv.value = curvature;
        const speed = spin.length();
        this.bend.uTwistAxis.value.copy(spin).divideScalar(speed || 1);
        // Закрутка не больше 1.3 рад на угол куба, иначе грани выворачиваются.
        this.bend.uTwist.value = Math.min(tuning.twist * speed, 1.3);
    }

    /** Значения из tuning.ts. Это лишь uniform'ы — менять каждый кадр дёшево. */
    update(): void {
        const u = this.face.uniforms;
        (u.uShadow!.value as Color).copy(this.paper).lerp(this.shadowTint, tuning.shade);
        u.uEdge!.value = tuning.edge;
        u.uPip!.value = tuning.pipSize;
        this.outline.uniforms.uWidth!.value = tuning.outline;
    }

    dispose(): void {
        this.face.dispose();
        this.outline.dispose();
    }
}
