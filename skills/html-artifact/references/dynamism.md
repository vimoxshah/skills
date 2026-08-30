# Dynamism — making a static file feel alive

Everything here is client-side over data you embed at build time. The sandbox
blocks network calls, so "live" means *derived*, *filterable*, or *computed* —
not fetched. (Genuinely live data needs the `artifact-capabilities` skill and an
explicit capability declaration; that is a different mechanism.)

## Embed data, render from it

Do not hand-write forty table rows. Put the data in one place and render — the
page stays honest because there is a single source, and filtering becomes free.

```html
<script type="application/json" id="ops">
[{"op":"POST /token","sites":11,"v3":"/realms/SMID/…/token","map":"host"},
 {"op":"GetVirtualCardDetailV2","sites":5,"v3":"/premium/{id}","map":"1:2"}]
</script>
```

```js
const rows = JSON.parse(document.getElementById('ops').textContent);
const tbody = document.querySelector('#ops-table tbody');
const draw = list => tbody.replaceChildren(...list.map(r => {
  const tr = document.createElement('tr');
  tr.innerHTML = `<td><code></code></td><td class="n"></td><td><code></code></td>
                  <td><span class="chip"></span></td>`;
  tr.children[0].firstChild.textContent = r.op;      // textContent, never innerHTML
  tr.children[1].textContent = r.sites;
  tr.children[2].firstChild.textContent = r.v3;
  tr.children[3].firstChild.textContent = r.map;
  return tr;
}));
draw(rows);
```

**Never interpolate data into `innerHTML`.** Build the shell, then set
`textContent`. Even self-authored data ends up containing a `<` eventually.

## Filters and sort

```js
document.querySelectorAll('[data-filter]').forEach(b => b.onclick = () => {
  const f = b.dataset.filter;
  document.querySelectorAll('[data-filter]').forEach(x =>
    x.setAttribute('aria-pressed', String(x === b)));
  draw(f === 'all' ? rows : rows.filter(r => r.map === f));
});
```

Use `aria-pressed` on toggle buttons, not a class alone — the state has to reach
assistive tech, and you get a free styling hook via `[aria-pressed="true"]`.

Sorting: keep the comparator on the data, re-run `draw`. Never sort the DOM.

## Derived summaries

The strongest dynamism is a number the page computes from its own data, because
it can never drift from the table beneath it:

```js
const total = rows.reduce((a,r) => a + r.sites, 0);
document.getElementById('total-calls').textContent = total;
```

If a headline stat and a table can disagree, they eventually will. Derive one
from the other.

## Small state worth keeping

```js
// remember the reader's place across a refresh
addEventListener('beforeunload', () => sessionStorage.setItem('slide', i));
```

`sessionStorage` for per-visit state (current slide, open panel).
`localStorage` only for a genuine preference. Wrap both in `try/catch` — they
throw in some privacy modes and an uncaught error kills the rest of your script.

## Progressive disclosure

Native `<details>` costs nothing and is fully accessible:

```html
<details><summary>Show the SQL</summary><pre><code>…</code></pre></details>
```

Reach for the tabbed pattern in `deck-shell.md` only when there are several
parallel depths to switch between. One optional block is a `<details>`.

## Restraint

- Every interactive control needs a visible focus state and a hover cue.
- Do not animate a filter's results. The reader is reading, not watching.
- Empty states say what would appear and why it is empty.
- If a control has one option, delete the control.
