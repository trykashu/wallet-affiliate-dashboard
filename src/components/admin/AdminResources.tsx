"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AffiliateResource } from "@/types/database";
import { fmt } from "@/lib/fmt";
import {
  saveResource,
  deleteResource,
  togglePublishedResource,
  uploadResourceFile,
  type ResourceInput,
} from "@/app/admin/resources/_actions";

const KINDS: AffiliateResource["kind"][] = ["video", "pdf", "image", "archive"];
const CATEGORIES: AffiliateResource["category"][] = [
  "onboarding", "tutorial", "guide", "compliance", "brand",
];

const EMPTY_FORM: ResourceInput = {
  title: "",
  description: "",
  kind: "pdf",
  category: "guide",
  storage_path: "",
  public_url: "",
  thumbnail_path: null,
  file_size_bytes: null,
  duration_seconds: null,
  sort_order: 10,
  is_published: true,
};

export default function AdminResources({ initialRows }: { initialRows: AffiliateResource[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<ResourceInput | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [externalMode, setExternalMode] = useState(false);

  function openNew() {
    setEditing({ ...EMPTY_FORM });
    setExternalMode(false);
    setError(null);
  }
  function openEdit(r: AffiliateResource) {
    setEditing({
      id: r.id,
      title: r.title,
      description: r.description,
      kind: r.kind,
      category: r.category,
      storage_path: r.storage_path,
      public_url: r.public_url,
      thumbnail_path: r.thumbnail_path,
      file_size_bytes: r.file_size_bytes,
      duration_seconds: r.duration_seconds,
      sort_order: r.sort_order,
      is_published: r.is_published,
    });
    setExternalMode(/youtube|vimeo|external\//.test(r.storage_path));
    setError(null);
  }
  function close() { setEditing(null); setError(null); }

  function handleSave() {
    if (!editing) return;
    setError(null);
    startTransition(async () => {
      try {
        await saveResource(editing);
        close();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed");
      }
    });
  }

  function handleDelete(id: string) {
    if (!confirm("Delete this resource? This cannot be undone.")) return;
    startTransition(async () => {
      try {
        await deleteResource(id);
        router.refresh();
      } catch (e) {
        alert(e instanceof Error ? e.message : "Delete failed");
      }
    });
  }

  function handleToggle(id: string, current: boolean) {
    startTransition(async () => {
      try {
        await togglePublishedResource(id, !current);
        router.refresh();
      } catch (e) {
        alert(e instanceof Error ? e.message : "Toggle failed");
      }
    });
  }

  async function handleFileUpload(file: File) {
    if (!editing) return;
    if (!editing.storage_path.trim()) {
      setError("Set a storage_path before uploading (e.g. brand/foo.png).");
      return;
    }
    const MAX_BYTES = 50 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
      setError(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max ${MAX_BYTES / 1024 / 1024} MB. Use scripts/upload-affiliate-content.ts for larger files.`);
      return;
    }
    setError(null);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("storage_path", editing.storage_path.trim());
    try {
      const out = await uploadResourceFile(fd);
      setEditing({
        ...editing,
        public_url: out.public_url,
        file_size_bytes: out.file_size_bytes,
        storage_path: out.storage_path,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold ad-text-1">Resources</h1>
          <p className="text-sm ad-text-3 mt-1">
            Content shown on the affiliate /tools tab.
          </p>
        </div>
        <button onClick={openNew} className="ad-btn-primary px-4 py-2 rounded-xl text-sm">
          + Add resource
        </button>
      </div>

      <div className="ad-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-[var(--ad-border)] bg-[var(--ad-inset)]">
                <th className="ad-th">Title</th>
                <th className="ad-th">Kind</th>
                <th className="ad-th">Category</th>
                <th className="ad-th">Size</th>
                <th className="ad-th">Order</th>
                <th className="ad-th">Published</th>
                <th className="ad-th text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--ad-border)]">
              {initialRows.length === 0 && (
                <tr><td colSpan={7} className="ad-td text-center text-sm ad-text-3 py-12">
                  No resources yet. Click <span className="font-semibold">+ Add resource</span> to add one.
                </td></tr>
              )}
              {initialRows.map((r) => (
                <tr key={r.id} className="hover:bg-[var(--ad-surface-2)] transition-colors">
                  <td className="ad-td">
                    <p className="text-sm font-semibold ad-text-1">{r.title}</p>
                    {r.description && (
                      <p className="text-xs ad-text-3 truncate max-w-md">{r.description}</p>
                    )}
                  </td>
                  <td className="ad-td text-xs uppercase ad-text-3 tracking-wider">{r.kind}</td>
                  <td className="ad-td text-xs uppercase ad-text-3 tracking-wider">{r.category}</td>
                  <td className="ad-td text-xs ad-text-3 tabular-nums">{fmt.bytes(r.file_size_bytes)}</td>
                  <td className="ad-td text-xs tabular-nums ad-text-3">{r.sort_order}</td>
                  <td className="ad-td">
                    <button
                      onClick={() => handleToggle(r.id, r.is_published)}
                      disabled={pending}
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                        r.is_published
                          ? "text-[var(--ad-pos)] bg-[rgba(52,211,153,0.10)] border-[rgba(52,211,153,0.28)]"
                          : "text-[var(--ad-text-3)] bg-[var(--ad-surface-2)] border-[var(--ad-border)]"
                      }`}
                    >
                      {r.is_published ? "Published" : "Hidden"}
                    </button>
                  </td>
                  <td className="ad-td">
                    <div className="flex items-center justify-end gap-2">
                      <a href={r.public_url} target="_blank" rel="noopener noreferrer"
                         className="text-xs ad-accent-text hover:underline">Open</a>
                      <button onClick={() => openEdit(r)}
                              className="text-xs ad-accent-text hover:underline">Edit</button>
                      <button onClick={() => handleDelete(r.id)} disabled={pending}
                              className="text-xs text-[var(--ad-neg)] hover:underline">Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <>
          <div className="fixed inset-0 bg-black/60 z-40 drawer-backdrop" onClick={close} />
          <div className="fixed inset-y-0 right-0 w-full max-w-md p-6 z-50 overflow-y-auto drawer-panel">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold ad-text-1">
                {editing.id ? "Edit resource" : "New resource"}
              </h2>
              <button onClick={close} className="text-sm ad-text-3 hover:text-[var(--ad-text)]">Close</button>
            </div>

            {error && (
              <div className="mb-4 p-3 rounded-xl bg-[rgba(242,112,110,0.10)] border border-[rgba(242,112,110,0.28)] text-xs text-[var(--ad-neg)]">
                {error}
              </div>
            )}

            <div className="space-y-4">
              <Field label="Title">
                <input className="ad-input w-full"
                       value={editing.title}
                       onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
              </Field>

              <Field label="Description">
                <textarea className="ad-input w-full" rows={2}
                          value={editing.description ?? ""}
                          onChange={(e) => setEditing({ ...editing, description: e.target.value || null })} />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Kind">
                  <select className="ad-input w-full"
                          value={editing.kind}
                          onChange={(e) => setEditing({ ...editing, kind: e.target.value as AffiliateResource["kind"] })}>
                    {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                  </select>
                </Field>

                <Field label="Category">
                  <select className="ad-input w-full"
                          value={editing.category}
                          onChange={(e) => setEditing({ ...editing, category: e.target.value as AffiliateResource["category"] })}>
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
              </div>

              <div className="flex items-center justify-between p-3 rounded-xl ad-inset">
                <div>
                  <p className="text-sm font-semibold ad-text-1">External URL</p>
                  <p className="text-[10px] ad-text-3 leading-tight">
                    For YouTube/Vimeo videos. Paste the URL instead of uploading a file.
                  </p>
                </div>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={externalMode}
                         onChange={(e) => setExternalMode(e.target.checked)} />
                  <span className="text-sm ad-text-1">{externalMode ? "On" : "Off"}</span>
                </label>
              </div>

              <Field label={externalMode ? "Row key (slug, no spaces)" : "Storage path"}>
                <input className="ad-input w-full font-mono text-xs"
                       placeholder={externalMode ? "e.g. external/youtube/onboarding-video" : "e.g. brand/new_logo.svg"}
                       value={editing.storage_path}
                       onChange={(e) => setEditing({ ...editing, storage_path: e.target.value })} />
                <p className="text-[10px] ad-text-3 mt-1">
                  {externalMode
                    ? "A unique slug to identify this row. Convention: external/<provider>/<slug>."
                    : "Path inside the affiliate-content bucket. Set this before uploading a file."}
                </p>
              </Field>

              {externalMode ? (
                <Field label="Public URL">
                  <input type="url" className="ad-input w-full"
                         placeholder="https://www.youtube.com/watch?v=... or https://vimeo.com/..."
                         value={editing.public_url}
                         onChange={(e) => setEditing({ ...editing, public_url: e.target.value })} />
                  <p className="text-[10px] ad-text-3 mt-1">
                    The URL that will be embedded. YouTube/Vimeo links auto-detected; everything else renders inline via the native video player.
                  </p>
                </Field>
              ) : (
                <Field label="Upload file">
                  <input type="file" className="text-xs ad-text-2 file:ad-btn-primary file:text-xs file:px-3 file:py-1.5 file:rounded-xl file:border-0 file:mr-3"
                         onChange={async (e) => {
                           const f = e.target.files?.[0];
                           if (f) await handleFileUpload(f);
                           e.target.value = "";
                         }} />
                  {editing.public_url && (
                    <p className="text-[10px] ad-text-3 mt-1 truncate">
                      Uploaded → {editing.public_url}
                    </p>
                  )}
                </Field>
              )}

              <div className="grid grid-cols-2 gap-3">
                <Field label="Sort order">
                  <input type="number" className="ad-input w-full tabular-nums"
                         value={editing.sort_order}
                         onChange={(e) => setEditing({ ...editing, sort_order: parseInt(e.target.value, 10) || 0 })} />
                </Field>

                <Field label="Published">
                  <label className="flex items-center gap-2 h-9">
                    <input type="checkbox"
                           checked={editing.is_published}
                           onChange={(e) => setEditing({ ...editing, is_published: e.target.checked })} />
                    <span className="text-sm ad-text-1">{editing.is_published ? "Yes" : "No"}</span>
                  </label>
                </Field>
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-[var(--ad-border)]">
                <button onClick={close} className="text-sm ad-text-3 hover:text-[var(--ad-text)]">Cancel</button>
                <button onClick={handleSave} disabled={pending || !editing.title.trim() || !editing.storage_path.trim() || !editing.public_url.trim()}
                        className="ad-btn-primary px-4 py-2 rounded-xl text-sm disabled:opacity-50">
                  {pending ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10px] font-bold ad-text-3 uppercase tracking-wider">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
