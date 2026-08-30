#!/usr/bin/env node
/*
 * Installer for the vimoxshah/skills collection.
 *
 *   npx github:vimoxshah/skills            interactive install
 *   npx @vimoxshah/skills update           refresh the central checkout, relink
 *   npx @vimoxshah/skills doctor           check what is wired up
 *   npx @vimoxshah/skills uninstall        remove exactly what we installed
 *   npx @vimoxshah/skills list             show bundles, skills and agents
 *
 * Zero dependencies. Node >= 18. ES modules.
 *
 * Two files are the contract:
 *   manifest.json   bundles (skills / agents / commands / routing) + central dir
 *   harnesses.json  where each harness reads skills and agents, and how its
 *                   agents are written (agents.format)
 *
 * One rule above all: never delete a real directory, and never write outside
 * $HOME paths derived from harnesses.json (plus the central dir itself).
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_ROOT = path.resolve(HERE, '..');
const HOME = os.homedir();
const IS_WIN = process.platform === 'win32';
const RECEIPT_NAME = '.installed.json';
const RECEIPT_VERSION = 1;

/* ------------------------------------------------------------------ fs bits */
/* lstat, never existsSync: existsSync says "no" for a broken symlink, which is
 * exactly the state a stale install leaves behind. */

function lstat(p) {
  try { return fs.lstatSync(p); } catch { return null; }
}
function statOf(p) {
  try { return fs.statSync(p); } catch { return null; }
}
function present(p) {
  return lstat(p) !== null;
}
function isDirNow(p) {
  const s = statOf(p);
  return !!s && s.isDirectory();
}
function linkTarget(p) {
  try { return path.resolve(path.dirname(p), fs.readlinkSync(p)); } catch { return null; }
}
function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}
function readText(p) {
  return fs.readFileSync(p, 'utf8');
}
function writeText(p, text) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, text, 'utf8');
}
function removeTree(p) {
  fs.rmSync(p, { recursive: true, force: true });
}
function copyTree(src, dest) {
  ensureDir(path.dirname(dest));
  fs.cpSync(src, dest, { recursive: true, dereference: true });
}
function makeSymlink(src, dest) {
  ensureDir(path.dirname(dest));
  const type = isDirNow(src) ? (IS_WIN ? 'junction' : 'dir') : 'file';
  fs.symlinkSync(src, dest, type);
}
function tilde(p) {
  const r = path.resolve(p);
  if (r === HOME) return '~';
  if (r.startsWith(HOME + path.sep)) return '~/' + path.relative(HOME, r).split(path.sep).join('/');
  return r;
}
function underHome(p) {
  const r = path.resolve(p);
  return r === HOME || r.startsWith(HOME + path.sep);
}
function inside(parent, child) {
  const a = path.resolve(parent);
  const b = path.resolve(child);
  return b === a || b.startsWith(a + path.sep);
}
function readJson(p) {
  return JSON.parse(readText(p));
}

/* --------------------------------------------------------- frontmatter YAML */
/* A deliberately small YAML reader: flat keys, quoted scalars, `>`/`|` blocks
 * and inline JSON arrays. That is everything SKILL.md and agents/*.md use. */

function unquote(s) {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    try { return JSON.parse(s); } catch { return s.slice(1, -1); }
  }
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  return s;
}

function foldLines(lines) {
  const out = [];
  let run = [];
  for (const line of lines) {
    if (line.trim() === '') {
      if (run.length) { out.push(run.join(' ')); run = []; }
      out.push('');
    } else {
      run.push(line.trim());
    }
  }
  if (run.length) out.push(run.join(' '));
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

export function parseFrontmatter(text) {
  const src = String(text).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (!src.startsWith('---\n')) return { data: {}, body: src };
  const lines = src.split('\n');
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---' || lines[i] === '...') { end = i; break; }
  }
  if (end === -1) return { data: {}, body: src };

  const data = {};
  let i = 1;
  while (i < end) {
    const m = /^([A-Za-z0-9_.-]+):[ \t]*(.*)$/.exec(lines[i]);
    if (!m) { i++; continue; }
    const key = m[1];
    const rest = m[2].trim();
    const block = /^([|>])([+-]?)$/.exec(rest);
    if (block || rest === '') {
      const collected = [];
      let j = i + 1;
      for (; j < end; j++) {
        if (lines[j].trim() === '') { collected.push(''); continue; }
        if (!/^[ \t]/.test(lines[j])) break;
        collected.push(lines[j].replace(/^[ \t]+/, ''));
      }
      const hasText = collected.some((l) => l !== '');
      if (hasText) {
        const folded = !block || block[1] === '>';
        let value = folded ? foldLines(collected) : collected.join('\n');
        if (!block || block[2] !== '+') value = value.replace(/\n+$/, '');
        data[key] = value;
      } else {
        data[key] = '';
      }
      i = Math.max(j, i + 1);
      continue;
    }
    data[key] = unquote(rest);
    i++;
  }
  return { data, body: lines.slice(end + 1).join('\n').replace(/^\n+/, '') };
}

