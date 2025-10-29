// OCRScanner.js — single-output version for Glide
async function runOCR(imageUrl, progressEl, outputEl) {
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

  // --- Clean and structure the OCR ---
  const clean = preClean(text);
  const sections = segmentRabbits(clean);
  const rabbits = sections.map(parseSection);

  // --- Render one readable text block ---
  const readable = rabbits.map((r, i) => {
    const lines = [];
    lines.push(`Rabbit ${i + 1} — ${r.Role}`);
    if (r.Name) lines.push(`Name: ${r.Name}`);
    if (r.Variety) lines.push(`Variety: ${r.Variety}`);
    if (r.Ear) lines.push(`Ear #: ${r.Ear}`);
    if (r.Reg) lines.push(`Reg #: ${r.Reg}`);
    if (r.GC) lines.push(`GC #: ${r.GC}`);
    if (r.Weight) lines.push(`Weight: ${r.Weight}`);
    if (r.Legs) lines.push(`Legs: ${r.Legs}`);
    if (r.Born) lines.push(`Born: ${r.Born}`);
    lines.push(''); // blank line between rabbits
    return lines.join('\n');
  }).join('\n');

  outputEl.innerText = readable;
  progressEl.textContent = '✅ OCR complete — copy and paste this text into Glide.';
}

// --- Helpers ---
function preClean(s) {
  return s
    .replace(/\r/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ariety/gi, 'Variety')
    .replace(/We[il1]?ght/gi, 'Weight')
    .replace(/Leg[s5]/gi, 'Legs')
    .replace(/\bRe[gq][\.\s#:]*/gi, 'Reg # ')
    .replace(/\b[Gg][Cc][\.\s#:]*/g, 'GC # ')
    .replace(/[Ee]ar[\s#:]*/g, 'Ear # ')
    .replace(/\bBorn[\s:]*([0-9OIl\-\/\.]+)/gi, 'Born: $1')
    .replace(/([0-9])\s*[il1]b\b/gi, '$1 lb')
    .replace(/\b([0-9])\s*[o0]z\b/gi, '$1 oz')
    .replace(/[|]/g, ' ')
    .trim();
}

function segmentRabbits(s) {
  const marked = s.replace(/\b(Name|Sire|Dam)\b\s*:?/gi, '\n=== $1 ===\n');
  const chunks = marked.split(/\n===\s*/).map(x => x.trim()).filter(Boolean);
  const result = [];
  for (const chunk of chunks) {
    const m = chunk.match(/^((Name|Sire|Dam))/i);
    if (m) {
      result.push({ role: m[1].toUpperCase(), block: chunk });
    } else {
      result.push({ role: 'UNKNOWN', block: chunk });
    }
  }
  result.sort((a, b) => roleRank(a.role) - roleRank(b.role));
  return result;
}

function roleRank(role) {
  const order = { 'NAME': 0, 'SIRE': 1, 'DAM': 2, 'UNKNOWN': 3 };
  return order[role] ?? 3;
}

function parseSection(sec) {
  const blk = ' ' + sec.block.replace(/\n/g, ' ') + ' ';
  const rx = {
    name: /(Name|Rabbit|Animal)[:\s]+([A-Za-z0-9'&\-\s]{3,})/,
    ear: /Ear\s*#[:\s]*([A-Z0-9\-]+)/i,
    reg: /Reg\s*#[:\s]*([A-Z0-9\-]+)/i,
    gc: /\bGC\s*#[:\s]*([A-Z0-9\-]+)/i,
    variety: /Variety[:\s]+([A-Za-z][A-Za-z\s\(\)\/\-]+?)\b(?=Weight|Legs|Ear|Reg|GC|Born|Sire|Dam|$)/i,
    weight: /Weight[:\s]*([0-9]{1,2}\s*lb\s*[0-9]{1,2}\s*oz)/i,
    legs: /Legs?[:\s]*([0-9]{1,2})\b/i,
    born: /Born[:\s]*([0-9OIl\-\/\.]{6,12})/i
  };
  function grab(r) {
    const m = blk.match(r);
    return m ? (m[2] || m[1] || '').toString().trim() : '';
  }
  const inferredName = !grab(rx.name) && /^(SIRE|DAM)/i.test(sec.role)
    ? grab(/^(?:Sire|Dam)[:\s]+([A-Za-z0-9'&\-\s]{3,})/i)
    : '';
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
  const t = s.replace(/[O]/g, '0').replace(/[Il]/g, '1').replace(/\./g, '/').replace(/-/g, '/');
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return s.trim();
  let [ , mm, dd, yy ] = m;
  if (yy.length === 2) yy = (+yy >= 70 ? '19' : '20') + yy;
  return `${mm.padStart(2,'0')}/${dd.padStart(2,'0')}/${yy}`;
}
