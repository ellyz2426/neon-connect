import {
  World,
  createSystem,
  PanelUI,
  PanelDocument,
  UIKitDocument,
  UIKit,
  RayInteractable,
  Pressed,
  Hovered,
  Follower,
  InputComponent,
  AudioSource,
  AudioUtils,
} from '@iwsdk/core';
import {
  BoxGeometry,
  MeshStandardMaterial,
  Mesh,
  TorusGeometry,
  CylinderGeometry,
  SphereGeometry,
  Color,
  Vector2,
  Vector3,
  Raycaster,
  Group,
  PlaneGeometry,
  Object3D,
  BufferGeometry,
  Float32BufferAttribute,
  PointsMaterial,
  Points,
  Line,
  LineBasicMaterial,
  AdditiveBlending,
  CatmullRomCurve3,
  TubeGeometry,
  ConeGeometry,
  DoubleSide,
  ShaderMaterial,
} from 'three';

// ─── Constants ──────────────────────────────────────────────────────
const COLS_STD = 7, ROWS_STD = 6, CONNECT_STD = 4;
const COLS_BIG = 9, ROWS_BIG = 7, CONNECT_BIG = 5;
const CELL = 0.22; // cell spacing
const DISC_R = 0.09, DISC_TUBE = 0.025;
const DROP_SPEED = 4.0; // units/sec
const BOARD_Y = 1.1;
const BOARD_Z = -1.8;

// ─── Types ──────────────────────────────────────────────────────────
type CellVal = 0 | 1 | 2;
type GameMode = 'classic' | 'timed' | 'blitz' | 'popout' | 'five' | 'daily' | 'practice' | 'versus';
type Difficulty = 'easy' | 'medium' | 'hard';
type GamePhase = 'menu' | 'modeselect' | 'difficulty' | 'playing' | 'paused' | 'gameover' |
  'achievements' | 'stats' | 'leaderboard' | 'settings' | 'help' | 'skins';

interface DropAnim { col: number; row: number; player: CellVal; mesh: Mesh; targetY: number; }
interface WinCell { col: number; row: number; }
interface RoundStats { moves: number; timeMs: number; winner: 0 | 1 | 2; mode: GameMode; difficulty: Difficulty; }

// ─── Seeded PRNG (for daily challenges) ─────────────────────────────
function mulberry32(seed: number) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function dateSeed(): number {
  const d = new Date(); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

// ─── Persistence ────────────────────────────────────────────────────
interface SaveData {
  gamesPlayed: number; wins: number; losses: number; draws: number;
  totalMoves: number; fastestWinMs: number; perfectGames: number;
  dailyCompleted: number; bestStreak: number; currentStreak: number;
  xp: number; level: number;
  achievementsUnlocked: string[];
  equippedSkin: number;
  masterVol: number; sfxVol: number; musicVol: number;
  theme: number;
  leaderboard: { name: string; score: number; mode: string; }[];
  modeStats: Record<string, { played: number; wins: number; }>;
}

function defaultSave(): SaveData {
  return {
    gamesPlayed: 0, wins: 0, losses: 0, draws: 0,
    totalMoves: 0, fastestWinMs: Infinity, perfectGames: 0,
    dailyCompleted: 0, bestStreak: 0, currentStreak: 0,
    xp: 0, level: 1, achievementsUnlocked: [], equippedSkin: 0,
    masterVol: 100, sfxVol: 100, musicVol: 100, theme: 0,
    leaderboard: [], modeStats: {},
  };
}

let save: SaveData;
function loadSave(): SaveData {
  try { const s = localStorage.getItem('neon-connect-save');
    return s ? { ...defaultSave(), ...JSON.parse(s) } : defaultSave();
  } catch { return defaultSave(); }
}
function writeSave() { try { localStorage.setItem('neon-connect-save', JSON.stringify(save)); } catch {} }

// ─── Achievement Definitions ────────────────────────────────────────
interface AchDef { id: string; name: string; desc: string; check: () => boolean; }
const ACHIEVEMENTS: AchDef[] = [
  { id: 'first_win', name: 'First Blood', desc: 'Win your first game', check: () => save.wins >= 1 },
  { id: 'win_5', name: 'Getting Started', desc: 'Win 5 games', check: () => save.wins >= 5 },
  { id: 'win_10', name: 'Competitor', desc: 'Win 10 games', check: () => save.wins >= 10 },
  { id: 'win_25', name: 'Veteran', desc: 'Win 25 games', check: () => save.wins >= 25 },
  { id: 'win_50', name: 'Champion', desc: 'Win 50 games', check: () => save.wins >= 50 },
  { id: 'win_100', name: 'Legend', desc: 'Win 100 games', check: () => save.wins >= 100 },
  { id: 'streak_3', name: 'Hot Streak', desc: '3 wins in a row', check: () => save.bestStreak >= 3 },
  { id: 'streak_5', name: 'On Fire', desc: '5 wins in a row', check: () => save.bestStreak >= 5 },
  { id: 'streak_10', name: 'Unstoppable', desc: '10 wins in a row', check: () => save.bestStreak >= 10 },
  { id: 'play_10', name: 'Dedicated', desc: 'Play 10 games', check: () => save.gamesPlayed >= 10 },
  { id: 'play_25', name: 'Committed', desc: 'Play 25 games', check: () => save.gamesPlayed >= 25 },
  { id: 'play_50', name: 'Enthusiast', desc: 'Play 50 games', check: () => save.gamesPlayed >= 50 },
  { id: 'fast_win', name: 'Speed Demon', desc: 'Win in under 30 seconds', check: () => save.fastestWinMs < 30000 },
  { id: 'fast_win_15', name: 'Lightning', desc: 'Win in under 15 seconds', check: () => save.fastestWinMs < 15000 },
  { id: 'perfect_1', name: 'Flawless', desc: 'Win a perfect game', check: () => save.perfectGames >= 1 },
  { id: 'perfect_5', name: 'Perfectionist', desc: '5 perfect games', check: () => save.perfectGames >= 5 },
  { id: 'daily_1', name: 'Daily Player', desc: 'Complete a daily challenge', check: () => save.dailyCompleted >= 1 },
  { id: 'daily_5', name: 'Regular', desc: 'Complete 5 daily challenges', check: () => save.dailyCompleted >= 5 },
  { id: 'daily_10', name: 'Devotee', desc: 'Complete 10 daily challenges', check: () => save.dailyCompleted >= 10 },
  { id: 'level_5', name: 'Rising Star', desc: 'Reach level 5', check: () => save.level >= 5 },
  { id: 'level_10', name: 'Pro Player', desc: 'Reach level 10', check: () => save.level >= 10 },
  { id: 'level_15', name: 'Elite', desc: 'Reach level 15', check: () => save.level >= 15 },
  { id: 'level_20', name: 'Master', desc: 'Reach level 20', check: () => save.level >= 20 },
  { id: 'level_30', name: 'Grandmaster', desc: 'Reach level 30', check: () => save.level >= 30 },
  { id: 'xp_1000', name: 'XP Hunter', desc: 'Earn 1000 total XP', check: () => save.xp >= 1000 },
  { id: 'xp_5000', name: 'XP Collector', desc: 'Earn 5000 total XP', check: () => save.xp >= 5000 },
  { id: 'mode_classic', name: 'Classic Player', desc: 'Win in Classic mode', check: () => (save.modeStats['classic']?.wins ?? 0) >= 1 },
  { id: 'mode_timed', name: 'Time Keeper', desc: 'Win in Timed mode', check: () => (save.modeStats['timed']?.wins ?? 0) >= 1 },
  { id: 'mode_blitz', name: 'Blitz Master', desc: 'Win in Blitz mode', check: () => (save.modeStats['blitz']?.wins ?? 0) >= 1 },
  { id: 'mode_popout', name: 'Pop Star', desc: 'Win in Pop Out mode', check: () => (save.modeStats['popout']?.wins ?? 0) >= 1 },
  { id: 'mode_five', name: 'Five Alive', desc: 'Win in Five in Row', check: () => (save.modeStats['five']?.wins ?? 0) >= 1 },
  { id: 'mode_practice', name: 'Trained Up', desc: 'Win in Practice mode', check: () => (save.modeStats['practice']?.wins ?? 0) >= 1 },
  { id: 'mode_versus', name: 'Head to Head', desc: 'Play a Versus game', check: () => (save.modeStats['versus']?.played ?? 0) >= 1 },
  { id: 'all_modes', name: 'Well Rounded', desc: 'Play every mode', check: () => ['classic','timed','blitz','popout','five','daily','practice','versus'].every(m => (save.modeStats[m]?.played ?? 0) > 0) },
  { id: 'moves_100', name: 'Mover', desc: 'Make 100 total moves', check: () => save.totalMoves >= 100 },
  { id: 'moves_500', name: 'Strategist', desc: 'Make 500 total moves', check: () => save.totalMoves >= 500 },
  { id: 'moves_1000', name: 'Tactician', desc: 'Make 1000 total moves', check: () => save.totalMoves >= 1000 },
  { id: 'skin_unlock', name: 'Fashionista', desc: 'Unlock a disc skin', check: () => save.achievementsUnlocked.length >= 5 },
  { id: 'easy_10', name: 'Easy Street', desc: 'Win 10 games on Easy', check: () => save.wins >= 10 },
  { id: 'hard_win', name: 'Brave', desc: 'Win on Hard difficulty', check: () => save.wins >= 1 },
  { id: 'hard_5', name: 'Hard Hitter', desc: 'Win 5 on Hard', check: () => save.wins >= 5 },
  { id: 'draw_1', name: 'Stalemate', desc: 'Draw a game', check: () => save.draws >= 1 },
  { id: 'winrate_70', name: 'Dominant', desc: '70% win rate (10+ games)', check: () => save.gamesPlayed >= 10 && save.wins / save.gamesPlayed >= 0.7 },
  { id: 'winrate_90', name: 'Invincible', desc: '90% win rate (20+ games)', check: () => save.gamesPlayed >= 20 && save.wins / save.gamesPlayed >= 0.9 },
  { id: 'lb_entry', name: 'On the Board', desc: 'Get a leaderboard score', check: () => save.leaderboard.length >= 1 },
  { id: 'lb_top3', name: 'Podium', desc: 'Top 3 leaderboard', check: () => save.leaderboard.length >= 3 },
  { id: 'comeback', name: 'Comeback Kid', desc: 'Win after losing 2 in a row', check: () => save.wins >= 3 },
  { id: 'play_1', name: 'Welcome', desc: 'Play your first game', check: () => save.gamesPlayed >= 1 },
  { id: 'play_100', name: 'Centurion', desc: 'Play 100 games', check: () => save.gamesPlayed >= 100 },
  { id: 'level_50', name: 'Transcendent', desc: 'Reach level 50', check: () => save.level >= 50 },
  { id: 'skin_all', name: 'Collector', desc: 'Unlock all disc skins', check: () => Array.from({length: 10}, (_, i) => skinUnlocked(i)).every(u => u) },
  { id: 'under_10', name: 'Efficiency', desc: 'Win in under 10 moves', check: () => save.wins >= 1 },
  { id: 'modes_3', name: 'Explorer', desc: 'Play 3 different modes', check: () => Object.keys(save.modeStats).filter(m => (save.modeStats[m]?.played ?? 0) > 0).length >= 3 },
  { id: 'xp_10000', name: 'XP Legend', desc: 'Earn 10000 total XP', check: () => save.xp >= 10000 },
  { id: 'loss_0', name: 'Undefeated', desc: 'Win 10 games without a loss', check: () => save.currentStreak >= 10 && save.losses === 0 },
  { id: 'combo_3', name: 'Threat Maker', desc: '3-combo threat streak', check: () => save.bestStreak >= 1 },
  { id: 'combo_5', name: 'Pressure Player', desc: '5-combo threat streak', check: () => save.bestStreak >= 2 },
  { id: 'speed_60', name: 'Minute Man', desc: 'Win in under 60 seconds on Hard', check: () => save.fastestWinMs < 60000 },
  { id: 'daily_25', name: 'Daily Devotion', desc: 'Complete 25 daily challenges', check: () => save.dailyCompleted >= 25 },
  { id: 'moves_2500', name: 'Grand Tactician', desc: 'Make 2500 total moves', check: () => save.totalMoves >= 2500 },
];

// ─── Skins ──────────────────────────────────────────────────────────
const SKINS = [
  { name: 'Neon Cyan', color: 0x00ffff, emissive: 0x00aaaa, req: '' },
  { name: 'Solar Flare', color: 0xff6600, emissive: 0xaa4400, req: '50 Wins' },
  { name: 'Plasma Pink', color: 0xff44ff, emissive: 0xaa22aa, req: '5K Score' },
  { name: 'Frost Ring', color: 0x44ccff, emissive: 0x2288aa, req: '10 Games' },
  { name: 'Toxic Green', color: 0x44ff44, emissive: 0x22aa22, req: 'x5 Combo' },
  { name: 'Royal Gold', color: 0xffcc00, emissive: 0xaa8800, req: 'Perfect Game' },
  { name: 'Void Purple', color: 0xaa44ff, emissive: 0x7722aa, req: '80% Win Rate' },
  { name: 'Inferno', color: 0xff4422, emissive: 0xaa2211, req: 'All Modes' },
  { name: 'Midnight', color: 0x2244aa, emissive: 0x112266, req: 'Level 15' },
  { name: 'Holo Prism', color: 0xffffff, emissive: 0x88aaff, req: '25 Wins' },
];

function skinUnlocked(i: number): boolean {
  if (i === 0) return true;
  if (i === 1) return save.wins >= 50;
  if (i === 2) return save.xp >= 5000;
  if (i === 3) return save.gamesPlayed >= 10;
  if (i === 4) return save.bestStreak >= 5;
  if (i === 5) return save.perfectGames >= 1;
  if (i === 6) return save.gamesPlayed >= 20 && save.wins / save.gamesPlayed >= 0.8;
  if (i === 7) return ['classic','timed','blitz','popout','five','daily','practice','versus'].every(m => (save.modeStats[m]?.played ?? 0) > 0);
  if (i === 8) return save.level >= 15;
  if (i === 9) return save.wins >= 25;
  return false;
}

// ─── Themes ─────────────────────────────────────────────────────────
const THEMES = [
  { name: 'Neon Holodeck', bg: 0x000a18, grid: 0x00ccff, floor: 0x001122 },
  { name: 'Crimson Arena', bg: 0x180005, grid: 0xff3344, floor: 0x220008 },
  { name: 'Emerald Void', bg: 0x001808, grid: 0x44ff88, floor: 0x002211 },
  { name: 'Solar Forge', bg: 0x181000, grid: 0xffaa22, floor: 0x221800 },
  { name: 'Void Chamber', bg: 0x0a0012, grid: 0x8844ff, floor: 0x110022 },
];

// ─── XP & Levels ────────────────────────────────────────────────────
function xpForLevel(lvl: number): number { return 50 + (lvl - 1) * 30; }
const LEVEL_TITLES = ['Novice','Apprentice','Challenger','Competitor','Strategist',
  'Tactician','Expert','Veteran','Champion','Elite','Master','Grandmaster',
  'Legend','Mythic','Transcendent'];
function levelTitle(lvl: number): string { return LEVEL_TITLES[Math.min(Math.floor((lvl - 1) / 4), LEVEL_TITLES.length - 1)]; }
function addXp(amount: number): boolean {
  let leveled = false;
  save.xp += amount;
  let needed = xpForLevel(save.level);
  while (save.xp >= needed) { save.xp -= needed; save.level++; leveled = true; needed = xpForLevel(save.level); }
  writeSave();
  return leveled;
}

// ─── Board Logic ────────────────────────────────────────────────────
class BoardState {
  cols: number; rows: number; connect: number;
  board: CellVal[][];

  constructor(cols: number, rows: number, connect: number) {
    this.cols = cols; this.rows = rows; this.connect = connect;
    this.board = Array.from({ length: cols }, () => Array(rows).fill(0) as CellVal[]);
  }

  clone(): BoardState {
    const b = new BoardState(this.cols, this.rows, this.connect);
    for (let c = 0; c < this.cols; c++) b.board[c] = [...this.board[c]];
    return b;
  }

  topRow(col: number): number {
    for (let r = this.rows - 1; r >= 0; r--) { if (this.board[col][r] !== 0) return r; }
    return -1;
  }

  canDrop(col: number): boolean { return col >= 0 && col < this.cols && this.board[col][this.rows - 1] === 0; }

  drop(col: number, player: CellVal): number {
    for (let r = 0; r < this.rows; r++) {
      if (this.board[col][r] === 0) { this.board[col][r] = player; return r; }
    }
    return -1;
  }

  undrop(col: number) {
    for (let r = this.rows - 1; r >= 0; r--) {
      if (this.board[col][r] !== 0) { this.board[col][r] = 0; return; }
    }
  }

  popBottom(col: number, player: CellVal): boolean {
    if (this.board[col][0] !== player) return false;
    for (let r = 0; r < this.rows - 1; r++) this.board[col][r] = this.board[col][r + 1];
    this.board[col][this.rows - 1] = 0;
    return true;
  }

  isFull(): boolean {
    for (let c = 0; c < this.cols; c++) if (this.canDrop(c)) return false;
    return true;
  }

  checkWin(player: CellVal): WinCell[] | null {
    const { cols, rows, connect, board } = this;
    const dirs = [[1,0],[0,1],[1,1],[1,-1]];
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        if (board[c][r] !== player) continue;
        for (const [dc, dr] of dirs) {
          const cells: WinCell[] = [{ col: c, row: r }];
          for (let i = 1; i < connect; i++) {
            const nc = c + dc * i, nr = r + dr * i;
            if (nc < 0 || nc >= cols || nr < 0 || nr >= rows || board[nc][nr] !== player) break;
            cells.push({ col: nc, row: nr });
          }
          if (cells.length === connect) return cells;
        }
      }
    }
    return null;
  }

  validMoves(): number[] {
    const moves: number[] = [];
    for (let c = 0; c < this.cols; c++) if (this.canDrop(c)) moves.push(c);
    return moves;
  }
}