export function parseToolList(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value.map(String);
  const s = String(value).trim();
  if (s === '') return [];
  if (s.startsWith('[')) {
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      return s.replace(/^\[/, '').replace(/\]$/, '')
        .split(',').map((t) => t.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    }
  }
  return s.split(',').map((t) => t.trim()).filter(Boolean);
}

/* ------------------------------------------------------------- YAML writing */
/* Descriptions carry colons, em dashes and quotes. A plain scalar would be
 * invalid YAML, so every free-text value goes out as a folded block scalar. */

function collapse(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}
function yamlBlock(key, value) {
  return `${key}: >-\n  ${collapse(value)}`;
}
function yamlPlain(key, value) {
  const v = String(value);
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(v) ? `${key}: ${v}` : `${key}: ${JSON.stringify(v)}`;
}
function frontmatter(lines, body) {
  return ['---', ...lines, '---', ''].join('\n') + '\n' + String(body).trimEnd() + '\n';
}

/* -------------------------------------------------------------- transpilers */

const OPENCODE_MODELS = {
  fable: 'anthropic/claude-fable-5',
  opus: 'anthropic/claude-opus-5',
  sonnet: 'anthropic/claude-sonnet-5',
  haiku: 'anthropic/claude-haiku-4-5',
};
const OPENCODE_TOOLS = ['read', 'grep', 'glob', 'bash', 'edit', 'write'];

export function readAgent(file, name) {
  const { data, body } = parseFrontmatter(readText(file));
  return {
    name: data.name || name || path.basename(file, '.md'),
    description: data.description || '',
    tools: parseToolList(data.tools),
    model: String(data.model || '').trim().toLowerCase(),
    body,
  };
}

export function toOpencodeAgent(agent) {
  const granted = new Set(agent.tools.map((t) => t.toLowerCase()));
  const head = [yamlBlock('description', agent.description || agent.name), 'mode: subagent'];
  const model = OPENCODE_MODELS[agent.model];
  if (model) head.push(`model: ${model}`);
  head.push('tools:');
  for (const tool of OPENCODE_TOOLS) head.push(`  ${tool}: ${granted.has(tool)}`);
  return frontmatter(head, agent.body);
}

export function toCursorAgent(agent) {
  // No model line: Cursor's model ids are not ours to guess.
  return frontmatter(
    [yamlPlain('name', agent.name), yamlBlock('description', agent.description || agent.name)],
    agent.body,
  );
}

export function toSkillFromAgent(agent) {
  const name = `${agent.name}-agent`;
  return frontmatter(
    [yamlPlain('name', name), yamlBlock('description', agent.description || name)],
    agent.body,
  );
}

function tomlString(value) {
  return '"' + String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/[\u0000-\u001F\u007F]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')) + '"';
}

export function tomlMultiline(body) {
  // In a TOML multi-line basic string a backslash starts an escape, so a body
  // holding \d or a Windows path is a parse error, not a cosmetic problem.
  // Escape backslashes first, then any run of three quotes.
  return String(body)
    .replace(/\r\n/g, '\n')
    .replace(/\\/g, '\\\\')
    .replace(/"""/g, '\\"\\"\\"')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .trimEnd();
}

export function toCodexAgent(agent) {
  // Underscored name to match the shape Codex agents already use on disk;
  // the file keeps the hyphenated stem so it lines up with agents/<name>.md.
  const name = agent.name.replace(/[^A-Za-z0-9_]+/g, '_');
  return [
    `name = ${tomlString(name)}`,
    `description = ${tomlString(collapse(agent.description))}`,
    '',
    `# model hint: ${agent.model || 'unspecified'} -- Codex runs OpenAI models, so no model is pinned here.`,
    '',
    'developer_instructions = """',
    tomlMultiline(agent.body),
    '"""',
    '',
  ].join('\n');
}

/* ----------------------------------------------------------------- CLI args */

const COMMANDS = ['install', 'update', 'doctor', 'uninstall', 'list'];

