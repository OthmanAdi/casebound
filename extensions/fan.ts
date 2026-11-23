/**
 * Example extension: a different way to arrange the shelf. Books away from the centre swing out to the side
 * like a hand of cards instead of travelling straight up and down.
 *
 * A layout is a function the shelf calls for every book each frame. It gets the default pose and may change it.
 * This file exports the layout; pass it to `createShelf(engine, { layout: fan })`. The demo site does that when
 * the page is opened with `?layout=fan`.
 */
import { Euler, Quaternion } from 'three';
import type { ShelfLayout } from '../src/engine/shelf/shelf';

const lean = new Quaternion();
const euler = new Euler();

export const fan: ShelfLayout = (book, pose) => {
  // `offset` is 0 for the centred book, +1 for the one above it, -1 for the one below.
  const side = Math.max(-1.5, Math.min(1.5, book.offset));
  pose.position.x += side * 9;
  pose.position.y -= book.offset * 12;
  pose.position.z -= Math.abs(side) * 6;
  lean.setFromEuler(euler.set(0, -side * 0.6, -side * 0.35));
  pose.quaternion.premultiply(lean);
  pose.visible = Math.abs(book.offset) < 2.6;
};

export default fan;
