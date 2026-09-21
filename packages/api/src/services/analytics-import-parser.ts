import { createHash } from "node:crypto";

import {
	type AnalyticsColumnMapping,
	type AnalyticsImportMapping,
	type AnalyticsMetricFamily,
	type AnalyticsSourceType,
	analyticsMetricRegistry,
	metricKeysForFamily,
} from "@affichannel/core";
import * as XLSX from "xlsx";

export const ANALYTICS_IMPORT_LIMITS = {
	maxFileBytes: 5 * 1024 * 1024,
	maxSheets: 1,
	maxRows: 20_000,
	maxColumns: 40,
	maxCellCharacters: 16_384,
	maxFilenameCharacters: 255,
} as const;

export class AnalyticsImportError extends Error {
	readonly code: string;
	readonly details?: Record<string, unknown>;

	constructor(
		code: string,
		message: string,
		details?: Record<string, unknown>,
	) {
		super(message);
		this.name = "AnalyticsImportError";
		this.code = code;
		this.details = details;
	}
}

export type ParsedAnalyticsFile = {
	sourceType: AnalyticsSourceType;
	fileName: string;
	fileSha256: string;
	headers: string[];
	rows: Record<string, unknown>[];
};

function safeFilename(fileName: string) {
	const trimmed = fileName.trim();
	if (
		!trimmed ||
		trimmed.length > ANALYTICS_IMPORT_LIMITS.maxFilenameCharacters ||
		trimmed.includes("/") ||
		trimmed.includes("\\") ||
		trimmed === "." ||
		trimmed === ".."
	) {
		throw new AnalyticsImportError(
			"ANALYTICS_FILENAME_INVALID",
			"File name is invalid.",
		);
	}
	return trimmed;
}

function assertSourceExtension(
	fileName: string,
	sourceType: AnalyticsSourceType,
) {
	const extension = fileName.toLowerCase().split(".").at(-1);
	const expected = sourceType === "MANUAL_CSV" ? "csv" : "xlsx";
	if (extension !== expected) {
		throw new AnalyticsImportError(
			"ANALYTICS_FILE_TYPE_MISMATCH",
			`The selected file must be a .${expected} file.`,
		);
	}
}

function assertCell(value: unknown) {
	if (
		typeof value === "string" &&
		value.length > ANALYTICS_IMPORT_LIMITS.maxCellCharacters
	) {
		throw new AnalyticsImportError(
			"ANALYTICS_CELL_TOO_LARGE",
			"A spreadsheet cell exceeds the supported character limit.",
		);
	}
	return value ?? "";
}

function normalizeHeader(value: unknown, position: number) {
	const header = String(value ?? "").trim();
	if (!header || header.length > ANALYTICS_IMPORT_LIMITS.maxCellCharacters) {
		throw new AnalyticsImportError(
			"ANALYTICS_HEADER_INVALID",
			`Column ${position + 1} has an invalid header.`,
		);
	}
	return header;
}

function headersAndRows(rows: unknown[][]): {
	headers: string[];
	rows: Record<string, unknown>[];
} {
	if (rows.length < 2) {
		throw new AnalyticsImportError(
			"ANALYTICS_FILE_EMPTY",
			"The import must contain a header and at least one data row.",
		);
	}
	const headerRow = rows[0];
	if (!headerRow) {
		throw new AnalyticsImportError(
			"ANALYTICS_FILE_EMPTY",
			"The import is missing a header row.",
		);
	}
	const headers = headerRow.map(normalizeHeader);
	if (headers.length > ANALYTICS_IMPORT_LIMITS.maxColumns) {
		throw new AnalyticsImportError(
			"ANALYTICS_COLUMN_LIMIT_EXCEEDED",
			"The import contains too many columns.",
		);
	}
	if (
		new Set(headers.map((header) => header.toLocaleLowerCase())).size !==
		headers.length
	) {
		throw new AnalyticsImportError(
			"ANALYTICS_DUPLICATE_HEADERS",
			"Column headers must be unique.",
		);
	}
	const dataRows = rows.slice(1);
	if (dataRows.length > ANALYTICS_IMPORT_LIMITS.maxRows) {
		throw new AnalyticsImportError(
			"ANALYTICS_ROW_LIMIT_EXCEEDED",
			"The import contains too many rows.",
		);
	}
	return {
		headers,
		rows: dataRows.map((row) => {
			if (row.length > ANALYTICS_IMPORT_LIMITS.maxColumns) {
				throw new AnalyticsImportError(
					"ANALYTICS_COLUMN_LIMIT_EXCEEDED",
					"A data row contains too many columns.",
				);
			}
			return Object.fromEntries(
				headers.map((header, index) => [header, assertCell(row[index])]),
			);
		}),
	};
}

