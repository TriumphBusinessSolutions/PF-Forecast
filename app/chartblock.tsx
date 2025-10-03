'use client';

import React from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

// Tiny error boundary so the chart never crashes the whole page
class ChartBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; msg?: string }> {
  constructor(props: any) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError(err: any) { return { hasError: true, msg: String(err?.message || err) }; }
  componentDidCatch(err: any, info: any) { console.error('Chart error:', err, info); }
  render() {
    if (this.state.hasError) {
      return <div style={{ fontSize: 12, color: '#991b1b', padding: 8, border: '1px solid #fee2e2', borderRadius: 8 }}>
        Chart failed to render: {this.state.msg}
      </div>;
    }
    return this.props.children as any;
  }
}

export default function ChartBlock({ data }: { data: Array<Record<string, number | string>> }) {
  const safe = Array.isArray(data) && data.length > 0;
  return (
    <ChartBoundary>
      {safe ? (
        <div style={{ height: 260, minWidth: 600 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
              <defs>
                <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopOpacity={0.35} />
                  <stop offset="95%" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip formatter={(v: any) => Number(v).toLocaleString(undefined, { style: 'currency', currency: 'USD' })} />
              <Area type="monotone" dataKey="Operating" strokeWidth={2} fillOpacity={1} fill="url(#g1)" />
              <Area type="monotone" dataKey="Profit" strokeWidth={2} fillOpacity={0.3} />
              <Area type="monotone" dataKey="Owners" strokeWidth={2} fillOpacity={0.3} />
              <Area type="monotone" dataKey="Tax" strokeWidth={2} fillOpacity={0.3} />
              <Area type="monotone" dataKey="Vault" strokeWidth={2} fillOpacity={0.3} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div style={{ fontSize: 12, color: '#666' }}>No data yet — add income/expenses or adjust the date range.</div>
      )}
    </ChartBoundary>
  );
}
