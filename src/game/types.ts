export interface Position {
  row: number;
  col: number;
}

export interface PlacedTile {
  letter: string;
  row: number;
  col: number;
  isBlank?: boolean;
}

export interface Move {
  tiles: PlacedTile[];
  word: string;
  score: number;
  direction: 'horizontal' | 'vertical';
  row: number;
  col: number;
}

export type Player = 'human' | 'ai';

export interface GameState {
  board: (string | null)[][];
  humanRack: string[];
  aiRack: string[];
  bag: string[];
  scores: { human: number; ai: number };
  currentPlayer: Player;
  isFirstMove: boolean;
  consecutivePasses: number;
  gameOver: boolean;
}
