import { create } from 'zustand';
import { BoardState, createTileBag, drawTiles } from '../game/BoardState';
import { calculateMoveScore } from '../game/Scorer';
import { generateMoves } from '../game/MoveGenerator';
import { RACK_SIZE } from '../game/constants';

export type AIDifficulty = 'easy' | 'medium' | 'hard';
import type { PlacedTile, Player } from '../game/types';
import type { Trie } from '../game/Trie';
import {
  getMovesFromApi,
  boardToApiFormat,
  rackToApiFormat,
  parseScrabblecamMove,
} from '../cv/scrabblecamApi';

/** Validate that a move forms only legal words (main word + cross-words) per our dictionary. */
function isMoveValid(board: BoardState, tiles: PlacedTile[], trie: Trie): boolean {
  const testBoard = board.clone();
  for (const t of tiles) testBoard.set(t.row, t.col, t.letter);

  const main = testBoard.getMainWord(tiles);
  if (!main) return false;
  if (!trie.has(main.word)) return false;

  const direction = main.direction;
  const crossWords = testBoard.getCrossWords(tiles, direction);
  const uniqueCross = [...new Set(crossWords)];
  for (const w of uniqueCross) {
    if (w.length > 1 && !trie.has(w)) return false;
  }
  return true;
}

export interface LastAIMove {
  word: string;
  score: number;
  passed?: boolean;
  direction?: 'horizontal' | 'vertical';
  row?: number;
  col?: number;
}

interface GameStore {
  board: BoardState;
  humanRack: string[];
  aiRack: string[];
  bag: string[];
  scores: { human: number; ai: number };
  currentPlayer: Player;
  isFirstMove: boolean;
  consecutivePasses: number;
  gameOver: boolean;
  trie: Trie | null;
  pendingMove: PlacedTile[] | null;
  lastAIMove: LastAIMove | null;
  validateRack: boolean;
  loseTurnOnInvalidMove: boolean;
  aiDifficulty: AIDifficulty;
  status: string;
  _lastHumanTurnSnapshot: TurnSnapshot | null;

  initGame: (trie: Trie) => void;
  setValidateRack: (validate: boolean) => void;
  setLoseTurnOnInvalidMove: (value: boolean) => void;
  setAIDifficulty: (difficulty: AIDifficulty) => void;
  playHumanMove: (tiles: PlacedTile[]) => { success: boolean; message?: string };
  playAIMove: () => Promise<void>;
  passHuman: () => void;
  passAI: () => void;
  setPendingMove: (tiles: PlacedTile[] | null) => void;
  setTrie: (trie: Trie) => void;
  setBoardFromRecognition: (grid: (string | null)[][]) => void;
  setBoardCell: (row: number, col: number, letter: string | null) => void;
  setHumanRack: (rack: string[]) => void;
  applyHumanMoveFromBoardImage: (grid: (string | null)[][]) => { success: boolean; message?: string; lostTurn?: boolean };
  validateMove: (tiles: PlacedTile[]) => boolean;
  undoLastTurn: () => boolean;
}

interface TurnSnapshot {
  board: BoardState;
  humanRack: string[];
  aiRack: string[];
  bag: string[];
  scores: { human: number; ai: number };
  isFirstMove: boolean;
}

function applyMove(board: BoardState, tiles: PlacedTile[]): void {
  for (const t of tiles) {
    board.set(t.row, t.col, t.letter);
  }
}

