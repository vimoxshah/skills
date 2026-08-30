#!/usr/bin/env node
/**
 * Citation gate — prove every figure in a writeup came from its source paper.
 *
 * Why this exists: paraphrasing an abstract from memory produces plausible
 * numbers that are wrong. A stripped or truncated read makes it worse — you
 * see "34.0% 39.0%, 45 20 26.0%" with no attached semantics and reconstruct a
 * sentence that was never there. This script mechanically refuses that.
 *
 * How it attributes: walks the markdown top to bottom tracking the most
 * recently mentioned arXiv id. Every figure after it is attributed to that
 * paper until the next id appears. So structure sections as:
 *
 *     ### A1 — #94 `2608.03506` · Paper Title
 *     ...claims about 2608.03506...
 *
 * Checked forms (the ones that carry fabrication risk):
 *   percentages 42.1%   decimals 15.36   ratios 1/134   x-factors 19x
 *   comma-thousands 2,784   model sizes 0.6B / 72B   ranges 5-16%
 * Skipped by default: bare small integers and anything inside `backticks`
 * (those are usually your own counts and file:line refs, not paper claims).
 *
 * Usage:
 *   node verify-citations.js --report doc.md --corpus corpus.json
 *   node verify-citations.js --report doc.md --corpus corpus.json --allow allow.txt
 *   node verify-citations.js --report doc.md --corpus corpus.json --source-dir ~/.cache/arxiv-skill/src
 */

const fs = require('fs')
const path = require('path')

function args(argv) {
  const o = {}
  for (let i = 2; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue
    const key = argv[i].slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) { o[key] = true; continue }
    o[key] = next; i++
  }
  return o
}

const ID_RE = /\b(\d{4}\.\d{4,5})(v\d+)?\b/g

// Numeric forms that carry real fabrication risk. Bare integers are excluded
// on purpose — they are overwhelmingly the author's own counts.
// Lookbehinds prevent matching the tail of a longer number: without them
// "42.1%" also yields a bogus "1%" claim that can never verify.
const FIG_RES = [
  /(?<![\d.,])\d+(?:\.\d+)?\s?%/g,                                  // 42.1%  38%
  /(?<![\d.,])\d+\.\d+(?![\d%])/g,                                  // 15.36
  /(?<![\d.,])\d+(?:\.\d+)?\s?[-–—]\s?\d+(?:\.\d+)?\s?%/g,          // 5-16%
  /(?<![\d.,/])\d+\/\d+(?![\d/])/g,                                 // 1/134
  /(?<![\d.,])\d+(?:\.\d+)?\s?[xX](?![a-zA-Z])/g,                   // 19x
  /(?<![\d.,])\d{1,3}(?:,\d{3})+/g,                                 // 2,784
  /(?<![\d.,])\d+(?:\.\d+)?B\b/g,                                   // 0.6B, 72B
]

/** Strip fenced code, inline code, and link targets — not paper claims. */
function stripNonProse(md) {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/\]\([^)]*\)/g, '] ')
}

function normalize(s) {
  return s
    .replace(/[–—]/g, '-')
    // arXiv abstracts carry raw LaTeX: "84\%" and "$\sim$77\%" are common.
    // Without this, a correctly-cited percentage fails verification.
    .replace(/\\%/g, '%')
    .replace(/\$?\\sim\$?/g, '')
    .replace(/\\text(bf|it)\{([^}]*)\}/g, '$2')
    .replace(/\s+/g, ' ')
    .replace(/\s?%/g, '%')
    .toLowerCase()
}

/** 26% and 26.0% are the same number. Strip insignificant trailing zeros. */
function trimZeros(numStr) {
  return numStr.includes('.') ? numStr.replace(/0+$/, '').replace(/\.$/, '') : numStr
}

/** Does `fig` appear in `text`, allowing for spacing/dash/case variance? */
function present(fig, text) {
  const f = normalize(fig)
  const t = normalize(text)
  if (t.includes(f)) return true
  // 38% may be written "38 %", "38 percent", or "38.0%" in the source.
  const bare = f.replace('%', '').trim()
  if (f.endsWith('%')) {
    const b = bare.replace('.', '\\.')
    if (new RegExp(`(?<![\\d.])${b}\\s?(%|percent)`).test(t)) return true
    // trailing-zero equivalence in BOTH directions: 26% <-> 26.0%
    const tz = trimZeros(bare).replace('.', '\\.')
    if (new RegExp(`(?<![\\d.])${tz}(\\.0+)?\\s?(%|percent)`).test(t)) return true
  }
  // Ranges appear as "5-16%", "5%-16%", "5--16\%", or "5 to 16%".
  const range = f.match(/^(\d+(?:\.\d+)?)%?-(\d+(?:\.\d+)?)%?$/)
  if (range) {
    const [, lo, hi] = range
    const L = lo.replace('.', '\\.'), H = hi.replace('.', '\\.')
    if (new RegExp(`${L}\\s?%?\\s?(-|--|to|through)\\s?${H}`).test(t)) return true
  }
  // 0.6B / 72B may be "0.6 B" or "72 billion".
  const size = f.match(/^(\d+(?:\.\d+)?)b$/)
  if (size && new RegExp(`${size[1].replace('.', '\\.')}\\s?(b\\b|billion)`).test(t)) return true
  return false
}

