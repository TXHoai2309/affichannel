function u16(value: number) {
	return new Uint8Array([(value >>> 8) & 0xff, value & 0xff]);
}

function u32(value: number) {
	return new Uint8Array([
		(value >>> 24) & 0xff,
		(value >>> 16) & 0xff,
		(value >>> 8) & 0xff,
		value & 0xff,
	]);
}

function text(value: string) {
	return new TextEncoder().encode(value);
}

function concat(...parts: Uint8Array[]) {
	const result = new Uint8Array(
		parts.reduce((sum, part) => sum + part.byteLength, 0),
	);
	let offset = 0;
	for (const part of parts) {
		result.set(part, offset);
		offset += part.byteLength;
	}
	return result;
}

function box(type: string, payload: Uint8Array) {
	return concat(u32(payload.byteLength + 8), text(type), payload);
}

function fullBox(type: string, payload: Uint8Array) {
	return box(type, concat(new Uint8Array(4), payload));
}

function zeros(length: number) {
	return new Uint8Array(length);
}

function mvhd() {
	const payload = zeros(20);
	payload.set(u32(30), 8);
	payload.set(u32(1), 12);
	return fullBox("mvhd", payload);
}

function tkhd(width: number, height: number) {
	const payload = zeros(84);
	payload.set(u32(1), 16);
	payload.set(u32(width * 0x10000), 72);
	payload.set(u32(height * 0x10000), 76);
	return fullBox("tkhd", payload);
}

function mdhd(timescale: number, duration: number) {
	const payload = zeros(20);
	payload.set(u32(timescale), 8);
	payload.set(u32(duration), 12);
	return fullBox("mdhd", payload);
}

function hdlr(handler: "vide" | "soun") {
	return fullBox("hdlr", concat(zeros(4), text(handler), zeros(12)));
}

function stsd(entry: Uint8Array) {
	return fullBox("stsd", concat(u32(1), entry));
}

function stts(sampleDelta: number) {
	return fullBox("stts", concat(u32(1), u32(1), u32(sampleDelta)));
}

function stsc() {
	return fullBox("stsc", concat(u32(1), u32(1), u32(1), u32(1)));
}

function stsz(sampleSize: number) {
	return fullBox("stsz", concat(u32(0), u32(1), u32(sampleSize)));
}

function stco(offset: number) {
	return fullBox("stco", concat(u32(1), u32(offset)));
}

function dinf() {
	const selfContainedUrl = box("url ", new Uint8Array([0, 0, 0, 1]));
	return box("dinf", fullBox("dref", concat(u32(1), selfContainedUrl)));
}

function avc1(width: number, height: number) {
	const payload = zeros(78);
	payload.set(u16(1), 6);
	payload.set(u16(width), 24);
	payload.set(u16(height), 26);
	const avcConfiguration = box(
		"avcC",
		new Uint8Array([
			1, 0x42, 0, 0x1f, 0xff, 0xe1, 0, 10, 0x67, 0x42, 0, 0x1f, 0xe5, 0x88,
			0x68, 0x3c, 0x80, 0, 1, 0, 4, 0x68, 0xce, 0x3c, 0x80,
		]),
	);
	return box("avc1", concat(payload, avcConfiguration));
}

function mp4a(sampleRate: number, channels: number) {
	const payload = zeros(28);
	payload.set(u16(1), 6);
	payload.set(u16(channels), 16);
	payload.set(u32(sampleRate * 0x10000), 24);
	const esds = fullBox(
		"esds",
		new Uint8Array([0x03, 0x80, 0x80, 0x80, 0x01, 0, 0x05, 0x02, 0x11, 0x90]),
	);
	return box("mp4a", concat(payload, esds));
}

function mediaInfo(
	handler: "vide" | "soun",
	stbl: Uint8Array,
	timescale: number,
	duration: number,
	width = 0,
	height = 0,
) {
	const mediaHeader = mdhd(timescale, duration);
	const trackHeader = tkhd(width, height);
	const media = box(
		"mdia",
		concat(
			mediaHeader,
			hdlr(handler),
			box(
				"minf",
				concat(
					fullBox(handler === "vide" ? "vmhd" : "smhd", zeros(8)),
					dinf(),
					stbl,
				),
			),
		),
	);
	return box("trak", concat(trackHeader, media));
}

function makeMoov(videoOffset: number, audioOffset: number) {
	const videoTable = box(
		"stbl",
		concat(stsd(avc1(1080, 1920)), stts(1), stsc(), stsz(4), stco(videoOffset)),
	);
	const audioTable = box(
		"stbl",
		concat(
			stsd(mp4a(48_000, 2)),
			stts(1_600),
			stsc(),
			stsz(4),
			stco(audioOffset),
		),
	);
	return box(
		"moov",
		concat(
			mvhd(),
			mediaInfo("vide", videoTable, 30, 1, 1080, 1920),
			mediaInfo("soun", audioTable, 48_000, 1_600),
		),
	);
}

export const deterministicRenderOutputFixture = (() => {
	const ftyp = box(
		"ftyp",
		concat(text("isom"), u32(0), text("isom"), text("mp42")),
	);
	const firstMoov = makeMoov(0, 0);
	const mdatPayload = new Uint8Array([0, 0, 0, 1, 0, 0, 0, 2]);
	const mdat = box("mdat", mdatPayload);
	const videoOffset = ftyp.byteLength + firstMoov.byteLength + 8;
	const audioOffset = videoOffset + 4;
	const moov = makeMoov(videoOffset, audioOffset);
	return concat(ftyp, moov, mdat);
})();

/** Independently recorded fixture authority; never derive this from the validator. */
export const deterministicRenderOutputFixtureProvenance = {
	byteSize: 977,
	sha256: "4858b30c1b184fb72854f4d8e8052c67f40b35c79a87298521a1b6af6367b158",
	videoCodec: "H.264/AVC",
	width: 1080,
	height: 1920,
	fps: { numerator: 30, denominator: 1 },
	durationFrames: 1,
	audioCodec: "AAC-LC",
	audioSampleRate: 48_000,
	audioChannels: 2,
	provenance:
		"offline hand-built ISO-BMFF fixture v1; no customer/provider data",
} as const;
