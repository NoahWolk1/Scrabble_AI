# Scrabble AI

A web app that plays expert Scrabble against you, with optional camera-based board recognition and voice commands.

## Features

- **Play vs AI**: Expert-level Scrabble opponent (Easy / Medium / Hard)
- **Camera recognition**: Point your phone at a physical board to sync state (Scrabblecam API)
- **Voice commands**: "Suggest", "Pass", "Play" (when Safari supports it)
- **Mobile-first**: Responsive UI, touch targets, works on iPhone

## Running locally

```bash
npm install
cp .env.example .env.local   # optional: for Gemini board fix
npm run dev
```

Open http://localhost:5173

## Deploy to Vercel

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/Scrabble_AI.git
git push -u origin main
```

### 2. Connect to Vercel

1. Go to [vercel.com](https://vercel.com) and sign in (or use GitHub)
2. **Add New Project** → Import your `Scrabble_AI` repo
3. Vercel will detect Vite automatically. Click **Deploy**
4. After deploy, add env vars: **Settings** → **Environment Variables**
   - `GEMINI_API_KEY` – [Get a key](https://aistudio.google.com/app/apikey) for board recognition fix (OCR cleanup)
5. Redeploy after adding env vars

### 3. Environment variables

| Variable        | Required | Description                                      |
|-----------------|----------|--------------------------------------------------|
| `GEMINI_API_KEY`| No       | Board recognition fix (removes OCR errors). Get at [aistudio.google.com](https://aistudio.google.com/app/apikey) |

## Build for production

```bash
npm run build
npm run preview
```

## iPhone usage

- **Camera**: Use in Safari (not "Add to Home Screen" PWA) for reliable camera access
- **Board recognition**: Hold phone directly above board, good lighting, top-down view
- **Voice**: Web Speech API on Safari can be unreliable; use button fallbacks

## Tech stack

- React + Vite + TypeScript
- Tailwind CSS
- Zustand
- Scrabblecam API (board/rack recognition)
- Gemini API (board fix / OCR cleanup)
- ENABLE word list (local move generation)

## API proxies

- **Scrabblecam**: `api/scrabblecam/*` proxies to scrabblecam.com (CORS workaround)
- **Gemini**: `api/gemini/recognize-board` reads the board from an image; requires `GEMINI_API_KEY` in production
