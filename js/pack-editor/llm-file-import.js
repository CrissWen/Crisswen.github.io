import {
  parseLines,
  parseCardLine,
  cardToLine,
  formatStageEntry,
  OBJECT_STAGE_KEYS,
  STAGE_SUPPORTING_CATEGORIES
} from './parser.js';
import { validateCataclysmInput } from './payload.js';

export const MAX_IMPORT_FILE_BYTES = 1_048_576; // 1 MB

const ALLOWED_META_BY_CATEGORY = {
  gender: new Set(['can_reproduce', 'opposite', 'custom_age', 'has_no_age', 'range', 'stages']),
  body_type: new Set(['has_no_height', 'exact_height', 'range', 'stages']),
  profession: new Set(['ability', 'stages']),
  hobby: new Set(['stages']),
  health: new Set(['stages']),
  special_ability: new Set(['action_type']),
  cataclysm: new Set(['description', 'timer_minutes', 'stay_time_months', 'population'])
};

export function validateImportFileMeta({ name = '', type = '', size = 0 } = {}) {
  const lower = String(name).trim().toLowerCase();
  const isTxt = lower.endsWith('.txt') || type === 'text/plain';
  const isJson = lower.endsWith('.json') || type === 'application/json';

  if (!isTxt && !isJson) {
    return { ok: false, error: 'Підтримуються лише файли .txt або .json' };
  }
  if (!Number.isFinite(size) || size <= 0) {
    return { ok: false, error: 'Файл порожній' };
  }
  if (size > MAX_IMPORT_FILE_BYTES) {
    return { ok: false, error: 'Файл занадто великий (максимум 1 МБ)' };
  }
  return { ok: true, kind: isJson ? 'json' : 'txt' };
}

export function cleanTxtLine(rawLine) {
  const trimmed = String(rawLine ?? '').trim();
  if (!trimmed || /^```/.test(trimmed)) return '';
  return trimmed
    .replace(/^(?:\d+[.)]|[-•*])\s+/, '')
    .trim();
}

function hasBalancedDelimiters(line) {
  let curly = 0;
  let square = 0;
  let inQuotes = false;
  let quoteChar = '';

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const prev = i > 0 ? line[i - 1] : '';
    if (inQuotes) {
      if (ch === quoteChar && prev !== '\\') inQuotes = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuotes = true;
      quoteChar = ch;
    } else if (ch === '{') {
      curly++;
    } else if (ch === '}') {
      curly--;
      if (curly < 0) return false;
    } else if (ch === '[') {
      square++;
    } else if (ch === ']') {
      square--;
      if (square < 0) return false;
    }
  }
  return !inQuotes && curly === 0 && square === 0;
}

function extractEntries(content, kind, targetKey) {
  const text = String(content ?? '').replace(/^\uFEFF/, '').trim();
  if (!text) return { error: 'Файл порожній' };

  if (kind === 'json') {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { error: 'Невалідний формат JSON у файлі' };
    }
    let list = null;
    if (Array.isArray(parsed)) {
      list = parsed;
    } else if (parsed && typeof parsed === 'object') {
      const candidateKeys = [targetKey, 'cards', 'items', 'stages', 'cataclysms', 'data', 'list'].filter(Boolean);
      for (const k of candidateKeys) {
        if (Array.isArray(parsed[k])) {
          list = parsed[k];
          break;
        }
      }
    }
    if (!Array.isArray(list)) {
      return { error: 'JSON-файл має містити масив записів' };
    }
    return { entries: list };
  }

  const entries = text
    .split(/\r?\n/)
    .map(cleanTxtLine)
    .filter(Boolean);
  if (!entries.length) return { error: 'Файл не містить текстових рядків' };
  return { entries };
}

function objectToCardLine(category, obj) {
  if (!obj || typeof obj !== 'object') return '';
  const rawName = String(obj.value ?? obj.name ?? obj.title ?? '').trim();
  if (!rawName) return '';

  if (category === 'cataclysm') {
    const desc = obj.description ?? obj.desc ?? '';
    const timer = obj.timer_minutes ?? obj.timer ?? 0;
    const stay = obj.stay_time_months ?? obj.stay ?? obj.stay_time ?? '';
    const pop = obj.population ?? obj.pop ?? '';
    return `${rawName} {desc: "${String(desc).replace(/"/g, '\\"')}", timer: ${timer}, stay: ${stay}, pop: ${pop}}`;
  }

  const baseMeta = (obj.meta && typeof obj.meta === 'object') ? { ...obj.meta } : {};
  const extraProps = [];
  for (const [k, v] of Object.entries(obj)) {
    if (['id', 'value', 'name', 'title', 'meta', 'stages', 'category', 'pool_type'].includes(k)) continue;
    if (v === undefined) continue;
    if (v !== null && typeof v === 'object') {
      baseMeta[k] = v;
      continue;
    }
    extraProps.push(`${k}: ${typeof v === 'string' ? `"${v.replace(/"/g, '\\"')}"` : v}`);
  }

  let syntheticLine = rawName;
  if (category === 'profession' && (obj.ability || baseMeta.ability)) {
    syntheticLine = `${rawName} - ${String(obj.ability || baseMeta.ability).trim()}`;
  }
  if (extraProps.length) {
    syntheticLine += ` {${extraProps.join(', ')}}`;
  }
  const { value, meta } = parseCardLine(category, syntheticLine);
  const mergedMeta = { ...baseMeta, ...meta };
  if (Array.isArray(obj.stages)) mergedMeta.stages = obj.stages;
  return cardToLine(category, value, mergedMeta);
}