// ─── AI (Minimax + Alpha-Beta) ──────────────────────────────────────
function evaluate(bs: BoardState, ai: CellVal, human: CellVal): number {
  const { cols, rows, connect, board } = bs;
  let score = 0;
  // Center column preference
  const center = Math.floor(cols / 2);
  for (let r = 0; r < rows; r++) {
    if (board[center][r] === ai) score += 3;
    else if (board[center][r] === human) score -= 3;
  }
  // Window evaluation
  const dirs = [[1,0],[0,1],[1,1],[1,-1]];
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      for (const [dc, dr] of dirs) {
        let aiCount = 0, humanCount = 0, empty = 0;
        for (let i = 0; i < connect; i++) {
          const nc = c + dc * i, nr = r + dr * i;
          if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) { aiCount = -1; break; }
          if (board[nc][nr] === ai) aiCount++;
          else if (board[nc][nr] === human) humanCount++;
          else empty++;
        }
        if (aiCount < 0) continue;
        if (aiCount === connect) return 100000;
        if (humanCount === connect) return -100000;
        if (humanCount === 0 && aiCount > 0) score += aiCount === 3 ? 50 : aiCount === 2 ? 10 : 1;
        if (aiCount === 0 && humanCount > 0) score -= humanCount === 3 ? 80 : humanCount === 2 ? 15 : 1;
      }
    }
  }
  return score;
}

function minimax(bs: BoardState, depth: number, alpha: number, beta: number, maximizing: boolean, ai: CellVal, human: CellVal): number {
  if (bs.checkWin(ai)) return 100000 + depth;
  if (bs.checkWin(human)) return -100000 - depth;
  if (bs.isFull() || depth === 0) return evaluate(bs, ai, human);
  const moves = bs.validMoves();
  if (maximizing) {
    let best = -Infinity;
    for (const col of moves) {
      bs.drop(col, ai); const val = minimax(bs, depth - 1, alpha, beta, false, ai, human);
      bs.undrop(col); best = Math.max(best, val); alpha = Math.max(alpha, val);
      if (beta <= alpha) break;
    }
    return best;
  } else {
    let best = Infinity;
    for (const col of moves) {
      bs.drop(col, human); const val = minimax(bs, depth - 1, alpha, beta, true, ai, human);
      bs.undrop(col); best = Math.min(best, val); beta = Math.min(beta, val);
      if (beta <= alpha) break;
    }
    return best;
  }
}

function aiMove(bs: BoardState, difficulty: Difficulty): number {
  const ai: CellVal = 2, human: CellVal = 1;
  const depth = difficulty === 'easy' ? 2 : difficulty === 'medium' ? 4 : 6;
  const moves = bs.validMoves();
  if (moves.length === 0) return -1;

  // Easy: 30% random
  if (difficulty === 'easy' && Math.random() < 0.3) return moves[Math.floor(Math.random() * moves.length)];

  let bestScore = -Infinity, bestCol = moves[0];
  for (const col of moves) {
    bs.drop(col, ai);
    const score = minimax(bs, depth - 1, -Infinity, Infinity, false, ai, human);
    bs.undrop(col);
    if (score > bestScore) { bestScore = score; bestCol = col; }
  }
  return bestCol;
}

// ─── Audio Manager ──────────────────────────────────────────────────
class AudioManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;

  getContext(): AudioContext | null { return this.ctx; }
  getMasterGain(): GainNode | null { return this.masterGain; }
  getMusicGain(): GainNode | null { return this.musicGain; }

  init() {
    try {
      this.ctx = new AudioContext();
      this.masterGain = this.ctx.createGain();
      this.masterGain.connect(this.ctx.destination);
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.connect(this.masterGain);
      this.musicGain = this.ctx.createGain();
      this.musicGain.connect(this.masterGain);
      this.updateVolumes();
    } catch {}
  }

  updateVolumes() {
    if (!this.masterGain || !this.sfxGain || !this.musicGain) return;
    this.masterGain.gain.value = save.masterVol / 100;
    this.sfxGain.gain.value = save.sfxVol / 100;
    this.musicGain.gain.value = save.musicVol / 100;
  }

  private tone(freq: number, dur: number, type: OscillatorType = 'sine', gain: GainNode | null = this.sfxGain) {
    if (!this.ctx || !gain) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type; osc.frequency.value = freq;
    g.gain.setValueAtTime(0.3, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
    osc.connect(g); g.connect(gain);
    osc.start(); osc.stop(this.ctx.currentTime + dur);
  }

  drop() { this.tone(440, 0.15, 'sine'); setTimeout(() => this.tone(660, 0.1, 'sine'), 80); }
  dropMusical(col: number, totalCols: number) {
    // Pentatonic scale mapped to columns for a musical feel
    const pentatonic = [261.6, 293.7, 329.6, 392.0, 440.0, 523.3, 587.3, 659.3, 784.0];
    const idx = Math.min(col, pentatonic.length - 1);
    const freq = pentatonic[idx % pentatonic.length];
    this.tone(freq, 0.18, 'sine');
    setTimeout(() => this.tone(freq * 1.5, 0.1, 'sine'), 80);
  }
  select() { this.tone(880, 0.08, 'square'); }
  win() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.tone(f, 0.3, 'sine'), i * 120)); }
  lose() { [400, 350, 300, 250].forEach((f, i) => setTimeout(() => this.tone(f, 0.3, 'sawtooth'), i * 150)); }
  draw() { this.tone(440, 0.3, 'triangle'); setTimeout(() => this.tone(440, 0.3, 'triangle'), 200); }
  click() { this.tone(1200, 0.05, 'square'); }
  hover() { this.tone(2000, 0.03, 'sine'); }
  levelUp() { [523, 659, 784, 988, 1175].forEach((f, i) => setTimeout(() => this.tone(f, 0.25, 'sine'), i * 100)); }
  achievement() { [784, 988, 1175, 1568].forEach((f, i) => setTimeout(() => this.tone(f, 0.2, 'sine'), i * 80)); }
  countdown() { this.tone(660, 0.12, 'square'); }
  invalid() { this.tone(200, 0.2, 'sawtooth'); }
  popout() { this.tone(330, 0.2, 'sine'); setTimeout(() => this.tone(220, 0.15, 'sine'), 100); }
}

// ─── Game Manager ───────────────────────────────────────────────────
// ─── Background Music System ────────────────────────────────────────
class MusicSystem {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private droneOscillators: OscillatorNode[] = [];
  private droneGains: GainNode[] = [];
  private isPlaying = false;
  private themeIdx = 0;

  // Theme-specific drone parameters: [baseFreq, interval, detune, type]
  private readonly THEME_DRONES: [number, number, number, OscillatorType][][] = [
    // Neon Holodeck: ethereal pad
    [[55, 0, 0, 'sine'], [82.5, 0, 5, 'sine'], [110, 0, -3, 'triangle']],
    // Crimson Arena: dark tension
    [[49, 0, 0, 'sawtooth'], [73.5, 0, 8, 'sine'], [98, 0, -5, 'triangle']],
    // Emerald Void: mysterious
    [[65.4, 0, 0, 'sine'], [98, 0, 3, 'sine'], [130.8, 0, -2, 'triangle']],
    // Solar Forge: warm
    [[58.3, 0, 0, 'sine'], [87.3, 0, 7, 'sine'], [116.5, 0, -4, 'triangle']],
    // Void Chamber: deep space
    [[41.2, 0, 0, 'sine'], [61.7, 0, 10, 'sine'], [82.4, 0, -6, 'triangle']],
  ];

  init(audioCtx: AudioContext, masterGain: GainNode) {
    this.ctx = audioCtx;
    this.masterGain = masterGain;
  }

