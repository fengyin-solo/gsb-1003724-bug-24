import { normalizeStore } from './normalize'
import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'hydrology-monitor-station:entries'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function writeStorage(value: Record<string, EntryRow[]>): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
  }
}

// 读取后统一过一遍规范化：旧缺省字段补齐、旧标志位按状态重算、脏复核结论剔除，
// 发现差异就回写，之后任何入口（列表/详情/打印/整编待办）读到的都是同一份干净数据。
function hydrate(input: Record<string, unknown>): Record<string, EntryRow[]> {
  const { rows, changed } = normalizeStore(input)
  if (changed) {
    writeStorage(rows)
  }
  return rows
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return hydrate(fallback as unknown as Record<string, unknown>)
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    const seeded = hydrate(fallback as unknown as Record<string, unknown>)
    writeStorage(seeded)
    return seeded
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    // 旧种子里缺模块时由规范化层用空数组补齐，不把种子字段强行合并进来。
    return hydrate(parsed)
  } catch {
    const seeded = hydrate(fallback as unknown as Record<string, unknown>)
    writeStorage(seeded)
    return seeded
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function getRow(key: string, id: number): EntryRow | undefined {
  return listRows(key).find((row) => Number(row.id) === id)
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  writeStorage(next)
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
