import { linear, type Ease } from './ease';

/** Вернуть false — и функция снимается с тикера. */
export type TickFn = (dt: number, time: number) => boolean | void;

/**
 * Игровое время. Твины и паузы считаются по кадрам, а не по setTimeout:
 * поставил игру на паузу или замедлил — замедлилось всё сразу.
 */
export class Ticker {
    time = 0;
    /** Множитель скорости: 0.25 — замедленная съёмка, удобно отлаживать анимации. */
    speed = 1;
    private readonly fns = new Set<TickFn>();

    add(fn: TickFn): () => void {
        this.fns.add(fn);
        return () => this.fns.delete(fn);
    }

    update(realDt: number): number {
        const dt = realDt * this.speed;
        this.time += dt;
        for (const fn of [...this.fns]) {
            if (fn(dt, this.time) === false) this.fns.delete(fn);
        }
        return dt;
    }

    /** Твин: onUpdate получает прогресс 0…1 уже после кривой. */
    tween(duration: number, onUpdate: (k: number) => void, ease: Ease = linear): Promise<void> {
        return new Promise((resolve) => {
            let t = 0;
            this.add((dt) => {
                t = Math.min(duration, t + dt);
                onUpdate(ease(duration > 0 ? t / duration : 1));
                if (t >= duration) {
                    resolve();
                    return false;
                }
            });
        });
    }

    wait(seconds: number): Promise<void> {
        return this.tween(seconds, () => {});
    }
}