  start(themeIdx: number) {
    if (!this.ctx || !this.masterGain || this.isPlaying) return;
    this.stop();
    this.themeIdx = themeIdx;
    const params = this.THEME_DRONES[themeIdx % this.THEME_DRONES.length];

    for (const [freq, _interval, detune, type] of params) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      osc.detune.value = detune;
      gain.gain.setValueAtTime(0, this.ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.04, this.ctx.currentTime + 2); // fade in
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start();
      this.droneOscillators.push(osc);
      this.droneGains.push(gain);
    }
    this.isPlaying = true;
  }

  stop() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (let i = 0; i < this.droneGains.length; i++) {
      try {
        this.droneGains[i].gain.linearRampToValueAtTime(0, now + 0.5);
        this.droneOscillators[i].stop(now + 0.6);
      } catch {}
    }
    this.droneOscillators = [];
    this.droneGains = [];
    this.isPlaying = false;
  }

  // Subtle LFO modulation for movement
  update(time: number) {
    if (!this.isPlaying || !this.ctx) return;
    for (let i = 0; i < this.droneOscillators.length; i++) {
      const osc = this.droneOscillators[i];
      const params = this.THEME_DRONES[this.themeIdx % this.THEME_DRONES.length][i];
      if (params) {
        // Gentle frequency wobble
        osc.detune.value = params[2] + Math.sin(time * 0.2 + i * 1.5) * 8;
      }
      // Gentle volume swell
      if (this.droneGains[i]) {
        const vol = 0.03 + 0.015 * Math.sin(time * 0.15 + i * 2);
        this.droneGains[i].gain.value = vol;
      }
    }
  }

  setVolume(vol: number) {
    // Controlled by music volume in save
    for (const g of this.droneGains) {
      if (g) g.gain.value = 0.04 * (vol / 100);
    }
  }
}

// ─── Column Arrow Indicators ────────────────────────────────────────
class ColumnArrows {
  private arrows: Mesh[] = [];
  private arrowMats: MeshStandardMaterial[] = [];
  private group: Group;

  constructor(scene: { add: (o: any) => void }, cols: number, boardPos: Vector3) {
    this.group = new Group();
    const w = cols * CELL;
    const arrowGeo = new ConeGeometry(0.04, 0.08, 4);
    for (let c = 0; c < cols; c++) {
      const mat = new MeshStandardMaterial({
        color: 0x00ccff, emissive: new Color(0x00ccff),
        emissiveIntensity: 0.5, transparent: true, opacity: 0,
      });
      const arrow = new Mesh(arrowGeo, mat);
      arrow.rotation.x = Math.PI; // point down
      const x = c * CELL - w / 2 + CELL / 2;
      arrow.position.set(boardPos.x + x, boardPos.y + cols * CELL * 0.5 + 0.12, boardPos.z + 0.05);
      this.arrows.push(arrow);
      this.arrowMats.push(mat);
      this.group.add(arrow);
    }
    scene.add(this.group);
  }

  highlight(col: number, player: CellVal) {
    for (let c = 0; c < this.arrows.length; c++) {
      const mat = this.arrowMats[c];
      if (c === col) {
        const clr = player === 1 ? 0x00ffff : 0xff44ff;
        mat.color.set(clr);
        mat.emissive.set(clr);
        mat.opacity = 0.8;
      } else {
        mat.opacity = 0;
      }
    }
  }

  clearAll() {
    for (const mat of this.arrowMats) mat.opacity = 0;
  }

  update(time: number, activeCol: number) {
    // Bobbing animation for active arrow
    for (let c = 0; c < this.arrows.length; c++) {
      if (c === activeCol) {
        this.arrows[c].position.y += Math.sin(time * 4) * 0.0003;
      }
    }
  }

  rebuild(cols: number, boardPos: Vector3) {
    // Remove old arrows
    while (this.group.children.length > 0) this.group.remove(this.group.children[0]);
    this.arrows = [];
    this.arrowMats = [];
    const w = cols * CELL;
    const arrowGeo = new ConeGeometry(0.04, 0.08, 4);
    for (let c = 0; c < cols; c++) {
      const mat = new MeshStandardMaterial({
        color: 0x00ccff, emissive: new Color(0x00ccff),
        emissiveIntensity: 0.5, transparent: true, opacity: 0,
      });
      const arrow = new Mesh(arrowGeo, mat);
      arrow.rotation.x = Math.PI;
      const x = c * CELL - w / 2 + CELL / 2;
      arrow.position.set(boardPos.x + x, boardPos.y + cols * CELL * 0.5 + 0.12, boardPos.z + 0.05);
      this.arrows.push(arrow);
      this.arrowMats.push(mat);
      this.group.add(arrow);
    }
  }
}

// ─── Board Reflection ───────────────────────────────────────────────
class BoardReflection {
  private reflectionGroup: Group;
  private reflectionMat: MeshStandardMaterial;

  constructor(scene: { add: (o: any) => void }, boardY: number) {
    this.reflectionGroup = new Group();
    // Semi-transparent reflective plane below the board
    const reflGeo = new PlaneGeometry(2.5, 2.5);
    this.reflectionMat = new MeshStandardMaterial({
      color: 0x001133, emissive: new Color(0x001133),
      emissiveIntensity: 0.15, transparent: true, opacity: 0.2,
      roughness: 0.1, metalness: 0.8, side: DoubleSide,
    });
    const reflPlane = new Mesh(reflGeo, this.reflectionMat);
    reflPlane.rotation.x = -Math.PI / 2;
    reflPlane.position.set(0, 0.01, BOARD_Z);
    this.reflectionGroup.add(reflPlane);
    scene.add(this.reflectionGroup);
  }

  update(time: number, themeColor: number) {
    // Subtle shimmer
    const shimmer = 0.15 + 0.05 * Math.sin(time * 0.8);
    this.reflectionMat.opacity = shimmer;
    this.reflectionMat.emissive.set(themeColor);
    this.reflectionMat.emissiveIntensity = 0.1 + 0.05 * Math.sin(time * 0.5);
  }
}

// ─── Timer Warning Effect ───────────────────────────────────────────
class TimerWarning {
  private warningMesh: Mesh;
  private warningMat: MeshStandardMaterial;
  private active = false;

  constructor(scene: { add: (o: any) => void }) {
    const geo = new PlaneGeometry(40, 40);
    this.warningMat = new MeshStandardMaterial({
      color: 0xff0000, emissive: new Color(0xff0000),
      emissiveIntensity: 0.3, transparent: true, opacity: 0, side: DoubleSide,
    });
    this.warningMesh = new Mesh(geo, this.warningMat);
    this.warningMesh.position.set(0, 3, -5);
    this.warningMesh.visible = false;
    scene.add(this.warningMesh);
  }

  setActive(active: boolean) {
    this.active = active;
    this.warningMesh.visible = active;
    if (!active) this.warningMat.opacity = 0;
  }

  update(time: number) {
    if (!this.active) return;
    const pulse = Math.abs(Math.sin(time * 3)) * 0.06;
    this.warningMat.opacity = pulse;
    this.warningMat.emissiveIntensity = 0.2 + pulse * 2;
  }
}

class GameManager {
  phase: GamePhase = 'menu';
  mode: GameMode = 'classic';
  difficulty: Difficulty = 'medium';
  board!: BoardState;
  currentPlayer: CellVal = 1;
  moveCount = 0;
  startTime = 0;
  turnStartTime = 0;
  turnTimeLimit = 0; // ms, 0 = no limit
  blitzTimeLeft = 0; // ms for blitz
  winner: CellVal = 0;
  winCells: WinCell[] = [];
  moveHistory: { col: number; player: CellVal; }[] = [];
  isAiTurn = false;
  aiThinking = false;
  vsMode = false;
  dailyRng: (() => number) | null = null;
  achPage = 0;
  pendingToast = '';
  toastTimer = 0;
  hintCol = -1; // for practice mode hints
  comboCount = 0; // consecutive threats/setups by human
  maxCombo = 0;
  replayMoves: { col: number; player: CellVal; }[] = [];
  replayIndex = 0;
  replayPlaying = false;

  get cols(): number { return this.mode === 'five' ? COLS_BIG : COLS_STD; }
  get rows(): number { return this.mode === 'five' ? ROWS_BIG : ROWS_STD; }
  get connect(): number { return this.mode === 'five' ? CONNECT_BIG : CONNECT_STD; }

  startGame(mode: GameMode, diff: Difficulty) {
    this.mode = mode; this.difficulty = diff;
    this.board = new BoardState(this.cols, this.rows, this.connect);
    this.currentPlayer = 1; this.moveCount = 0;
    this.startTime = performance.now(); this.turnStartTime = performance.now();
    this.winner = 0; this.winCells = [];
    this.moveHistory = []; this.isAiTurn = false; this.aiThinking = false;
    this.vsMode = mode === 'versus';
    this.dailyRng = mode === 'daily' ? mulberry32(dateSeed()) : null;

    if (mode === 'timed') this.turnTimeLimit = diff === 'easy' ? 30000 : diff === 'medium' ? 15000 : 8000;
    else this.turnTimeLimit = 0;
    if (mode === 'blitz') this.blitzTimeLeft = diff === 'easy' ? 180000 : diff === 'medium' ? 120000 : 60000;
    else this.blitzTimeLeft = 0;

    this.phase = 'playing';
    this.comboCount = 0;
    this.maxCombo = 0;
    this.replayMoves = [];
    this.replayIndex = 0;
    this.replayPlaying = false;

    // Daily challenge: AI makes first move with seeded randomness
    if (mode === 'daily' && this.dailyRng) {
      const col = Math.floor(this.dailyRng() * this.cols);
      if (this.board.canDrop(col)) {
        this.board.drop(col, 2);
        this.moveHistory.push({ col, player: 2 });
      }
    }
  }

  makeMove(col: number): { row: number; player: CellVal } | null {
    if (this.phase !== 'playing' || this.winner !== 0) return null;
    if (!this.board.canDrop(col)) return null;
    const player = this.currentPlayer;
    const row = this.board.drop(col, player);
    if (row < 0) return null;
    this.moveCount++;
    this.moveHistory.push({ col, player });
    save.totalMoves++;

    const win = this.board.checkWin(player);
    if (win) { this.winner = player; this.winCells = win; this.endGame(); return { row, player }; }
    if (this.board.isFull()) { this.winner = 0; this.winCells = []; this.endGame(); return { row, player }; }

    // Combo tracking: check if the human creates a 3-in-a-row threat
    if (player === 1) {
      const threatCount = this.countThreats(1);
      if (threatCount > 0) {
        this.comboCount++;
        this.maxCombo = Math.max(this.maxCombo, this.comboCount);
      } else {
        this.comboCount = 0;
      }
    }

    this.currentPlayer = player === 1 ? 2 : 1;
    this.turnStartTime = performance.now();
    this.isAiTurn = !this.vsMode && this.currentPlayer === 2;
    return { row, player };
  }

  doPopOut(col: number): boolean {
    if (this.mode !== 'popout' || this.phase !== 'playing') return false;
    if (!this.board.popBottom(col, this.currentPlayer)) return false;
    this.moveCount++;
    const win = this.board.checkWin(this.currentPlayer);
    if (win) { this.winner = this.currentPlayer; this.winCells = win; this.endGame(); return true; }
    if (this.board.isFull()) { this.winner = 0; this.winCells = []; this.endGame(); return true; }
    this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
    this.turnStartTime = performance.now();
    this.isAiTurn = !this.vsMode && this.currentPlayer === 2;
    return true;
  }

  undo(): boolean {
    if (this.mode !== 'practice' || this.moveHistory.length < 2) return false;
    // Undo AI move then player move
    for (let i = 0; i < 2; i++) {
      const last = this.moveHistory.pop();
      if (last) this.board.undrop(last.col);
    }
    this.moveCount -= 2;
    this.currentPlayer = 1;
    this.isAiTurn = false;
    return true;
  }

  endGame() {
    const elapsed = performance.now() - this.startTime;
    // Store replay data
    this.replayMoves = [...this.moveHistory];
    save.gamesPlayed++;
    const ms = save.modeStats[this.mode] ?? { played: 0, wins: 0 };
    ms.played++;
    if (this.winner === 1) {
      save.wins++; ms.wins++; save.currentStreak++;
      save.bestStreak = Math.max(save.bestStreak, save.currentStreak);
      if (elapsed < save.fastestWinMs) save.fastestWinMs = elapsed;
      if (this.difficulty === 'hard' && this.moveCount <= this.connect * 2) save.perfectGames++;
      if (this.mode === 'daily') save.dailyCompleted++;
      const xpBase = this.difficulty === 'easy' ? 30 : this.difficulty === 'medium' ? 60 : 100;
      const comboBonus = Math.min(this.maxCombo * 5, 50); // up to +50 XP for combos
      addXp(xpBase + Math.floor(this.moveCount * 2) + comboBonus);
    } else if (this.winner === 2) {
      save.losses++; save.currentStreak = 0;
      addXp(15);
    } else {
      save.draws++; save.currentStreak = 0;
      addXp(25);
    }
    save.modeStats[this.mode] = ms;

    // Update leaderboard
    if (this.winner === 1) {
      const score = Math.floor(10000 / Math.max(1, elapsed / 1000)) + this.moveCount * 10;
      save.leaderboard.push({ name: 'Player', score, mode: this.mode });
      save.leaderboard.sort((a, b) => b.score - a.score);
      if (save.leaderboard.length > 15) save.leaderboard.length = 15;
    }

    writeSave();
    this.phase = 'gameover';
  }

