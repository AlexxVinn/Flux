"use client";

import { useMemo, useState } from "react";
import { identiconGrid } from "@/lib/collaboration/avatar";
import { avatarRingGradient, memberAvatarUrl } from "@/lib/collaboration/memberAvatar";

export function UserAvatar({
  userId,
  color,
  size = 20,
  className,
  displayName,
}: {
  userId: string;
  color: string;
  size?: number;
  className?: string;
  /** Used for accessible label and fallback initials */
  displayName?: string;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const src = useMemo(() => memberAvatarUrl(userId, size), [userId, size]);
  const grid = identiconGrid(userId);
  const cell = size / 5;
  const ring = Math.max(2, Math.round(size * 0.06));
  const radius = Math.max(6, Math.round(size * 0.22));
  const initials =
    displayName
      ?.trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "?";

  const label = displayName?.trim() || "Member avatar";

  return (
    <div
      className={`relative shrink-0 overflow-hidden ${className ?? ""}`}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        padding: ring,
        background: avatarRingGradient(color),
        boxShadow: `0 0 0 1px ${color}33, 0 4px 12px rgba(0,0,0,0.35)`,
      }}
      title={label}
    >
      <div
        className="relative h-full w-full overflow-hidden bg-[#0a0a0c]"
        style={{ borderRadius: Math.max(4, radius - ring) }}
      >
        {!imgFailed ? (
          <img
            src={src}
            alt=""
            width={size}
            height={size}
            loading="lazy"
            decoding="async"
            draggable={false}
            className="h-full w-full object-cover"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <svg
            width="100%"
            height="100%"
            viewBox={`0 0 ${size} ${size}`}
            aria-hidden
            className="block"
          >
            <rect width={size} height={size} fill={color} opacity={0.35} />
            {grid.map((row, y) =>
              row.map((on, x) =>
                on ? (
                  <rect
                    key={`${x}-${y}`}
                    x={x * cell + cell * 0.08}
                    y={y * cell + cell * 0.08}
                    width={cell * 0.84}
                    height={cell * 0.84}
                    fill="rgba(255,255,255,0.88)"
                    rx={0.5}
                  />
                ) : null,
              ),
            )}
            {size >= 28 && (
              <text
                x={size / 2}
                y={size / 2}
                textAnchor="middle"
                dominantBaseline="central"
                fill="white"
                fontSize={size * 0.32}
                fontWeight={600}
                opacity={0.95}
              >
                {initials}
              </text>
            )}
          </svg>
        )}
      </div>
    </div>
  );
}