function main() {
  const o = args(process.argv)
  if (!o.report || !o.corpus) {
    console.error('usage: verify-citations.js --report <doc.md> --corpus <corpus.json> [--allow allow.txt] [--source-dir DIR]')
    process.exit(2)
  }
  const md = fs.readFileSync(o.report, 'utf8')
  const papers = JSON.parse(fs.readFileSync(o.corpus, 'utf8'))
  const byId = new Map()
  for (const p of papers) byId.set(String(p.id).replace(/v\d+$/, ''), p)

  const allow = new Set()
  if (o.allow && fs.existsSync(String(o.allow))) {
    for (const l of fs.readFileSync(String(o.allow), 'utf8').split('\n')) {
      const s = l.trim(); if (s && !s.startsWith('#')) allow.add(normalize(s))
    }
  }

  // Optional: also search extracted LaTeX source, so a figure taken from the
  // body (not the abstract) still verifies.
  const sourceText = (id) => {
    if (!o['source-dir']) return ''
    const d = path.join(String(o['source-dir']), id)
    if (!fs.existsSync(d)) return ''
    let t = ''
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const f = path.join(dir, e.name)
        if (e.isDirectory()) walk(f)
        else if (/\.tex$/i.test(e.name)) t += '\n' + fs.readFileSync(f, 'utf8')
      }
    }
    try { walk(d) } catch { /* unreadable source is not a verification failure */ }
    return t
  }

  const rawLines = md.split('\n')
  const proseLines = stripNonProse(md).split('\n')
  let current = null
  const claims = []
  const orphans = []

  for (let i = 0; i < rawLines.length; i++) {
    // Ids come from the raw line — they are usually inside `backticks`, which
    // stripNonProse removes. Figures come from the stripped line so our own
    // counts and file:line refs in code spans are not treated as claims.
    const ids = [...rawLines[i].matchAll(ID_RE)].map((m) => m[1])
    if (ids.length) current = ids[ids.length - 1]
    const line = proseLines[i] === undefined ? '' : proseLines[i]
    const figs = new Set()
    for (const re of FIG_RES) for (const m of line.matchAll(re)) figs.add(m[0].trim())
    for (const f of figs) {
      if (allow.has(normalize(f))) continue
      if (!current) { orphans.push({ line: i + 1, fig: f, text: line.trim().slice(0, 100) }); continue }
      claims.push({ line: i + 1, id: current, fig: f, text: line.trim().slice(0, 110) })
    }
  }

  const unverified = []
  const missingPaper = new Set()
  for (const c of claims) {
    const p = byId.get(c.id)
    if (!p) { missingPaper.add(c.id); continue }
    const hay = `${p.title} ${p.abstract} ${sourceText(c.id)}`
    if (!present(c.fig, hay)) unverified.push(c)
  }

  const checked = claims.length - missingPaper.size
  console.log(`report:      ${o.report}`)
  console.log(`corpus:      ${papers.length} papers`)
  console.log(`figures:     ${claims.length} attributed, ${orphans.length} unattributed`)
  console.log(`verified:    ${checked - unverified.length}/${checked}`)

  if (missingPaper.size) {
    console.log(`\nNOT IN CORPUS (cannot verify — fetch these ids or fix the reference):`)
    for (const id of missingPaper) console.log(`  ${id}`)
  }
  if (orphans.length) {
    console.log(`\nUNATTRIBUTED figures (no arXiv id above them — may be your own numbers, check each):`)
    for (const x of orphans.slice(0, 25)) console.log(`  L${x.line}  ${x.fig}   ${x.text}`)
    if (orphans.length > 25) console.log(`  ... and ${orphans.length - 25} more`)
  }
  if (unverified.length) {
    console.log(`\n*** UNVERIFIED — these figures do NOT appear in their cited paper: ***`)
    for (const x of unverified) console.log(`  L${x.line}  ${x.id}  ${x.fig}\n      ${x.text}`)
    console.log(`\nFIX each one: re-read the source, correct the figure, or drop the claim.`)
    console.log(`Do not ship a writeup with an unverified figure.`)
    process.exit(1)
  }
  if (claims.length === 0) {
    console.log(`\n*** CANNOT VERIFY — zero figures were attributed to a paper. ***`)
    console.log(`Every figure needs an arXiv id ABOVE it in the document. Structure sections as:`)
    console.log(`    ### A1 — #94 \`2608.03506\` · Paper Title`)
    console.log(`then put that paper's figures underneath. Re-run once the ids are in place.`)
    process.exit(1)
  }
  console.log(`\nPASS — all ${checked} attributed figure(s) appear in their cited paper.`)
}

if (require.main === module) main()
module.exports = { present, stripNonProse }
