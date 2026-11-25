/// <reference lib="webworker" />
import { parseCSV, mapColumns, prepareImport } from "./csv";
self.onmessage = (event: MessageEvent) => {
  try {
    if (event.data.operation === "analyze") {
      const parsed = parseCSV(event.data.text);
      self.postMessage({
        headers: parsed.headers,
        mapping: mapColumns(parsed.headers),
        count: parsed.records.length,
        preview: parsed.records.slice(0, 3),
      });
    } else self.postMessage(prepareImport(event.data.text, event.data.mapping));
  } catch (error) {
    self.postMessage({
      error:
        error instanceof Error ? error.message : "Could not read this CSV.",
    });
  }
};
