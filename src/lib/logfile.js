// Reads the simulation service's logfiles, which record where trees were placed
// for a run. The format is pseudo-JSON — unquoted keys, bare enum values, bare
// `null` — wrapped in a `[uuid] key=value` shell that isn't JSON at all:
//
//   [4509a983-…] centerCoordinate={latitude:49.44,longitude:7.76} radiusInMeters=100
//   gridType=PET interventions=[{objectId:null,type:TREE_SMALL,
//   coord:{lat:49.44,lon:7.76},orientation:0,new:false}, …]
//
// Fields are pulled out one at a time rather than repaired into JSON and
// parsed. Repair is all-or-nothing — one unexpected token would lose every tree
// in the record — and the substitutions needed to quote bare keys can't tell a
// key from a `:` inside a string value. Extracting per field means an
// unrecognised field simply doesn't match and one malformed tree doesn't take
// its siblings with it. The patterns also tolerate real JSON (`"lat": 49.4`),
// so they keep working if the format is ever tightened up.

/**
 * @typedef {{ lat: number, lon: number, type: string, isNew: boolean,
 *             objectId: string | null, orientation: number | null }} Intervention
 * @typedef {{ id: string | null, center: [number, number] | null, radius: number | null,
 *             gridType: string | null, interventions: Intervention[] }} LogEntry
 * @typedef {{ entries: LogEntry[], interventions: Intervention[], skipped: number }} ParsedLog
 */

// Every intervention is drawn at the same crown size, whatever its type.
export const CROWN_RADIUS_M = 3;

export const MAX_LOG_BYTES = 25 * 1024 * 1024;

// Shared by the drop zone and the file picker so both reject the same things
// the same way. Throws with a message meant for the control panel.
/** @param {File} file @returns {Promise<{ name: string, text: string }>} */
export async function readLogFile(file) {
	if (file.size > MAX_LOG_BYTES) throw new Error(`${file.name} is too large to read`);
	try {
		// Reading a dropped folder throws rather than returning empty.
		return { name: file.name, text: await file.text() };
	} catch {
		throw new Error(`Could not read ${file.name}`);
	}
}

const NUM = String.raw`(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)`;

// `\b<key>"?\s*[:=]` deliberately fails on a longer key that merely starts with
// the same letters: in `latitude:49.4` the `[:=]` would have to match `i`, so
// `lat` doesn't match and the caller falls through to the `latitude` spelling.
/** @param {string} src @param {string} key @returns {number | null} */
const num = (src, key) => {
	const m = new RegExp(String.raw`\b${key}"?\s*[:=]\s*"?` + NUM).exec(src);
	return m ? Number.parseFloat(m[1]) : null;
};

/** @param {string} src @param {string} key */
const has = (src, key) => new RegExp(String.raw`\b${key}"?\s*[:=]`).test(src);

