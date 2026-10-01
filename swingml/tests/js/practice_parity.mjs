/* Run the browser's practice rules headlessly, for tests/test_browser_practice.py.
 *
 * Reads one JSON job on argv (the rules, and swings to choose a priority for,
 * sets to compare, a clip to take the camera's signature from, and a plan to play
 * through the log); writes one JSON result to stdout. How the answers are
 * compared with the Python ones lives in the test.
 */
import { readFileSync } from "node:fs";
import { PoseSequence } from "../../webapp/engine.js";
import { PracticeLog, cameraSignature, choosePriority, compareSwings, formatG3 }
  from "../../webapp/practice.js";

const job = JSON.parse(readFileSync(process.argv[2], "utf8"));
const rules = job.rules;

const result = {
  choose: job.choose.map((recent) => choosePriority(rules, recent)),
  compare: job.compare.map((c) => compareSwings(rules, c.before, c.after, c.metric, c.direction)),
  g3: job.g3.map(formatG3),
};

if (job.camera) {
  const c = job.camera;
  const sequence = new PoseSequence(c.xy, c.visibility, null, c.detected, c.times, c.width, c.height);
  result.camera = c.frames.map((f) => cameraSignature(sequence, f));
}

if (job.plan) {
  // A golfer's afternoon: swings recorded, a plan started from the last of them,
  // retest swings recorded for it.
  const memory = new Map();
  const storage = {
    getItem: (k) => (memory.has(k) ? memory.get(k) : null),
    setItem: (k, v) => memory.set(k, String(v)),
    removeItem: (k) => memory.delete(k),
  };
  const log = new PracticeLog(storage);
  for (const swing of job.plan.before) log.add(swing);
  const last = log.swings[log.swings.length - 1].id;
  const insight = log.insightFor(rules, last);
  const plan = log.startPlan(rules, job.plan.focus, last);
  for (const swing of job.plan.after) log.add(swing, true);
  const reopened = new PracticeLog(storage);
  result.plan = {
    insight,
    baseline: plan.baseline,
    retest: reopened.activePlan().retest,
    change: reopened.planChange(rules, reopened.activePlan()),
    capture: reopened.captureProgress(reopened.activePlan()),
    closed: reopened.closePlan("completed"),
    active: reopened.activePlan(),
    erased: reopened.eraseAll(),
    afterErase: new PracticeLog(storage).swings.length,
  };
}

if (job.ops) {
  // A scripted sequence against one log: add (optionally for the plan), start a
  // plan, remove a swing. Returns the log and the active plan's verdict.
  const memory = new Map();
  const storage = {
    getItem: (k) => (memory.has(k) ? memory.get(k) : null),
    setItem: (k, v) => memory.set(k, String(v)),
    removeItem: (k) => memory.delete(k),
  };
  const log = new PracticeLog(storage);
  const removed = [];
  for (const op of job.ops) {
    if (op.op === "add") log.add(op.record, Boolean(op.forPlan));
    else if (op.op === "start") log.startPlan(rules, op.focus, op.from);
    else if (op.op === "remove") removed.push(log.remove(op.id));
  }
  const plan = log.activePlan();
  result.ops = {
    swings: log.swings,
    plan,
    change: plan ? log.planChange(rules, plan) : null,
    capture: plan ? log.captureProgress(plan) : null,
    removed,
    reloaded: new PracticeLog(storage).swings.length,
  };
}

process.stdout.write(JSON.stringify(result));
