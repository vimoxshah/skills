#!/usr/bin/env node
/**
 * NL-routing audit — which skills a natural-language prompt can actually reach.
 *
 * A skill is triggered by its `description`, not its name. A description that
 * lists FILES ("maintain server.cjs, collect.mjs") tells the model what the
 * skill touches but not when to invoke it, so an NL query never routes there.
 * A description that lists PHRASES a developer would actually type does.
 *
 * Bands:
 *   STRONG  >=5 quoted trigger phrases AND a "Use when" clause
 *   OK      some triggers, but thin
 *   WEAK    no quoted phrases and no "Use when" — unreachable by NL query
 *
 * Usage:  node audit-nl-routing.js [--dir <skills-dir>] [--fail-on-weak]
 */
const fs = require('fs')
const path = require('path')

function args(argv) {
  const o = { dir: process.env.SKILLS_DIR || '.claude/skills' }
  for (let i = 2; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue
    const k = argv[i].slice(2), n = argv[i + 1]
    if (n === undefined || n.startsWith('--')) { o[k] = true } else { o[k] = n; i++ }
  }
  return o
}

function describe(file) {
  const t = fs.readFileSync(file, 'utf8')
  const fm = t.match(/^---\s*$([\s\S]*?)^---\s*$/m)
  const body = fm ? fm[1] : ''
  const d = body.match(/description:\s*(>[-|]?\s*)?([\s\S]*?)(?=\n[a-z_]+:|$)/)
  return (d ? d[2] : '').trim()
}

const o = args(process.argv)
const root = String(o.dir)
const rows = []
for (const name of fs.readdirSync(root)) {
  // statSync, NOT dirent.isDirectory(): a symlinked skill directory reports
  // isDirectory() === false and would be silently skipped. Measured: 14 of 42
  // skills in this repo are symlinks.
  const dir = path.join(root, name)
  let st; try { st = fs.statSync(dir) } catch { continue }
  if (!st.isDirectory()) continue
  const f = path.join(dir, 'SKILL.md')
  if (!fs.existsSync(f)) continue
  const desc = describe(f)
  const phrases = (desc.match(/"[^"]{4,}"/g) || []).length
  const useWhen = /Use when|Triggers? (on|include)|when (the user|someone|asked)/i.test(desc)
  const bounded = /\bNOT for\b|\bnot for\b|Distinct from/i.test(desc)
  const band = phrases >= 5 && useWhen ? 'STRONG' : (phrases >= 2 || useWhen) ? 'OK' : 'WEAK'
  rows.push({ name, len: desc.length, phrases, useWhen, bounded, band })
}

rows.sort((a, b) => a.band.localeCompare(b.band) || b.phrases - a.phrases)
const pad = (s, n) => String(s).padEnd(n)
console.log(`${pad('skill', 42)}${pad('chars', 7)}${pad('phrases', 9)}${pad('useWhen', 9)}${pad('bounded', 9)}band`)
console.log('-'.repeat(85))
for (const r of rows) {
  console.log(`${pad(r.name, 42)}${pad(r.len, 7)}${pad(r.phrases, 9)}${pad(r.useWhen, 9)}${pad(r.bounded, 9)}${r.band}`)
}
const weak = rows.filter((r) => r.band === 'WEAK')
const c = (b) => rows.filter((r) => r.band === b).length
console.log(`\n${rows.length} skills -> STRONG ${c('STRONG')} · OK ${c('OK')} · WEAK ${c('WEAK')}`)
if (weak.length) {
  console.log(`\nWEAK (an NL query will not reach these — add a "Use when:" clause with the phrases a developer would type):`)
  for (const r of weak) console.log(`  ${r.name}`)
}
console.log(`\nSiblings need NEGATIVE boundaries too ("NOT for X — use Y") or the model picks the wrong one of a family.`)
if (o['fail-on-weak'] && weak.length) process.exit(1)
