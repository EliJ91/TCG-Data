import { normalizeLabel, type ImportRow } from "./domain";
export type Mapping = { productId: string };
const aliases: Record<string, string[]> = {
  skuId: ["tcgplayerid", "skuid", "marketplaceskuid"],
  productId: ["productid", "tcgplayerproductid", "producturl", "tcgplayerurl"],
  name: ["productname", "cardname", "name"],
  quantity: ["totalquantity", "quantity", "qty", "inventoryquantity", "stock"],
  number: ["number", "cardnumber", "collectornumber"],
  set: ["setname", "set", "expansionname"],
  rarity: ["rarity"],
  condition: ["condition"],
  printing: ["printing", "variant", "foiltype", "finish"],
  language: ["language"],
  originalPrice: ["tcgmarketplaceprice", "listingprice", "yourprice", "price"],
};
export function parseCSV(text: string) {
  text = text.replace(/^\uFEFF/, "");
  if (text.includes("\0"))
    throw new Error("Export the file as CSV UTF-8 and try again.");
  const firstLine = text.split(/\r?\n/, 1)[0];
  const delimiter = [",", ";", "\t"].sort(
    (a, b) => firstLine.split(b).length - firstLine.split(a).length,
  )[0];
  const records: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false,
    closed = false;
  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    if (quoted) {
      if (character === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (character === '"') {
        quoted = false;
        closed = true;
      } else field += character;
    } else if (character === delimiter) {
      row.push(field);
      field = "";
      closed = false;
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((value) => value.length > 0)) records.push(row);
      row = [];
      field = "";
      closed = false;
    } else if (character === '"' && field.length === 0 && !closed)
      quoted = true;
    else if (closed && character.trim())
      throw new Error(
        "Unexpected text after a quoted field near row " +
          (records.length + 1) +
          ".",
      );
    else if (!closed) field += character;
  }
  if (quoted) throw new Error("The CSV has an unclosed quoted field.");
  row.push(field);
  if (row.some((value) => value.length > 0)) records.push(row);
  if (records.length < 2)
    throw new Error("The CSV needs a header and at least one inventory row.");
  const headers = records.shift()!;
  if (
    headers.some((header) => !header.trim()) ||
    new Set(headers).size !== headers.length
  )
    throw new Error("Every column needs a unique, non-empty header.");
  for (let i = 0; i < records.length; i++)
    if (records[i].length !== headers.length)
      throw new Error(
        "Row " +
          (i + 2) +
          " has " +
          records[i].length +
          " fields. Expected " +
          headers.length +
          ".",
      );
  return { headers, records };
}
export function mapColumns(headers: string[]): Mapping {
  return { productId: headers.find(header => aliases.productId.includes(normalizeLabel(header))) ?? "" };
}
export function productIdFrom(value: string) {
  const text = value.trim();
  if (/^\d+$/.test(text)) return text;
  try {
    const url = new URL(text);
    if (["tcgplayer.com", "www.tcgplayer.com"].includes(url.hostname) && ["http:", "https:"].includes(url.protocol))
      return url.pathname.match(/^\/product\/(\d+)(?:\/|$)/)?.[1] ?? "";
  } catch {}
  return "";
}
export function prepareImport(
  text: string,
  mapping?: Mapping,
): { headers: string[]; rows: ImportRow[] } {
  const { headers, records } = parseCSV(text);
  const selected = mapping ?? mapColumns(headers);
  if (!selected.productId || !headers.includes(selected.productId))
    throw new Error("Choose the column containing TCGplayer Product IDs.");
  // Other columns are optional and remain untouched in raw. Recognized names
  // only provide a useful row title and inventory totals, never import rules.
  const fields = Object.fromEntries(Object.entries(aliases).map(([key, names]) =>
    [key, headers.find(header => names.includes(normalizeLabel(header))) ?? ""]));
  fields.productId = selected.productId;
  const indices = Object.fromEntries(
    Object.entries(fields).map(([key, header]) => [
      key,
      headers.indexOf(header),
    ]),
  );
  const problems: string[] = [];
  const occurrences = new Map<string, number>();
  const rows = records.map((record, index) => {
    const get = (key: string) =>
      indices[key] >= 0 ? record[indices[key]].trim() : "";
    const skuId = "",
      productId = productIdFrom(get("productId")),
      name = get("name") || "Product " + productId,
      rawQuantity = get("quantity").replace(/,/g, ""),
      quantity = rawQuantity && Number.isSafeInteger(Number(rawQuantity)) && Number(rawQuantity) >= 0 ? Number(rawQuantity) : 0;
    if (!productId) problems.push("Row " + (index + 2) + ": enter a numeric Product ID or a TCGplayer product link in the selected column.");
    const condition = "", printing = "", language = "";
    const occurrence = occurrences.get(productId) ?? 0;
    occurrences.set(productId, occurrence + 1);
    // Keep every CSV row, including repeated products, with stable occurrence IDs.
    const key = "product:" + productId + "|row:" + occurrence;
    const price = Number(get("originalPrice").replace(/[$,]/g, ""));
    return {
      info: {
        key,
        skuId,
        productId,
        name,
        number: get("number"),
        set: get("set"),
        rarity: get("rarity"),
        condition,
        printing,
        language,
        quantity,
        originalPrice:
          get("originalPrice") && Number.isFinite(price) && price >= 0
            ? price
            : null,
      },
      raw: Object.fromEntries(headers.map((header, i) => [header, record[i]])),
    };
  });
  if (problems.length)
    throw new Error(
      problems.slice(0, 12).join("\n") +
        (problems.length > 12
          ? "\nAnd " + (problems.length - 12) + " more issues."
          : ""),
    );
  return { headers, rows };
}
export function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}