export function parseArgs(argv) {
  const args = {
    command: 'install',
    yes: false, all: false, copy: false, dryRun: false, force: false, help: false,
    bundles: null, harnesses: null, dir: null,
  };
  const rest = [...argv];
  if (rest.length && !rest[0].startsWith('-')) {
    const cmd = rest.shift();
    if (!COMMANDS.includes(cmd)) throw new Error(`unknown command "${cmd}" (try: ${COMMANDS.join(', ')})`);
    args.command = cmd;
  }
  const list = (v) => String(v).split(',').map((s) => s.trim()).filter(Boolean);
  while (rest.length) {
    const raw = rest.shift();
    const eq = raw.startsWith('--') ? raw.indexOf('=') : -1;
    const flag = eq === -1 ? raw : raw.slice(0, eq);
    const inlineValue = eq === -1 ? null : raw.slice(eq + 1);
    const take = () => {
      if (inlineValue !== null) return inlineValue;
      if (!rest.length) throw new Error(`${flag} needs a value`);
      return rest.shift();
    };
    switch (flag) {
      case '-y': case '--yes': args.yes = true; break;
      case '--all': args.all = true; break;
      case '--copy': args.copy = true; break;
      case '--force': args.force = true; break;
      case '--dry-run': args.dryRun = true; break;
      case '-h': case '--help': args.help = true; break;
      case '--bundles': args.bundles = list(take()); break;
      case '--harness': case '--harnesses': args.harnesses = list(take()); break;
      case '--dir': args.dir = take(); break;
      default: throw new Error(`unknown flag "${flag}"`);
    }
  }
  return args;
}

function printHelp() {
  console.log(`vimoxshah/skills - skills and agents for every AI coding harness

  npx @vimoxshah/skills [command] [flags]

Commands
  install      (default) pick bundles and harnesses, then wire them up
  update       git pull the central checkout, then re-run install
  doctor       report broken links, drift and harnesses that are not wired
  uninstall    remove exactly the paths in the install receipt
  list         show every bundle with its skills and agents

Flags
  -y, --yes            accept defaults, ask nothing
      --all            every bundle, every detected harness
      --bundles a,b    choose bundles by name
      --harness a,b    choose harnesses by id (plus "universal")
      --copy           copy instead of symlink (always on for Windows)
      --force          replace a conflicting path (the old one is kept as .bak.<time>)
      --dir <path>     use this directory as the central checkout
      --dry-run        print the plan, change nothing
  -h, --help           this text`);
}

/* --------------------------------------------------------- config + central */

function loadConfig(root) {
  const manifestPath = path.join(root, 'manifest.json');
  const harnessPath = path.join(root, 'harnesses.json');
  if (!present(manifestPath) || !present(harnessPath)) {
    throw new Error(`no manifest.json / harnesses.json in ${root} - run this from a checkout of the repo`);
  }
  return { manifest: readJson(manifestPath), harnesses: readJson(harnessPath) };
}

function harnessDefs(harnesses) {
  const defs = Object.entries(harnesses.harnesses).map(([id, h]) => ({ id, ...h }));
  defs.push({
    id: 'universal',
    label: `Universal root (${harnesses.universal.skills})`,
    detect: [],
    skills: harnesses.universal.skills,
    agents: null,
    universal: true,
  });
  return defs;
}

function isDetected(def) {
  return (def.detect || []).some((d) => present(path.join(HOME, d)));
}

function hasGit() {
  return spawnSync('git', ['--version'], { stdio: 'ignore' }).status === 0;
}

function runGit(cwd, args) {
  return spawnSync('git', args, { cwd, stdio: 'inherit' }).status === 0;
}

function isCheckout(dir) {
  return present(path.join(dir, 'manifest.json')) && present(path.join(dir, 'harnesses.json'));
}

function centralFor(args, manifest) {
  // Read-only commands never clone and never pull.
  if (args.dir) return path.resolve(args.dir);
  const fallback = path.join(HOME, manifest.centralDir);
  return isCheckout(fallback) ? fallback : SOURCE_ROOT;
}

async function resolveCentral(args, manifest, rl) {
  if (args.dir) {
    const dir = path.resolve(args.dir);
    // An explicit --dir wins and never runs git: it is often a CI checkout.
    if (isCheckout(dir)) return { dir, source: 'given' };
    return { dir, source: await cloneInto(dir, manifest, args) };
  }

  const fallback = path.join(HOME, manifest.centralDir);
  if (isCheckout(fallback)) return { dir: fallback, source: 'central' };

  const devCheckout = isCheckout(SOURCE_ROOT) && present(path.join(SOURCE_ROOT, '.git'));
  if (devCheckout) {
    let useIt = true;
    if (rl) {
      const answer = (await rl.question(`Use this checkout as the central dir?\n  ${tilde(SOURCE_ROOT)}  [Y/n] `)).trim().toLowerCase();
      useIt = answer === '' || answer === 'y' || answer === 'yes';
    }
    if (useIt) return { dir: SOURCE_ROOT, source: 'checkout' };
  }

  return { dir: fallback, source: await cloneInto(fallback, manifest, args) };
}