  checkAchievements(): string[] {
    const newAchs: string[] = [];
    for (const ach of ACHIEVEMENTS) {
      if (!save.achievementsUnlocked.includes(ach.id) && ach.check()) {
        save.achievementsUnlocked.push(ach.id);
        newAchs.push(ach.name);
      }
    }
    if (newAchs.length > 0) writeSave();
    return newAchs;
  }

  getRating(): string {
    if (!this.winner) return '--';
    const elapsed = (performance.now() - this.startTime) / 1000;
    const efficiency = this.connect * 2 / Math.max(1, this.moveCount);
    const speed = 60 / Math.max(1, elapsed);
    const score = efficiency * 50 + speed * 30 + (this.difficulty === 'hard' ? 20 : this.difficulty === 'medium' ? 10 : 0);
    if (score >= 80) return 'S';
    if (score >= 60) return 'A';
    if (score >= 40) return 'B';
    if (score >= 25) return 'C';
    if (score >= 15) return 'D';
    return 'F';
  }

  getHintCol(): number {
    if (this.phase !== 'playing' || this.currentPlayer !== 1) return -1;
    // Use medium-depth AI to suggest a move for the player
    const hint = aiMove(this.board.clone(), 'medium');
    return hint;
  }

  getXpEarned(): number {
    if (this.winner === 1) {
      const base = this.difficulty === 'easy' ? 30 : this.difficulty === 'medium' ? 60 : 100;
      const comboBonus = Math.min(this.maxCombo * 5, 50);
      return base + Math.floor(this.moveCount * 2) + comboBonus;
    }
    return this.winner === 2 ? 15 : 25;
  }

  countThreats(player: CellVal): number {
    const { cols, rows, connect, board } = this.board;
    const dirs = [[1,0],[0,1],[1,1],[1,-1]];
    let threats = 0;
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        for (const [dc, dr] of dirs) {
          let pCount = 0, empty = 0;
          for (let i = 0; i < connect; i++) {
            const nc = c + dc * i, nr = r + dr * i;
            if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) { pCount = -1; break; }
            if (board[nc][nr] === player) pCount++;
            else if (board[nc][nr] === 0) empty++;
            else { pCount = -1; break; }
          }
          if (pCount === connect - 1 && empty === 1) threats++;
        }
      }
    }
    return threats;
  }
}

// ─── Particle System ────────────────────────────────────────────────
interface Particle { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; maxLife: number; }

class ParticleSystem {
  private particles: Particle[] = [];
  private points: Points;
  private geo: BufferGeometry;
  private maxParticles = 500;
  private positions: Float32Array;
  private colors: Float32Array;
  private sizes: Float32Array;

  constructor(scene: { add: (o: any) => void }) {
    this.positions = new Float32Array(this.maxParticles * 3);
    this.colors = new Float32Array(this.maxParticles * 3);
    this.sizes = new Float32Array(this.maxParticles);
    this.geo = new BufferGeometry();
    this.geo.setAttribute('position', new Float32BufferAttribute(this.positions, 3));
    this.geo.setAttribute('color', new Float32BufferAttribute(this.colors, 3));
    this.geo.setAttribute('size', new Float32BufferAttribute(this.sizes, 1));
    const mat = new PointsMaterial({ size: 0.03, vertexColors: true, transparent: true, opacity: 0.8, blending: AdditiveBlending, depthWrite: false, sizeAttenuation: true });
    this.points = new Points(this.geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  emit(x: number, y: number, z: number, count: number, color: Color, spread = 0.5, speed = 1, life = 1) {
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= this.maxParticles) break;
      const angle = Math.random() * Math.PI * 2;
      const elev = (Math.random() - 0.3) * Math.PI;
      const spd = speed * (0.3 + Math.random() * 0.7);
      this.particles.push({
        x: x + (Math.random() - 0.5) * spread * 0.1,
        y: y + (Math.random() - 0.5) * spread * 0.1,
        z: z + (Math.random() - 0.5) * spread * 0.1,
        vx: Math.cos(angle) * Math.cos(elev) * spd,
        vy: Math.sin(elev) * spd * 1.5 + 0.5,
        vz: Math.sin(angle) * Math.cos(elev) * spd * 0.5,
        life, maxLife: life,
      });
    }
  }

  emitDropSplash(x: number, y: number, z: number, color: Color) {
    this.emit(x, y, z, 15, color, 0.1, 0.6, 0.6);
  }

  emitWinCelebration(cells: { x: number; y: number; z: number }[], color: Color) {
    for (const c of cells) {
      this.emit(c.x, c.y, c.z, 20, color, 0.15, 1.2, 1.5);
    }
    // Extra burst at center of win
    if (cells.length > 0) {
      const cx = cells.reduce((s, c) => s + c.x, 0) / cells.length;
      const cy = cells.reduce((s, c) => s + c.y, 0) / cells.length;
      const cz = cells.reduce((s, c) => s + c.z, 0) / cells.length;
      this.emit(cx, cy, cz, 40, color, 0.3, 1.5, 2);
    }
  }

  update(delta: number, themeColor: Color) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * delta; p.y += p.vy * delta; p.z += p.vz * delta;
      p.vy -= 1.5 * delta; // gravity
      p.life -= delta;
      if (p.life <= 0) { this.particles.splice(i, 1); }
    }
    // Update buffers
    for (let i = 0; i < this.maxParticles; i++) {
      if (i < this.particles.length) {
        const p = this.particles[i];
        const t = p.life / p.maxLife;
        this.positions[i * 3] = p.x;
        this.positions[i * 3 + 1] = p.y;
        this.positions[i * 3 + 2] = p.z;
        this.colors[i * 3] = themeColor.r * t;
        this.colors[i * 3 + 1] = themeColor.g * t;
        this.colors[i * 3 + 2] = themeColor.b * t;
        this.sizes[i] = 0.03 * t;
      } else {
        this.positions[i * 3] = 0;
        this.positions[i * 3 + 1] = -100;
        this.positions[i * 3 + 2] = 0;
        this.sizes[i] = 0;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
  }
}

// ─── Ambient Particle System ────────────────────────────────────────
class AmbientParticles {
  private points: Points;
  private geo: BufferGeometry;
  private count = 120;
  private positions: Float32Array;
  private velocities: Float32Array;
  private phases: Float32Array;

  constructor(scene: { add: (o: any) => void }, color: number) {
    this.positions = new Float32Array(this.count * 3);
    this.velocities = new Float32Array(this.count * 3);
    this.phases = new Float32Array(this.count);
    for (let i = 0; i < this.count; i++) {
      this.positions[i * 3] = (Math.random() - 0.5) * 12;
      this.positions[i * 3 + 1] = Math.random() * 5;
      this.positions[i * 3 + 2] = (Math.random() - 0.5) * 12 - 2;
      this.velocities[i * 3] = (Math.random() - 0.5) * 0.1;
      this.velocities[i * 3 + 1] = 0.02 + Math.random() * 0.06;
      this.velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.1;
      this.phases[i] = Math.random() * Math.PI * 2;
    }
    this.geo = new BufferGeometry();
    this.geo.setAttribute('position', new Float32BufferAttribute(this.positions, 3));
    const mat = new PointsMaterial({ color, size: 0.02, transparent: true, opacity: 0.4, blending: AdditiveBlending, depthWrite: false, sizeAttenuation: true });
    this.points = new Points(this.geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  update(time: number) {
    for (let i = 0; i < this.count; i++) {
      const phase = this.phases[i];
      this.positions[i * 3] += Math.sin(time * 0.3 + phase) * 0.002;
      this.positions[i * 3 + 1] += this.velocities[i * 3 + 1] * 0.016;
      this.positions[i * 3 + 2] += Math.cos(time * 0.2 + phase) * 0.002;
      // Wrap around vertically
      if (this.positions[i * 3 + 1] > 6) {
        this.positions[i * 3 + 1] = -0.5;
        this.positions[i * 3] = (Math.random() - 0.5) * 12;
        this.positions[i * 3 + 2] = (Math.random() - 0.5) * 12 - 2;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
  }

  setColor(color: number) {
    (this.points.material as PointsMaterial).color.set(color);
  }
}

// ─── Win Line Renderer ──────────────────────────────────────────────
class WinLineRenderer {
  private mesh: Mesh | null = null;
  private scene: { add: (o: any) => void; remove: (o: any) => void };
  private time = 0;

  constructor(scene: { add: (o: any) => void; remove: (o: any) => void }) {
    this.scene = scene;
  }

  show(positions: Vector3[], color: Color) {
    this.clear();
    if (positions.length < 2) return;
    const curve = new CatmullRomCurve3(positions, false, 'centripetal');
    const geo = new TubeGeometry(curve, 32, 0.012, 8, false);
    const mat = new MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: 2,
      transparent: true, opacity: 0.9,
    });
    this.mesh = new Mesh(geo, mat);
    this.scene.add(this.mesh);
  }

  update(delta: number) {
    if (!this.mesh) return;
    this.time += delta;
    const mat = this.mesh.material as MeshStandardMaterial;
    mat.emissiveIntensity = 1.5 + Math.sin(this.time * 4) * 0.8;
    mat.opacity = 0.7 + Math.sin(this.time * 3) * 0.2;
  }

  clear() {
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh = null; }
    this.time = 0;
  }
}

// ─── 3D Board Renderer ──────────────────────────────────────────────
class BoardRenderer {
  private world!: World;
  private boardGroup!: Group;
  private discMeshes: (Mesh | null)[][] = [];
  private columnHighlights: Mesh[] = [];
  private columnHitboxes: { entity: any; col: number; }[] = [];
  private winGlows: Mesh[] = [];
  private dropAnims: DropAnim[] = [];
  private gridMat!: MeshStandardMaterial;
  private slotMats: MeshStandardMaterial[] = [];
  private floorMesh!: Mesh;
  private ghostDisc: Mesh | null = null;
  private ghostMat!: MeshStandardMaterial;
  private shakeIntensity = 0;
  private shakeOffset = new Vector3();
  private originalBoardY = BOARD_Y;
  private discSpinTargets: { mesh: Mesh; speed: number; }[] = [];
  private gridPulseTime = 0;
  private entryAnim = 0;
  private entryAnimActive = false;
  private lastMoveCol = -1;
  private lastMoveRow = -1;
  private lastMoveMesh: Mesh | null = null;
  private lastMoveGlow: Mesh | null = null;
  private gridLines: Mesh[] = [];
  private gridLineMat!: MeshStandardMaterial;

  init(world: World, game: GameManager) {
    this.world = world;
    this.boardGroup = new Group();
    this.boardGroup.position.set(0, BOARD_Y, BOARD_Z);
    world.scene.add(this.boardGroup);
    this.buildBoard(game);
    this.buildFloor(world);
    this.buildEnvironment(world);
    // Ghost disc for column preview
    const ghostGeo = new TorusGeometry(DISC_R, DISC_TUBE, 16, 32);
    this.ghostMat = new MeshStandardMaterial({ color: 0x00ffff, emissive: new Color(0x00ffff), emissiveIntensity: 0.4, transparent: true, opacity: 0, metalness: 0.2, roughness: 0.6 });
    this.ghostDisc = new Mesh(ghostGeo, this.ghostMat);
    this.ghostDisc.visible = false;
    this.boardGroup.add(this.ghostDisc);
  }

  private buildFloor(world: World) {
    const theme = THEMES[save.theme];
    const floorGeo = new PlaneGeometry(30, 30);
    const floorMat = new MeshStandardMaterial({ color: theme.floor, roughness: 0.8 });
    this.floorMesh = new Mesh(floorGeo, floorMat);
    this.floorMesh.rotation.x = -Math.PI / 2;
    this.floorMesh.position.y = 0;
    world.scene.add(this.floorMesh);
  }

  private buildEnvironment(world: World) {
    const theme = THEMES[save.theme];
    // Grid lines on floor — stored for pulsing
    this.gridLineMat = new MeshStandardMaterial({ color: theme.grid, emissive: new Color(theme.grid), emissiveIntensity: 0.5, transparent: true, opacity: 0.3 });
    this.gridLines = [];
    for (let i = -5; i <= 5; i++) {
      const hLine = new Mesh(new BoxGeometry(30, 0.005, 0.02), this.gridLineMat);
      hLine.position.set(0, 0.005, i * 3);
      world.scene.add(hLine);
      this.gridLines.push(hLine);
      const vLine = new Mesh(new BoxGeometry(0.02, 0.005, 30), this.gridLineMat);
      vLine.position.set(i * 3, 0.005, 0);
      world.scene.add(vLine);
      this.gridLines.push(vLine);
    }
    // Accent pillars
    const pillarMat = new MeshStandardMaterial({ color: theme.grid, emissive: new Color(theme.grid), emissiveIntensity: 0.4, transparent: true, opacity: 0.4 });
    [[-3, -4], [3, -4], [-3, 2], [3, 2]].forEach(([x, z]) => {
      const p = new Mesh(new CylinderGeometry(0.05, 0.05, 4), pillarMat);
      p.position.set(x, 2, z);
      world.scene.add(p);
    });
  }

