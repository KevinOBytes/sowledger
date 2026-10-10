"use client";

import { useState } from "react";
import { Calculator, Clock3 } from "lucide-react";

export function RoiCalculator() {
  const [teamSize, setTeamSize] = useState<number>(5);
  const [hourlyRate, setHourlyRate] = useState<number>(150);
  const [unbilledHours, setUnbilledHours] = useState<number>(4);

  const weeklyValue = teamSize * hourlyRate * unbilledHours;
  const monthlyValue = Math.round((weeklyValue * 52) / 12);
  const annualValue = weeklyValue * 52;

  return (
    <div role="region" aria-label="Unlogged time estimate" className="overflow-hidden rounded-2xl border border-border bg-surface shadow-lg shadow-stone-900/5">
      <div className="border-b border-border bg-white p-6 sm:p-8">
        <div className="flex items-center gap-3">
          <Calculator className="h-6 w-6 text-cyan-700" />
          <h3 className="text-xl font-semibold text-slate-950">What is unlogged time worth?</h3>
        </div>
        <p className="mt-2 text-sm text-slate-600">
          Adjust the numbers to estimate the value of billable work that is not making it onto your timesheet.
        </p>
      </div>

      <div className="grid border-b border-border sm:grid-cols-2">
        <div className="space-y-6 border-b border-border p-6 sm:border-b-0 sm:border-r sm:p-8">
          <div>
            <label htmlFor="estimate-team-size" className="flex items-center justify-between text-sm font-bold text-slate-700">
              People doing billable work
              <span className="font-mono text-cyan-800">{teamSize}</span>
            </label>
            <input
              id="estimate-team-size"
              type="range"
              min="1"
              max="50"
              value={teamSize}
              onChange={(e) => setTeamSize(Number(e.target.value))}
              className="mt-4 w-full accent-cyan-600"
            />
          </div>

          <div>
            <label htmlFor="estimate-hourly-rate" className="flex items-center justify-between text-sm font-bold text-slate-700">
              Average hourly rate (USD)
              <span className="font-mono text-cyan-800">${hourlyRate}</span>
            </label>
            <input
              id="estimate-hourly-rate"
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
            <label htmlFor="estimate-unlogged-hours" className="flex items-center justify-between text-sm font-bold text-slate-700">
              Unlogged hours per person each week
              <span className="font-mono text-cyan-800">{unbilledHours}h</span>
            </label>
            <input
              id="estimate-unlogged-hours"
              type="range"
              min="0"
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
                <Clock3 className="h-4 w-4 text-slate-500" />
                <p className="text-sm font-bold text-slate-700">Estimated monthly value</p>
              </div>
              <p className="mt-2 text-4xl font-semibold tracking-tight text-slate-950">
                ${monthlyValue.toLocaleString("en-US")}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                ${annualValue.toLocaleString("en-US")} over a year
              </p>
            </div>

            <div>
              <p className="text-sm font-bold text-slate-700">How this estimate works</p>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                People × hourly rate × unlogged hours × 52 weeks, divided by 12 months. This assumes every hour is billable at the rate you entered. It is not a forecast of revenue or savings from SOWLedger.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
