"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import { feature } from "topojson-client";

export type RegionData = { code: string; name: string; value: number };

type GeoFeature = {
  type: string;
  properties?: Record<string, unknown>;
  geometry: unknown;
};

type GeoFeatureCollection = {
  type: string;
  features: GeoFeature[];
};

type WorldNameRow = { id: string; name: string };

type CountryConfig = {
  topoJsonUrl: string;
  topoJsonObject: string;
  projectionType: "geoEquirectangular" | "geoMercator";
  nameProperty: string;
  scale: number;
  center?: [number, number];
  subdivisionName: string;
};

const COUNTRY_CONFIGS: Record<"World" | "India", CountryConfig> = {
  World: {
    topoJsonUrl: "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json",
    topoJsonObject: "countries",
    projectionType: "geoEquirectangular",
    nameProperty: "name",
    scale: 1000,
    subdivisionName: "Country",
  },
  India: {
    topoJsonUrl:
      "https://gist.githubusercontent.com/jbrobst/56c13bbbf9d97d187fea01ca62ea5112/raw/e388c4cae20aa53cb5090210a42ebb9b765c0a36/india_states.geojson",
    topoJsonObject: "india-states",
    projectionType: "geoMercator",
    nameProperty: "ST_NM",
    scale: 1200,
    center: [78.0, 22.0],
    subdivisionName: "State",
  },
};

function norm(input: unknown): string {
  return String(input || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, " ");
}

function buildDataMap(data: RegionData[]) {
  const map = new Map<string, number>();
  const regionNames =
    typeof Intl !== "undefined"
      ? new Intl.DisplayNames(["en"], { type: "region" })
      : null;
  for (const item of data) {
    map.set(norm(item.code), item.value);
    map.set(norm(item.name), item.value);
    // WAE world rows often provide ISO country code (e.g., IN, US).
    // World topology is matched by country names, so add derived names too.
    if (regionNames && item.code && String(item.code).length <= 3) {
      const label = regionNames.of(String(item.code).toUpperCase());
      if (label) {
        map.set(norm(label), item.value);
      }
    }
  }
  return map;
}

export default function TrafficChoroplethMap({
  country,
  data,
  isLoading,
}: {
  country: "World" | "India";
  data: RegionData[];
  isLoading?: boolean;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [geoData, setGeoData] = useState<GeoFeatureCollection | null>(null);
  const [error, setError] = useState("");
  const [tooltip, setTooltip] = useState<{
    show: boolean;
    x: number;
    y: number;
    label: string;
    value: number;
  }>({ show: false, x: 0, y: 0, label: "", value: 0 });
  const config = COUNTRY_CONFIGS[country];

  const dataMap = useMemo(() => buildDataMap(data), [data]);
  const maxValue = useMemo(
    () => Math.max(...data.map((d) => Number(d.value || 0)), 1),
    [data]
  );

  useEffect(() => {
    const load = async () => {
      try {
        setError("");
        const res = await fetch(config.topoJsonUrl);
        if (!res.ok) throw new Error("Failed to load map topology");
        const raw = await res.json();

        // World map is TopoJSON. India map is GeoJSON.
        if (country === "World") {
          const object = raw?.objects?.[config.topoJsonObject];
          if (!object) throw new Error("World topo object not found");
          const fc = feature(raw, object) as unknown as GeoFeatureCollection;
          if (!fc?.features?.length) throw new Error("Invalid world topology");
          const namesRes = await fetch(
            "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.tsv"
          );
          if (namesRes.ok) {
            const tsv = await namesRes.text();
            const rows = d3.tsvParse(tsv) as unknown as WorldNameRow[];
            const namesByID = new Map(rows.map((r) => [String(r.id), r.name]));
            fc.features = fc.features.map((f) => {
              const featureId = String((f as unknown as { id?: string | number }).id ?? "");
              const name = namesByID.get(featureId);
              return {
                ...f,
                properties: {
                  ...(f.properties || {}),
                  name: name || (f.properties?.name as string) || "",
                },
              };
            });
          }
          setGeoData(fc);
        } else {
          const json = raw as GeoFeatureCollection;
          if (!json.features) throw new Error("Invalid India map file");
          setGeoData(json);
        }
    } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Failed to load map");
        setGeoData(null);
      }
    };
    load();
  }, [country, config.topoJsonObject, config.topoJsonUrl]);

  useEffect(() => {
    if (!svgRef.current || !containerRef.current || !geoData) return;
    const width = Math.max(containerRef.current.clientWidth, 720);
    const height = 520;
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    svg.attr("width", width).attr("height", height);

    const projection =
      config.projectionType === "geoEquirectangular"
        ? d3.geoEquirectangular()
        : d3.geoMercator();

    if (config.center) {
      projection.center(config.center);
    }
    projection.fitExtent(
      [
        [20, 20],
        [width - 20, height - 20],
      ],
      geoData as unknown as d3.GeoPermissibleObjects
    );

    const path = d3.geoPath(projection);
    const colorScale = d3
      .scaleLinear<string>()
      .domain([0, maxValue])
      .range(["#e2e8f0", "#0284c7"]);

    const extractRegion = (d: GeoFeature) => {
      const props = d.properties || {};
      const keys = [
        props[config.nameProperty],
        props.st_nm,
        props.ST_NM,
        props.STATE,
        props.NAME_1,
        props.admin,
        props.name,
        props.iso_a2,
        props.iso_a3,
        props.region,
      ];
      for (const key of keys) {
        const matched = dataMap.get(norm(key));
        if (typeof matched === "number") {
          return { label: String(key || "Unknown"), value: matched };
        }
      }
      return {
        label: String(
          props[config.nameProperty] ||
            props.name ||
            props.ST_NM ||
            props.st_nm ||
            "Unknown"
        ),
        value: 0,
      };
    };

    svg
      .append("g")
      .selectAll("path")
      .data(geoData.features)
      .join("path")
      .attr("d", (d: GeoFeature) => path(d as unknown as d3.GeoPermissibleObjects) || "")
      .attr("fill", (d: GeoFeature) => {
        const { value } = extractRegion(d);
        return value > 0 ? colorScale(value) : "#e5e7eb";
      })
      .attr("stroke", "#ffffff")
      .attr("stroke-width", 0.75)
      .on("mousemove", (event: MouseEvent, d: GeoFeature) => {
        const { label, value } = extractRegion(d);
        const containerRect = containerRef.current?.getBoundingClientRect();
        if (!containerRect) return;
        setTooltip({
          show: true,
          x: event.clientX - containerRect.left + 10,
          y: event.clientY - containerRect.top + 10,
          label,
          value,
        });
      })
      .on("mouseleave", () => {
        setTooltip({ show: false, x: 0, y: 0, label: "", value: 0 });
      });
  }, [config.nameProperty, config.projectionType, config.center, country, geoData, dataMap, maxValue]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div ref={containerRef} className="relative w-full overflow-x-auto">
        {isLoading ? (
          <p className="py-16 text-center text-sm text-slate-500">Loading map analytics...</p>
        ) : error ? (
          <p className="py-16 text-center text-sm text-red-600">{error}</p>
        ) : (
          <svg ref={svgRef} className="h-[520px] w-full" />
        )}
        {tooltip.show && !isLoading && !error && (
          <div
            className="pointer-events-none absolute rounded-md bg-slate-900 px-2 py-1 text-xs text-white shadow"
            style={{ left: tooltip.x, top: tooltip.y }}
          >
            {tooltip.label}: {Math.round(tooltip.value)}
          </div>
        )}
      </div>
    </div>
  );
}