function validateAndNormalizeCardLine(category, entry, seenNames) {
  const line = typeof entry === 'string'
    ? cleanTxtLine(entry)
    : objectToCardLine(category, entry);
  if (!line || !hasBalancedDelimiters(line)) return null;

  const { value, meta } = parseCardLine(category, line);
  const cleanName = String(value ?? '').trim();
  if (!cleanName) return null;

  const nameKey = cleanName.toLowerCase();
  if (seenNames.has(nameKey)) return null;

  if (category === 'cataclysm') {
    const check = validateCataclysmInput({
      name: cleanName,
      desc: String(meta.description ?? ''),
      timer: meta.timer_minutes !== undefined ? String(meta.timer_minutes) : '0',
      stay: meta.stay_time_months !== undefined ? String(meta.stay_time_months) : '',
      pop: meta.population !== undefined ? String(meta.population) : ''
    });
    if (check.error || !check.item) return null;
    seenNames.add(nameKey);
    return cardToLine('cataclysm', check.item.name, {
      description: check.item.description,
      timer_minutes: check.item.timer_minutes,
      stay_time_months: check.item.stay_time_months,
      population: check.item.population
    });
  }

  const allowedMeta = ALLOWED_META_BY_CATEGORY[category] || new Set();
  for (const key of Object.keys(meta)) {
    if (!allowedMeta.has(key)) return null;
  }

  if (meta.range) {
    const { min, max } = meta.range;
    if (min !== undefined && (!Number.isFinite(min) || min < 0)) return null;
    if (max !== undefined && (!Number.isFinite(max) || max < 0)) return null;
    if (min !== undefined && max !== undefined && min > max) return null;
  }

  if (meta.stages !== undefined) {
    if (!STAGE_SUPPORTING_CATEGORIES.includes(category)) return null;
    if (!Array.isArray(meta.stages) || meta.stages.length === 0) return null;
  }

  seenNames.add(nameKey);
  return cardToLine(category, cleanName, meta);
}

export function importCardsContent({ content, kind = 'txt', category, existingText = '' }) {
  const extracted = extractEntries(content, kind, category);
  if (extracted.error) {
    return { addedLines: [], nextText: existingText, addedCount: 0, skippedCount: 0, error: extracted.error };
  }

  const existingLines = parseLines(existingText);
  const seenNames = new Set(
    existingLines
      .map(l => String(parseCardLine(category, l).value ?? '').trim().toLowerCase())
      .filter(Boolean)
  );

  const addedLines = [];
  let skippedCount = 0;

  for (const entry of extracted.entries) {
    const normalized = validateAndNormalizeCardLine(category, entry, seenNames);
    if (normalized) {
      addedLines.push(normalized);
    } else {
      skippedCount++;
    }
  }

  if (addedLines.length === 0) {
    return {
      addedLines: [],
      nextText: existingText,
      addedCount: 0,
      skippedCount,
      error: 'У файлі не знайдено нових валідних карток для цієї категорії'
    };
  }

  const base = String(existingText ?? '').trim();
  const nextText = base ? `${base}\n${addedLines.join('\n')}` : addedLines.join('\n');

  return {
    addedLines,
    nextText,
    addedCount: addedLines.length,
    skippedCount
  };
}

