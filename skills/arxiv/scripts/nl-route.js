#!/usr/bin/env node
/**
 * NL router — type what you want in plain language, get the skill that handles it.
 *
 * Two jobs:
 *   1. Answer "which skill handles this?" for a natural-language query, so you
 *      never need to remember a 39-character skill name.
 *   2. REGRESSION-TEST routing. Adding a skill whose trigger phrases overlap an
 *      existing one silently steals queries from it. `--test` catches that.
 *
 * Scoring mirrors how the model actually routes — on the `description`, not the
 * name. Quoted trigger phrases dominate; the name barely counts.
 *
 * Usage:
 *   node .claude/scripts/nl-route.js "the dashboard is empty"
 *   node .claude/scripts/nl-route.js "read this arxiv paper" --top 5 --explain
 *   node .claude/scripts/nl-route.js --test .claude/scripts/routing-fixtures.json
 */

const fs = require('fs')
const path = require('path')
const os = require('os')

const STOP = new Set(('a an the is are was were be been being do does did to of in on at for with from by' +
  ' and or but if then this that these those it its my our your we i you what which how when where why' +
  ' can could should would will shall may might must have has had not no yes please help me').split(' '))

function args(argv) {
  const o = { top: 3, query: [] }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) { o.query.push(a); continue }
    const k = a.slice(2), n = argv[i + 1]
    if (n === undefined || n.startsWith('--')) { o[k] = true } else { o[k] = n; i++ }
  }
  o.top = parseInt(o.top, 10) || 3
  return o
}

function norm(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9\s/-]/g, ' ').replace(/\s+/g, ' ').trim()
}
function toks(s) {
  return norm(s).split(' ').filter((w) => w.length > 2 && !STOP.has(w))
}

