"use client";
import type { AffiliateResource } from "@/types/database";
import { fmt } from "@/lib/fmt";

type EmbedKind = "youtube" | "vimeo" | "direct";

function detectEmbed(url: string): { kind: EmbedKind; src: string } {
  // YouTube watch URL
  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
  if (ytMatch) return { kind: "youtube", src: `https://www.youtube.com/embed/${ytMatch[1]}` };

  // YouTube already-embed URL
  if (/youtube\.com\/embed\//.test(url)) return { kind: "youtube", src: url };

  // Vimeo
  const vimeoMatch = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vimeoMatch) return { kind: "vimeo", src: `https://player.vimeo.com/video/${vimeoMatch[1]}` };

  // Direct mp4 / Supabase storage URL — falls through to <video>
  return { kind: "direct", src: url };
}

export default function VideoCard({ resource }: { resource: AffiliateResource }) {
  const poster = resource.thumbnail_path
    ? publicUrlForThumb(resource.public_url, resource.thumbnail_path)
    : undefined;

  const duration = formatDuration(resource.duration_seconds);
  const embed = detectEmbed(resource.public_url);

  return (
    <div className="card overflow-hidden flex flex-col group">
      <div className="relative aspect-video bg-surface-100">
        {embed.kind === "direct" ? (
          <video
            className="w-full h-full"
            src={embed.src}
            poster={poster}
            preload="metadata"
            playsInline
            controls
          />
        ) : (
          <iframe
            className="w-full h-full"
            src={embed.src}
            title={resource.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        )}
        {/* Play overlay — fades on hover so the native controls take over after first click */}
        {embed.kind === "direct" && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center group-hover:opacity-0 transition-opacity duration-300">
            <div className="w-14 h-14 rounded-full bg-white/85 backdrop-blur-sm shadow-card-md flex items-center justify-center">
              <svg className="w-6 h-6 text-brand-600 ml-0.5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M5 4.5v15a.5.5 0 00.77.42l12-7.5a.5.5 0 000-.84l-12-7.5A.5.5 0 005 4.5z" />
              </svg>
            </div>
          </div>
        )}
        {duration && (
          <span className="pointer-events-none absolute top-2 right-2 bg-gray-900/70 text-white text-[10px] font-semibold tabular-nums px-2 py-0.5 rounded-full backdrop-blur-sm">
            {duration}
          </span>
        )}
      </div>
      <div className="p-4 flex-1 flex flex-col gap-1">
        <h3 className="text-sm font-semibold text-gray-900">{resource.title}</h3>
        {resource.description && (
          <p className="text-xs text-brand-400 leading-relaxed">{resource.description}</p>
        )}
        <div className="mt-auto pt-2 flex items-center justify-between text-[10px] text-brand-400 uppercase tracking-wider">
          <span className="tabular-nums">
            {resource.duration_seconds ? `${Math.round(resource.duration_seconds / 60)} min` : "—"}
          </span>
          <span className="tabular-nums">{fmt.bytes(resource.file_size_bytes)}</span>
        </div>
      </div>
    </div>
  );
}

function formatDuration(seconds: number | null | undefined): string | null {
  if (!seconds || seconds <= 0) return null;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function publicUrlForThumb(videoPublicUrl: string, thumbPath: string): string {
  // The thumb's public URL shares the same prefix as the video; we swap the
  // bucket-relative storage_path tail for the thumbnail_path.
  const u = new URL(videoPublicUrl);
  const segs = u.pathname.split("/");
  const idxBucket = segs.indexOf("affiliate-content");
  if (idxBucket >= 0) {
    u.pathname = [...segs.slice(0, idxBucket + 1), thumbPath].join("/");
  }
  return u.toString();
}