function parseCsv(bytes: Uint8Array) {
	let text: string;
	try {
		text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		throw new AnalyticsImportError(
			"ANALYTICS_CSV_ENCODING_INVALID",
			"CSV must be valid UTF-8.",
		);
	}
	if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = "";
	let inQuotes = false;
	for (let index = 0; index < text.length; index += 1) {
		const character = text[index];
		if (inQuotes) {
			if (character === '"') {
				if (text[index + 1] === '"') {
					cell += '"';
					index += 1;
				} else {
					inQuotes = false;
				}
			} else {
				cell += character;
			}
			continue;
		}
		if (character === '"' && cell.length === 0) {
			inQuotes = true;
			continue;
		}
		if (character === ",") {
			row.push(cell);
			cell = "";
			continue;
		}
		if (character === "\n" || character === "\r") {
			if (character === "\r" && text[index + 1] === "\n") index += 1;
			row.push(cell);
			cell = "";
			if (row.some((value) => value !== "") || rows.length > 0) rows.push(row);
			row = [];
			continue;
		}
		cell += character;
	}
	if (inQuotes) {
		throw new AnalyticsImportError(
			"ANALYTICS_CSV_MALFORMED",
			"CSV contains an unterminated quoted field.",
		);
	}
	if (cell.length > 0 || row.length > 0) {
		row.push(cell);
		rows.push(row);
	}
	return headersAndRows(rows);
}

function excelSerialToDate(value: number) {
	const parts = XLSX.SSF.parse_date_code(value);
	if (!parts?.y || !parts.m || !parts.d) return undefined;
	return new Date(
		Date.UTC(
			parts.y,
			parts.m - 1,
			parts.d,
			parts.H ?? 0,
			parts.M ?? 0,
			parts.S ?? 0,
		),
	);
}

function parseXlsx(bytes: Uint8Array) {
	let workbook: XLSX.WorkBook;
	try {
		workbook = XLSX.read(bytes, {
			type: "buffer",
			cellFormula: true,
			cellHTML: false,
			cellNF: false,
			cellStyles: false,
			cellDates: false,
			WTF: false,
		});
	} catch {
		throw new AnalyticsImportError(
			"ANALYTICS_XLSX_MALFORMED",
			"The XLSX workbook could not be safely parsed.",
		);
	}
	if (workbook.SheetNames.length > ANALYTICS_IMPORT_LIMITS.maxSheets) {
		throw new AnalyticsImportError(
			"ANALYTICS_SHEET_LIMIT_EXCEEDED",
			"Only one worksheet is supported for this import.",
		);
	}
	const sheetName = workbook.SheetNames[0];
	const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
	if (!sheet) {
		throw new AnalyticsImportError(
			"ANALYTICS_FILE_EMPTY",
			"The workbook does not contain a worksheet.",
		);
	}
	const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1");
	for (let row = range.s.r; row <= range.e.r; row += 1) {
		for (let column = range.s.c; column <= range.e.c; column += 1) {
			const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })] as
				| { f?: string }
				| undefined;
			if (cell?.f) {
				throw new AnalyticsImportError(
					"ANALYTICS_FORMULA_UNSUPPORTED",
					"Formula cells are rejected; formulas are never evaluated or imported.",
				);
			}
		}
	}
	const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
		header: 1,
		raw: true,
		defval: "",
		blankrows: false,
	});
	return headersAndRows(rows);
}

export function parseAnalyticsFile(input: {
	bytes: Uint8Array;
	fileName: string;
	sourceType: AnalyticsSourceType;
}): ParsedAnalyticsFile {
	if (
		input.bytes.byteLength <= 0 ||
		input.bytes.byteLength > ANALYTICS_IMPORT_LIMITS.maxFileBytes
	) {
		throw new AnalyticsImportError(
			"ANALYTICS_FILE_SIZE_LIMIT_EXCEEDED",
			"The file is empty or exceeds the 5 MiB import limit.",
			{ maxBytes: ANALYTICS_IMPORT_LIMITS.maxFileBytes },
		);
	}
	const fileName = safeFilename(input.fileName);
	assertSourceExtension(fileName, input.sourceType);
	const parsed =
		input.sourceType === "MANUAL_CSV"
			? parseCsv(input.bytes)
			: parseXlsx(input.bytes);
	return {
		...parsed,
		sourceType: input.sourceType,
		fileName,
		fileSha256: createHash("sha256").update(input.bytes).digest("hex"),
	};
}

