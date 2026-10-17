import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Site } from "./config";
import { dateRange, siteDay, type AnalyticsEvent } from "./events";

export function createStore(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true, strict: true });
  const version = db.query<{ user_version: number }, []>("PRAGMA user_version").get()!.user_version;
  if (version > 1) { db.close(true); throw new Error("数据库版本高于当前程序支持版本"); }
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS events (
      site_id TEXT NOT NULL, event_id TEXT NOT NULL, received_at INTEGER NOT NULL,
      day TEXT NOT NULL, type TEXT NOT NULL, path TEXT NOT NULL, referrer TEXT NOT NULL,
      source TEXT NOT NULL, medium TEXT NOT NULL, campaign TEXT NOT NULL,
      device TEXT NOT NULL, name TEXT NOT NULL, props TEXT NOT NULL,
      PRIMARY KEY (site_id, event_id)
    );
    CREATE INDEX IF NOT EXISTS events_retention ON events(received_at);
    CREATE TABLE IF NOT EXISTS daily_counts (
      site_id TEXT NOT NULL, day TEXT NOT NULL, dimension TEXT NOT NULL,
      value TEXT NOT NULL, count INTEGER NOT NULL,
      PRIMARY KEY (site_id, day, dimension, value)
    );
    PRAGMA user_version = 1;
  `);
  const insert = db.query(`INSERT OR IGNORE INTO events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const increment = db.query(`INSERT INTO daily_counts VALUES (?, ?, ?, ?, 1)
    ON CONFLICT(site_id, day, dimension, value) DO UPDATE SET count = count + 1`);
  const cleanup = db.query("DELETE FROM events WHERE received_at < ?");
  function transaction(site: Site, events: AnalyticsEvent[], now: number) {
    const day = siteDay(now, site.timezone);
    let accepted = 0;
    // 同步事务内不含 await；Bun 1.3.5 的 db.transaction() 内部语句会阻碍 close(true)。
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const event of events) {
        const result = insert.run(site.id, event.id, now, day, event.type, event.path, event.referrer,
          event.source, event.medium, event.campaign, event.device, event.name, JSON.stringify(event.props));
        if (!result.changes) continue;
        accepted++;
        if (event.type === "pageview") {
          for (const [dimension, value] of [
            ["total", "pageview"], ["page", event.path], ["source", event.source || event.referrer || "(direct)"],
            ["device", event.device],
          ]) increment.run(site.id, day, dimension, value);
        } else {
          increment.run(site.id, day, "total", "event");
          increment.run(site.id, day, "event", event.name);
        }
      }
      db.exec("COMMIT");
      return accepted;
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  const grouped = db.query<{ value: string; count: number }, [string, string, string, string]>(`
    SELECT value, SUM(count) AS count FROM daily_counts
    WHERE site_id = ? AND day >= ? AND day <= ? AND dimension = ?
    GROUP BY value ORDER BY count DESC, value ASC LIMIT 20`);
  const trendQuery = db.query<{ day: string; value: string; count: number }, [string, string, string]>(`
    SELECT day, value, count FROM daily_counts
    WHERE site_id = ? AND day >= ? AND day <= ? AND dimension = 'total' ORDER BY day`);
  return {
    db,
    ingest: transaction,
    cleanup(now: number, retentionDays: number) {
      return cleanup.run(now - retentionDays * 86_400_000).changes;
    },
    stats(site: Site, days: number, now: number) {
      const dates = dateRange(siteDay(now, site.timezone), days);
      const rows = trendQuery.all(site.id, dates[0], dates.at(-1)!);
      const trend = dates.map((day) => ({
        day,
        pageviews: rows.find((row) => row.day === day && row.value === "pageview")?.count ?? 0,
        events: rows.find((row) => row.day === day && row.value === "event")?.count ?? 0,
      }));
      const dimension = (name: string) => grouped.all(site.id, dates[0], dates.at(-1)!, name);
      return {
        site: { id: site.id, name: site.name, timezone: site.timezone },
        range: { from: dates[0], to: dates.at(-1), days },
        totals: { pageviews: trend.reduce((sum, row) => sum + row.pageviews, 0), events: trend.reduce((sum, row) => sum + row.events, 0) },
        trend, pages: dimension("page"), sources: dimension("source"), devices: dimension("device"), events: dimension("event"),
      };
    },
    close() {
      insert.finalize(); increment.finalize(); grouped.finalize(); trendQuery.finalize(); cleanup.finalize();
      db.close(true);
    },
  };
}

export type Store = ReturnType<typeof createStore>;
