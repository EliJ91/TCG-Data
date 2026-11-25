import { normalizeLabel, type ImportRow } from "./domain";
export const importFields = [
  ["skuId", "TCGplayer Id (SKU)"],
  ["productId", "Product ID"],
  ["name", "Card name"],
  ["quantity", "Quantity"],
  ["number", "Card number"],
  ["set", "Set"],
  ["rarity", "Rarity"],
  ["condition", "Condition"],
  ["printing", "Printing"],
  ["language", "Language"],
  ["originalPrice", "Your listing price"],
] as const;
export type Mapping = Record<string, string>;
const aliases: Record<string, string[]> = {
  skuId: ["tcgplayerid", "skuid", "marketplaceskuid"],
  productId: ["productid", "tcgplayerproductid"],
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
  return Object.fromEntries(
    Object.entries(aliases).map(([key, names]) => [
      key,
      headers.find((header) => names.includes(normalizeLabel(header))) ?? "",
    ]),
  );
}
export function prepareImport(
  text: string,
  mapping?: Mapping,
): { headers: string[]; rows: ImportRow[] } {
  const { headers, records } = parseCSV(text),
    fields = mapping ?? mapColumns(headers);
  if (!fields.name || !fields.quantity || (!fields.skuId && !fields.productId))
    throw new Error(
      "Map Card name, Quantity, and either TCGplayer Id or Product ID.",
    );
  const indices = Object.fromEntries(
    Object.entries(fields).map(([key, header]) => [
      key,
      headers.indexOf(header),
    ]),
  );
  const problems: string[] = [];
  const rows = records.map((record, index) => {
    const get = (key: string) =>
      indices[key] >= 0 ? record[indices[key]].trim() : "";
    const skuId = get("skuId"),
      productId = get("productId"),
      name = get("name"),
      rawQuantity = get("quantity").replace(/,/g, ""),
      quantity = Number(rawQuantity);
    if (!name) problems.push("Row " + (index + 2) + ": card name is empty.");
    if (skuId && !/^\d+$/.test(skuId))
      problems.push(
        "Row " +
          (index + 2) +
          ": TCGplayer Id must be a numeric marketplace SKU.",
      );
    if (productId && !/^\d+$/.test(productId))
      problems.push("Row " + (index + 2) + ": Product ID must be numeric.");
    if (!/^\d+$/.test(skuId) && !/^\d+$/.test(productId))
      problems.push(
        "Row " +
          (index + 2) +
          ": a numeric marketplace SKU or product ID is required.",
      );
    if (!rawQuantity || !Number.isSafeInteger(quantity) || quantity < 0)
      problems.push(
        "Row " +
          (index + 2) +
          ": quantity must be a non-negative whole number.",
      );
    const condition = get("condition"),
      printing = get("printing"),
      language = get("language");
    const key = skuId
      ? "sku:" + skuId
      : ["product:" + productId, condition, printing, language]
          .map(normalizeLabel)
          .join("|");
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
