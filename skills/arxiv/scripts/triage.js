#!/usr/bin/env node
/**
 * Corpus triage — score every paper against an ecosystem profile, rank, emit.
 *
 * Exists because eyeballing 200 titles does not work: it is slow, it silently
 * drops papers, and index drift from a mis-read list produces citations that
 * point at the wrong paper. Scoring is mechanical and reproducible.
 *
 * The axes live in a profile JSON (--profile), not in this file, so the same
 * engine serves any ecosystem. See ../profiles/generic.json.
 *
 * Usage:
 *   node triage.js --corpus corpus.json --profile ../profiles/generic.json
 *   node triage.js --corpus corpus.json --min 4 --out triage.tsv
 *   node triage.js --corpus corpus.json --format json
 */

const fs = require('fs')
const path = require('path')

function args(argv) {
  const o = { min: 4, format: 'tsv' }
  for (let i = 2; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue
    const key = argv[i].slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) { o[key] = true; continue }
    o[key] = next; i++
  }
  o.min = parseInt(o.min, 10)
  return o
}

const DEFAULT_AXES = {
  memory: 'memory|long-term|episodic',
  context: '\\bcontext\\b|long-context|context window',
  tool_use: 'tool[- ]?(call|use|select|plan|invocation)',
  mcp: '\\bMCP\\b|model context protocol',
  orchestration: 'orchestrat|multi-?agent|delegat',
  verification: 'verif|adversarial|refut|certificat',
  eval: 'benchmark|\\beval|leaderboard',
  skills: '\\bskill|self-evol|self-improv|continual',
  codegen: 'code generation|program synth|code gen',
  swe: '\\bSWE\\b|software engineer|repositor|pull request',
  knowledge: 'knowledge base|knowledge graph|ontolog|retriev',
  observability: 'telemetr|observab|forensic|trace|audit',
  trajectory: 'trajector|rollout|episode',
  guidance: 'guidance|prompt|instruct',
  agentic: 'agentic|LLM agent|autonomous agent',
  workflow: 'workflow|pipeline',
  horizon: 'long-horizon|long-running|persistent',
  production: 'enterprise|production|deploy',
}

function loadProfile(p) {
  if (!p) return { name: 'default', axes: DEFAULT_AXES }
  const prof = JSON.parse(fs.readFileSync(p, 'utf8'))
  return { name: prof.name || path.basename(p), axes: prof.axes || DEFAULT_AXES, boost: prof.boost || {} }
}

function score(paper, profile) {
  const hay = `${paper.title} ${paper.abstract}`
  const hits = []
  for (const [axis, pat] of Object.entries(profile.axes)) {
    if (new RegExp(pat, 'i').test(hay)) hits.push(axis)
  }
  // A boost pattern names a mechanism WE SHIP. One hit is sufficient on its
  // own — never additive-only.
  //
  // This is the load-bearing correction in this script. Naive breadth scoring
  // ranks a broad survey touching 12 axes above a narrow paper that names our
  // exact mechanism, and the narrow paper is the one that changes what we do.
  // Measured on a 200-paper cs.AI batch: pure axis-breadth at threshold 6 lost
  // the two highest-value papers in the corpus (a majority-vote refutation and
  // a judge-panel contagion study) because neither is topically broad.
  // Relevance is mechanism-match, not topic count.
  const boosted = []
  for (const [label, pat] of Object.entries(profile.boost || {})) {
    if (new RegExp(pat, 'i').test(hay)) boosted.push(label)
  }
  const tier = boosted.length ? 'must_read' : 'candidate'
  return { hits, boosted, tier, axis_hits: hits.length, boost_hits: boosted.length,
           total: hits.length + boosted.length * 2 }
}

function main() {
  const o = args(process.argv)
  if (!o.corpus) { console.error('need --corpus <corpus.json>'); process.exit(2) }
  const papers = JSON.parse(fs.readFileSync(o.corpus, 'utf8'))
  const profile = loadProfile(o.profile)

  const rows = papers.map((p, i) => {
    const s = score(p, profile)
    return { n: i + 1, id: p.id, published: p.published, score: s.total,
             tier: s.tier, axis_hits: s.axis_hits, boost_hits: s.boost_hits,
             axes: s.hits.join(','), boosted: s.boosted.join(','), title: p.title,
             categories: (p.categories || []).join(',') }
  })

  const dist = {}
  rows.forEach((r) => { dist[r.score] = (dist[r.score] || 0) + 1 })

  // A must_read is kept regardless of --min: it named a mechanism we ship.
  const kept = rows
    .filter((r) => r.tier === 'must_read' || r.axis_hits >= o.min)
    .sort((a, b) => b.boost_hits - a.boost_hits || b.axis_hits - a.axis_hits || a.n - b.n)

  if (o.format === 'json') {
    const payload = { profile: profile.name, total: rows.length, threshold: o.min,
                      distribution: dist, kept: kept.length, papers: kept }
    const out = o.out || 'triage.json'
    fs.writeFileSync(out, JSON.stringify(payload, null, 1))
    console.log(out)
  } else {
    // One paper per line, unique content per line — survives terminal filters
    // that collapse repetitive output.
    const lines = kept.map((r) =>
      `${r.n}\t${r.id}\t${r.tier}\tb=${r.boost_hits}\ta=${r.axis_hits}\t${r.title}` +
      `\t[${r.boosted || '-'}]\t[${r.axes}]`)
    const out = o.out || 'triage.tsv'
    fs.writeFileSync(out, lines.join('\n') + '\n')
    console.log(out)
  }

  const must = kept.filter((r) => r.tier === 'must_read').length
  console.error(`profile=${profile.name}  corpus=${rows.length}  axis-threshold>=${o.min}  kept=${kept.length}`)
  console.error(`  must_read (named a mechanism we ship): ${must}`)
  console.error(`  candidate (broad topical match only):  ${kept.length - must}`)
  console.error(`score distribution: ${JSON.stringify(dist)}`)
  const zero = rows.filter((r) => r.score === 0).length
  console.error(`${zero} paper(s) matched no axis — if that is >40% of the corpus, your profile axes are too narrow.`)
  console.error(`DROPPED ${rows.length - kept.length} paper(s) below threshold. Say so in any writeup — silent truncation reads as full coverage.`)
}

if (require.main === module) main()
module.exports = { score, DEFAULT_AXES }
