/** Inspection minimale d'images (type réel par signature + dimensions), sans dépendance native. */
export interface ImageInfo {
  type: 'image/jpeg' | 'image/png';
  width: number;
  height: number;
}

export function inspectImage(buf: Buffer): ImageInfo | null {
  // PNG : signature + chunk IHDR (largeur/hauteur big-endian aux octets 16-23)
  if (
    buf.length >= 24 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { type: 'image/png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // JPEG : parcours des segments jusqu'à un marqueur SOFn
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = buf[i + 1]!;
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        return {
          type: 'image/jpeg',
          height: buf.readUInt16BE(i + 5),
          width: buf.readUInt16BE(i + 7),
        };
      }
      const len = buf.readUInt16BE(i + 2);
      i += 2 + len;
    }
    return { type: 'image/jpeg', width: 0, height: 0 };
  }
  return null;
}

/** Génère un PNG minimal valide (en-tête + IHDR) de dimensions données, avec une charge utile optionnelle. */
export function syntheticPng(width: number, height: number, payload = ''): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4, 'ascii');
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  ihdr.writeUInt8(8, 16);
  ihdr.writeUInt8(2, 17);
  return Buffer.concat([sig, ihdr, Buffer.from(payload, 'latin1')]);
}
