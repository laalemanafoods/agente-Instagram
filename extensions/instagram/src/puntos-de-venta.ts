import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export type PuntoDeVenta = {
  nombre: string;
  ciudad: string;
  barrio?: string;
  direccion?: string;
  maps?: string;
  instagram?: string;
};

function norm(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function load(): { tienda_online: string; puntos: PuntoDeVenta[] } {
  try {
    const raw = readFileSync(
      resolve(process.cwd(), "conocimiento", "puntos_de_venta.json"),
      "utf-8",
    );
    return JSON.parse(raw) as { tienda_online: string; puntos: PuntoDeVenta[] };
  } catch {
    return { tienda_online: "", puntos: [] };
  }
}

// Matches only by barrio field. If cityFilter is provided, restricts to that city only.
export function findByBarrioOnly(query: string, cityFilter?: string): PuntoDeVenta[] {
  const { puntos } = load();
  const q = norm(query);
  const matches = puntos.filter((p) => {
    const barrio = norm(p.barrio ?? "");
    return barrio && (q.includes(barrio) || barrio.includes(q));
  });
  if (cityFilter) {
    const c = norm(cityFilter);
    return matches.filter((p) => norm(p.ciudad) === c);
  }
  return matches;
}

// Returns the distinct cities that have stores matching the given barrio query.
export function getBarrioCities(query: string): string[] {
  const matches = findByBarrioOnly(query);
  return [...new Set(matches.map((p) => p.ciudad))];
}

// Matches only by ciudad field (not barrio).
export function findByCityOnly(query: string): PuntoDeVenta[] {
  const { puntos } = load();
  const q = norm(query);
  return puntos.filter((p) => {
    const ciudad = norm(p.ciudad);
    return q.includes(ciudad) || ciudad.includes(q);
  });
}

// Returns all stores for an exact city name.
export function getAllForCity(cityName: string): PuntoDeVenta[] {
  const { puntos } = load();
  const c = norm(cityName);
  return puntos.filter((p) => norm(p.ciudad) === c);
}

// True if the store list has more than one distinct barrio.
export function hasDistinctBarrios(stores: PuntoDeVenta[]): boolean {
  const barrios = new Set(stores.map((s) => s.barrio).filter(Boolean));
  return barrios.size > 1;
}

// Groups stores by barrio, preserving insertion order.
export function groupByBarrio(stores: PuntoDeVenta[]): Map<string, PuntoDeVenta[]> {
  const groups = new Map<string, PuntoDeVenta[]>();
  for (const store of stores) {
    const key = store.barrio ?? "Otros";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(store);
  }
  return groups;
}

export function getOnlineStoreUrl(): string {
  return load().tienda_online ?? "";
}
