/**
 * The application: everything the page can do, wired to one logical cube.
 *
 * There is one piece of state that matters - `this.cube` - and everything else
 * is a view of it. Moves go through `applyMove`, which updates the logical cube
 * first and then asks the renderer to catch up, so what is on screen can lag
 * the truth by an animation but can never disagree with it.
 */

import { Cube } from '../core/cube.js';
import { toFacelets, fromFacelets } from '../core/facelets.js';
import {
  invertMove,
  moveToString,
  parseSequence,
  sequenceToString,
  type Move,
} from '../core/moves.js';
import { PATTERNS, patternMoves } from '../core/patterns.js';
import { randomScramble } from '../core/scramble.js';
import { prepareTables, tablesAreReady } from '../core/tables.js';
import { solveBeginner, type SolutionStep } from '../solvers/beginner.js';
import { solveTwoPhase } from '../solvers/twoPhase.js';
import { LESSONS, type Lesson } from '../teach/lessons.js';
import { drillFor, hint, progress } from '../teach/practice.js';
import { moveFromDrag } from './geometry.js';
import { PALETTES, paletteById } from './palette.js';
import { CubeScene } from './scene.js';
import { formatTime, summarise, type Attempt } from './stats.js';
import {
  DEFAULT_SETTINGS,
  clearAttempts,
  loadAttempts,
  loadSettings,
  saveAttempts,
  saveSettings,
  type Settings,
} from './storage.js';
import { SolveTimer } from './timer.js';

const $ = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`the page is missing #${id}`);
  return element as T;
};

interface Playback {
  steps: SolutionStep[];
  moves: Move[];
  index: number;
  playing: boolean;
  label: string;
}

const KEY_MOVES: Record<string, string> = {
  u: 'U',
  d: 'D',
  l: 'L',
  r: 'R',
  f: 'F',
  b: 'B',
};

export class App {
  private cube = Cube.solved();
  private readonly scene: CubeScene;
  private settings: Settings = DEFAULT_SETTINGS;

  private readonly queue: Move[] = [];
  private turning = false;
  private lastFrame = 0;

  private history: Move[] = [];
  private redoStack: Move[] = [];
  private scrambleText = '';

  private playback: Playback | null = null;
  private playbackClock = 0;

  private lesson: Lesson = LESSONS[0] as Lesson;
  private attempts: Attempt[] = [];
  private timer = new SolveTimer(true);
  private statusTimeout = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.scene = new CubeScene(canvas);
    this.settings = loadSettings();
    this.attempts = loadAttempts();
    this.timer = new SolveTimer(this.settings.useInspection);

    this.scene.setPalette(paletteById(this.settings.paletteId));
    this.scene.paint(this.cube);

    this.buildControls();
    this.bindPointer(canvas);
    this.bindKeyboard();
    this.renderLadder();
    this.showLesson(this.lesson);
    this.renderTimes();
    this.renderHistory();

    window.addEventListener('resize', () => this.scene.resize());
    requestAnimationFrame((time) => this.frame(time));

