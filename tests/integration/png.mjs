// A minimal PNG decoder for screenshots: 8-bit, non-interlaced, RGB or RGBA (what Chromium writes). Returns RGBA.
import { inflateSync } from "node:zlib";

export const PNG = {
  decode(buf) {
    let p = 8, width = 0, height = 0, channels = 4;
    const idat = [];
    while (p < buf.length) {
      const len = buf.readUInt32BE(p), type = buf.toString("ascii", p + 4, p + 8), body = buf.subarray(p + 8, p + 8 + len);
      if (type === "IHDR") {
        width = body.readUInt32BE(0); height = body.readUInt32BE(4);
        if (body[8] !== 8 || body[12] !== 0) throw new Error("only 8-bit, non-interlaced PNGs");
        channels = { 2: 3, 6: 4 }[body[9]];
        if (!channels) throw new Error(`unsupported colour type ${body[9]}`);
      } else if (type === "IDAT") idat.push(body);
      else if (type === "IEND") break;
      p += 12 + len;
    }
    const raw = inflateSync(Buffer.concat(idat)), stride = width * channels;
    const px = Buffer.alloc(height * stride), data = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) {
      const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
      for (let x = 0; x < stride; x++) {
        const a = x >= channels ? px[y * stride + x - channels] : 0, b = y ? px[(y - 1) * stride + x] : 0;
        const c = x >= channels && y ? px[(y - 1) * stride + x - channels] : 0;
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f];
        px[y * stride + x] = (row[x] + pred) & 255;
      }
    }
    for (let i = 0, j = 0; i < width * height; i++, j += channels) {
      data[i * 4] = px[j]; data[i * 4 + 1] = px[j + 1]; data[i * 4 + 2] = px[j + 2]; data[i * 4 + 3] = channels === 4 ? px[j + 3] : 255;
    }
    return { width, height, data };
  },
};