async function cloneInto(dir, manifest, args) {
  if (args.dryRun) {
    throw new Error(`nothing to plan against yet: clone it first\n  git clone --depth 1 ${manifest.repo} ${dir}`);
  }
  if (!hasGit()) {
    throw new Error(`git is not installed. Clone it by hand:\n  git clone --depth 1 ${manifest.repo} ${dir}`);
  }
  ensureDir(path.dirname(dir));
  console.log(`clone  ${manifest.repo} -> ${tilde(dir)}`);
  if (!runGit(undefined, ['clone', '--depth', '1', manifest.repo, dir])) {
    throw new Error('git clone failed');
  }
  return 'cloned';
}

/* -------------------------------------------------------------- the receipt */

function receiptPath(central) {
  return path.join(central, RECEIPT_NAME);
}

function readReceipt(central) {
  const file = receiptPath(central);
  if (!present(file)) return null;
  try {
    const data = readJson(file);
    return Array.isArray(data.entries) ? data : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------- the planning */

function planActions({ central, manifest, defs, bundles, harnessIds, mode }) {
  const actions = [];
  const notes = [];
  const problems = [];
  const seen = new Set();
  const add = (action) => {
    const key = path.resolve(action.path);
    if (seen.has(key)) return; // codex, amp and universal all land on .agents/skills
    seen.add(key);
    action.path = key;
    actions.push(action);
  };
  const chosen = defs.filter((d) => harnessIds.includes(d.id));
  const claude = defs.find((d) => d.id === 'claude');
  const claudeChosen = Boolean(harnessIds.includes('claude') && claude);

  for (const id of bundles) {
    const bundle = manifest.bundles[id];
    if (!bundle) { problems.push(`unknown bundle "${id}"`); continue; }
    if (bundle.claudeOnly && !claudeChosen) {
      notes.push(`skipped bundle "${id}" - it only applies to the claude harness`);
      continue;
    }

    for (const skill of bundle.skills || []) {
      const source = path.join(central, 'skills', skill);
      if (!present(source)) { problems.push(`missing skill in checkout: skills/${skill}`); continue; }
      for (const h of chosen) {
        add({ kind: 'skill', mode, path: path.join(HOME, h.skills, skill), source, harness: h.id, bundle: id });
      }
    }

    for (const name of bundle.agents || []) {
      const source = path.join(central, 'agents', `${name}.md`);
      if (!present(source)) { problems.push(`missing agent in checkout: agents/${name}.md`); continue; }
      const agent = readAgent(source, name);
      for (const h of chosen) {
        const format = h.agents ? h.agents.format : null;
        if (format === 'claude-md') {
          // The only agent that can be a symlink: it is used verbatim.
          add({ kind: 'agent', mode, path: path.join(HOME, h.agents.dir, `${name}.md`), source, harness: h.id, bundle: id });
        } else if (format === 'opencode-md') {
          add({ kind: 'agent', mode: 'write', path: path.join(HOME, h.agents.dir, `${name}.md`), content: toOpencodeAgent(agent), source, harness: h.id, bundle: id });
        } else if (format === 'codex-toml') {
          add({ kind: 'agent', mode: 'write', path: path.join(HOME, h.agents.dir, `${name}.toml`), content: toCodexAgent(agent), source, harness: h.id, bundle: id });
        } else if (format === 'cursor-md') {
          add({ kind: 'agent', mode: 'write', path: path.join(HOME, h.agents.dir, `${name}.md`), content: toCursorAgent(agent), source, harness: h.id, bundle: id });
        } else {
          // No native subagents here, so the agent installs as a skill.
          const dir = path.join(HOME, h.skills, `${name}-agent`);
          add({ kind: 'agent', mode: 'write', path: path.join(dir, 'SKILL.md'), content: toSkillFromAgent(agent), source, harness: h.id, bundle: id, prune: dir });
        }
      }
    }

    for (const command of bundle.commands || []) {
      if (!claudeChosen) continue;
      const source = path.join(central, 'commands', command);
      if (!present(source)) { problems.push(`missing command in checkout: commands/${command}`); continue; }
      add({ kind: 'command', mode, path: path.join(HOME, claude.commands, command), source, harness: 'claude', bundle: id });
    }

    for (const style of bundle.outputStyles || []) {
      if (!claudeChosen) continue;
      const source = path.join(central, 'output-styles', style);
      if (!present(source)) { problems.push(`missing output style in checkout: output-styles/${style}`); continue; }
      add({ kind: 'output-style', mode, path: path.join(HOME, claude.outputStyles, style), source, harness: 'claude', bundle: id });
    }

    // Routing docs are Claude-side only. The rest of the bundle - its skills and
    // its agents - still goes to every chosen harness. Only these files are gated.
    for (const file of bundle.routing || []) {
      if (!claudeChosen) {
        notes.push(`skipped routing/${file} - the claude harness is not selected`);
        continue;
      }
      const source = path.join(central, 'routing', file);
      if (!present(source)) { problems.push(`missing routing doc in checkout: routing/${file}`); continue; }
      add({ kind: 'routing', mode: 'keep', path: path.join(HOME, claude.configRoot || '.claude', file), source, harness: 'claude', bundle: id });
    }

    if (bundle.statusline && claudeChosen) {
      const script = path.join(central, 'statusline', bundle.statusline);
      if (present(script)) {
        notes.push([
          'statusline is never applied for you. Add this to ~/.claude/settings.json:',
          `    "statusLine": { "type": "command", "command": ${JSON.stringify(script)} }`,
        ].join('\n  '));
      }
    }
  }
  return { actions, notes, problems };
}

/* ------------------------------------------------------------- the doing it */

function backupPath(dest) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '');
  return `${dest}.bak.${stamp}`;
}

