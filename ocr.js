// OCRScanner.js — parse on GitHub side and output Glide-friendly TSV
// Assumes: <div id="output"></div> (human-readable) and <pre id="tsv"></pre> exist
// Also assumes buttons with ids #copyReadable and #copyTSV (optional, but handy)

async function runOCR(imageUrl, progressEl, outputEl, tsvEl) {
  function updateProgress(m) {
    if (m.status === 'recognizing text') {
      progressEl.textContent = `Scanning: ${(m.progress * 100).toFixed(1)}%`;
    }
  }

  const worker = await Tesseract.createWorker();
  worker.logger = updateProgress;

  await worker.loadLanguage('eng');
  await worker.initialize('eng');

  const { data: { text } } = await worker.recognize(imageUrl);
  await worker.terminate();

  // 1) Pre-clean OCR noise to stabilize labels & units
  const clean = preClean(text);

  // 2) Segment into rabbits by forgiving markers
  const sections = segmentRabbits(clean); // array of { role, block }

  // 3) Parse each section fields with tolerant regex
  const rabbits = sections.map(parseSection);

  // 4) Render outputs
  const readable = renderReadable(rabbits);     // HTML with <br>
  const tsv = renderTSV(rabbits);               // Tab-separated with header

  outputEl.innerHTML = readable;
  tsvEl.textContent = tsv;

  progressEl.textContent = '✅ OCR complete — copy TSV into Glide (or use readable for review).';
}

// --- Helpers ---