/** Collect skills from every location the session can see. Project shadows global. */
function loadSkills() {
  const roots = [
    { dir: '.claude/skills', scope: 'project' },
    { dir: '.agents/skills', scope: 'project' },
    { dir: path.join(os.homedir(), '.claude', 'skills'), scope: 'global' },
  ]
  const found = new Map() // name -> skill (first wins => project shadows global)
  for (const { dir, scope } of roots) {
    if (!fs.existsSync(dir)) continue
    for (const name of fs.readdirSync(dir)) {
      // statSync, not dirent.isDirectory(): symlinked skill dirs would be skipped.
      const d = path.join(dir, name)
      let st; try { st = fs.statSync(d) } catch { continue }
      if (!st.isDirectory()) continue
      const f = path.join(d, 'SKILL.md')
      if (!fs.existsSync(f) || found.has(name)) continue
      const t = fs.readFileSync(f, 'utf8')
      const fm = t.match(/^---\s*$([\s\S]*?)^---\s*$/m)
      const body = fm ? fm[1] : ''
      const dm = body.match(/description:\s*(>[-|]?\s*)?([\s\S]*?)(?=\n[a-z_]+:|$)/)
      const desc = (dm ? dm[2] : '').trim()
      const phrases = (desc.match(/"([^"]{4,})"/g) || []).map((s) => s.slice(1, -1))
      // "NOT for X — use Y" marks anti-triggers: matching these should PENALISE.
      const negBlock = (desc.match(/(?:NOT for|not for|Distinct from)([\s\S]*)$/) || [])[1] || ''
      found.set(name, { name, scope, desc, phrases, negPhrases: (negBlock.match(/"([^"]{4,})"/g) || []).map((s) => s.slice(1, -1)) })
    }
  }
  return [...found.values()]
}

function score(query, skill) {
  const q = norm(query)
  const qt = new Set(toks(query))
  if (qt.size === 0) return { total: 0, why: [] }
  let best = 0, why = []

  // 1. Trigger-phrase match — the dominant signal, mirroring how the model routes.
  for (const p of skill.phrases) {
    const pn = norm(p)
    if (!pn) continue
    if (q.includes(pn) || pn.includes(q)) {
      if (60 > best) { best = 60; why = [`phrase contains: "${p}"`] }
      continue
    }
    const pt = toks(p)
    if (!pt.length) continue
    const hit = pt.filter((w) => qt.has(w)).length
    // Overlap relative to the SHORTER side, so a long trigger phrase is not
    // penalised for containing words the short query omits.
    const rel = hit / Math.min(pt.length, qt.size)
    const s = rel * 55
    if (s > best) { best = s; why = [`phrase overlap ${hit}/${Math.min(pt.length, qt.size)}: "${p}"`] }
  }

  // 2. Description body overlap — weaker, catches phrasings no trigger covers.
  const dt = new Set(toks(skill.desc))
  const dHit = [...qt].filter((w) => dt.has(w))
  const dScore = (dHit.length / qt.size) * 25
  if (dScore > 0) why.push(`desc terms: ${dHit.slice(0, 6).join(', ')}`)

  // 3. Name match — deliberately small. The name is the /slash fallback.
  const nt = new Set(toks(skill.name.replace(/-/g, ' ')))
  const nHit = [...qt].filter((w) => nt.has(w)).length
  const nScore = nHit ? Math.min(12, nHit * 6) : 0
  if (nScore) why.push(`name: ${skill.name}`)

  // 4. Anti-trigger penalty — "NOT for X" should push this skill DOWN.
  let penalty = 0
  for (const p of skill.negPhrases) {
    const pt = toks(p)
    if (pt.length && pt.filter((w) => qt.has(w)).length / pt.length > 0.6) {
      penalty = 25; why.push(`anti-trigger: "${p}"`)
    }
  }

  return { total: Math.max(0, best + dScore + nScore - penalty), why }
}

function rank(query, skills) {
  return skills
    .map((s) => ({ skill: s, ...score(query, s) }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total)
}

function confidence(rows) {
  if (!rows.length) return 'none'
  const top = rows[0].total, second = rows[1] ? rows[1].total : 0
  if (top >= 55 && top - second >= 12) return 'high'
  if (top >= 30) return 'medium'
  return 'low'
}

const o = args(process.argv)
const skills = loadSkills()

if (o.test) {
  // Fixtures: [{ query, expect, note? }]. expect = the skill that MUST rank #1.
  const fx = JSON.parse(fs.readFileSync(String(o.test), 'utf8'))
  const present = new Set(skills.map((s) => s.name))
  let pass = 0
  const fails = []
  const skipped = []
  for (const c of fx) {
    // A fixture targeting a skill this checkout does not have is an ENVIRONMENT
    // difference, not a routing regression: plugin- and symlink-provided skills
    // (memory, session) exist in a working copy but not in a clean clone or CI.
    // Skip it — but report it, never silently.
    if (!present.has(c.expect)) { skipped.push(c); continue }
    const rows = rank(c.query, skills)
    const got = rows.length ? rows[0].skill.name : '(none)'
    if (got === c.expect) pass++
    else fails.push({ ...c, got, runner_up: rows[1] ? rows[1].skill.name : '-', score: rows.length ? rows[0].total.toFixed(1) : '0' })
  }
  const checked = fx.length - skipped.length
  console.log(`routing fixtures: ${pass}/${checked} passed  (${skills.length} skills loaded${skipped.length ? `, ${skipped.length} skipped` : ''})`)
  if (skipped.length) {
    console.log(`\nSKIPPED — target skill not present in this checkout (plugin/symlink-provided):`)
    for (const s of skipped) console.log(`  ${s.expect.padEnd(28)} "${s.query}"`)
  }
  if (fails.length) {
    console.log(`\nFAILED — an NL query does not reach its intended skill:`)
    for (const f of fails) {
      console.log(`  "${f.query}"`)
      console.log(`      expect ${f.expect}  ->  got ${f.got} (score ${f.score}, runner-up ${f.runner_up})`)
      console.log(`      fix: add/sharpen a trigger phrase in ${f.expect}, or add a "NOT for" boundary to ${f.got}`)
    }
    process.exit(1)
  }
  console.log('PASS — every fixture query routes to its intended skill.')
} else if (o.query.length) {
  const query = o.query.join(' ')
  const rows = rank(query, skills)
  console.log(`query: "${query}"`)
  console.log(`confidence: ${confidence(rows)}   (${skills.length} skills searched)\n`)
  if (!rows.length) {
    console.log('  no skill matched.')
    console.log('  If this query SHOULD have matched something, that skill needs a trigger phrase for it.')
  }
  for (const r of rows.slice(0, o.top)) {
    console.log(`  ${r.total.toFixed(1).padStart(5)}  ${r.skill.name}  [${r.skill.scope}]`)
    if (o.explain) for (const w of r.why) console.log(`         - ${w}`)
  }
} else {
  console.log('usage: nl-route.js "<what you want in plain language>" [--top N] [--explain]')
  console.log('       nl-route.js --test .claude/scripts/routing-fixtures.json')
  process.exit(2)
}