function runAction(action, ctx) {
  const dest = action.path;
  if (!underHome(dest)) return { op: 'skip', why: 'outside your home directory' };

  const st = lstat(dest);
  const pointsAtUs = Boolean(st && st.isSymbolicLink() && (() => {
    const t = linkTarget(dest);
    return Boolean(t) && (t === action.source || inside(ctx.central, t));
  })());
  const owned = ctx.owned.has(dest);
  const ours = owned || pointsAtUs;

  const clearTheWay = () => {
    if (!st) return true;
    if (ours) {
      if (!ctx.dryRun) {
        if (st.isSymbolicLink() || st.isFile()) fs.unlinkSync(dest);
        else removeTree(dest); // a copy we made, and the receipt says so
      }
      return true;
    }
    if (!ctx.force) return false;
    // Never delete something we did not create: move it aside instead.
    const backup = backupPath(dest);
    if (!ctx.dryRun) fs.renameSync(dest, backup);
    ctx.lines.push(`keep   ${tilde(dest)} -> ${tilde(backup)}`);
    return true;
  };

  if (action.kind === 'routing') {
    // A routing policy the user has edited is theirs. Only ever write it fresh.
    if (st) return { op: 'skip', why: 'already there, keeping your version', record: owned, mode: 'copy' };
    if (!ctx.dryRun) copyTree(action.source, dest);
    return { op: 'copy', record: true, mode: 'copy' };
  }

  if (action.mode === 'write') {
    if (st && st.isDirectory()) return { op: 'skip', why: 'a real directory is in the way' };
    if (st && ours && !st.isSymbolicLink()) {
      let same = false;
      try { same = readText(dest) === action.content; } catch { same = false; }
      if (same) return { op: 'ok', record: true, mode: 'write' };
    }
    if (!clearTheWay()) return { op: 'skip', why: 'not ours - use --force to move it aside' };
    if (!ctx.dryRun) writeText(dest, action.content);
    return { op: st ? 'update' : 'write', record: true, mode: 'write' };
  }

  if (action.mode === 'link') {
    if (st && st.isSymbolicLink() && linkTarget(dest) === action.source) {
      return { op: 'ok', record: true, mode: 'link', target: action.source };
    }
    if (!clearTheWay()) {
      const what = st && st.isDirectory() ? 'a real directory is already there' : 'not ours';
      return { op: 'skip', why: `${what} - use --force to move it aside` };
    }
    if (!ctx.dryRun) {
      try {
        makeSymlink(action.source, dest);
      } catch (err) {
        if (err.code === 'EPERM' || err.code === 'EACCES') {
          // Windows without developer mode: fall back to a copy.
          copyTree(action.source, dest);
          return { op: 'copy', record: true, mode: 'copy', note: 'symlink not permitted, copied instead' };
        }
        throw err;
      }
    }
    return { op: st ? 'relink' : 'link', record: true, mode: 'link', target: action.source };
  }

  // copy
  if (!clearTheWay()) return { op: 'skip', why: 'not ours - use --force to move it aside' };
  if (!ctx.dryRun) copyTree(action.source, dest);
  return { op: st ? 'update' : 'copy', record: true, mode: 'copy' };
}

/* --------------------------------------------------------------- selections */

function pad(s, n) {
  const v = String(s);
  return v.length >= n ? v : v + ' '.repeat(n - v.length);
}

function parseRanges(answer, max) {
  const picks = [];
  for (const token of answer.split(',').map((t) => t.trim()).filter(Boolean)) {
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(token);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      if (!a || !b || a > b || b > max) return null;
      for (let i = a; i <= b; i++) picks.push(i);
      continue;
    }
    const n = Number(token);
    if (!Number.isInteger(n) || n < 1 || n > max) return null;
    picks.push(n);
  }
  return picks.length ? picks : null;
}

