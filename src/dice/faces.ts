import { Quaternion, Vector3 } from 'three';

/**
 * Что нарисовано на какой грани (локальные оси куба). Противоположные грани дают 7,
 * а 1-2-3 идут против часовой стрелки, как на настоящем кубике. Шейдер берёт числа отсюда же.
 */
export const FACE = { px: 2, nx: 5, py: 3, ny: 4, pz: 1, nz: 6 } as const;

const FACE_NORMALS: { value: number; normal: Vector3 }[] = [
    { value: FACE.px, normal: new Vector3(1, 0, 0) },
    { value: FACE.nx, normal: new Vector3(-1, 0, 0) },
    { value: FACE.py, normal: new Vector3(0, 1, 0) },
    { value: FACE.ny, normal: new Vector3(0, -1, 0) },
    { value: FACE.pz, normal: new Vector3(0, 0, 1) },
    { value: FACE.nz, normal: new Vector3(0, 0, -1) },
];

const UP = new Vector3(0, 1, 0);

/** Куда смотрит грань с этим числом в осях самого куба. */
export function faceNormal(value: number): Vector3 {
    return (FACE_NORMALS.find((f) => f.value === value) ?? FACE_NORMALS[0]!).normal;
}

/** Поворот куба, при котором грань с этим числом смотрит вверх. */
export function orientationWithTop(value: number): Quaternion {
    return new Quaternion().setFromUnitVectors(faceNormal(value), UP);
}
