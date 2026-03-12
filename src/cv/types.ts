export interface Point {
  x: number;
  y: number;
}

export interface BoardCorners {
  topLeft: Point;
  topRight: Point;
  bottomRight: Point;
  bottomLeft: Point;
}

export type GridCell = string | null; // letter or null if empty
