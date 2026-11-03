// A minimal .xlsx writer and reader, so the page needs no library.
// Writer: one sheet, strings and numbers, bold header row, column widths; files are stored uncompressed.
// Reader: the first sheet's cell values, enough to load back an answers file (also after Excel re-saved it).
(function () {
  const CRC = new Uint32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (b) => {
    let c = 0xffffffff;
    for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c])
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
  const col = (i) => { let s = ""; for (i++; i; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };

  function zip(files) {               // files: [{name, data: Uint8Array}] -> Uint8Array (store method)
    const enc = new TextEncoder(), parts = [], cen = [];
    let off = 0;
    for (const f of files) {
      const name = enc.encode(f.name), crc = crc32(f.data), n = f.data.length;
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true);
      h.setUint32(14, crc, true); h.setUint32(18, n, true); h.setUint32(22, n, true); h.setUint16(26, name.length, true);
      parts.push(new Uint8Array(h.buffer), name, f.data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
      c.setUint32(16, crc, true); c.setUint32(20, n, true); c.setUint32(24, n, true); c.setUint16(28, name.length, true);
      c.setUint32(42, off, true);
      cen.push(new Uint8Array(c.buffer), name);
      off += 30 + name.length + n;
    }
    const size = cen.reduce((a, b) => a + b.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, size, true); e.setUint32(16, off, true);
    const all = [...parts, ...cen, new Uint8Array(e.buffer)];
    const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
    let p = 0;
    for (const a of all) { out.set(a, p); p += a.length; }
    return out;
  }

  function write(rows, widths, sheetName) {
    const cell = (v, r, c, s) => {
      const ref = col(c) + (r + 1), st = s ? ' s="1"' : "";
      if (v === null || v === undefined || v === "") return "";
      if (typeof v === "number") return `<c r="${ref}"${st}><v>${v}</v></c>`;
      return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
    };
    const sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
      (widths ? "<cols>" + widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("") + "</cols>" : "") +
      "<sheetData>" + rows.map((row, r) => `<row r="${r + 1}">` + row.map((v, c) => cell(v, r, c, r === 0)).join("") + "</row>").join("") +
      "</sheetData></worksheet>";
    const x = {
      "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
      "_rels/.rels": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(sheetName || "labels")}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      "xl/_rels/workbook.xml.rels": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
      "xl/styles.xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF23313B"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
      "xl/worksheets/sheet1.xml": sheet,
    };
    const enc = new TextEncoder();
    return new Blob([zip(Object.entries(x).map(([name, s]) => ({ name, data: enc.encode(s) })))],
      { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  async function unzip(buf) {         // -> {name: Uint8Array}, stored or deflated entries
    const v = new DataView(buf), u8 = new Uint8Array(buf), dec = new TextDecoder(), out = {};
    let e = buf.byteLength - 22;
    while (e >= 0 && v.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error("not a zip file");
    let p = v.getUint32(e + 16, true);
    for (let k = v.getUint16(e + 10, true); k > 0; k--) {
      const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true);
      const nl = v.getUint16(p + 28, true), xl = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true);
      const lh = v.getUint32(p + 42, true), name = dec.decode(u8.subarray(p + 46, p + 46 + nl));
      const start = lh + 30 + v.getUint16(lh + 26, true) + v.getUint16(lh + 28, true);
      const raw = u8.subarray(start, start + size);
      out[name] = method === 0 ? raw
        : new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
      p += 46 + nl + xl + cl;
    }
    return out;
  }

  async function read(buf) {          // -> rows of the first sheet, as arrays of strings
    const f = await unzip(buf), dec = new TextDecoder(), xml = (n) => f[n] && new DOMParser().parseFromString(dec.decode(f[n]), "application/xml");
    const shared = xml("xl/sharedStrings.xml");
    const ss = shared ? [...shared.getElementsByTagName("si")].map((si) => [...si.getElementsByTagName("t")].map((t) => t.textContent).join("")) : [];
    const name = Object.keys(f).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()[0];
    if (!name) throw new Error("no sheet in the file");
    const rows = [];
    for (const r of xml(name).getElementsByTagName("row")) {
      const row = [];
      for (const c of r.getElementsByTagName("c")) {
        const ref = c.getAttribute("r") || "", letters = ref.replace(/\d+/g, "");
        let ci = 0;
        for (const ch of letters) ci = ci * 26 + ch.charCodeAt(0) - 64;
        const t = c.getAttribute("t"), vv = c.getElementsByTagName("v")[0];
        let val = t === "inlineStr" ? [...c.getElementsByTagName("t")].map((x) => x.textContent).join("")
          : t === "s" ? ss[+(vv && vv.textContent)] : vv ? vv.textContent : "";
        row[letters ? ci - 1 : row.length] = val ?? "";
      }
      rows.push(Array.from(row, (x) => x ?? ""));
    }
    return rows;
  }

  window.XLSX_MINI = { write, read };
})();
