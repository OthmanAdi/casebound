/**
 * Book dimensions in world units. One trim size for every title; only the thickness varies (SPEC S-BOOK-1..3).
 */

export interface BookDims {
  /** Board width from the outside of the spine to the fore-edge. */
  coverW: number;
  /** Board height. */
  coverH: number;
  /** Closed thickness including both boards. */
  thickness: number;
  /** Board thickness. */
  board: number;
  /** How far the boards overhang the pages at head, tail and fore-edge. */
  square: number;
  /** Radius of the hinge between spine and board. */
  hinge: number;
  pageW: number;
  pageH: number;
  /** Thickness of the text block. */
  blockT: number;
  /** Number of leaves (sheets). Each leaf has two pages. */
  leaves: number;
}

export interface DimsInput {
  /** Closed thickness in world units. Typical range 1.6 to 3.0. */
  thickness?: number;
  /** Page count. Sets the number of leaves. */
  pages?: number;
}

export const COVER_W = 13.52;
export const COVER_H = 20.13;
export const LEAF_THICKNESS = 0.0234 * 0.85;

export function makeDims(input: DimsInput = {}): BookDims {
  const pages = Math.max(8, Math.round(input.pages ?? 240));
  const leaves = Math.ceil(pages / 2);
  const board = 0.2;
  const thickness = input.thickness ?? Math.max(1.1, leaves * LEAF_THICKNESS + board * 2 + 0.1);
  const square = 0.335;
  const hinge = 0.26;
  return {
    coverW: COVER_W,
    coverH: COVER_H,
    thickness,
    board,
    square,
    hinge,
    pageW: COVER_W - square - hinge - board / 2,
    pageH: COVER_H - square * 2,
    blockT: thickness - board * 2,
    leaves,
  };
}
