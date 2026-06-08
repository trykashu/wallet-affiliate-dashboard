"use client";

import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import type { ShareTemplate } from "@/types/database";
import { interpolate, TEMPLATE_VARS, type TemplateVar } from "@/lib/template-vars";
import {
  saveTemplate,
  deleteTemplate,
  toggleTemplatePublished,
  type TemplateInput,
} from "@/app/admin/share-templates/_actions";

const PLATFORMS: ShareTemplate["platform"][] = ["instagram", "twitter", "linkedin", "general"];
const CATEGORIES: ShareTemplate["category"][] = ["intro", "case-study", "promo", "follow-up"];

const SAMPLE_VARS = {
  referral_link: "https://signup.kashupay.com?referrer=preview",
  agent_name: "Sample Affiliate",
  business_name: "Sample LLC",
};

const EMPTY_FORM: TemplateInput = {
  title: "",
  platform: "general",
  category: "intro",
  body: "",
  sort_order: 10,
  is_published: true,
};

export default function AdminShareTemplates({ initialRows }: { initialRows: ShareTemplate[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<TemplateInput | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  function openNew() { setEditing({ ...EMPTY_FORM }); setError(null); }
  function openEdit(t: ShareTemplate) {
    setEditing({
      id: t.id,
      title: t.title,
      platform: t.platform,
      category: t.category,
      body: t.body,
      sort_order: t.sort_order,
      is_published: t.is_published,
    });
    setError(null);
  }
  function close() { setEditing(null); setError(null); }

  function insertVar(v: TemplateVar) {
    const ta = bodyRef.current;
    if (!ta || !editing) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const before = editing.body.slice(0, start);
    const after = editing.body.slice(end);
    const insertion = `{{${v}}}`;
    const newBody = before + insertion + after;
    setEditing({ ...editing, body: newBody });
    setTimeout(() => {
      ta.focus();
      const pos = start + insertion.length;
      ta.setSelectionRange(pos, pos);
    }, 0);
  }

  function handleSave() {
    if (!editing) return;
    setError(null);
    startTransition(async () => {
      try {
        await saveTemplate(editing);
        close();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed");
      }
    });
  }

  function handleDelete(id: string) {
    if (!confirm("Delete this template?")) return;
    startTransition(async () => {
      try { await deleteTemplate(id); router.refresh(); }
      catch (e) { alert(e instanceof Error ? e.message : "Delete failed"); }
    });
  }

  function handleToggle(id: string, current: boolean) {
    startTransition(async () => {
      try { await toggleTemplatePublished(id, !current); router.refresh(); }
      catch (e) { alert(e instanceof Error ? e.message : "Toggle failed"); }
    });
  }

  const preview = editing ? interpolate(editing.body, SAMPLE_VARS) : "";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold ad-text-1">Share Templates</h1>
          <p className="text-sm ad-text-3 mt-1">
            Pre-written social copy shown to affiliates on the /tools tab.
          </p>
        </div>
        <button onClick={openNew} className="ad-btn-primary px-4 py-2 rounded-xl text-sm">
          + Add template
        </button>
      </div>

      <div className="ad-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-[var(--ad-border)] bg-[var(--ad-inset)]">
                <th className="ad-th">Title</th>
                <th className="ad-th">Platform</th>
                <th className="ad-th">Category</th>
                <th className="ad-th">Body</th>
                <th className="ad-th">Order</th>
                <th className="ad-th">Published</th>
                <th className="ad-th text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--ad-border)]">
              {initialRows.length === 0 && (
                <tr><td colSpan={7} className="ad-td text-center text-sm ad-text-3 py-12">
                  No templates yet. Click <span className="font-semibold">+ Add template</span>.
                </td></tr>
              )}
              {initialRows.map((t) => (
                <tr key={t.id} className="hover:bg-[var(--ad-surface-2)] transition-colors">
                  <td className="ad-td">
                    <p className="text-sm font-semibold ad-text-1">{t.title}</p>
                  </td>
                  <td className="ad-td text-xs uppercase ad-text-3 tracking-wider">{t.platform}</td>
                  <td className="ad-td text-xs uppercase ad-text-3 tracking-wider">{t.category}</td>
                  <td className="ad-td max-w-md">
                    <p className="text-xs ad-text-3 truncate">{t.body}</p>
                  </td>
                  <td className="ad-td text-xs tabular-nums ad-text-3">{t.sort_order}</td>
                  <td className="ad-td">
                    <button
                      onClick={() => handleToggle(t.id, t.is_published)}
                      disabled={pending}
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                        t.is_published
                          ? "text-[var(--ad-pos)] bg-[rgba(52,211,153,0.10)] border-[rgba(52,211,153,0.28)]"
                          : "text-[var(--ad-text-3)] bg-[var(--ad-surface-2)] border-[var(--ad-border)]"
                      }`}
                    >
                      {t.is_published ? "Published" : "Hidden"}
                    </button>
                  </td>
                  <td className="ad-td">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => openEdit(t)} className="text-xs ad-accent-text hover:underline">Edit</button>
                      <button onClick={() => handleDelete(t.id)} disabled={pending}
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
                {editing.id ? "Edit template" : "New template"}
              </h2>
              <button onClick={close} className="text-sm ad-text-3 hover:text-[var(--ad-text)]">Close</button>
            </div>

            {error && (
              <div className="mb-4 p-3 rounded-xl bg-[rgba(242,112,110,0.10)] border border-[rgba(242,112,110,0.28)] text-xs text-[var(--ad-neg)]">{error}</div>
            )}

            <div className="space-y-4">
              <Field label="Title">
                <input className="ad-input w-full"
                       value={editing.title}
                       onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Platform">
                  <select className="ad-input w-full"
                          value={editing.platform}
                          onChange={(e) => setEditing({ ...editing, platform: e.target.value as ShareTemplate["platform"] })}>
                    {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </Field>
                <Field label="Category">
                  <select className="ad-input w-full"
                          value={editing.category}
                          onChange={(e) => setEditing({ ...editing, category: e.target.value as ShareTemplate["category"] })}>
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
              </div>

              <Field label="Body">
                <div className="flex flex-wrap gap-1 mb-2">
                  {TEMPLATE_VARS.map((v) => (
                    <button key={v} type="button" onClick={() => insertVar(v)}
                            className="text-[10px] font-semibold px-2 py-1 rounded-lg bg-[var(--ad-surface-2)] border border-[var(--ad-border)] ad-text-2 hover:bg-[var(--ad-border)] transition-colors">
                      {`{{${v}}}`}
                    </button>
                  ))}
                </div>
                <textarea ref={bodyRef} className="ad-input w-full font-mono text-xs" rows={6}
                          value={editing.body}
                          onChange={(e) => setEditing({ ...editing, body: e.target.value })} />
              </Field>

              <Field label="Live preview">
                <div className="ad-inset p-3 text-sm ad-text-1 whitespace-pre-wrap leading-relaxed">
                  {preview || <span className="ad-text-3 italic">Body is empty.</span>}
                </div>
              </Field>

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
                <button onClick={handleSave} disabled={pending || !editing.title.trim() || !editing.body.trim()}
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