export const useGameStore = create<GameStore>((set, get) => ({
  board: new BoardState(),
  humanRack: [],
  aiRack: [],
  bag: [],
  scores: { human: 0, ai: 0 },
  currentPlayer: 'human',
  isFirstMove: true,
  consecutivePasses: 0,
  gameOver: false,
  trie: null,
  pendingMove: null,
  lastAIMove: null,
  validateRack: false,
  loseTurnOnInvalidMove: false,
  aiDifficulty: 'medium',
  status: 'Loading dictionary...',
  _lastHumanTurnSnapshot: null,

  setTrie: (trie) => set({ trie }),
  setValidateRack: (validate) => set({ validateRack: validate }),
  setLoseTurnOnInvalidMove: (value) => set({ loseTurnOnInvalidMove: value }),
  setAIDifficulty: (aiDifficulty) => set({ aiDifficulty }),

  initGame: (trie) => {
    const bag = createTileBag();
    const { drawn: humanRack, remaining: afterHuman } = drawTiles(bag, RACK_SIZE);
    const { drawn: aiRack, remaining: bagAfter } = drawTiles(afterHuman, RACK_SIZE);
    const board = new BoardState();
    set({
      board,
      humanRack,
      aiRack,
      bag: bagAfter,
      scores: { human: 0, ai: 0 },
      currentPlayer: 'human',
      isFirstMove: true,
      consecutivePasses: 0,
      gameOver: false,
      trie,
      lastAIMove: null,
      status: 'Your turn. Play a word or pass.',
      _lastHumanTurnSnapshot: null,
    });
  },

  playHumanMove: (tiles) => {
    const { board, humanRack, isFirstMove, validateRack } = get();
    if (tiles.length === 0) return { success: false, message: 'No tiles to play' };

    const score = calculateMoveScore(board, tiles, isFirstMove);

    const rackCopy = [...humanRack];
    for (const t of tiles) {
      if (t.isBlank) {
        const blankIdx = rackCopy.indexOf(' ');
        if (blankIdx >= 0) rackCopy.splice(blankIdx, 1);
        else if (validateRack) return { success: false, message: 'Tile not in your rack' };
        else if (rackCopy.length > 0) rackCopy.splice(0, 1);
      } else {
        const idx = rackCopy.indexOf(t.letter);
        if (idx >= 0) rackCopy.splice(idx, 1);
        else if (validateRack) return { success: false, message: 'Tile not in your rack' };
        else {
          const blankIdx = rackCopy.indexOf(' ');
          if (blankIdx >= 0) rackCopy.splice(blankIdx, 1);
          else if (rackCopy.length > 0) rackCopy.splice(0, 1);
        }
      }
    }

    const { drawn, remaining } = drawTiles(get().bag, RACK_SIZE - rackCopy.length);
    const newBag = remaining;
    const finalRack = [...rackCopy, ...drawn];

    const newBoard = board.clone();
    applyMove(newBoard, tiles);

    set({
      board: newBoard,
      humanRack: finalRack,
      bag: newBag,
      scores: { ...get().scores, human: get().scores.human + score },
      currentPlayer: 'ai',
      isFirstMove: false,
      consecutivePasses: 0,
      pendingMove: null,
      lastAIMove: null,
      status: 'AI is thinking...',
      _lastHumanTurnSnapshot: null,
    });
    return { success: true };
  },

  playAIMove: async () => {
    const { board, aiRack, bag, trie, isFirstMove, aiDifficulty } = get();
    if (!trie) return;

    set({ status: 'AI thinking...' });

    const moveShape = { tiles: [] as PlacedTile[], word: '', score: 0, direction: 'horizontal' as 'horizontal' | 'vertical', row: 0, col: 0 };
    let bestMove: typeof moveShape | null = null;

    const pickMoveIndex = (len: number): number => {
      if (len === 0) return 0;
      if (aiDifficulty === 'hard') return 0;
      if (aiDifficulty === 'medium') return Math.floor(Math.random() * Math.min(5, len));
      const start = Math.min(3, len - 1);
      const poolSize = Math.min(7, Math.max(1, len - start));
      return start + Math.floor(Math.random() * poolSize);
    };

    try {
      const boardStr = boardToApiFormat(board.toArray());
      const rackStr = rackToApiFormat(aiRack);
      const res = await getMovesFromApi(rackStr, boardStr);
      if (res.status === 'OK' && res.moves?.length > 0) {
        const preferredIdx = pickMoveIndex(res.moves.length);
        const order = [
          ...Array.from({ length: res.moves.length }, (_, i) => (preferredIdx + i) % res.moves.length),
        ];
        for (const idx of order) {
          const parsed = parseScrabblecamMove(res.moves[idx], board.toArray());
          if (parsed && parsed.tiles.length > 0 && isMoveValid(board, parsed.tiles, trie)) {
            bestMove = {
              tiles: parsed.tiles,
              word: parsed.word,
              score: parsed.score,
              direction: parsed.tiles[0].row === parsed.tiles[parsed.tiles.length - 1].row ? 'horizontal' : 'vertical',
              row: parsed.row,
              col: parsed.col,
            };
            break;
          }
        }
      }
    } catch (err) {
      console.warn('Scrabblecam API failed, falling back to local AI:', err);
    }

    if (!bestMove) {
      const moves = generateMoves(board, aiRack, trie, isFirstMove);
      const sorted = moves.sort((a, b) => b.score - a.score);
      const preferredIdx = pickMoveIndex(sorted.length);
      for (let i = 0; i < sorted.length; i++) {
        const picked = sorted[(preferredIdx + i) % sorted.length];
        if (picked && isMoveValid(board, picked.tiles, trie)) {
          bestMove = {
            tiles: picked.tiles,
            word: picked.word,
            score: picked.score,
            direction: picked.direction,
            row: picked.row,
            col: picked.col,
          };
          break;
        }
      }
    }

    if (!bestMove) {
      get().passAI();
      return;
    }

    const rackCopy = [...aiRack];
    for (const t of bestMove.tiles) {
      const idx = rackCopy.indexOf(t.letter);
      const blankIdx = rackCopy.indexOf(' ');
      if (idx >= 0) rackCopy.splice(idx, 1);
      else if (blankIdx >= 0) rackCopy.splice(blankIdx, 1);
    }
    const { drawn, remaining } = drawTiles(bag, RACK_SIZE - rackCopy.length);

    const newBoard = board.clone();
    applyMove(newBoard, bestMove.tiles);

    const { humanRack } = get();
    set({
      board: newBoard,
      aiRack: [...rackCopy, ...drawn],
      bag: remaining,
      scores: { ...get().scores, ai: get().scores.ai + bestMove!.score },
      currentPlayer: 'human',
      isFirstMove: false,
      consecutivePasses: 0,
      lastAIMove: {
        word: bestMove!.word,
        score: bestMove!.score,
        direction: bestMove!.direction,
        row: bestMove!.row,
        col: bestMove!.col,
      },
      status: `AI played "${bestMove!.word}" for ${bestMove!.score} points. Your turn.`,
      _lastHumanTurnSnapshot: {
        board: newBoard.clone(),
        humanRack: [...humanRack],
        aiRack: [...rackCopy, ...drawn],
        bag: [...remaining],
        scores: { ...get().scores, ai: get().scores.ai + bestMove!.score },
        isFirstMove: false,
      },
    });
  },

  passHuman: () => {
    const { consecutivePasses } = get();
    const newPasses = consecutivePasses + 1;
    const gameOver = newPasses >= 2;
    set({
      currentPlayer: 'ai',
      consecutivePasses: newPasses,
      gameOver,
      status: gameOver ? 'Game over (both passed).' : 'You passed. AI thinking...',
    });
  },

  passAI: () => {
    const { consecutivePasses, board, humanRack, aiRack, bag, scores } = get();
    const newPasses = consecutivePasses + 1;
    const gameOver = newPasses >= 2;
    set({
      currentPlayer: 'human',
      consecutivePasses: newPasses,
      gameOver,
      lastAIMove: { word: '', score: 0, passed: true },
      status: gameOver ? 'Game over (both passed).' : 'AI passed. Your turn.',
      _lastHumanTurnSnapshot: {
        board: board.clone(),
        humanRack: [...humanRack],
        aiRack: [...aiRack],
        bag: [...bag],
        scores: { ...scores },
        isFirstMove: false,
      },
    });
  },

  setPendingMove: (tiles) => set({ pendingMove: tiles }),

  setBoardFromRecognition: (grid) => {
    const normalized = grid.map(row =>
      row.map(cell =>
        cell === ' ' ? null : cell && /^[A-Z]$/.test(cell) ? cell : null
      )
    );
    set({
      board: new BoardState(normalized),
      isFirstMove: normalized.every(r => r.every(c => !c)),
      status: 'Board updated from camera.',
    });
  },

  setBoardCell: (row, col, letter) => {
    const { board } = get();
    set({
      board: board.setCell(row, col, letter),
      status: 'Board updated.',
    });
  },

  setHumanRack: (rack) => {
    set({
      humanRack: rack.slice(0, RACK_SIZE),
      status: 'Rack updated from image.',
    });
  },

  applyHumanMoveFromBoardImage: (newGrid) => {
    const { board, humanRack, trie, validateRack, loseTurnOnInvalidMove } = get();
    if (!trie) return { success: false, message: 'Dictionary not loaded' };

    const currentArr = board.toArray();
    const rawTiles: { letter: string; row: number; col: number }[] = [];
    for (let r = 0; r < 15; r++) {
      for (let c = 0; c < 15; c++) {
        const curr = currentArr[r]?.[c];
        const next = newGrid[r]?.[c];
        if (!curr && next && /^[A-Z]$/.test(next)) {
          rawTiles.push({ letter: next, row: r, col: c });
        }
      }
    }

    if (rawTiles.length === 0) {
      return { success: false, message: 'No new tiles found. Make sure you placed tiles on the board.' };
    }

    const rackCount: Record<string, number> = {};
    for (const c of humanRack) {
      const k = c === ' ' ? ' ' : c;
      rackCount[k] = (rackCount[k] ?? 0) + 1;
    }
    const newTiles: PlacedTile[] = [];
    let rackValid = true;
    for (const t of rawTiles) {
      if ((rackCount[t.letter] ?? 0) > 0) {
        rackCount[t.letter]!--;
        newTiles.push({ ...t });
      } else if ((rackCount[' '] ?? 0) > 0) {
        rackCount[' ']!--;
        newTiles.push({ ...t, isBlank: true });
      } else {
        rackValid = false;
        newTiles.push({ ...t }); // allow for word check; reject/forfeit below if needed
      }
    }

    const doForfeit = () => {
      set({
        currentPlayer: 'ai',
        status: 'Invalid move—you lost your turn. AI thinking...',
      });
      return { success: true, lostTurn: true } as const;
    };

    // Rack invalid (played tiles not in rack)
    if (!rackValid) {
      if (loseTurnOnInvalidMove) return doForfeit();
      if (validateRack) return { success: false, message: 'Tiles played are not in your rack.' };
    }

    // Validate words (main + connectors) before applying
    const moveValid = get().validateMove(newTiles);
    if (!moveValid && loseTurnOnInvalidMove) return doForfeit();
    if (!moveValid) {
      return { success: false, message: 'Invalid move. All words must be in the dictionary.' };
    }

    const result = get().playHumanMove(newTiles);
    return result.success ? { success: true } : { success: false, message: result.message ?? 'Invalid move' };
  },

  validateMove: (tiles) => {
    const { board, trie } = get();
    return trie ? isMoveValid(board, tiles, trie) : false;
  },

  undoLastTurn: () => {
    const snapshot = get()._lastHumanTurnSnapshot;
    if (!snapshot) return false;
    set({
      board: snapshot.board.clone(),
      humanRack: [...snapshot.humanRack],
      aiRack: [...snapshot.aiRack],
      bag: [...snapshot.bag],
      scores: { ...snapshot.scores },
      isFirstMove: snapshot.isFirstMove,
      currentPlayer: 'human',
      lastAIMove: null,
      gameOver: false,
      consecutivePasses: 0,
      status: 'Your turn. Recapture to try again.',
    });
    return true;
  },
}));