const UUID = /\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i;
const CENTER = /centerCoordinate"?\s*[:=]\s*\{([^}]*)\}/;
const GRID = /\bgridType"?\s*[:=]\s*"?([A-Za-z0-9_]+)/;
const TYPE = /\btype"?\s*[:=]\s*"?([A-Za-z0-9_.-]+)/;
const IS_NEW = /\bnew"?\s*[:=]\s*"?(true|false)/i;
const OBJECT_ID = /\bobjectId"?\s*[:=]\s*(?:"([^"]*)"|([A-Za-z0-9_-]+))/;
const INTERVENTIONS = /interventions"?\s*[:=]\s*\[/g;

// Walks from `start` (just past an opening bracket) to the matching close,
// stepping over quoted spans so a bracket inside a string can't unbalance the
// count. This is the part a regex can't do, and the only reason the scan is
// hand-rolled.
/** @param {string} text @param {number} start @param {string} open @param {string} close */
function balancedSlice(text, start, open, close) {
	let depth = 1;
	/** @type {string | null} */
	let quote = null;
	for (let i = start; i < text.length; i++) {
		const c = text[i];
		if (quote) {
			if (c === '\\') i++;
			else if (c === quote) quote = null;
		} else if (c === '"' || c === "'") quote = c;
		else if (c === open) depth++;
		else if (c === close && --depth === 0) return { body: text.slice(start, i), end: i + 1 };
	}
	return { body: text.slice(start), end: text.length }; // unterminated — take what's there
}

// Each `{…}` sitting at the top level of the array body: one per intervention.
/** @param {string} body @returns {string[]} */
function splitTopLevelBraces(body) {
	const chunks = [];
	/** @type {string | null} */
	let quote = null;
	let depth = 0;
	let start = 0;
	for (let i = 0; i < body.length; i++) {
		const c = body[i];
		if (quote) {
			if (c === '\\') i++;
			else if (c === quote) quote = null;
		} else if (c === '"' || c === "'") quote = c;
		else if (c === '{') {
			if (depth++ === 0) start = i;
		} else if (c === '}' && depth > 0 && --depth === 0) chunks.push(body.slice(start, i + 1));
	}
	return chunks;
}

/** @param {string} chunk @returns {Intervention | null} */
function parseIntervention(chunk) {
	const lat = num(chunk, 'lat') ?? num(chunk, 'latitude');
	const lon = num(chunk, 'lon') ?? num(chunk, 'longitude') ?? num(chunk, 'lng');
	if (lat === null || lon === null) {
		// A coordinate key that yielded no number usually means decimal commas
		// (`lat:49,44`), which can't be told apart from the field separator.
		if (has(chunk, 'lat') || has(chunk, 'latitude')) {
			console.warn('logfile: coordinate present but unreadable, skipping', chunk);
		}
		return null;
	}
	if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
	const objectId = OBJECT_ID.exec(chunk);
	const raw = objectId?.[1] ?? objectId?.[2] ?? null;
	return {
		lat,
		lon,
		type: (TYPE.exec(chunk)?.[1] ?? 'UNKNOWN').toUpperCase(),
		isNew: IS_NEW.exec(chunk)?.[1].toLowerCase() === 'true',
		objectId: raw === 'null' ? null : raw,
		orientation: num(chunk, 'orientation')
	};
}

// Scans the whole text rather than splitting on newlines, so a log that ships
// as one long line parses the same as one record per line.
/** @param {string} text @returns {ParsedLog} */
export function parseLogfile(text) {
	/** @type {LogEntry[]} */
	const entries = [];
	/** @type {Intervention[]} */
	const interventions = [];
	let skipped = 0;
	let prevEnd = 0;

	INTERVENTIONS.lastIndex = 0;
	let match;
	while ((match = INTERVENTIONS.exec(text))) {
		// Everything since the previous record's array holds this record's header.
		const preamble = text.slice(prevEnd, match.index);
		const { body, end } = balancedSlice(text, match.index + match[0].length, '[', ']');
		prevEnd = end;
		INTERVENTIONS.lastIndex = end;

		const chunks = splitTopLevelBraces(body);
		const parsed = chunks.map(parseIntervention).filter((t) => t !== null);
		skipped += chunks.length - parsed.length;

		const centerBlock = CENTER.exec(preamble)?.[1];
		const lon = centerBlock ? num(centerBlock, 'longitude') ?? num(centerBlock, 'lon') : null;
		const lat = centerBlock ? num(centerBlock, 'latitude') ?? num(centerBlock, 'lat') : null;

		entries.push({
			id: UUID.exec(preamble)?.[1] ?? null,
			center: lon !== null && lat !== null ? /** @type {[number, number]} */ ([lon, lat]) : null,
			radius: num(preamble, 'radiusInMeters'),
			gridType: GRID.exec(preamble)?.[1] ?? null,
			interventions: parsed
		});
		interventions.push(...parsed);
	}

	return { entries, interventions, skipped };
}