    // The two-phase solver needs about four megabytes of tables. Building them
    // in the background means the button is ready before anybody presses it.
    void prepareTables((label, fraction) => {
      if (fraction < 1) this.status(`Preparing the solver: ${label}…`, 4000);
      else this.status('Solver ready.', 1400);
    });
  }

  /* --------------------------------------------------------------- moves */

  private applyMove(move: Move, record = true): void {
    this.cube = this.cube.move(move);
    if (record) {
      this.history.push(move);
      this.redoStack = [];
      this.renderHistory();
    }
    this.queue.push(move);
    this.afterChange();
  }

  private setCube(cube: Cube, label: string): void {
    this.cube = cube;
    this.queue.length = 0;
    this.scene.settle();
    this.scene.paint(cube);
    this.afterChange();
    if (label) this.status(label, 2200);
  }

  private afterChange(): void {
    this.renderLadder();
    if (this.cube.isSolved()) {
      const time = this.timer.stop(performance.now());
      if (time !== null) this.recordAttempt();
    }
  }

  /* --------------------------------------------------------------- frame */

  private frame(time: number): void {
    const delta = this.lastFrame === 0 ? 16 : time - this.lastFrame;
    this.lastFrame = time;

    if (this.turning) {
      if (this.scene.advance(delta)) {
        this.turning = false;
        this.scene.settle();
        this.scene.paint(this.cube);
      }
    } else if (this.queue.length > 0) {
      const move = this.queue.shift() as Move;
      // The logical cube already has the move applied, so the renderer is
      // shown the state *before* it and then animated into place.
      this.scene.settle();
      this.scene.paint(this.applied(move));
      this.scene.beginTurn(move, this.settings.animationMs);
      this.turning = this.settings.animationMs > 0;
      if (!this.turning) this.scene.paint(this.cube);
    }

    if (this.playback?.playing && !this.turning && this.queue.length === 0) {
      this.playbackClock += delta;
      if (this.playbackClock > Math.max(120, this.settings.animationMs + 60)) {
        this.playbackClock = 0;
        if (!this.stepForward()) this.setPlaying(false);
      }
    }

    this.renderTimer();
    this.scene.render();
    requestAnimationFrame((next) => this.frame(next));
  }

  /** The cube as it was before `move` was applied - for rendering the turn. */
  private applied(move: Move): Cube {
    return this.cube.move(invertMove(move));
  }

  /* ------------------------------------------------------------ controls */

  private buildControls(): void {
    const palette = $<HTMLSelectElement>('palette');
    for (const entry of PALETTES) {
      const option = document.createElement('option');
      option.value = entry.id;
      option.textContent = entry.name;
      option.title = entry.note;
      palette.append(option);
    }
    palette.value = this.settings.paletteId;
    palette.addEventListener('change', () => {
      this.settings.paletteId = palette.value;
      saveSettings(this.settings);
      this.scene.setPalette(paletteById(palette.value));
      this.scene.paint(this.cube);
    });

    const speed = $<HTMLInputElement>('speed');
    speed.value = String(this.settings.animationMs);
    speed.addEventListener('input', () => {
      this.settings.animationMs = Number(speed.value);
      saveSettings(this.settings);
    });

    for (const tab of document.querySelectorAll<HTMLButtonElement>('.tab')) {
      tab.addEventListener('click', () => this.selectTab(tab.dataset['tab'] ?? 'play'));
    }

    $('scramble').addEventListener('click', () => this.scramble());
    $('reset').addEventListener('click', () => {
      this.history = [];
      this.redoStack = [];
      this.scrambleText = '';
      this.renderHistory();
      this.clearPlayback();
      this.setCube(Cube.solved(), 'Back to solved.');
    });

    $('solve-fast').addEventListener('click', () => void this.solveEfficiently());
    $('solve-learn').addEventListener('click', () => this.solveTheWayYouLearn());

    $('play').addEventListener('click', () => this.setPlaying(!this.playback?.playing));
    $('step-forward').addEventListener('click', () => this.stepForward());
    $('step-back').addEventListener('click', () => this.stepBack());
    $('play-all').addEventListener('click', () => {
      while (this.stepForward(false)) {
        /* run to the end */
      }
      this.scene.settle();
      this.scene.paint(this.cube);
      this.queue.length = 0;
      this.renderPlayback();
    });

    $('undo').addEventListener('click', () => this.undo());
    $('redo').addEventListener('click', () => this.redo());

    $('apply-scramble').addEventListener('click', () => this.applyTypedScramble());
    $<HTMLInputElement>('scramble-input').addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Enter') this.applyTypedScramble();
    });
    $('copy-state').addEventListener('click', () => {
      const facelets = toFacelets(this.cube);
      void navigator.clipboard?.writeText(facelets);
      this.status('Facelet string copied.', 1800);
    });

    const patterns = $('patterns');
    for (const pattern of PATTERNS) {
      const button = document.createElement('button');
      button.textContent = pattern.name;
      button.addEventListener('click', () => {
        this.clearPlayback();
        this.history = [];
        this.redoStack = [];
        this.renderHistory();
        this.setCube(Cube.solved().apply(patternMoves(pattern)), '');
        $('pattern-note').textContent = pattern.note;
        this.status(pattern.name, 2000);
      });
      patterns.append(button);
    }

    $('hint').addEventListener('click', () => this.showHint());
    $('apply-hint').addEventListener('click', () => this.applyHint());
    $('practise').addEventListener('click', () => this.practise());

    const inspection = $<HTMLInputElement>('inspection');
    inspection.checked = this.settings.useInspection;
    inspection.addEventListener('change', () => {
      this.settings.useInspection = inspection.checked;
      saveSettings(this.settings);
      this.timer = new SolveTimer(inspection.checked);
    });

    $('clear-times').addEventListener('click', () => {
      this.attempts = [];
      clearAttempts();
      this.renderTimes();
    });
  }

  private selectTab(name: string): void {
    for (const tab of document.querySelectorAll<HTMLButtonElement>('.tab')) {
      tab.setAttribute('aria-selected', String(tab.dataset['tab'] === name));
    }
    for (const panel of document.querySelectorAll<HTMLElement>('.tabpanel')) {
      panel.hidden = panel.dataset['panel'] !== name;
    }
  }

  /* ------------------------------------------------------------- pointer */

  private bindPointer(canvas: HTMLCanvasElement): void {
    let dragging: {
      cubie: [number, number, number];
      normal: [number, number, number];
      x: number;
      y: number;
    } | null = null;
    let orbiting: { x: number; y: number } | null = null;

    canvas.addEventListener('pointerdown', (event) => {
      canvas.setPointerCapture(event.pointerId);
      const hit = this.scene.pick(event.clientX, event.clientY);
      if (hit) {
        dragging = {
          cubie: hit.cubie,
          normal: [hit.normal.x, hit.normal.y, hit.normal.z],
          x: event.clientX,
          y: event.clientY,
        };
      } else {
        orbiting = { x: event.clientX, y: event.clientY };
      }
    });

    canvas.addEventListener('pointermove', (event) => {
      if (orbiting) {
        this.scene.orbit(event.clientX - orbiting.x, event.clientY - orbiting.y);
        orbiting = { x: event.clientX, y: event.clientY };
        return;
      }
      if (!dragging) return;

      const dx = event.clientX - dragging.x;
      const dy = event.clientY - dragging.y;
      if (Math.hypot(dx, dy) < 22) return;

      const move = this.moveForDrag(dragging.normal, dx, dy, dragging.cubie);
      dragging = null;
      if (move !== null) this.applyMove(move);
      else this.status('That would be a middle slice, which this cube has no notation for.', 2400);
    });

    const end = (): void => {
      dragging = null;
      orbiting = null;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        this.scene.zoom(event.deltaY);
      },
      { passive: false },
    );
  }

  /**
   * Which layer a drag across a face turns.
   *
   * The drag is a direction on the screen; the world direction it corresponds
   * to is found by projecting the camera's right and up vectors onto the face,
   * and the rotation axis is that direction crossed with the face normal.
   */
  private moveForDrag(
    normal: [number, number, number],
    dx: number,
    dy: number,
    cubie: [number, number, number],
  ): number | null {
    const camera = this.scene.camera;
    const right: [number, number, number] = [
      camera.matrixWorld.elements[0] ?? 0,
      camera.matrixWorld.elements[1] ?? 0,
      camera.matrixWorld.elements[2] ?? 0,
    ];
    const up: [number, number, number] = [
      camera.matrixWorld.elements[4] ?? 0,
      camera.matrixWorld.elements[5] ?? 0,
      camera.matrixWorld.elements[6] ?? 0,
    ];

    // Screen y grows downwards, so an upward drag is a negative dy.
    const world: [number, number, number] = [
      right[0] * dx - up[0] * dy,
      right[1] * dx - up[1] * dy,
      right[2] * dx - up[2] * dy,
    ];
    const along = world[0] * normal[0] + world[1] * normal[1] + world[2] * normal[2];
    const flat: [number, number, number] = [
      world[0] - normal[0] * along,
      world[1] - normal[1] * along,
      world[2] - normal[2] * along,
    ];

    const axis: [number, number, number] = [
      flat[1] * normal[2] - flat[2] * normal[1],
      flat[2] * normal[0] - flat[0] * normal[2],
      flat[0] * normal[1] - flat[1] * normal[0],
    ];
    return moveFromDrag(axis, cubie);
  }

  private bindKeyboard(): void {
    window.addEventListener('keydown', (event) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;

      if (event.code === 'Space') {
        event.preventDefault();
        if (!event.repeat) this.timer.press(performance.now());
        return;
      }

      const face = KEY_MOVES[event.key.toLowerCase()];
      if (face === undefined) return;
      event.preventDefault();
      const notation = event.shiftKey ? `${face}'` : event.altKey ? `${face}2` : face;
      this.applyMove(parseSequence(notation)[0] as Move);
    });

    window.addEventListener('keyup', (event) => {
      if (event.code === 'Space') {
        event.preventDefault();
        this.timer.release(performance.now());
      }
    });
  }

  /* -------------------------------------------------------------- solving */

  private scramble(): void {
    const moves = randomScramble(20);
    this.scrambleText = sequenceToString(moves);
    this.history = [];
    this.redoStack = [];
    this.renderHistory();
    this.clearPlayback();
    this.timer.reset();
    this.setCube(Cube.solved().apply(moves), `Scrambled: ${this.scrambleText}`);
  }

  private async solveEfficiently(): Promise<void> {
    if (this.cube.isSolved()) {
      this.status('It is already solved.', 1800);
      return;
    }
    if (!tablesAreReady()) {
      this.status('Building the solver tables, one moment…', 4000);
      await prepareTables();
    }
    const result = solveTwoPhase(this.cube, { targetLength: 21, timeLimitMs: 1200 });
    this.startPlayback({
      steps: result.moves.map((move) => ({
        stage: 'two-phase',
        title: 'Two-phase solution',
        detail:
          "Kociemba's algorithm works in two stages: first it reaches a position that can be " +
          'finished with only half turns on four faces, then it finishes it. The individual ' +
          'moves do not correspond to anything a person would recognise.',
        moves: [move],
        before: this.cube,
      })),
      moves: result.moves,
      index: 0,
      playing: false,
      label: `${result.moves.length} moves in ${result.milliseconds} ms`,
    });
  }

  private solveTheWayYouLearn(): void {
    if (this.cube.isSolved()) {
      this.status('It is already solved.', 1800);
      return;
    }
    const solution = solveBeginner(this.cube);
    this.startPlayback({
      steps: solution.steps,
      moves: solution.steps.flatMap((step) => step.moves),
      index: 0,
      playing: false,
      label: `${solution.steps.length} steps, ${solution.moves.length} moves`,
    });
  }

  /* ------------------------------------------------------------ playback */

  private startPlayback(playback: Playback): void {
    this.playback = playback;
    $('playback').hidden = false;
    $('solution-moves').textContent = sequenceToString(playback.moves);
    this.renderPlayback();
    this.status(playback.label, 3000);
  }

  private clearPlayback(): void {
    this.playback = null;
    $('playback').hidden = true;
  }

  private setPlaying(playing: boolean): void {
    if (!this.playback) return;
    this.playback.playing = playing;
    $('play').textContent = playing ? 'Pause' : 'Play';
  }

  private stepForward(render = true): boolean {
    const playback = this.playback;
    if (!playback || playback.index >= playback.moves.length) return false;
    const move = playback.moves[playback.index] as Move;
    playback.index += 1;
    this.applyMove(move, false);
    if (render) this.renderPlayback();
    return true;
  }

  private stepBack(): boolean {
    const playback = this.playback;
    if (!playback || playback.index === 0) return false;
    playback.index -= 1;
    const move = playback.moves[playback.index] as Move;
    this.applyMove(invertMove(move), false);
    this.renderPlayback();
    return true;
  }

  private renderPlayback(): void {
    const playback = this.playback;
    if (!playback) return;

    $('playback-progress').textContent =
      `Move ${playback.index} of ${playback.moves.length}. ${playback.label}.`;

    // Find the step the next move belongs to.
    let seen = 0;
    let current: SolutionStep | undefined;
    for (const step of playback.steps) {
      if (playback.index < seen + step.moves.length) {
        current = step;
        break;
      }
      seen += step.moves.length;
    }
    const detail = $('step-detail');
    detail.innerHTML = '';
    if (!current) {
      detail.textContent = 'Finished.';
      return;
    }
    detail.append(this.describeStep(current));
  }

  private describeStep(step: SolutionStep): DocumentFragment {
    const fragment = document.createDocumentFragment();
    if (step.technique) {
      const technique = document.createElement('span');
      technique.className = 'technique';
      technique.textContent = step.technique;
      fragment.append(technique);
    }
    const heading = document.createElement('strong');
    heading.textContent = step.title;
    fragment.append(heading, document.createTextNode(` — ${step.detail}`));
    if (step.why) {
      const why = document.createElement('p');
      why.className = 'why';
      why.textContent = step.why;
      fragment.append(why);
    }
    const moves = document.createElement('p');
    moves.className = 'why';
    moves.textContent = sequenceToString(step.moves);
    fragment.append(moves);
    return fragment;
  }

  /* ------------------------------------------------------- undo and redo */

  private undo(): void {
    const move = this.history.pop();
    if (move === undefined) return;
    this.redoStack.push(move);
    this.applyMove(invertMove(move), false);
    this.renderHistory();
  }

  private redo(): void {
    const move = this.redoStack.pop();
    if (move === undefined) return;
    this.history.push(move);
    this.applyMove(move, false);
    this.renderHistory();
  }

  private renderHistory(): void {
    $('history').textContent =
      this.history.length === 0 ? '—' : this.history.map(moveToString).join(' ');
    $<HTMLButtonElement>('undo').disabled = this.history.length === 0;
    $<HTMLButtonElement>('redo').disabled = this.redoStack.length === 0;
  }

  private applyTypedScramble(): void {
    const input = $<HTMLInputElement>('scramble-input');
    const error = $('scramble-error');
    const text = input.value.trim();
    error.textContent = '';
    if (text === '') return;

    try {
      const moves = text.length === 54 && !/\s/.test(text) ? null : parseSequence(text);
      if (moves === null) {
        this.setCube(fromFacelets(text), 'Loaded from a facelet string.');
      } else {
        this.scrambleText = sequenceToString(moves);
        this.setCube(Cube.solved().apply(moves), `Applied ${moves.length} moves.`);
      }
      this.history = [];
      this.redoStack = [];
      this.renderHistory();
      this.clearPlayback();
    } catch (problem) {
      error.textContent = (problem as Error).message;
    }
  }

  /* --------------------------------------------------------------- learn */

  private renderLadder(): void {
    const report = progress(this.cube);
    const ladder = $('ladder');
    ladder.innerHTML = '';
    LESSONS.forEach((lesson, index) => {
      const item = document.createElement('li');
      item.textContent = lesson.title;
      if (report.done[index]) item.classList.add('done');
      if (report.current?.id === lesson.id) item.classList.add('current');
      item.addEventListener('click', () => this.showLesson(lesson));
      ladder.append(item);
    });
  }

  private showLesson(lesson: Lesson): void {
    this.lesson = lesson;
    $('lesson-title').textContent = `${lesson.index + 1}. ${lesson.title}`;
    $('lesson-goal').textContent = lesson.goal;
    $('lesson-idea').textContent = lesson.idea;
    $('lesson-look').textContent = lesson.lookFor;
    $('lesson-mistake').textContent = lesson.commonMistake;

    const list = $('lesson-algorithms');
    list.innerHTML = '';
    for (const algorithm of lesson.algorithms) {
      const card = document.createElement('div');
      card.className = 'algorithm';

      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = algorithm.name;

      const notation = document.createElement('div');
      notation.className = 'notation';
      notation.textContent = algorithm.notation;
      notation.title = 'Apply it to the cube';
      notation.addEventListener('click', () => {
        for (const move of parseSequence(algorithm.notation)) this.applyMove(move);
        this.status(`Applied ${algorithm.name}.`, 1800);
      });

      const effect = document.createElement('p');
      effect.textContent = algorithm.effect;
      const why = document.createElement('p');
      why.textContent = algorithm.why;

      card.append(name, notation, effect, why);
      list.append(card);
    }
  }

  private showHint(): void {
    const detail = $('hint-detail');
    detail.innerHTML = '';
    const next = hint(this.cube);
    if (!next) {
      detail.textContent = 'Nothing to do — the cube is solved.';
      return;
    }
    detail.append(this.describeStep(next.step));
    const remaining = document.createElement('p');
    remaining.className = 'why';
    remaining.textContent = `${next.stepsRemaining} steps to go from here.`;
    detail.append(remaining);
    this.showLesson(next.lesson);
  }

  private applyHint(): void {
    const next = hint(this.cube);
    if (!next) {
      this.status('Nothing to do — the cube is solved.', 1800);
      return;
    }
    for (const move of next.step.moves) this.applyMove(move);
    this.showHint();
  }

  private practise(): void {
    try {
      const drill = drillFor(this.lesson.id);
      this.history = [];
      this.redoStack = [];
      this.renderHistory();
      this.clearPlayback();
      this.setCube(drill.cube, `Set up for: ${drill.lesson.title}`);
    } catch (problem) {
      this.status((problem as Error).message, 3000);
    }
  }

  /* ---------------------------------------------------------------- time */

  private renderTimer(): void {
    const state = this.timer.state(performance.now());
    const element = $('timer');
    element.classList.toggle('inspecting', state.phase === 'inspecting');
    element.classList.toggle('armed', state.phase === 'armed');
    element.classList.toggle('penalty', state.penalty !== 'none');

    if (state.phase === 'inspecting' || state.phase === 'armed') {
      const left = Math.max(0, 15 - state.elapsed / 1000);
      element.textContent =
        state.penalty === 'dnf' ? 'DNF' : state.penalty === 'plus2' ? '+2' : left.toFixed(0);
    } else {
      element.textContent = formatTime(state.elapsed);
    }
  }

  private recordAttempt(): void {
    const result = this.timer.result;
    if (!result) return;
    const attempt: Attempt = {
      time: result.time,
      ...(result.penalty !== 'none' ? { penalty: result.penalty } : {}),
      scramble: this.scrambleText,
      at: Date.now(),
    };
    this.attempts = [...this.attempts, attempt];
    saveAttempts(this.attempts);
    this.renderTimes();
    this.status(`Solved in ${formatTime(result.time)}.`, 3000);
  }

  private renderTimes(): void {
    const summary = summarise(this.attempts);
    const stats = $('stats');
    stats.innerHTML = '';
    const rows: [string, string][] = [
      ['Solves', String(summary.solves)],
      ['Best', formatTime(summary.best)],
      ['Mean', formatTime(summary.mean)],
      ['ao5', formatTime(summary.ao5)],
      ['ao12', formatTime(summary.ao12)],
      ['Best ao5', formatTime(summary.bestAo5)],
    ];
    for (const [label, value] of rows) {
      const term = document.createElement('dt');
      term.textContent = label;
      const definition = document.createElement('dd');
      definition.textContent = value;
      stats.append(term, definition);
    }

    const list = $('solves');
    list.innerHTML = '';
    for (const attempt of [...this.attempts].reverse().slice(0, 60)) {
      const item = document.createElement('li');
      const time = document.createElement('span');
      time.className = 'time';
      time.textContent =
        formatTime(attempt.time) +
        (attempt.penalty === 'plus2' ? ' +2' : attempt.penalty === 'dnf' ? ' DNF' : '');
      const scramble = document.createElement('span');
      scramble.className = 'scramble';
      scramble.textContent = attempt.scramble || '—';
      scramble.title = attempt.scramble;

      const load = document.createElement('button');
      load.textContent = 'Load';
      load.addEventListener('click', () => {
        if (!attempt.scramble) return;
        this.setCube(Cube.solved().apply(parseSequence(attempt.scramble)), 'Scramble loaded.');
      });

      item.append(time, scramble, load);
      list.append(item);
    }
  }

  /* -------------------------------------------------------------- status */

  private status(message: string, durationMs: number): void {
    const element = $('status');
    element.textContent = message;
    element.classList.add('show');
    window.clearTimeout(this.statusTimeout);
    this.statusTimeout = window.setTimeout(() => element.classList.remove('show'), durationMs);
  }
}
