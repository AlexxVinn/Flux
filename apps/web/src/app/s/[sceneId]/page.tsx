"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { SharedSceneView } from "@/components/scene/SharedSceneView";
import { fetchSharedUserScene } from "@/lib/scenes/userScenes";

export default function SharedScenePage() {
  const params = useParams<{ sceneId: string }>();
  const sceneId = params.sceneId;
  const [loading, setLoading] = useState(true);
  const [scene, setScene] = useState<Awaited<ReturnType<typeof fetchSharedUserScene>>>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const result = await fetchSharedUserScene(sceneId);
        if (!result) {
          setError("Scene not found or not shared.");
          setScene(null);
          return;
        }
        setScene(result);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load scene.");
      } finally {
        setLoading(false);
      }
    })();
  }, [sceneId]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-black text-sm text-white/50">
        Loading scene…
      </div>
    );
  }

  if (error || !scene) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-black px-6 text-center">
        <p className="text-sm text-red-400/90">{error ?? "Scene unavailable."}</p>
        <Link href="/" className="flux-btn px-3 py-2 text-sm text-white/80">
          Back to home
        </Link>
      </div>
    );
  }

  return (
    <SharedSceneView
      sceneId={scene.id}
      title={scene.title}
      module={scene.module}
      snapshot={scene.snapshot}
    />
  );
}
