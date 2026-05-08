"use client";
import type { AffiliateResource } from "@/types/database";
import { fmt } from "@/lib/fmt";

export default function VideoCard({ resource }: { resource: AffiliateResource }) {
  const poster = resource.thumbnail_path
    ? publicUrlForThumb(resource.public_url, resource.thumbnail_path)
    : undefined;
  return (
    <div className="card overflow-hidden flex flex-col">
      <div className="aspect-video bg-surface-100">
        <video
          className="w-full h-full"
          src={resource.public_url}
          poster={poster}
          preload="metadata"
          playsInline
          controls
        />
      </div>
      <div className="p-4 flex-1 flex flex-col gap-1">
        <h3 className="text-sm font-semibold text-gray-900">{resource.title}</h3>
        {resource.description && (
          <p className="text-xs text-brand-400 leading-relaxed">{resource.description}</p>
        )}
        <div className="mt-auto pt-2 flex items-center justify-between text-[10px] text-brand-400 uppercase tracking-wider">
          <span>{resource.duration_seconds ? `${Math.round(resource.duration_seconds / 60)} min` : "—"}</span>
          <span>{fmt.bytes(resource.file_size_bytes)}</span>
        </div>
      </div>
    </div>
  );
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
