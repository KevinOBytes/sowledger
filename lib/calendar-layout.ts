/** Already-painted vertical bounds, including any minimum-height marker. */
export type CalendarInterval = { id: string; top: number; height: number };
export type CalendarColumn = { column: number; columnCount: number };

/** Pack half-open intervals. Callers must supply unique, kind-qualified IDs. */
export function packCalendarIntervals(items: readonly CalendarInterval[]): Map<string, CalendarColumn> {
  const sorted = [...items].sort((a, b) => a.top - b.top || (a.top + a.height) - (b.top + b.height) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const layout = new Map<string, CalendarColumn>();
  let group: CalendarColumn[] = [];
  let columnEnds: number[] = [];
  let groupEnd = -Infinity;

  function finishGroup() {
    for (const position of group) position.columnCount = columnEnds.length;
    group = [];
    columnEnds = [];
  }

  for (const item of sorted) {
    if (item.top >= groupEnd) finishGroup();
    let column = columnEnds.findIndex((end) => end <= item.top);
    if (column === -1) column = columnEnds.length;
    const end = item.top + item.height;
    columnEnds[column] = end;
    groupEnd = Math.max(groupEnd, end);
    const position = { column, columnCount: 1 };
    layout.set(item.id, position);
    group.push(position);
  }
  finishGroup();
  return layout;
}
