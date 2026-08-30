#!/usr/bin/env node
/**
 * arXiv fetcher — corpus scans, targeted queries, and LaTeX-source pulls.
 *
 * Uses the arXiv *API* (export.arxiv.org) for listings because it returns
 * abstracts; the /list/<cat>/recent HTML page does not. Uses arxiv.org/src/<id>
 * for deep reads because the LaTeX source carries the full paper.
 *
 * Everything is cached under --cache (default ~/.cache/arxiv-skill) so a
 * re-run costs nothing and a corpus stays reproducible across sessions.
 *
 * Usage:
 *   node fetch.js --category cs.AI --count 200
 *   node fetch.js --query "agent memory verification" --count 50
 *   node fetch.js --ids 2608.03506,2608.03744
 *   node fetch.js --source 2608.03506          # LaTeX tarball, extracted
 *   node fetch.js --category cs.AI --count 200 --json corpus.json
 */

const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFileSync } = require('child_process')

const API = 'https://export.arxiv.org/api/query'
const PAGE = 100 // arXiv API courtesy page size
const SLEEP_MS = 3000 // arXiv asks for ~3s between requests

function args(argv) {
  const o = { cache: path.join(os.homedir(), '.cache', 'arxiv-skill'), count: 100 }
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i]
    if (!k.startsWith('--')) continue
    const key = k.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) { o[key] = true; continue }
    o[key] = next; i++
  }
  if (o.count) o.count = parseInt(o.count, 10)
  return o
}

function curl(url, outFile) {
  // curl over node's http keeps redirect/TLS handling out of scope and works
  // in sandboxes where fetch() is blocked. -sS surfaces errors, -L follows.
  execFileSync('curl', ['-sS', '-L', '-m', '90', url, '-o', outFile], { stdio: ['ignore', 'ignore', 'inherit'] })
}

function sleep(ms) { execFileSync(process.execPath, ['-e', `setTimeout(()=>{},${ms})`]) }

/** Minimal Atom entry parser. Avoids an XML dep so the skill has no install step. */
function parseAtom(xml) {
  const out = []
  for (const chunk of xml.split('<entry>').slice(1)) {
    const one = (tag) => {
      const m = chunk.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))
      return m ? m[1].replace(/\s+/g, ' ').trim() : ''
    }
    const idm = chunk.match(/<id>https?:\/\/arxiv\.org\/abs\/([^<]+)<\/id>/)
    const entities = (s) => s
      .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    out.push({
      id: idm ? idm[1] : '',
      published: one('published').slice(0, 10),
      updated: one('updated').slice(0, 10),
      title: entities(one('title')),
      abstract: entities(one('summary')),
      authors: [...chunk.matchAll(/<name>([^<]+)<\/name>/g)].map((m) => m[1]),
      categories: [...chunk.matchAll(/<category term="([^"]+)"/g)].map((m) => m[1]),
      primary: (chunk.match(/<arxiv:primary_category[^>]*term="([^"]+)"/) || [])[1] || '',
      pdf: `https://arxiv.org/pdf/${idm ? idm[1] : ''}`,
      abs_url: `https://arxiv.org/abs/${idm ? idm[1] : ''}`,
    })
  }
  return out
}

function fetchList({ searchQuery, count, cache, idList }) {
  fs.mkdirSync(cache, { recursive: true })
  const papers = []
  const pages = Math.ceil(count / PAGE)
  for (let p = 0; p < pages; p++) {
    const start = p * PAGE
    const max = Math.min(PAGE, count - start)
    const q = idList
      ? `${API}?id_list=${encodeURIComponent(idList)}&max_results=${max}`
      : `${API}?search_query=${encodeURIComponent(searchQuery)}` +
        `&sortBy=submittedDate&sortOrder=descending&start=${start}&max_results=${max}`
    const tmp = path.join(cache, `.page-${start}.xml`)
    curl(q, tmp)
    const xml = fs.readFileSync(tmp, 'utf8')
    if (!xml.includes('<entry>')) {
      if (papers.length === 0) throw new Error(`arXiv returned no entries. Query: ${q}`)
      break
    }
    const got = parseAtom(xml)
    papers.push(...got)
    fs.unlinkSync(tmp)
    if (got.length < max) break // exhausted
    if (p < pages - 1) sleep(SLEEP_MS)
  }
  return papers
}

/** Deep read: pull the LaTeX source tarball and extract it. */
function fetchSource(id, cache) {
  const clean = id.replace(/v\d+$/, '')
  const dir = path.join(cache, 'src', clean)
  const tgz = `${dir}.tar.gz`
  fs.mkdirSync(path.dirname(tgz), { recursive: true })
  if (!fs.existsSync(dir)) {
    if (!fs.existsSync(tgz)) curl(`https://arxiv.org/src/${clean}`, tgz)
    fs.mkdirSync(dir, { recursive: true })
    try {
      execFileSync('tar', ['-xzf', tgz, '-C', dir], { stdio: 'ignore' })
    } catch {
      // Some arXiv sources are a bare .tex, not a tarball.
      fs.copyFileSync(tgz, path.join(dir, 'main.tex'))
    }
  }
  const tex = []
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name)
      if (e.isDirectory()) walk(f)
      else if (/\.tex$/i.test(e.name)) tex.push(f)
    }
  }
  walk(dir)
  // Entrypoint = the .tex containing \documentclass, else the largest.
  let entry = tex.find((f) => /\\documentclass/.test(fs.readFileSync(f, 'utf8')))
  if (!entry && tex.length) entry = tex.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0]
  return { dir, entry, tex_files: tex }
}

function main() {
  const o = args(process.argv)
  if (o.source) {
    const r = fetchSource(String(o.source), o.cache)
    console.log(JSON.stringify(r, null, 2))
    return
  }
  let papers
  if (o.ids) {
    papers = fetchList({ idList: String(o.ids), count: String(o.ids).split(',').length, cache: o.cache })
  } else if (o.query) {
    papers = fetchList({ searchQuery: `all:${o.query}`, count: o.count, cache: o.cache })
  } else {
    const cat = o.category || 'cs.AI'
    papers = fetchList({ searchQuery: `cat:${cat}`, count: o.count, cache: o.cache })
  }
  const out = o.json ? String(o.json) : path.join(o.cache, 'corpus.json')
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true })
  fs.writeFileSync(out, JSON.stringify(papers, null, 1))
  const days = [...new Set(papers.map((p) => p.published))].sort()
  console.error(
    `fetched ${papers.length} papers -> ${out}\n` +
    `date span: ${days[0]} .. ${days[days.length - 1]} (${days.length} distinct day(s))`
  )
  if (days.length === 1 && papers.length >= 50) {
    console.error(
      `NOTE: all ${papers.length} papers land on ${days[0]}. State this in any writeup — ` +
      `it is one announcement batch, not a multi-day survey.`
    )
  }
  console.log(out)
}

if (require.main === module) main()
module.exports = { parseAtom, fetchList, fetchSource }
