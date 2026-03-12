// Scrabble board constants
export const BOARD_SIZE = 15;

// Premium square types
export type SquareType = 
  | 'normal' 
  | 'double_letter' 
  | 'triple_letter' 
  | 'double_word' 
  | 'triple_word' 
  | 'center';

// Standard Scrabble premium square layout (0-indexed)
export const PREMIUM_SQUARES: Record<string, SquareType> = {
  '7,7': 'center',
  // Double word - horizontal and vertical stripes
  '0,0': 'triple_word', '0,7': 'triple_word', '0,14': 'triple_word',
  '7,0': 'triple_word', '7,14': 'triple_word',
  '14,0': 'triple_word', '14,7': 'triple_word', '14,14': 'triple_word',
  // Double word - diagonal corners of center
  '1,1': 'double_word', '2,2': 'double_word', '3,3': 'double_word', '4,4': 'double_word',
  '10,10': 'double_word', '11,11': 'double_word', '12,12': 'double_word', '13,13': 'double_word',
  '1,13': 'double_word', '2,12': 'double_word', '3,11': 'double_word', '4,10': 'double_word',
  '10,4': 'double_word', '11,3': 'double_word', '12,2': 'double_word', '13,1': 'double_word',
  // Triple letter
  '1,5': 'triple_letter', '1,9': 'triple_letter',
  '5,1': 'triple_letter', '5,5': 'triple_letter', '5,9': 'triple_letter', '5,13': 'triple_letter',
  '9,1': 'triple_letter', '9,5': 'triple_letter', '9,9': 'triple_letter', '9,13': 'triple_letter',
  '13,5': 'triple_letter', '13,9': 'triple_letter',
  // Double letter
  '0,3': 'double_letter', '0,11': 'double_letter',
  '2,6': 'double_letter', '2,8': 'double_letter',
  '3,0': 'double_letter', '3,7': 'double_letter', '3,14': 'double_letter',
  '6,2': 'double_letter', '6,6': 'double_letter', '6,8': 'double_letter', '6,12': 'double_letter',
  '7,3': 'double_letter', '7,11': 'double_letter',
  '8,2': 'double_letter', '8,6': 'double_letter', '8,8': 'double_letter', '8,12': 'double_letter',
  '11,0': 'double_letter', '11,7': 'double_letter', '11,14': 'double_letter',
  '12,6': 'double_letter', '12,8': 'double_letter',
  '14,3': 'double_letter', '14,11': 'double_letter',
};

// Tile distribution: letter -> count
export const TILE_DISTRIBUTION: Record<string, number> = {
  ' ': 2,  // blank
  'A': 9, 'B': 2, 'C': 2, 'D': 4, 'E': 12, 'F': 2, 'G': 3, 'H': 2,
  'I': 9, 'J': 1, 'K': 1, 'L': 4, 'M': 2, 'N': 6, 'O': 8, 'P': 2,
  'Q': 1, 'R': 6, 'S': 4, 'T': 6, 'U': 4, 'V': 2, 'W': 2, 'X': 1,
  'Y': 2, 'Z': 1
};

// Tile point values
export const TILE_VALUES: Record<string, number> = {
  ' ': 0, 'A': 1, 'B': 3, 'C': 3, 'D': 2, 'E': 1, 'F': 4, 'G': 2,
  'H': 4, 'I': 1, 'J': 8, 'K': 5, 'L': 1, 'M': 3, 'N': 1, 'O': 1,
  'P': 3, 'Q': 10, 'R': 1, 'S': 1, 'T': 1, 'U': 1, 'V': 4, 'W': 4,
  'X': 8, 'Y': 4, 'Z': 10
};

export const RACK_SIZE = 7;
export const BINGO_BONUS = 50;
