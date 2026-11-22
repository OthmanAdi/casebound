import { describe, expect, it } from 'vitest';
import { FrameLoop } from './loop';

const make = () => {
  let draws = 0;
  const loop = new FrameLoop({ render: () => void draws++, heartbeat: 1, raf: () => 0, caf: () => undefined });
  return { loop, draws: () => draws };
};

describe('FrameLoop', () => {
  it('draws the first frame, then only on demand', () => {
    const { loop, draws } = make();
    loop.tick(0);
    expect(draws()).toBe(1);
    for (let i = 1; i <= 10; i++) loop.tick(i * 16.7);
    expect(draws()).toBe(1);
    loop.invalidate();
    loop.tick(200);
    expect(draws()).toBe(2);
  });

  it('draws every frame while a lease is held', () => {
    const { loop, draws } = make();
    loop.tick(0);
    const release = loop.lease('reader');
    for (let i = 1; i <= 5; i++) loop.tick(i * 16.7);
    expect(draws()).toBe(6);
    release();
    loop.tick(100);
    expect(draws()).toBe(7);
    loop.tick(117);
    expect(draws()).toBe(7);
  });

  it('draws on the heartbeat when idle', () => {
    const { loop, draws } = make();
    loop.tick(0);
    for (let i = 1; i <= 70; i++) loop.tick(i * 16.7);
    expect(draws()).toBe(2);
  });

  it('runs phases in order and clamps dt', () => {
    const { loop } = make();
    const order: string[] = [];
    loop.onFrame('lights', () => order.push('lights'));
    loop.onFrame('input', () => order.push('input'));
    loop.onFrame('after-render', () => order.push('after'));
    loop.tick(0);
    loop.tick(5000);
    expect(order.slice(0, 3)).toEqual(['input', 'lights', 'after']);
    expect(loop.info.dt).toBeCloseTo(1 / 20, 10);
  });

  it('rejects an unknown phase', () => {
    const { loop } = make();
    expect(() => loop.onFrame('nope' as never, () => undefined)).toThrow(/unknown frame phase/);
  });
});
