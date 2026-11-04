import assert from "node:assert/strict";
import { test } from "node:test";
import { packCalendarIntervals, type CalendarInterval } from "../lib/calendar-layout";

function check(items: CalendarInterval[]) {
  const layout = packCalendarIntervals(items);
  assert.deepEqual(layout, packCalendarIntervals([...items].reverse()), "input order must not affect assignments");
  assert.equal(layout.size, items.length);
  for (const item of items) {
    const position = layout.get(item.id)!;
    assert.ok(position.column >= 0 && position.column < position.columnCount);
    for (const other of items) {
      if (item.id === other.id || item.top >= other.top + other.height || other.top >= item.top + item.height) continue;
      const neighbor = layout.get(other.id)!;
      assert.equal(position.columnCount, neighbor.columnCount);
      assert.notEqual(position.column, neighbor.column, `${item.id} and ${other.id} intersect`);
      const left = position.column / position.columnCount;
      const right = (position.column + 1) / position.columnCount;
      assert.ok(right <= neighbor.column / neighbor.columnCount || left >= (neighbor.column + 1) / neighbor.columnCount);
    }
  }
  return layout;
}

test("empty, disconnected and touching painted intervals stay full width", () => {
  assert.equal(check([]).size, 0);
  const layout = check([{ id: "planned:a", top: 0, height: 18 }, { id: "planned:b", top: 18, height: 18 }, { id: "recorded:c", top: 72, height: 72 }]);
  for (const value of layout.values()) assert.deepEqual(value, { column: 0, columnCount: 1 });
});

test("identical starts and ends use stable kind-qualified identities", () => {
  const layout = check(["recorded:same", "planned:same", "planned:z"].map((id) => ({ id, top: 72, height: 72 })));
  assert.deepEqual([...layout.entries()], [["planned:same", { column: 0, columnCount: 3 }], ["planned:z", { column: 1, columnCount: 3 }], ["recorded:same", { column: 2, columnCount: 3 }]]);
});

test("nested intervals reuse a free column and share the group's peak width", () => {
  const layout = check([{ id: "outer", top: 0, height: 100 }, { id: "short", top: 0, height: 20 }, { id: "inner", top: 10, height: 30 }, { id: "later", top: 40, height: 20 }]);
  assert.deepEqual(layout.get("short"), { column: 0, columnCount: 3 });
  assert.deepEqual(layout.get("outer"), { column: 1, columnCount: 3 });
  assert.deepEqual(layout.get("inner"), { column: 2, columnCount: 3 });
  assert.deepEqual(layout.get("later"), { column: 0, columnCount: 3 });
});

test("chained overlaps form one group without wasting a third column", () => {
  const layout = check([{ id: "a", top: 0, height: 20 }, { id: "b", top: 10, height: 20 }, { id: "c", top: 20, height: 20 }, { id: "separate", top: 40, height: 18 }]);
  assert.deepEqual(layout.get("a"), { column: 0, columnCount: 2 });
  assert.deepEqual(layout.get("b"), { column: 1, columnCount: 2 });
  assert.deepEqual(layout.get("c"), { column: 0, columnCount: 2 });
  assert.deepEqual(layout.get("separate"), { column: 0, columnCount: 1 });
});

test("minimum-marker painted bounds, not source durations, determine collisions", () => {
  const layout = check([{ id: "recorded:marker", top: 69.6, height: 18 }, { id: "planned:next", top: 72, height: 72 }]);
  assert.deepEqual(layout.get("recorded:marker"), { column: 0, columnCount: 2 });
  assert.deepEqual(layout.get("planned:next"), { column: 1, columnCount: 2 });
});
