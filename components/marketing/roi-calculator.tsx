"use client";

import { useState } from "react";
import { Calculator, TrendingDown, ShieldAlert } from "lucide-react";

export function RoiCalculator() {
  const [teamSize, setTeamSize] = useState<number>(5);
  const [hourlyRate, setHourlyRate] = useState<number>(150);
  const [unbilledHours, setUnbilledHours] = useState<number>(4);

  const weeklyLeaked = teamSize * hourlyRate * unbilledHours;
  const monthlyLeaked = Math.round(weeklyLeaked * 4.33);
  const annualLeaked = monthlyLeaked * 12;

  // Simple dispute risk heuristic based on uncaptured tracking hours per week
  const riskPercentage = Math.min(Math.round((unbilledHours / 10) * 100), 99);
  const riskLevel = riskPercentage < 20 ? "Low" : riskPercentage < 40 ? "Moderate" : riskPercentage < 70 ? "High" : "Critical";
  const riskColor = riskPercentage < 20 ? "text-emerald-600" : riskPercentage < 40 ? "text-amber-600" : "text-rose-600";

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-lg shadow-stone-900/5">
      <div className="border-b border-border bg-white p-6 sm:p-8">
        <div className="flex items-center gap-3">
          <Calculator className="h-6 w-6 text-cyan-700" />
          <h3 className="text-xl font-semibold text-slate-950">Unbilled Time & Dispute Risk Calculator</h3>
        </div>
        <p className="mt-2 text-sm text-slate-600">
          Estimate the cost of lost billables and the risk of client disputes without a transparent proof-backed workflow.
        </p>
      </div>

      <div className="grid border-b border-border sm:grid-cols-2">
        <div className="space-y-6 border-b border-border p-6 sm:border-b-0 sm:border-r sm:p-8">
          <div>
            <label className="flex items-center justify-between text-sm font-bold text-slate-700">
              Team size (billable members)
              <span className="font-mono text-cyan-800">{teamSize}</span>
            </label>
            <input
              type="range"
              min="1"
              max="50"
              value={teamSize}
              onChange={(e) => setTeamSize(Number(e.target.value))}
              className="mt-4 w-full accent-cyan-600"
            />
          </div>

          <div>
            <label className="flex items-center justify-between text-sm font-bold text-slate-700">
              Average hourly rate
              <span className="font-mono text-cyan-800">${hourlyRate}</span>
            </label>
            <input
              type="range"
              min="50"
              max="500"
              step="10"
              value={hourlyRate}
              onChange={(e) => setHourlyRate(Number(e.target.value))}
              className="mt-4 w-full accent-cyan-600"
            />
          </div>

          <div>
            <label className="flex items-center justify-between text-sm font-bold text-slate-700">
              Unbilled/Lost hours per person/week
              <span className="font-mono text-cyan-800">{unbilledHours}h</span>
            </label>
            <input
              type="range"
              min="1"
              max="20"
              value={unbilledHours}
              onChange={(e) => setUnbilledHours(Number(e.target.value))}
              className="mt-4 w-full accent-cyan-600"
            />
          </div>
        </div>

        <div className="bg-slate-50 p-6 sm:p-8">
          <div className="space-y-8">
            <div>
              <div className="flex items-center gap-2">
                <TrendingDown className="h-4 w-4 text-slate-500" />
                <p className="text-sm font-bold text-slate-700">Estimated Monthly Revenue Leak</p>
              </div>
              <p className="mt-2 text-4xl font-semibold tracking-tight text-slate-950">
                ${monthlyLeaked.toLocaleString()}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                ${annualLeaked.toLocaleString()} annually
              </p>
            </div>

            <div>
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-slate-500" />
                <p className="text-sm font-bold text-slate-700">Annual Invoice Dispute Risk</p>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <p className={`text-2xl font-semibold ${riskColor}`}>{riskLevel}</p>
                <p className="text-sm text-slate-500">({riskPercentage}% likelihood proxy)</p>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                High unbilled time usually indicates a disconnect between planned work and actual tracking, which is the leading cause of client friction at billing time.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
