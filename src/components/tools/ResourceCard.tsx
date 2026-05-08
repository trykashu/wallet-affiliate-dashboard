import type { AffiliateResource } from "@/types/database";
import { fmt } from "@/lib/fmt";

export default function ResourceCard({ resource }: { resource: AffiliateResource }) {
  return (
    <a
      href={resource.public_url}
      target="_blank"
      rel="noopener noreferrer"
      className="card p-5 flex items-start gap-4 hover:shadow-card-md transition-shadow"
    >
      <div className="w-12 h-12 rounded-xl bg-brand-600 border border-brand-700 flex items-center justify-center flex-shrink-0">
        <span className="text-[10px] font-bold text-white uppercase">{kindLabel(resource.kind)}</span>
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold text-gray-900 truncate">{resource.title}</h3>
        {resource.description && (
          <p className="text-xs text-brand-400 mt-1 leading-relaxed line-clamp-2">{resource.description}</p>
        )}
        <div className="mt-2 flex items-center gap-3 text-[10px] text-brand-400 uppercase tracking-wider">
          <span>{resource.kind}</span>
          <span>{fmt.bytes(resource.file_size_bytes)}</span>
        </div>
      </div>
    </a>
  );
}

function kindLabel(k: AffiliateResource["kind"]) {
  if (k === "pdf") return "PDF";
  if (k === "image") return "IMG";
  if (k === "archive") return "ZIP";
  return k.toUpperCase();
}
