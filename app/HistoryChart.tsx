"use client";
import {ResponsiveContainer,BarChart,Bar,XAxis,YAxis,Tooltip,CartesianGrid} from "recharts";
export default function HistoryChart({history}:{history:Record<string,any>[]}) {
  const data=history.filter(point=>point.units!==null).map(point=>({...point,label:new Date(point.date).toISOString().slice(0,10)}));
  if(!data.length)return <div className="chart-empty">No reported quantities in these dates.</div>;
  return <div className="history-chart"><ResponsiveContainer width="100%" height={225}>
    <BarChart data={data} margin={{top:15,right:15,left:0,bottom:0}}>
      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--line)"/>
      <XAxis dataKey="label" tick={{fontSize:12}} tickLine={false} axisLine={false} minTickGap={30}/>
      <YAxis allowDecimals={false} tick={{fontSize:12}} tickLine={false} axisLine={false} width={48}/>
      <Tooltip cursor={false} isAnimationActive={false} contentStyle={{border:"1px solid var(--line)",background:"var(--surface)",color:"var(--ink)",borderRadius:8,fontSize:13}}/>
      <Bar activeBar={false} isAnimationActive={false} dataKey="units" name="Units sold per reported week" fill="var(--green)" radius={[3,3,0,0]}/>
    </BarChart>
  </ResponsiveContainer></div>;
}