async function pickMany(rl, title, items, preselected) {
  const selected = new Set(preselected);
  const width = Math.max(...items.map((i) => i.id.length));
  for (;;) {
    console.log(`\n${title}`);
    items.forEach((item, i) => {
      const number = String(i + 1).padStart(2, ' ');
      console.log(`  ${number}) [${selected.has(item.id) ? 'x' : ' '}] ${pad(item.id, width)}  ${item.label}`);
    });
    const answer = (await rl.question('  numbers to toggle (1,3-5) - a=all - n=none - Enter=accept: ')).trim().toLowerCase();
    if (answer === '') {
      if (!selected.size) { console.log('  pick at least one.'); continue; }
      return items.filter((i) => selected.has(i.id)).map((i) => i.id);
    }
    if (answer === 'a') { items.forEach((i) => selected.add(i.id)); continue; }
    if (answer === 'n') { selected.clear(); continue; }
    const picks = parseRanges(answer, items.length);
    if (!picks) { console.log('  numbers, a, n, or Enter please.'); continue; }
    for (const n of picks) {
      const id = items[n - 1].id;
      if (selected.has(id)) selected.delete(id); else selected.add(id);
    }
  }
}

function validate(kind, given, valid) {
  const bad = given.filter((g) => !valid.includes(g));
  if (bad.length) throw new Error(`unknown ${kind}: ${bad.join(', ')}\n  valid: ${valid.join(', ')}`);
  return given;
}

/* ----------------------------------------------------------------- commands */

async function cmdInstall(args) {
  const boot = loadConfig(SOURCE_ROOT);
  const interactive = !args.yes && Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const rl = interactive ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null;
  let exitCode = 0;
  try {
    const { dir: central, source } = await resolveCentral(args, boot.manifest, rl);
    const { manifest, harnesses } = loadConfig(central);
    const defs = harnessDefs(harnesses);

    if (args.command === 'update') {
      if (source === 'central' && present(path.join(central, '.git'))) {
        console.log(`pull   ${tilde(central)}`);
        if (!args.dryRun && !runGit(central, ['pull', '--ff-only'])) {
          console.log('warn   git pull --ff-only failed - carrying on with what is on disk');
        }
      } else if (source !== 'cloned') {
        console.log(`skip   git pull - ${tilde(central)} is your own checkout, not our clone`);
      }
    }
    console.log(`central ${tilde(central)}`);

    const bundleItems = Object.entries(manifest.bundles).map(([id, b]) => ({ id, label: b.label || id }));
    const bundleIds = bundleItems.map((b) => b.id);
    const detected = defs.filter((d) => d.universal || isDetected(d));

    let bundles = args.bundles ? validate('bundle', args.bundles, bundleIds)
      : args.all ? bundleIds
      : manifest.default.slice();
    let harnessIds = args.harnesses ? validate('harness', args.harnesses, defs.map((d) => d.id))
      : detected.map((d) => d.id);
    let mode = args.copy || IS_WIN ? 'copy' : 'link';

    if (rl) {
      bundles = await pickMany(rl, 'Bundles', bundleItems, bundles);
      const harnessItems = defs
        .filter((d) => d.universal || isDetected(d) || harnessIds.includes(d.id))
        .map((d) => ({ id: d.id, label: d.label + (isDetected(d) ? '  (detected)' : '') }));
      harnessIds = await pickMany(rl, 'Harnesses', harnessItems, harnessIds);
      const answer = (await rl.question(`\nInstall mode - 1) symlink  2) copy  [${mode === 'copy' ? 2 : 1}] `)).trim();
      if (answer === '2') mode = 'copy';
      else if (answer === '1') mode = 'link';
      console.log('');
    } else if (!args.yes) {
      console.log('note   not a terminal - using defaults');
    }

    if (!harnessIds.length) {
      console.log('No harness selected. Nothing to do.');
      return 0;
    }

    const { actions, notes, problems } = planActions({ central, manifest, defs, bundles, harnessIds, mode });
    const previous = readReceipt(central);
    const owned = new Set((previous?.entries || []).map((e) => path.resolve(e.path)));
    const ctx = { central, owned, force: args.force, dryRun: args.dryRun, lines: [] };

    // Keep every earlier entry that is still on disk, so uninstall stays complete
    // even when this run selects fewer bundles than the last one did.
    const entries = new Map();
    for (const entry of previous?.entries || []) {
      if (present(entry.path)) entries.set(path.resolve(entry.path), entry);
    }

    const counts = {};
    for (const action of actions) {
      const result = runAction(action, ctx);
      counts[result.op] = (counts[result.op] || 0) + 1;
      const arrow = action.mode === 'link' && ['link', 'relink', 'ok'].includes(result.op)
        ? ` -> ${tilde(action.source)}`
        : '';
      const tail = result.why ? `  (${result.why})` : result.note ? `  (${result.note})` : '';
      ctx.lines.push(`${pad(result.op, 6)} ${tilde(action.path)}${arrow}${tail}`);
      if (result.record) {
        entries.set(action.path, {
          path: action.path,
          mode: result.mode || action.mode,
          kind: action.kind,
          harness: action.harness,
          bundle: action.bundle,
          source: action.source || null,
          target: result.target || null,
          prune: action.prune || null,
        });
      }
    }

    for (const line of ctx.lines) console.log(line);

    const summary = Object.entries(counts).map(([op, n]) => `${n} ${op}`).join(' - ') || 'nothing to do';
    console.log(`\n${summary}${args.dryRun ? '  (dry-run: nothing was written)' : ''}`);
    for (const note of notes) console.log(`note   ${note}`);
    for (const problem of problems) { console.log(`warn   ${problem}`); exitCode = 1; }

    if (!args.dryRun) {
      const receipt = {
        version: RECEIPT_VERSION,
        generatedAt: new Date().toISOString(),
        central,
        bundles,
        harnesses: harnessIds,
        mode,
        entries: [...entries.values()],
      };
      writeText(receiptPath(central), `${JSON.stringify(receipt, null, 2)}\n`);
      console.log(`receipt ${tilde(receiptPath(central))}`);
    }

    console.log(`
Next steps
  - Restart your harness (or open a new session) to pick up the new skills.
  - Claude Code alternative:  /plugin marketplace add vimoxshah/skills
  - Universal alternative:    npx skills add vimoxshah/skills`);
    return exitCode;
  } finally {
    if (rl) rl.close();
  }
}

