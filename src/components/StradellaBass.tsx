import {
  stradella120Layout,
  stradellaRows,
  stradellaViewBox,
  stradellaHeaderXOffset,
  stradellaHeaderYOffset,
} from "../data/stradella120Layout";
import type { LeftHandAction } from "../lib/scoreTypes";

type StradellaBassProps = {
  activeButtonIds: string[];
  leftHandAction: LeftHandAction;
};

const splitLabel = (label: string): [string, string?] => {
  if (label.endsWith("dim")) return [label.slice(0, -3), "dim"];
  if (label.endsWith("7")) return [label.slice(0, -1), "7"];
  if (label.endsWith("m")) return [label.slice(0, -1), "m"];
  return [label];
};

const actionClass: Record<LeftHandAction, string> = {
  bass: "is-active-bass",
  chord: "is-active-chord",
  none: "",
};

export function StradellaBass({ activeButtonIds, leftHandAction }: StradellaBassProps) {
  const active = new Set(activeButtonIds);
  const activeClass = actionClass[leftHandAction];

  return (
    <svg
      className="stradella-bass"
      viewBox={stradellaViewBox}
      role="img"
      aria-label="Left hand 120 bass Stradella buttons"
    >
      {stradellaRows.map((row, rowIndex) => (
        <text
          key={row.row}
          x={stradellaHeaderXOffset + rowIndex * 34}
          y={stradellaHeaderYOffset + 16}
          className="row-label"
        >
          {row.label}
        </text>
      ))}
      {stradella120Layout.map((button) => {
        const [mainLabel, suffix] = splitLabel(button.label);
        const isActive = active.has(button.id);

        return (
          <g key={`${button.id}-${button.x}-${button.y}`}>
            <circle
              className={`bass-button ${isActive ? activeClass : ""}`}
              cx={button.x}
              cy={button.y}
              r="11"
            />
            <text x={button.x} y={button.y + 3} className="button-label">
              {mainLabel}
              {suffix && (
                <tspan x={button.x} dy="6" className="button-label-suffix">
                  {suffix}
                </tspan>
              )}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
