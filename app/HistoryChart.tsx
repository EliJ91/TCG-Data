"use client";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
export default function HistoryChart({
  history,
  type,
}: {
  history: Record<string, any>[];
  type: string;
}) {
  const usable = history.filter((row) =>
    type === "units"
      ? row.units !== null
      : type === "sales"
        ? row.low !== null || row.high !== null
        : row.market !== null,
  );
  if (!usable.length)
    return (
      <div className="chart-empty">
        No verified history is available for this SKU yet.
      </div>
    );
  const data = usable.map((row) => ({
    ...row,
    label: new Date(row.date).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    }),
  }));
  const common = (
    <>
      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e7eaed" />
      <XAxis
        dataKey="label"
        tick={{ fontSize: 12 }}
        tickLine={false}
        axisLine={false}
        minTickGap={30}
      />
      <YAxis
        tick={{ fontSize: 12 }}
        tickLine={false}
        axisLine={false}
        width={48}
      />
      <Tooltip
        contentStyle={{
          border: "1px solid #e4e7eb",
          borderRadius: 8,
          fontSize: 13,
        }}
      />
    </>
  );
  return (
    <div className="history-chart">
      <ResponsiveContainer width="100%" height={225}>
        {type === "units" ? (
          <BarChart
            data={data}
            margin={{ top: 15, right: 15, left: 0, bottom: 0 }}
          >
            {common}
            <Bar
              dataKey="units"
              name="Units / three-day bucket"
              fill="#28634d"
              radius={[3, 3, 0, 0]}
            />
          </BarChart>
        ) : (
          <LineChart
            data={data}
            margin={{ top: 15, right: 15, left: 0, bottom: 0 }}
          >
            {common}
            {type === "sales" ? (
              <>
                <Line
                  name="Lowest sale"
                  dataKey="low"
                  stroke="#28634d"
                  dot={false}
                  strokeWidth={2}
                  connectNulls={false}
                />
                <Line
                  name="Highest sale"
                  dataKey="high"
                  stroke="#8fae9c"
                  dot={false}
                  strokeWidth={2}
                  connectNulls={false}
                />
              </>
            ) : (
              <Line
                name="SKU market price"
                dataKey="market"
                stroke="#28634d"
                dot={false}
                strokeWidth={2}
                connectNulls={false}
              />
            )}
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
