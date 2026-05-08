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

  function openNew() {
    setEditing({ ...EMPTY_FORM });
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
          <h1 className="text-2xl font-bold text-gray-900">Resources</h1>
          <p className="text-sm text-brand-400 mt-1">
            Content shown on the affiliate /tools tab.
          </p>
        </div>
        <button onClick={openNew} className="btn-primary px-4 py-2 rounded-xl text-sm">
          + Add resource
        </button>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-surface-200/60 bg-surface-50/60">
                <th className="th">Title</th>
                <th className="th">Kind</th>
                <th className="th">Category</th>
                <th className="th">Size</th>
                <th className="th">Order</th>
                <th className="th">Published</th>
                <th className="th text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-200/60">
              {initialRows.length === 0 && (
                <tr><td colSpan={7} className="td text-center text-sm text-brand-400 py-12">
                  No resources yet. Click <span className="font-semibold">+ Add resource</span> to add one.
                </td></tr>
              )}
              {initialRows.map((r) => (
                <tr key={r.id} className="hover:bg-surface-100/40 transition-colors">
                  <td className="td">
                    <p className="text-sm font-semibold text-gray-900">{r.title}</p>
                    {r.description && (
                      <p className="text-xs text-brand-400 truncate max-w-md">{r.description}</p>
                    )}
                  </td>
                  <td className="td text-xs uppercase text-brand-400 tracking-wider">{r.kind}</td>
                  <td className="td text-xs uppercase text-brand-400 tracking-wider">{r.category}</td>
                  <td className="td text-xs text-brand-400 tabular-nums">{fmt.bytes(r.file_size_bytes)}</td>
                  <td className="td text-xs tabular-nums text-brand-400">{r.sort_order}</td>
                  <td className="td">
                    <button
                      onClick={() => handleToggle(r.id, r.is_published)}
                      disabled={pending}
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                        r.is_published
                          ? "text-emerald-700 bg-emerald-50 border-emerald-200"
                          : "text-brand-400 bg-surface-100 border-surface-200"
                      }`}
                    >
                      {r.is_published ? "Published" : "Hidden"}
                    </button>
                  </td>
                  <td className="td">
                    <div className="flex items-center justify-end gap-2">
                      <a href={r.public_url} target="_blank" rel="noopener noreferrer"
                         className="text-xs text-brand-600 hover:underline">Open</a>
                      <button onClick={() => openEdit(r)}
                              className="text-xs text-brand-600 hover:underline">Edit</button>
                      <button onClick={() => handleDelete(r.id)} disabled={pending}
                              className="text-xs text-red-600 hover:underline">Delete</button>
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
          <div className="fixed inset-0 bg-gray-900/30 z-40" onClick={close} />
          <div className="fixed inset-y-0 right-0 w-full max-w-md bg-white shadow-card-md p-6 z-50 overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">
                {editing.id ? "Edit resource" : "New resource"}
              </h2>
              <button onClick={close} className="text-sm text-brand-400 hover:text-gray-900">Close</button>
            </div>

            {error && (
              <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700">
                {error}
              </div>
            )}

            <div className="space-y-4">
              <Field label="Title">
                <input className="input-base w-full"
                       value={editing.title}
                       onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
              </Field>

              <Field label="Description">
                <textarea className="input-base w-full" rows={2}
                          value={editing.description ?? ""}
                          onChange={(e) => setEditing({ ...editing, description: e.target.value || null })} />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Kind">
                  <select className="input-base w-full"
                          value={editing.kind}
                          onChange={(e) => setEditing({ ...editing, kind: e.target.value as AffiliateResource["kind"] })}>
                    {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                  </select>
                </Field>

                <Field label="Category">
                  <select className="input-base w-full"
                          value={editing.category}
                          onChange={(e) => setEditing({ ...editing, category: e.target.value as AffiliateResource["category"] })}>
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
              </div>

              <Field label="Storage path">
                <input className="input-base w-full font-mono text-xs"
                       placeholder="e.g. brand/new_logo.svg"
                       value={editing.storage_path}
                       onChange={(e) => setEditing({ ...editing, storage_path: e.target.value })} />
                <p className="text-[10px] text-brand-400 mt-1">
                  Path inside the affiliate-content bucket. Set this before uploading a file.
                </p>
              </Field>

              <Field label="Upload file">
                <input type="file" className="text-xs text-gray-900 file:btn-accent file:text-xs file:px-3 file:py-1.5 file:rounded-xl file:border-0 file:mr-3"
                       onChange={async (e) => {
                         const f = e.target.files?.[0];
                         if (f) await handleFileUpload(f);
                         e.target.value = "";
                       }} />
                {editing.public_url && (
                  <p className="text-[10px] text-brand-400 mt-1 truncate">
                    Uploaded → {editing.public_url}
                  </p>
                )}
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Sort order">
                  <input type="number" className="input-base w-full tabular-nums"
                         value={editing.sort_order}
                         onChange={(e) => setEditing({ ...editing, sort_order: parseInt(e.target.value, 10) || 0 })} />
                </Field>

                <Field label="Published">
                  <label className="flex items-center gap-2 h-9">
                    <input type="checkbox"
                           checked={editing.is_published}
                           onChange={(e) => setEditing({ ...editing, is_published: e.target.checked })} />
                    <span className="text-sm text-gray-900">{editing.is_published ? "Yes" : "No"}</span>
                  </label>
                </Field>
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-surface-200/60">
                <button onClick={close} className="text-sm text-brand-400 hover:text-gray-900">Cancel</button>
                <button onClick={handleSave} disabled={pending || !editing.title.trim() || !editing.storage_path.trim() || !editing.public_url.trim()}
                        className="btn-primary px-4 py-2 rounded-xl text-sm disabled:opacity-50">
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
      <label className="text-[10px] font-bold text-brand-400 uppercase tracking-wider">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
