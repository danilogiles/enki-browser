// A real, signed CRX3 file for tests, made here rather than checked in: a throwaway RSA key, a
// stored (uncompressed) zip of the given files, and the CRX3 header Chromium verifies
// (components/crx_file/crx3.proto: CrxFileHeader { sha256_with_rsa = 2; signed_header_data = 10000 },
// SignedData { crx_id = 1 }, signed over "CRX3 SignedData\0" + length + header data + zip).
//
//   const { id, crx } = packCrx3({ "manifest.json": JSON.stringify({...}) });
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { crc32 } from "node:zlib";

const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
function varint(n) {
  const out = [];
  do { let b = n & 0x7f; n = Math.floor(n / 128); if (n) b |= 0x80; out.push(b); } while (n);
  return Buffer.from(out);
}
/** One length-delimited protobuf field. */
const field = (num, bytes) => Buffer.concat([varint(num * 8 + 2), varint(bytes.length), bytes]);

/** A zip with every file stored as is. */
export function zipStored(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content), fname = Buffer.from(name), crc = crc32(data);
    const common = Buffer.concat([u16(20), u16(0), u16(0), u16(0), u16(0x21), u32(crc), u32(data.length), u32(data.length), u16(fname.length), u16(0)]);
    const local = Buffer.concat([u32(0x04034b50), common, fname, data]);
    centrals.push(Buffer.concat([u32(0x02014b50), u16(20), common, u16(0), u16(0), u16(0), u32(0), u32(offset), fname]));
    locals.push(local);
    offset += local.length;
  }
  const central = Buffer.concat(centrals);
  const n = centrals.length;
  return Buffer.concat([...locals, central, u32(0x06054b50), u16(0), u16(0), u16(n), u16(n), u32(central.length), u32(offset), u16(0)]);
}

/** Extension id from a public key (DER, SubjectPublicKeyInfo): the first 16 bytes of its SHA-256, in a–p. */
export const idFromKey = (der) => [...createHash("sha256").update(der).digest().subarray(0, 16).toString("hex")].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");

export function packCrx3(files, { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })) {
  const der = publicKey.export({ type: "spki", format: "der" });
  const crxId = createHash("sha256").update(der).digest().subarray(0, 16);
  const zip = zipStored(files);
  const signedData = field(1, crxId);
  const signature = sign("sha256", Buffer.concat([Buffer.from("CRX3 SignedData\0", "latin1"), u32(signedData.length), signedData, zip]), privateKey);
  const header = Buffer.concat([field(2, Buffer.concat([field(1, der), field(2, signature)])), field(10000, signedData)]);
  return { id: idFromKey(der), crx: Buffer.concat([Buffer.from("Cr24"), u32(3), u32(header.length), header, zip]), privateKey, publicKey };
}