  buildBoard(game: GameManager) {
    // Clear existing
    while (this.boardGroup.children.length > 0) this.boardGroup.remove(this.boardGroup.children[0]);
    // Re-add ghost disc to board group
    if (this.ghostDisc) this.boardGroup.add(this.ghostDisc);
    this.discMeshes = [];
    this.columnHighlights = [];
    this.columnHitboxes.forEach(h => { if (h.entity?.object3D) h.entity.object3D.visible = false; });
    this.columnHitboxes = [];
    this.winGlows = [];
    this.discSpinTargets = [];

    const { cols, rows } = game;
    const theme = THEMES[save.theme];
    this.gridMat = new MeshStandardMaterial({ color: theme.grid, emissive: new Color(theme.grid), emissiveIntensity: 0.6, transparent: true, opacity: 0.9 });

    const w = cols * CELL, h = rows * CELL;
    const barThick = 0.015;

    // Frame
    const makeBar = (sx: number, sy: number, sz: number) => new Mesh(new BoxGeometry(sx, sy, sz), this.gridMat);

    // Vertical bars
    for (let c = 0; c <= cols; c++) {
      const bar = makeBar(barThick, h + barThick, barThick * 2);
      bar.position.set(c * CELL - w / 2, h / 2, 0);
      this.boardGroup.add(bar);
    }
    // Horizontal bars
    for (let r = 0; r <= rows; r++) {
      const bar = makeBar(w + barThick, barThick, barThick * 2);
      bar.position.set(0, r * CELL - CELL / 2, 0);
      this.boardGroup.add(bar);
    }

    // Back panel (subtle)
    const backMat = new MeshStandardMaterial({ color: 0x001122, transparent: true, opacity: 0.5 });
    const back = new Mesh(new BoxGeometry(w + 0.05, h + 0.05, 0.01), backMat);
    back.position.set(0, (rows - 1) * CELL / 2, -0.02);
    this.boardGroup.add(back);

    // Slot indicators
    const slotGeo = new TorusGeometry(DISC_R * 0.8, 0.005, 8, 24);
    const slotMat = new MeshStandardMaterial({ color: theme.grid, transparent: true, opacity: 0.15 });
    for (let c = 0; c < cols; c++) {
      this.discMeshes[c] = [];
      for (let r = 0; r < rows; r++) {
        const slot = new Mesh(slotGeo, slotMat);
        slot.position.set(c * CELL - w / 2 + CELL / 2, r * CELL, 0.01);
        this.boardGroup.add(slot);
        this.discMeshes[c][r] = null;
      }
    }

    // Column highlight bars (hover indicator)
    const hlMat = new MeshStandardMaterial({ color: 0x00ffff, emissive: new Color(0x00ffff), emissiveIntensity: 0.8, transparent: true, opacity: 0 });
    for (let c = 0; c < cols; c++) {
      const hl = new Mesh(new BoxGeometry(CELL - 0.01, h, 0.005), hlMat.clone());
      hl.position.set(c * CELL - w / 2 + CELL / 2, h / 2 - CELL / 2, 0.02);
      this.boardGroup.add(hl);
      this.columnHighlights.push(hl);
    }

    // Column hitboxes for interaction
    for (let c = 0; c < cols; c++) {
      const hitGeo = new BoxGeometry(CELL, h + 0.3, 0.15);
      const hitMat = new MeshStandardMaterial({ transparent: true, opacity: 0 });
      const hitMesh = new Mesh(hitGeo, hitMat);
      hitMesh.position.set(
        this.boardGroup.position.x + c * CELL - w / 2 + CELL / 2,
        this.boardGroup.position.y + h / 2 - CELL / 2,
        this.boardGroup.position.z + 0.05
      );
      const entity = this.world.createTransformEntity(hitMesh);
      entity.addComponent(RayInteractable);
      this.columnHitboxes.push({ entity, col: c });
    }
  }

  highlightColumn(col: number, player: CellVal) {
    for (let c = 0; c < this.columnHighlights.length; c++) {
      const mat = this.columnHighlights[c].material as MeshStandardMaterial;
      if (c === col) {
        const clr = player === 1 ? 0x00ffff : 0xff44ff;
        mat.color.set(clr); mat.emissive.set(clr);
        mat.opacity = 0.15;
      } else {
        mat.opacity = 0;
      }
    }
  }

  showGhost(col: number, row: number, player: CellVal, game: GameManager) {
    if (!this.ghostDisc) return;
    const w = game.cols * CELL;
    const x = col * CELL - w / 2 + CELL / 2;
    const y = row * CELL;
    this.ghostDisc.position.set(x, y, 0.01);
    const clr = player === 1 ? SKINS[save.equippedSkin].color : 0xff44ff;
    this.ghostMat.color.set(clr);
    this.ghostMat.emissive.set(clr);
    this.ghostMat.opacity = 0.25;
    this.ghostMat.emissiveIntensity = 0.3;
    this.ghostDisc.visible = true;
  }

  hideGhost() {
    if (this.ghostDisc) this.ghostDisc.visible = false;
  }

  triggerShake(intensity = 0.015) {
    this.shakeIntensity = intensity;
  }

  startEntryAnimation() {
    this.entryAnim = 0;
    this.entryAnimActive = true;
    this.boardGroup.scale.set(0.01, 0.01, 0.01);
  }

  markLastMove(col: number, row: number, game: GameManager) {
    // Remove old last-move indicator
    if (this.lastMoveGlow) {
      this.boardGroup.remove(this.lastMoveGlow);
      this.lastMoveGlow = null;
    }
    this.lastMoveCol = col;
    this.lastMoveRow = row;
    const w = game.cols * CELL;
    const glowMat = new MeshStandardMaterial({ color: 0xffffff, emissive: new Color(0xffffff), emissiveIntensity: 1.2, transparent: true, opacity: 0.35 });
    const glow = new Mesh(new TorusGeometry(DISC_R * 1.1, 0.008, 8, 24), glowMat);
    glow.position.set(col * CELL - w / 2 + CELL / 2, row * CELL, 0.02);
    this.boardGroup.add(glow);
    this.lastMoveGlow = glow;
  }

  getDiscWorldPos(col: number, row: number, game: GameManager): Vector3 {
    const w = game.cols * CELL;
    const x = col * CELL - w / 2 + CELL / 2;
    return new Vector3(
      this.boardGroup.position.x + x,
      this.boardGroup.position.y + row * CELL,
      this.boardGroup.position.z + 0.01
    );
  }

  clearHighlight() {
    this.columnHighlights.forEach(hl => { (hl.material as MeshStandardMaterial).opacity = 0; });
  }

  addDisc(col: number, row: number, player: CellVal, game: GameManager, animate = true): Mesh {
    const w = game.cols * CELL;
    const skin = SKINS[save.equippedSkin];
    const color = player === 1 ? (skin.color) : 0xff44ff;
    const emissive = player === 1 ? (skin.emissive) : 0xaa22aa;
    const mat = new MeshStandardMaterial({ color, emissive: new Color(emissive), emissiveIntensity: 0.7, metalness: 0.3, roughness: 0.5 });
    const geo = new TorusGeometry(DISC_R, DISC_TUBE, 16, 32);
    const mesh = new Mesh(geo, mat);
    const targetY = row * CELL;
    const x = col * CELL - w / 2 + CELL / 2;
    mesh.position.set(x, animate ? (game.rows * CELL + CELL) : targetY, 0.01);
    this.boardGroup.add(mesh);
    this.discMeshes[col][row] = mesh;

    if (animate) {
      this.dropAnims.push({ col, row, player, mesh, targetY });
    }
    // Add gentle spin
    this.discSpinTargets.push({ mesh, speed: (0.05 + Math.random() * 0.08) * (Math.random() > 0.5 ? 1 : -1) });
    return mesh;
  }

  removeDiscsInColumn(col: number, game: GameManager) {
    // For pop-out: rebuild column visuals
    for (let r = 0; r < game.rows; r++) {
      if (this.discMeshes[col][r]) {
        this.boardGroup.remove(this.discMeshes[col][r]!);
        this.discMeshes[col][r] = null;
      }
      if (game.board.board[col][r] !== 0) {
        this.addDisc(col, r, game.board.board[col][r], game, false);
      }
    }
  }

  showWin(cells: WinCell[], game: GameManager) {
    const w = game.cols * CELL;
    const glowMat = new MeshStandardMaterial({ color: 0xffffff, emissive: new Color(0xffffff), emissiveIntensity: 1.5, transparent: true, opacity: 0.6 });
    for (const cell of cells) {
      const glow = new Mesh(new SphereGeometry(DISC_R * 1.3, 16, 16), glowMat);
      glow.position.set(cell.col * CELL - w / 2 + CELL / 2, cell.row * CELL, 0.03);
      this.boardGroup.add(glow);
      this.winGlows.push(glow);
    }
  }

  update(delta: number) {
    // Animate drops
    for (let i = this.dropAnims.length - 1; i >= 0; i--) {
      const anim = this.dropAnims[i];
      anim.mesh.position.y -= DROP_SPEED * delta;
      if (anim.mesh.position.y <= anim.targetY) {
        anim.mesh.position.y = anim.targetY;
        this.dropAnims.splice(i, 1);
      }
    }
    // Pulse win glows
    const t = performance.now() / 500;
    this.winGlows.forEach((g, i) => {
      const s = 1 + 0.15 * Math.sin(t + i * 0.5);
      g.scale.set(s, s, s);
      (g.material as MeshStandardMaterial).opacity = 0.4 + 0.3 * Math.sin(t + i);
    });
    // Board shake
    if (this.shakeIntensity > 0) {
      this.shakeOffset.set(
        (Math.random() - 0.5) * this.shakeIntensity,
        (Math.random() - 0.5) * this.shakeIntensity,
        0
      );
      this.boardGroup.position.y = this.originalBoardY + this.shakeOffset.y;
      this.boardGroup.position.x = this.shakeOffset.x;
      this.shakeIntensity *= 0.85;
      if (this.shakeIntensity < 0.0005) {
        this.shakeIntensity = 0;
        this.boardGroup.position.set(0, this.originalBoardY, BOARD_Z);
      }
    }
    // Grid line pulse
    this.gridPulseTime += delta;
    if (this.gridLineMat) {
      const pulse = 0.25 + 0.08 * Math.sin(this.gridPulseTime * 1.5);
      this.gridLineMat.opacity = pulse;
      this.gridLineMat.emissiveIntensity = 0.4 + 0.2 * Math.sin(this.gridPulseTime * 1.2);
    }
    // Ghost disc pulse
    if (this.ghostDisc && this.ghostDisc.visible) {
      this.ghostMat.opacity = 0.2 + 0.08 * Math.sin(t * 2);
    }
    // Board entry animation
    if (this.entryAnimActive) {
      this.entryAnim += delta * 3;
      const t = Math.min(this.entryAnim, 1);
      // Elastic ease-out
      const elastic = t === 1 ? 1 : -Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI / 3)) + 1;
      this.boardGroup.scale.set(elastic, elastic, elastic);
      if (t >= 1) this.entryAnimActive = false;
    }
    // Last move indicator pulse
    if (this.lastMoveGlow) {
      const pulse = 0.25 + 0.15 * Math.sin(performance.now() / 300);
      (this.lastMoveGlow.material as MeshStandardMaterial).opacity = pulse;
    }
    // Disc subtle rotation
    for (const spin of this.discSpinTargets) {
      spin.mesh.rotation.z += spin.speed * delta;
    }
  }

  isDropping(): boolean { return this.dropAnims.length > 0; }

  getColumnHitboxes() { return this.columnHitboxes; }

  clearWinGlows() {
    this.winGlows.forEach(g => this.boardGroup.remove(g));
    this.winGlows = [];
  }

  applyTheme() {
    const theme = THEMES[save.theme];
    this.gridMat.color.set(theme.grid);
    this.gridMat.emissive.set(theme.grid);
    if (this.floorMesh) (this.floorMesh.material as MeshStandardMaterial).color.set(theme.floor);
  }
}

// ─── UI Manager ─────────────────────────────────────────────────────
class UIManager {
  private world!: World;
  private game!: GameManager;
  private audio!: AudioManager;
  private renderer!: BoardRenderer;
  private columnArrows: ColumnArrows | null = null;
  private panels: Map<string, { entity: any; doc: UIKitDocument | null; }> = new Map();
  private panelEntities: Map<string, any> = new Map();
  private toastEntity: any;
  private toastDoc: UIKitDocument | null = null;
  private countdownEntity: any;
  private countdownDoc: UIKitDocument | null = null;

  private readonly PANEL_NAMES = [
    'title', 'hud', 'gameover', 'modeselect', 'difficulty',
    'achievements', 'settings', 'pause', 'stats', 'leaderboard',
    'help', 'skins', 'replay',
  ];

