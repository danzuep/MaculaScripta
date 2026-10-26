// Browser-local LIFT projection and bounded ZIP exchange. No network requests.
const MiB = 1024 * 1024;
const limits = { archive: 128 * MiB, expanded: 128 * MiB, file: 32 * MiB, xml: 8 * MiB, files: 2000, records: 10000 };
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const audioTypes = { wav: "audio/wav", mp3: "audio/mpeg", ogg: "audio/ogg", webm: "audio/webm",
  m4a: "audio/mp4", mp4: "audio/mp4", flac: "audio/flac", opus: "audio/ogg", aac: "audio/aac" };
const children = (node, name) => [...(node?.children || [])].filter((child) => child.tagName === name);
const first = (node, name) => children(node, name)[0];
const text = (node) => first(node, "text")?.textContent || "";
const form = (node, language) => children(node, "form").find((item) => item.getAttribute("lang") === language);
const field = (node, name) => text(first(children(node, "field").find((item) => item.getAttribute("type") === name), "form"));
const key = (entry) => JSON.stringify([entry.liftEntryId, entry.liftSenseId]);

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

export function writingSystems(vernacular, gloss) {
  const valid = (value) => /^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/.test(value) && value.length <= 80;
  requireValue(valid(vernacular) && valid(gloss), "Enter valid writing-system tags, such as grc, en, or yue-Hant.");
  return { vernacular, gloss, ipa: `${vernacular}-fonipa` };
}

