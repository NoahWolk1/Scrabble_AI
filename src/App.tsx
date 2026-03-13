import { useEffect, useState, useRef, useCallback } from 'react';
import { Board } from './components/Board';
import { LetterPicker } from './components/LetterPicker';
import { Rack } from './components/Rack';
import { GameControls } from './components/GameControls';
import { CameraView, type CameraViewRef } from './components/CameraView';
import { VoiceCaptureTrigger } from './components/VoiceCaptureTrigger';
import { useGameStore } from './store/gameStore';
import { useCamera } from './hooks/useCamera';
import { speak } from './hooks/useSpeechSynthesis';
import { loadDictionary } from './game/loadDictionary';
import { recognizeBoard } from './cv/BoardRecognizer';
import { recognizeRackFromImage } from './cv/scrabblecamApi';
import { prepareImageForRecognition } from './cv/imageUtils';

function App() {
  const {
    board,
    humanRack,
    aiRack,
    scores,
    trie,
    currentPlayer: _currentPlayer,
    gameOver,
    initGame,
    playAIMove,
    setTrie,
    lastAIMove,
    validateRack,
    setValidateRack,
    setBoardCell,
    aiDifficulty,
    setAIDifficulty,
  } = useGameStore();
  const { stream, error, loading, startCamera, stopCamera } = useCamera();
  const [recognizing, setRecognizing] = useState(false);
  const [editingCell, setEditingCell] = useState<{ row: number; col: number } | null>(null);
  const [useGeminiFix, setUseGeminiFix] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const setBoardFromRecognition = useGameStore((s) => s.setBoardFromRecognition);
  const setHumanRack = useGameStore((s) => s.setHumanRack);
  const applyHumanMoveFromBoardImage = useGameStore((s) => s.applyHumanMoveFromBoardImage);
  const lastAIMoveRef = useRef<unknown>(null);
  const cameraRef = useRef<CameraViewRef>(null);

  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((msg: string) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToast(msg);
    toastTimeoutRef.current = setTimeout(() => {
      setToast(null);
      toastTimeoutRef.current = null;
    }, 5000);
  }, []);

  const handleBoardImage = useCallback(
    async (file: Blob) => {
      setRecognizing(true);
      setToast(null);
      // Yield to browser so video can render next frame before we block
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      try {
        const prepared = await prepareImageForRecognition(file);
        const grid = await recognizeBoard(prepared, { useGeminiFix });
        const isHumanTurn = useGameStore.getState().currentPlayer === 'human';
        if (isHumanTurn) {
          const result = applyHumanMoveFromBoardImage(grid);
          if (!result.success) {
            showToast(result.message ?? 'Recognition failed');
          }
        } else {
          setBoardFromRecognition(grid);
        }
      } catch (err) {
        console.error('Recognition failed:', err);
        const msg = err instanceof Error ? err.message : 'Board recognition failed.';
        showToast(msg);
      } finally {
        setRecognizing(false);
      }
    },
    [applyHumanMoveFromBoardImage, setBoardFromRecognition, useGeminiFix, showToast]
  );

  const handleRackImage = useCallback(
    async (file: Blob) => {
      setRecognizing(true);
      setToast(null);
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      try {
        const prepared = await prepareImageForRecognition(file);
        const res = await recognizeRackFromImage(prepared);
        if (res.status === 'OK' && res.rack) {
          const rack = res.rack.split(',').map((c) => (c.trim() === '?' ? ' ' : c.trim().toUpperCase()));
          setHumanRack(rack);
        } else {
          showToast(res.message ?? 'Rack recognition failed');
        }
      } catch (err) {
        console.error('Rack recognition failed:', err);
        showToast('Rack recognition failed. Try a clear photo of your tiles.');
      } finally {
        setRecognizing(false);
      }
    },
    [setHumanRack, showToast]
  );

  useEffect(() => {
    loadDictionary().then((dict) => {
      setTrie(dict);
      initGame(dict);
    });
  }, [initGame, setTrie]);

  useEffect(() => {
    if (_currentPlayer === 'ai' && !gameOver && trie) {
      const timer = setTimeout(() => playAIMove(), 500);
      return () => clearTimeout(timer);
    }
  }, [_currentPlayer, gameOver, trie, playAIMove]);

  const humanTurnRef = useRef(false);
  useEffect(() => {
    if (lastAIMove && lastAIMove !== lastAIMoveRef.current) {
      lastAIMoveRef.current = lastAIMove;
      if (lastAIMove.passed) {
        speak('I pass. Your turn.');
      } else {
        const letters = lastAIMove.word.split('').join(' ');
        speak(`I play ${letters} for ${lastAIMove.score} points. Place my tiles on the board, then make your move and capture. Your turn.`);
      }
    }
  }, [lastAIMove]);

  useEffect(() => {
    if (_currentPlayer === 'human' && !gameOver && humanTurnRef.current === false) {
      humanTurnRef.current = true;
      if (humanRack.length > 0) {
        const letters = humanRack.map((c) => (c === ' ' ? 'blank' : c)).join(', ');
        speak(`Your letters are ${letters}.`);
      }
    } else if (_currentPlayer !== 'human') {
      humanTurnRef.current = false;
    }
  }, [_currentPlayer, gameOver, humanRack]);

  useEffect(() => {
    if (_currentPlayer === 'human' && !gameOver && !stream) {
      startCamera();
    } else if (_currentPlayer !== 'human' || gameOver) {
      stopCamera();
    }
  }, [_currentPlayer, gameOver, startCamera, stopCamera, stream]);

  const scrollClass =
    'h-full min-h-0 overflow-y-auto overflow-x-hidden overscroll-y-none touch-pan-y bg-stone-100 dark:bg-stone-900';

  if (!trie) {
    return (
      <div className={`${scrollClass} flex items-center justify-center`}>
        <p className="text-lg">Loading dictionary...</p>
      </div>
    );
  }

  return (
    <div className={`${scrollClass} pb-24`}>
      <div className="max-w-xl mx-auto px-4">
        <h1 className="text-2xl font-bold text-center py-4 text-stone-800 dark:text-stone-100">
          Scrabble AI
        </h1>

        <div className="space-y-4">
          {/* Game section */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-lg font-medium">
              <span>You: {scores.human}</span>
              <span className="ml-4">AI: {scores.ai}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-stone-500 dark:text-stone-400">Difficulty:</span>
              <select
                value={aiDifficulty}
                onChange={(e) => setAIDifficulty(e.target.value as 'easy' | 'medium' | 'hard')}
                className="text-sm rounded-lg border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-800 px-2 py-1"
              >
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </div>
          </div>

          <div className="flex justify-center overflow-x-auto -mx-4 px-4">
            <Board
              board={board}
              onCellClick={(row, col) => setEditingCell({ row, col })}
            />
          </div>

          {humanRack.length > 0 && (
            <div className="space-y-1">
              <p className="text-sm font-medium text-stone-600 dark:text-stone-400">Your letters</p>
              <Rack letters={humanRack} />
            </div>
          )}

          {lastAIMove && !lastAIMove.passed && (
            <div className="rounded-lg bg-amber-50 dark:bg-amber-900/30 px-4 py-3 border border-amber-200 dark:border-amber-800">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                AI played <span className="font-bold">{lastAIMove.word}</span> for {lastAIMove.score} points
              </p>
            </div>
          )}

          {editingCell && (
            <>
              <div
                className="fixed inset-0 bg-black/40 z-40"
                aria-hidden
                onClick={() => setEditingCell(null)}
              />
              <LetterPicker
                onSelect={(letter) => {
                  setBoardCell(editingCell.row, editingCell.col, letter);
                  setEditingCell(null);
                }}
                onClose={() => setEditingCell(null)}
              />
            </>
          )}

          <details className="group">
            <summary className="cursor-pointer text-sm text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-300 list-none">
              Spoiler: AI rack
            </summary>
            <div className="mt-2 pl-0">
              <Rack letters={aiRack} label="AI rack" />
            </div>
          </details>

          <div className="space-y-4">
            <GameControls onError={showToast} />
          </div>

          {gameOver && (
            <div className="text-center py-4">
              <p className="text-xl font-bold">
                {scores.human > scores.ai
                  ? 'You win!'
                  : scores.ai > scores.human
                    ? 'AI wins!'
                    : "It's a tie!"}
              </p>
              <button
                type="button"
                onClick={() => initGame(trie)}
                className="mt-4 py-3 px-6 bg-green-600 hover:bg-green-700 text-white rounded-xl font-medium min-h-[48px] touch-manipulation"
              >
                New game
              </button>
            </div>
          )}

          {/* Camera section */}
          <div className="border-t border-stone-300 dark:border-stone-600 pt-4 mt-6">
            <div className="flex flex-wrap gap-4 py-2">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={validateRack}
                  onChange={(e) => setValidateRack(e.target.checked)}
                  className="rounded"
                />
                <span>Validate rack</span>
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={useGeminiFix}
                  onChange={(e) => setUseGeminiFix(e.target.checked)}
                  className="rounded"
                />
                <span>AI fix (Gemini)</span>
              </label>
            </div>
            {!stream ? (
              <div className="space-y-4">
                <p className="text-stone-600 dark:text-stone-400 text-center">
                  {_currentPlayer === 'human' && !gameOver
                    ? "Your turn. Capture your rack first if needed, then make your move on the board and capture."
                    : "Point at the board or upload a photo. Good lighting, top-down view."}
                </p>
                <div className="flex flex-col gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      if (navigator.vibrate) navigator.vibrate(50);
                      startCamera();
                    }}
                    disabled={loading}
                    className="w-full py-4 px-6 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-xl font-medium min-h-[56px] touch-manipulation"
                  >
                    {loading ? 'Starting camera...' : 'Start camera'}
                  </button>
                  <label className="w-full py-4 px-6 bg-stone-300 dark:bg-stone-600 hover:bg-stone-400 dark:hover:bg-stone-500 text-stone-900 dark:text-white rounded-xl font-medium min-h-[56px] touch-manipulation flex items-center justify-center cursor-pointer">
                    Upload board image
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="sr-only"
                      disabled={recognizing}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          e.target.value = '';
                          handleBoardImage(file);
                        }
                      }}
                    />
                  </label>
                  <label className="w-full py-3 px-6 bg-stone-200 dark:bg-stone-700 hover:bg-stone-300 dark:hover:bg-stone-600 text-stone-800 dark:text-stone-200 rounded-xl font-medium min-h-[48px] touch-manipulation flex items-center justify-center cursor-pointer border border-stone-300 dark:border-stone-600">
                    Upload rack image
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="sr-only"
                      disabled={recognizing}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          e.target.value = '';
                          handleRackImage(file);
                        }
                      }}
                    />
                  </label>
                </div>
                {error && (
                  <p className="text-red-600 dark:text-red-400 text-center text-sm">{error}</p>
                )}
              </div>
            ) : (
              <>
                <div className="flex flex-col sm:flex-row gap-2">
                  <VoiceCaptureTrigger
                    active={_currentPlayer === 'human' && !gameOver && !recognizing}
                    onCapture={() => cameraRef.current?.capture()}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (navigator.vibrate) navigator.vibrate(30);
                      cameraRef.current?.capture();
                    }}
                    className="flex-1 py-3 px-4 rounded-xl font-medium touch-manipulation bg-amber-600 hover:bg-amber-700 text-white min-h-[48px]"
                  >
                    Capture board
                  </button>
                </div>
                <CameraView
                  ref={cameraRef}
                  stream={stream}
                  onCapture={handleBoardImage}
                />
                <div className="flex gap-2">
                  <label className="flex-1 py-3 px-4 bg-stone-300 dark:bg-stone-600 hover:bg-stone-400 dark:hover:bg-stone-500 rounded-xl font-medium text-center cursor-pointer touch-manipulation">
                    Upload board
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="sr-only"
                      disabled={recognizing}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          e.target.value = '';
                          handleBoardImage(file);
                        }
                      }}
                    />
                  </label>
                  <label className="flex-1 py-3 px-4 bg-stone-200 dark:bg-stone-700 hover:bg-stone-300 dark:hover:bg-stone-600 rounded-xl font-medium text-center cursor-pointer touch-manipulation">
                    Upload rack
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="sr-only"
                      disabled={recognizing}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          e.target.value = '';
                          handleRackImage(file);
                        }
                      }}
                    />
                  </label>
                </div>
                {_currentPlayer === 'human' && !gameOver && !recognizing && (
                  <p className="text-stone-500 text-center text-sm">
                    Make your move, then say &quot;your turn&quot; or &quot;capture&quot;—or tap Capture board. Voice not working? Add <code className="bg-stone-200 dark:bg-stone-700 px-1 rounded">?debug=1</code> to the URL and check the console.
                  </p>
                )}
              </>
            )}
          </div>

          {recognizing && (
            <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-4 rounded-2xl bg-stone-800 px-8 py-6 shadow-xl">
                <div className="h-10 w-10 animate-spin rounded-full border-4 border-amber-500 border-t-transparent" />
                <p className="text-lg font-medium text-white">Recognizing...</p>
                <p className="text-sm text-stone-400">This may take a few seconds</p>
              </div>
            </div>
          )}

          {toast && (
            <div
              role="alert"
              className="fixed bottom-20 left-4 right-4 z-50 mx-auto max-w-xl px-4 py-3 bg-amber-600 text-white rounded-xl shadow-lg flex items-center justify-between gap-3"
            >
              <p className="text-sm flex-1">{toast}</p>
              <button
                type="button"
                onClick={() => setToast(null)}
                className="shrink-0 px-3 py-1 bg-white/20 rounded-lg text-sm font-medium touch-manipulation"
              >
                Dismiss
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