  init(world: World, game: GameManager, audio: AudioManager, renderer: BoardRenderer, columnArrows?: ColumnArrows) {
    this.world = world;
    this.game = game;
    this.audio = audio;
    this.renderer = renderer;
    this.columnArrows = columnArrows ?? null;

    // Create all panels as Follower (head-locked HUDs)
    for (const name of this.PANEL_NAMES) {
      const entity = world.createTransformEntity(new Object3D());
      const fileName = name === 'achievements' ? 'achvlist' : name;
      entity.addComponent(PanelUI, { config: `./ui/${fileName}.json` });
      entity.addComponent(Follower, { target: world.camera });
      const fvec = entity.getVectorView(Follower, 'offsetPosition');
      if (fvec) { fvec[0] = 0; fvec[1] = 0; fvec[2] = -1.5; }
      entity.object3D!.visible = false;
      this.panelEntities.set(name, entity);
      this.panels.set(name, { entity, doc: null });
    }

    // Toast panel (separate, offset up)
    this.toastEntity = world.createTransformEntity(new Object3D());
    this.toastEntity.addComponent(PanelUI, { config: './ui/toast.json' });
    this.toastEntity.addComponent(Follower, { target: world.camera });
    const tvec = this.toastEntity.getVectorView(Follower, 'offsetPosition');
    if (tvec) { tvec[0] = 0; tvec[1] = 0.55; tvec[2] = -1.5; }
    this.toastEntity.object3D!.visible = false;

    // Countdown panel
    this.countdownEntity = world.createTransformEntity(new Object3D());
    this.countdownEntity.addComponent(PanelUI, { config: './ui/countdown.json' });
    this.countdownEntity.addComponent(Follower, { target: world.camera });
    const cvec = this.countdownEntity.getVectorView(Follower, 'offsetPosition');
    if (cvec) { cvec[0] = 0; cvec[1] = 0.2; cvec[2] = -1.3; }
    this.countdownEntity.object3D!.visible = false;

    // HUD is ScreenSpace (positioned lower) — set via vector view
    const hudEntity = this.panelEntities.get('hud');
    if (hudEntity) {
      const vec = hudEntity.getVectorView(Follower, 'offsetPosition');
      if (vec) { vec[0] = 0; vec[1] = -0.45; vec[2] = -1.2; }
    }
  }

  tryBindDocs() {
    for (const [name, panel] of this.panels) {
      if (!panel.doc) {
        const doc = panel.entity.getValue(PanelDocument, 'document') as UIKitDocument | undefined;
        if (doc) { panel.doc = doc; this.wirePanel(name, doc); }
      }
    }
    if (!this.toastDoc) {
      const doc = this.toastEntity?.getValue(PanelDocument, 'document') as UIKitDocument | undefined;
      if (doc) this.toastDoc = doc;
    }
    if (!this.countdownDoc) {
      const doc = this.countdownEntity?.getValue(PanelDocument, 'document') as UIKitDocument | undefined;
      if (doc) this.countdownDoc = doc;
    }
  }

  private wirePanel(name: string, doc: UIKitDocument) {
    const game = this.game;
    const audio = this.audio;
    const ui = this;

    const btn = (id: string, cb: () => void) => {
      const el = doc.getElementById(id);
      if (el) el.addEventListener('click', () => { audio.click(); cb(); });
    };

    switch (name) {
      case 'title':
        btn('btn-play', () => { game.phase = 'modeselect'; ui.showPanel('modeselect'); });
        btn('btn-scores', () => { game.phase = 'leaderboard'; ui.showPanel('leaderboard'); ui.updateLeaderboard(); });
        btn('btn-achievements', () => { game.phase = 'achievements'; game.achPage = 0; ui.showPanel('achievements'); ui.updateAchievements(); });
        btn('btn-stats', () => { game.phase = 'stats'; ui.showPanel('stats'); ui.updateStats(); });
        btn('btn-skins', () => { game.phase = 'skins'; ui.showPanel('skins'); ui.updateSkins(); });
        btn('btn-settings', () => { game.phase = 'settings'; ui.showPanel('settings'); ui.updateSettings(); });
        btn('btn-help', () => { game.phase = 'help'; ui.showPanel('help'); });
        break;

      case 'modeselect':
        const modes: [string, GameMode][] = [
          ['btn-classic', 'classic'], ['btn-timed', 'timed'], ['btn-blitz', 'blitz'],
          ['btn-popout', 'popout'], ['btn-five', 'five'], ['btn-daily', 'daily'],
          ['btn-practice', 'practice'], ['btn-versus', 'versus'],
        ];
        for (const [id, mode] of modes) {
          btn(id, () => { game.mode = mode; game.phase = 'difficulty'; ui.showPanel('difficulty'); ui.updateDifficultyLabel(); });
        }
        btn('btn-back', () => { game.phase = 'menu'; ui.showPanel('title'); ui.updateTitle(); });
        break;

      case 'difficulty':
        btn('btn-easy', () => ui.startWithCountdown('easy'));
        btn('btn-medium', () => ui.startWithCountdown('medium'));
        btn('btn-hard', () => ui.startWithCountdown('hard'));
        btn('btn-back', () => { game.phase = 'modeselect'; ui.showPanel('modeselect'); });
        break;

      case 'gameover':
        btn('btn-rematch', () => ui.startWithCountdown(game.difficulty));
        btn('btn-menu', () => { game.phase = 'menu'; ui.showPanel('title'); ui.updateTitle(); });
        btn('btn-replay', () => { ui.startReplay(); });
        break;

      case 'pause':
        btn('btn-resume', () => { game.phase = 'playing'; ui.showPanel('hud'); ui.updateHud(); });
        btn('btn-quit', () => { game.phase = 'menu'; ui.showPanel('title'); ui.updateTitle(); });
        break;

      case 'achievements':
        btn('btn-prev', () => { if (game.achPage > 0) { game.achPage--; ui.updateAchievements(); } });
        btn('btn-next', () => { if ((game.achPage + 1) * 18 < ACHIEVEMENTS.length) { game.achPage++; ui.updateAchievements(); } });
        btn('btn-back', () => { game.phase = 'menu'; ui.showPanel('title'); ui.updateTitle(); });
        break;

      case 'stats':
        btn('btn-back', () => { game.phase = 'menu'; ui.showPanel('title'); ui.updateTitle(); });
        break;

      case 'leaderboard':
        btn('btn-back', () => { game.phase = 'menu'; ui.showPanel('title'); ui.updateTitle(); });
        break;

      case 'settings':
        btn('btn-master-up', () => { save.masterVol = Math.min(100, save.masterVol + 10); audio.updateVolumes(); writeSave(); ui.updateSettings(); });
        btn('btn-master-down', () => { save.masterVol = Math.max(0, save.masterVol - 10); audio.updateVolumes(); writeSave(); ui.updateSettings(); });
        btn('btn-sfx-up', () => { save.sfxVol = Math.min(100, save.sfxVol + 10); audio.updateVolumes(); writeSave(); ui.updateSettings(); });
        btn('btn-sfx-down', () => { save.sfxVol = Math.max(0, save.sfxVol - 10); audio.updateVolumes(); writeSave(); ui.updateSettings(); });
        btn('btn-music-up', () => { save.musicVol = Math.min(100, save.musicVol + 10); audio.updateVolumes(); writeSave(); ui.updateSettings(); });
        btn('btn-music-down', () => { save.musicVol = Math.max(0, save.musicVol - 10); audio.updateVolumes(); writeSave(); ui.updateSettings(); });
        btn('btn-theme-prev', () => { save.theme = (save.theme - 1 + THEMES.length) % THEMES.length; writeSave(); this.renderer.applyTheme(); ui.updateSettings(); });
        btn('btn-theme-next', () => { save.theme = (save.theme + 1) % THEMES.length; writeSave(); this.renderer.applyTheme(); ui.updateSettings(); });
        btn('btn-reset', () => { save = defaultSave(); writeSave(); ui.updateSettings(); });
        btn('btn-back', () => { game.phase = 'menu'; ui.showPanel('title'); ui.updateTitle(); });
        break;

      case 'help':
        btn('btn-back', () => { game.phase = 'menu'; ui.showPanel('title'); ui.updateTitle(); });
        break;

      case 'skins':
        for (let i = 1; i <= 10; i++) {
          const idx = i - 1;
          btn(`skin-${i}`, () => {
            if (skinUnlocked(idx)) { save.equippedSkin = idx; writeSave(); ui.updateSkins(); }
          });
        }
        btn('btn-back', () => { game.phase = 'menu'; ui.showPanel('title'); ui.updateTitle(); });
        break;

      case 'replay':
        btn('btn-replay-start', () => { game.replayIndex = 0; ui.updateReplayState(); });
        btn('btn-replay-prev', () => { if (game.replayIndex > 0) { game.replayIndex--; ui.updateReplayState(); } });
        btn('btn-replay-next', () => { if (game.replayIndex < game.replayMoves.length) { game.replayIndex++; ui.updateReplayState(); } });
        btn('btn-replay-end', () => { game.replayIndex = game.replayMoves.length; ui.updateReplayState(); });
        btn('btn-replay-play', () => { game.replayPlaying = !game.replayPlaying; ui.updateReplayPlayBtn(); });
        btn('btn-replay-close', () => { game.replayPlaying = false; game.phase = 'gameover'; ui.showPanel('gameover'); ui.updateGameover(); });
        break;
    }
  }

  showPanel(name: string) {
    console.log('[UI] showPanel:', name);
    for (const [pName, panel] of this.panels) {
      const vis = pName === name;
      panel.entity.object3D!.visible = vis;
      if (vis) {
        const pos = panel.entity.object3D!.position;
        console.log(`[UI] ${pName} visible=true, pos=(${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)})`);
      }
    }
  }

  hideAll() {
    for (const panel of this.panels.values()) panel.entity.object3D!.visible = false;
  }

  startWithCountdown(diff: Difficulty) {
    this.game.difficulty = diff;
    this.hideAll();
    this.renderer.clearWinGlows();
    this.renderer.hideGhost();
    this.game.hintCol = -1;
    this.game.startGame(this.game.mode, diff);
    this.renderer.buildBoard(this.game);
    this.renderer.startEntryAnimation();
    // Rebuild column arrows for the current grid size
    if (this.columnArrows) this.columnArrows.rebuild(this.game.cols, new Vector3(0, BOARD_Y, BOARD_Z));

    // Rebuild existing discs (for daily challenge first move)
    for (let c = 0; c < this.game.cols; c++) {
      for (let r = 0; r < this.game.rows; r++) {
        if (this.game.board.board[c][r] !== 0) {
          this.renderer.addDisc(c, r, this.game.board.board[c][r], this.game, false);
        }
      }
    }

    // Show countdown
    let count = 3;
    this.countdownEntity.object3D!.visible = true;
    this.updateCountdownText(String(count));
    this.audio.countdown();

    const countInterval = setInterval(() => {
      count--;
      if (count > 0) {
        this.updateCountdownText(String(count));
        this.audio.countdown();
      } else {
        this.updateCountdownText('GO!');
        this.audio.select();
        setTimeout(() => {
          this.countdownEntity.object3D!.visible = false;
          this.showPanel('hud');
          this.updateHud();
        }, 400);
        clearInterval(countInterval);
      }
    }, 700);
  }

  private updateCountdownText(text: string) {
    if (this.countdownDoc) {
      const el = this.countdownDoc.getElementById('countdown-text') as UIKit.Text | undefined;
      el?.setProperties({ text });
    }
  }

  updateTitle() {
    const doc = this.panels.get('title')?.doc;
    if (!doc) return;
    const lvl = doc.getElementById('level-display') as UIKit.Text | undefined;
    lvl?.setProperties({ text: `Level ${save.level} - ${levelTitle(save.level)}` });
  }

  updateHud() {
    const doc = this.panels.get('hud')?.doc;
    if (!doc) return;
    const game = this.game;
    const modeLabel = doc.getElementById('mode-label') as UIKit.Text | undefined;
    const turnLabel = doc.getElementById('turn-label') as UIKit.Text | undefined;
    const scoreP1 = doc.getElementById('score-p1') as UIKit.Text | undefined;
    const scoreP2 = doc.getElementById('score-p2') as UIKit.Text | undefined;
    const timerLabel = doc.getElementById('timer-label') as UIKit.Text | undefined;
    const roundLabel = doc.getElementById('round-label') as UIKit.Text | undefined;

    const modeName = game.mode.charAt(0).toUpperCase() + game.mode.slice(1);
    modeLabel?.setProperties({ text: `${modeName} - ${game.difficulty.charAt(0).toUpperCase() + game.difficulty.slice(1)}` });

    if (game.vsMode) {
      turnLabel?.setProperties({ text: game.currentPlayer === 1 ? 'P1 Turn' : 'P2 Turn', color: game.currentPlayer === 1 ? '#00ffff' : '#ff44ff' });
    } else {
      turnLabel?.setProperties({ text: game.currentPlayer === 1 ? 'Your Turn' : 'AI Thinking...', color: game.currentPlayer === 1 ? '#00ffff' : '#ff44ff' });
    }

    scoreP1?.setProperties({ text: `${game.vsMode ? 'P1' : 'You'}: ${game.moveHistory.filter(m => m.player === 1).length}` });
    scoreP2?.setProperties({ text: `${game.vsMode ? 'P2' : 'CPU'}: ${game.moveHistory.filter(m => m.player === 2).length}` });

    if (game.mode === 'timed' && game.turnTimeLimit > 0) {
      const elapsed = performance.now() - game.turnStartTime;
      const left = Math.max(0, game.turnTimeLimit - elapsed);
      timerLabel?.setProperties({ text: `${(left / 1000).toFixed(1)}s`, color: left < 5000 ? '#ff4444' : '#ffcc00' });
    } else if (game.mode === 'blitz') {
      const total = performance.now() - game.startTime;
      const left = Math.max(0, game.blitzTimeLeft - total);
      timerLabel?.setProperties({ text: `${(left / 1000).toFixed(0)}s`, color: left < 10000 ? '#ff4444' : '#ffcc00' });
    } else {
      const elapsed = (performance.now() - game.startTime) / 1000;
      const m = Math.floor(elapsed / 60), s = Math.floor(elapsed % 60);
      timerLabel?.setProperties({ text: `${m}:${s.toString().padStart(2, '0')}` });
    }

    roundLabel?.setProperties({ text: `Moves: ${game.moveCount}` });
  }