function cmdDoctor(args) {
  const boot = loadConfig(SOURCE_ROOT);
  const central = centralFor(args, boot.manifest);
  if (!isCheckout(central)) {
    console.log(`fail   no checkout at ${tilde(central)}`);
    return 1;
  }
  const { harnesses } = loadConfig(central);
  const defs = harnessDefs(harnesses);
  const receipt = readReceipt(central);
  console.log(`central ${tilde(central)}`);
  if (!receipt) {
    console.log(`fail   no receipt at ${tilde(receiptPath(central))} - nothing is installed from here`);
    return 1;
  }

  const problems = [];
  let healthy = 0;
  for (const entry of receipt.entries) {
    const st = lstat(entry.path);
    if (!st) { problems.push(`missing   ${tilde(entry.path)}`); continue; }
    if (entry.mode === 'link') {
      if (!st.isSymbolicLink()) {
        problems.push(`drifted   ${tilde(entry.path)} is a real ${st.isDirectory() ? 'directory' : 'file'} where a link belongs`);
        continue;
      }
      const target = linkTarget(entry.path);
      if (!target || !present(target)) {
        problems.push(`broken    ${tilde(entry.path)} -> ${target ? tilde(target) : '?'}`);
        continue;
      }
      if (entry.target && target !== path.resolve(entry.target)) {
        problems.push(`drifted   ${tilde(entry.path)} -> ${tilde(target)}, expected ${tilde(entry.target)}`);
        continue;
      }
    }
    if (entry.source && !present(entry.source)) {
      problems.push(`gone      ${tilde(entry.source)} left the checkout, still linked from ${tilde(entry.path)}`);
      continue;
    }
    healthy++;
  }

  // A harness you have but did not select is a note, not a problem: a selective
  // install is a legitimate choice, and exiting non-zero on it would make doctor
  // useless in CI for anyone who has more than one harness on the machine.
  const notes = [];
  for (const def of defs) {
    if (def.universal || !isDetected(def)) continue;
    const skillRoot = path.join(HOME, def.skills);
    const agentRoot = def.agents ? path.join(HOME, def.agents.dir) : null;
    const wired = receipt.entries.some((e) => inside(skillRoot, e.path) || (agentRoot && inside(agentRoot, e.path)));
    if (!wired) notes.push(`unwired   ${def.label} is installed but has nothing from us (${tilde(skillRoot)})`);
  }

  console.log(`checked ${receipt.entries.length} paths - ${healthy} healthy - ${problems.length} problem${problems.length === 1 ? '' : 's'}`);
  for (const problem of problems) console.log(problem);
  if (notes.length) {
    console.log(notes.length === 1 ? '\n1 harness not wired up:' : `\n${notes.length} harnesses not wired up:`);
    for (const note of notes) console.log(note);
    console.log(`add it with:  npx @vimoxshah/skills --harness <name>`);
  }
  if (problems.length) console.log('\nfix with:  npx @vimoxshah/skills update');
  return problems.length ? 1 : 0;
}

