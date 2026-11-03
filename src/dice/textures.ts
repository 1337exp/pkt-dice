import { CanvasTexture, SRGBColorSpace } from 'three';

const INK = '#15151a';

function bake(size: number, draw: (g: CanvasRenderingContext2D, size: number) => void): CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    draw(canvas.getContext('2d')!, size);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
}

/** Жирный чёрный контур вокруг белой заливки: контур рисуется под заливкой, видна только его внешняя половина. */
function inked(g: CanvasRenderingContext2D, width: number, path: () => void): void {
    g.lineJoin = 'round';
    g.lineWidth = width;
    g.strokeStyle = INK;
    g.fillStyle = '#ffffff';
    path();
    g.stroke();
    path();
    g.fill();
}

/** Комиксовый взрыв «бам»: неровная зубчатая звезда. */
export function createBurstTexture(): CanvasTexture {
    return bake(256, (g, s) => {
        const c = s / 2;
        // Вершины и впадины чередуются; разброс радиусов — чтобы звезда выглядела нарисованной от руки.
        const tips = [1, 0.8, 0.96, 0.78, 0.98, 0.74, 0.92, 0.84];
        const dips = [0.5, 0.44, 0.52, 0.47, 0.5, 0.46, 0.53, 0.45];
        inked(g, 22, () => {
            g.beginPath();
            for (let i = 0; i < 16; i++) {
                const r = (i % 2 === 0 ? tips[i / 2]! : dips[(i - 1) / 2]!) * c * 0.88;
                const a = (i / 16) * Math.PI * 2 - Math.PI / 2 + (i % 2 === 0 ? 0.04 : -0.03) * ((i * 7) % 3);
                g.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
            }
            g.closePath();
        });
    });
}

/** Облачко пыли: несколько кругов, склеенных в один контур. */
export function createPuffTexture(): CanvasTexture {
    return bake(128, (g, s) => {
        const c = s / 2;
        const lobes = [
            [0, 0.04, 0.38],
            [-0.3, 0.1, 0.27],
            [0.3, 0.1, 0.27],
            [-0.16, -0.22, 0.25],
            [0.17, -0.22, 0.26],
            [0, 0.28, 0.24],
        ] as const;
        inked(g, 12, () => {
            g.beginPath();
            for (const [x, y, r] of lobes) {
                g.moveTo(c + (x + r) * c * 1.5, c + y * c * 1.5);
                g.arc(c + x * c * 1.5, c + y * c * 1.5, r * c * 1.5, 0, Math.PI * 2);
            }
        });
    });
}

/** Кольцо ударной волны: белая линия с чёрной окантовкой. */
export function createRingTexture(): CanvasTexture {
    return bake(256, (g, s) => {
        const c = s / 2;
        g.lineCap = 'round';
        for (const [color, width] of [
            [INK, 20],
            ['#ffffff', 8],
        ] as const) {
            g.strokeStyle = color;
            g.lineWidth = width;
            g.beginPath();
            g.arc(c, c, c * 0.82, 0, Math.PI * 2);
            g.stroke();
        }
    });
}

/** Мягкое тёмное пятно для тени под кубиком. */
export function createBlobTexture(): CanvasTexture {
    return bake(128, (g, s) => {
        const c = s / 2;
        const gradient = g.createRadialGradient(c, c, 0, c, c, c);
        gradient.addColorStop(0, 'rgba(10, 10, 14, 1)');
        gradient.addColorStop(0.72, 'rgba(10, 10, 14, 0.92)');
        gradient.addColorStop(1, 'rgba(10, 10, 14, 0)');
        g.fillStyle = gradient;
        g.fillRect(0, 0, s, s);
    });
}