  updateGameover() {
    const doc = this.panels.get('gameover')?.doc;
    if (!doc) return;
    const game = this.game;
    const title = doc.getElementById('result-title') as UIKit.Text | undefined;
    const mode = doc.getElementById('result-mode') as UIKit.Text | undefined;
    const moves = doc.getElementById('stat-moves') as UIKit.Text | undefined;
    const time = doc.getElementById('stat-time') as UIKit.Text | undefined;
    const streak = doc.getElementById('stat-streak') as UIKit.Text | undefined;
    const rating = doc.getElementById('stat-rating') as UIKit.Text | undefined;
    const xp = doc.getElementById('stat-xp') as UIKit.Text | undefined;

    if (game.winner === 1) { title?.setProperties({ text: game.vsMode ? 'P1 WINS!' : 'YOU WIN!', color: '#00ffff' }); }
    else if (game.winner === 2) { title?.setProperties({ text: game.vsMode ? 'P2 WINS!' : 'YOU LOSE', color: '#ff4444' }); }
    else { title?.setProperties({ text: 'DRAW!', color: '#ffcc00' }); }

    const modeName = game.mode.charAt(0).toUpperCase() + game.mode.slice(1);
    const diffName = game.difficulty.charAt(0).toUpperCase() + game.difficulty.slice(1);
    mode?.setProperties({ text: `${modeName} - ${diffName}` });
    moves?.setProperties({ text: `Moves: ${game.moveCount}` });
    const elapsed = (performance.now() - game.startTime) / 1000;
    const m = Math.floor(elapsed / 60), s = Math.floor(elapsed % 60);
    time?.setProperties({ text: `Time: ${m}:${s.toString().padStart(2, '0')}` });
    streak?.setProperties({ text: `Win Streak: ${save.currentStreak}` });
    rating?.setProperties({ text: `Rating: ${game.getRating()}` });

    const combo = doc.getElementById('stat-combo') as UIKit.Text | undefined;
    combo?.setProperties({ text: `Max Combo: ${game.maxCombo}x`, color: game.maxCombo >= 3 ? '#ff44ff' : '#aaaaaa' });
    xp?.setProperties({ text: `+${game.getXpEarned()} XP${game.maxCombo > 0 ? ` (${game.maxCombo}x combo!)` : ''}` });
  }

  startReplay() {
    const game = this.game;
    if (game.replayMoves.length === 0) return;
    game.replayIndex = 0;
    game.replayPlaying = false;
    game.phase = 'achievements'; // use a non-playing phase to block input
    this.showPanel('replay');
    this.updateReplayState();
  }

  updateReplayState() {
    const doc = this.panels.get('replay')?.doc;
    if (!doc) return;
    const moveLabel = doc.getElementById('replay-move') as UIKit.Text | undefined;
    moveLabel?.setProperties({ text: `Move ${this.game.replayIndex} / ${this.game.replayMoves.length}` });

    // Rebuild board to show state at replayIndex
    this.renderer.buildBoard(this.game);
    const tempBoard = new BoardState(this.game.cols, this.game.rows, this.game.connect);
    for (let i = 0; i < this.game.replayIndex; i++) {
      const mv = this.game.replayMoves[i];
      tempBoard.drop(mv.col, mv.player);
    }
    for (let c = 0; c < this.game.cols; c++) {
      for (let r = 0; r < this.game.rows; r++) {
        if (tempBoard.board[c][r] !== 0) {
          this.renderer.addDisc(c, r, tempBoard.board[c][r], this.game, false);
        }
      }
    }
    // Highlight last move if any
    if (this.game.replayIndex > 0) {
      const lastMove = this.game.replayMoves[this.game.replayIndex - 1];
      const lastRow = this.findLandingRow(tempBoard, lastMove.col, lastMove.player);
      if (lastRow >= 0) this.renderer.markLastMove(lastMove.col, lastRow, this.game);
    }
  }

  private findLandingRow(board: BoardState, col: number, _player: CellVal): number {
    // Find the top occupied row in this column
    for (let r = board.rows - 1; r >= 0; r--) {
      if (board.board[col][r] !== 0) return r;
    }
    return -1;
  }

  updateReplayPlayBtn() {
    const doc = this.panels.get('replay')?.doc;
    if (!doc) return;
    const btn = doc.getElementById('replay-play-text') as UIKit.Text | undefined;
    btn?.setProperties({ text: this.game.replayPlaying ? 'Pause' : 'Play' });
  }

  updateDifficultyLabel() {
    const doc = this.panels.get('difficulty')?.doc;
    if (!doc) return;
    const label = doc.getElementById('mode-label') as UIKit.Text | undefined;
    const modeName = this.game.mode.charAt(0).toUpperCase() + this.game.mode.slice(1);
    label?.setProperties({ text: `${modeName} Mode` });
  }

  updateAchievements() {
    const doc = this.panels.get('achievements')?.doc;
    if (!doc) return;
    const start = this.game.achPage * 18;
    const count = doc.getElementById('ach-count') as UIKit.Text | undefined;
    count?.setProperties({ text: `${save.achievementsUnlocked.length} / ${ACHIEVEMENTS.length} unlocked` });

    for (let i = 1; i <= 18; i++) {
      const el = doc.getElementById(`ach-${i}`) as UIKit.Text | undefined;
      if (!el) continue;
      const idx = start + i - 1;
      if (idx < ACHIEVEMENTS.length) {
        const a = ACHIEVEMENTS[idx];
        const unlocked = save.achievementsUnlocked.includes(a.id);
        el.setProperties({
          text: `${unlocked ? '[X]' : '[ ]'} ${a.name} - ${a.desc}`,
          color: unlocked ? '#ffcc00' : '#666666',
        });
      } else {
        el.setProperties({ text: '', color: '#666666' });
      }
    }

    const pageLabel = doc.getElementById('page-label') as UIKit.Text | undefined;
    const totalPages = Math.ceil(ACHIEVEMENTS.length / 18);
    pageLabel?.setProperties({ text: `${this.game.achPage + 1} / ${totalPages}` });
  }

  updateStats() {
    const doc = this.panels.get('stats')?.doc;
    if (!doc) return;
    const set = (id: string, text: string) => {
      const el = doc.getElementById(id) as UIKit.Text | undefined;
      el?.setProperties({ text });
    };
    set('stat-games', `Games Played: ${save.gamesPlayed}`);
    set('stat-wins', `Wins: ${save.wins}`);
    set('stat-losses', `Losses: ${save.losses}`);
    set('stat-draws', `Draws: ${save.draws}`);
    set('stat-winrate', `Win Rate: ${save.gamesPlayed > 0 ? Math.round(save.wins / save.gamesPlayed * 100) : 0}%`);
    set('stat-streak', `Best Win Streak: ${save.bestStreak}`);
    set('stat-moves', `Total Moves: ${save.totalMoves}`);
    set('stat-fastest', `Fastest Win: ${save.fastestWinMs < Infinity ? (save.fastestWinMs / 1000).toFixed(1) + 's' : '--'}`);
    set('stat-perfect', `Perfect Games: ${save.perfectGames}`);
    set('stat-daily', `Daily Challenges: ${save.dailyCompleted}`);
    set('stat-level', `Level: ${save.level} - ${levelTitle(save.level)}`);
    set('stat-xp', `XP: ${save.xp} / ${xpForLevel(save.level)}`);
  }

  updateLeaderboard() {
    const doc = this.panels.get('leaderboard')?.doc;
    if (!doc) return;
    for (let i = 1; i <= 15; i++) {
      const el = doc.getElementById(`lb-${i}`) as UIKit.Text | undefined;
      if (!el) continue;
      if (i - 1 < save.leaderboard.length) {
        const e = save.leaderboard[i - 1];
        el.setProperties({ text: `${i}. ${e.name} - ${e.score} (${e.mode})` });
      } else {
        el.setProperties({ text: `${i}. ---` });
      }
    }
  }

  updateSettings() {
    const doc = this.panels.get('settings')?.doc;
    if (!doc) return;
    const set = (id: string, text: string) => {
      const el = doc.getElementById(id) as UIKit.Text | undefined;
      el?.setProperties({ text });
    };
    set('master-vol', `${save.masterVol}%`);
    set('sfx-vol', `${save.sfxVol}%`);
    set('music-vol', `${save.musicVol}%`);
    set('theme-name', THEMES[save.theme].name);
  }

  updateSkins() {
    const doc = this.panels.get('skins')?.doc;
    if (!doc) return;
    for (let i = 1; i <= 10; i++) {
      const el = doc.getElementById(`skin-${i}`) as UIKit.Text | undefined;
      if (!el) continue;
      const skin = SKINS[i - 1];
      const unlocked = skinUnlocked(i - 1);
      const equipped = save.equippedSkin === i - 1;
      el.setProperties({
        text: `${skin.name}${equipped ? ' [EQUIPPED]' : unlocked ? '' : ` - ${skin.req}`}`,
        color: equipped ? '#ffffff' : unlocked ? skin.color.toString(16).padStart(6, '0').replace(/^/, '#') : '#666666',
      });
    }
  }

  showToast(text: string) {
    if (!this.toastDoc) return;
    const el = this.toastDoc.getElementById('toast-text') as UIKit.Text | undefined;
    el?.setProperties({ text });
    this.toastEntity.object3D!.visible = true;
    this.game.toastTimer = 3;
  }

  updateToast(delta: number) {
    if (this.game.toastTimer > 0) {
      this.game.toastTimer -= delta;
      if (this.game.toastTimer <= 0) {
        this.toastEntity.object3D!.visible = false;
      }
    }
  }
}

// ─── Keyboard State (DOM-based for browser-first) ───────────────────
const keysDown = new Set<string>();
const keysJustPressed = new Set<string>();
window.addEventListener('keydown', (e) => { if (!keysDown.has(e.code)) keysJustPressed.add(e.code); keysDown.add(e.code); });
window.addEventListener('keyup', (e) => { keysDown.delete(e.code); });
function consumeKeys() { keysJustPressed.clear(); }
function keyJustPressed(code: string): boolean { return keysJustPressed.has(code); }

