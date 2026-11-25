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

/** Where the parts of a case lie on the strip its cover is painted on, as shares of the strip's width. */
export interface CaseAtlas {
  back: [number, number];
  spine: [number, number];
  front: [number, number];
  /** Width divided by height of the whole strip. */
  aspect: number;
  /** Half the arc of a hinge, as a share of the width. A hinge lies half in the spine's range and half in the board's. */
  hinge: number;
}

/**
 * The strip a case is painted on: back cover, spine, front cover, left to right, as a printer lays it out.
 * It needs nothing but the dimensions, so a cover can be painted where no book is built: on a page of stills.
 */
export function atlasOf(d: BookDims): CaseAtlas {
  const spineHalf = (d.thickness - d.board) / 2 - d.hinge;
  const arc = (d.hinge * Math.PI) / 2;
  const boardLen = d.coverW - d.hinge - d.board / 2;
  const total = 2 * (spineHalf + arc + boardLen);
  const boardShare = (boardLen + arc / 2) / total;
  return { back: [0, boardShare], spine: [boardShare, 1 - boardShare], front: [1 - boardShare, 1], aspect: total / d.coverH, hinge: arc / 2 / total };
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