async function cmdUninstall(args) {
  const boot = loadConfig(SOURCE_ROOT);
  const central = centralFor(args, boot.manifest);
  const receipt = readReceipt(central);
  if (!receipt) {
    console.log(`nothing to remove: no receipt at ${tilde(receiptPath(central))}`);
    return 0;
  }

  if (!args.yes && process.stdin.isTTY && process.stdout.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      const answer = (await rl.question(`Remove ${receipt.entries.length} installed paths? [y/N] `)).trim().toLowerCase();
      if (answer !== 'y' && answer !== 'yes') { console.log('cancelled'); return 0; }
    } finally {
      rl.close();
    }
  }

  let removed = 0;
  let kept = 0;
  for (const entry of [...receipt.entries].reverse()) {
    const dest = path.resolve(entry.path);
    if (!underHome(dest)) { console.log(`skip   ${dest}  (outside your home directory)`); kept++; continue; }
    const st = lstat(dest);
    if (!st) continue;
    if (st.isSymbolicLink() || st.isFile()) {
      if (!args.dryRun) fs.unlinkSync(dest);
    } else if (st.isDirectory()) {
      if (entry.mode !== 'copy') { console.log(`skip   ${tilde(dest)}  (a real directory we did not copy)`); kept++; continue; }
      if (!args.dryRun) removeTree(dest);
    }
    console.log(`remove ${tilde(dest)}`);
    removed++;
    if (entry.prune && underHome(entry.prune) && !args.dryRun) {
      try { fs.rmdirSync(path.resolve(entry.prune)); } catch { /* not empty: leave it */ }
    }
  }
  if (!args.dryRun) {
    try { fs.unlinkSync(receiptPath(central)); } catch { /* already gone */ }
  }
  console.log(`\n${removed} removed${kept ? ` - ${kept} left alone` : ''}${args.dryRun ? '  (dry-run)' : ''}`);
  console.log(`The checkout stays at ${tilde(central)} - delete it by hand if you want it gone.`);
  return 0;
}

function cmdList(args) {
  const boot = loadConfig(SOURCE_ROOT);
  const central = centralFor(args, boot.manifest);
  const { manifest } = loadConfig(central);
  const oneLine = (file, fallback) => {
    if (!present(file)) return fallback;
    const text = collapse(parseFrontmatter(readText(file)).data.description || fallback);
    return text.length > 96 ? `${text.slice(0, 95)}...` : text;
  };
  for (const [id, bundle] of Object.entries(manifest.bundles)) {
    console.log(`\n${id}${manifest.default.includes(id) ? ' (default)' : ''}  -  ${bundle.label || ''}`);
    const rows = [];
    for (const skill of bundle.skills || []) rows.push(['skill', skill, oneLine(path.join(central, 'skills', skill, 'SKILL.md'), skill)]);
    for (const agent of bundle.agents || []) rows.push(['agent', agent, oneLine(path.join(central, 'agents', `${agent}.md`), agent)]);
    for (const cmd of bundle.commands || []) rows.push(['command', cmd, oneLine(path.join(central, 'commands', cmd), cmd)]);
    for (const style of bundle.outputStyles || []) rows.push(['style', style, oneLine(path.join(central, 'output-styles', style), style)]);
    for (const doc of bundle.routing || []) rows.push(['routing', doc, 'routing policy, copied to ~/.claude only when absent']);
    if (bundle.statusline) rows.push(['statusline', bundle.statusline, 'status line script - printed, never applied for you']);
    const width = Math.max(0, ...rows.map((r) => r[1].length));
    for (const [kind, name, text] of rows) console.log(`  ${pad(kind, 10)} ${pad(name, width)}  ${text}`);
  }
  console.log('');
  return 0;
}

/* --------------------------------------------------------------------- main */

export async function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(`error: ${err.message}\n`);
    printHelp();
    return 2;
  }
  if (args.help) { printHelp(); return 0; }
  if (args.command === 'doctor') return cmdDoctor(args);
  if (args.command === 'uninstall') return cmdUninstall(args);
  if (args.command === 'list') return cmdList(args);
  return cmdInstall(args);
}

function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return pathToFileURL(fs.realpathSync(process.argv[1])).href === import.meta.url;
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  main(process.argv.slice(2))
    .then((code) => { process.exitCode = code || 0; })
    .catch((err) => {
      console.error(`error: ${err && err.message ? err.message : err}`);
      process.exitCode = 1;
    });
}