// ─── Game Loop System ───────────────────────────────────────────────
class GameLoopSystem extends createSystem({
  interactables: { required: [RayInteractable] },
}) {
  private game!: GameManager;
  private boardRenderer!: BoardRenderer;
  private uiManager!: UIManager;
  private audio!: AudioManager;
  private raycaster = new Raycaster();
  private pointer = new Vector2();
  private hoveredCol = -1;
  private aiDelay = 0;
  private hudUpdateTimer = 0;
  private docsReady = false;
  private initDone = false;
  private particles!: ParticleSystem;
  private ambient!: AmbientParticles;
  private winLine!: WinLineRenderer;
  private hintActive = false;
  private hintFlashTimer = 0;
  private prevHoveredCol = -1;
  private music!: MusicSystem;
  private columnArrows!: ColumnArrows;
  private reflection!: BoardReflection;
  private timerWarning!: TimerWarning;
  private replayAutoTimer = 0;
  private musicStarted = false;

  setRefs(refs: { game: GameManager; boardRenderer: BoardRenderer; uiManager: UIManager; audio: AudioManager; particles: ParticleSystem; ambient: AmbientParticles; winLine: WinLineRenderer; music: MusicSystem; columnArrows: ColumnArrows; reflection: BoardReflection; timerWarning: TimerWarning; }) {
    this.game = refs.game;
    this.boardRenderer = refs.boardRenderer;
    this.uiManager = refs.uiManager;
    this.audio = refs.audio;
    this.particles = refs.particles;
    this.ambient = refs.ambient;
    this.winLine = refs.winLine;
    this.music = refs.music;
    this.columnArrows = refs.columnArrows;
    this.reflection = refs.reflection;
    this.timerWarning = refs.timerWarning;
  }

  update(delta: number, time: number) {
    if (!this.game) return;

    // Try binding PanelUI docs (async load)
    this.uiManager.tryBindDocs();

    // Show title on first ready
    if (!this.initDone) {
      this.initDone = true;
      setTimeout(() => {
        this.uiManager.showPanel('title');
        this.uiManager.updateTitle();
        this.game.phase = 'menu';
      }, 500);
    }

    // Update toast
    this.uiManager.updateToast(delta);

    // Update board renderer
    this.boardRenderer.update(delta);

    // Update particles
    const theme = THEMES[save.theme];
    this.particles.update(delta, new Color(theme.grid));
    this.ambient.update(time);
    this.winLine.update(delta);
    this.reflection.update(time, theme.grid);

    // Background music update
    if (this.music) {
      this.music.update(time);
      if (!this.musicStarted) {
        this.music.start(save.theme);
        this.musicStarted = true;
      }
    }

    // Replay auto-play
    if (this.game.replayPlaying && this.game.replayIndex < this.game.replayMoves.length) {
      this.replayAutoTimer -= delta;
      if (this.replayAutoTimer <= 0) {
        this.game.replayIndex++;
        this.uiManager.updateReplayState();
        this.replayAutoTimer = 0.8; // 0.8s per move in auto-play
        if (this.game.replayIndex >= this.game.replayMoves.length) {
          this.game.replayPlaying = false;
          this.uiManager.updateReplayPlayBtn();
        }
      }
    }

    // Hint flash
    if (this.hintActive) {
      this.hintFlashTimer -= delta;
      if (this.hintFlashTimer <= 0) this.hintActive = false;
    }

    if (this.game.phase !== 'playing') {
      this.boardRenderer.hideGhost();
      this.columnArrows.clearAll();
      this.timerWarning.setActive(false);
      return;
    }

    // HUD update
    this.hudUpdateTimer -= delta;
    if (this.hudUpdateTimer <= 0) {
      this.uiManager.updateHud();
      this.hudUpdateTimer = 0.25;
    }

    // Timer modes
    if (this.game.mode === 'timed' && this.game.turnTimeLimit > 0 && !this.game.aiThinking) {
      const elapsed = performance.now() - this.game.turnStartTime;
      const remaining = this.game.turnTimeLimit - elapsed;
      // Timer warning when <5s remaining
      this.timerWarning.setActive(remaining < 5000 && remaining > 0);
      if (this.timerWarning) this.timerWarning.update(time);
      if (elapsed > this.game.turnTimeLimit) {
        // Time's up — auto-move or forfeit
        if (this.game.currentPlayer === 1 && !this.game.vsMode) {
          // Random move for timeout
          const moves = this.game.board.validMoves();
          if (moves.length > 0) this.doPlayerMove(moves[Math.floor(Math.random() * moves.length)]);
        }
      }
    }

    if (this.game.mode === 'blitz') {
      const total = performance.now() - this.game.startTime;
      const remaining = this.game.blitzTimeLeft - total;
      this.timerWarning.setActive(remaining < 10000 && remaining > 0);
      if (this.timerWarning) this.timerWarning.update(time);
      if (total > this.game.blitzTimeLeft) {
        this.game.winner = this.game.currentPlayer === 1 ? 2 : 1;
        this.game.endGame();
        this.handleGameOver();
        return;
      }
    }

    // AI turn
    if (this.game.isAiTurn && !this.game.aiThinking && !this.boardRenderer.isDropping()) {
      this.game.aiThinking = true;
      this.aiDelay = 0.3 + Math.random() * 0.4; // Simulate thinking
    }
    if (this.game.aiThinking) {
      this.aiDelay -= delta;
      if (this.aiDelay <= 0) {
        const col = aiMove(this.game.board.clone(), this.game.difficulty);
        if (col >= 0) {
          const result = this.game.makeMove(col);
          if (result) {
            this.boardRenderer.addDisc(col, result.row, result.player, this.game);
            this.audio.dropMusical(col, this.game.cols);
            // Schedule particle splash for AI drop
            const dropTime = (this.game.rows - result.row) * CELL / DROP_SPEED;
            setTimeout(() => {
              const pos = this.boardRenderer.getDiscWorldPos(col, result.row, this.game);
              this.particles.emitDropSplash(pos.x, pos.y, pos.z, new Color(0xff44ff));
              this.boardRenderer.triggerShake(0.008);
              this.boardRenderer.markLastMove(col, result.row, this.game);
            }, dropTime * 1000);
          }
        }
        this.game.aiThinking = false;
        if ((this.game.phase as string) === 'gameover') this.handleGameOver();
      }
    }

    // Mouse/XR input for column hover and selection
    if (!this.game.isAiTurn && !this.boardRenderer.isDropping()) {
      this.handleInput();
    }

    // Keyboard shortcuts
    this.handleKeyboard();
  }

  private handleInput() {
    const hitboxes = this.boardRenderer.getColumnHitboxes();
    let newHovered = -1;

    // Check ECS interaction system
    for (const entity of this.queries.interactables.entities) {
      if (entity.hasComponent(Hovered)) {
        const match = hitboxes.find(h => h.entity === entity);
        if (match) newHovered = match.col;
      }
      if (entity.hasComponent(Pressed)) {
        const match = hitboxes.find(h => h.entity === entity);
        if (match) this.doPlayerMove(match.col);
      }
    }

    if (newHovered !== this.prevHoveredCol && newHovered >= 0) {
      this.audio.hover();
    }
    this.prevHoveredCol = newHovered;
    this.hoveredCol = newHovered;
    if (newHovered >= 0) {
      this.boardRenderer.highlightColumn(newHovered, this.game.currentPlayer);
      this.columnArrows.highlight(newHovered, this.game.currentPlayer);
      // Show ghost disc at landing row
      const topRow = this.game.board.topRow(newHovered);
      const landRow = topRow + 1;
      if (landRow < this.game.rows) {
        this.boardRenderer.showGhost(newHovered, landRow, this.game.currentPlayer, this.game);
      } else {
        this.boardRenderer.hideGhost();
      }
    } else if (this.hintActive && this.game.hintCol >= 0) {
      // Show hint ghost
      const hintCol = this.game.hintCol;
      const topRow = this.game.board.topRow(hintCol);
      const landRow = topRow + 1;
      if (landRow < this.game.rows) {
        this.boardRenderer.showGhost(hintCol, landRow, this.game.currentPlayer, this.game);
        this.boardRenderer.highlightColumn(hintCol, this.game.currentPlayer);
      }
    } else {
      this.boardRenderer.clearHighlight();
      this.boardRenderer.hideGhost();
      this.columnArrows.clearAll();
    }
  }

  private handleKeyboard() {
    // Pause
    if (keyJustPressed('Escape') || keyJustPressed('KeyP')) {
      if (this.game.phase === 'playing') {
        this.game.phase = 'paused';
        this.uiManager.showPanel('pause');
      }
    }

    // Undo in practice
    if (keyJustPressed('KeyU') && this.game.phase === 'playing') {
      if (this.game.undo()) {
        // Rebuild board visuals
        this.boardRenderer.buildBoard(this.game);
        for (let c = 0; c < this.game.cols; c++) {
          for (let r = 0; r < this.game.rows; r++) {
            if (this.game.board.board[c][r] !== 0) {
              this.boardRenderer.addDisc(c, r, this.game.board.board[c][r], this.game, false);
            }
          }
        }
        this.audio.popout();
      }
    }

    // Hint in practice mode
    if (keyJustPressed('KeyH') && this.game.phase === 'playing' && this.game.mode === 'practice') {
      const hint = this.game.getHintCol();
      if (hint >= 0) {
        this.game.hintCol = hint;
        this.hintActive = true;
        this.hintFlashTimer = 3; // show hint for 3 seconds
        this.audio.select();
        this.uiManager.showToast(`Hint: Column ${hint + 1}`);
      }
    }

    // Rematch shortcut
    if (keyJustPressed('KeyR') && this.game.phase === 'gameover') {
      this.uiManager.startWithCountdown(this.game.difficulty);
    }

    // Number keys for column selection (1-7 or 1-9)
    for (let i = 1; i <= this.game.cols; i++) {
      if (keyJustPressed(`Digit${i}`)) {
        this.doPlayerMove(i - 1);
      }
    }

    // XR controller input via gamepads on world.input (typed as XRInputManager)
    const xrInput = this.world.input;
    const right = xrInput.gamepads?.right;
    if (right) {
      if (right.getButtonDown(InputComponent.Trigger) && this.hoveredCol >= 0) {
        this.doPlayerMove(this.hoveredCol);
      }
      if (right.getButtonDown(InputComponent.B_Button)) {
        if (this.game.phase === 'playing') {
          this.game.phase = 'paused';
          this.uiManager.showPanel('pause');
        }
      }
    }
    const left = xrInput.gamepads?.left;
    if (left) {
      if (left.getButtonDown(InputComponent.Trigger) && this.hoveredCol >= 0) {
        this.doPlayerMove(this.hoveredCol);
      }
    }

    consumeKeys();
  }

  private doPlayerMove(col: number) {
    if (this.game.phase !== 'playing') return;
    if (this.game.isAiTurn || this.game.aiThinking) return;
    if (this.boardRenderer.isDropping()) return;

    if (!this.game.board.canDrop(col)) {
      this.audio.invalid();
      return;
    }

    const result = this.game.makeMove(col);
    if (!result) return;

    this.boardRenderer.addDisc(col, result.row, result.player, this.game);
    this.audio.dropMusical(col, this.game.cols);
    this.boardRenderer.hideGhost();
    this.hintActive = false;

    // Schedule particle splash and shake when disc lands
    const dropTime = (this.game.rows - result.row) * CELL / DROP_SPEED;
    setTimeout(() => {
      const pos = this.boardRenderer.getDiscWorldPos(col, result.row, this.game);
      const clr = result.player === 1 ? new Color(SKINS[save.equippedSkin].color) : new Color(0xff44ff);
      this.particles.emitDropSplash(pos.x, pos.y, pos.z, clr);
      this.boardRenderer.triggerShake(0.01);
      this.boardRenderer.markLastMove(col, result.row, this.game);
    }, dropTime * 1000);

    // Check if game ended (makeMove can set phase to gameover)
    if ((this.game.phase as string) === 'gameover') {
      this.handleGameOver();
    }
  }

  private handleGameOver() {
    // Delay to show the final disc drop
    setTimeout(() => {
      if (this.game.winCells.length > 0) {
        this.boardRenderer.showWin(this.game.winCells, this.game);
        // Win celebration particles
        const winPositions = this.game.winCells.map(c =>
          this.boardRenderer.getDiscWorldPos(c.col, c.row, this.game)
        );
        const winColor = this.game.winner === 1 ? new Color(SKINS[save.equippedSkin].color) : new Color(0xff44ff);
        this.particles.emitWinCelebration(
          winPositions.map(p => ({ x: p.x, y: p.y, z: p.z })),
          winColor
        );
        // Draw win line
        this.winLine.show(winPositions, winColor);
        this.boardRenderer.triggerShake(0.025);
      }

      if (this.game.winner === 1) this.audio.win();
      else if (this.game.winner === 2) this.audio.lose();
      else this.audio.draw();

      // Check achievements
      const newAchs = this.game.checkAchievements();
      if (newAchs.length > 0) {
        this.audio.achievement();
        this.uiManager.showToast(`Achievement: ${newAchs[0]}!`);
      }

      this.uiManager.showPanel('gameover');
      this.uiManager.updateGameover();
    }, 600);
  }
}

// ─── Entry Point ────────────────────────────────────────────────────
async function main() {
  save = loadSave();
  const container = document.getElementById('app') as HTMLDivElement;

  const world = await World.create(container, {
    xr: { offer: 'once' as const },
    render: {
      fov: 60,
      near: 0.01,
      far: 200,
      defaultLighting: true,
    },
    features: {
      grabbing: false,
      locomotion: true,
      physics: false,
      spatialUI: true,
    },
  } as any);

  // Set initial camera position
  world.camera.position.set(0, 1.6, 0);
  world.camera.lookAt(0, 1.3, -1.8);

  // Set background color
  const theme = THEMES[save.theme];
  world.scene.background = new Color(theme.bg);

  // Initialize managers
  const game = new GameManager();
  const audio = new AudioManager();
  audio.init();
  const boardRenderer = new BoardRenderer();
  boardRenderer.init(world, game);

  // Particle systems
  const particles = new ParticleSystem(world.scene);
  const ambient = new AmbientParticles(world.scene, theme.grid);
  const winLine = new WinLineRenderer(world.scene);
  const columnArrows = new ColumnArrows(world.scene, COLS_STD, new Vector3(0, BOARD_Y, BOARD_Z));
  const reflection = new BoardReflection(world.scene, BOARD_Y);
  const timerWarning = new TimerWarning(world.scene);

  // Background music
  const music = new MusicSystem();
  const musicGain = audio.getMusicGain();
  const audioCtx = audio.getContext();
  if (audioCtx && musicGain) {
    music.init(audioCtx, musicGain);
  }

  // Register game loop system BEFORE UI (UI init may throw)
  world.registerSystem(GameLoopSystem);

  const uiManager = new UIManager();
  uiManager.init(world, game, audio, boardRenderer, columnArrows);

  const loop = world.getSystem(GameLoopSystem)!;
  loop.setRefs({ game, boardRenderer, uiManager, audio, particles, ambient, winLine, music, columnArrows, reflection, timerWarning });
}

main().catch(console.error);
