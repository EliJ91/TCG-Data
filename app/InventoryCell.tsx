import { useState } from "react";
import { formatValue, type Column } from "../lib/domain";

function imageSource(value: unknown, column: Column) {
  if (!column.key.startsWith("csv:") || typeof value !== "string") return null;
  try {
    const url = new URL(value.trim());
    if (!["https:", "http:"].includes(url.protocol)) return null;
    const imageColumn = /image|img|photo|picture|thumbnail|artwork|cdn/i.test(column.label);
    const imagePath = /\.(avif|gif|jpe?g|png|webp|svg)$/i.test(url.pathname);
    const cardCdn = url.hostname === "tcgplayer-cdn.tcgplayer.com";
    return imageColumn || imagePath || cardCdn ? url.href : null;
  } catch {
    return null;
  }
}

export default function InventoryCell({ value, column, cardName }: {
  value: unknown;
  column: Column;
  cardName: string;
}) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const source = imageSource(value, column);
  if (!source) return <>{formatValue(value, column.kind)}</>;
  return (
    <a
      className="card-thumbnail"
      href={source}
      target="_blank"
      rel="noopener noreferrer"
      title="Open full-size card image"
      aria-label={"Open image of " + cardName}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {failedSource === source ? (
        <span className="unavailable">Image unavailable</span>
      ) : (
        <img
          src={source}
          alt={cardName}
          width={64}
          height={90}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailedSource(source)}
        />
      )}
    </a>
  );
}
