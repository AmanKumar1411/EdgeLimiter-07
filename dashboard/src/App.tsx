import { useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

type Metrics = {
  totalRequests: number;
  blockedRequests: number;
  blockRate: string;
};

type TopKey = {
  apiKey: string;
  totalRequests: number;
  blockedRequests: number;
  abuseScore: string;
};

function App() {
  const [metrics, setMetrics] = useState<Metrics>({
    totalRequests: 0,
    blockedRequests: 0,
    blockRate: "0%",
  });

  const [topKeys, setTopKeys] = useState<TopKey[]>([]);

  useEffect(() => {
    fetch("https://edge-limiter.edgeaman.workers.dev/metrics")
      .then((res) => res.json())
      .then((data) => setMetrics(data));

    fetch("https://edge-limiter.edgeaman.workers.dev/top-keys")
      .then((res) => res.json())
      .then((data) => setTopKeys(data));
  }, []);

  const chartData = [
    {
      name: "Allowed",
      value: metrics.totalRequests - metrics.blockedRequests,
    },
    {
      name: "Blocked",
      value: metrics.blockedRequests,
    },
  ];

  return (
    <div className="min-h-screen bg-slate-100">
      {/* Header */}
      <div className="bg-white border-b px-10 py-6 shadow-sm">
        <h1 className="text-4xl font-bold text-slate-900">EdgeLimiter</h1>
        <p className="text-slate-500 mt-2">
          Distributed Rate Limiter as a Service
        </p>
      </div>

      <div className="p-10">
        {/* Metrics */}
        <div className="grid grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-3xl shadow-sm p-8">
            <p className="text-slate-500 text-sm">Total Requests</p>
            <h2 className="text-4xl font-bold mt-3">{metrics.totalRequests}</h2>
          </div>

          <div className="bg-white rounded-3xl shadow-sm p-8">
            <p className="text-slate-500 text-sm">Blocked Requests</p>
            <h2 className="text-4xl font-bold mt-3">
              {metrics.blockedRequests}
            </h2>
          </div>

          <div className="bg-white rounded-3xl shadow-sm p-8">
            <p className="text-slate-500 text-sm">Block Rate</p>
            <h2 className="text-4xl font-bold mt-3">{metrics.blockRate}</h2>
          </div>
        </div>

        {/* Chart */}
        <div className="bg-white rounded-3xl shadow-sm p-8 mb-8">
          <h2 className="text-2xl font-bold mb-6">Traffic Analytics</h2>

          <div className="h-95">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="value" radius={[10, 10, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Top API Keys */}
        <div className="bg-white rounded-3xl shadow-sm p-8">
          <h2 className="text-2xl font-bold mb-6">Top API Keys</h2>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b text-left text-slate-500">
                  <th className="pb-4">API Key</th>
                  <th className="pb-4">Total Requests</th>
                  <th className="pb-4">Blocked Requests</th>
                  <th className="pb-4">Abuse Score</th>
                </tr>
              </thead>

              <tbody>
                {topKeys.map((key, index) => (
                  <tr key={index} className="border-b last:border-none">
                    <td className="py-5 font-medium">{key.apiKey}</td>
                    <td>{key.totalRequests}</td>
                    <td>{key.blockedRequests}</td>
                    <td className="font-semibold">{key.abuseScore}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