function safePath(value) {
  requireValue(typeof value === "string" && value.length > 0 && value.length <= 512 &&
    !/[\x00-\x1f\x7f\\:?#%]/.test(value) && !value.startsWith("/") &&
    value.split("/").every((part) => part && part !== "." && part !== ".."),
  "Unsafe file path or external audio URL. Use relative local filenames without traversal.");
  return value;
}

function mediaPath(value) {
  let decoded;
  try { decoded = decodeURIComponent(value); } catch { throw new Error("Invalid encoded audio filename."); }
  return safePath(decoded);
}

function extension(name) {
  return name.split(".").pop().toLowerCase();
}

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function inflate(bytes, expected) {
  requireValue(typeof DecompressionStream !== "undefined", "This browser cannot open compressed ZIPs. Select the extracted .lift and audio files instead.");
  let stream;
  try { stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw")); }
  catch { throw new Error("This browser cannot open deflated ZIPs. Extract the files and select them instead."); }
  const reader = stream.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      requireValue(size <= expected && size <= limits.file, "ZIP expansion exceeds its declared size or safety limit.");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  requireValue(size === expected, "ZIP file size does not match its directory.");
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

export async function readZip(file) {
  requireValue(file.size <= limits.archive, "ZIP exceeds the 128 MiB limit.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const u16 = (offset) => view.getUint16(offset, true);
  const u32 = (offset) => view.getUint32(offset, true);
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) &&
    !(u32(end) === 0x06054b50 && end + 22 + u16(end + 20) === bytes.length)) end -= 1;
  requireValue(end >= Math.max(0, bytes.length - 65557), "Invalid ZIP end directory.");
  requireValue(u16(end + 4) === 0 && u16(end + 6) === 0 && u16(end + 8) === u16(end + 10),
    "Split ZIP archives are not supported.");
  const count = u16(end + 10);
  const directory = u32(end + 16);
  requireValue(count > 0 && count <= limits.files && directory + u32(end + 12) === end, "Invalid or oversized ZIP directory; ZIP64 is not supported.");
  const files = new Map();
  let offset = directory;
  let total = 0;
  const regions = [];
  for (let index = 0; index < count; index += 1) {
    requireValue(offset + 46 <= end && u32(offset) === 0x02014b50, "Invalid ZIP directory record.");
    const flags = u16(offset + 8);
    const method = u16(offset + 10);
    const crc = u32(offset + 16);
    const compressed = u32(offset + 20);
    const size = u32(offset + 24);
    const nameLength = u16(offset + 28);
    const next = offset + 46 + nameLength + u16(offset + 30) + u16(offset + 32);
    const local = u32(offset + 42);
    requireValue(next <= end && !(flags & ~0x808) && (method === 0 || method === 8) &&
      u16(offset + 34) === 0 && (u32(offset + 38) >>> 16 & 0xf000) !== 0xa000,
    "Encrypted, linked, or unsupported ZIP entry.");
    const rawName = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    const isDirectory = rawName.endsWith("/");
    const name = safePath(isDirectory ? rawName.slice(0, -1) : rawName);
    requireValue(!files.has(name) && size <= limits.file && compressed <= limits.archive,
      "Duplicate ZIP filename or file exceeds the 32 MiB limit.");
    total += size;
    requireValue(total <= limits.expanded, "Expanded ZIP exceeds the 128 MiB limit.");
    requireValue(local + 30 <= directory && u32(local) === 0x04034b50 &&
      u16(local + 6) === flags && u16(local + 8) === method, "Invalid ZIP local header.");
    const dataOffset = local + 30 + u16(local + 26) + u16(local + 28);
    requireValue(dataOffset + compressed <= directory &&
      decoder.decode(bytes.subarray(local + 30, local + 30 + u16(local + 26))) === rawName,
    "ZIP filename or data bounds mismatch.");
    if (!(flags & 8)) requireValue(u32(local + 14) === crc && u32(local + 18) === compressed && u32(local + 22) === size,
      "ZIP local size or checksum mismatch.");
    regions.push([local, dataOffset + compressed]);
    const packed = bytes.subarray(dataOffset, dataOffset + compressed);
    const data = method === 8 ? await inflate(packed, size) : packed;
    requireValue(data.length === size && crc32(data) === crc, "ZIP checksum mismatch.");
    requireValue(!isDirectory || size === 0, "ZIP directory contains data.");
    files.set(name, isDirectory ? null : new Blob([data]));
    offset = next;
  }
  requireValue(offset === end, "Unexpected ZIP directory data.");
  regions.sort((a, b) => a[0] - b[0]);
  requireValue(regions.every((region, index) => !index || region[0] >= regions[index - 1][1]), "Overlapping ZIP entries.");
  return new Map([...files].filter(([, fileBlob]) => fileBlob));
}

export async function makeZip(files) {
  requireValue(files.size <= limits.files, "Too many files to export (maximum 2,000).");
  const parts = [];
  const directory = [];
  let offset = 0;
  let total = 0;
  for (const [path, blob] of files) {
    const name = encoder.encode(safePath(path));
    requireValue(blob.size <= limits.file, "An export file exceeds the 32 MiB limit.");
    total += blob.size;
    requireValue(total <= limits.expanded, "Export exceeds the 128 MiB limit.");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const crc = crc32(bytes);
    const header = new Uint8Array(30 + name.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x800, true);
    view.setUint16(12, 33, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, bytes.length, true);
    view.setUint32(22, bytes.length, true);
    view.setUint16(26, name.length, true);
    header.set(name, 30);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x800, true);
    cv.setUint16(14, 33, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, bytes.length, true);
    cv.setUint32(24, bytes.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    parts.push(header, bytes);
    directory.push(central);
    offset += header.length + bytes.length;
  }
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.size, true);
  ev.setUint16(10, files.size, true);
  ev.setUint32(12, directory.reduce((sum, item) => sum + item.length, 0), true);
  ev.setUint32(16, offset, true);
  const zip = new Blob([...parts, ...directory, end], { type: "application/zip" });
  requireValue(zip.size <= limits.archive, "Export ZIP exceeds the 128 MiB limit.");
  return zip;
}

async function inputFiles(selected) {
  requireValue(selected.length > 0 && selected.length <= limits.files, "Select one .lift file with optional audio, or one ZIP.");
  const zips = selected.filter((file) => /\.zip$/i.test(file.name));
  if (zips.length) {
    requireValue(selected.length === 1, "Select a ZIP by itself, or select extracted LIFT and audio files together.");
    return readZip(zips[0]);
  }
  const result = new Map();
  let total = 0;
  for (const file of selected) {
    const name = safePath(file.name);
    total += file.size;
    requireValue(!result.has(name) && file.size <= limits.file && total <= limits.expanded,
      "Duplicate filename or input exceeds the file/total size limit.");
    result.set(name, file);
  }
  return result;
}

function matchAudio(path, liftPath, files) {
  const directory = liftPath.includes("/") ? liftPath.slice(0, liftPath.lastIndexOf("/") + 1) : "";
  for (const candidate of [directory + path, directory + "audio/" + path, directory + "AudioVisual/" + path, path]) {
    if (files.has(candidate)) return files.get(candidate);
  }
  const basename = path.split("/").pop();
  const matches = [...files].filter(([name]) => name.split("/").pop() === basename);
  requireValue(matches.length <= 1, `Ambiguous audio filename: ${basename}`);
  return matches[0]?.[1] || null;
}

export async function importLift(selected, languages) {
  const files = await inputFiles([...selected]);
  const lifts = [...files].filter(([name]) => /\.lift$/i.test(name));
  requireValue(lifts.length === 1, "Select exactly one LIFT document (ZIP must contain exactly one .lift).");
  const [liftPath, liftFile] = lifts[0];
  requireValue(liftFile.size <= limits.xml, "LIFT XML exceeds the 8 MiB limit.");
  const xml = decoder.decode(await liftFile.arrayBuffer());
  requireValue(!/<!\s*(?:DOCTYPE|ENTITY)/i.test(xml), "DTD and entity declarations are not allowed.");
  requireValue(!/<\?xml[^?]*encoding\s*=\s*['"](?!utf-8['"])[^'"]+/i.test(xml), "LIFT must use UTF-8 encoding.");
  const document = new DOMParser().parseFromString(xml, "application/xml");
  requireValue(!document.querySelector("parsererror") && document.documentElement.tagName === "lift" &&
    !document.documentElement.namespaceURI && document.documentElement.getAttribute("version") === "0.13",
  "Invalid XML or unsupported LIFT version. Expected an unnamespaced LIFT 0.13 document.");
  const nodes = [...document.getElementsByTagName("*")];
  requireValue(nodes.length <= 150000, "LIFT has too many XML elements.");
  for (const node of nodes) {
    let depth = 0;
    for (let parent = node.parentElement; parent; parent = parent.parentElement) depth += 1;
    requireValue(depth <= 40, "LIFT XML nesting is too deep.");
    // Validate even references outside the supported projection; never fetch them.
    if (node.tagName === "media") mediaPath(node.getAttribute("href") || "");
    if (node.tagName === "form" && /(?:^|-)audio$/i.test(node.getAttribute("lang") || "")) mediaPath(text(node));
  }
  const records = [];
  const entryIds = new Set();
  const identities = new Set();
  let missingAudio = 0;
  let missingGloss = 0;
  let deleted = 0;
  for (const entry of children(document.documentElement, "entry")) {
    if (entry.hasAttribute("dateDeleted")) { deleted += 1; continue; }
    const entryId = entry.getAttribute("id") || entry.getAttribute("guid");
    requireValue(entryId && entryId.length <= 1024 && !entryIds.has(entryId), "Entry IDs must be present and unique (a GUID may substitute for a missing ID).");
    entryIds.add(entryId);
    const lexical = first(entry, "lexical-unit") || first(entry, "citation");
    const lemma = text(form(lexical, languages.vernacular)).trim();
    requireValue(lemma, `Entry ${entryId} has no lexical form for ${languages.vernacular}. Choose its writing system.`);
    const pronunciations = children(entry, "pronunciation");
    const ipa = pronunciations.map((node) => text(form(node, languages.ipa))).find(Boolean) || "";
    const paths = pronunciations.flatMap((node) => [
      ...children(node, "media").map((media) => mediaPath(media.getAttribute("href") || "")),
      ...children(node, "form").filter((item) => /(?:^|-)audio$/i.test(item.getAttribute("lang") || ""))
        .map((item) => mediaPath(text(item)))
    ]);
    const audioPath = paths[0];
    let audioBlob = null;
    if (audioPath) {
      const type = audioTypes[extension(audioPath)];
      requireValue(type, `Unsupported audio extension: ${audioPath}`);
      const audio = matchAudio(audioPath, liftPath, files);
      if (audio) audioBlob = audio.slice(0, audio.size, type);
      else missingAudio += 1;
    }
    const senses = children(entry, "sense");
    for (const [index, sense] of (senses.length ? senses : [null]).entries()) {
      const senseId = sense ? sense.getAttribute("id") || `macula-sense-${index + 1}` : "";
      const glossNode = children(sense, "gloss").find((item) => item.getAttribute("lang") === languages.gloss);
      const gloss = text(glossNode) || text(form(first(sense, "definition"), languages.gloss));
      if (!gloss) missingGloss += 1;
      const record = {
        liftEntryId: entryId, liftSenseId: senseId, liftGuid: entry.getAttribute("guid") || "",
        language: languages.vernacular, glossLanguage: languages.gloss, ipaLanguage: languages.ipa,
        lemma, ipa, gloss, syntax: field(sense, "macula-syntax") || first(sense, "grammatical-info")?.getAttribute("value") || "",
        ref: field(entry, "macula-reference"), morph: field(entry, "macula-morphology"),
        audioBlob, createdAt: entry.getAttribute("dateCreated") || new Date().toISOString()
      };
      requireValue(senseId.length <= 1024 && !identities.has(key(record)), "Duplicate entry/sense identity in LIFT.");
      identities.add(key(record));
      records.push(record);
      requireValue(records.length <= limits.records, "LIFT exceeds the 10,000-record limit.");
    }
  }
  requireValue(records.length, "No live entries to import. Deletion markers never delete local data.");
  return { records, missingAudio, missingGloss, deleted };
}

function append(document, parent, name, attributes = {}, value) {
  const node = document.createElement(name);
  for (const [keyName, content] of Object.entries(attributes)) node.setAttribute(keyName, content);
  if (value !== undefined) node.textContent = value;
  parent.append(node);
  return node;
}

function addForm(document, parent, language, value) {
  append(document, append(document, parent, "form", { lang: language }), "text", {}, value);
}

function addField(document, parent, name, value, language) {
  if (value) addForm(document, append(document, parent, "field", { type: name }), language, value);
}

export async function exportLift(records, languages) {
  requireValue(records.length > 0 && records.length <= limits.records, "The dictionary must contain 1–10,000 records.");
  const document = new DOMParser().parseFromString('<lift version="0.13" producer="MaculaScripta"/>', "application/xml");
  const root = document.documentElement;
  const definitions = append(document, append(document, root, "header"), "fields");
  for (const [name, owner, description] of [
    ["macula-reference", "LexEntry", "Macula source references"],
    ["macula-morphology", "LexEntry", "Recorder morphology tags"],
    ["macula-syntax", "LexSense", "Recorder syntax node"]
  ]) {
    const definition = append(document, definitions, "field", { tag: name });
    addForm(document, definition, "en", description);
    addForm(document, definition, "qaa-x-spec", `Class=${owner}; Type=MultiUnicode; WsSelector=kwsAnal`);
  }
  const groups = new Map();
  const identities = new Set();
  for (const record of records) {
    requireValue(record.liftEntryId && typeof record.liftSenseId === "string" && !identities.has(key(record)), "Missing or duplicate stable LIFT identity.");
    identities.add(key(record));
    if (!groups.has(record.liftEntryId)) groups.set(record.liftEntryId, []);
    groups.get(record.liftEntryId).push(record);
  }
  const files = new Map();
  let audioNumber = 0;
  for (const [id, group] of groups) {
    const record = group[0];
    requireValue(group.every((item) => ["lemma", "ipa", "ref", "morph", "language", "ipaLanguage"].every((name) => item[name] === record[name])),
      `Conflicting entry-level fields for ${id}; export JSON for a full backup.`);
    const language = record.language || languages.vernacular;
    const glossLanguage = record.glossLanguage || languages.gloss;
    const ipaLanguage = record.ipaLanguage || languages.ipa;
    const attributes = { id };
    if (record.liftGuid) attributes.guid = record.liftGuid;
    if (/^\d{4}-\d\d-\d\d(?:T.*)?$/.test(record.createdAt || "") && Number.isFinite(Date.parse(record.createdAt))) attributes.dateCreated = record.createdAt;
    const entry = append(document, root, "entry", attributes);
    addForm(document, append(document, entry, "lexical-unit"), language, record.lemma);
    const blob = group.find((item) => item.audioBlob)?.audioBlob;
    if (record.ipa || blob) {
      const pronunciation = append(document, entry, "pronunciation");
      if (record.ipa) addForm(document, pronunciation, ipaLanguage, record.ipa);
      if (blob) {
        const ext = Object.keys(audioTypes).find((item) => audioTypes[item] === blob.type);
        requireValue(ext, "Unknown audio format. Export JSON to retain this recording.");
        const filename = `recording-${++audioNumber}.${ext}`;
        files.set(`audio/${filename}`, blob);
        // FLEx resolves pronunciation media filenames inside the sibling audio directory.
        append(document, pronunciation, "media", { href: filename });
      }
    }
    addField(document, entry, "macula-reference", record.ref, glossLanguage);
    addField(document, entry, "macula-morphology", record.morph, glossLanguage);
    for (const item of group) {
      if (!item.liftSenseId) continue;
      const sense = append(document, entry, "sense", { id: item.liftSenseId });
      if (item.gloss) append(document, append(document, sense, "gloss", { lang: item.glossLanguage || languages.gloss }), "text", {}, item.gloss);
      addField(document, sense, "macula-syntax", item.syntax, item.glossLanguage || languages.gloss);
    }
  }
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(document);
  requireValue(!new DOMParser().parseFromString(xml, "application/xml").querySelector("parsererror"),
    "A dictionary field contains characters that cannot be represented in XML. Export JSON to preserve it.");
  const lift = new Blob([xml], { type: "application/xml" });
  requireValue(lift.size <= limits.xml, "Export LIFT exceeds the 8 MiB XML limit.");
  files.set("macula-dictionary.lift", lift);
  return makeZip(files);
}

export function stableRecords(database, storeName) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    let records;
    const request = store.getAll();
    request.onsuccess = () => {
      records = request.result;
      for (const record of records) {
        if (!record.liftEntryId) {
          record.liftGuid = crypto.randomUUID();
          record.liftEntryId = `macula-${record.liftGuid}`;
          record.liftSenseId = crypto.randomUUID();
          store.put(record);
        }
      }
    };
    transaction.oncomplete = () => resolve(records);
    transaction.onabort = () => reject(transaction.error || new Error("Could not save stable exchange IDs."));
    transaction.onerror = () => reject(transaction.error);
  });
}

export function mergeLift(database, storeName, records) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    let failure;
    const result = { added: 0, updated: 0 };
    store.getAll().onsuccess = (event) => {
      try {
        const existing = new Map();
        for (const record of event.target.result) {
          if (!record.liftEntryId) continue;
          requireValue(!existing.has(key(record)), "Local dictionary has duplicate LIFT identities. Export JSON before resolving them.");
          existing.set(key(record), record);
        }
        const seen = new Set();
        for (const record of records) {
          requireValue(!seen.has(key(record)), "Duplicate import identity.");
          seen.add(key(record));
          const previous = existing.get(key(record));
          const merged = { ...previous, ...record };
          if (previous) {
            merged.id = previous.id;
            merged.createdAt = previous.createdAt;
            merged.audioBlob = record.audioBlob || previous.audioBlob || null;
            result.updated += 1;
          } else {
            delete merged.id;
            result.added += 1;
          }
          store.put(merged);
        }
      } catch (error) {
        failure = error;
        transaction.abort();
      }
    };
    transaction.oncomplete = () => resolve(result);
    transaction.onabort = () => reject(failure || transaction.error || new Error("Import rolled back; no records were changed."));
    transaction.onerror = () => { failure ||= transaction.error; };
  });
}
