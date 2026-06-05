export interface StoredZipFile {
  name: string;
  data: Uint8Array;
  lastModified?: Date;
}

const zipMaxU16 = 0xffff;
const zipMaxU32 = 0xffffffff;
const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

const textEncoder = new TextEncoder();

const toBlobPart = (bytes: Uint8Array) => {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
};

const writeUint16 = (view: DataView, offset: number, value: number) => {
  view.setUint16(offset, value, true);
};

const writeUint32 = (view: DataView, offset: number, value: number) => {
  view.setUint32(offset, value, true);
};

const calculateCrc32 = (bytes: Uint8Array) => {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = crcTable[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const toDosTimestamp = (date: Date = new Date()) => {
  const year = Math.max(1980, Math.min(2107, date.getFullYear()));
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);
  return {
    time: (hours << 11) | (minutes << 5) | seconds,
    date: ((year - 1980) << 9) | (month << 5) | day
  };
};

const assertZipLimit = (value: number, limit: number, message: string) => {
  if (!Number.isFinite(value) || value > limit) {
    throw new Error(message);
  }
};

export const createStoredZipBlob = (files: StoredZipFile[], mimeType = "application/zip") => {
  if (files.length > zipMaxU16) {
    throw new Error("ZIP export supports up to 65,535 files.");
  }

  const parts: ArrayBuffer[] = [];
  const centralDirectoryParts: ArrayBuffer[] = [];
  let offset = 0;

  for (const file of files) {
    const fileNameBytes = textEncoder.encode(file.name);
    const fileSize = file.data.byteLength;
    const crc32 = calculateCrc32(file.data);
    const timestamp = toDosTimestamp(file.lastModified);

    assertZipLimit(fileNameBytes.byteLength, zipMaxU16, "ZIP file names must be shorter than 65,536 bytes.");
    assertZipLimit(fileSize, zipMaxU32, "PNG sequence is too large to package in standard ZIP format.");
    assertZipLimit(offset, zipMaxU32, "PNG sequence is too large to package in standard ZIP format.");

    const localHeader = new ArrayBuffer(30 + fileNameBytes.byteLength);
    const localView = new DataView(localHeader);
    writeUint32(localView, 0, 0x04034b50);
    writeUint16(localView, 4, 20);
    writeUint16(localView, 6, 0x0800);
    writeUint16(localView, 8, 0);
    writeUint16(localView, 10, timestamp.time);
    writeUint16(localView, 12, timestamp.date);
    writeUint32(localView, 14, crc32);
    writeUint32(localView, 18, fileSize);
    writeUint32(localView, 22, fileSize);
    writeUint16(localView, 26, fileNameBytes.byteLength);
    writeUint16(localView, 28, 0);
    new Uint8Array(localHeader, 30).set(fileNameBytes);
    parts.push(localHeader, toBlobPart(file.data));

    const centralDirectory = new ArrayBuffer(46 + fileNameBytes.byteLength);
    const centralView = new DataView(centralDirectory);
    writeUint32(centralView, 0, 0x02014b50);
    writeUint16(centralView, 4, 20);
    writeUint16(centralView, 6, 20);
    writeUint16(centralView, 8, 0x0800);
    writeUint16(centralView, 10, 0);
    writeUint16(centralView, 12, timestamp.time);
    writeUint16(centralView, 14, timestamp.date);
    writeUint32(centralView, 16, crc32);
    writeUint32(centralView, 20, fileSize);
    writeUint32(centralView, 24, fileSize);
    writeUint16(centralView, 28, fileNameBytes.byteLength);
    writeUint16(centralView, 30, 0);
    writeUint16(centralView, 32, 0);
    writeUint16(centralView, 34, 0);
    writeUint16(centralView, 36, 0);
    writeUint32(centralView, 38, 0);
    writeUint32(centralView, 42, offset);
    new Uint8Array(centralDirectory, 46).set(fileNameBytes);
    centralDirectoryParts.push(centralDirectory);

    offset += localHeader.byteLength + fileSize;
  }

  const centralDirectoryOffset = offset;
  const centralDirectorySize = centralDirectoryParts.reduce((size, part) => size + part.byteLength, 0);
  assertZipLimit(centralDirectoryOffset, zipMaxU32, "PNG sequence is too large to package in standard ZIP format.");
  assertZipLimit(centralDirectorySize, zipMaxU32, "PNG sequence is too large to package in standard ZIP format.");

  const endOfCentralDirectory = new ArrayBuffer(22);
  const endView = new DataView(endOfCentralDirectory);
  writeUint32(endView, 0, 0x06054b50);
  writeUint16(endView, 4, 0);
  writeUint16(endView, 6, 0);
  writeUint16(endView, 8, files.length);
  writeUint16(endView, 10, files.length);
  writeUint32(endView, 12, centralDirectorySize);
  writeUint32(endView, 16, centralDirectoryOffset);
  writeUint16(endView, 20, 0);

  return new Blob([...parts, ...centralDirectoryParts, endOfCentralDirectory], { type: mimeType });
};
