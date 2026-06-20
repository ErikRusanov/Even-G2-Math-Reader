#!/usr/bin/env node
// Validate a content `.md`: frontmatter present, $-delimiters balanced, and
// EVERY inline/display formula compiles in MathJax with the app's macros
// (mirrors src/render/mathjax.ts). A compile error here = an error box on glass.
import { readFileSync } from 'node:fs'
import { mathjax } from 'mathjax-full/js/mathjax.js'
import { TeX } from 'mathjax-full/js/input/tex.js'
import { SVG } from 'mathjax-full/js/output/svg.js'
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js'
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js'
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js'

const TEX_MACROS = {
  R: '\\mathbb{R}', C: '\\mathbb{C}', Z: '\\mathbb{Z}', N: '\\mathbb{N}',
  eps: '\\varepsilon', dx: '\\,dx', dt: '\\,dt', le: '\\leqslant', ge: '\\geqslant',
  rank: '\\operatorname{rk}', diag: '\\operatorname{diag}', sign: '\\operatorname{sign}',
  norm: ['\\left\\lVert #1 \\right\\rVert', 1], abs: ['\\left\\lvert #1 \\right\\rvert', 1],
  scal: ['\\left( #1, #2 \\right)', 2],
}
const adaptor = liteAdaptor()
RegisterHTMLHandler(adaptor)
const doc = mathjax.document('', {
  InputJax: new TeX({ packages: AllPackages, macros: TEX_MACROS }),
  OutputJax: new SVG({ fontCache: 'none' }),
})

function check(file) {
  const raw = readFileSync(file, 'utf8')
  const errs = []
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/)
  if (!fm) errs.push('frontmatter block missing')
  else {
    if (!/^title:\s*\S/m.test(fm[1])) errs.push('frontmatter missing title')
    if (!/^id:\s*\S/m.test(fm[1])) errs.push('frontmatter missing id')
  }
  let body = fm ? raw.slice(fm[0].length) : raw

  // Pull display blocks, then inline, compiling each.
  const formulas = []
  body = body.replace(/\$\$([\s\S]*?)\$\$/g, (_, m) => { formulas.push(['display', m.trim()]); return ' ' })
  const dollars = (body.match(/\$/g) || []).length
  if (dollars % 2) errs.push(`odd number of inline $ delimiters (${dollars})`)
  body.replace(/\$([^$]+?)\$/g, (_, m) => { formulas.push(['inline', m.trim()]); return ' ' })

  for (const [kind, tex] of formulas) {
    try {
      const node = doc.convert(tex, { display: kind === 'display' })
      const svg = adaptor.innerHTML(node)
      if (svg.includes('data-mjx-error') || svg.includes('merror')) {
        const m = svg.match(/data-mjx-error="([^"]*)"/)
        errs.push(`${kind} math error${m ? `: ${m[1]}` : ''} — ${tex.slice(0, 60)}`)
      }
    } catch (e) {
      errs.push(`${kind} math threw: ${e.message} — ${tex.slice(0, 60)}`)
    }
  }
  return { count: formulas.length, errs }
}

let bad = 0
for (const f of process.argv.slice(2)) {
  const { count, errs } = check(f)
  if (errs.length) { bad++; console.log(`✗ ${f} (${count} formulas)`); for (const e of errs) console.log(`    ${e}`) }
  else console.log(`✓ ${f} — ${count} formulas OK`)
}
process.exit(bad ? 1 : 0)
