"use client";

import dynamic from "next/dynamic";

export const CalendarViewClient = dynamic(
  () => import("@/components/calendar-view").then((mod) => mod.CalendarView),
  { ssr: false }
);