const aliases: Record<keyof AnalyticsColumnMapping, string[]> = {
	recordedDate: ["date", "recorded_date", "recorded date", "day", "timestamp"],
	recordedRangeStart: ["start_date", "range_start", "recorded_range_start"],
	recordedRangeEnd: ["end_date", "range_end", "recorded_range_end"],
	metricFamily: ["metric_family", "family", "metric family", "category"],
	metricKey: ["metric_key", "metric", "metric name", "metric_name"],
	metricValue: ["metric_value", "value", "metric value", "amount", "total"],
	unit: ["unit", "metric_unit"],
	sourceIdentity: ["source", "source_identity", "platform", "channel"],
	projectId: ["project_id", "publication_id", "content_id"],
	plannedContentItemId: ["planned_content_item_id", "planned_content_id"],
	productId: ["product_id"],
	pillarId: ["pillar_id"],
	seriesId: ["series_id"],
	contentType: ["content_type", "content type"],
	contentFormatKey: ["content_format", "content_format_key", "format"],
	contentFormatVersion: ["content_format_version", "format_version"],
	creationPath: ["creation_path", "creation path", "path"],
	usageRecordType: ["usage_record_type", "usage type"],
	usageRecordId: ["usage_record_id", "usage id"],
};

function headerToken(value: string) {
	return value
		.toLocaleLowerCase()
		.trim()
		.replace(/[\s-]+/g, "_");
}

export function proposeAnalyticsMapping(
	headers: readonly string[],
): AnalyticsImportMapping {
	const byToken = new Map(
		headers.map((header) => [headerToken(header), header]),
	);
	const columns: AnalyticsColumnMapping = { metricValue: "" };
	for (const [field, candidates] of Object.entries(aliases) as [
		keyof AnalyticsColumnMapping,
		string[],
	][]) {
		const match = candidates
			.map((candidate) => byToken.get(headerToken(candidate)))
			.find(Boolean);
		if (match) columns[field] = match;
	}
	return { columns };
}

export function validateAnalyticsMapping(
	mapping: AnalyticsImportMapping,
	headers: readonly string[],
) {
	const headerSet = new Set(headers);
	const issues: string[] = [];
	const columns = mapping.columns;
	if (!columns.metricValue || !headerSet.has(columns.metricValue)) {
		issues.push("metricValue column is required and must be detected.");
	}
	if (
		(!columns.recordedDate || !headerSet.has(columns.recordedDate)) &&
		(!columns.recordedRangeStart || !headerSet.has(columns.recordedRangeStart))
	) {
		issues.push("recordedDate or recordedRangeStart column is required.");
	}
	if (columns.recordedRangeEnd && !headerSet.has(columns.recordedRangeEnd)) {
		issues.push("recordedRangeEnd column is not present in the file.");
	}
	if (
		!mapping.fixed?.metricFamily &&
		(!columns.metricFamily || !headerSet.has(columns.metricFamily))
	) {
		issues.push("metricFamily column or fixed metricFamily is required.");
	}
	if (
		!mapping.fixed?.metricKey &&
		(!columns.metricKey || !headerSet.has(columns.metricKey))
	) {
		issues.push("metricKey column or fixed metricKey is required.");
	}
	for (const value of Object.values(columns)) {
		if (value && !headerSet.has(value))
			issues.push(`Unknown mapping column: ${value}.`);
	}
	if (mapping.fixed?.metricKey && mapping.fixed.metricFamily) {
		if (
			!metricKeysForFamily(mapping.fixed.metricFamily).includes(
				mapping.fixed.metricKey,
			)
		) {
			issues.push(
				"The fixed metricKey is not valid for the fixed metricFamily.",
			);
		}
	}
	return issues;
}

export function metricUnitFor(
	family: AnalyticsMetricFamily,
	metricKey: string,
) {
	const registry = analyticsMetricRegistry[family] as Record<string, string>;
	return registry[metricKey];
}

export function excelDateConverter() {
	return excelSerialToDate;
}