function preClean(s) {
  return s
    // normalize whitespace/newlines
    .replace(/\r/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    // common OCR label fixes (case-insensitive)
    .replace(/ariety/gi, 'Variety')
    .replace(/We[il1]?ght/gi, 'Weight')
    .replace(/Leg[s5]/gi, 'Legs')
    .replace(/\bRe[gq][\.\s#:]*/gi, 'Reg # ')
    .replace(/\b[Gg][Cc][\.\s#:]*/g, 'GC # ')
    .replace(/[Ee]ar[\s#:]*/g, 'Ear # ')
    .replace(/\bBorn[\s:]*([0-9OIl\-\/\.]+)/gi, 'Born: $1')
    // pounds/ounces typos
    .replace(/([0-9])\s*[il1]b\b/gi, '$1 lb')
    .replace(/\b([0-9])\s*[o0]z\b/gi, '$1 oz')
    // standardize separators
    .replace(/[|]/g, ' ')
    .trim();
}

function segmentRabbits(s) {
  // Insert explicit markers before key roles/starts. Keeps the actual label.
  const marked = s.replace(/\b(Name|Sire|Dam)\b\s*:?/gi, '\n=== $1 ===\n');
  // Split on our marker
  const chunks = marked.split(/\n===\s*/).map(x => x.trim()).filter(Boolean);

  const result = [];
  for (const chunk of chunks) {
    // First word before '===' was the role; after split it’s at start of chunk now
    const m = chunk.match(/^((Name|Sire|Dam))\s*===?\s*/i);
    if (m) {
      result.push({ role: m[1].toUpperCase(), block: chunk.replace(/^((Name|Sire|Dam))\s*===?\s*/i, '') });
    } else if (/^Name[:\s]/i.test(chunk)) {
      result.push({ role: 'NAME', block: chunk });
    } else {
      // If untagged, keep as UNKNOWN (we still parse fields)
      result.push({ role: 'UNKNOWN', block: chunk });
    }
  }
  // Ensure deterministic order: NAME (main), then SIRE, DAM, others
  result.sort((a,b) => roleRank(a.role) - roleRank(b.role));
  return result;
}

function roleRank(role) {
  const order = { 'NAME': 0, 'SIRE': 1, 'DAM': 2, 'UNKNOWN': 3 };
  return role in order ? order[role] : 3;
}

function parseSection(sec) {
  const blk = ' ' + sec.block.replace(/\n/g, ' ') + ' ';

  // forgiving patterns (no lookbehind; mixed case; optional colons/spaces)
  const rx = {
    name: /(Name|Rabbit|Animal)[:\s]+([A-Za-z0-9'&\-\s]{3,})/,
    ear: /Ear\s*#[:\s]*([A-Z0-9\-]+)\b/i,
    reg: /Reg\s*#[:\s]*([A-Z0-9\-]+)\b/i,
    gc: /\bGC\s*#[:\s]*([A-Z0-9\-]+)\b/i,
    variety: /Variety[:\s]+([A-Za-z][A-Za-z\s\(\)\/\-]+?)\b(?=Weight|Legs|Ear|Reg|GC|Born|Sire|Dam|$)/i,
    weight: /Weight[:\s]*([0-9]{1,2}\s*lb\s*[0-9]{1,2}\s*oz)/i,
    legs: /Legs?[:\s]*([0-9]{1,2})\b/i,
    born: /Born[:\s]*([0-9OIl\-\/\.]{6,12})/i
  };

  function grab(r) {
    const m = blk.match(r);
    return m ? (m[2] || m[1] || '').toString().trim() : '';
  }

  // Try to infer a Name if role implies it and 'Name:' label is missing.
  const inferredName = !grab(rx.name) && /^(SIRE|DAM)/i.test(sec.role)
    ? grab(/^(?:Sire|Dam)[:\s]+([A-Za-z0-9'&\-\s]{3,})/i)
    : '';

  // Build record
  return {
    Role: sec.role,
    Name: grab(rx.name) || inferredName,
    Ear: grab(rx.ear),
    Reg: grab(rx.reg),
    GC: grab(rx.gc),
    Variety: grab(rx.variety),
    Weight: grab(rx.weight),
    Legs: grab(rx.legs),
    Born: normalizeDate(grab(rx.born))
  };
}

function normalizeDate(s) {
  if (!s) return '';
  // tolerate 11-10-2024, 11/10/2024, 11.10.2024, OCR O/0/1/I
  const t = s.replace(/[O]/g, '0').replace(/[Il]/g, '1').replace(/\./g, '/').replace(/-/g, '/');
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return s.trim();
  let [ , mm, dd, yy ] = m;
  if (yy.length === 2) yy = (+yy >= 70 ? '19' : '20') + yy;
  return `${mm.padStart(2,'0')}/${dd.padStart(2,'0')}/${yy}`;
}

function renderReadable(rows) {
  const lines = [];
  rows.forEach((r, i) => {
    lines.push(`R${i+1} — ${r.Role}`);
    if (r.Name)    lines.push(`  Name: ${r.Name}`);
    if (r.Variety) lines.push(`  Variety: ${r.Variety}`);
    if (r.Ear)     lines.push(`  Ear #: ${r.Ear}`);
    if (r.Reg)     lines.push(`  Reg #: ${r.Reg}`);
    if (r.GC)      lines.push(`  GC #: ${r.GC}`);
    if (r.Weight)  lines.push(`  Weight: ${r.Weight}`);
    if (r.Legs)    lines.push(`  Legs: ${r.Legs}`);
    if (r.Born)    lines.push(`  Born: ${r.Born}`);
    lines.push(''); // blank line
  });
  // convert to <br> for the embed
  return lines.map(l => l.replace(/&/g,'&amp;').replace(/</g,'&lt;')).join('<br>');
}

function renderTSV(rows) {
  const header = ['Index','Role','Name','Variety','Ear','Reg','GC','Weight','Legs','Born'];
  const safe = v => (v || '').replace(/\t/g, ' ').replace(/\r?\n/g, ' ').trim();
  const body = rows.map((r, i) => [
    i+1, r.Role, r.Name, r.Variety, r.Ear, r.Reg, r.GC, r.Weight, r.Legs, r.Born
  ].map(safe).join('\t'));
  return [header.join('\t'), ...body].join('\n');
}

// OPTIONAL: wire up copy buttons if you add them in index.html
function attachCopyButtons() {
  const copyReadable = document.getElementById('copyReadable');
  const copyTSV = document.getElementById('copyTSV');
  if (copyReadable) {
    copyReadable.onclick = () => copyFromElement('output');
  }
  if (copyTSV) {
    copyTSV.onclick = () => copyFromElement('tsv');
  }
}
function copyFromElement(id) {
  const el = document.getElementById(id);
  const text = id === 'output' ? el.innerText : el.textContent;
  navigator.clipboard.writeText(text);
}