function validateAndNormalizeStageEntry(stageKey, entry, seenNames) {
  const isObjectStage = OBJECT_STAGE_KEYS.includes(stageKey);
  let rawLine = '';

  if (typeof entry === 'string') {
    rawLine = cleanTxtLine(entry);
  } else if (entry && typeof entry === 'object') {
    const name = String(entry.name ?? entry.value ?? '').trim();
    const limit = entry.up_to_age ?? entry.up_to_months ?? entry.limit;
    if (!name) return null;
    if (limit !== undefined && limit !== null && limit !== '') {
      rawLine = `${name}: ${limit}`;
    } else {
      rawLine = name;
    }
  }

  if (!rawLine || !hasBalancedDelimiters(rawLine)) return null;

  if (!isObjectStage) {
    const nameKey = rawLine.toLowerCase();
    if (seenNames.has(nameKey)) return null;
    seenNames.add(nameKey);
    return rawLine;
  }

  const colonIdx = rawLine.lastIndexOf(':');
  let name = rawLine;
  let limitVal = null;

  if (colonIdx > 0) {
    name = rawLine.slice(0, colonIdx).trim();
    const rhs = rawLine.slice(colonIdx + 1).trim();
    if (rhs.toLowerCase() !== 'null' && rhs !== '') {
      if (!/^\d+$/.test(rhs)) return null;
      const n = Number(rhs);
      if (!Number.isInteger(n) || n < 1) return null;
      limitVal = n;
    }
  }

  if (!name) return null;
  const nameKey = name.toLowerCase();
  if (seenNames.has(nameKey)) return null;
  seenNames.add(nameKey);

  return formatStageEntry({
    name,
    [stageKey === 'age_categories' ? 'up_to_age' : 'up_to_months']: limitVal
  });
}

export function importStagesContent({ content, kind = 'txt', stageKey, existingText = '' }) {
  const extracted = extractEntries(content, kind, stageKey);
  if (extracted.error) {
    return { addedLines: [], nextText: existingText, addedCount: 0, skippedCount: 0, error: extracted.error };
  }

  const existingLines = parseLines(existingText);
  const seenNames = new Set(
    existingLines.map(l => {
      const idx = l.lastIndexOf(':');
      return (idx > 0 ? l.slice(0, idx) : l).trim().toLowerCase();
    }).filter(Boolean)
  );

  const addedLines = [];
  let skippedCount = 0;

  for (const entry of extracted.entries) {
    const normalized = validateAndNormalizeStageEntry(stageKey, entry, seenNames);
    if (normalized) {
      addedLines.push(normalized);
    } else {
      skippedCount++;
    }
  }

  if (addedLines.length === 0) {
    return {
      addedLines: [],
      nextText: existingText,
      addedCount: 0,
      skippedCount,
      error: 'У файлі не знайдено нових валідних стадій'
    };
  }

  const base = String(existingText ?? '').trim();
  const nextText = base ? `${base}\n${addedLines.join('\n')}` : addedLines.join('\n');

  return {
    addedLines,
    nextText,
    addedCount: addedLines.length,
    skippedCount
  };
}


export async function processDroppedLlmFiles(
  files,
  { mode = 'cards', targetKey, existingText = '' } = {}
) {
  const fileList = Array.from(files || []);
  if (!fileList.length) {
    return { ok: false, nextText: existingText, addedCount: 0, skippedCount: 0, message: '' };
  }

  let currentText = existingText;
  let totalAdded = 0;
  let totalSkipped = 0;
  let lastError = '';

  for (const file of fileList) {
    const metaCheck = validateImportFileMeta(file);
    if (!metaCheck.ok) {
      lastError = metaCheck.error;
      continue;
    }

    let rawContent = '';
    try {
      rawContent = await file.text();
    } catch {
      lastError = 'Не вдалося прочитати файл';
      continue;
    }

    const res = mode === 'stages'
      ? importStagesContent({
          content: rawContent,
          kind: metaCheck.kind,
          stageKey: targetKey,
          existingText: currentText
        })
      : importCardsContent({
          content: rawContent,
          kind: metaCheck.kind,
          category: targetKey,
          existingText: currentText
        });

    if (res.error) {
      lastError = res.error;
      totalSkipped += res.skippedCount;
      continue;
    }

    currentText = res.nextText;
    totalAdded += res.addedCount;
    totalSkipped += res.skippedCount;
  }

  if (totalAdded === 0) {
    return {
      ok: false,
      nextText: existingText,
      addedCount: 0,
      skippedCount: totalSkipped,
      message: lastError || 'У файлі не знайдено нових валідних записів'
    };
  }

  const noun = mode === 'stages' ? 'стадій' : 'карток';
  const message = totalSkipped > 0
    ? `Додано ${totalAdded} ${noun} із файлу (пропущено ${totalSkipped} невалідних або дублікатів)`
    : `Додано ${totalAdded} ${noun} із файлу`;

  return {
    ok: true,
    nextText: currentText,
    addedCount: totalAdded,
    skippedCount: totalSkipped,
    message
  };
}
